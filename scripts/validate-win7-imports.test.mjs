import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPeImports, validatePeForWin7, checkInstalledBinaries, expectedMsiExecutable } from './validate-win7-imports.mjs';

function peFixture({ dll = 'ole32.dll', symbol = 'CoTaskMemAlloc', delay = false, ordinal = false } = {}) {
  const b = Buffer.alloc(0x600);
  b.writeUInt16LE(0x5a4d, 0); b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x8664, 0x84); b.writeUInt16LE(1, 0x86); b.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98;
  b.writeUInt16LE(0x20b, optional); b.writeBigUInt64LE(0x140000000n, optional + 24);
  b.writeUInt16LE(6, optional + 48); b.writeUInt16LE(1, optional + 50); b.writeUInt32LE(16, optional + 108);
  const section = optional + 0xf0;
  b.writeUInt32LE(0x1000, section + 12); b.writeUInt32LE(0x400, section + 16); b.writeUInt32LE(0x200, section + 20);
  const directory = optional + 112 + (delay ? 13 : 1) * 8;
  b.writeUInt32LE(0x1000, directory); b.writeUInt32LE(delay ? 64 : 40, directory + 4);
  if (delay) {
    b.writeUInt32LE(1, 0x200); b.writeUInt32LE(0x1080, 0x204); b.writeUInt32LE(0x10c0, 0x210);
  } else {
    b.writeUInt32LE(0x10c0, 0x200); b.writeUInt32LE(0x1080, 0x20c);
  }
  b.write(dll + '\0', 0x280); b.writeBigUInt64LE(ordinal ? (1n << 63n) | 7n : 0x1100n, 0x2c0);
  b.write(symbol + '\0', 0x302);
  b.write('__TAURI_BUNDLE_TYPE_VAR_UNK', 0x500);
  return b;
}

test('parses x64 import names and ordinal imports, allowing Win7 COM bindings', () => {
  const pe = readPeImports(peFixture());
  assert.deepEqual(pe.imports, [{ kind: 'import', dll: 'ole32.dll', symbols: ['CoTaskMemAlloc'] }]);
  assert.deepEqual(validatePeForWin7(pe), []);
  assert.deepEqual(readPeImports(peFixture({ ordinal: true })).imports[0].symbols, ['ordinal:7']);
});

test('rejects the reported WinRT failure and the second combase blocker', () => {
  const pe = readPeImports(peFixture({ dll: 'api-ms-win-core-winrt-error-l1-1-0.dll', symbol: 'RoOriginateErrorW' }));
  assert.match(validatePeForWin7(pe).join('\n'), /unsupported DLL.*winrt-error/);
  assert.match(validatePeForWin7(pe).join('\n'), /RoOriginateErrorW/);
  assert.match(validatePeForWin7(readPeImports(peFixture({ dll: 'combase.dll' }))).join('\n'), /combase.dll/);
});

test('checks delay imports and Win8 APIs even when imported from kernel32', () => {
  const pe = readPeImports(peFixture({ dll: 'kernel32.dll', symbol: 'WaitOnAddress', delay: true }));
  assert.equal(pe.imports[0].kind, 'delay');
  assert.match(validatePeForWin7(pe).join('\n'), /delay: unsupported API.*WaitOnAddress/);
});

test('rejects malformed binaries and unsupported subsystem versions', () => {
  assert.throws(() => readPeImports(Buffer.alloc(30)), /signature/);
  assert.throws(() => readPeImports(peFixture().subarray(0, 0x250)), /Truncated/);
  const pe = readPeImports(peFixture()); pe.subsystemVersion = [6, 2];
  assert.match(validatePeForWin7(pe).join('\n'), /Subsystem 6.2/);
});

test('only allows the exact Tauri MSI token patch, rejecting missing or ambiguous markers', () => {
  const source = peFixture();
  const expected = expectedMsiExecutable(source);
  assert.ok(expected.includes(Buffer.from('__TAURI_BUNDLE_TYPE_VAR_MSI')));
  assert.ok(source.includes(Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')));
  assert.throws(() => expectedMsiExecutable(Buffer.alloc(100)), /exactly one/);
  const ambiguous = Buffer.concat([source, Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK')]);
  assert.throws(() => expectedMsiExecutable(ambiguous), /exactly one/);
  assert.deepEqual(expected.subarray(0, 0x500), source.subarray(0, 0x500));
});

test('checks every installed DLL and verifies the MSI main executable provenance', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcie-win7-pe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const installed = path.join(dir, 'installed'); fs.mkdirSync(installed);
  const executable = path.join(dir, 'source.exe'); fs.writeFileSync(executable, peFixture());
  fs.writeFileSync(path.join(installed, 'pcie.exe'), expectedMsiExecutable(peFixture()));
  const options = { directory: installed, executable, reportPath: path.join(dir, 'report.json') };
  assert.equal(checkInstalledBinaries(options).passed, true);
  fs.writeFileSync(path.join(installed, 'helper.dll'), peFixture({ dll: 'combase.dll' }));
  assert.throws(() => checkInstalledBinaries(options), /helper.dll.*combase/);
  fs.unlinkSync(path.join(installed, 'helper.dll'));
  fs.writeFileSync(path.join(installed, 'pcie.exe'), expectedMsiExecutable(peFixture({ ordinal: true })));
  assert.throws(() => checkInstalledBinaries(options), /SHA-256/);
});
