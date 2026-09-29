import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWin7ChannelVersions,
  parseWin7MsiVersion,
  parseWin7Version,
  resolveWin7TargetVersion,
  toWin7MsiVersion,
} from './win7-version.mjs';

test('accepts the Win7 prerelease line and numeric hotfix revisions', () => {
  assert.deepEqual(parseWin7Version('1.4.8-win7'), { core: [1, 4, 8], revision: null });
  assert.deepEqual(parseWin7Version('1.4.8-win7.2'), { core: [1, 4, 8], revision: 2 });
  assert.equal(resolveWin7TargetVersion('1.4.8', '1.4.8-win7.2'), '1.4.8-win7.2');
  assert.equal(compareWin7ChannelVersions('1.4.8-win7.1', '1.4.8-win7'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.8-win7.10', '1.4.8-win7.9'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.9-win7', '1.4.8-win7.99'), 1);
  assert.equal(toWin7MsiVersion('1.4.8-win7'), '1.4.8-0');
  assert.equal(toWin7MsiVersion('1.4.8-win7.2'), '1.4.8-2');
  assert.deepEqual(parseWin7MsiVersion('1.4.8-65535'), { core: [1, 4, 8], revision: 65535 });
});

test('keeps stable releases outside the Win7 candidate line', () => {
  assert.throws(() => parseWin7Version('1.4.8'), /X\.Y\.Z-win7/);
  assert.throws(() => parseWin7Version('1.4.8-win7.0'), /X\.Y\.Z-win7/);
  assert.throws(() => parseWin7Version('1.4.8-win7.01'), /X\.Y\.Z-win7/);
  assert.throws(() => parseWin7Version('1.4.8-win7.65536'), /between 1 and 65535/);
  assert.throws(() => parseWin7MsiVersion('1.4.8-win7'), /numeric prerelease/);
  assert.throws(() => parseWin7MsiVersion('1.4.8-65536'), /between 0 and 65535/);
  assert.throws(
    () => resolveWin7TargetVersion('1.4.8', '1.4.9-win7'),
    /must use source version baseline 1\.4\.8-win7/,
  );
});

test('supports a one-time comparison against a legacy stable Win7 baseline', () => {
  assert.equal(compareWin7ChannelVersions('1.4.8-win7', '1.4.6'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.8-win7', '1.4.8'), -1);
});
