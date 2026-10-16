import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@services/updateConfig', () => ({ getActiveUpdateChannel: () => 'testing' }));
vi.mock('@services/updatePolicy', () => ({ getCurrentClientVersion: async () => '1.4.8', isUpdateRequiredCode: () => false, notifyForceUpdateRequired: vi.fn() }));
vi.mock('@services/requestSigner', () => ({ signRequest: vi.fn(async () => ({ 'X-Signature': 'synthetic-signature' })), updateSignatureClockOffset: () => false }));
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
import { getDrugInstruction, searchDrugInstructions } from './drugInstructions';

beforeEach(() => vi.clearAllMocks());
describe('drug instructions use the signed regional transport', () => {
  it('signs the declared search body and does not forward database credentials', async () => {
    const data = { current: 1, size: 20, hasMore: false, records: [] };
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data })));
    await expect(searchDrugInstructions({ keyword: '合成药', ...{ password: 'must-not-forward' } })).resolves.toEqual(data);
    const body = JSON.stringify({ keyword: '合成药', current: 1, size: 20 });
    expect(signRequest).toHaveBeenCalledWith('POST', '/v1/knowledge/drug-instructions/search', body);
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://synthetic.invalid/v1/knowledge/drug-instructions/search', expect.objectContaining({
      body, headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token', 'X-Signature': 'synthetic-signature' }),
    }), expect.any(Object));
  });
  it('signs the encoded detail path and preserves full summary text', async () => {
    const data = { productId: 'id 中文', summary: '【用法用量】\r\n' + '合成文本'.repeat(20000) };
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data })));
    await expect(getDrugInstruction(data.productId)).resolves.toEqual(data);
    expect(signRequest).toHaveBeenCalledWith('GET', `/v1/knowledge/drug-instructions/${encodeURIComponent(data.productId)}`, undefined);
  });
  it.each([['DRUG_INSTRUCTION_NOT_FOUND', 404], ['DRUG_INSTRUCTIONS_UNAVAILABLE', 503]])('retains %s and requestId instead of returning empty data', async (code, status) => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code, message: '合成错误', requestId: 'synthetic-request' }), { status }));
    await expect(getDrugInstruction('id')).rejects.toMatchObject({ code, requestId: 'synthetic-request' });
  });
});
