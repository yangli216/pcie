import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  regionalGet: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('./regionalClient', () => ({ regionalGet: mocks.regionalGet }));
vi.mock('./his', () => ({ getHisAdapter: vi.fn(() => null) }));

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const emptySnapshot = { diagnoses: [], items: [], medicines: [] };

describe('medicalData diagnosis catalog readiness', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', new MemoryStorage());
    mocks.invoke.mockReset();
    mocks.regionalGet.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('single-flights SQLite cache restoration before diagnosis matching', async () => {
    let releaseSnapshot!: (value: unknown) => void;
    mocks.invoke.mockImplementation(() => new Promise(resolve => { releaseSnapshot = resolve; }));
    const { medicalDataService } = await import('./medicalData');

    const first = medicalDataService.ensureDiagnosisCatalogReady();
    const second = medicalDataService.ensureDiagnosisCatalogReady();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);

    releaseSnapshot({
      ...emptySnapshot,
      diagnoses: [{ id: 'dx-1', code: 'J06.9', name: '急性上呼吸道感染' }],
    });
    await Promise.all([first, second]);

    expect(medicalDataService.getAllDiagnoses()).toHaveLength(1);
    expect(mocks.regionalGet).not.toHaveBeenCalled();
  });

  it('reuses an in-flight regional sync when the SQLite cache is empty', async () => {
    mocks.invoke.mockResolvedValue(emptySnapshot);
    let releaseRemote!: (value: unknown) => void;
    mocks.regionalGet.mockImplementation(() => new Promise(resolve => { releaseRemote = resolve; }));
    const { medicalDataService } = await import('./medicalData');

    const startupSync = medicalDataService.syncRemoteData();
    const readiness = medicalDataService.ensureDiagnosisCatalogReady();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.regionalGet).toHaveBeenCalledTimes(1);

    releaseRemote({
      version: 'diagnosis-v1',
      diagnoses: 'id,code,name,keywords\ndx-1,J06.9,急性上呼吸道感染,',
    });
    await Promise.all([startupSync, readiness]);

    expect(mocks.regionalGet).toHaveBeenCalledTimes(1);
    expect(medicalDataService.getAllDiagnoses()[0]).toMatchObject({ id: 'dx-1', code: 'J06.9' });
  });

  it('rejects readiness instead of allowing an empty catalog match', async () => {
    mocks.invoke.mockResolvedValue(emptySnapshot);
    mocks.regionalGet.mockResolvedValue({ version: 'unchanged' });
    const { medicalDataService } = await import('./medicalData');

    await expect(medicalDataService.ensureDiagnosisCatalogReady())
      .rejects.toThrow('基础诊断目录尚未加载完成');
    expect(medicalDataService.getAllDiagnoses()).toHaveLength(0);
  });
});
