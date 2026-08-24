#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
const expectedCount = Number.parseInt(process.argv[3] || '', 10);
const keyPath = process.env.APPLE_API_KEY || '';
const keyId = process.env.APPLE_API_KEY_ID || '';
const issuer = process.env.APPLE_API_ISSUER || '';
if (!releaseRoot || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
  throw new Error('Usage: node scripts/notarize-macos-dmgs.mjs <release-root> <expected-count>');
}
if (!keyPath || !keyId || !issuer) {
  throw new Error('Apple notarization API key environment is incomplete');
}

function run(args, timeout) {
  const result = spawnSync('/usr/bin/xcrun', args, {
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'Apple notarization command failed').trim());
  }
}

const dmgs = fs.readdirSync(releaseRoot)
  .filter((name) => /^CodePilot-.*\.dmg$/.test(name))
  .map((name) => path.join(releaseRoot, name))
  .sort();
if (dmgs.length !== expectedCount) {
  throw new Error(`Expected ${expectedCount} DMG files, found ${dmgs.length}`);
}

for (const dmg of dmgs) {
  run([
    'notarytool', 'submit', dmg,
    '--key', keyPath,
    '--key-id', keyId,
    '--issuer', issuer,
    '--wait',
  ], 20 * 60 * 1000);
  run(['stapler', 'staple', '-v', dmg], 2 * 60 * 1000);
  console.log(`Notarized and stapled DMG: ${path.basename(dmg)}`);
}
