import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../updateConfig', () => ({ getActiveUpdateChannel: () => 'testing' }));
vi.mock('../updatePolicy', () => ({ getCurrentClientVersion: async () => '1.4.7', isUpdateRequiredCode: () => false, notifyForceUpdateRequired: vi.fn() }));
vi.mock('../requestSigner', () => ({ signRequest: vi.fn(async () => ({ 'X-Signature': 'test-signature', 'X-Timestamp': '1', 'X-Nonce': 'nonce', 'X-Body-SHA256': 'body-hash' })), updateSignatureClockOffset: () => false }));
vi.mock('./device', () => ({ getDeviceCode: async () => 'synthetic-device' }));
vi.mock('./config', () => ({ getOrgCode: () => 'synthetic-org', getRegionalBaseUrl: () => 'https://synthetic.invalid' }));
vi.mock('./registrationCache', () => ({ restoreCachedDeviceRegistration: vi.fn() }));
vi.mock('./storage', () => ({ getDeviceToken: () => 'test-token', clearDeviceRegistration: vi.fn(), setRegionalInitialized: vi.fn() }));
vi.mock('@shared/lib/fetchTimeout', () => ({ fetchWithTimeout: vi.fn() }));
import { fetchWithTimeout } from '@shared/lib/fetchTimeout';
import { signRequest } from '../requestSigner';
import { regionalFetch, regionalRequestResponse } from './httpClient';

beforeEach(() => vi.clearAllMocks());
describe('regional signed response extraction', () => {
  it('signs the exact SSE body and preserves the Response with an explicit timeout', async () => {
    const response = new Response('event: accepted\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    vi.mocked(fetchWithTimeout).mockResolvedValue(response);
    const body = JSON.stringify({ requestId: 'synthetic', facts: {} });
    const actual = await regionalRequestResponse('/v1/public-health/generations', { method: 'POST', body, headers: { Accept: 'text/event-stream' } }, { timeoutMs: 180_000 });
    expect(actual.response).toBe(response);
    expect(signRequest).toHaveBeenCalledWith('POST', '/v1/public-health/generations', body);
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://synthetic.invalid/v1/public-health/generations', expect.objectContaining({ body, headers: expect.objectContaining({ 'X-Signature': 'test-signature', Authorization: 'Bearer test-token', Accept: 'text/event-stream' }) }), expect.objectContaining({ timeoutMs: 180_000 }));
  });
  it('retains the JSON API envelope behavior for existing callers', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data: { oldClient: true } })));
    await expect(regionalFetch('/v1/existing')).resolves.toEqual({ oldClient: true });
  });
});
