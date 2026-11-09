import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const clearResult = { diagnosisRows: 0, itemRows: 0, medicineRows: 0, syncStateRows: 0 };

async function loadServiceWithCurrentScope() {
  const { medicalDataService } = await import('./medicalData');
  await medicalDataService.setCatalogContext({ orgCode: 'ORG-CURRENT', tenantId: 'TENANT-CURRENT' });
  return medicalDataService;
}

function clearCalls() {
  return mocks.invoke.mock.calls.filter(([command]) => command === 'clear_medical_catalog_cache');
}

describe('medicalDataService.clearDebugCache scope', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
    mocks.invoke.mockReset();
    mocks.getHisAdapter.mockReset();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'load_medical_catalog_snapshot') return emptySnapshot;
      if (command === 'clear_medical_catalog_cache') return clearResult;
      return undefined;
    });
  });

  it('clears every scope without falling back to the current reception org', async () => {
    const service = await loadServiceWithCurrentScope();
    await service.clearDebugCache({ catalogType: 'all', allScopes: true, orgCode: 'IGNORED', storeId: 'IGNORED' });

    expect(clearCalls()).toEqual([[
      'clear_medical_catalog_cache',
      { catalogType: 'all', orgCode: undefined, tenantId: undefined, storeId: undefined },
    ]]);
  });

  it('does not mix the current tenant into an explicit org scope', async () => {
    const service = await loadServiceWithCurrentScope();
    await service.clearDebugCache({ catalogType: 'items', orgCode: 'ORG-OTHER' });

    expect(clearCalls()[0][1]).toEqual({
      catalogType: 'items', orgCode: 'ORG-OTHER', tenantId: undefined, storeId: undefined,
    });
  });

  it('keeps the current reception scope when no org is given', async () => {
    const service = await loadServiceWithCurrentScope();
    await service.clearDebugCache({ catalogType: 'medicines' });

    expect(clearCalls()[0][1]).toEqual({
      catalogType: 'medicines', orgCode: 'ORG-CURRENT', tenantId: 'TENANT-CURRENT', storeId: undefined,
    });
  });
});
