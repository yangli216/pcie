import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  incrementStableVersion,
  readProjectVersionState,
  replaceCargoPackageVersion,
  resolveTargetVersion,
} from './release-version.mjs';
import { runCandidateBuild } from './test-release.mjs';

function createProject(version = '1.4.3') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-candidate-'));
  fs.mkdirSync(path.join(rootDir, 'src-tauri'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'package.json'), `${JSON.stringify({ name: 'pcie', version }, null, 2)}\n`);
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'tauri.conf.json'),
    `${JSON.stringify({ productName: 'PCIE', version }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(rootDir, 'src-tauri', 'Cargo.toml'),
    `[package]\nname = "pcie"\nversion = "${version}"\n\n[dependencies]\nserde = "1"\n`,
  );
  fs.writeFileSync(path.join(rootDir, 'src-tauri', 'Cargo.lock'), `pcie ${version}\n`);
  return rootDir;
}

test('increments stable candidate versions without prerelease tags', () => {
  assert.equal(incrementStableVersion('1.4.3', 'patch'), '1.4.4');
  assert.equal(incrementStableVersion('1.4.3', 'minor'), '1.5.0');
  assert.equal(incrementStableVersion('1.4.3', 'major'), '2.0.0');
  assert.equal(resolveTargetVersion('1.4.3', { explicitVersion: '1.4.5' }), '1.4.5');
  assert.throws(() => resolveTargetVersion('1.4.3', { explicitVersion: '1.4.3' }), /must be newer/);
  assert.throws(() => resolveTargetVersion('1.4.3', { explicitVersion: '1.4.4-rc.1' }), /stable X\.Y\.Z/);
});

test('only replaces Cargo package version', () => {
  const source = '[package]\nversion = "1.4.3"\n\n[dependencies]\nexample = { version = "9.9.9" }\n';
  const updated = replaceCargoPackageVersion(source, '1.4.4');
  assert.match(updated, /\[package\]\nversion = "1\.4\.4"/);
  assert.match(updated, /example = \{ version = "9\.9\.9" \}/);
});

test('candidate build exposes target versions during build and restores every version file', () => {
  const rootDir = createProject();
  const before = readProjectVersionState(rootDir);

  const result = runCandidateBuild({
    rootDir,
    explicitVersion: '1.4.4',
    buildArgs: ['--target', 'example-target'],
    createUpdaterArtifacts: false,
    logger: { log: () => undefined },
    runner: ({ buildArgs }) => {
      const during = readProjectVersionState(rootDir);
      assert.deepEqual(during.versions, {
        packageJson: '1.4.4',
        tauriConfig: '1.4.4',
        cargo: '1.4.4',
      });
      assert.equal(during.parsed.tauriConfig.bundle.createUpdaterArtifacts, false);
      assert.deepEqual(buildArgs, ['--target', 'example-target']);
      fs.writeFileSync(path.join(rootDir, 'src-tauri', 'Cargo.lock'), 'pcie 1.4.4\n');
    },
  });

  assert.equal(result.targetVersion, '1.4.4');
  assert.deepEqual(readProjectVersionState(rootDir).contents, before.contents);
});

test('Win7 candidate build injects an MSI-safe internal version and exposes the public version', () => {
  const rootDir = createProject('1.4.8');
  const before = readProjectVersionState(rootDir);
  const result = runCandidateBuild({
    rootDir,
    explicitVersion: '1.4.8-win7.2',
    versionPolicy: 'win7',
    createUpdaterArtifacts: false,
    logger: { log: () => undefined },
    runner: ({ targetVersion, buildVersion, versionPolicy }) => {
      assert.deepEqual(readProjectVersionState(rootDir).versions, {
        packageJson: '1.4.8-2',
        tauriConfig: '1.4.8-2',
        cargo: '1.4.8-2',
      });
      assert.equal(targetVersion, '1.4.8-win7.2');
      assert.equal(buildVersion, '1.4.8-2');
      assert.equal(versionPolicy, 'win7');
    },
  });
  assert.equal(result.targetVersion, '1.4.8-win7.2');
  assert.equal(result.buildVersion, '1.4.8-2');
  assert.deepEqual(readProjectVersionState(rootDir).contents, before.contents);
});

test('candidate build restores version files when the build fails', () => {
  const rootDir = createProject();
  const before = readProjectVersionState(rootDir);
  assert.throws(() => runCandidateBuild({
    rootDir,
    explicitVersion: '1.4.4',
    logger: { log: () => undefined },
    runner: () => {
      fs.writeFileSync(path.join(rootDir, 'src-tauri', 'Cargo.lock'), 'changed by failed build\n');
      throw new Error('simulated build failure');
    },
  }), /simulated build failure/);
  assert.deepEqual(readProjectVersionState(rootDir).contents, before.contents);
});

test('test build workflow uploads artifacts without creating a release channel', () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'test-build.yml'), 'utf8');
  const formalReleaseScript = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'release.mjs'), 'utf8');

  assert.equal(packageJson.scripts['release:test'], 'node scripts/test-release.mjs');
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /Verify candidate bundle exists/);
  assert.match(workflow, /-size \+1M/);
  assert.match(workflow, /node scripts\/test-release\.mjs --version/);
  assert.doesNotMatch(workflow, /yarn release:test --version/);
  assert.match(workflow, /published: false/);
  assert.doesNotMatch(workflow, /gh release|releaseDraft|latest\.json|git tag/);
  assert.match(formalReleaseScript, /branch !== 'main'/);
  assert.match(formalReleaseScript, /status', '--porcelain/);
  assert.match(formalReleaseScript, /release-preflight\.mjs/);
});
