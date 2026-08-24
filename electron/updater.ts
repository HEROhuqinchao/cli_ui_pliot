import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import {
  boundedUpdateText,
  classifyUpdaterError,
  resolveUpdaterSupport,
  resolveUpdaterFeedChannel,
  updaterInitialDelay,
  updaterRetryDelay,
  type UpdaterInstallResult,
  type UpdaterSnapshot,
} from '../src/lib/updater-contract';

const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000;
const INSTALL_HANDOFF_TIMEOUT_MS = 15_000;

interface AutoUpdaterOptions {
  win: BrowserWindow;
  currentVersion: string;
  channel: string;
  isPackaged: boolean;
  officialBuild: boolean;
  platform: NodeJS.Platform;
  appImagePath?: string;
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
  getActiveWork: () => Promise<Array<'chat' | 'bridge' | 'task'>>;
  onInstallLifecycleChange: (installing: boolean) => void;
}

let updaterWindow: BrowserWindow | null = null;
let initialized = false;
let trustedSender: AutoUpdaterOptions['isTrustedSender'] = () => false;
let getActiveWork: AutoUpdaterOptions['getActiveWork'] = async () => [];
let onInstallLifecycleChange: AutoUpdaterOptions['onInstallLifecycleChange'] = () => {};
let checkInFlight: Promise<UpdaterSnapshot> | null = null;
let downloadInFlight: Promise<UpdaterSnapshot> | null = null;
let installHandoffTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveFailures = 0;
let lastLoggedPhase = '';
let lastLoggedProgressBucket = -1;

let snapshot: UpdaterSnapshot = {
  supported: false,
  unsupportedReason: 'not_packaged',
  phase: 'idle',
  currentVersion: '0.0.0',
  targetVersion: null,
  channel: 'unknown',
  packageType: 'unknown',
  progressPercent: null,
  transferredBytes: null,
  totalBytes: null,
  releaseName: '',
  releaseNotes: '',
  releaseDate: '',
  errorCode: null,
  checkedAt: null,
};

function publicSnapshot(): UpdaterSnapshot {
  return { ...snapshot };
}

function broadcast(): void {
  const progressBucket = snapshot.progressPercent == null ? -1 : Math.floor(snapshot.progressPercent / 10);
  if (snapshot.phase !== lastLoggedPhase || progressBucket !== lastLoggedProgressBucket) {
    console.log(
      `[updater] phase=${snapshot.phase} current=${snapshot.currentVersion} target=${snapshot.targetVersion ?? 'none'} progress=${snapshot.progressPercent == null ? 'none' : Math.round(snapshot.progressPercent)}`,
    );
    lastLoggedPhase = snapshot.phase;
    lastLoggedProgressBucket = progressBucket;
  }
  if (updaterWindow && !updaterWindow.isDestroyed()) {
    updaterWindow.webContents.send('updater:status', publicSnapshot());
  }
}

function updateSnapshot(next: Partial<UpdaterSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  broadcast();
}

function scheduleRetry(): void {
  if (!snapshot.supported || retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void checkForUpdates();
  }, updaterRetryDelay(consecutiveFailures));
  retryTimer.unref?.();
}

function clearScheduledRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
}

function recordUpdaterError(error: unknown): void {
  consecutiveFailures += 1;
  updateSnapshot({ phase: 'error', errorCode: classifyUpdaterError(error) });
  scheduleRetry();
}

function applyUpdateInfo(info: UpdateInfo): void {
  updateSnapshot({
    targetVersion: info.version,
    releaseName: boundedUpdateText(info.releaseName, 500),
    releaseNotes: boundedUpdateText(info.releaseNotes),
    releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : '',
  });
}

async function checkForUpdates(): Promise<UpdaterSnapshot> {
  if (!snapshot.supported) return publicSnapshot();
  if (
    downloadInFlight
    || snapshot.phase === 'downloading'
    || snapshot.phase === 'downloaded'
    || snapshot.phase === 'installing'
  ) return publicSnapshot();
  if (checkInFlight) return checkInFlight;
  checkInFlight = (async () => {
    updateSnapshot({ phase: 'checking', errorCode: null, checkedAt: new Date().toISOString() });
    try {
      await autoUpdater.checkForUpdates();
      consecutiveFailures = 0;
      clearScheduledRetry();
    } catch (error) {
      // electron-updater also emits `error`; do not double-count one failed
      // request and accidentally jump two retry-backoff levels.
      if (snapshot.phase !== 'error') recordUpdaterError(error);
    } finally {
      checkInFlight = null;
    }
    return publicSnapshot();
  })();
  return checkInFlight;
}

async function retryDownload(): Promise<UpdaterSnapshot> {
  if (downloadInFlight) return downloadInFlight;
  if (
    !snapshot.supported
    || !snapshot.targetVersion
    || snapshot.phase === 'downloading'
    || snapshot.phase === 'downloaded'
  ) {
    return publicSnapshot();
  }
  downloadInFlight = (async () => {
    try {
      updateSnapshot({ phase: 'downloading', errorCode: null });
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (snapshot.phase !== 'error') recordUpdaterError(error);
    } finally {
      downloadInFlight = null;
    }
    return publicSnapshot();
  })();
  return downloadInFlight;
}

async function installDownloadedUpdate(): Promise<UpdaterInstallResult> {
  if (!snapshot.supported || snapshot.phase !== 'downloaded') {
    return { ok: false, errorCode: 'internal' };
  }
  let blockers: Array<'chat' | 'bridge' | 'task'>;
  try {
    blockers = await getActiveWork();
  } catch {
    updateSnapshot({ errorCode: 'activity_unavailable' });
    return { ok: false, errorCode: 'activity_unavailable' };
  }
  if (blockers.length > 0) {
    updateSnapshot({ errorCode: 'active_work' });
    return { ok: false, errorCode: 'active_work', blockers };
  }
  updateSnapshot({ phase: 'installing', errorCode: null });
  onInstallLifecycleChange(true);
  if (installHandoffTimer) clearTimeout(installHandoffTimer);
  installHandoffTimer = setTimeout(() => {
    installHandoffTimer = null;
    // If Electron is still alive, quitAndInstall did not complete its handoff.
    // Restore the resident lifecycle and keep the downloaded package retryable.
    onInstallLifecycleChange(false);
    updateSnapshot({ phase: 'downloaded', errorCode: 'install_failed' });
  }, INSTALL_HANDOFF_TIMEOUT_MS);
  installHandoffTimer.unref?.();
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch {
    if (installHandoffTimer) clearTimeout(installHandoffTimer);
    installHandoffTimer = null;
    onInstallLifecycleChange(false);
    updateSnapshot({ phase: 'downloaded', errorCode: 'install_failed' });
    return { ok: false, errorCode: 'install_failed' };
  }
}

function registerIpc(): void {
  ipcMain.handle('updater:get-status', (event) => (
    trustedSender(event) ? publicSnapshot() : null
  ));
  ipcMain.handle('updater:check', (event) => (
    trustedSender(event) ? checkForUpdates() : publicSnapshot()
  ));
  ipcMain.handle('updater:download', (event) => (
    trustedSender(event) ? retryDownload() : publicSnapshot()
  ));
  ipcMain.handle('updater:install', (event) => (
    trustedSender(event) ? installDownloadedUpdate() : { ok: false, errorCode: 'internal' }
  ));
}

function registerUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => updateSnapshot({ phase: 'checking', errorCode: null }));
  autoUpdater.on('update-available', (info) => {
    applyUpdateInfo(info);
    updateSnapshot({ phase: 'available', errorCode: null });
  });
  autoUpdater.on('update-not-available', () => {
    consecutiveFailures = 0;
    clearScheduledRetry();
    updateSnapshot({
      phase: 'idle',
      targetVersion: null,
      progressPercent: null,
      transferredBytes: null,
      totalBytes: null,
      releaseName: '',
      releaseNotes: '',
      releaseDate: '',
      errorCode: null,
    });
  });
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    updateSnapshot({
      phase: 'downloading',
      progressPercent: Math.max(0, Math.min(100, progress.percent)),
      transferredBytes: Number.isFinite(progress.transferred) ? progress.transferred : null,
      totalBytes: Number.isFinite(progress.total) ? progress.total : null,
      errorCode: null,
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    applyUpdateInfo(info);
    consecutiveFailures = 0;
    clearScheduledRetry();
    updateSnapshot({ phase: 'downloaded', progressPercent: 100, errorCode: null });
  });
  autoUpdater.on('error', (error) => {
    if (snapshot.phase === 'installing') {
      if (installHandoffTimer) clearTimeout(installHandoffTimer);
      installHandoffTimer = null;
      onInstallLifecycleChange(false);
      updateSnapshot({ phase: 'downloaded', errorCode: 'install_failed' });
      return;
    }
    recordUpdaterError(error);
  });
}

export function initAutoUpdater(options: AutoUpdaterOptions): UpdaterSnapshot {
  updaterWindow = options.win;
  if (initialized) {
    broadcast();
    return publicSnapshot();
  }
  initialized = true;
  trustedSender = options.isTrustedSender;
  getActiveWork = options.getActiveWork;
  onInstallLifecycleChange = options.onInstallLifecycleChange;
  const support = resolveUpdaterSupport({
    isPackaged: options.isPackaged,
    officialBuild: options.officialBuild,
    channel: options.channel,
    platform: options.platform,
    appImagePath: options.appImagePath,
  });
  snapshot = {
    ...snapshot,
    ...support,
    currentVersion: options.currentVersion,
    channel: options.channel,
  };
  registerIpc();
  if (!snapshot.supported) {
    broadcast();
    return publicSnapshot();
  }

  autoUpdater.logger = null;
  const feedChannel = resolveUpdaterFeedChannel(options.channel);
  if (!feedChannel) {
    updateSnapshot({ supported: false, unsupportedReason: 'channel_not_stable' });
    return publicSnapshot();
  }
  // Main owns this mapping. `latest` reads latest[-mac].yml; `preview` reads
  // preview[-mac].yml from semver preview GitHub prereleases.
  autoUpdater.channel = feedChannel;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = options.channel === 'preview';
  // Setting AppUpdater.channel toggles this to true internally; restore the
  // fail-closed policy after channel selection.
  autoUpdater.allowDowngrade = false;
  autoUpdater.fullChangelog = false;
  registerUpdaterEvents();

  startupTimer = setTimeout(() => void checkForUpdates(), updaterInitialDelay(Math.random()));
  startupTimer.unref?.();
  periodicTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  periodicTimer.unref?.();
  broadcast();
  return publicSnapshot();
}

export function setUpdaterWindow(win: BrowserWindow): void {
  updaterWindow = win;
  if (initialized) broadcast();
}

export function disposeAutoUpdaterTimers(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (periodicTimer) clearInterval(periodicTimer);
  if (retryTimer) clearTimeout(retryTimer);
  if (installHandoffTimer) clearTimeout(installHandoffTimer);
  startupTimer = null;
  periodicTimer = null;
  retryTimer = null;
  installHandoffTimer = null;
}
