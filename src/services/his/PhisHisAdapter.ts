/**
 * PhisHisAdapter
 *
 * 默认 HIS 厂商适配器：包装现有 `HisService` 类（即"国卫 PHIS / 院端 HIS"接入形态）。
 *
 * 之所以做成 thin wrapper 而不是搬代码：
 * - `HisService` 已稳定运行，方法签名和返回值都被业务方依赖，不能在抽象迁移这一步顺便改行为；
 * - 通过 wrapper 暴露 `HisAdapter` 接口后，业务方就只面向接口编程，未来要替换/迁移
 *   `HisService` 内部实现时不会牵连上层；
 * - 新厂商对接时不再需要复用 `HisService`，可以直接独立实现 `HisAdapter`。
 *
 * 当前会话/认证状态仍由 `HisService` 自己持有（baseUrl + token），由
 * `useEventListeners` 在 SDK handshake 时通过 `getHisService(baseUrl, auth)` 注入。
 * 适配器层对此无感。
 */

import { HisService } from '../hisService';
import type {
  HisDiagnosisCatalogItem,
  HisDictionaryItem,
  HisMedicalItemCatalogItem,
  HisMedicalItemPartOption,
  HisMedicineCatalogItem,
  HisVisitHistoryItem,
  HisVisitDetailBody,
  HisVisitDetailOrder,
  HisOutpatientMedicalRecordContentBody,
  HisOutpatientMedicalRecordDocumentBody,
} from '../hisService';
import type { HisAdapter, HisServiceContext } from './HisAdapter';
import type {
  HisHistoricalMedication,
  HisReportedApplication,
  HisReportedApplicationType,
  HisVisitRecord,
  HisVisitVitalSigns,
} from './types';
import { formatPatientAgeText } from '@entities/patient/lib/patientAge';
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
  HisInpatientEmrContextPackage,
  HisInpatientEmrContextQuery,
  HisOutpatientVisit,
  HisOutpatientVisitHistoryQuery,
  HisOutpatientMedicalRecordDocument,
  HisOutpatientMedicalRecord,
  HisOutpatientFollowUpContext,
  HisOutpatientFollowUpContextQuery,
  HisOutpatientFollowUpReportResults,
  HisOutpatientFollowUpReportResultsQuery,
} from './types';
import { mergePhisAvailableMedicineInventory } from './phisMedicineInventory';
import {
  normalizeHisOutpatientFollowUpContext,
  normalizeHisOutpatientFollowUpReportResults,
} from './reportNormalization';

const trim = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
};

const firstTrim = (record: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = trim(record[key]);
    if (value) return value;
  }
  return undefined;
};

const firstNumber = (record: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (!normalized) continue;
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const firstBool = (record: Record<string, unknown>, keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['1', 'true', 'y', 'yes', 'main', 'primary'].includes(normalized)) return true;
      if (['0', 'false', 'n', 'no'].includes(normalized)) return false;
    }
  }
  return undefined;
};

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const stripHtmlToText = (html: string): string => html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<\/(p|div|section|article|br|tr|li|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/g, "'")
  .replace(/[ \t\f\v]+/g, ' ')
  .replace(/\n\s+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

/** PHIS 业务类型编码 ↔ 中性枚举 */
const PHIS_BUSINESS_TYPE_MAP: Record<InventoryCheckRequest['businessType'], '1' | '2' | '3'> = {
  outpatient: '1',
  inpatient: '2',
  emergency: '3',
};

function mapDiagnosisCatalog(item: HisDiagnosisCatalogItem): DiagnosisCatalogEntry {
  return {
    id: trim(item.id) ?? trim(item.code) ?? '',
    code: trim(item.code),
    name: trim(item.name) ?? '',
    keywords: item.keywords,
    raw: { ...item },
  };
}

function mapMedicineCatalog(item: HisMedicineCatalogItem): MedicineCatalogEntry {
  const storeIds = Array.isArray(item.storeIds)
    ? Array.from(new Set(item.storeIds.map((value) => trim(value)).filter((value): value is string => Boolean(value))))
    : [];
  // PHIS 私有字段（idSrv / naSrv / sdSrv / idDeptExec / fgCheckOrd / fgSkintest）
  // 全部塞进 raw，业务通用代码不再访问
  return {
    id: trim(item.id) ?? '',
    code: trim(item.code),
    name: trim(item.name) ?? '',
    spec: trim(item.spec),
    storeIds,
    raw: {
      ...(item.raw && typeof item.raw === 'object' ? item.raw : {}),
      storeIds,
      idSrv: item.idSrv,
      naSrv: item.naSrv,
      sdSrv: item.sdSrv,
      idDeptExec: item.idDeptExec,
      fgCheckOrd: item.fgCheckOrd,
      fgSkintest: item.fgSkintest,
    },
  };
}


function mapMedicalItemPartOption(item: HisMedicalItemPartOption): MedicalItemPartOption | null {
  const partId = trim(item.idPart);
  const name = trim(item.partAndWay) ?? trim(item.sdPartText) ?? trim(item.sdWayText) ?? '无部位';
  if (!partId && !name) return null;

  return {
    partId: partId ?? '',
    itemId: trim(item.idCli),
    name,
    partAndWay: trim(item.partAndWay),
    partAndWayCode: trim(item.sdPartAndWay),
    pacsType: trim(item.sdPacstype),
    pacsTypeText: trim(item.sdPacstypeText),
    partText: trim(item.sdPartText),
    wayText: trim(item.sdWayText),
    amount: typeof item.amount === 'number' ? item.amount : undefined,
    raw: item as unknown as Record<string, unknown>,
  };
}

function mapMedicalItemCatalog(item: HisMedicalItemCatalogItem): MedicalItemCatalogEntry {
  return {
    id: trim(item.id) ?? '',
    code: trim(item.code),
    name: trim(item.name) ?? '',
    category: trim(item.category),
    keywords: item.keywords,
    unitPrice: typeof item.priceSale === 'number' ? item.priceSale : undefined,
    restricted: item.restricted === true,
    restrictionReason: trim(item.restrictionReason),
    mutualRecognitionCode: trim(item.mutualRecognitionCode) ?? '',
    raw: {
      ...(item.raw && typeof item.raw === 'object' ? item.raw : {}),
      idSrv: item.idSrv,
      naSrv: item.naSrv,
      sdSrv: item.sdSrv,
      idDeptExec: item.idDeptExec,
      idPart: item.idPart,
      jsonField: item.jsonField,
      fgCheckOrd: item.fgCheckOrd,
      mutualRecognitionCode: trim(item.mutualRecognitionCode) ?? '',
    },
  };
}

function mapDictionaryItem(item: HisDictionaryItem): DictionaryEntry | null {
  const text = trim(item.text);
  const key = trim(item.key) ?? text;
  if (!key || !text) return null;

  // 抽出已知中性字段，剩余的塞进 properties 透传
  const { key: _k, text: _t, py, wb, mcode, ...rest } = item;
  return {
    key,
    text,
    py: trim(py),
    wb: trim(wb),
    mcode: trim(mcode),
    properties: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

function mapDictionaryItems(items: HisDictionaryItem[]): DictionaryEntry[] {
  const result: DictionaryEntry[] = [];
  for (const item of items) {
    const entry = mapDictionaryItem(item);
    if (entry) result.push(entry);
  }
  return result;
}

function isMedicationOrder(order: HisVisitDetailOrder): boolean {
  const raw = order as Record<string, unknown>;
  const orderType = firstTrim(raw, ['sdOrd', 'sdSrv']);
  if (orderType) return orderType === '11';
  if (firstTrim(raw, ['idMedPro', 'idMed'])) return true;
  return firstBool(raw, ['fgDrug']) === true;
}

function sanitizeOrderDescription(value: unknown): string | undefined {
  const text = trim(value);
  if (!text) return undefined;
  const cleaned = text
    .replace(/\b(?:null|undefined)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(/^[,，;；:：\s]+|[,，;；:：\s]+$/gu, '')
    .trim();
  if (!cleaned || /^\d+(?:\.\d+)?\s*次$/u.test(cleaned)) return undefined;
  return cleaned;
}

function positiveNumberText(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstNumber(record, keys);
  return value !== undefined && value > 0 ? String(value) : undefined;
}

function positiveIntegerText(record: Record<string, unknown>, keys: string[]): string | undefined {
  const value = firstNumber(record, keys);
  return value !== undefined && value > 0 && Number.isInteger(value) ? String(value) : undefined;
}

function normalizeMedicationIdentity(value: unknown): string {
  return (trim(value) || '')
    .replace(/^[\s☆★*·•]+/u, '')
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
    .replace(/[\s,，、;；:：\-_/]/gu, '')
    .toLowerCase();
}

function findReliableMedicationOrder(
  prescriptionRaw: Record<string, unknown>,
  medicationOrders: HisVisitDetailOrder[],
): HisVisitDetailOrder | undefined {
  const orderId = firstTrim(prescriptionRaw, ['idOrd']);
  if (orderId) {
    const exact = medicationOrders.find((order) => trim(order.idOrd) === orderId);
    if (exact) return exact;
  }

  const productId = firstTrim(prescriptionRaw, ['idMedPro']);
  if (productId) {
    const matches = medicationOrders.filter((order) => (
      firstTrim(order as Record<string, unknown>, ['idMedPro', 'idMed']) === productId
    ));
    if (matches.length === 1) return matches[0];
  }

  const normalizedName = normalizeMedicationIdentity(prescriptionRaw.naMedPro);
  if (!normalizedName) return undefined;
  const matches = medicationOrders.filter((order) => (
    normalizeMedicationIdentity(order.naOrd) === normalizedName
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function mapPrescriptionMedication(
  raw: Record<string, unknown>,
  medicationOrders: HisVisitDetailOrder[],
): HisHistoricalMedication | null {
  const relatedOrder = findReliableMedicationOrder(raw, medicationOrders);
  const name = firstTrim(raw, ['naMedPro']) ?? trim(relatedOrder?.naOrd);
  if (!name) return null;

  return {
    orderId: firstTrim(raw, ['idOrd']) ?? trim(relatedOrder?.idOrd),
    productId: firstTrim(raw, ['idMedPro'])
      ?? firstTrim((relatedOrder || {}) as Record<string, unknown>, ['idMedPro', 'idMed']),
    name,
    spec: firstTrim(raw, ['specSale']),
    manufacturer: firstTrim(raw, ['naFac', 'manufacturer']),
    dose: positiveNumberText(raw, ['doseOnce', 'dose']),
    doseUnit: firstTrim(raw, ['unitDose']),
    frequency: firstTrim(raw, ['idFreqText']),
    frequencyKey: firstTrim(raw, ['idFreq']),
    route: firstTrim(raw, ['idUsgeText']),
    routeKey: firstTrim(raw, ['idUsge']),
    days: positiveIntegerText(raw, ['takeDays']),
    totalQty: positiveNumberText(raw, ['amount']),
    totalUnit: firstTrim(raw, ['unitSale']),
    raw: { ...raw },
  };
}

function isReliablyCoveredByPrescription(
  order: HisVisitDetailOrder,
  medicationOrders: HisVisitDetailOrder[],
  prescriptions: HisHistoricalMedication[],
): boolean {
  const orderId = trim(order.idOrd);
  if (orderId && prescriptions.some((item) => item.orderId === orderId)) return true;

  const productId = firstTrim(order as Record<string, unknown>, ['idMedPro', 'idMed']);
  if (productId) {
    const matchingOrders = medicationOrders.filter((item) => (
      firstTrim(item as Record<string, unknown>, ['idMedPro', 'idMed']) === productId
    ));
    const matchingPrescriptions = prescriptions.filter((item) => item.productId === productId);
    if (matchingOrders.length === 1 && matchingPrescriptions.length === 1) return true;
  }

  const normalizedName = normalizeMedicationIdentity(order.naOrd);
  if (!normalizedName) return false;
  const matchingOrders = medicationOrders.filter((item) => (
    normalizeMedicationIdentity(item.naOrd) === normalizedName
  ));
  const matchingPrescriptions = prescriptions.filter((item) => (
    normalizeMedicationIdentity(item.name) === normalizedName
  ));
  return matchingOrders.length === 1 && matchingPrescriptions.length === 1;
}

function mapFallbackOrderMedication(order: HisVisitDetailOrder): HisHistoricalMedication | null {
  const name = trim(order.naOrd);
  if (!name) return null;
  const raw = order as Record<string, unknown>;
  return {
    orderId: trim(order.idOrd),
    productId: firstTrim(raw, ['idMedPro', 'idMed']),
    name,
    totalQty: positiveNumberText(raw, ['amount']),
    totalUnit: trim(order.unitOrd),
    raw: { ...raw },
  };
}

function formatHistoricalMedication(item: HisHistoricalMedication): string {
  const fallbackDescription = !item.dose && !item.frequency && !item.route && !item.days
    ? sanitizeOrderDescription(item.raw?.desOrd)
    : undefined;
  const details = [
    fallbackDescription || '',
    item.dose && item.doseUnit ? `每次${item.dose}${item.doseUnit}` : '',
    item.frequency || '',
    item.route || '',
    item.days ? `${item.days}天` : '',
    item.totalQty && item.totalUnit ? `共${item.totalQty}${item.totalUnit}` : '',
  ].filter(Boolean);
  return details.length > 0 ? `${item.name}（${details.join(' ')}）` : item.name;
}

function mapHistoricalMedications(detail: HisVisitDetailBody): HisHistoricalMedication[] {
  const medicationOrders = (detail.orderList ?? []).filter(isMedicationOrder);
  const prescriptions = (detail.presList ?? [])
    .flatMap((prescription) => prescription.presSubList ?? [])
    .map((item) => mapPrescriptionMedication(item as Record<string, unknown>, medicationOrders))
    .filter((item): item is HisHistoricalMedication => Boolean(item));

  const fallbackOrders = medicationOrders
    .filter((order) => !isReliablyCoveredByPrescription(order, medicationOrders, prescriptions))
    .map(mapFallbackOrderMedication)
    .filter((item): item is HisHistoricalMedication => Boolean(item));

  return [...prescriptions, ...fallbackOrders];
}

function resolveReportedApplicationType(
  group: NonNullable<HisVisitDetailBody['applyList']>[number],
  item: NonNullable<NonNullable<HisVisitDetailBody['applyList']>[number]['items']>[number],
  orders: HisVisitDetailOrder[],
): HisReportedApplicationType {
  const groupId = trim(group.idApplySim);
  const applicationId = trim(item.idApply);
  const relatedOrder = orders.find((order) => {
    const orderGroupId = trim(order.idApplySim);
    const orderCombinationId = trim(order.idOrdComb);
    return Boolean(
      (groupId && orderGroupId === groupId)
      || (applicationId && orderCombinationId === applicationId),
    );
  });
  const orderType = trim(relatedOrder?.sdOrd) ?? trim(relatedOrder?.sdSrv);
  if (orderType === '41') return 'lab';
  if (orderType === '31') return 'exam';

  if (trim(item.naSpecimen) || trim(item.sdSpecimen)) return 'lab';
  const department = trim(group.naDeptExec) || '';
  if (/检验|化验/u.test(department)) return 'lab';
  if (/检查|影像|放射|超声|心电|内镜/u.test(department)) return 'exam';
  return 'unknown';
}

function mapReportedApplications(detail: HisVisitDetailBody): HisReportedApplication[] {
  const orders = detail.orderList ?? [];
  const applications = (detail.applyList ?? []).flatMap((group) => (
    (group.items ?? [])
      .filter((item) => trim(item.sdApply) === '3')
      .map((item): HisReportedApplication | null => {
        const applicationId = trim(item.idApply);
        const name = trim(item.naApply) ?? trim(group.naApplySim);
        if (!applicationId || !name) return null;
        return {
          applicationId,
          applicationGroupId: trim(item.idApplySim) ?? trim(group.idApplySim),
          name,
          type: resolveReportedApplicationType(group, item, orders),
          status: 'reported' as const,
          requestedAt: trim(item.insertTime) ?? trim(group.insertTime),
        };
      })
      .filter((item): item is HisReportedApplication => Boolean(item))
  ));

  return Array.from(new Map(
    applications.map((item) => [item.applicationId, item]),
  ).values());
}

const TEMPERATURE_TYPE_TEXT: Record<string, string> = {
  '1': '体温',
  '2': '腋温',
  '3': '肛温',
  '4': '耳温',
};

function hasVitalSignsValue(vitalSigns: HisVisitVitalSigns): boolean {
  return Object.values(vitalSigns).some((value) => typeof value !== 'undefined' && value !== '');
}

function mapVisitVitalSigns(detail: HisVisitDetailBody | null | undefined): HisVisitVitalSigns | undefined {
  const source = detail?.soapData?.vitlSigns;
  if (!source || typeof source !== 'object') return undefined;

  const raw = source as Record<string, unknown>;
  const temperatureTypeCode = firstTrim(raw, ['sdTemp', 'SD_TEMP']);
  const temperatureTypeText = temperatureTypeCode
    ? TEMPERATURE_TYPE_TEXT[temperatureTypeCode] || temperatureTypeCode
    : undefined;
  const vitalSigns: HisVisitVitalSigns = {
    systolicBloodPressure: firstNumber(raw, ['bph', 'BPH']),
    diastolicBloodPressure: firstNumber(raw, ['bpl', 'BPL']),
    heartRate: firstNumber(raw, ['healthRate', 'HEALTH_RATE']),
    pulseRate: firstNumber(raw, ['pulseRate', 'PULSE_RATE']),
    respiratoryRate: firstNumber(raw, ['breathRate', 'BREATH_RATE']),
    temperature: firstNumber(raw, ['temp', 'TEMP']),
    temperatureTypeText,
    heightCm: firstNumber(raw, ['height', 'HEIGHT']),
    weightKg: firstNumber(raw, ['weight', 'WEIGHT']),
    waistCm: firstNumber(raw, ['waist', 'WAIST']),
    firstBloodPressureMeasured: firstBool(raw, ['bloodFlag', 'BLOOD_FLAG']),
    measuredAt: firstTrim(raw, ['insertTime', 'INSERT_TIME']),
    updatedAt: firstTrim(raw, ['updateTime', 'UPDATE_TIME']),
  };

  return hasVitalSignsValue(vitalSigns) ? vitalSigns : undefined;
}

/**
 * 把 PHIS 单次就诊详情映射为中性 HisVisitRecord。
 *
 * 时间字段在 queryVisitHistory 列表项中可能位于 dtReg / dtVisit / dtBgn；详情接口
 * 当前响应未提供时间，因此优先取列表项里的时间，缺失时回退到 Date.now()，避免上层
 * 排序/落地时丢失整条记录。
 */
function mapVisitDetail(
  visit: HisVisitHistoryItem,
  detail: HisVisitDetailBody,
): HisVisitRecord {
  const visitTimeRaw = visit.visitTime ?? visit.dtReg ?? visit.dtBgn;
  let visitTime: number;
  if (typeof visitTimeRaw === 'number' && Number.isFinite(visitTimeRaw)) {
    visitTime = visitTimeRaw;
  } else if (typeof visitTimeRaw === 'string' && visitTimeRaw.trim()) {
    const parsed = Date.parse(visitTimeRaw);
    visitTime = Number.isFinite(parsed) ? parsed : Date.now();
  } else {
    visitTime = Date.now();
  }

  const soap = detail.soapData ?? {};
  const chiefComplaint = trim((soap as Record<string, unknown>)['chiefComplaint'] as string | undefined);
  const presentIllness = trim((soap as Record<string, unknown>)['presentIllness'] as string | undefined);

  const diagnosisEntries = Array.from(new Map(
    (detail.diagList ?? [])
      .map((diagnosis) => {
        const name = trim(diagnosis.naDiag) ?? trim(diagnosis.naIcd10);
        if (!name) return null;
        const code = trim(diagnosis.cdIcd10);
        return {
          name,
          ...(code ? { code } : {}),
        };
      })
      .filter((diagnosis): diagnosis is { name: string; code?: string } => Boolean(diagnosis))
      .map((diagnosis) => [`${diagnosis.name}\u0000${diagnosis.code || ''}`, diagnosis]),
  ).values());
  const diagnoses = Array.from(new Set(diagnosisEntries.map((diagnosis) => diagnosis.name)));

  const medicationOrders = mapHistoricalMedications(detail);
  const medications = medicationOrders.map(formatHistoricalMedication);
  const reportedApplications = mapReportedApplications(detail);
  const vitalSigns = mapVisitVitalSigns(detail);
  const deptName = firstTrim(visit as Record<string, unknown>, [
    'idDeptText',
    'deptName',
    'naDept',
    'naDeptExec',
  ]) ?? firstTrim(detail as Record<string, unknown>, [
    'idDeptText',
    'deptName',
    'naDept',
    'naDeptExec',
  ]);

  return {
    visitId: trim(visit.idVis),
    visitTime,
    deptName,
    chiefComplaint,
    presentIllness,
    diagnoses: diagnoses.length > 0 ? diagnoses : undefined,
    diagnosisEntries: diagnosisEntries.length > 0 ? diagnosisEntries : undefined,
    medications: medications.length > 0 ? medications : undefined,
    medicationOrders: medicationOrders.length > 0 ? medicationOrders : undefined,
    vitalSigns,
    reportedApplications: reportedApplications.length > 0 ? reportedApplications : undefined,
  };
}

function splitTextList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(/[、,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? Array.from(new Set(items)) : undefined;
}

function mapOutpatientVisitHistoryItem(
  item: HisVisitHistoryItem,
  fallbackPatientId: string,
): HisOutpatientVisit | null {
  const raw = item as Record<string, unknown>;
  const visitId = firstTrim(raw, ['idVis', 'visitId']);
  if (!visitId) return null;

  return {
    visitId,
    patientId: firstTrim(raw, ['idPi', 'patientId']) ?? fallbackPatientId,
    registrationId: firstTrim(raw, ['idReg', 'registrationId']),
    clinicNo: firstTrim(raw, ['cdClinic', 'clinicNo']),
    visitDate: firstTrim(raw, ['dtBgn', 'dtReg', 'dtVis', 'dtVisit', 'visitTime', 'insertTime'])
      ?? new Date().toISOString(),
    deptName: firstTrim(raw, ['idDeptText', 'deptName', 'naDept', 'naDeptExec']),
    doctorName: firstTrim(raw, ['idDocText', 'naDoc', 'doctorName']),
    orgName: firstTrim(raw, ['idOrgText', 'orgName', 'naOrg']),
    statusText: firstTrim(raw, ['fgStatusText', 'statusText']),
    visiting: firstBool(raw, ['visiting']),
    diagnoses: splitTextList(firstTrim(raw, ['naDiag', 'diagnoses', 'diagnosis'])),
    chiefComplaint: firstTrim(raw, ['chiefComplaint', 'complaint']),
    raw,
  };
}

function normalizeOutpatientVisitHistoryQuery(
  query: number | HisOutpatientVisitHistoryQuery | undefined,
): Required<Pick<HisOutpatientVisitHistoryQuery, 'limit' | 'requireDiagnosisAndRecord'>> & Pick<HisOutpatientVisitHistoryQuery, 'dateRange'> {
  if (typeof query === 'number') {
    return {
      limit: query,
      requireDiagnosisAndRecord: false,
    };
  }
  return {
    limit: query?.limit ?? -1,
    dateRange: query?.dateRange,
    requireDiagnosisAndRecord: query?.requireDiagnosisAndRecord ?? false,
  };
}

function hasEffectiveOutpatientDiagnosis(visit: HisOutpatientVisit): boolean {
  return Boolean(visit.diagnoses?.some((item) => item.trim()));
}

function mapOutpatientMedicalRecordDocument(
  item: HisOutpatientMedicalRecordDocumentBody,
  fallbackVisitId: string,
): HisOutpatientMedicalRecordDocument | null {
  const raw = item as Record<string, unknown>;
  const documentId = firstTrim(raw, ['idMedrecdoc', 'documentId', 'id']);
  const title = firstTrim(raw, ['naMed', 'title', 'name']) ?? '未命名门诊病历';
  const visitId = firstTrim(raw, ['idHospital', 'visitId', 'idVis']) ?? fallbackVisitId;
  if (!documentId || !visitId) return null;

  return {
    documentId,
    visitId,
    appId: firstTrim(raw, ['idApp']),
    tenantId: firstTrim(raw, ['idTet']),
    title,
    createdAt: firstTrim(raw, ['createTime']),
    insertedAt: firstTrim(raw, ['insertTime']),
    titleTime: firstTrim(raw, ['titleTime']),
    medType: firstTrim(raw, ['medType']),
    committed: firstBool(raw, ['fgCommit']),
    closed: firstBool(raw, ['fgClose']),
    sealed: firstBool(raw, ['fgSeal']),
    raw,
  };
}

function buildOutpatientDocumentListHtml(
  visitId: string,
  documents: HisOutpatientMedicalRecordDocument[],
): string {
  const rows = documents.map((doc) => `
    <tr>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #0f172a; font-weight: 600;">${escapeHtml(doc.title)}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #475569;">${escapeHtml(doc.titleTime || doc.createdAt || doc.insertedAt || '-')}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #475569;">${escapeHtml(doc.committed ? '已提交' : '未提交')}</td>
      <td style="padding: 8px 10px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;">${escapeHtml(doc.documentId)}</td>
    </tr>
  `).join('');

  return `
    <div class="outpatient-record-preview" style="font-family: Inter, system-ui, -apple-system, sans-serif; padding: 20px; color: #1e293b; background: #ffffff; border-radius: 8px; max-width: 760px; margin: 0 auto; line-height: 1.6;">
      <h2 style="text-align: center; margin: 0 0 16px 0; color: #0f172a; font-size: 18px; font-weight: 700; border-bottom: 2px solid #0f8f7b; padding-bottom: 12px;">门急诊病历文书列表</h2>
      <div style="margin-bottom: 14px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; color: #475569; font-size: 13px;">
        已根据门诊就诊 <strong style="color:#0f172a;">${escapeHtml(visitId)}</strong> 获取到 ${documents.length} 份病历文书，但正文内容暂不可用，因此 AI 不会把文书标题当作主诉或现病史事实使用。
      </div>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
        <thead>
          <tr style="background: #f1f5f9; color: #334155;">
            <th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">文书名称</th>
            <th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">标题时间</th>
            <th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">状态</th>
            <th style="text-align: left; padding: 8px 10px; border-bottom: 1px solid #e2e8f0;">文书ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function chooseOutpatientRecordDocument(
  documents: HisOutpatientMedicalRecordDocument[],
): HisOutpatientMedicalRecordDocument | null {
  if (documents.length === 0) return null;
  return documents.find((doc) => doc.medType === '0')
    ?? documents.find((doc) => /门急诊病历|门诊病历|病历首页|首页/.test(doc.title))
    ?? documents[0];
}

function mapOutpatientMedicalRecordContent(
  visitId: string,
  document: HisOutpatientMedicalRecordDocument,
  documents: HisOutpatientMedicalRecordDocument[],
  content: HisOutpatientMedicalRecordContentBody,
): HisOutpatientMedicalRecord | null {
  const htmlContent = trim(content.htmlContent);
  if (!htmlContent) return null;

  return {
    visitId,
    documentId: document.documentId,
    documentTitle: document.title,
    htmlContent,
    plainText: stripHtmlToText(htmlContent),
    documents,
    raw: {
      source: 'getMedContentLook',
      document: document.raw || document,
      content: content as unknown as Record<string, unknown>,
      documents: documents.map((doc) => doc.raw || doc),
    },
  };
}

export class PhisHisAdapter implements HisAdapter {
  readonly vendor = 'phis';
  private visitPatientMap = new Map<string, string>();
  private visitTenantMap = new Map<string, string>();
  private visitDocumentCache = new Map<string, HisOutpatientMedicalRecordDocument[]>();
  private lastPatientId?: string;

  constructor(private readonly service: HisService) {}

  updateContext(context: HisServiceContext): void {
    this.service.updateContext(context);
  }

  getDefaultExecDeptId(): string {
    return this.service.getDefaultExecDeptId();
  }

  getContextScope() {
    return {
      orgCode: this.service.getOrgCode(),
      tenantId: this.service.getTenantId(),
    };
  }

  // ---- 目录 ----

  async fetchDiagnosisCatalog(): Promise<DiagnosisCatalogEntry[]> {
    const items = await this.service.fetchDiagnosisCatalog();
    return items.map(mapDiagnosisCatalog);
  }

  async fetchInstitutionMedicalItemsCatalog(orgCode: string): Promise<MedicalItemCatalogEntry[]> {
    const items = await this.service.fetchInstitutionMedicalItemsCatalog(orgCode);
    return items.map(mapMedicalItemCatalog);
  }

  async fetchInstitutionMedicineCatalog(orgCode: string): Promise<MedicineCatalogEntry[]> {
    const items = await this.service.fetchInstitutionMedicineCatalog(orgCode);
    return items.map(mapMedicineCatalog);
  }

  fetchMedicineStoreIds(orgCode: string) {
    return this.service.fetchMedicineStoreIds(orgCode);
  }

  // ---- 字典 ----

  async fetchFrequencyDictionary(): Promise<DictionaryEntry[]> {
    return mapDictionaryItems(await this.service.fetchFrequencyDictionary());
  }

  async fetchMedicineUsageDictionary(): Promise<DictionaryEntry[]> {
    return mapDictionaryItems(await this.service.fetchMedicineUsageDictionary());
  }

  async fetchExecutionDepartments(): Promise<DictionaryEntry[]> {
    return mapDictionaryItems(await this.service.fetchExecutionDepartments());
  }

  fetchAvailablePharmacies() {
    return this.service.fetchAvailablePharmacies();
  }

  async fetchAvailableMedicineInventory(storeId: string): Promise<AvailableMedicineInventoryItem[]> {
    const batches = await this.service.fetchAvailableMedicineInventory(storeId);
    return mergePhisAvailableMedicineInventory(batches, storeId);
  }

  // ---- 详情 ----

  async fetchMedicalItemDetail(itemId: string): Promise<MedicalItemDetail | null> {
    const detail = await this.service.fetchMedicalItemDetail(itemId);
    if (!detail) return null;

    const raw = detail as unknown as Record<string, unknown>;
    return {
      itemId: trim(detail.idCli) ?? itemId,
      itemName: trim(detail.naCli) ?? '',
      unit: trim(detail.unit),
      executingDeptId: trim(detail.idDeptExec),
      defaultQuantity: firstNumber(raw, ['count', 'amount', 'quantity']),
      raw,
    };
  }

  async fetchMedicalItemPartOptions(itemId: string): Promise<MedicalItemPartOption[]> {
    const items = await this.service.fetchMedicalItemPartOptions(itemId);
    return items
      .map(mapMedicalItemPartOption)
      .filter((item): item is MedicalItemPartOption => Boolean(item));
  }

  async fetchMedicineProDetail(productId: string, storeId: string): Promise<MedicineDetail | null> {
    const detail = await this.service.fetchMedicineProDetail(productId, storeId);
    if (!detail) return null;

    return {
      productId: trim(detail.idMedPro) ?? productId,
      productName: trim(detail.naMedPro) ?? '',
      medicineId: trim(detail.idMed),
      medicineName: trim(detail.naMed),
      manufacturer: trim(detail.naFac),
      active: detail.fgActive !== '0',

      specSale: trim(detail.specSale),
      unitSale: trim(detail.unitSale),
      spec: trim(detail.spec),
      doseUnit: trim(detail.unitDose) ?? trim(detail.unitPre),
      dose: trim(detail.dose),

      defaultSingleDose: trim(detail.dftDoseOnce),
      defaultFrequency: trim(detail.dftFreq),
      defaultRoute: trim(detail.dftUsage),

      storeId: trim(detail.idSto) ?? storeId,
      needsSkinTest: detail.fgSkintest === '1',

      raw: detail as unknown as Record<string, unknown>,
    };
  }

  // ---- 库存校验 ----

  checkMedicineInventoryEnough(items: InventoryCheckRequest[]): Promise<InventoryCheckResult> {
    if (items.length === 0) {
      return Promise.resolve({ code: 200, message: '' });
    }

    const phisItems = items.map((item) => ({
      idSto: item.storeId,
      idMedPro: item.productId,
      naMed: item.medicineName,
      amount: item.quantity,
      priceSale: item.unitPrice,
      sdFrzBiz: PHIS_BUSINESS_TYPE_MAP[item.businessType],
    }));

    return this.service
      .checkMedicineInventoryEnough(phisItems)
      .then((result) => ({ code: result.code, message: result.msg }));
  }

  // ---- 接诊与患者信息 ----

  async fetchPatientInfo(patientId: string): Promise<HisPatientInfo | null> {
    const idPi = trim(patientId);
    if (!idPi) return null;
    this.lastPatientId = idPi;

    const detail = await this.service.searchPatientByIdPiMB(idPi);
    if (!detail) return null;

    const sdSex = trim(detail.sdSex);
    const gender: HisPatientInfo['gender'] = sdSex === '1' ? 'M' : sdSex === '2' ? 'F' : 'O';

    // 仅当 ageUnit 为年（'Y'）时把 ageNum 当作"岁"返回；其它单位（D/M）下
    // ageNum 不是岁数，留空让上层只用 ageText 展示
    const ageUnit = trim(detail.ageUnit)?.toUpperCase();
    const age = ageUnit === 'Y' && typeof detail.ageNum === 'number' ? detail.ageNum : undefined;
    const ageText = formatPatientAgeText(detail.ageText, ageUnit)
      || formatPatientAgeText(detail.ageNum, ageUnit);
    const signedStatus = trim(detail.qyzt)
      ?? (typeof detail.qyzt === 'number' ? String(detail.qyzt) : undefined);

    return {
      patientId: trim(detail.idPi) ?? idPi,
      name: trim(detail.naPi) ?? '',
      gender,
      age,
      ageText: ageText || undefined,
      idNo: trim(detail.idCard),
      mobilePhone: trim(detail.mobilePhone),
      signed: signedStatus ? signedStatus === '8' : undefined,
      raw: detail as unknown as Record<string, unknown>,
    };
  }

  async fetchPatientHistory(
    patientId: string,
    query: HisPatientHistoryQuery = {},
  ): Promise<HisPatientHistory | null> {
    const idPi = trim(patientId);
    if (!idPi) return null;
    this.lastPatientId = idPi;
    if (query.currentVisitId) {
      const trimmedVisitId = trim(query.currentVisitId);
      if (trimmedVisitId) {
        this.visitPatientMap.set(trimmedVisitId, idPi);
      }
    }

    // 1) 并发拉过敏史与就诊列表；任一失败不中断另一路
    const [allergyItems, visitItems] = await Promise.all([
      this.service.queryPatientAllergy(idPi).catch(() => {
        console.warn('[PhisHisAdapter] queryPatientAllergy failed');
        return [];
      }),
      this.service.queryPatientVisitHistory(idPi, {
        limit: query.limit ?? 5,
        idVis: query.currentVisitId,
        dtBgn: query.dateRange,
      }).catch(() => {
        console.warn('[PhisHisAdapter] queryPatientVisitHistory failed');
        return [] as HisVisitHistoryItem[];
      }),
    ]);

    const allergyHistory = allergyItems
      .map((item) => trim(item.naAliergy))
      .filter((value): value is string => Boolean(value));

    // 2) 对列表中的每条并发拉明细（失败跳过该条）
    const detailEntries = await Promise.all(
      visitItems.map(async (visit) => {
        const idVis = trim(visit.idVis);
        if (!idVis) return null;
        const visitIdPi = trim(visit.idPi) ?? idPi;
        try {
          const detail = await this.service.loadClinicMedicalRecord(idVis, visitIdPi);
          return detail ? { visit, detail } : null;
        } catch {
          console.warn('[PhisHisAdapter] loadClinicMedicalRecord failed');
          return null;
        }
      })
    );

    const visits: HisVisitRecord[] = detailEntries
      .filter((entry): entry is { visit: HisVisitHistoryItem; detail: HisVisitDetailBody } => Boolean(entry))
      .map(({ visit, detail }) => mapVisitDetail(visit, detail));

    return {
      patientId: idPi,
      allergyHistory: allergyHistory.length > 0 ? allergyHistory : undefined,
      pastMedicalHistory: undefined,
      visits: visits.length > 0 ? visits : undefined,
      raw: {
        allergyItems,
        visitItems,
      },
    };
  }

  async fetchOutpatientFollowUpContext(
    query: HisOutpatientFollowUpContextQuery,
  ): Promise<HisOutpatientFollowUpContext | null> {
    const context = await this.service.buildOutpatientFollowUpContext(query);
    return normalizeHisOutpatientFollowUpContext(context);
  }

  async fetchOutpatientFollowUpReportResults(
    query: HisOutpatientFollowUpReportResultsQuery,
  ): Promise<HisOutpatientFollowUpReportResults | null> {
    const results = await this.service.buildOutpatientFollowUpReportResults(query);
    return normalizeHisOutpatientFollowUpReportResults(results);
  }

  // ---- 住院上下文 ----

  async fetchInpatientEmrContext(query: HisInpatientEmrContextQuery): Promise<HisInpatientEmrContextPackage | null> {
    return this.service.buildInpatientEmrContext(query);
  }

  async fetchOutpatientVisitHistory(
    patientId: string,
    query?: number | HisOutpatientVisitHistoryQuery,
  ): Promise<HisOutpatientVisit[]> {
    const idPi = trim(patientId);
    if (!idPi) return [];
    this.lastPatientId = idPi;
    const normalizedQuery = normalizeOutpatientVisitHistoryQuery(query);

    try {
      const visitItems = await this.service.queryPatientVisitHistory(idPi, {
        limit: normalizedQuery.limit,
        dtBgn: normalizedQuery.dateRange,
      });
      if (!Array.isArray(visitItems) || visitItems.length === 0) {
        return [];
      }

      const visits = visitItems
        .map((visit) => mapOutpatientVisitHistoryItem(visit, idPi))
        .filter((visit): visit is HisOutpatientVisit => Boolean(visit));

      visits.forEach((visit) => {
        this.visitPatientMap.set(visit.visitId, visit.patientId || idPi);
        const tenantId = firstTrim((visit.raw || {}) as Record<string, unknown>, ['idTet', 'tenantId']);
        if (tenantId) {
          this.visitTenantMap.set(visit.visitId, tenantId);
        }
      });

      if (!normalizedQuery.requireDiagnosisAndRecord) {
        return visits;
      }

      const visitsWithDiagnosis = visits.filter(hasEffectiveOutpatientDiagnosis);
      const visitsWithDocumentStatus = await Promise.all(visitsWithDiagnosis.map(async (visit) => {
        const documents = await this.fetchOutpatientMedicalRecordDocuments(visit.visitId);
        return {
          ...visit,
          hasMedicalRecord: documents.length > 0,
          medicalRecordDocumentCount: documents.length,
        };
      }));

      return visitsWithDocumentStatus.filter((visit) => visit.hasMedicalRecord);
    } catch {
      console.error('[PhisHisAdapter] fetchOutpatientVisitHistory failed');
      return [];
    }
  }

  async fetchOutpatientMedicalRecordDocuments(visitId: string): Promise<HisOutpatientMedicalRecordDocument[]> {
    const idVis = trim(visitId);
    if (!idVis) return [];

    const cached = this.visitDocumentCache.get(idVis);
    if (cached) {
      return cached;
    }

    const idTet = this.visitTenantMap.get(idVis) || this.service.getTenantId();
    try {
      const documents = await this.service.queryOutpatientMedicalRecordDocuments(idVis, {
        idTet,
        idApp: '42',
      });
      const mappedDocuments = documents
        .map((item) => mapOutpatientMedicalRecordDocument(item, idVis))
        .filter((item): item is HisOutpatientMedicalRecordDocument => Boolean(item));
      this.visitDocumentCache.set(idVis, mappedDocuments);
      return mappedDocuments;
    } catch {
      console.error('[PhisHisAdapter] fetchOutpatientMedicalRecordDocuments failed', {
        hasTenant: Boolean(idTet),
      });
      return [];
    }
  }

  async fetchOutpatientMedicalRecord(visitId: string): Promise<HisOutpatientMedicalRecord | null> {
    const idVis = trim(visitId);
    if (!idVis) return null;

    const idPi = this.visitPatientMap.get(idVis) ?? this.lastPatientId;
    let detail: HisVisitDetailBody | null = null;
    if (idPi) {
      try {
        detail = await this.service.loadClinicMedicalRecord(idVis, idPi);
      } catch {
        console.warn('[PhisHisAdapter] Failed to load clinic medical record for raw merge', {
          hasPatient: true,
        });
      }
    }

    const documents = await this.fetchOutpatientMedicalRecordDocuments(idVis);
    if (documents.length > 0) {
      const document = chooseOutpatientRecordDocument(documents);
      const idTet = (document?.tenantId || this.visitTenantMap.get(idVis) || this.service.getTenantId()).trim();
      if (document) {
        try {
          const content = await this.service.queryOutpatientMedicalRecordContent(document.documentId, {
            idTet,
            idApp: document.appId || '42',
            courseShow: 0,
          });
          const record = content ? mapOutpatientMedicalRecordContent(idVis, document, documents, content) : null;
          if (record) {
            const vitalSigns = mapVisitVitalSigns(detail);
            record.raw = {
              ...(record.raw || {}),
              detail,
            };
            if (vitalSigns) {
              record.vitalSigns = vitalSigns;
            }
            return record;
          }
        } catch {
          console.error('[PhisHisAdapter] fetchOutpatientMedicalRecord content failed', {
            hasTenant: Boolean(idTet),
            hasDocument: true,
          });
        }
      }

      return {
        visitId: idVis,
        documents,
        contentPending: true,
        vitalSigns: mapVisitVitalSigns(detail),
        htmlContent: buildOutpatientDocumentListHtml(idVis, documents),
        plainText: documents.map((doc) => [doc.title, doc.titleTime || doc.createdAt].filter(Boolean).join(' / ')).join('\n'),
        raw: {
          source: 'getLookMedList',
          documents: documents.map((doc) => doc.raw || doc),
          detail,
        },
      };
    }

    if (!idPi) {
      console.warn('[PhisHisAdapter] Cannot resolve patient for outpatient visit');
      return null;
    }

    try {
      if (!detail) {
        detail = await this.service.loadClinicMedicalRecord(idVis, idPi);
      }
      if (!detail) return null;

      const soapRaw = (detail.soapData ?? {}) as Record<string, unknown>;
      const chiefComplaint = trim(soapRaw.chiefComplaint as string);
      const historyOfPresentIllness = trim(soapRaw.presentIllness as string) ?? trim(soapRaw.historyOfPresentIllness as string);
      const pastHistory = trim(soapRaw.pastHistory as string) ?? trim(soapRaw.pastMedicalHistory as string);
      const physicalExamination = trim(soapRaw.physicalExam as string) ?? trim(soapRaw.physicalExamination as string);
      const auxiliaryExamination = trim(soapRaw.auxiliaryExam as string) ?? trim(soapRaw.auxiliaryExamination as string);

      const diagnoses = (detail.diagList ?? [])
        .map((d) => trim(d.naDiag) ?? trim(d.naIcd10))
        .filter((value): value is string => Boolean(value));
      const diagnosis = diagnoses.join(', ') || undefined;

      const treatmentPlan = (detail.orderList ?? [])
        .map((o) => {
          const name = trim(o.naOrd) ?? '';
          const des = trim(o.desOrd) ? `（${trim(o.desOrd)}）` : '';
          return `${name}${des}`;
        })
        .filter(Boolean)
        .join('; ') || undefined;

      const deptName = trim(detail.deptName as string) ?? trim(detail.naDept as string) ?? '未知科室';
      const visitDate = trim(detail.visitTime as string) ?? trim(detail.dtVis as string) ?? new Date().toISOString().split('T')[0];
      const vitalSigns = mapVisitVitalSigns(detail);

      // 生成精美的 HTML 病历
      const htmlContent = `
        <div class="outpatient-record-preview" style="font-family: Inter, system-ui, -apple-system, sans-serif; padding: 20px; color: #1e293b; background: #ffffff; border-radius: 8px; max-width: 680px; margin: 0 auto; line-height: 1.6;">
          <h2 style="text-align: center; margin: 0 0 20px 0; color: #0f172a; font-size: 18px; font-weight: 700; border-bottom: 2px solid #0f8f7b; padding-bottom: 12px; letter-spacing: 0.5px;">门急诊病历记录</h2>
          
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px; padding: 12px 16px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 13px;">
            <div><span style="color: #64748b; font-weight: 500;">就诊科室：</span><span style="color: #334155; font-weight: 600;">${deptName}</span></div>
            <div><span style="color: #64748b; font-weight: 500;">就诊日期：</span><span style="color: #334155;">${visitDate}</span></div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 16px; font-size: 14px;">
            ${chiefComplaint ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>主诉
              </div>
              <div style="padding-left: 9px; color: #334155;">${chiefComplaint}</div>
            </div>` : ''}

            ${historyOfPresentIllness ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>现病史
              </div>
              <div style="padding-left: 9px; color: #334155;">${historyOfPresentIllness}</div>
            </div>` : ''}

            ${pastHistory ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>既往史
              </div>
              <div style="padding-left: 9px; color: #334155;">${pastHistory}</div>
            </div>` : ''}

            ${physicalExamination ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>体格检查
              </div>
              <div style="padding-left: 9px; color: #334155;">${physicalExamination}</div>
            </div>` : ''}

            ${auxiliaryExamination ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>辅助检查
              </div>
              <div style="padding-left: 9px; color: #334155;">${auxiliaryExamination}</div>
            </div>` : ''}

            ${diagnosis ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>初步诊断
              </div>
              <div style="padding-left: 9px; color: #0f172a; font-weight: 600;">${diagnosis}</div>
            </div>` : ''}

            ${treatmentPlan ? `
            <div>
              <div style="font-weight: 700; color: #0f8f7b; margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                <span style="width: 3px; height: 12px; background: #0f8f7b; display: inline-block; border-radius: 2px;"></span>治疗意见/处置
              </div>
              <div style="padding-left: 9px; color: #334155;">${treatmentPlan}</div>
            </div>` : ''}
          </div>
        </div>
      `;

      return {
        visitId,
        chiefComplaint,
        historyOfPresentIllness,
        pastHistory,
        physicalExamination,
        auxiliaryExamination,
        diagnosis,
        treatmentPlan,
        vitalSigns,
        htmlContent,
        raw: {
          ...(detail as unknown as Record<string, unknown>),
          detail,
        },
      };
    } catch {
      console.error('[PhisHisAdapter] fetchOutpatientMedicalRecord failed', {
        hasPatient: true,
      });
      return null;
    }
  }
}
