import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWin7ReleasePreflight } from './win7-release-preflight.mjs';

const validInput = {
  sourceVersion: '1.4.8',
  version: '1.4.8-win7.1',
  previousVersion: '1.4.8-win7',
  channel: 'win7-testing',
  securityOwner: 'desktop-team',
  supportUntil: '2027-12-31',
  referenceDate: new Date('2026-08-27T12:00:00Z'),
};

test('accepts a monotonic Win7 release with explicit ownership and deadline', () => {
  const result = validateWin7ReleasePreflight(validInput);
  assert.equal(result.version, '1.4.8-win7.1');
  assert.equal(result.channel, 'win7-testing');
});

test('rejects regular client release channels', () => {
  assert.throws(
    () => validateWin7ReleasePreflight({ ...validInput, channel: 'production' }),
    /Win7 release channel/,
  );
});

test('rejects a version outside the source baseline or not newer than the channel', () => {
  assert.throws(
    () => validateWin7ReleasePreflight({ ...validInput, version: '1.4.9-win7' }),
    /source version baseline/,
  );
  assert.throws(
    () => validateWin7ReleasePreflight({ ...validInput, previousVersion: '1.4.8-win7.2' }),
    /newer than channel version/,
  );
});

test('accepts the first prerelease after a legacy stable validation baseline', () => {
  const result = validateWin7ReleasePreflight({
    ...validInput,
    version: '1.4.8-win7',
    previousVersion: '1.4.6',
  });
  assert.equal(result.version, '1.4.8-win7');
});

test('rejects missing ownership or an expired support deadline', () => {
  assert.throws(
    () => validateWin7ReleasePreflight({ ...validInput, securityOwner: '' }),
    /security owner/,
  );
  assert.throws(
    () => validateWin7ReleasePreflight({ ...validInput, supportUntil: '2026-08-26' }),
    /must not be in the past/,
  );
});
