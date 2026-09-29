import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageWindowsInternalUpdate } from './package-windows-internal-update.mjs';

test('packages the signed MSI updater archive instead of the raw MSI', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-windows-update-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactsDir = path.join(root, 'artifacts');
  const outputDir = path.join(root, 'output');
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, 'PCIE-Win7-Legacy_1.4.6_x64_zh-CN.msi'), 'raw-msi');
  fs.writeFileSync(path.join(artifactsDir, 'PCIE-Win7-Legacy_1.4.6_x64_zh-CN.msi.zip'), 'updater-archive');
  fs.writeFileSync(path.join(artifactsDir, 'PCIE-Win7-Legacy_1.4.6_x64_zh-CN.msi.zip.sig'), 'signature');

  const result = packageWindowsInternalUpdate({
    'artifacts-dir': artifactsDir,
    'output-dir': outputDir,
    'base-url': 'http://release.local/v1/client/releases/win7-testing/files/windows-x86_64',
    version: '1.4.6',
    channel: 'win7-testing',
    platform: 'windows-x86_64',
  });

  assert.equal(result.installerName, 'PCIE-Win7-Legacy_1.4.6_x64_zh-CN.msi.zip');
  const latest = JSON.parse(fs.readFileSync(path.join(result.channelDir, 'latest.json'), 'utf8'));
  assert.match(latest.platforms['windows-x86_64'].url, /\.msi\.zip$/);
  assert.equal(latest.platforms['windows-x86_64'].signature, 'signature');
});

test('packages a signed MSI when Tauri does not generate an updater archive', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-windows-msi-update-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const artifactsDir = path.join(root, 'artifacts');
  const outputDir = path.join(root, 'output');
  const installerName = 'PCIE-Win7-Legacy_1.4.8-0_x64_zh-CN.msi';
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(path.join(artifactsDir, installerName), 'signed-msi');
  fs.writeFileSync(path.join(artifactsDir, `${installerName}.sig`), 'signature');

  const result = packageWindowsInternalUpdate({
    'artifacts-dir': artifactsDir,
    'output-dir': outputDir,
    'base-url': 'http://release.local/v1/client/releases/win7-testing/files/windows-x86_64',
    version: '1.4.8-win7',
    channel: 'win7-testing',
    platform: 'windows-x86_64',
  });

  assert.equal(result.installerName, installerName);
  const latest = JSON.parse(fs.readFileSync(path.join(result.channelDir, 'latest.json'), 'utf8'));
  assert.match(latest.platforms['windows-x86_64'].url, /\.msi$/);
  assert.equal(latest.platforms['windows-x86_64'].signature, 'signature');
});
