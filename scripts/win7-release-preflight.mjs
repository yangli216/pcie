import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSemver } from './release-preflight.mjs';
import { assertProjectVersionsAligned, readProjectVersionState } from './release-version.mjs';
import {
  compareWin7ChannelVersions,
  resolveWin7TargetVersion,
} from './win7-version.mjs';

export const WIN7_RELEASE_CHANNELS = ['win7-testing', 'win7-production'];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[current.slice(2)] = true;
    } else {
      args[current.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

function parseDateOnly(value, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date`);
  }
  return parsed;
}

export function validateWin7ReleasePreflight({
  sourceVersion,
  version,
  previousVersion,
  channel,
  securityOwner,
  supportUntil,
  referenceDate = new Date(),
}) {
  parseSemver(sourceVersion, 'source version');
  resolveWin7TargetVersion(sourceVersion, version);
  if (previousVersion) {
    if (compareWin7ChannelVersions(version, previousVersion) <= 0) {
      throw new Error(`Win7 release ${version} must be newer than channel version ${previousVersion}`);
    }
  }
  if (!WIN7_RELEASE_CHANNELS.includes(channel)) {
    throw new Error(`Win7 release channel must be ${WIN7_RELEASE_CHANNELS.join(' or ')}`);
  }
  if (!String(securityOwner || '').trim()) {
    throw new Error('Win7 release security owner is required');
  }
  const supportDate = parseDateOnly(supportUntil, 'Win7 support deadline');
  const referenceDay = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
  if (supportDate < referenceDay) {
    throw new Error('Win7 support deadline must not be in the past');
  }
  return { version, previousVersion: previousVersion || null, channel, securityOwner: securityOwner.trim(), supportUntil };
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const rootDir = path.resolve(args.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
    const sourceVersion = assertProjectVersionsAligned(readProjectVersionState(rootDir));
    const result = validateWin7ReleasePreflight({
      sourceVersion,
      version: args.version,
      previousVersion: args['previous-version'],
      channel: args.channel,
      securityOwner: args['security-owner'],
      supportUntil: args['support-until'],
    });
    console.log(
      `Win7 release preflight passed: ${sourceVersion} -> ${result.version}; ${result.channel}; support until ${result.supportUntil}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
