import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readWin7Configuration, validateWin7Configuration } from './validate-win7-build.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('accepts the repository Win7 validation build configuration', () => {
  const result = validateWin7Configuration(readWin7Configuration(rootDir));
  assert.equal(result.target, 'x86_64-win7-windows-msvc');
  assert.equal(result.webView2, '109');
  assert.deepEqual(result.releaseChannels, ['win7-testing', 'win7-production']);
});

test('rejects reuse of the formal Windows installer identity', () => {
  const configuration = readWin7Configuration(rootDir);
  configuration.win7Config.bundle.windows.wix.upgradeCode =
    configuration.windowsConfig.bundle.windows.wix.upgradeCode;
  assert.throws(() => validateWin7Configuration(configuration), /isolated from the formal MSI/);
});

test('rejects inheritance of the formal Windows migration template', () => {
  const configuration = readWin7Configuration(rootDir);
  configuration.win7Config.bundle.windows.wix.template = './windows/wix/main.wxs';
  assert.throws(() => validateWin7Configuration(configuration), /remove the formal migration template/);
});

test('rejects a formal release action in the Win7 workflow', () => {
  const configuration = readWin7Configuration(rootDir);
  configuration.workflow += '\nuses: tauri-apps/tauri-action@v0\n';
  assert.throws(() => validateWin7Configuration(configuration), /formal-release marker/);
});

test('rejects a Win7 release workflow without its dedicated production channel', () => {
  const configuration = readWin7Configuration(rootDir);
  configuration.releaseWorkflow = configuration.releaseWorkflow.replaceAll('win7-production', 'production');
  assert.throws(() => validateWin7Configuration(configuration), /win7-production/);
});

test('rejects a Win7 release workflow that probes the intranet server', () => {
  const configuration = readWin7Configuration(rootDir);
  configuration.releaseWorkflow += '\nInvoke-WebRequest http://intranet/latest.json\n';
  assert.throws(() => validateWin7Configuration(configuration), /Invoke-WebRequest/);
});

test('rejects missing installed binary gates in either Win7 workflow', () => {
  for (const key of ['workflow', 'releaseWorkflow']) {
    const configuration = readWin7Configuration(rootDir);
    configuration[key] = configuration[key].replace('validate-win7-installer.ps1', 'skip-native-check.ps1');
    assert.throws(() => validateWin7Configuration(configuration), /validate installed PE imports/);
  }
});
