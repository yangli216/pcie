import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@services/updateConfig', () => ({ getActiveUpdateChannel: () => 'testing' }));
vi.mock('@services/updatePolicy', () => ({ getCurrentClientVersion: async () => '1.4.7', isUpdateRequiredCode: () => false, notifyForceUpdateRequired: vi.fn() }));
vi.mock('@services/requestSigner', () => ({ signRequest: vi.fn(async () => ({ 'X-Signature': 'synthetic-signature', 'X-Timestamp': '1', 'X-Nonce': 'synthetic-nonce', 'X-Body-SHA256': 'synthetic-hash' })), updateSignatureClockOffset: () => false }));
vi.mock('@services/regional/device', () => ({ getDeviceCode: async () => 'synthetic-device' }));
vi.mock('@services/regional/config', () => ({ getOrgCode: () => 'synthetic-org', getRegionalBaseUrl: () => 'https://synthetic.invalid' }));
vi.mock('@services/regional/registrationCache', () => ({ restoreCachedDeviceRegistration: vi.fn() }));
vi.mock('@services/regional/storage', () => ({ getDeviceToken: () => 'synthetic-token', clearDeviceRegistration: vi.fn(), setRegionalInitialized: vi.fn() }));
vi.mock('@shared/lib/fetchTimeout', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('@services/regionalClient', async () => {
  const http = await import('@services/regional/httpClient');
  return { regionalGet: http.regionalGet, regionalPost: http.regionalPost };
});
import { fetchWithTimeout } from '@shared/lib/fetchTimeout';
import { signRequest } from '@services/requestSigner';
import { listKnowledgeCollections, searchKnowledge } from './knowledgeRetrieval';
import { collection, result } from '../testing/fixtures';

beforeEach(() => vi.clearAllMocks());
describe('knowledge API through the signed regional transport', () => {
  it('signs the GET collection endpoint and unwraps the existing envelope', async () => {
    const data = { enabled: true, collections: [collection] };
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data })));
    await expect(listKnowledgeCollections()).resolves.toEqual(data);
    expect(signRequest).toHaveBeenCalledWith('GET', '/v1/knowledge/collections', undefined);
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://synthetic.invalid/v1/knowledge/collections', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token', 'X-Signature': 'synthetic-signature' }),
    }), expect.any(Object));
  });
  it('signs the exact UTF-8 JSON contract and cannot forward provider credentials or tenant fields', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data: result() })));
    await searchKnowledge({ collectionId: collection.id, query: '合成资料', releaseVersion: collection.releaseVersion,
      ...{ apiKey: 'must-not-forward', organizationIds: ['OTHER'], knowledgeIds: ['OTHER'], baseUrl: 'https://other.invalid' } });
    const body = JSON.stringify({ collectionId: collection.id, query: '合成资料', releaseVersion: collection.releaseVersion, limit: 5 });
    expect(signRequest).toHaveBeenCalledWith('POST', '/v1/knowledge/search', body);
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://synthetic.invalid/v1/knowledge/search', expect.objectContaining({ body,
      headers: expect.objectContaining({ 'X-Signature': 'synthetic-signature' }),
    }), expect.any(Object));
  });
  it('preserves a successful zero-hit result', async () => {
    const response = { ...result(), results: [] };
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data: response })));
    await expect(searchKnowledge({ collectionId: collection.id, query: '合成', releaseVersion: collection.releaseVersion })).resolves.toEqual(response);
  });
  it('retains backend error codes and request IDs instead of converting failures to zero hits', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: 'KNOWLEDGE_CONTENT_CHANGED', message: '知识内容已变化', requestId: 'SYNTHETIC-REQUEST' }), { status: 400 }));
    await expect(searchKnowledge({ collectionId: collection.id, query: '合成', releaseVersion: collection.releaseVersion })).rejects.toMatchObject({ code: 'KNOWLEDGE_CONTENT_CHANGED', requestId: 'SYNTHETIC-REQUEST' });
  });
});
