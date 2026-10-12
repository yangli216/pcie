import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCargoArgs,
  runWin7Cargo,
  TAURI_UTILS_WIN7_REVISION,
  lockForVersion,
  withSlimErrors,
} from './win7-cargo-runner.mjs';

test('pins the upstream tauri-utils Win7 ctor fix before the Cargo subcommand', () => {
  const args = buildCargoArgs(['build', '--release', '--target', 'x86_64-win7-windows-msvc']);
  assert.equal(args[0], '--config');
  assert.ok(args.some((value) => value.includes('patch.crates-io.tauri-utils.git')));
  assert.ok(args.some((value) => value.includes(TAURI_UTILS_WIN7_REVISION)));
  assert.deepEqual(args.slice(-5), ['build', '--locked', '--release', '--target', 'x86_64-win7-windows-msvc']);
  assert.ok(args.some((value) => value.includes('patch.crates-io.windows-link.path')));
});

test('preserves ordinary and encoded rust flags while enabling slim errors', () => {
  assert.equal(withSlimErrors({ RUSTFLAGS: '-C debuginfo=1' }).RUSTFLAGS, '-C debuginfo=1 --cfg windows_slim_errors');
  assert.equal(withSlimErrors({ CARGO_ENCODED_RUSTFLAGS: '-C\x1fdebuginfo=1' }).CARGO_ENCODED_RUSTFLAGS,
    '-C\x1fdebuginfo=1\x1f--cfg\x1fwindows_slim_errors');
});

const lock = 'version = 4\n\n[[package]]\nname = "pcie"\nversion = "1.4.8"\n\n[[package]]\nname = "windows-result"\nversion = "0.4.1"\n';
test('only changes the root MSI version, never dependency versions', () => {
  assert.equal(lockForVersion(lock, '1.4.8-1'), lock.replace('version = "1.4.8"', 'version = "1.4.8-1"'));
  assert.throws(() => lockForVersion(lock.replace('name = "pcie"', 'name = "other"'), '1.4.8-1'), /root package/);
});

for (const outcome of ['success', 'failure', 'spawn error']) {
  test(`restores ordinary lock after ${outcome} and builds from dedicated lock`, (t) => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-win7-runner-'));
    t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(rootDir, 'src-tauri'));
    const normal = path.join(rootDir, 'src-tauri/Cargo.lock');
    fs.writeFileSync(normal, 'user ordinary lock');
    fs.writeFileSync(path.join(rootDir, 'src-tauri/Cargo.win7.lock'), lock);
    fs.writeFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), '[package]\nname = "pcie"\nversion = "1.4.8-1"\n');
    const run = () => runWin7Cargo(['build', '--target', 'x86_64-win7-windows-msvc'], {
      rootDir, env: { PCIE_WIN7_BUILD: '1' },
      runner: (_command, args, options) => {
        assert.ok(args.includes('--locked'));
        assert.equal(fs.readFileSync(normal, 'utf8'), lockForVersion(lock, '1.4.8-1'));
        assert.match(options.env.RUSTFLAGS, /windows_slim_errors/);
        if (outcome === 'spawn error') return { error: new Error('spawn failed') };
        return { status: outcome === 'success' ? 0 : 1 };
      },
    });
    if (outcome === 'success') run();
    else assert.throws(run, /spawn failed|exit code 1/);
    assert.equal(fs.readFileSync(normal, 'utf8'), 'user ordinary lock');
    assert.equal(fs.readFileSync(path.join(rootDir, 'src-tauri/Cargo.win7.lock'), 'utf8'), lock);
  });
}

test('refuses an ordinary Windows target even when the flavor variable is present', () => {
  assert.throws(() => runWin7Cargo(['build', '--target', 'x86_64-pc-windows-msvc'], { env: { PCIE_WIN7_BUILD: '1' } }), /explicit.*target/);
});

test('removes only the temporary ordinary lock when none existed before the Win7 build', (t) => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-win7-no-lock-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(rootDir, 'src-tauri'));
  fs.writeFileSync(path.join(rootDir, 'src-tauri/Cargo.win7.lock'), lock);
  fs.writeFileSync(path.join(rootDir, 'src-tauri/Cargo.toml'), '[package]\nname = "pcie"\nversion = "1.4.8"\n');
  runWin7Cargo(['build', '--target', 'x86_64-win7-windows-msvc'], {
    rootDir, env: { PCIE_WIN7_BUILD: '1' }, runner: () => ({ status: 0 }),
  });
  assert.equal(fs.existsSync(path.join(rootDir, 'src-tauri/Cargo.lock')), false);
  assert.equal(fs.existsSync(path.join(rootDir, 'src-tauri/Cargo.win7.lock')), true);
});

test('refuses to patch Cargo outside the explicit Win7 flavor', () => {
  assert.throws(
    () => runWin7Cargo(['build'], { env: {}, runner: () => ({ status: 0 }) }),
    /PCIE_WIN7_BUILD=1/,
  );
});
