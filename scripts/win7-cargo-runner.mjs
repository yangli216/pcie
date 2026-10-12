import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TAURI_UTILS_WIN7_REVISION = '8a97d387a3a1a52f7c501762517e294d8c94e119';
export const TAURI_UTILS_REPOSITORY = 'https://github.com/tauri-apps/tauri';

export function buildCargoArgs(args, { locked = true } = {}) {
  return [
    '--config',
    `patch.crates-io.tauri-utils.git="${TAURI_UTILS_REPOSITORY}"`,
    '--config',
    `patch.crates-io.tauri-utils.rev="${TAURI_UTILS_WIN7_REVISION}"`,
    '--config',
    'patch.crates-io.windows-link.path="../scripts/win7/windows-link"',
    args[0],
    ...(locked ? ['--locked'] : []),
    ...args.slice(1),
  ];
}

export function withSlimErrors(env) {
  if (env.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    return { ...env, CARGO_ENCODED_RUSTFLAGS: [env.CARGO_ENCODED_RUSTFLAGS, '--cfg', 'windows_slim_errors'].filter(Boolean).join('\x1f') };
  }
  return { ...env, RUSTFLAGS: `${env.RUSTFLAGS || ''} --cfg windows_slim_errors`.trim() };
}

export function lockForVersion(lock, version) {
  const root = /(\[\[package\]\]\r?\nname = "pcie"\r?\nversion = ")[^"]+("\r?\n)/g;
  if ([...lock.matchAll(root)].length !== 1) throw new Error('Win7 lock must contain exactly one pcie root package');
  return lock.replace(root, (_match, prefix, suffix) => `${prefix}${version}${suffix}`);
}

export function runWin7Cargo(args, {
  env = process.env,
  runner = spawnSync,
  rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
} = {}) {
  if (env.PCIE_WIN7_BUILD !== '1') {
    throw new Error('Win7 Cargo runner requires PCIE_WIN7_BUILD=1');
  }

  const refresh = args.length === 1 && args[0] === '--refresh-lock';
  if (!refresh && !args.includes('x86_64-win7-windows-msvc')) {
    throw new Error('Win7 Cargo runner requires the explicit x86_64-win7-windows-msvc target');
  }
  const cargoDir = path.join(rootDir, 'src-tauri');
  const normalLockPath = path.join(cargoDir, 'Cargo.lock');
  const win7LockPath = path.join(cargoDir, 'Cargo.win7.lock');
  const normalLock = fs.existsSync(normalLockPath) ? fs.readFileSync(normalLockPath) : undefined;
  const version = fs.readFileSync(path.join(cargoDir, 'Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error('Missing Cargo package version');
  const snapshot = fs.existsSync(win7LockPath) ? fs.readFileSync(win7LockPath, 'utf8') : undefined;
  if (!refresh && !snapshot) throw new Error('Missing dedicated Cargo.win7.lock; refresh it explicitly before building');
  try {
    if (snapshot) fs.writeFileSync(normalLockPath, lockForVersion(snapshot, version));
    const cargoArgs = refresh
      ? ['update', '--package', 'tauri-utils', '--package', 'windows-link@0.2.1']
      : args;
    const result = runner('cargo', buildCargoArgs(cargoArgs, { locked: !refresh }), {
      cwd: cargoDir,
      env: withSlimErrors(env),
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Win7 Cargo build failed with exit code ${result.status ?? 'unknown'}`);
    if (refresh) fs.copyFileSync(normalLockPath, win7LockPath);
  } finally {
    if (normalLock === undefined) fs.rmSync(normalLockPath, { force: true });
    else fs.writeFileSync(normalLockPath, normalLock);
  }
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  try {
    runWin7Cargo(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
