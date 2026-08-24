#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const root = process.argv[2] ? path.resolve(process.argv[2]) : '';
const expectedVersion = process.argv[3] || '';
const channel = process.argv[4] || 'stable';
if (!root || !expectedVersion) {
  throw new Error('Usage: node scripts/verify-update-assets.mjs <artifact-root> <version> [stable|preview]');
}
if (!['stable', 'preview'].includes(channel)) throw new Error(`Unsupported update channel: ${channel}`);

function walk(directory) {
  const files = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile()) files.push(absolute);
    }
  }
  return files;
}

const allFiles = walk(root);
const byBasename = new Map();
for (const file of allFiles) {
  const name = path.basename(file);
  const current = byBasename.get(name) ?? [];
  current.push(file);
  byBasename.set(name, current);
}

function one(name) {
  const matches = byBasename.get(name) ?? [];
  if (matches.length !== 1) throw new Error(`Expected exactly one ${name}, found ${matches.length}`);
  return matches[0];
}

function sha512Base64(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function matching(pattern) {
  return [...byBasename.keys()].filter((name) => pattern.test(name)).sort();
}

function requireCount(label, pattern, count) {
  const matches = matching(pattern);
  if (matches.length !== count) throw new Error(`Expected ${count} ${label}, found ${matches.length}`);
  return matches;
}

const escapedVersion = expectedVersion.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
if (channel === 'stable') {
  const macDmgNames = requireCount(
    'macOS DMG assets',
    new RegExp(`^CodePilot-${escapedVersion}-(?:arm64|x64|universal)\\.dmg$`),
    3,
  );
  void macDmgNames;
  const macZipNames = requireCount(
    'macOS ZIP assets',
    new RegExp(`^CodePilot-${escapedVersion}-(?:arm64|x64|universal)\\.zip$`),
    3,
  );
  for (const zipName of macZipNames) one(`${zipName}.blockmap`);
  requireCount('Windows NSIS installer', new RegExp(`^CodePilot\\.Setup\\.${escapedVersion}\\.exe$`), 1);
  for (const extension of ['AppImage', 'deb', 'rpm']) {
    const linuxAssets = requireCount(
      `Linux ${extension} assets`,
      new RegExp(`^CodePilot-${escapedVersion}-.+\\.${extension}$`, 'i'),
      2,
    );
    if (!linuxAssets.some((name) => /(?:arm64|aarch64)/i.test(name))) {
      throw new Error(`Linux ${extension} assets are missing arm64/aarch64`);
    }
  }
} else {
  const previewDmgs = requireCount(
    'preview macOS DMG assets',
    new RegExp(`^CodePilot-${escapedVersion}-(?:arm64|x64|universal)\\.dmg$`),
    3,
  );
  void previewDmgs;
  const previewZips = requireCount(
    'preview macOS ZIP assets',
    new RegExp(`^CodePilot-${escapedVersion}-(?:arm64|x64|universal)\\.zip$`),
    3,
  );
  for (const zipName of previewZips) one(`${zipName}.blockmap`);
  requireCount('preview Windows NSIS installer', new RegExp(`^CodePilot\\.Setup\\.${escapedVersion}\\.exe$`), 1);
}

const metadataNames = channel === 'stable'
  ? ['latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']
  : ['preview.yml', 'preview-mac.yml'];
for (const metadataName of metadataNames) {
  const metadataPath = one(metadataName);
  const raw = fs.readFileSync(metadataPath, 'utf8');
  if (/^stagingPercentage\s*:/m.test(raw)) {
    throw new Error(`${metadataName} must not use stagingPercentage`);
  }
  const document = yaml.load(raw);
  if (!document || typeof document !== 'object') throw new Error(`${metadataName} is not YAML mapping`);
  if (String(document.version) !== expectedVersion) {
    throw new Error(`${metadataName} version ${document.version} != ${expectedVersion}`);
  }
  if (!Array.isArray(document.files) || document.files.length < 1) {
    throw new Error(`${metadataName} has no files`);
  }
  for (const item of document.files) {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string' || typeof item.sha512 !== 'string') {
      throw new Error(`${metadataName} has malformed file entry`);
    }
    const assetName = path.basename(item.url);
    const assetPath = one(assetName);
    if (sha512Base64(assetPath) !== item.sha512) {
      throw new Error(`${metadataName} sha512 mismatch for ${assetName}`);
    }
    if (Number.isFinite(item.size) && fs.statSync(assetPath).size !== item.size) {
      throw new Error(`${metadataName} size mismatch for ${assetName}`);
    }
    if (/\.(zip|exe)$/i.test(assetName)) {
      const blockmapPath = one(`${assetName}.blockmap`);
      if (Number.isFinite(item.blockMapSize) && fs.statSync(blockmapPath).size !== item.blockMapSize) {
        throw new Error(`${metadataName} blockMapSize mismatch for ${assetName}`);
      }
    }
    if (/\.AppImage$/i.test(assetName) && !(Number(item.blockMapSize) > 0)) {
      throw new Error(`${metadataName} must describe the embedded AppImage blockmap`);
    }
  }
}

const macMetadataName = channel === 'stable' ? 'latest-mac.yml' : 'preview-mac.yml';
const macMetadata = yaml.load(fs.readFileSync(one(macMetadataName), 'utf8'));
if (!macMetadata.files.every((item) => /\.zip$/i.test(String(item.url)))) {
  throw new Error(`${macMetadataName} must contain ZIP entries only; stapled DMGs are manual assets`);
}
if (!macMetadata.files.some((item) => /-universal\.zip$/i.test(String(item.url)))) {
  throw new Error(`${macMetadataName} must target the universal ZIP so arm64 and x64 share one trusted feed`);
}
const windowsMetadataName = channel === 'stable' ? 'latest.yml' : 'preview.yml';
const windowsMetadata = yaml.load(fs.readFileSync(one(windowsMetadataName), 'utf8'));
if (!windowsMetadata.files.every((item) => /CodePilot\.Setup\..*\.exe$/i.test(String(item.url)))) {
  throw new Error(`${windowsMetadataName} must target the full NSIS installer`);
}

const checksumText = allFiles
  .filter((file) => /^checksums-.*\.sha256$/.test(path.basename(file)))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
for (const name of metadataNames) {
  if (!checksumText.includes(name)) throw new Error(`${name} missing from platform checksums`);
}
for (const [name] of byBasename) {
  if ((/\.blockmap$/i.test(name) || /\.(dmg|zip|exe|AppImage|deb|rpm)$/i.test(name)) && !checksumText.includes(name)) {
    throw new Error(`${name} missing from platform checksums`);
  }
}

console.log(`Update asset graph OK: channel=${channel} version=${expectedVersion} metadata=${metadataNames.length}`);
