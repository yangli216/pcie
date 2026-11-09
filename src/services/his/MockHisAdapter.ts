/**
 * MockHisAdapter
 *
 * 不连接任何真实 HIS 的内置适配器，主要用途：
 * 1. **反向验证抽象层是否够用**：能用 mock 跑通业务路径，说明 `HisAdapter` 接口
 *    没有泄漏 PHIS 私有概念（如果某处不得不读 `raw.idMedPro` 才能工作，那就是抽象漏了）。
 * 2. **本地 demo / E2E**：在没有 PHIS 后端时也能演示语音问诊、用药/检查推荐等功能。
 * 3. **新厂商接入示例**：照着实现一遍即可，不用读 `HisService` 950 行旧代码。
 *
 * 启用方式：
 * ```ts
 * import { registerHisAdapterFactory, setActiveHisVendor, MockHisAdapter } from '@/services/his';
 * registerHisAdapterFactory('mock', () => new MockHisAdapter());
 * setActiveHisVendor('mock');
 * ```
 * 或在 .env 里：`VITE_HIS_VENDOR=mock`（仍需在某处调用一次注册）。
 *
 * 行为约定：
 * - 所有"目录"返回内置的少量样本数据（仅用于 mock / demo，不参与运行时 CSV 兜底）。
 * - 所有"详情"按入参伪造一份合理结构。
 * - 库存校验固定通过。
 * - 没有 token / baseUrl 概念，永远 ready。
 */

import type { HisAdapter, HisServiceContext, PharmacyOption } from './HisAdapter';
import type {
  AvailableMedicineInventoryItem,
  DiagnosisCatalogEntry,
  DictionaryEntry,
  InventoryCheckRequest,
  InventoryCheckResult,
  MedicalItemCatalogEntry,
  MedicalItemDetail,
  MedicalItemPartOption,
  MedicineCatalogEntry,
  MedicineDetail,
  HisPatientInfo,
  HisPatientHistory,
  HisPatientHistoryQuery,
  HisOutpatientVisit,
  HisOutpatientVisitHistoryQuery,
  HisOutpatientMedicalRecordDocument,
  HisOutpatientMedicalRecord,
  HisOutpatientFollowUpContext,
  HisOutpatientFollowUpContextQuery,
  HisOutpatientFollowUpReportResults,
  HisOutpatientFollowUpReportResultsQuery,
  HisInpatientDiagnosis,
  HisInpatientEmrContextPackage,
  HisInpatientEmrContextQuery,
  HisInpatientOrder,
  HisInpatientQuery,
  HisInpatientRegistrationInfo,
  HisInpatientTemperatureChart,
} from './types';

const MOCK_DIAGNOSES: DiagnosisCatalogEntry[] = [
  { id: 'mock-dx-1', code: 'J00', name: '急性鼻咽炎[普通感冒]', keywords: ['感冒', 'gm', 'ganmao'] },
  { id: 'mock-dx-2', code: 'J20.9', name: '急性支气管炎', keywords: ['支气管炎', 'zqgy'] },
  { id: 'mock-dx-3', code: 'I10.x00', name: '原发性高血压', keywords: ['高血压', 'gxy'] },
];

const MOCK_MEDICINES: MedicineCatalogEntry[] = [
  {
    id: 'mock-med-1',
    code: 'M001',
    name: '阿莫西林胶囊',
    spec: '0.25g*24粒/盒',
    storeIds: ['sto-001', 'sto-002'],
  },
  {
    id: 'mock-med-2',
    code: 'M002',
    name: '布洛芬缓释胶囊',
    spec: '0.3g*20粒/盒',
    storeIds: ['sto-001', 'sto-002'],
  },
  {
    id: 'mock-med-3',
    code: 'M003',
    name: '苯磺酸氨氯地平片',
    spec: '5mg*7片/盒',
    storeIds: ['sto-001', 'sto-002'],
  },
];

const MOCK_MEDICAL_ITEMS: MedicalItemCatalogEntry[] = [
  { id: 'mock-itm-1', code: 'EX001', name: '血常规', category: '检验', keywords: ['血常规', 'xcg'] },
  { id: 'mock-itm-2', code: 'EX002', name: '胸部正位X线', category: '检查', keywords: ['胸片', 'xp'] },
  { id: 'mock-itm-3', code: 'EX003', name: '心电图', category: '检查', keywords: ['心电图', 'xdt'] },
];

const MOCK_TREATMENT_ITEMS: MedicalItemCatalogEntry[] = [
  { id: 'mock-trt-1', code: 'TR001', name: '雾化吸入', category: '治疗', keywords: ['雾化', 'wh'] },
];

const MOCK_FREQUENCIES: DictionaryEntry[] = [
  { key: 'qd', text: '每日一次', py: 'mryc', properties: { execCount: 1 } },
  { key: 'bid', text: '每日两次', py: 'mrlc', properties: { execCount: 2 } },
  { key: 'tid', text: '每日三次', py: 'mrsc', properties: { execCount: 3 } },
  { key: 'qid', text: '每日四次', py: 'mrsic', properties: { execCount: 4 } },
];

const MOCK_USAGES: DictionaryEntry[] = [
  { key: 'po', text: '口服', py: 'kf' },
  { key: 'im', text: '肌肉注射', py: 'jrzs' },
  { key: 'iv', text: '静脉注射', py: 'jmzs' },
  { key: 'ext', text: '外用', py: 'wy' },
];

const MOCK_DEPTS: DictionaryEntry[] = [
  { key: 'dept-001', text: '全科', py: 'qk' },
  { key: 'dept-002', text: '检验科', py: 'jyk' },
  { key: 'dept-003', text: '放射科', py: 'fsk' },
];

const MOCK_PHARMACIES: PharmacyOption[] = [
  { idDept: 'dept-pharm-001', idSto: 'sto-001', name: '门诊药房' },
  { idDept: 'dept-pharm-002', idSto: 'sto-002', name: '住院药房' },
];

export class MockHisAdapter implements HisAdapter {
  readonly vendor = 'mock';

  private execDeptId = 'dept-001';

  private resolveMockInpatientPatientId(query: HisInpatientQuery): string {
    return query.patientId ?? query.admissionId ?? query.inpatientVisitId ?? query.encounterId ?? 'mock-patient';
  }

  updateContext(context: HisServiceContext): void {
    // mock 仅记录第一个角色科室，作为默认执行科室
    const first = context?.userRoleDeptIds?.[0];
    if (first) {
      this.execDeptId = first;
    }
  }

  getDefaultExecDeptId(): string {
    return this.execDeptId;
  }

  getContextScope() {
    return {
      orgCode: 'mock-org',
      tenantId: 'mock-tenant',
    };
  }

  // ---- 目录 ----

  async fetchDiagnosisCatalog(): Promise<DiagnosisCatalogEntry[]> {
    return MOCK_DIAGNOSES.map((d) => ({ ...d }));
  }

  async fetchInstitutionMedicalItemsCatalog(_orgCode: string): Promise<MedicalItemCatalogEntry[]> {
    return MOCK_MEDICAL_ITEMS.map((i) => ({ ...i }));
  }

  async fetchInstitutionTreatmentItemsCatalog(): Promise<MedicalItemCatalogEntry[]> {
    return MOCK_TREATMENT_ITEMS.map((i) => ({ ...i }));
  }

  async fetchInstitutionMedicineCatalog(_orgCode: string): Promise<MedicineCatalogEntry[]> {
    return MOCK_MEDICINES.map((m) => ({ ...m }));
  }

  async fetchMedicineStoreIds(_orgCode: string): Promise<string[]> {
    return MOCK_PHARMACIES.map((p) => p.idSto).filter((id): id is string => !!id);
  }

  // ---- 字典 ----

  async fetchFrequencyDictionary(): Promise<DictionaryEntry[]> {
    return MOCK_FREQUENCIES.map((f) => ({ ...f }));
  }

  async fetchMedicineUsageDictionary(): Promise<DictionaryEntry[]> {
    return MOCK_USAGES.map((u) => ({ ...u }));
  }

  async fetchExecutionDepartments(): Promise<DictionaryEntry[]> {
    return MOCK_DEPTS.map((d) => ({ ...d }));
  }

  async fetchAvailablePharmacies(): Promise<PharmacyOption[]> {
    return MOCK_PHARMACIES.map((p) => ({ ...p }));
  }

  async fetchAvailableMedicineInventory(storeId: string): Promise<AvailableMedicineInventoryItem[]> {
    return MOCK_MEDICINES.map((medicine, index) => ({
      productId: medicine.id,
      productName: medicine.name,
      spec: medicine.spec,
      unit: '盒',
      manufacturer: 'Mock 制药',
      storeId,
      storeName: MOCK_PHARMACIES.find((item) => item.idSto === storeId)?.name,
      availableQuantity: 20 + index,
      nearestExpiryDate: '2027-12-31',
      unitPrice: 12.8 + index * 5,
      raw: { mock: true, batchCount: 1 },
    }));
  }

  // ---- 详情 ----

  async fetchMedicalItemDetail(itemId: string): Promise<MedicalItemDetail | null> {
    const cat = MOCK_MEDICAL_ITEMS.find((i) => i.id === itemId);
    if (!cat) return null;
    const isLab = cat.category === '检验';
    return {
      itemId: cat.id,
      itemName: cat.name,
      unit: '次',
      executingDeptId: isLab ? 'dept-002' : 'dept-003',
      defaultQuantity: 1,
      raw: {
        mock: true,
        ...(isLab ? { jsonField: JSON.stringify({ idLisCategory: 'mock-lab' }) } : {}),
      },
    };
  }

  async fetchMedicalItemPartOptions(itemId: string): Promise<MedicalItemPartOption[]> {
    const cat = MOCK_MEDICAL_ITEMS.find((i) => i.id === itemId || i.code === itemId);
    if (!cat || cat.category !== '检查') return [];
    return [{
      partId: cat.id === 'mock-itm-2' ? 'mock-part-chest' : 'mock-part-none',
      itemId: cat.id,
      name: cat.id === 'mock-itm-2' ? '胸部正位' : '无部位',
      partAndWay: cat.id === 'mock-itm-2' ? '胸部/正位' : '无部位',
      partText: cat.id === 'mock-itm-2' ? '胸部' : '无部位',
      wayText: cat.id === 'mock-itm-2' ? '正位' : '',
      raw: { mock: true },
    }];
  }

  async fetchMedicineProDetail(productId: string, storeId: string): Promise<MedicineDetail | null> {
    const cat = MOCK_MEDICINES.find((m) => m.id === productId);
    if (!cat) return null;
    return {
      productId: cat.id,
      productName: cat.name,
      medicineId: cat.id,
      medicineName: cat.name,
      manufacturer: 'Mock 制药',
      active: true,
      specSale: cat.spec,
      unitSale: '盒',
      spec: cat.spec,
      doseUnit: '粒',
      dose: '1',
      defaultSingleDose: '1',
      defaultFrequency: 'tid',
      defaultRoute: 'po',
      storeId,
      needsSkinTest: false,
      raw: {
        mock: true,
        unitDose: '粒',
        unitPre: '粒',
        unitSale: '盒',
        dftDoseOnce: '1',
        dftFreq: 'tid',
        dftUsge: 'po',
      },
    };
  }

  // ---- 库存校验 ----

  async checkMedicineInventoryEnough(_items: InventoryCheckRequest[]): Promise<InventoryCheckResult> {
    return { code: 200, message: '' };
  }

  // ---- 接诊与患者信息 ----

  async fetchPatientInfo(patientId: string): Promise<HisPatientInfo | null> {
    return {
      patientId,
      name: '测试患者(Mock)',
      gender: 'M',
      age: 35,
      ageText: '35岁',
      idNo: '110105198801011234',
      insuranceType: '自费',
      raw: { mock: true },
    };
  }

  async fetchPatientHistory(
    patientId: string,
    _query: HisPatientHistoryQuery = {},
  ): Promise<HisPatientHistory | null> {
    return {
      patientId,
      allergyHistory: ['青霉素过敏'],
      pastMedicalHistory: ['高血压史3年'],
      visits: [
        {
          visitId: 'mock-visit-reported',
          visitTime: Date.now() - 2 * 24 * 3600 * 1000,
          chiefComplaint: '高血压复诊配药',
          presentIllness: '既往高血压病史，按既往方案规律服药。',
          diagnoses: ['高血压'],
          medications: ['苯磺酸氨氯地平片（5mg*28片）'],
          reportedApplications: [{
            applicationId: 'mock-apply-lab-1',
            name: '血常规',
            type: 'lab',
            status: 'reported',
          }],
        },
        {
          visitTime: Date.now() - 45 * 24 * 3600 * 1000,
          chiefComplaint: '高血压复诊',
          presentIllness: '高血压定期随诊，继续既往降压治疗。',
          diagnoses: ['高血压病'],
          medications: ['苯磺酸氨氯地平片（5mg*28片）'],
        },
        {
          visitTime: Date.now() - 90 * 24 * 3600 * 1000,
          chiefComplaint: '咳嗽、咳痰3天',
          presentIllness: '患者3天前受凉后出现咳嗽，咳少量白痰，无发热。',
          diagnoses: ['急性支气管炎'],
          medications: ['阿莫西林胶囊', '复方鲜竹沥液'],
        },
      ],
      raw: { mock: true },
    };
  }

  async fetchOutpatientFollowUpContext(query: HisOutpatientFollowUpContextQuery): Promise<HisOutpatientFollowUpContext | null> {
    return {
      followUpEligible: true,
      source: {
        visitId: query.sourceVisitId || 'mock-source-visit',
        visitTime: '2026-06-20 09:30:00',
        documentTitle: '门急诊病历',
      },
      medicalRecordText: '患者3天前受凉后出现咳嗽、咳黄痰，无胸闷气促。既往体健，否认药物过敏史。上次就诊完善血常规及胸部CT，现携报告复诊。',
      labReports: [{
        reportTime: '2026-06-21 10:00:00',
        reportName: '血常规',
        items: [{
          itemName: '白细胞计数',
          result: '12.8',
          unit: '10^9/L',
          referenceRange: '3.5-9.5',
          abnormalFlag: 'H',
        }],
      }],
      examReports: [{
        reportTime: '2026-06-21 11:00:00',
        examName: '胸部CT',
        conclusion: '右下肺感染性病变。',
      }],
      ineligibleReason: null,
    };
  }

  async fetchOutpatientFollowUpReportResults(_query: HisOutpatientFollowUpReportResultsQuery): Promise<HisOutpatientFollowUpReportResults | null> {
    return {
      followUpEligible: true,
      labReports: [{
        reportTime: '2026-06-21 10:00:00',
        reportName: '血常规',
        items: [{
          itemName: '白细胞计数',
          result: '12.8',
          unit: '10^9/L',
          referenceRange: '3.5-9.5',
          abnormalFlag: 'H',
        }],
      }],
      examReports: [{
        reportTime: '2026-06-21 11:00:00',
        examName: '胸部CT',
        conclusion: '右下肺感染性病变。',
      }],
      ineligibleReason: null,
    };
  }

  // ---- 住院上下文 ----

  private async fetchInpatientOrders(query: HisInpatientQuery): Promise<HisInpatientOrder[]> {
    const patientId = this.resolveMockInpatientPatientId(query);
    return [
      {
        orderId: 'mock-inp-ord-1',
        groupId: 'mock-inp-group-1',
        name: '阿莫西林胶囊',
        fullText: '阿莫西林胶囊 0.5g 口服 每日三次',
        displayText: '阿莫西林胶囊 0.5g 口服 每日三次',
        orderType: '药品',
        status: '执行中',
        startTime: '2026-06-01 10:00:00',
        dose: '0.5g',
        frequency: '每日三次',
        route: '口服',
        quantity: 1,
        unit: '盒',
        doctorName: 'Mock医生',
        deptName: '全科病区',
        raw: { mock: true, patientId, idAdsn: query.admissionId },
      },
    ];
  }

  private async fetchInpatientTemperatureChart(query: HisInpatientQuery): Promise<HisInpatientTemperatureChart | null> {
    const patientId = this.resolveMockInpatientPatientId(query);
    const records = [
      {
        recordTime: '2026-06-01 14:00:00',
        dtSurvey: '2026-06-01 00:00:00',
        temperature: 38.2,
        temperatureType: '腋温',
        pulse: 92,
        heartRate: 92,
        respiration: 20,
        bloodPressureSystolic: 126,
        bloodPressureDiastolic: 78,
        spo2: 98,
        raw: { mock: true },
      },
    ];
    return {
      patientId,
      inpatientVisitId: query.inpatientVisitId,
      records,
      todayRecords: records,
      historyRecords: [],
      raw: { mock: true },
    };
  }

  private async fetchInpatientRegistration(query: HisInpatientQuery): Promise<HisInpatientRegistrationInfo | null> {
    const patientId = this.resolveMockInpatientPatientId(query);
    const diagnoses: HisInpatientDiagnosis[] = [
      {
        id: 'mock-inp-dx-1',
        code: 'J20.9',
        name: '急性支气管炎',
        diagnosisType: '入院诊断',
        diagnosedAt: '2026-06-01 09:30:00',
        isPrimary: true,
        doctorName: 'Mock医生',
        deptName: '全科病区',
        raw: { mock: true, patientId, idAdsn: query.admissionId },
      },
    ];
    return {
      patientId,
      name: '测试住院患者(Mock)',
      gender: '男性',
      ageText: '35岁',
      inHospitalAgeText: '35岁',
      inpatientVisitId: query.admissionId ?? query.inpatientVisitId ?? 'mock-inp-vis-1',
      inpatientNo: query.inpatientNo ?? 'ZY000001',
      medicalRecordNo: 'MR000001',
      admissionNo: 'ADM000001',
      admissionTime: '2026-06-01 08:30:00',
      clinicalTime: '2026-06-01 09:30:00',
      deptId: 'dept-001',
      deptName: '全科病区',
      wardId: query.wardId ?? 'ward-001',
      wardName: '综合病区',
      bedNo: '12床',
      attendingDoctorName: 'Mock医生',
      nursingLevel: '二级护理',
      admissionDiagnosis: '急性支气管炎',
      admissionDiagnosisCode: 'J20.9',
      allergyText: '青霉素过敏',
      isSevere: false,
      isTransfer: false,
      isGestation: false,
      status: '在院',
      diagnoses,
      raw: { mock: true },
    };
  }

  async fetchInpatientEmrContext(query: HisInpatientEmrContextQuery): Promise<HisInpatientEmrContextPackage | null> {
    const registration = await this.fetchInpatientRegistration(query);
    const orders = await this.fetchInpatientOrders(query);
    const temperatureChart = await this.fetchInpatientTemperatureChart(query);
    const recordDate = query.recordDate || (query.recordTime || '').split(/\s+/)[0] || '2026-06-01';
    const recordDateItems = temperatureChart?.todayRecords || [];
    const latestBeforeRecordDate = temperatureChart?.historyRecords?.[0] || temperatureChart?.records?.[0] || null;

    return {
      documentContext: {
        admissionId: query.admissionId,
        templateId: query.templateId,
        templateName: query.templateName,
        recordType: query.templateName || '日常病程记录',
        recordTime: query.recordTime,
        recordDate,
      },
      patient: registration ? {
        patientId: registration.patientId,
        name: registration.name,
        sex: registration.gender,
        age: registration.ageText,
        inpatientNo: registration.inpatientNo,
        medicalRecordNo: registration.medicalRecordNo,
      } : undefined,
      admission: registration ? {
        admissionTime: registration.admissionTime,
        department: registration.deptName,
        ward: registration.wardName,
        bedNo: registration.bedNo,
        attendingDoctor: registration.attendingDoctorName,
        allergyText: registration.allergyText,
        chiefComplaint: '咳嗽、咳痰3天',
        admissionCondition: '神志清，精神可，步入病房',
        severeFlag: false,
      } : undefined,
      diagnoses: registration?.diagnoses,
      vitals: {
        recordDateItems,
        latestBeforeRecordDate,
        summary: recordDateItems.length > 0
          ? '本日体温单显示体温38.2℃，血压126/78mmHg。'
          : '本日体温单暂无记录；最近一次体温单显示体温38.2℃，血压126/78mmHg。',
      },
      orders: {
        active: orders,
        changedNearRecordDate: [],
        summary: '目前予抗感染、止咳化痰等治疗，长期医嘱执行中。',
      },
      labs: {
        abnormal: [],
        recentKeyResults: [],
        summary: '',
      },
      exams: [],
      previousRecords: {
        recentNotes: [
          {
            recordTime: '2026-06-01 10:00',
            recordType: '入院记录',
            recordName: '入院记录',
            medType: '0',
            recordCategory: '入院记录',
            chiefComplaint: '咳嗽、咳痰3天',
            presentIllness: '患者3天前受凉后出现咳嗽，咳少量白痰，无明显发热、胸闷气促。',
            summary: '入院记录；主诉：咳嗽、咳痰3天；现病史：患者3天前受凉后出现咳嗽，咳少量白痰。',
          },
        ],
        longStaySummary: '',
      },
      consultations: [],
      operations: [],
      dataQuality: {
        hasRecordDateVitals: recordDateItems.length > 0,
        latestVitalsDate: latestBeforeRecordDate?.recordTime?.split(/\s+/)[0] || '',
        truncated: true,
        truncatedReason: 'Mock 上下文仅返回演示数据。',
      },
    };
  }

  async fetchOutpatientVisitHistory(
    _patientId: string,
    query?: number | HisOutpatientVisitHistoryQuery,
  ): Promise<HisOutpatientVisit[]> {
    const normalizedQuery = typeof query === 'number' ? { limit: query } : query;
    const [startTime, endTime] = normalizedQuery?.dateRange?.map((item) => Date.parse(item.replace(/-/g, '/'))) || [];
    const visits: HisOutpatientVisit[] = [
      {
        visitId: 'mock-vis-1',
        patientId: 'mock-patient',
        registrationId: 'mock-reg-1',
        clinicNo: 'MZ202606100001',
        visitDate: '2026-06-10 09:30:15',
        deptName: '呼吸内科',
        doctorName: 'Mock医生',
        orgName: 'Mock社区卫生服务中心',
        statusText: '已诊毕',
        visiting: false,
        diagnoses: ['急性支气管炎'],
        hasMedicalRecord: true,
        medicalRecordDocumentCount: 1,
        chiefComplaint: '咳嗽、咳黄痰 3 天，伴咽痛。',
        raw: { mock: true },
      },
      {
        visitId: 'mock-vis-2',
        patientId: 'mock-patient',
        registrationId: 'mock-reg-2',
        clinicNo: 'MZ202605240001',
        visitDate: '2026-05-24 14:15:22',
        deptName: '耳鼻喉科',
        doctorName: 'Mock医生',
        orgName: 'Mock社区卫生服务中心',
        statusText: '已诊毕',
        visiting: false,
        diagnoses: ['急性鼻咽炎', '过敏性鼻炎'],
        hasMedicalRecord: true,
        medicalRecordDocumentCount: 1,
        chiefComplaint: '鼻塞、流涕、咽痛 2 天，偶有发热。',
        raw: { mock: true },
      },
      {
        visitId: 'mock-vis-3',
        patientId: 'mock-patient',
        registrationId: 'mock-reg-3',
        clinicNo: 'MZ202604120001',
        visitDate: '2026-04-12 10:45:00',
        deptName: '全科医学科',
        doctorName: 'Mock医生',
        orgName: 'Mock社区卫生服务中心',
        statusText: '已诊毕',
        visiting: false,
        diagnoses: ['原发性高血压'],
        hasMedicalRecord: true,
        medicalRecordDocumentCount: 1,
        chiefComplaint: '头晕、头痛 1 周，伴颈部紧箍感。',
        raw: { mock: true },
      },
    ];
    const filtered = visits.filter((visit) => {
      const visitTime = Date.parse(visit.visitDate.replace(/-/g, '/'));
      if (Number.isFinite(startTime) && visitTime < startTime) return false;
      if (Number.isFinite(endTime) && visitTime > endTime) return false;
      if (normalizedQuery?.requireDiagnosisAndRecord) {
        return Boolean(visit.diagnoses?.length && visit.hasMedicalRecord);
      }
      return true;
    });
    const limit = normalizedQuery?.limit ?? filtered.length;
    return limit > 0 ? filtered.slice(0, limit) : filtered;
  }

  async fetchOutpatientMedicalRecordDocuments(visitId: string): Promise<HisOutpatientMedicalRecordDocument[]> {
    return [
      {
        documentId: `${visitId}-doc-1`,
        visitId,
        appId: '42',
        tenantId: 'mock',
        title: 'Mock 门急诊病历首页',
        createdAt: '2026-06-10 09:35:00',
        insertedAt: '2026-06-10 09:36:00',
        titleTime: '2026-06-10 09:35:00',
        medType: '0',
        committed: false,
        closed: false,
        sealed: false,
        raw: { mock: true },
      },
    ];
  }

  async fetchOutpatientMedicalRecord(visitId: string): Promise<HisOutpatientMedicalRecord | null> {
    if (visitId === 'mock-vis-1') {
      return {
        visitId: 'mock-vis-1',
        documentId: 'mock-vis-1-doc-1',
        documentTitle: 'Mock 门急诊病历首页',
        chiefComplaint: '咳嗽、咳黄痰 3 天，伴咽痛。',
        historyOfPresentIllness: '患者 3 天前受凉后出现咳嗽，咳少量黄脓痰，伴咽痛，无高热、寒战，无胸痛、呼吸困难。自行服用感冒药效果不佳，今日来诊。',
        pastHistory: '否认传染病史，青霉素过敏史。',
        physicalExamination: '体温：37.2℃，双肺呼吸音粗，未闻及明显干湿啰音。',
        auxiliaryExamination: '血常规：白细胞 10.5x10^9/L，中性粒细胞百分比 78.5%。',
        diagnosis: '急性支气管炎',
        treatmentPlan: '1. 阿莫西林胶囊 0.5g p.o. tid * 3天; 2. 氨溴索口服溶液 10ml p.o. tid * 3天; 3. 嘱多饮水，注意休息。',
        plainText: '主诉：咳嗽、咳黄痰 3 天，伴咽痛。\n现病史：患者 3 天前受凉后出现咳嗽，咳少量黄脓痰，伴咽痛，无高热、寒战，无胸痛、呼吸困难。\n初步诊断：急性支气管炎。',
        documents: await this.fetchOutpatientMedicalRecordDocuments(visitId),
        htmlContent: `
          <div style="font-family: sans-serif; padding: 15px; color: #334155; line-height: 1.6;">
            <h3 style="text-align: center; margin-bottom: 20px; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">门急诊病历记录</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px;">
              <tr>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊日期</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">2026-06-10</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊科室</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">呼吸内科</td>
              </tr>
            </table>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">主诉：</strong>咳嗽、咳黄痰 3 天，伴咽痛。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">现病史：</strong>患者 3 天前受凉后出现咳嗽，咳少量黄脓痰，伴咽痛，无高热、寒战，无胸痛、呼吸困难。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">既往史：</strong>否认传染病史，青霉素过敏。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">体格检查：</strong>体温：37.2℃，双肺呼吸音粗。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">辅助检查：</strong>血常规：WBC 10.5x10^9/L，N 78.5%。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">初步诊断：</strong>急性支气管炎</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">治疗意见：</strong>阿莫西林胶囊 0.5g p.o. tid * 3天; 氨溴索口服溶液 10ml p.o. tid * 3天。</div>
          </div>
        `,
      };
    } else if (visitId === 'mock-vis-2') {
      return {
        visitId: 'mock-vis-2',
        documentId: 'mock-vis-2-doc-1',
        documentTitle: 'Mock 门急诊病历首页',
        chiefComplaint: '鼻塞、流涕、咽痛 2 天，偶有发热。',
        historyOfPresentIllness: '患者 2 天前受凉后出现明显鼻塞、流清水样涕，伴咽痛、吞咽阻碍感，偶有低热，无咳嗽咳痰。',
        pastHistory: '有过敏性鼻炎史5年。',
        physicalExamination: '咽部红肿，双侧扁桃体Ⅰ度肿大，未见脓性分泌物。',
        auxiliaryExamination: '血常规：WBC 6.2x10^9/L，L 35.0%。',
        diagnosis: '急性鼻咽炎、过敏性鼻炎',
        treatmentPlan: '1. 氯雷他定片 10mg p.o. qd * 5天; 2. 蓝芩口服液 20ml p.o. tid * 3天; 3. 多饮水，清淡饮食。',
        plainText: '主诉：鼻塞、流涕、咽痛 2 天，偶有发热。\n现病史：患者 2 天前受凉后出现明显鼻塞、流清水样涕，伴咽痛、吞咽阻碍感。\n诊断：急性鼻咽炎、过敏性鼻炎。',
        documents: await this.fetchOutpatientMedicalRecordDocuments(visitId),
        htmlContent: `
          <div style="font-family: sans-serif; padding: 15px; color: #334155; line-height: 1.6;">
            <h3 style="text-align: center; margin-bottom: 20px; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">门急诊病历记录</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px;">
              <tr>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊日期</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">2026-05-24</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊科室</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">耳鼻喉科</td>
              </tr>
            </table>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">主诉：</strong>鼻塞、流涕、咽痛 2 天。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">现病史：</strong>受凉后出现鼻塞、流涕，伴扁桃体红肿。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">既往史：</strong>过敏性鼻炎5年。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">体格检查：</strong>咽部充血红肿。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">初步诊断：</strong>急性鼻咽炎、过敏性鼻炎</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">治疗意见：</strong>氯雷他定片 10mg p.o. qd; 蓝芩口服液 20ml p.o. tid。</div>
          </div>
        `,
      };
    } else if (visitId === 'mock-vis-3') {
      return {
        visitId: 'mock-vis-3',
        chiefComplaint: '头晕、头痛 1 周，伴颈部紧箍感。',
        historyOfPresentIllness: '患者 1 周前无明显诱因下出现头晕、轻度胀痛，活动后明显，伴颈部紧箍酸胀感，无视物旋转、恶心呕吐，无肢体麻木木僵。',
        pastHistory: '否认心脑血管疾病史，否认过敏史。',
        physicalExamination: '血压：152/96 mmHg，心率 72次/分，神经系统检查生理反射存在，病理征未引出。',
        auxiliaryExamination: '急诊肾功能、电解质未见明显异常。',
        diagnosis: '原发性高血压',
        treatmentPlan: '1. 硝苯地平控释片 30mg p.o. qd * 7天; 2. 每日监测血压并记录; 3. 低盐低脂饮食，避免情绪波动。',
        htmlContent: `
          <div style="font-family: sans-serif; padding: 15px; color: #334155; line-height: 1.6;">
            <h3 style="text-align: center; margin-bottom: 20px; color: #1e3a8a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">门急诊病历记录</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 13px;">
              <tr>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊日期</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">2026-04-12</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1; font-weight: bold; background: #f8fafc; width: 80px;">就诊科室</td>
                <td style="padding: 6px; border: 1px solid #cbd5e1;">全科医学科</td>
              </tr>
            </table>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">主诉：</strong>头晕、头痛 1 周。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">现病史：</strong>头晕轻度胀痛，BP升高。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">既往史：</strong>无特殊。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">体格检查：</strong>BP 152/96 mmHg。</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">初步诊断：</strong>原发性高血压</div>
            <div style="margin-bottom: 12px;"><strong style="color: #1e40af;">治疗意见：</strong>硝苯地平控释片 30mg p.o. qd。</div>
          </div>
        `,
      };
    }
    return null;
  }
}
