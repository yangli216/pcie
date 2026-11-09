import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatUserFacingError } from '@shared/lib/errorMessages';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getHisAdapter: vi.fn(),
  regionalGet: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./his', () => ({ getHisAdapter: mocks.getHisAdapter }));
vi.mock('./regionalClient', () => ({ regionalGet: mocks.regionalGet }));

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const emptySnapshot = { diagnoses: [], items: [], medicines: [] };
const http502 = () => Promise.reject(new Error('HIS HTTP Error: 502'));

function createAdapter(overrides: Record<string, unknown> = {}) {
  return {
    getContextScope: vi.fn(() => ({ orgCode: 'ORG-1', tenantId: 'TENANT-1' })),
    getDefaultExecDeptId: vi.fn(() => 'DEPT-1'),
    fetchDiagnosisCatalog: vi.fn().mockResolvedValue([{ id: 'D1', code: 'J00', name: '急性鼻咽炎' }]),
    fetchInstitutionMedicalItemsCatalog: vi.fn().mockResolvedValue([{ id: 'L1', code: 'L1', name: '血常规', category: '检验' }]),
    fetchInstitutionTreatmentItemsCatalog: vi.fn().mockResolvedValue([{ id: 'P1', code: 'P1', name: '雾化治疗', category: '治疗' }]),
    fetchMedicineStoreIds: vi.fn().mockResolvedValue(['STO-1']),
    fetchInstitutionMedicineCatalog: vi.fn().mockResolvedValue([{ id: 'M1', code: 'M1', name: '阿莫西林胶囊', storeIds: ['STO-1'] }]),
    fetchAvailablePharmacies: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function persistCalls(command: string) {
  return mocks.invoke.mock.calls.filter(([name]) => name === command);
}

async function loadService() {
  const { medicalDataService } = await import('./medicalData');
  await medicalDataService.setCatalogContext({ orgCode: 'ORG-1', tenantId: 'TENANT-1' });
  return medicalDataService;
}

describe('medicalDataService forced catalog sync failures', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
    mocks.invoke.mockReset();
    mocks.getHisAdapter.mockReset();
    mocks.invoke.mockImplementation(async (command: string) => (
      command === 'load_medical_catalog_snapshot' ? emptySnapshot : undefined
    ));
  });

  it('reports every failed catalog instead of claiming success when HIS returns 502', async () => {
    mocks.getHisAdapter.mockReturnValue(createAdapter({
      fetchDiagnosisCatalog: vi.fn(http502),
      fetchInstitutionTreatmentItemsCatalog: vi.fn(http502),
      fetchInstitutionMedicineCatalog: vi.fn(http502),
    }));
    const service = await loadService();

    const error = await service.ensureLocalCatalogsSynced({ force: true }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('诊断目录（HIS 返回 HTTP 502）');
    expect(message).toContain('其他诊疗项目（HIS 返回 HTTP 502）');
    expect(message).toContain('药品目录（HIS 返回 HTTP 502）');
    expect(persistCalls('replace_diagnosis_catalog')).toHaveLength(0);
    expect(persistCalls('replace_org_medical_item_catalog')).toHaveLength(0);
    expect(persistCalls('replace_org_medicine_catalog')).toHaveLength(0);
    expect(formatUserFacingError(error)).toBe(message);
  });

  it('persists the catalogs that succeeded and names only the failed one', async () => {
    mocks.getHisAdapter.mockReturnValue(createAdapter({
      fetchInstitutionMedicineCatalog: vi.fn(() => Promise.reject(new Error('error sending request: operation timed out'))),
    }));
    const service = await loadService();

    const error = await service.ensureLocalCatalogsSynced({ force: true }).catch((caught: unknown) => caught);

    const message = (error as Error).message;
    expect(message).toContain('药品目录（连接 HIS 超时）');
    expect(message).not.toContain('诊断目录');
    expect(message).not.toContain('其他诊疗项目');
    expect(persistCalls('replace_diagnosis_catalog')).toHaveLength(1);
    expect(persistCalls('replace_org_medical_item_catalog')).toHaveLength(1);
    expect(formatUserFacingError(error)).toBe(message);
  });

  it('keeps HIS business hints but never exposes request URLs', async () => {
    mocks.getHisAdapter.mockReturnValue(createAdapter({
      fetchDiagnosisCatalog: vi.fn(() => Promise.reject(new Error(
        '[HisService] /rbmh-phis/api/phis.aiAdapterService/queryDiagnosisCatalog failed: 无查询权限 (code=500)',
      ))),
      fetchInstitutionTreatmentItemsCatalog: vi.fn(() => Promise.reject(new Error(
        '[HisService] Missing tk token, request blocked: http://10.0.0.8:8080/rbmh-phis/api/x',
      ))),
    }));
    const service = await loadService();

    const message = await service.ensureLocalCatalogsSynced({ force: true })
      .then(() => '', (error: Error) => error.message);

    expect(message).toContain('诊断目录（HIS 业务失败：无查询权限（code=500））');
    expect(message).toContain('其他诊疗项目（缺少 HIS 登录令牌，请重新从 HIS 发起握手）');
    expect(message).not.toContain('rbmh-phis');
    expect(message).not.toContain('10.0.0.8');
  });

  it('resolves when every forced catalog sync succeeds and persists treatment items only', async () => {
    const adapter = createAdapter();
    mocks.getHisAdapter.mockReturnValue(adapter);
    const service = await loadService();

    await expect(service.ensureLocalCatalogsSynced({ force: true })).resolves.toBeUndefined();
    expect(persistCalls('replace_org_medicine_catalog')).toHaveLength(1);
    expect(adapter.fetchInstitutionTreatmentItemsCatalog).toHaveBeenCalledTimes(1);
    expect(adapter.fetchInstitutionMedicalItemsCatalog).not.toHaveBeenCalled();
    const [, itemPayload] = persistCalls('replace_org_medical_item_catalog')[0];
    expect((itemPayload as { items: Array<{ id: string }> }).items.map((item) => item.id)).toEqual(['P1']);
  });

  it('keeps non-forced calls cache-only without contacting HIS', async () => {
    const adapter = createAdapter({ fetchDiagnosisCatalog: vi.fn(http502) });
    mocks.getHisAdapter.mockReturnValue(adapter);
    const service = await loadService();

    await expect(service.ensureLocalCatalogsSynced()).resolves.toBeUndefined();
    expect(adapter.fetchDiagnosisCatalog).not.toHaveBeenCalled();
  });
});
