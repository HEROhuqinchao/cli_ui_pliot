import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const repoRoot = path.resolve(__dirname, '../../..');
const assetVerifier = path.join(repoRoot, 'scripts/verify-update-assets.mjs');

function read(relative: string): string {
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function sha512(file: string): string {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
}

function writeFile(root: string, name: string, body = `fixture:${name}`): string {
  const target = path.join(root, name);
  fs.writeFileSync(target, body);
  return target;
}

function writeMetadata(root: string, name: string, version: string, assetName: string): void {
  const asset = path.join(root, assetName);
  const item: Record<string, string | number> = {
    url: assetName,
    sha512: sha512(asset),
    size: fs.statSync(asset).size,
  };
  if (/\.(zip|exe)$/i.test(assetName)) {
    item.blockMapSize = fs.statSync(`${asset}.blockmap`).size;
  } else if (/\.AppImage$/i.test(assetName)) {
    item.blockMapSize = 64;
  }
  fs.writeFileSync(path.join(root, name), JSON.stringify({ version, files: [item] }, null, 2));
}

function makeStableFixture(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-stable-assets-'));
  for (const arch of ['arm64', 'x64', 'universal']) {
    writeFile(root, `CodePilot-${version}-${arch}.dmg`);
    const zip = writeFile(root, `CodePilot-${version}-${arch}.zip`);
    writeFile(root, `${path.basename(zip)}.blockmap`);
  }
  const windows = writeFile(root, `CodePilot.Setup.${version}.exe`);
  writeFile(root, `${path.basename(windows)}.blockmap`);
  for (const name of [
    `CodePilot-${version}-x86_64.AppImage`,
    `CodePilot-${version}-arm64.AppImage`,
    `CodePilot-${version}-amd64.deb`,
    `CodePilot-${version}-arm64.deb`,
    `CodePilot-${version}-x86_64.rpm`,
    `CodePilot-${version}-aarch64.rpm`,
  ]) writeFile(root, name);

  writeMetadata(root, 'latest-mac.yml', version, `CodePilot-${version}-universal.zip`);
  writeMetadata(root, 'latest.yml', version, `CodePilot.Setup.${version}.exe`);
  writeMetadata(root, 'latest-linux.yml', version, `CodePilot-${version}-x86_64.AppImage`);
  writeMetadata(root, 'latest-linux-arm64.yml', version, `CodePilot-${version}-arm64.AppImage`);

  const checksumNames = fs.readdirSync(root).sort();
  fs.writeFileSync(
    path.join(root, 'checksums-fixture.sha256'),
    checksumNames.map((name) => `fixture  ${name}`).join('\n'),
  );
  return root;
}

function makePreviewFixture(version: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-preview-assets-'));
  for (const arch of ['arm64', 'x64', 'universal']) {
    writeFile(root, `CodePilot-${version}-${arch}.dmg`);
    const zip = writeFile(root, `CodePilot-${version}-${arch}.zip`);
    writeFile(root, `${path.basename(zip)}.blockmap`);
  }
  const windows = writeFile(root, `CodePilot.Setup.${version}.exe`);
  writeFile(root, `${path.basename(windows)}.blockmap`);
  writeMetadata(root, 'preview-mac.yml', version, `CodePilot-${version}-universal.zip`);
  writeMetadata(root, 'preview.yml', version, `CodePilot.Setup.${version}.exe`);
  fs.writeFileSync(
    path.join(root, 'checksums-preview.sha256'),
    fs.readdirSync(root).sort().map((name) => `fixture  ${name}`).join('\n'),
  );
  return root;
}

describe('release signing and update asset contracts', () => {
  it('pins signing, notarization, channel separation and immutable release assets in CI', () => {
    const builder = read('electron-builder.yml');
    const stable = read('.github/workflows/build.yml');
    const previewBuild = read('.github/workflows/preview-build.yml');
    const previewRelease = read('.github/workflows/preview-release.yml');
    const packageJson = JSON.parse(read('package.json'));

    assert.match(builder, /mac:[\s\S]*?notarize:\s*true/);
    assert.match(builder, /dmg:[\s\S]*?writeUpdateInfo:\s*false/);
    assert.match(builder, /win:[\s\S]*?forceCodeSigning:\s*true/);
    assert.match(builder, /verifyUpdateCodeSignature:\s*true/);
    assert.match(builder, /rfc3161TimeStampServer:/);
    assert.equal(packageJson.dependencies['electron-updater'], '6.8.3');
    assert.equal(packageJson.devDependencies['electron-builder'], '26.8.1');

    for (const workflow of [stable, previewBuild, previewRelease]) {
      assert.match(workflow, /APPLE_NOTARIZATION_KEY_BASE64/);
      assert.match(workflow, /verify-macos-notarization\.mjs/);
      assert.match(workflow, /WINDOWS_CERT_PFX_BASE64/);
      assert.match(workflow, /WINDOWS_PUBLISHER_SUBJECT/);
      assert.match(workflow, /verify-windows-signing\.ps1/);
      assert.doesNotMatch(workflow, /WIN_CSC_KEY_PASSWORD=.*GITHUB_ENV/);
      assert.match(workflow, /WIN_CSC_KEY_PASSWORD:\s*\$\{\{ secrets\.WINDOWS_CERT_PASSWORD \}\}/);
    }

    for (const expected of [
      'release/latest-mac.yml',
      'release/latest.yml',
      'release/latest-linux*.yml',
      'release/CodePilot-*.blockmap',
      'release/CodePilot.Setup.*.exe.blockmap',
    ]) assert.ok(stable.includes(expected), `stable artifact allow-list must contain ${expected}`);
    assert.match(stable, /verify-update-assets\.mjs artifacts "\$VERSION"/);
    assert.match(stable, /-name "\*\.blockmap"/);
    assert.match(stable, /-name "latest\*\.yml"/);
    assert.match(stable, /uses:\s*actions\/attest@v4/);
    assert.match(stable, /artifacts\/CodePilot\.Setup\.\*/);
    assert.match(stable, /artifact-metadata:\s*write/);
    assert.match(stable, /runs-on:\s*macos-15-intel/);
    assert.match(stable, /CodePilot-\*-universal\.zip/);

    for (const preview of [previewBuild, previewRelease]) {
      assert.match(preview, /-c\.publish\.channel=preview/);
      assert.match(preview, /release\/preview-mac\.yml/);
      assert.match(preview, /release\/preview\.yml/);
      assert.doesNotMatch(preview, /release\/latest(?:-mac)?\.yml/);
      assert.match(preview, /--mac --arm64 --x64/);
      assert.match(preview, /--mac --universal/);
      assert.match(preview, /release\/CodePilot-\*\.dmg/);
      assert.match(preview, /release\/CodePilot-\*\.zip/);
    }
    assert.match(previewRelease, /artifacts\/CodePilot\.Setup\.\*/);
    assert.match(previewRelease, /tags:\s*\n\s*- "\*-preview\.\*"/);
    assert.match(previewRelease, /VERSION="\$GITHUB_REF_NAME"/);
    assert.doesNotMatch(previewRelease, /GITHUB_REF_NAME#preview-/);
    assert.match(previewRelease, /artifact-metadata:\s*write/);

    const windowsVerifier = read('scripts/verify-windows-signing.ps1');
    assert.match(windowsVerifier, /CodePilot\.Setup\.\*\.exe/);
    assert.match(windowsVerifier, /win-unpacked'\) 'CodePilot\.exe'/);
    assert.doesNotMatch(windowsVerifier, /-Recurse/);
    assert.doesNotMatch(windowsVerifier, /-Filter '\*\.exe'/);
  });

  it('accepts a complete stable graph and rejects missing blockmaps or a metadata hash mismatch', () => {
    const version = '1.2.3';
    const fixture = makeStableFixture(version);
    try {
      const valid = spawnSync(process.execPath, [assetVerifier, fixture, version], { encoding: 'utf8' });
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /channel=stable/);

      const zipBlockmap = path.join(fixture, `CodePilot-${version}-universal.zip.blockmap`);
      fs.unlinkSync(zipBlockmap);
      const missing = spawnSync(process.execPath, [assetVerifier, fixture, version], { encoding: 'utf8' });
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /blockmap/i);
      writeFile(fixture, path.basename(zipBlockmap));

      const metadataPath = path.join(fixture, 'latest-mac.yml');
      const metadataWithDmg = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      const dmgName = `CodePilot-${version}-universal.dmg`;
      metadataWithDmg.files.push({
        url: dmgName,
        sha512: sha512(path.join(fixture, dmgName)),
        size: fs.statSync(path.join(fixture, dmgName)).size,
      });
      fs.writeFileSync(metadataPath, JSON.stringify(metadataWithDmg));
      const staleDmgGraph = spawnSync(process.execPath, [assetVerifier, fixture, version], { encoding: 'utf8' });
      assert.notEqual(staleDmgGraph.status, 0);
      assert.match(staleDmgGraph.stderr, /ZIP entries only/);

      const metadata = metadataWithDmg;
      metadata.files = metadata.files.filter((item: { url: string }) => item.url !== dmgName);
      metadata.files[0].sha512 = 'wrong';
      fs.writeFileSync(metadataPath, JSON.stringify(metadata));
      const invalid = spawnSync(process.execPath, [assetVerifier, fixture, version], { encoding: 'utf8' });
      assert.notEqual(invalid.status, 0);
      assert.match(invalid.stderr, /sha512 mismatch/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('requires preview to carry Intel bootstrap assets and one universal updater feed', () => {
    const version = '1.2.4-preview.1';
    const fixture = makePreviewFixture(version);
    try {
      const valid = spawnSync(process.execPath, [assetVerifier, fixture, version, 'preview'], { encoding: 'utf8' });
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /channel=preview/);

      fs.unlinkSync(path.join(fixture, `CodePilot-${version}-x64.dmg`));
      const missingIntel = spawnSync(
        process.execPath,
        [assetVerifier, fixture, version, 'preview'],
        { encoding: 'utf8' },
      );
      assert.notEqual(missingIntel.status, 0);
      assert.match(missingIntel.stderr, /preview macOS DMG assets/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
