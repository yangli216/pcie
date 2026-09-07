import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HisService } from '../hisService';
import { PhisHisAdapter } from './PhisHisAdapter';

afterEach(() => {
  vi.restoreAllMocks();
});

const collectConsoleOutput = (...spies: Array<ReturnType<typeof vi.spyOn>>): string => spies
  .flatMap((spy) => spy.mock.calls)
  .map((args) => args.map((arg) => {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(' '))
  .join('\n');

describe('PhisHisAdapter.fetchPatientInfo', () => {
  it('keeps PHIS month age as a complete ageText without exposing it as years', async () => {
    const service = {
      searchPatientByIdPiMB: vi.fn().mockResolvedValue({
        idPi: 'patient-infant',
        naPi: '婴儿',
        sdSex: '2',
        ageNum: 10,
        ageUnit: 'M',
        qyzt: '8',
      }),
    } as unknown as HisService;

    const patient = await new PhisHisAdapter(service).fetchPatientInfo('patient-infant');

    expect(patient).toMatchObject({
      age: undefined,
      ageText: '10个月',
      signed: true,
    });
  });

  it('keeps PHIS day age and derives adult years only for Y', async () => {
    const service = {
      searchPatientByIdPiMB: vi
        .fn()
        .mockResolvedValueOnce({ idPi: 'patient-newborn', naPi: '新生儿', sdSex: '1', ageNum: 10, ageUnit: 'D', qyzt: '7' })
        .mockResolvedValueOnce({ idPi: 'patient-adult', naPi: '成人', sdSex: '1', ageNum: 35, ageUnit: 'Y' }),
    } as unknown as HisService;
    const adapter = new PhisHisAdapter(service);

    expect(await adapter.fetchPatientInfo('patient-newborn')).toMatchObject({
      age: undefined,
      ageText: '10天',
      signed: false,
    });
    expect(await adapter.fetchPatientInfo('patient-adult')).toMatchObject({
      age: 35,
      ageText: '35岁',
      signed: undefined,
    });
  });
});

describe('PhisHisAdapter.fetchInstitutionMedicalItemsCatalog', () => {
  it('preserves the mutual recognition code in neutral and raw fields', async () => {
    const service = {
      fetchInstitutionMedicalItemsCatalog: vi.fn().mockResolvedValue([{
        id: 'LAB-1',
        name: '血常规',
        category: '检验',
        sdSrv: '41',
        mutualRecognitionCode: 'B32R1WZZZ-00',
      }]),
    } as unknown as HisService;

    const [item] = await new PhisHisAdapter(service).fetchInstitutionMedicalItemsCatalog('org-1');

    expect(item.mutualRecognitionCode).toBe('B32R1WZZZ-00');
    expect(item.raw?.mutualRecognitionCode).toBe('B32R1WZZZ-00');
  });
});

describe('PhisHisAdapter.fetchMedicineProDetail', () => {
  it('maps the PHIS manufacturer into the neutral medicine detail', async () => {
    const service = {
      fetchMedicineProDetail: vi.fn().mockResolvedValue({
        idMedPro: 'med-1',
        naMedPro: '苯磺酸氨氯地平片',
        naFac: '原处方制药',
        fgActive: '1',
        idSto: 'store-1',
      }),
    } as unknown as HisService;

    const detail = await new PhisHisAdapter(service).fetchMedicineProDetail('med-1', 'store-1');

    expect(detail).toMatchObject({
      productId: 'med-1',
      manufacturer: '原处方制药',
      storeId: 'store-1',
    });
  });
});

describe('PhisHisAdapter.fetchPatientHistory', () => {
  it('forwards the bounded history date range and current visit to PHIS', async () => {
    const service = {
      queryPatientAllergy: vi.fn().mockResolvedValue([]),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([]),
      loadClinicMedicalRecord: vi.fn(),
    } as unknown as HisService;

    await new PhisHisAdapter(service).fetchPatientHistory('patient-1', {
      currentVisitId: 'visit-current',
      limit: 1000,
      dateRange: ['2026-05-06 00:00:00', '2026-08-04 23:59:59'],
    });

    expect(service.queryPatientVisitHistory).toHaveBeenCalledWith('patient-1', {
      limit: 1000,
      idVis: 'visit-current',
      dtBgn: ['2026-05-06 00:00:00', '2026-08-04 23:59:59'],
    });
  });

  it('maps medication orders and reported applications into neutral history', async () => {
    const service = {
      queryPatientAllergy: vi.fn().mockResolvedValue([]),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([{
        idVis: 'visit-1',
        idPi: 'patient-1',
        dtBgn: '2026-06-20 08:00:00',
        idDeptText: '全科门诊',
      }]),
      loadClinicMedicalRecord: vi.fn().mockResolvedValue({
        soapData: {
          vitlSigns: {
            bph: 130,
            bpl: 80,
            healthRate: 76,
            pulseRate: 78,
            breathRate: 18,
            temp: 36.5,
            sdTemp: '2',
            height: 170,
            weight: '60',
            waist: '82',
            bloodFlag: '1',
            insertTime: '2026-05-18 17:20:28',
          },
        },
        diagList: [{ naDiag: '2型糖尿病', cdIcd10: 'E11.900' }],
        orderList: [
          {
            idOrd: 'order-acarbose',
            idMedPro: 'med-acarbose',
            naOrd: '阿卡波糖片',
            sdOrd: '11',
            desOrd: 'null',
            amount: 9,
            unitOrd: '盒',
          },
          {
            idOrd: 'order-metformin',
            idMedPro: 'med-metformin',
            naOrd: '盐酸二甲双胍片',
            sdOrd: '11',
            desOrd: 'null',
            amount: 3,
            unitOrd: '瓶',
          },
          {
            naOrd: '空腹血糖（静脉）',
            sdOrd: '41',
            idApplySim: 'apply-group-1',
            desOrd: 'null',
            amount: 1,
            unitOrd: '次',
          },
          {
            naOrd: '胸部CT',
            sdOrd: '31',
            desOrd: 'undefined',
            amount: 1,
            unitOrd: '次',
          },
        ],
        presList: [{
          idPres: 'pres-1',
          presSubList: [{
            idPresSub: 'sub-acarbose',
            idOrd: 'order-acarbose',
            idMedPro: 'med-acarbose',
            naMedPro: '☆阿卡波糖片(卡博平)',
            naFac: '拜耳医药',
            specSale: '50mg*30片/盒',
            doseOnce: '50',
            unitDose: 'mg',
            idFreq: 'TID',
            idFreqText: '每天三次',
            idUsge: '100',
            idUsgeText: '口服',
            takeDays: 14,
            amount: 2,
            unitSale: '盒',
          }, {
            idPresSub: 'sub-metformin',
            idOrd: 'order-metformin',
            idMedPro: 'med-metformin',
            naMedPro: '☆盐酸二甲双胍片',
            specSale: '0.25g*60片/瓶',
            doseOnce: '0.25',
            unitDose: 'g',
            idFreq: 'TID',
            idFreqText: '每天三次',
            idUsge: '100',
            idUsgeText: '口服',
            takeDays: 30,
            amount: 2,
            unitSale: '瓶',
          }],
        }],
        applyList: [{
          idApplySim: 'apply-group-1',
          naApplySim: '空腹血糖（静脉）',
          naDeptExec: '检验科',
          items: [{
            idApply: 'apply-1',
            naApply: '空腹血糖（静脉）',
            sdApply: '3',
            naSpecimen: '静脉血',
          }, {
            idApply: 'apply-2',
            naApply: '糖化血红蛋白',
            sdApply: '0',
          }],
        }],
      }),
    } as unknown as HisService;

    const history = await new PhisHisAdapter(service).fetchPatientHistory('patient-1');

    expect(history?.visits?.[0]?.medications).toEqual([
      '☆阿卡波糖片(卡博平)（每次50mg 每天三次 口服 14天 共2盒）',
      '☆盐酸二甲双胍片（每次0.25g 每天三次 口服 30天 共2瓶）',
    ]);
    expect(history?.visits?.[0]?.medicationOrders).toEqual([
      expect.objectContaining({
        orderId: 'order-acarbose',
        productId: 'med-acarbose',
        name: '☆阿卡波糖片(卡博平)',
        manufacturer: '拜耳医药',
        days: '14',
        totalQty: '2',
        totalUnit: '盒',
      }),
      expect.objectContaining({
        orderId: 'order-metformin',
        productId: 'med-metformin',
        name: '☆盐酸二甲双胍片',
        spec: '0.25g*60片/瓶',
        dose: '0.25',
        doseUnit: 'g',
        frequency: '每天三次',
        frequencyKey: 'TID',
        route: '口服',
        routeKey: '100',
        days: '30',
        totalQty: '2',
        totalUnit: '瓶',
      }),
    ]);
    expect(history?.visits?.[0]).toMatchObject({
      visitId: 'visit-1',
      deptName: '全科门诊',
      diagnoses: ['2型糖尿病'],
      diagnosisEntries: [{ name: '2型糖尿病', code: 'E11.900' }],
      reportedApplications: [{
        applicationId: 'apply-1',
        applicationGroupId: 'apply-group-1',
        name: '空腹血糖（静脉）',
        type: 'lab',
        status: 'reported',
      }],
      vitalSigns: {
        systolicBloodPressure: 130,
        diastolicBloodPressure: 80,
        heartRate: 76,
        pulseRate: 78,
        respiratoryRate: 18,
        temperature: 36.5,
        temperatureTypeText: '腋温',
        heightCm: 170,
        weightKg: 60,
        waistCm: 82,
        firstBloodPressureMeasured: true,
        measuredAt: '2026-05-18 17:20:28',
      },
    });
  });

  it('keeps orderList as a medication fallback when presList is absent', async () => {
    const service = {
      queryPatientAllergy: vi.fn().mockResolvedValue([]),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([{
        idVis: 'visit-fallback',
        idPi: 'patient-1',
        dtBgn: '2026-06-18 08:00:00',
      }]),
      loadClinicMedicalRecord: vi.fn().mockResolvedValue({
        diagList: [{ naDiag: '高血压' }],
        orderList: [{
          idOrd: 'order-amlodipine',
          idMedPro: 'med-amlodipine',
          naOrd: '苯磺酸氨氯地平片',
          sdOrd: '11',
          desOrd: '每日1次 口服',
          amount: 1,
          unitOrd: '盒',
        }],
      }),
    } as unknown as HisService;

    const history = await new PhisHisAdapter(service).fetchPatientHistory('patient-1');

    expect(history?.visits?.[0]?.medications).toEqual([
      '苯磺酸氨氯地平片（每日1次 口服 共1盒）',
    ]);
    expect(history?.visits?.[0]?.medicationOrders).toEqual([
      expect.objectContaining({
        orderId: 'order-amlodipine',
        productId: 'med-amlodipine',
        name: '苯磺酸氨氯地平片',
        totalQty: '1',
        totalUnit: '盒',
      }),
    ]);
  });
});

describe('PhisHisAdapter console privacy boundary', () => {
  it('does not log raw patient or visit identifiers, free text, or errors from patient history failures', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const patientId = 'PATIENT-ID-SENTINEL';
    const visitId = 'VISIT-ID-SENTINEL';
    const allergyError = new Error('ALLERGY-FREE-TEXT-SENTINEL');
    const historyError = new Error('HISTORY-FREE-TEXT-SENTINEL');
    const detailError = new Error('DETAIL-FREE-TEXT-SENTINEL');

    const failedListService = {
      queryPatientAllergy: vi.fn().mockRejectedValue(allergyError),
      queryPatientVisitHistory: vi.fn().mockRejectedValue(historyError),
      loadClinicMedicalRecord: vi.fn(),
    } as unknown as HisService;
    const failedListResult = await new PhisHisAdapter(failedListService).fetchPatientHistory(patientId, {
      currentVisitId: visitId,
    });

    const failedDetailService = {
      queryPatientAllergy: vi.fn().mockResolvedValue([]),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([{ idVis: visitId, idPi: patientId }]),
      loadClinicMedicalRecord: vi.fn().mockRejectedValue(detailError),
    } as unknown as HisService;
    const failedDetailResult = await new PhisHisAdapter(failedDetailService).fetchPatientHistory(patientId);

    expect(failedListResult).toEqual({
      patientId,
      allergyHistory: undefined,
      pastMedicalHistory: undefined,
      visits: undefined,
      raw: { allergyItems: [], visitItems: [] },
    });
    expect(failedDetailResult?.visits).toBeUndefined();
    expect(failedListService.queryPatientAllergy).toHaveBeenCalledWith(patientId);
    expect(failedListService.queryPatientVisitHistory).toHaveBeenCalledWith(patientId, expect.objectContaining({
      idVis: visitId,
    }));
    expect(failedDetailService.loadClinicMedicalRecord).toHaveBeenCalledWith(visitId, patientId);

    const output = collectConsoleOutput(warnSpy);
    expect(output).not.toContain(patientId);
    expect(output).not.toContain(visitId);
    expect(output).not.toContain(allergyError.message);
    expect(output).not.toContain(historyError.message);
    expect(output).not.toContain(detailError.message);
  });

  it('keeps outpatient failure logs diagnostic without exposing identifiers or free text', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const patientId = 'OUTPATIENT-PATIENT-SENTINEL';
    const visitId = 'OUTPATIENT-VISIT-SENTINEL';
    const tenantId = 'OUTPATIENT-TENANT-SENTINEL';
    const documentId = 'OUTPATIENT-DOCUMENT-SENTINEL';
    const historyError = new Error('OUTPATIENT-HISTORY-FREE-TEXT-SENTINEL');
    const documentListError = new Error('DOCUMENT-LIST-FREE-TEXT-SENTINEL');
    const rawMergeError = new Error('RAW-MERGE-FREE-TEXT-SENTINEL');
    const contentError = new Error('CONTENT-FREE-TEXT-SENTINEL');
    const finalRecordError = new Error('FINAL-RECORD-FREE-TEXT-SENTINEL');

    const failedHistoryService = {
      queryPatientVisitHistory: vi.fn().mockRejectedValue(historyError),
    } as unknown as HisService;
    expect(await new PhisHisAdapter(failedHistoryService).fetchOutpatientVisitHistory(patientId)).toEqual([]);
    expect(failedHistoryService.queryPatientVisitHistory).toHaveBeenCalledWith(patientId, expect.any(Object));

    const failedDocumentsService = {
      getTenantId: vi.fn().mockReturnValue(tenantId),
      queryOutpatientMedicalRecordDocuments: vi.fn().mockRejectedValue(documentListError),
    } as unknown as HisService;
    expect(await new PhisHisAdapter(failedDocumentsService).fetchOutpatientMedicalRecordDocuments(visitId)).toEqual([]);
    expect(failedDocumentsService.queryOutpatientMedicalRecordDocuments).toHaveBeenCalledWith(visitId, {
      idTet: tenantId,
      idApp: '42',
    });

    const failedContentService = {
      getTenantId: vi.fn().mockReturnValue(tenantId),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([{ idVis: visitId, idPi: patientId }]),
      loadClinicMedicalRecord: vi.fn().mockRejectedValue(rawMergeError),
      queryOutpatientMedicalRecordDocuments: vi.fn().mockResolvedValue([{
        idMedrecdoc: documentId,
        idHospital: visitId,
        idTet: tenantId,
        idApp: '42',
        naMed: 'DOCUMENT-TITLE-FREE-TEXT-SENTINEL',
      }]),
      queryOutpatientMedicalRecordContent: vi.fn().mockRejectedValue(contentError),
    } as unknown as HisService;
    const failedContentAdapter = new PhisHisAdapter(failedContentService);
    await failedContentAdapter.fetchOutpatientVisitHistory(patientId);
    const pendingRecord = await failedContentAdapter.fetchOutpatientMedicalRecord(visitId);
    expect(pendingRecord).toMatchObject({ visitId, contentPending: true });
    expect(failedContentService.loadClinicMedicalRecord).toHaveBeenCalledWith(visitId, patientId);
    expect(failedContentService.queryOutpatientMedicalRecordContent).toHaveBeenCalledWith(documentId, {
      idTet: tenantId,
      idApp: '42',
      courseShow: 0,
    });

    const missingPatientService = {
      getTenantId: vi.fn().mockReturnValue(tenantId),
      queryOutpatientMedicalRecordDocuments: vi.fn().mockResolvedValue([]),
    } as unknown as HisService;
    expect(await new PhisHisAdapter(missingPatientService).fetchOutpatientMedicalRecord(visitId)).toBeNull();

    const failedFinalRecordService = {
      getTenantId: vi.fn().mockReturnValue(tenantId),
      queryPatientVisitHistory: vi.fn().mockResolvedValue([]),
      queryOutpatientMedicalRecordDocuments: vi.fn().mockResolvedValue([]),
      loadClinicMedicalRecord: vi.fn().mockRejectedValue(finalRecordError),
    } as unknown as HisService;
    const failedFinalRecordAdapter = new PhisHisAdapter(failedFinalRecordService);
    await failedFinalRecordAdapter.fetchOutpatientVisitHistory(patientId);
    expect(await failedFinalRecordAdapter.fetchOutpatientMedicalRecord(visitId)).toBeNull();
    expect(failedFinalRecordService.loadClinicMedicalRecord).toHaveBeenCalledWith(visitId, patientId);

    const output = collectConsoleOutput(warnSpy, errorSpy);
    [
      patientId,
      visitId,
      tenantId,
      documentId,
      historyError.message,
      documentListError.message,
      rawMergeError.message,
      contentError.message,
      finalRecordError.message,
      'DOCUMENT-TITLE-FREE-TEXT-SENTINEL',
    ].forEach((sentinel) => expect(output).not.toContain(sentinel));
    expect(output).toContain('hasTenant');
    expect(output).toContain('hasPatient');
    expect(output).toContain('hasDocument');
  });
});
