#!/usr/bin/env node

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { resolveMacosSigningMode } = require('./macos-signing-policy.cjs');

function usage() {
  return 'Usage: node scripts/verify-macos-developer-id.mjs <release-root> <expected-app-count>';
}

function findApps(root, maxDepth = 4) {
  const apps = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > maxDepth) continue;
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(current.directory, entry.name);
      if (entry.name === 'CodePilot.app') {
        apps.push(absolute);
      } else {
        pending.push({ directory: absolute, depth: current.depth + 1 });
      }
    }
  }
  return apps.sort();
}

function runCodesign(args) {
  const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'codesign failed').trim());
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

const releaseRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
const expectedCount = Number.parseInt(process.argv[3] || '', 10);
const expectedTeamId = process.env.CODEPILOT_APPLE_TEAM_ID?.trim() || '';
if (!releaseRoot || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
  throw new Error(usage());
}
if (!expectedTeamId) {
  throw new Error('CODEPILOT_APPLE_TEAM_ID is required');
}

const apps = findApps(releaseRoot);
if (apps.length !== expectedCount) {
  throw new Error(`Expected ${expectedCount} CodePilot.app bundle(s), found ${apps.length}`);
}

for (const appPath of apps) {
  const signatureOutput = runCodesign(['-d', '--verbose=4', appPath]);
  const decision = resolveMacosSigningMode({
    signatureOutput,
    requireDeveloperId: true,
    allowAdhoc: false,
    expectedTeamId,
  });
  runCodesign(['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  console.log(
    `Developer ID signature OK: ${path.relative(releaseRoot, appPath)} team=${decision.teamId}`,
  );
}
