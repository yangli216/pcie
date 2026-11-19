// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { regionalPost } from './httpClient';
import { signRequest, updateSignatureClockOffset } from '../requestSigner';

vi.mock('../requestSigner', () => ({ signRequest: vi.fn(), updateSignatureClockOffset: vi.fn() }));
vi.mock('../updateConfig', () => ({ getActiveUpdateChannel: () => 'test' }));
vi.mock('../updatePolicy', () => ({ getCurrentClientVersion: () => 'test' }));
vi.mock('./config', () => ({ getOrgCode: () => 'SYN', getRegionalBaseUrl: () => 'https://example.invalid' }));
vi.mock('./device', () => ({ getDeviceCode: () => 'SYN-device' }));
vi.mock('./storage', () => ({ getDeviceToken: () => 'synthetic-token' }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('settles when signing stalls, without dispatching the POST when signing eventually finishes', async () => {
  let finishSigning!: (headers: Awaited<ReturnType<typeof signRequest>>) => void;
  vi.mocked(signRequest).mockImplementationOnce(() => new Promise(resolve => { finishSigning = resolve; }));
  const checked = expect(regionalPost('/v1/synthetic', {}, 30_000)).rejects.toThrow('30 秒');
  await vi.advanceTimersByTimeAsync(30_000);
  await checked;
  finishSigning({} as Awaited<ReturnType<typeof signRequest>>);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).not.toHaveBeenCalled();
});

it('aborts a stalled response body, and ignores a late response', async () => {
  let finishBody!: (body: object) => void;
  const json = vi.fn(() => new Promise(resolve => { finishBody = resolve; }));
  vi.mocked(fetch).mockResolvedValue({ ok: true, json } as unknown as Response);
  const checked = expect(regionalPost('/v1/synthetic', {}, 30_000)).rejects.toThrow('30 秒');
  await vi.advanceTimersByTimeAsync(1);
  expect(json).toHaveBeenCalledOnce();
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(29_999);
  await checked;
  expect(signal?.aborted).toBe(true);
  finishBody({ code: '0', timestamp: 12345 });
  await vi.advanceTimersByTimeAsync(0);
  expect(updateSignatureClockOffset).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});
