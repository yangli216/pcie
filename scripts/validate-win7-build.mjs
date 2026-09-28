import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WIN7_TARGET = 'x86_64-win7-windows-msvc';
export const WIN7_REQUIRED_WEBVIEW_MAJOR = '109';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return structuredClone(patch);
  const result = target && typeof target === 'object' && !Array.isArray(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = mergePatch(result[key], value);
  }
  return result;
}

export function validateWin7Configuration({
  baseConfig,
  windowsConfig,
  win7Config,
  cargoConfig,
  cargoLauncher,
  cargoRunner,
  win7RegionRust,
  win7RegionController,
  viteConfig,
  workflow,
  releaseWorkflow,
  releaseConfigBuilder,
}) {
  assert(win7Config.productName === 'PCIE-Win7-Legacy', 'Win7 productName must identify the legacy build');
  assert(
    win7Config.identifier && win7Config.identifier !== baseConfig.identifier,
    'Win7 identifier must be explicit and isolated from the formal release',
  );
  assert(win7Config.bundle?.createUpdaterArtifacts === false, 'Win7 updater artifacts must be disabled');
  assert(win7Config.plugins?.updater?.active === false, 'Win7 updater must be inactive');
  assert(
    Array.isArray(win7Config.plugins?.updater?.endpoints) && win7Config.plugins.updater.endpoints.length === 0,
    'Win7 updater endpoints must be empty',
  );
  assert(
    win7Config.bundle?.windows?.webviewInstallMode?.type === 'skip',
    'Win7 MSI must skip WebView2 installation because runtime 109 is installed separately',
  );

  const win7UpgradeCode = win7Config.bundle?.windows?.wix?.upgradeCode;
  const formalUpgradeCode = windowsConfig.bundle?.windows?.wix?.upgradeCode;
  assert(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(win7UpgradeCode || ''), 'Win7 WiX upgradeCode must be an explicit GUID');
  assert(win7UpgradeCode !== formalUpgradeCode, 'Win7 WiX upgradeCode must be isolated from the formal MSI');
  assert(win7Config.bundle.windows.wix.template === null, 'Win7 MSI must remove the formal migration template');
  assert(win7Config.bundle.windows.wix.language === 'zh-CN', 'Win7 MSI must use the built-in zh-CN locale');

  const resolvedConfig = mergePatch(mergePatch(baseConfig, windowsConfig), win7Config);
  assert(resolvedConfig.bundle?.targets === 'msi', 'Resolved Win7 bundle target must remain MSI-only');
  assert(!('template' in resolvedConfig.bundle.windows.wix), 'Resolved Win7 MSI must not retain the formal WiX template');
  assert(resolvedConfig.bundle.windows.wix.upgradeCode === win7UpgradeCode, 'Resolved Win7 MSI must retain its isolated UpgradeCode');

  assert(/build-std\s*=\s*\[[^\]]*"std"/.test(cargoConfig), 'Cargo must build std for the Tier-3 Win7 target');
  assert(
    win7Config.build?.runner?.cmd === '../scripts/win7-cargo-runner.cmd' &&
      cargoLauncher.includes('win7-cargo-runner.mjs') &&
      cargoRunner.includes('8a97d387a3a1a52f7c501762517e294d8c94e119'),
    'Win7 flavor must pin the upstream tauri-utils ctor compatibility fix',
  );
  assert(
    win7Config.build?.features?.includes('win7-legacy') &&
      win7RegionRust.includes('SetWindowRgn') &&
      win7RegionRust.includes('BALL_MENU_REGIONS') &&
      win7RegionController.includes("prepareForGeometry: () => applyMode('full')"),
    'Win7 flavor must isolate native ball/menu region clipping and restore full region before geometry changes',
  );
  assert(viteConfig.includes('PCIE_WIN7_BUILD') && viteConfig.includes('chrome109'), 'Vite must explicitly target WebView2/Chrome 109 for Win7');
  assert(workflow.includes('workflow_dispatch:'), 'Win7 workflow must be manual-only');
  assert(workflow.includes(WIN7_TARGET), `Win7 workflow must build ${WIN7_TARGET}`);
  assert(workflow.includes("WIN7_REQUIRED_WEBVIEW2_MAJOR: '109'"), 'Win7 workflow must record external WebView2 109');
  assert(
    workflow.includes('VITE_PCIE_BUILD_FLAVOR: win7') && workflow.includes('VITE_UPDATE_ENVIRONMENT: testing'),
    'Win7 validation builds must identify themselves with the isolated testing channel',
  );
  assert(/WIN7_RUST_TOOLCHAIN:\s*nightly-\d{4}-\d{2}-\d{2}/.test(workflow), 'Win7 workflow must pin a dated nightly toolchain');
  assert(
    workflow.includes('hiddenRustupPath') && workflow.includes('finally {'),
    'Win7 workflow must bypass and restore the Tauri rustup-only target check',
  );
  assert(workflow.includes('actions/upload-artifact@'), 'Win7 workflow must upload an Actions Artifact');
  assert(workflow.includes('test-release.mjs --win7'), 'Win7 validation workflow must use the isolated Win7 version policy');

  const forbidden = [
    'tauri-apps/tauri-action',
    'TAURI_SIGNING_PRIVATE_KEY',
    'gh release',
    'latest.json',
    'createUpdaterArtifacts": true',
    'WIN7_WEBVIEW2_RUNTIME_',
    'Invoke-WebRequest',
    'prepare-win7-webview2',
  ];
  for (const marker of forbidden) {
    assert(!workflow.includes(marker), `Win7 workflow must not contain formal-release marker: ${marker}`);
  }

  const requiredReleaseMarkers = [
    'workflow_dispatch:',
    'win7-testing',
    'win7-production',
    WIN7_TARGET,
    'WIN7_TAURI_SIGNING_PRIVATE_KEY',
    'WIN7_TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
    'WIN7_TAURI_UPDATER_PUBLIC_KEY',
    'prepare-win7-release-config.mjs',
    'package-windows-internal-update.mjs',
    'validate-release-assets.mjs',
    'git merge-base --is-ancestor HEAD origin/main',
    'actions/upload-artifact@',
    'actions/download-artifact@',
    '--minisign minisign',
    'previous_version',
    'PREVIOUS_WIN7_VERSION',
    'security_owner',
    'support_until',
  ];
  for (const marker of requiredReleaseMarkers) {
    assert(releaseWorkflow.includes(marker), `Win7 release workflow is missing isolation marker: ${marker}`);
  }
  assert(releaseWorkflow.includes('test-release.mjs --win7'), 'Win7 release workflow must use the isolated Win7 version policy');
  for (const marker of [
    'tauri-apps/tauri-action',
    'secrets.TAURI_SIGNING_PRIVATE_KEY',
    'gh release',
    'Invoke-WebRequest',
    'Invoke-RestMethod',
  ]) {
    assert(!releaseWorkflow.includes(marker), `Win7 release workflow must not reuse regular release marker: ${marker}`);
  }
  assert(
    releaseConfigBuilder.includes('must not reuse the regular client updater key') &&
      releaseConfigBuilder.includes('createUpdaterArtifacts = true'),
    'Win7 release config builder must enable updater artifacts only after enforcing a separate key',
  );

  return {
    identifier: win7Config.identifier,
    target: WIN7_TARGET,
    webView2: WIN7_REQUIRED_WEBVIEW_MAJOR,
    upgradeCode: win7UpgradeCode,
    releaseChannels: ['win7-testing', 'win7-production'],
  };
}

export function readWin7Configuration(rootDir) {
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf8'));
  const readText = (file) => fs.readFileSync(path.join(rootDir, file), 'utf8');
  return {
    baseConfig: readJson('src-tauri/tauri.conf.json'),
    windowsConfig: readJson('src-tauri/tauri.windows.conf.json'),
    win7Config: readJson('src-tauri/tauri.win7.conf.json'),
    cargoConfig: readText('src-tauri/.cargo/config.toml'),
    cargoLauncher: readText('scripts/win7-cargo-runner.cmd'),
    cargoRunner: readText('scripts/win7-cargo-runner.mjs'),
    win7RegionRust: readText('src-tauri/src/win7_window_region.rs'),
    win7RegionController: readText('src/app/shell/useWin7WindowRegion.ts'),
    viteConfig: readText('vite.config.ts'),
    workflow: readText('.github/workflows/win7-test-build.yml'),
    releaseWorkflow: readText('.github/workflows/win7-release-build.yml'),
    releaseConfigBuilder: readText('scripts/prepare-win7-release-config.mjs'),
  };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = validateWin7Configuration(readWin7Configuration(rootDir));
    console.log(`Win7 build configuration is isolated: ${result.identifier}`);
    console.log(`Target: ${result.target}; external WebView2: ${result.webView2}; UpgradeCode: ${result.upgradeCode}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
