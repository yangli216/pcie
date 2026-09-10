import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: mocks.fetch,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('./hisIntegrationLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hisIntegrationLog')>();
  return {
    ...actual,
    createHisTraceId: () => 'his-trace-safe',
  };
});

import { HisService } from './hisService';

describe('HisService logging projection', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    mocks.invoke.mockReset();
    mocks.invoke.mockResolvedValue('log-id');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the original URL and body for the request without exposing them in console or persisted log input', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rawBody = [{
      idPi: 'PATIENT-ID-SENTINEL',
      idVis: 'VISIT-ID-SENTINEL',
      admissionId: 'ADMISSION-ID-SENTINEL',
      patientName: 'PATIENT-NAME-SENTINEL',
      doctorName: 'DOCTOR-NAME-SENTINEL',
      token: 'BODY-TOKEN-SENTINEL',
      opaqueAlias: {
        nestedUnknown: 'UNKNOWN-NESTED-SENTINEL',
        numericIdentity: 987654321,
      },
    }];
    const rawUrl = 'https://URL-USER-SENTINEL:URL-PASSWORD-SENTINEL@his.example:8443/root/'
      + 'api/patient?patientName=QUERY-SENTINEL#FRAGMENT-SENTINEL';
    mocks.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        code: 200,
        body: {
          patientName: 'RESPONSE-PATIENT-SENTINEL',
          doctorName: 'RESPONSE-DOCTOR-SENTINEL',
        },
      }),
    });

    const service = new HisService(
      'https://URL-USER-SENTINEL:URL-PASSWORD-SENTINEL@his.example:8443/root/',
      'HEADER-TOKEN-SENTINEL',
    );
    const response = await service.post(
      'api/patient?patientName=QUERY-SENTINEL#FRAGMENT-SENTINEL',
      rawBody,
    );

    expect(mocks.fetch).toHaveBeenCalledWith(rawUrl, expect.objectContaining({
      body: JSON.stringify(rawBody),
      headers: expect.objectContaining({
        Authorization: 'Bearer HEADER-TOKEN-SENTINEL',
      }),
    }));
    expect(response.body).toEqual({
      patientName: 'RESPONSE-PATIENT-SENTINEL',
      doctorName: 'RESPONSE-DOCTOR-SENTINEL',
    });

    const serializedLogs = JSON.stringify([
      ...log.mock.calls,
      ...error.mock.calls,
      ...mocks.invoke.mock.calls,
    ]);
    for (const secret of [
      'URL-USER-SENTINEL',
      'URL-PASSWORD-SENTINEL',
      'his.example',
      'QUERY-SENTINEL',
      'FRAGMENT-SENTINEL',
      'PATIENT-ID-SENTINEL',
      'VISIT-ID-SENTINEL',
      'ADMISSION-ID-SENTINEL',
      'PATIENT-NAME-SENTINEL',
      'DOCTOR-NAME-SENTINEL',
      'BODY-TOKEN-SENTINEL',
      'HEADER-TOKEN-SENTINEL',
      'RESPONSE-PATIENT-SENTINEL',
      'RESPONSE-DOCTOR-SENTINEL',
      'UNKNOWN-NESTED-SENTINEL',
      '987654321',
    ]) {
      expect(serializedLogs).not.toContain(secret);
    }
    expect(mocks.invoke).toHaveBeenCalledWith('record_his_integration_log', {
      entry: expect.objectContaining({
        operation: '/root/api/patient',
        path: '/root/api/patient',
        url: '/root/api/patient',
        requestSummary: {
          type: 'array',
          length: 1,
          itemTypes: { object: 1 },
        },
      }),
    });
  });
});

describe('HisService queryPatientVisitHistory', () => {
  it('passes current idVis so PHIS excludes the active visit', async () => {
    const service = new HisService('http://localhost/', 'token');
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: { items: [] },
    });

    await service.queryPatientVisitHistory('patient-1', {
      limit: 1000,
      idVis: 'visit-current',
      dtBgn: ['2026-05-06 00:00:00', '2026-08-04 23:59:59'],
    });

    expect(post).toHaveBeenCalledWith(
      'api/phis.aiAdapterService/queryVisitHistory',
      [{
        limit: 1000,
        params: {
          idPi: 'patient-1',
          idVis: 'visit-current',
          dtBgn: ['2026-05-06 00:00:00', '2026-08-04 23:59:59'],
        },
      }],
    );
  });
});

describe('HisService fetchFrequencyDictionary', () => {
  it('passes an argument array through the AI adapter service', async () => {
    const service = new HisService('http://localhost/', 'token');
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: { items: [] },
    });

    await service.fetchFrequencyDictionary();

    expect(post).toHaveBeenCalledWith(
      'api/phis.aiAdapterService/frequency',
      [{}],
    );
  });
});

describe('HisService buildOutpatientFollowUpReportResults', () => {
  it('calls the dedicated AI context service for report results only', async () => {
    const service = new HisService('http://localhost/', 'token');
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        followUpEligible: true,
        labReports: [],
        examReports: [{ examName: '胸部CT', conclusion: '未见明显异常。' }],
        ineligibleReason: null,
      },
    });

    await service.buildOutpatientFollowUpReportResults({
      patientId: 'patient-1',
      currentVisitId: 'visit-current',
      contextPolicy: {
        maxLabReports: 6,
        maxExamReports: 6,
      },
    });

    expect(post).toHaveBeenCalledWith(
      'api/phis.aiInpatientEmrContextService/buildOutpatientFollowUpReportResults',
      [{
        patientId: 'patient-1',
        currentVisitId: 'visit-current',
        contextPolicy: {
          maxLabReports: 6,
          maxExamReports: 6,
        },
      }],
    );
  });
});

describe('HisService fetchInstitutionMedicalItemsCatalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the AI context service exam/lab catalog instead of the synchronized institution catalog', async () => {
    const service = new HisService('http://localhost/', 'token');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const post = vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        items: [
          {
            id: 'EXAM-ID-SENTINEL',
            code: 'EXAM-CODE-SENTINEL',
            name: 'EXAM-NAME-SENTINEL',
            category: 'EXAM-CATEGORY-SENTINEL',
            idSrv: 'EXAM-SERVICE-SENTINEL',
          },
          {
            id: 'LAB-ID-SENTINEL',
            code: 'LAB-CODE-SENTINEL',
            name: 'LAB-NAME-SENTINEL',
            category: 'LAB-CATEGORY-SENTINEL',
            idSrv: 'LAB-SERVICE-SENTINEL',
            mutualRecognitionCode: 'MUTUAL-CODE-SENTINEL',
          },
        ],
        examinationCount: 1,
        labTestCount: 1,
        total: 2,
      },
    });

    const result = await service.fetchInstitutionMedicalItemsCatalog('ORG-CODE-SENTINEL');

    expect(post).toHaveBeenCalledWith(
      'api/phis.aiInpatientEmrContextService/queryAvailableExamLabItems',
      [{ orgCode: 'ORG-CODE-SENTINEL' }],
    );
    expect(result.map((item) => [item.name, item.category])).toEqual([
      ['EXAM-NAME-SENTINEL', 'EXAM-CATEGORY-SENTINEL'],
      ['LAB-NAME-SENTINEL', 'LAB-CATEGORY-SENTINEL'],
    ]);
    expect(result[1].mutualRecognitionCode).toBe('MUTUAL-CODE-SENTINEL');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith('[HisService] Available exam/lab catalog summary', {
      rawCount: 2,
      normalizedCount: 2,
    });
  });
});

describe('HisService high-level log privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs diagnosis catalog counts without a diagnosis sample', async () => {
    const service = new HisService('http://localhost/', 'token');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        total: 1,
        items: [{
          idDie: 'DIAGNOSIS-ID-SENTINEL',
          cdIcd: 'DIAGNOSIS-CODE-SENTINEL',
          naIcd: 'DIAGNOSIS-NAME-SENTINEL',
          py: 'DIAGNOSIS-PINYIN-SENTINEL',
        }],
      },
    });

    const result = await service.fetchDiagnosisCatalog();

    expect(result[0]?.name).toBe('DIAGNOSIS-NAME-SENTINEL');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith('[HisService] Diagnosis catalog summary', {
      total: 1,
      pageCount: 1,
      rawCount: 1,
      inactiveFiltered: 0,
      normalizedCount: 1,
    });
  });

  it('logs medicine catalog counts without org, store, or medicine samples', async () => {
    const service = new HisService('http://localhost/', 'token');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(service, 'fetchMedicineStoreIds').mockResolvedValue(['STORE-ID-SENTINEL']);
    vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        items: [{
          idMedPro: 'MEDICINE-ID-SENTINEL',
          naMedPro: 'MEDICINE-NAME-SENTINEL',
          sdMed: '1',
          fgActive: '1',
          idDeptExec: 'EXEC-DEPT-SENTINEL',
        }],
      },
    });

    const result = await service.fetchInstitutionMedicineCatalog('ORG-CODE-SENTINEL');

    expect(result[0]?.name).toBe('MEDICINE-NAME-SENTINEL');
    expect(result[0]?.storeIds).toEqual(['STORE-ID-SENTINEL']);
    expect(result[0]?.sdSrv).toBe('11');
    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith('[HisService] Medicine catalog summary', {
      storeCount: 1,
      responseCount: 1,
      mergedCount: 1,
      inactiveFiltered: 0,
      sdMedFiltered: 0,
      missingNameCount: 0,
      normalizedCount: 1,
    });
  });

  it('maps PHIS Chinese patent medicines to sdSrv=12 in the live catalog', async () => {
    const service = new HisService('http://localhost/', 'token');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(service, 'fetchMedicineStoreIds').mockResolvedValue(['STORE-1']);
    vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        items: [{
          idMedPro: 'MED-CHINESE-1',
          naMedPro: '速效救心丸',
          sdMed: '2',
          fgActive: '1',
        }],
      },
    });

    const result = await service.fetchInstitutionMedicineCatalog('ORG-1');

    expect(result[0]?.sdSrv).toBe('12');
    expect(result[0]?.raw).toMatchObject({ sdMed: '2' });
  });

  it('logs pharmacy counts without role departments, stores, or raw samples', async () => {
    const service = new HisService('http://localhost/', 'token', {
      userRoleDeptIds: ['ROLE-DEPT-SENTINEL'],
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(service, 'post').mockResolvedValue({
      code: 200,
      body: {
        items: [{
          sdDisp: '1',
          sdUse: '1',
          idDept: 'ROLE-DEPT-SENTINEL',
          idSto: 'STORE-ID-SENTINEL',
          naSto: 'PHARMACY-NAME-SENTINEL',
          idDeptText: 'DEPT-NAME-SENTINEL',
        }],
      },
    });

    const result = await service.fetchAvailablePharmacies();

    expect(result).toEqual([{
      name: 'PHARMACY-NAME-SENTINEL',
      idDept: 'ROLE-DEPT-SENTINEL',
      idSto: 'STORE-ID-SENTINEL',
    }]);
    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith('[HisService] Pharmacy filter summary', {
      rawCount: 1,
      sdDispFiltered: 0,
      sdUseFiltered: 0,
      deptFiltered: 0,
      deptBypassed: 0,
      roleDeptCount: 1,
      matchedCount: 1,
    });
  });

  it('logs only counts for both medicine store selection branches', async () => {
    const availableService = new HisService('http://localhost/', 'token');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(availableService, 'fetchAvailablePharmacies').mockResolvedValue([{
      name: 'PHARMACY-NAME-SENTINEL',
      idDept: 'DEPT-ID-SENTINEL',
      idSto: 'AVAILABLE-STORE-ID-SENTINEL',
    }]);

    await expect(availableService.fetchMedicineStoreIds('ORG-CODE-SENTINEL'))
      .resolves.toEqual(['AVAILABLE-STORE-ID-SENTINEL']);

    const fallbackService = new HisService('http://localhost/', 'token');
    vi.spyOn(fallbackService, 'fetchAvailablePharmacies').mockResolvedValue([]);
    vi.spyOn(fallbackService, 'post').mockResolvedValue({
      code: 200,
      body: {
        items: [{
          sdDisp: '1',
          sdUse: '1',
          idSto: 'FALLBACK-STORE-ID-SENTINEL',
          naSto: 'FALLBACK-STORE-NAME-SENTINEL',
        }],
      },
    });

    await expect(fallbackService.fetchMedicineStoreIds('FALLBACK-ORG-SENTINEL'))
      .resolves.toEqual(['FALLBACK-STORE-ID-SENTINEL']);

    expect(JSON.stringify(log.mock.calls)).not.toContain('SENTINEL');
    expect(log).toHaveBeenCalledWith(
      '[HisService] Medicine store filter summary (available pharmacies)',
      { matchedCount: 1, matchedStoreCount: 1 },
    );
    expect(log).toHaveBeenCalledWith(
      '[HisService] Medicine store filter summary (fallback stores)',
      {
        rawCount: 1,
        sdDispFiltered: 0,
        sdUseFiltered: 0,
        matchedCount: 1,
        matchedStoreCount: 1,
      },
    );
  });

  it('does not put medicine identifiers or thrown errors into detail logs', async () => {
    const service = new HisService('http://localhost/', 'token');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(service, 'post').mockRejectedValue(new Error('DETAIL-ERROR-SENTINEL'));

    await expect(service.fetchMedicineProDetail(
      'MEDICINE-ID-SENTINEL',
      'STORE-ID-SENTINEL',
    )).resolves.toBeNull();

    expect(JSON.stringify(warn.mock.calls)).not.toContain('SENTINEL');
    expect(warn).toHaveBeenCalledWith('[HisService] Failed to fetch medicine pro detail');
  });

  it('does not put rejected business code or message into console output', async () => {
    const service = new HisService('http://localhost/', 'token');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(service, 'post').mockResolvedValue({
      code: 'BUSINESS-CODE-SENTINEL',
      message: 'BUSINESS-MESSAGE-SENTINEL',
      body: { items: [] },
    });

    await expect(service.fetchInstitutionMedicalItemsCatalog('ORG-CODE-SENTINEL'))
      .rejects.toThrow('BUSINESS-MESSAGE-SENTINEL');

    expect(JSON.stringify(warn.mock.calls)).not.toContain('SENTINEL');
    expect(warn).toHaveBeenCalledWith('[HisService] Business response rejected', {
      hasBusinessCode: true,
    });
  });
});
