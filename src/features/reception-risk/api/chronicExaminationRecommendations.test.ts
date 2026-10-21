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
import { getHisAdapter } from '@/services/his';
vi.mock('@/services/his', () => ({ getHisAdapter: vi.fn(() => null) }));
import { medicalDataService } from '@/services/medicalData';
import { buildPatientContext } from '@/utils/patientContext';
import { loadChronicExaminationRecommendations } from './chronicExaminationRecommendations';
import type { ChronicRefillCandidate } from '../lib/chronicRefillAssessment';
vi.mock('@/services/medicalData', () => ({ medicalDataService: { fetchAvailableExamLabItems: vi.fn() } }));
const path = '/v1/client/chronic-disease/examination-recommendations/query';
const patient = () => buildPatientContext({ payload: { patientId: 'p', visitId: 'v', idCard: 'synthetic-id' } })!;
const candidate: ChronicRefillCandidate = { diagnosis: '高血压', diagnoses: ['高血压'], diagnosisGroups: ['高血压'], medications: [],
  chronicVisitCount: 1, chronicVisits: [], prescriptionHistoryVisits: [], diagnosisEvidenceText: '', medicationEvidenceText: '', evidenceText: '' };
const response = () => ({ patientId: 'p', visitId: 'v', source: 'getUserInfo', recommendations: [{ name: '血脂', description: '', subItems: [] }],
  regionalHistory: { status: 'not_connected', records: [] } });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getHisAdapter).mockReturnValue(null);
  vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValue([{ id: 'lab', code: 'lab', name: '血脂', category: '检验' }]);
});
function respond(value: unknown) { vi.mocked(fetchWithTimeout).mockResolvedValue(new Response(JSON.stringify({ code: '0', data: value }))); }
describe('signed chronic examination API', () => {
  it('signs exact patient/visit identity and uses the live reception catalog', async () => {
    respond(response());
    const result = await loadChronicExaminationRecommendations(patient(), candidate);
    expect(signRequest).toHaveBeenCalledWith('POST', path, JSON.stringify({ patientId: 'p', visitId: 'v', idCard: 'synthetic-id' }));
    expect(fetchWithTimeout).toHaveBeenCalledWith('https://synthetic.invalid' + path, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer synthetic-token', 'X-Signature': 'synthetic-signature' }),
    }), expect.any(Object));
    expect(result.treatments[0]).toMatchObject({ type: 'labTest', selected: false });
    expect(medicalDataService.fetchAvailableExamLabItems).toHaveBeenCalledOnce();
  });
  it('keeps zero recommendations, missing identity and failed query distinct', async () => {
    respond({ ...response(), recommendations: [] });
    expect((await loadChronicExaminationRecommendations(patient(), candidate)).reminders.sourceStatus).toBe('ready');
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('synthetic failure'));
    expect((await loadChronicExaminationRecommendations(patient(), candidate)).reminders.sourceStatus).toBe('unavailable');
    vi.clearAllMocks();
    expect((await loadChronicExaminationRecommendations({ ...patient(), idCard: '', demographics: { ...patient().demographics, idCard: '' } }, candidate)).reminders.sourceStatus).toBe('missing_identity');
    expect(signRequest).not.toHaveBeenCalled();
  });
  it.each([{ patientId: 'other' }, { visitId: 'other' }, { recommendations: null }, { source: 'other' }])('rejects mismatched or invalid response identity: %s', async (patch) => {
    respond({ ...response(), ...patch });
    const result = await loadChronicExaminationRecommendations(patient(), candidate);
    expect(result.reminders.sourceStatus).toBe('unavailable');
    expect(result.treatments).toEqual([]);
  });
  it('discards an old catalog if the HIS organization or department changes while the source is pending', async () => {
    let department = 'dept-1';
    const adapter = { vendor: 'synthetic', getContextScope: () => ({ orgCode: 'org-1' }), getDefaultExecDeptId: () => department };
    vi.mocked(getHisAdapter).mockReturnValue(adapter as any);
    let resolveResponse!: (value: Response) => void;
    vi.mocked(fetchWithTimeout).mockReturnValue(new Promise((resolve) => { resolveResponse = resolve; }));
    const pending = loadChronicExaminationRecommendations(patient(), candidate);
    await vi.waitFor(() => expect(fetchWithTimeout).toHaveBeenCalledOnce());
    department = 'dept-2';
    resolveResponse(new Response(JSON.stringify({ code: '0', data: response() })));
    const result = await pending;
    expect(result.treatments).toEqual([]);
    expect(result.reminders.catalogStatus).toBe('unavailable');
  });
  it('keeps a failed live catalog read separate from recommendation success', async () => {
    respond(response());
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockRejectedValue(new Error('synthetic unavailable'));
    const result = await loadChronicExaminationRecommendations(patient(), candidate);
    expect(result.reminders).toMatchObject({ sourceStatus: 'ready', catalogStatus: 'unavailable' });
    expect(result.treatments).toEqual([]);
  });
});
