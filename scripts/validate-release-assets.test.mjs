import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateReleaseAssets } from './validate-release-assets.mjs';

function fixtureSignature(artifactName, keyId) {
  const signatureBytes = Buffer.alloc(74);
  signatureBytes.write('ED', 0, 'ascii');
  keyId.copy(signatureBytes, 2);
  const text = [
    'untrusted comment: signature from tauri secret key',
    signatureBytes.toString('base64'),
    `trusted comment: timestamp:1\tfile:${artifactName}`,
    Buffer.alloc(64).toString('base64'),
    '',
  ].join('\n');
  return Buffer.from(text).toString('base64');
}

function fixturePublicKey(keyId) {
  const keyBytes = Buffer.alloc(42);
  keyBytes.write('Ed', 0, 'ascii');
  keyId.copy(keyBytes, 2);
  const text = `untrusted comment: minisign public key\n${keyBytes.toString('base64')}\n`;
  return Buffer.from(text).toString('base64');
}

function createFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-release-assets-test-'));
  const artifactName = 'PCIE_1.4.0_x64_zh-CN.msi';
  const keyId = Buffer.from('12345678');
  const signature = fixtureSignature(artifactName, keyId);
  fs.writeFileSync(path.join(dir, artifactName), 'installer');
  fs.writeFileSync(path.join(dir, `${artifactName}.sig`), signature);
  fs.writeFileSync(
    path.join(dir, 'latest.json'),
    JSON.stringify({
      version: '1.4.0',
      platforms: {
        'windows-x86_64': {
          url: `https://github.com/yangli216/pcie/releases/download/v1.4.0/${artifactName}`,
          signature,
        },
      },
    }),
  );
  return { dir, artifactName, publicKey: fixturePublicKey(keyId) };
}

test('accepts a same-batch artifact, signature asset and latest.json entry', (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const result = validateReleaseAssets({
    assetsDir: fixture.dir,
    tag: 'v1.4.0',
    publicKey: fixture.publicKey,
    requiredTargets: ['windows-x86_64'],
  });
  assert.deepEqual(result.artifacts, [fixture.artifactName]);
});

test('rejects latest.json when its signature comes from another build', (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const latestPath = path.join(fixture.dir, 'latest.json');
  const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  latest.platforms['windows-x86_64'].signature = 'different-signature';
  fs.writeFileSync(latestPath, JSON.stringify(latest));
  assert.throws(
    () =>
      validateReleaseAssets({
        assetsDir: fixture.dir,
        tag: 'v1.4.0',
        publicKey: fixture.publicKey,
        requiredTargets: ['windows-x86_64'],
      }),
    /does not match/,
  );
});

test('accepts the nested PCIE Server upload bundle layout', (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const channelDir = path.join(fixture.dir, 'production');
  const versionDir = path.join(channelDir, 'v1.4.0');
  fs.mkdirSync(versionDir, { recursive: true });
  fs.renameSync(path.join(fixture.dir, fixture.artifactName), path.join(versionDir, fixture.artifactName));
  fs.renameSync(path.join(fixture.dir, `${fixture.artifactName}.sig`), path.join(versionDir, `${fixture.artifactName}.sig`));
  const latest = JSON.parse(fs.readFileSync(path.join(fixture.dir, 'latest.json'), 'utf8'));
  latest.platforms['windows-x86_64'].url = `http://intra.example.com/pcie/production/v1.4.0/${fixture.artifactName}`;
  fs.writeFileSync(path.join(channelDir, 'latest.json'), JSON.stringify(latest));
  fs.rmSync(path.join(fixture.dir, 'latest.json'));

  const result = validateReleaseAssets({
    assetsDir: fixture.dir,
    tag: 'v1.4.0',
    publicKey: fixture.publicKey,
    requiredTargets: ['windows-x86_64'],
  });
  assert.deepEqual(result.artifacts, [fixture.artifactName]);
});

test('selects the versioned updater when direct-install contains the same MSI name', (context) => {
  const fixture = createFixture();
  context.after(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));
  const channelDir = path.join(fixture.dir, 'win7-testing');
  const versionDir = path.join(channelDir, 'v1.4.0-win7');
  const directInstallDir = path.join(fixture.dir, 'direct-install');
  fs.mkdirSync(versionDir, { recursive: true });
  fs.mkdirSync(directInstallDir, { recursive: true });
  fs.renameSync(path.join(fixture.dir, fixture.artifactName), path.join(versionDir, fixture.artifactName));
  fs.renameSync(path.join(fixture.dir, `${fixture.artifactName}.sig`), path.join(versionDir, `${fixture.artifactName}.sig`));
  fs.writeFileSync(path.join(directInstallDir, fixture.artifactName), 'direct-installer');

  const latest = JSON.parse(fs.readFileSync(path.join(fixture.dir, 'latest.json'), 'utf8'));
  latest.version = '1.4.0-win7';
  latest.platforms['windows-x86_64'].url =
    `http://intra.example.com/v1/client/releases/win7-testing/files/windows-x86_64/v1.4.0-win7/${fixture.artifactName}`;
  fs.writeFileSync(path.join(channelDir, 'latest.json'), JSON.stringify(latest));
  fs.rmSync(path.join(fixture.dir, 'latest.json'));

  const result = validateReleaseAssets({
    assetsDir: fixture.dir,
    tag: 'v1.4.0-win7',
    publicKey: fixture.publicKey,
    requiredTargets: ['windows-x86_64'],
  });
  assert.deepEqual(result.artifacts, [fixture.artifactName]);
});
