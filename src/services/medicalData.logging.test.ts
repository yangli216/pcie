import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getHisAdapter: vi.fn(),
  regionalGet: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('./his', () => ({
  getHisAdapter: mocks.getHisAdapter,
}));

vi.mock('./regionalClient', () => ({
  regionalGet: mocks.regionalGet,
}));

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const emptySnapshot = {
  diagnoses: [],
  items: [],
  medicines: [],
};

function serializeConsoleCalls(log: ReturnType<typeof vi.spyOn>, warn: ReturnType<typeof vi.spyOn>): string {
  return JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
}

describe('medicalData console privacy', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
    mocks.invoke.mockReset();
    mocks.getHisAdapter.mockReset();
    mocks.regionalGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps real catalog scope in requests but logs only boolean and count summaries', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.invoke.mockImplementation(async (command: string) => (
      command === 'load_medical_catalog_snapshot' ? emptySnapshot : undefined
    ));

    const adapter = {
      fetchDiagnosisCatalog: vi.fn().mockResolvedValue([
        { id: 'D-1', code: 'A00', name: '诊断一' },
      ]),
      fetchInstitutionMedicalItemsCatalog: vi.fn().mockResolvedValue([
        { id: 'I-1', code: 'ITEM-1', name: '检查一', category: '检查' },
      ]),
      fetchInstitutionTreatmentItemsCatalog: vi.fn().mockResolvedValue([
        { id: 'T-1', code: 'TREAT-1', name: '治疗一', category: '治疗' },
      ]),
      fetchMedicineStoreIds: vi.fn().mockResolvedValue(['STORE-SENTINEL-A', 'STORE-SENTINEL-B']),
      fetchInstitutionMedicineCatalog: vi.fn().mockResolvedValue([
        { id: 'M-1', name: '药品一', spec: '1mg' },
      ]),
      fetchAvailablePharmacies: vi.fn().mockResolvedValue([
        { idSto: 'STORE-SENTINEL-A', name: '药房一' },
      ]),
    };
    mocks.getHisAdapter.mockReturnValue(adapter);

    const { medicalDataService } = await import('./medicalData');
    await medicalDataService.setCatalogContext({
      orgCode: 'ORG-SENTINEL',
      tenantId: 'TENANT-SENTINEL',
    }, { force: true });

    expect(adapter.fetchInstitutionTreatmentItemsCatalog).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(
      'replace_org_medical_item_catalog',
      expect.objectContaining({ orgCode: 'ORG-SENTINEL', tenantId: 'TENANT-SENTINEL' }),
    );
    expect(adapter.fetchMedicineStoreIds).toHaveBeenCalledWith('ORG-SENTINEL');
    expect(adapter.fetchInstitutionMedicineCatalog).toHaveBeenCalledWith('ORG-SENTINEL');
    expect(mocks.invoke).toHaveBeenCalledWith(
      'load_medical_catalog_snapshot',
      expect.objectContaining({
        orgCode: 'ORG-SENTINEL',
        tenantId: 'TENANT-SENTINEL',
      }),
    );
    expect(mocks.invoke).toHaveBeenCalledWith(
      'replace_org_medicine_catalog',
      expect.objectContaining({
        orgCode: 'ORG-SENTINEL',
        tenantId: 'TENANT-SENTINEL',
        storeIds: ['STORE-SENTINEL-A', 'STORE-SENTINEL-B'],
      }),
    );

    const serializedLogs = serializeConsoleCalls(log, warn);
    expect(serializedLogs).not.toContain('ORG-SENTINEL');
    expect(serializedLogs).not.toContain('TENANT-SENTINEL');
    expect(serializedLogs).not.toContain('STORE-SENTINEL');
    expect(serializedLogs).toContain('hasOrgCode');
    expect(serializedLogs).toContain('hasTenantId');
    expect(serializedLogs).toContain('storeCount');
    expect(serializedLogs).toContain('itemCount');
  });

  it('does not log raw scope or error sentinels on catalog sync failures', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'load_medical_catalog_snapshot') {
        return emptySnapshot;
      }
      throw new Error('IPC-ERROR-SENTINEL');
    });

    const adapter = {
      fetchDiagnosisCatalog: vi.fn().mockRejectedValue(new Error('DIAGNOSIS-ERROR-SENTINEL')),
      fetchInstitutionMedicalItemsCatalog: vi.fn().mockRejectedValue(new Error('ITEM-ERROR-SENTINEL')),
      fetchInstitutionTreatmentItemsCatalog: vi.fn().mockRejectedValue(new Error('TREATMENT-ERROR-SENTINEL')),
      fetchMedicineStoreIds: vi.fn().mockRejectedValue(new Error('STORE-ERROR-SENTINEL')),
      fetchInstitutionMedicineCatalog: vi.fn().mockRejectedValue(new Error('MEDICINE-ERROR-SENTINEL')),
      fetchAvailablePharmacies: vi.fn().mockRejectedValue(new Error('PHARMACY-ERROR-SENTINEL')),
    };
    mocks.getHisAdapter.mockReturnValue(adapter);

    const { medicalDataService } = await import('./medicalData');
    // 强制同步失败须整体报错（不再伪成功）；错误文本同样不得带出机构或原始错误。
    const failure = await medicalDataService.setCatalogContext({
      orgCode: 'ORG-FAILURE-SENTINEL',
      tenantId: 'TENANT-FAILURE-SENTINEL',
    }, { force: true }).then(() => null, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);

    const serializedLogs = serializeConsoleCalls(log, warn);
    const failureMessage = (failure as Error).message;
    for (const sentinel of [
      'ORG-FAILURE-SENTINEL',
      'TENANT-FAILURE-SENTINEL',
      'IPC-ERROR-SENTINEL',
      'DIAGNOSIS-ERROR-SENTINEL',
      'ITEM-ERROR-SENTINEL',
      'TREATMENT-ERROR-SENTINEL',
      'STORE-ERROR-SENTINEL',
      'MEDICINE-ERROR-SENTINEL',
      'PHARMACY-ERROR-SENTINEL',
    ]) {
      expect(serializedLogs).not.toContain(sentinel);
      expect(failureMessage).not.toContain(sentinel);
    }
  });
});
