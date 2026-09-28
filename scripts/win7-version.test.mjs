import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWin7ChannelVersions,
  parseWin7Version,
  resolveWin7TargetVersion,
} from './win7-version.mjs';

test('accepts the Win7 prerelease line and numeric hotfix revisions', () => {
  assert.deepEqual(parseWin7Version('1.4.8-win7'), { core: [1, 4, 8], revision: null });
  assert.deepEqual(parseWin7Version('1.4.8-win7.2'), { core: [1, 4, 8], revision: 2 });
  assert.equal(resolveWin7TargetVersion('1.4.8', '1.4.8-win7.2'), '1.4.8-win7.2');
  assert.equal(compareWin7ChannelVersions('1.4.8-win7.1', '1.4.8-win7'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.8-win7.10', '1.4.8-win7.9'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.9-win7', '1.4.8-win7.99'), 1);
});

test('keeps stable releases outside the Win7 candidate line', () => {
  assert.throws(() => parseWin7Version('1.4.8'), /X\.Y\.Z-win7/);
  assert.throws(() => parseWin7Version('1.4.8-win7.01'), /X\.Y\.Z-win7/);
  assert.throws(
    () => resolveWin7TargetVersion('1.4.8', '1.4.9-win7'),
    /must use source version baseline 1\.4\.8-win7/,
  );
});

test('supports a one-time comparison against a legacy stable Win7 baseline', () => {
  assert.equal(compareWin7ChannelVersions('1.4.8-win7', '1.4.6'), 1);
  assert.equal(compareWin7ChannelVersions('1.4.8-win7', '1.4.8'), -1);
});
