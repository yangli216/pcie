import fs from 'node:fs';
import path from 'node:path';

const STABLE_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseStableVersion(value, label = 'version') {
  const match = STABLE_SEMVER_PATTERN.exec(value ?? '');
  if (!match) {
    throw new Error(`${label} must use stable X.Y.Z format, received: ${value || '(empty)'}`);
  }
  return match.slice(1).map(Number);
}

export function compareStableVersions(left, right) {
  const leftParts = parseStableVersion(left, 'left version');
  const rightParts = parseStableVersion(right, 'right version');
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

export function incrementStableVersion(currentVersion, type = 'patch') {
  const [currentMajor, currentMinor, currentPatch] = parseStableVersion(currentVersion, 'current version');
  let major = currentMajor;
  let minor = currentMinor;
  let patch = currentPatch;

  if (type === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (type === 'minor') {
    minor += 1;
    patch = 0;
  } else if (type === 'patch') {
    patch += 1;
  } else {
    throw new Error(`release type must be patch, minor, or major, received: ${type}`);
  }

  return `${major}.${minor}.${patch}`;
}

export function resolveTargetVersion(currentVersion, { explicitVersion, type = 'patch' } = {}) {
  const targetVersion = explicitVersion
    ? (parseStableVersion(explicitVersion, 'candidate version'), explicitVersion)
    : incrementStableVersion(currentVersion, type);
  if (compareStableVersions(targetVersion, currentVersion) <= 0) {
    throw new Error(`target version ${targetVersion} must be newer than current version ${currentVersion}`);
  }
  return targetVersion;
}

export function readCargoPackageVersion(cargoToml) {
  const packageStart = cargoToml.indexOf('[package]');
  if (packageStart < 0) throw new Error('src-tauri/Cargo.toml is missing [package]');
  const packageBodyStart = packageStart + '[package]'.length;
  const packageBody = cargoToml.slice(packageBodyStart);
  const nextSection = packageBody.search(/^\[[^\]]+\]/m);
  const packageEnd = nextSection >= 0 ? packageBodyStart + nextSection : cargoToml.length;
  const packageSection = cargoToml.slice(packageBodyStart, packageEnd);
  const version = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!version) throw new Error('src-tauri/Cargo.toml is missing [package].version');
  return version;
}

export function replaceCargoPackageVersion(cargoToml, version) {
  const currentVersion = readCargoPackageVersion(cargoToml);
  const packageStart = cargoToml.indexOf('[package]');
  const packageBodyStart = packageStart + '[package]'.length;
  const packageBody = cargoToml.slice(packageBodyStart);
  const nextSection = packageBody.search(/^\[[^\]]+\]/m);
  const packageEnd = nextSection >= 0 ? packageBodyStart + nextSection : cargoToml.length;
  const packageSection = cargoToml.slice(packageBodyStart, packageEnd);
  const updatedPackageSection = packageSection.replace(
    new RegExp(`^version[ \\t]*=[ \\t]*"${currentVersion.replaceAll('.', '\\.')}"[ \\t]*$`, 'm'),
    `version = "${version}"`,
  );
  return `${cargoToml.slice(0, packageBodyStart)}${updatedPackageSection}${cargoToml.slice(packageEnd)}`;
}

export function readProjectVersionState(rootDir) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = path.join(rootDir, 'src-tauri', 'Cargo.toml');
  const cargoLockPath = path.join(rootDir, 'src-tauri', 'Cargo.lock');
  const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  const tauriConfigContent = fs.readFileSync(tauriConfigPath, 'utf8');
  const cargoTomlContent = fs.readFileSync(cargoTomlPath, 'utf8');
  const cargoLockExists = fs.existsSync(cargoLockPath);
  const cargoLockContent = cargoLockExists ? fs.readFileSync(cargoLockPath, 'utf8') : null;
  const packageJson = JSON.parse(packageJsonContent);
  const tauriConfig = JSON.parse(tauriConfigContent);

  return {
    paths: { packageJsonPath, tauriConfigPath, cargoTomlPath, cargoLockPath },
    contents: { packageJsonContent, tauriConfigContent, cargoTomlContent, cargoLockContent, cargoLockExists },
    versions: {
      packageJson: packageJson.version,
      tauriConfig: tauriConfig.version,
      cargo: readCargoPackageVersion(cargoTomlContent),
    },
    parsed: { packageJson, tauriConfig },
  };
}

export function assertProjectVersionsAligned(state) {
  const values = Object.values(state.versions);
  const currentVersion = values[0];
  parseStableVersion(currentVersion, 'current project version');
  const mismatched = Object.entries(state.versions).filter(([, version]) => version !== currentVersion);
  if (mismatched.length > 0) {
    throw new Error(
      `project versions must match before building: ${Object.entries(state.versions)
        .map(([name, version]) => `${name}=${version}`)
        .join(', ')}`,
    );
  }
  return currentVersion;
}

export function writeProjectVersion(state, version, { createUpdaterArtifacts, validateVersion = parseStableVersion } = {}) {
  validateVersion(version, 'target version');
  const packageJson = { ...state.parsed.packageJson, version };
  const tauriConfig = { ...state.parsed.tauriConfig, version };
  if (typeof createUpdaterArtifacts === 'boolean') {
    tauriConfig.bundle = {
      ...tauriConfig.bundle,
      createUpdaterArtifacts,
    };
  }
  fs.writeFileSync(state.paths.packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(state.paths.tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  fs.writeFileSync(
    state.paths.cargoTomlPath,
    replaceCargoPackageVersion(state.contents.cargoTomlContent, version),
  );
}

export function restoreProjectVersionState(state) {
  fs.writeFileSync(state.paths.packageJsonPath, state.contents.packageJsonContent);
  fs.writeFileSync(state.paths.tauriConfigPath, state.contents.tauriConfigContent);
  fs.writeFileSync(state.paths.cargoTomlPath, state.contents.cargoTomlContent);
  if (state.contents.cargoLockExists) {
    fs.writeFileSync(state.paths.cargoLockPath, state.contents.cargoLockContent);
  } else if (fs.existsSync(state.paths.cargoLockPath)) {
    fs.rmSync(state.paths.cargoLockPath);
  }
}
