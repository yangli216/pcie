import { parseStableVersion } from './release-version.mjs';

const WIN7_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-win7(?:\.(0|[1-9]\d*))?$/;
const LEGACY_STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function parseWin7Version(value, label = 'Win7 version') {
  const match = WIN7_VERSION_PATTERN.exec(value ?? '');
  if (!match) {
    throw new Error(
      `${label} must use X.Y.Z-win7 or X.Y.Z-win7.N format, received: ${value || '(empty)'}`,
    );
  }
  return {
    core: match.slice(1, 4).map(Number),
    revision: match[4] === undefined ? null : Number(match[4]),
  };
}

function parseComparableVersion(value, label) {
  const win7Match = WIN7_VERSION_PATTERN.exec(value ?? '');
  if (win7Match) {
    return {
      core: win7Match.slice(1, 4).map(Number),
      prerelease: win7Match[4] === undefined ? ['win7'] : ['win7', Number(win7Match[4])],
    };
  }
  const stableMatch = LEGACY_STABLE_VERSION_PATTERN.exec(value ?? '');
  if (stableMatch) {
    return { core: stableMatch.slice(1, 4).map(Number), prerelease: [] };
  }
  throw new Error(
    `${label} must use stable X.Y.Z or Win7 X.Y.Z-win7[.N] format, received: ${value || '(empty)'}`,
  );
}

export function compareWin7ChannelVersions(left, right) {
  const leftVersion = parseComparableVersion(left, 'left version');
  const rightVersion = parseComparableVersion(right, 'right version');
  for (let index = 0; index < leftVersion.core.length; index += 1) {
    if (leftVersion.core[index] !== rightVersion.core[index]) {
      return leftVersion.core[index] < rightVersion.core[index] ? -1 : 1;
    }
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      if (leftPart === rightPart) return 0;
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart !== rightPart) {
      if (typeof leftPart === 'number' && typeof rightPart === 'number') {
        return leftPart < rightPart ? -1 : 1;
      }
      if (typeof leftPart === 'number' || typeof rightPart === 'number') {
        return typeof leftPart === 'number' ? -1 : 1;
      }
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return 0;
}

export function resolveWin7TargetVersion(sourceVersion, explicitVersion) {
  const sourceCore = parseStableVersion(sourceVersion, 'source version');
  if (!explicitVersion) {
    throw new Error('Win7 candidate version is required');
  }
  const target = parseWin7Version(explicitVersion, 'Win7 candidate version');
  if (target.core.some((part, index) => part !== sourceCore[index])) {
    throw new Error(
      `Win7 candidate ${explicitVersion} must use source version baseline ${sourceVersion}-win7[.N]`,
    );
  }
  return explicitVersion;
}
