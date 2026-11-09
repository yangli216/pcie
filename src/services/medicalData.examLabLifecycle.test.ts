import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const emptySnapshot = {
  diagnoses: [],
  items: [],
  medicines: [],
};

function createAdapter(
  fetchInstitutionMedicalItemsCatalog = vi.fn().mockResolvedValue([]),
  fetchInstitutionTreatmentItemsCatalog = vi.fn().mockResolvedValue([]),
) {
  return {
    fetchInstitutionTreatmentItemsCatalog,
    getContextScope: vi.fn(() => ({ orgCode: 'ORG-1', tenantId: 'TENANT-1' })),
    getDefaultExecDeptId: vi.fn(() => 'DEPT-1'),
    fetchInstitutionMedicalItemsCatalog,
    fetchDiagnosisCatalog: vi.fn().mockResolvedValue([]),
    fetchMedicineStoreIds: vi.fn().mockResolvedValue([]),
    fetchInstitutionMedicineCatalog: vi.fn().mockResolvedValue([]),
    fetchAvailablePharmacies: vi.fn().mockResolvedValue([]),
  };
}

describe('medicalData exam/lab reception lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
    mocks.invoke.mockReset();
    mocks.getHisAdapter.mockReset();
    mocks.regionalGet.mockReset();
    mocks.invoke.mockImplementation(async (command: string) => (
      command === 'load_medical_catalog_snapshot' ? emptySnapshot : undefined
    ));
  });

  it('does not restore persisted exam/lab rows from SQLite or localStorage', async () => {
    localStorage.setItem('REGIONAL_MEDICAL_DATA_CACHE', JSON.stringify({
      diagnoses: [],
      tcmDiagnoses: [],
      tcmSyndromes: [],
      tcmTreatments: [],
      medicines: [],
      items: [
        { id: 'LOCAL-LAB', code: 'LOCAL-LAB', name: '本地检验', category: '检验' },
        { id: 'LOCAL-PROC', code: 'LOCAL-PROC', name: '本地处置', category: '治疗' },
      ],
    }));
    mocks.invoke.mockImplementation(async (command: string) => (
      command === 'load_medical_catalog_snapshot'
        ? {
            ...emptySnapshot,
            items: [
              { id: 'SQL-LAB', code: 'SQL-LAB', name: '持久化检验', category: '检验' },
              { id: 'SQL-PROC', code: 'SQL-PROC', name: '持久化处置', category: '治疗' },
            ],
            itemSyncDate: '2026-08-21',
          }
        : undefined
    ));

    const { medicalDataService } = await import('./medicalData');
    expect(medicalDataService.getAllItems().map((item) => item.id)).toEqual(['LOCAL-PROC']);

    await medicalDataService.setCatalogContext({ orgCode: 'ORG-1', tenantId: 'TENANT-1' });
    expect(medicalDataService.getAllItems().map((item) => item.id)).toEqual(['SQL-PROC']);
  });

  it('queries once per reception and preserves complete writeback fields in memory', async () => {
    const fetchItems = vi.fn().mockResolvedValue([
      {
        id: 'LAB-1',
        code: 'LAB-1',
        name: '血常规',
        category: '检验',
        idSrv: 'SRV-1',
        idDeptExec: 'DEP-EXEC-1',
        jsonField: '{"idLisCategory":"LIS-CATEGORY-1"}',
        mutualRecognitionCode: 'MR-1',
        raw: { idPart: 'PART-1' },
      },
    ]);
    mocks.getHisAdapter.mockReturnValue(createAdapter(fetchItems));

    const { medicalDataService } = await import('./medicalData');
    await medicalDataService.setCatalogContext({ orgCode: 'ORG-1', tenantId: 'TENANT-1' });
    const first = await medicalDataService.beginAvailableExamLabReception('VISIT-1');
    const reused = await medicalDataService.fetchAvailableExamLabItems();
    const duplicateEntry = await medicalDataService.beginAvailableExamLabReception('VISIT-1');
    await medicalDataService.setCatalogContext({ orgCode: 'ORG-1', tenantId: 'TENANT-1' });

    expect(fetchItems).toHaveBeenCalledTimes(1);
    expect(first).toEqual(reused);
    expect(reused).toEqual(duplicateEntry);
    expect(medicalDataService.getAllItems()).toEqual(first);
    expect(first[0]).toEqual(expect.objectContaining({
      idSrv: 'SRV-1',
      idDeptExec: 'DEP-EXEC-1',
      idPart: 'PART-1',
      jsonField: '{"idLisCategory":"LIS-CATEGORY-1"}',
      mutualRecognitionCode: 'MR-1',
    }));

    await medicalDataService.beginAvailableExamLabReception('VISIT-2');
    expect(fetchItems).toHaveBeenCalledTimes(2);
  });

  it('ignores an old reception response after the catalog lifecycle is cleared', async () => {
    let resolveItems: (items: Array<Record<string, unknown>>) => void = () => undefined;
    const fetchItems = vi.fn(() => new Promise<Array<Record<string, unknown>>>((resolve) => {
      resolveItems = resolve;
    }));
    mocks.getHisAdapter.mockReturnValue(createAdapter(fetchItems));

    const { medicalDataService } = await import('./medicalData');
    const pending = medicalDataService.beginAvailableExamLabReception('VISIT-1');
    medicalDataService.clearAvailableExamLabItems();
    resolveItems([{ id: 'LATE-LAB', code: 'LATE-LAB', name: '迟到检验', category: '检验' }]);

    await expect(pending).resolves.toEqual([]);
    expect(medicalDataService.getAllItems()).toEqual([]);
  });

  it('filters exam/lab rows before writing the remaining item catalog to SQLite', async () => {
    // 治疗目录理论上已在 HIS 映射层丢弃检查检验；这里仍混入一条检验，验证写库前的防御性过滤。
    const fetchTreatmentItems = vi.fn().mockResolvedValue([
      { id: 'LAB-1', code: 'LAB-1', name: '血常规', category: '检验' },
      { id: 'PROC-1', code: 'PROC-1', name: '雾化治疗', category: '治疗' },
    ]);
    const fetchExamLabItems = vi.fn().mockResolvedValue([]);
    mocks.getHisAdapter.mockReturnValue(createAdapter(fetchExamLabItems, fetchTreatmentItems));

    const { medicalDataService } = await import('./medicalData');
    await medicalDataService.setCatalogContext(
      { orgCode: 'ORG-1', tenantId: 'TENANT-1' },
      { force: true },
    );

    expect(mocks.invoke).toHaveBeenCalledWith(
      'replace_org_medical_item_catalog',
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'PROC-1', category: '治疗' })],
      }),
    );
    expect(medicalDataService.getAllItems().map((item) => item.id)).toEqual(['PROC-1']);
  });
});
