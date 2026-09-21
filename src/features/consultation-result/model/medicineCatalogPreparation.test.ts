// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HisAdapter } from '@/services/his';
import { createMedicineCatalogPreparation } from './medicineCatalogPreparation';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getHisAdapter: vi.fn(), regionalGet: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@/services/his', () => ({ getHisAdapter: mocks.getHisAdapter }));
vi.mock('@/services/regionalClient', () => ({ regionalGet: mocks.regionalGet }));

function adapter(orgCode = 'org-1', tenantId = 'tenant-1', vendor = 'mock') {
  return {
    vendor,
    getContextScope: () => ({ orgCode, tenantId }),
    fetchInstitutionMedicineCatalog: vi.fn(),
  } as unknown as HisAdapter;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  mocks.invoke.mockReset();
  mocks.getHisAdapter.mockReset();
  mocks.regionalGet.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('medicine catalog preparation', () => {
  it('coalesces concurrent prewarm and click, but re-enters freshness checks after completion', async () => {
    let release!: () => void;
    const load = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const prepare = createMedicineCatalogPreparation(load);
    const his = adapter();
    const prewarm = prepare(['b', ' a ', 'a'], his);
    const click = prepare(['a', 'b'], his);
    expect(click).toBe(prewarm);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(['a', 'b'], his);
    release();
    await prewarm;
    const retry = prepare(['a', 'b'], his);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    release();
    await retry;
  });

  it('releases a rejected request so the next operation can retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const prepare = createMedicineCatalogPreparation(load);
    await expect(prepare(['store-1'], adapter())).rejects.toThrow('offline');
    await expect(prepare(['store-1'], adapter())).resolves.toBeUndefined();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not share in-flight work across vendor, organization, tenant or stores', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const load = vi.fn(() => pending);
    const prepare = createMedicineCatalogPreparation(load);
    const requests = [
      prepare(['a'], adapter()),
      prepare(['a'], adapter('org-2')),
      prepare(['a'], adapter('org-1', 'tenant-2')),
      prepare(['a'], adapter('org-1', 'tenant-1', 'other')),
      prepare(['b'], adapter()),
    ];
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(5);
    release();
    await Promise.all(requests);
  });
});

describe('preparation with the real medical catalog service', () => {
  const emptySnapshot = { diagnoses: [], items: [], medicines: [] };
  const medicine = { id: 'med-1', name: '药品一', spec: '1mg', storeIds: ['store-1'] };

  it.each(['network failure', 'empty response'])('retries after %s resolves without a catalog', async (failure) => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'load_medical_catalog_snapshot' ? emptySnapshot : undefined);
    const his = adapter();
    const fetch = vi.mocked(his.fetchInstitutionMedicineCatalog);
    if (failure === 'network failure') fetch.mockRejectedValueOnce(new Error('offline'));
    else fetch.mockResolvedValueOnce([]);
    fetch.mockResolvedValueOnce([medicine]);
    const { medicalDataService } = await import('@/services/medicalData');
    const prepare = createMedicineCatalogPreparation((stores, source) =>
      medicalDataService.ensureMedicineCatalogForStoreIds(stores, source));

    await prepare(['store-1'], his);
    expect(medicalDataService.getMatchableMedicines()).toEqual([]);
    await prepare(['store-1'], his);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(medicalDataService.getMatchableMedicines().map(item => item.id)).toEqual(['med-1']);
  });

  it('reuses fresh SQLite data without querying HIS, and reloads after the cache is cleared', async () => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    let hasCache = true;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command !== 'load_medical_catalog_snapshot') return undefined;
      return hasCache ? { ...emptySnapshot, medicines: [medicine], medicineSyncDate: today } : emptySnapshot;
    });
    const his = adapter();
    vi.mocked(his.fetchInstitutionMedicineCatalog).mockResolvedValue([medicine]);
    const { medicalDataService } = await import('@/services/medicalData');
    const prepare = createMedicineCatalogPreparation((stores, source) =>
      medicalDataService.ensureMedicineCatalogForStoreIds(stores, source));
    await prepare(['store-1'], his);
    await prepare(['store-1'], his);
    expect(his.fetchInstitutionMedicineCatalog).not.toHaveBeenCalled();
    expect(medicalDataService.getMatchableMedicines().map(item => item.id)).toEqual(['med-1']);

    hasCache = false;
    await medicalDataService.clearDebugCache({ catalogType: 'medicines' });
    await prepare(['store-1'], his);
    expect(his.fetchInstitutionMedicineCatalog).toHaveBeenCalledTimes(1);
    expect(medicalDataService.getMatchableMedicines().map(item => item.id)).toEqual(['med-1']);
  });
});
