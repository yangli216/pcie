import { describe, expect, it } from 'vitest';
import {
  getUpdateEnvironmentLabel,
  normalizeUpdateEnvironment,
  resolvePublicClientVersion,
  resolveUpdateChannel,
} from './updateConfig';

describe('updateConfig channel isolation', () => {
  it('maps regular builds to the regular release channels', () => {
    expect(resolveUpdateChannel('production', 'standard')).toBe('production');
    expect(resolveUpdateChannel('testing', 'standard')).toBe('testing');
  });

  it('maps Win7 builds to dedicated release channels', () => {
    expect(resolveUpdateChannel('production', 'win7')).toBe('win7-production');
    expect(resolveUpdateChannel('testing', 'win7')).toBe('win7-testing');
  });

  it('does not accept an unknown environment as testing', () => {
    expect(normalizeUpdateEnvironment('testing')).toBe('testing');
    expect(normalizeUpdateEnvironment('win7-testing')).toBe('production');
    expect(normalizeUpdateEnvironment('unknown')).toBe('production');
  });

  it('labels explicit Win7 channels without relying on the active build flavor', () => {
    expect(getUpdateEnvironmentLabel('win7-production')).toBe('Win7 正式内网');
    expect(getUpdateEnvironmentLabel('win7-testing')).toBe('Win7 测试内网');
  });

  it('maps MSI-safe Win7 versions back to the public release line', () => {
    expect(resolvePublicClientVersion('1.4.8-0', 'win7', '1.4.8-win7')).toBe('1.4.8-win7');
    expect(resolvePublicClientVersion('1.4.8-12', 'win7', '1.4.8-win7.12')).toBe('1.4.8-win7.12');
    expect(resolvePublicClientVersion('1.4.8', 'standard', '')).toBe('1.4.8');
  });

  it('does not expose an invalid or mismatched internal Win7 version', () => {
    expect(resolvePublicClientVersion('1.4.8-win7', 'win7', '1.4.8-win7')).toBe('unknown');
    expect(resolvePublicClientVersion('1.4.8-1', 'win7', '1.4.8-win7.2')).toBe('unknown');
    expect(resolvePublicClientVersion('1.4.8-65536', 'win7', '')).toBe('unknown');
  });
});
