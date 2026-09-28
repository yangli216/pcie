import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  assertProjectVersionsAligned,
  readProjectVersionState,
  resolveTargetVersion,
  restoreProjectVersionState,
  writeProjectVersion,
} from './release-version.mjs';
import { parseWin7Version, resolveWin7TargetVersion } from './win7-version.mjs';

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  const scriptArgs = separatorIndex >= 0 ? argv.slice(0, separatorIndex) : argv;
  const buildArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  let explicitVersion;
  let type = 'patch';
  let dryRun = false;
  let versionPolicy = 'stable';

  for (let index = 0; index < scriptArgs.length; index += 1) {
    const value = scriptArgs[index];
    if (value === '--version') {
      const nextValue = scriptArgs[index + 1];
      if (!nextValue || nextValue.startsWith('--')) {
        throw new Error('--version requires a version value');
      }
      explicitVersion = nextValue;
      index += 1;
    } else if (value === '--dry-run') {
      dryRun = true;
    } else if (value === '--win7') {
      versionPolicy = 'win7';
    } else if (!value.startsWith('--')) {
      if (/^\d+\.\d+\.\d+(?:-win7(?:\.\d+)?)?$/.test(value)) {
        explicitVersion = value;
      } else {
        type = value;
      }
    } else {
      throw new Error(`unknown test release option: ${value}`);
    }
  }

  return { explicitVersion, type, dryRun, versionPolicy, buildArgs };
}

export function runCandidateBuild({
  rootDir,
  explicitVersion,
  type = 'patch',
  dryRun = false,
  versionPolicy = 'stable',
  buildArgs = [],
  createUpdaterArtifacts,
  runner,
  logger = console,
}) {
  const state = readProjectVersionState(rootDir);
  const currentVersion = assertProjectVersionsAligned(state);
  const targetVersion = versionPolicy === 'win7'
    ? resolveWin7TargetVersion(currentVersion, explicitVersion)
    : resolveTargetVersion(currentVersion, { explicitVersion, type });
  logger.log(`${versionPolicy === 'win7' ? 'Win7 candidate' : 'Candidate'} build: ${currentVersion} -> ${targetVersion}`);

  if (dryRun) {
    logger.log('Candidate validation passed; no files were changed.');
    return { currentVersion, targetVersion, built: false };
  }

  writeProjectVersion(state, targetVersion, {
    createUpdaterArtifacts,
    validateVersion: versionPolicy === 'win7' ? parseWin7Version : undefined,
  });
  try {
    runner({ rootDir, targetVersion, buildArgs });
    return { currentVersion, targetVersion, built: true };
  } finally {
    restoreProjectVersionState(state);
    logger.log(`Restored project version files to ${currentVersion}.`);
  }
}

function runTauriBuild({ rootDir, buildArgs }) {
  const tauriCliPath = path.join(rootDir, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  const result = spawnSync(process.execPath, [tauriCliPath, 'build', ...buildArgs], {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Tauri candidate build failed with exit code ${result.status ?? 'unknown'}`);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const options = parseArgs(process.argv.slice(2));
    const hasSigningKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY?.trim());
    if (!hasSigningKey && !options.dryRun) {
      console.log('No updater signing key detected; building a direct-install candidate without updater artifacts.');
    }
    const result = runCandidateBuild({
      ...options,
      rootDir,
      createUpdaterArtifacts: hasSigningKey,
      runner: runTauriBuild,
    });
    if (result.built) {
      console.log(`Candidate ${result.targetVersion} built successfully. No tag or release was created.`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
