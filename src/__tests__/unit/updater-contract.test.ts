import '../db-isolation.setup';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  acquireSessionLock,
  createSession,
  deleteSession,
  getDb,
  hasActiveSessionWork,
  releaseSessionLock,
  setSessionRuntimeStatus,
} from '../../lib/db';
import {
  boundedUpdateText,
  classifyUpdaterError,
  resolveUpdaterFeedChannel,
  resolveUpdaterSupport,
  updaterInitialDelay,
  updaterRetryDelay,
} from '../../lib/updater-contract';

describe('Main-owned updater contract', () => {
  it('supports isolated stable/preview feeds on packaged macOS/Windows and leaves Linux honest', () => {
    assert.equal(resolveUpdaterSupport({ isPackaged: true, officialBuild: true, channel: 'stable', platform: 'darwin' }).supported, true);
    assert.equal(resolveUpdaterSupport({ isPackaged: true, officialBuild: true, channel: 'stable', platform: 'win32' }).supported, true);
    assert.equal(resolveUpdaterSupport({ isPackaged: true, officialBuild: true, channel: 'preview', platform: 'darwin' }).supported, true);
    assert.equal(resolveUpdaterSupport({ isPackaged: true, officialBuild: true, channel: 'fork', platform: 'darwin' }).supported, false);
    assert.equal(
      resolveUpdaterSupport({ isPackaged: true, officialBuild: false, channel: 'stable', platform: 'darwin' }).unsupportedReason,
      'unofficial_build',
    );
    assert.equal(resolveUpdaterFeedChannel('stable'), 'latest');
    assert.equal(resolveUpdaterFeedChannel('preview'), 'preview');
    assert.equal(resolveUpdaterFeedChannel('local'), null);
    assert.equal(
      resolveUpdaterSupport({ isPackaged: false, officialBuild: true, channel: 'stable', platform: 'win32' }).unsupportedReason,
      'not_packaged',
    );
    assert.equal(
      resolveUpdaterSupport({ isPackaged: true, officialBuild: true, channel: 'stable', platform: 'linux', appImagePath: '/app' }).unsupportedReason,
      'linux_trust_not_enabled',
    );
  });

  it('maps raw updater failures to bounded user-action codes', () => {
    assert.equal(classifyUpdaterError(new Error('getaddrinfo ENOTFOUND api.github.com')), 'offline');
    assert.equal(classifyUpdaterError(new Error('publisher signature invalid')), 'signature_invalid');
    assert.equal(classifyUpdaterError(new Error('latest.yml sha512 checksum mismatch')), 'metadata_invalid');
    assert.equal(classifyUpdaterError(new Error('differential download failed')), 'download_failed');
    assert.equal(classifyUpdaterError(new Error('/Users/alice/private/cache')), 'internal');
  });

  it('bounds startup jitter, retry backoff and untrusted release notes', () => {
    assert.equal(updaterInitialDelay(0), 30_000);
    assert.equal(updaterInitialDelay(1), 120_000);
    assert.equal(updaterRetryDelay(1), 300_000);
    assert.equal(updaterRetryDelay(10), 3_600_000);
    assert.equal(boundedUpdateText('abcdef', 3), 'abc');
    assert.equal(boundedUpdateText([{ note: 'one' }, { note: 'two' }]), 'one\n\ntwo');
  });

  it('keeps feed trust and install eligibility in Main behind narrow IPC', () => {
    const root = path.resolve(__dirname, '../../..');
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const updater = fs.readFileSync(path.join(root, 'electron/updater.ts'), 'utf8');
    const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
    const activity = fs.readFileSync(path.join(root, 'src/app/api/app/activity/route.ts'), 'utf8');

    assert.match(main, /isTrustedUpdaterSender/);
    assert.match(main, /before-quit-for-update/);
    assert.match(main, /isQuitting = true/);
    assert.match(main, /CODEPILOT_OFFICIAL_UPDATE_BUILD === '1'/);
    assert.match(main, /getActiveUpdateWork/);
    assert.match(updater, /allowPrerelease = options\.channel === 'preview'/);
    assert.match(updater, /autoUpdater\.channel = feedChannel/);
    assert.match(updater, /allowDowngrade = false/);
    assert.match(updater, /autoDownload = true/);
    assert.match(updater, /autoInstallOnAppQuit = true/);
    assert.match(updater, /trustedSender\(event\)/);
    assert.match(updater, /activity_unavailable/);
    assert.match(updater, /downloadInFlight/);
    assert.match(updater, /snapshot\.phase === 'downloading'/);
    assert.match(updater, /INSTALL_HANDOFF_TIMEOUT_MS/);
    assert.match(updater, /onInstallLifecycleChange\(false\)/);
    assert.match(updater, /phase: 'downloaded', errorCode: 'install_failed'/);
    assert.match(main, /appQuitTeardownStarted/);
    assert.match(main, /updaterInstallLifecycleArmed/);
    assert.match(updater, /snapshot\.phase !== 'error'/);
    assert.doesNotMatch(updater, /setFeedURL/);
    assert.doesNotMatch(preload, /feedURL|channel:|filePath|updaterOptions/);
    assert.match(preload, /updater:get-status/);
    assert.match(preload, /updater:install/);
    assert.match(activity, /hasActiveSessionWork/);
    assert.doesNotMatch(activity, /stream-session-manager/);
    assert.match(activity, /bridgeStatus\.running/);
    assert.match(activity, /last_status === 'running'/);
    const notAvailableStart = updater.indexOf("autoUpdater.on('update-not-available'");
    const progressStart = updater.indexOf("autoUpdater.on('download-progress'", notAvailableStart);
    const notAvailable = updater.slice(notAvailableStart, progressStart);
    assert.match(notAvailable, /releaseName: ''/);
    assert.match(notAvailable, /releaseNotes: ''/);
    assert.match(notAvailable, /progressPercent: null/);
    assert.doesNotMatch(notAvailable, /applyUpdateInfo/);
  });

  it('does not mistake stale runtime_status residue for live chat work', () => {
    const session = createSession(`updater-activity-${Date.now()}`);
    const lockId = `lock-${Date.now()}`;
    try {
      setSessionRuntimeStatus(session.id, 'running');
      assert.equal(hasActiveSessionWork(), false, 'status without an owner is crash residue');

      assert.equal(acquireSessionLock(session.id, lockId, 'updater-test', 600), true);
      assert.equal(hasActiveSessionWork(), true, 'active status plus a live owner blocks install');

      getDb().prepare(
        "UPDATE session_runtime_locks SET expires_at = '2000-01-01 00:00:00' WHERE session_id = ?",
      ).run(session.id);
      assert.equal(hasActiveSessionWork(), false, 'an expired owner cannot keep the updater blocked forever');
    } finally {
      releaseSessionLock(session.id, lockId);
      deleteSession(session.id);
    }
  });

  it('blocks install while a live-owned session is streaming output', () => {
    const session = createSession(`updater-streaming-${Date.now()}`);
    const lockId = `streaming-lock-${Date.now()}`;
    try {
      setSessionRuntimeStatus(session.id, 'streaming');
      assert.equal(acquireSessionLock(session.id, lockId, 'updater-streaming-test', 600), true);
      assert.equal(hasActiveSessionWork(), true, 'streaming output plus a live owner must block install');
    } finally {
      releaseSessionLock(session.id, lockId);
      deleteSession(session.id);
    }
  });
});
