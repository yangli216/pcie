/**
 * record-confirmed 病历回写 payload 构造器
 *
 * 用途：症状问诊 / 语音问诊在医生确认后向 PHIS 回写完整病历的统一构造点。
 * 详细字段约定见 api.md 的「问诊一键确认回写（record-confirmed）」章节。
 *
 * 设计原则：
 * 1. 纯函数 + 显式注入依赖，不直接读取任何组件状态；
 * 2. 当上游 UI 还未采集某些字段时，仅保留接口级安全默认（fgSkintest=0、sdSrv 按 type 兜底等）；
 *    执行位置、医保限用、药品/处置数量等医生必填字段必须由共享前置校验先拦截；
 * 3. 中性 DTO，不携带 PHIS 私有字段；PHIS 私有字段通过 `rec.matchedItem.raw` 透传。
 */

import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type { ClinicalResultChannel } from './clinicalResultContract';
import {
  buildOutpatientRecord,
  type OutpatientRecord,
} from './outpatientRecord';
import {
  collectHistoryRecordTemplateChanges,
  stripHistoryRecordTemplateMarkers,
  type HistoryRecordTemplateField,
} from './historyRecordTemplates';
import { collectPhysicalExamVitalSigns } from './physicalExamVitalTemplate';

// ===== 通用小工具（与语音侧 readFirstString / toPositiveNumber 同源） =====

export const TREATMENT_REMARK_MAX_LENGTH = 200;

export function readFirstString(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string {
  if (!source) return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

export function toPositiveNumber(value: unknown, fallback = 1): number {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getTreatmentRemarkLength(value: unknown): number {
  const text = typeof value === 'string' ? value : String(value ?? '');
  return Array.from(text).length;
}

export function isTreatmentRemarkOverLimit(value: unknown): boolean {
  return getTreatmentRemarkLength(value) > TREATMENT_REMARK_MAX_LENGTH;
}

export function getMatchedItemRaw(
  rec: TreatmentRecommendation,
): Record<string, unknown> | undefined {
  const raw = (rec.matchedItem as { raw?: unknown } | undefined)?.raw;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : undefined;
}

export function getMatchedMedicalItemClientId(
  rec: TreatmentRecommendation,
): string {
  const raw = getMatchedItemRaw(rec);
  const matchedItem = rec.matchedItem as { idCli?: unknown; code?: unknown } | undefined;

  return (
    readFirstString(raw, ['idCli'])
    || readFirstString(matchedItem as Record<string, unknown> | undefined, ['idCli', 'code'])
  ).trim();
}

export function getMatchedOrderServiceId(
  rec: TreatmentRecommendation,
): string {
  const raw = getMatchedItemRaw(rec);
  const matchedItem = rec.matchedItem as {
    id?: unknown;
    idMedPro?: unknown;
    idCli?: unknown;
    code?: unknown;
  } | undefined;

  if (rec.type === 'medicine') {
    return (
      readFirstString(raw, ['idMedPro', 'idMed'])
      || readFirstString(matchedItem as Record<string, unknown> | undefined, ['idMedPro', 'id'])
    ).trim();
  }

  return getMatchedMedicalItemClientId(rec);
}

export function getDefaultOrderServiceCode(type: TreatmentRecommendation['type']): string {
  switch (type) {
    case 'medicine':
      return '11';
    case 'exam':
      return '31';
    case 'lab_test':
      return '41';
    default:
      return '21';
  }
}

export function getOrderServiceCode(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  const explicitCode = (rec.matchedItem?.sdSrv || readFirstString(raw, ['sdSrv'])).trim();
  if (explicitCode && explicitCode !== '1' && explicitCode !== '2') {
    return explicitCode;
  }
  return getDefaultOrderServiceCode(rec.type);
}

export function getOrderServiceName(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  return (
    rec.matchedItem?.naSrv
    || readFirstString(raw, ['naSrv', 'naCli', 'naMedPro', 'naMed'])
    || rec.matchedItem?.name
    || rec.name
    || ''
  ).trim();
}

export function getOrderPartId(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  return (rec.bodySiteId || rec.matchedItem?.idPart || readFirstString(raw, ['idPart'])).trim();
}

export function getOrderJsonField(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  const explicitJsonField = (rec.matchedItem?.jsonField || readFirstString(raw, ['jsonField'])).trim();
  if (explicitJsonField) {
    return explicitJsonField;
  }

  const idLisCategory = readFirstString(raw, ['idLisCategory']);
  const fgCombination = readFirstString(raw, ['fgCombination']);
  if (!idLisCategory && !fgCombination) {
    return '';
  }

  return JSON.stringify({
    ...(idLisCategory ? { idLisCategory } : {}),
    ...(fgCombination ? { fgCombination } : {}),
  });
}

export function getOrderFgCheckOrd(rec: TreatmentRecommendation): string {
  if (rec.insuranceCleared) {
    return '';
  }
  const insuranceType = (rec.insuranceType || '').trim();
  if (insuranceType === '自费' || insuranceType === '自费使用') {
    return '2';
  }
  if (insuranceType === '医保使用' || insuranceType === '医保' || insuranceType === '医保限用') {
    return '1';
  }
  if (!insuranceType) {
    return '1';
  }
  const raw = getMatchedItemRaw(rec);
  return (rec.matchedItem?.fgCheckOrd || readFirstString(raw, ['fgCheckOrd']) || '1').trim() || '1';
}

export function getOrderFgSkintest(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  return (rec.matchedItem?.fgSkintest || readFirstString(raw, ['fgSkintest']) || '0').trim() || '0';
}

export function getOrderMutualRecognitionCode(rec: TreatmentRecommendation): string {
  const raw = getMatchedItemRaw(rec);
  const matchedItem = rec.matchedItem as { mutualRecognitionCode?: unknown } | undefined;
  return (
    readFirstString(matchedItem as Record<string, unknown> | undefined, ['mutualRecognitionCode'])
    || readFirstString(raw, ['mutualRecognitionCode'])
  ).trim();
}

// ===== diagList =====

export interface BuildDiagListInput {
  /** 已勾选的诊断列表（包含主诊断） */
  selectedDiagnoses: Diagnosis[];
  /** 主诊断（fgMain=1 的那一个，必须包含在 selectedDiagnoses 中） */
  primaryDiagnosis: Diagnosis | null;
  /** 患者 idTet（来自 PHIS 患者上下文） */
  patientTetId: string;
}

export function getDiagnosisKey(diag: Diagnosis | null | undefined): string {
  if (!diag) return '';
  return `${diag.id || ''}|${diag.code || ''}|${diag.name || ''}`;
}

function getDiagnosisCategoryCode(diag: Diagnosis): string {
  return diag.isTCM ? '2' : '1';
}

function getDiagnosisCategoryText(diag: Diagnosis): string {
  return diag.isTCM ? '中医诊断' : '西医诊断';
}

export function isFrontendDiagnosisId(id: string | null | undefined): boolean {
  const normalized = (id || '').trim();
  return normalized.startsWith('diag_') || normalized.startsWith('phis-diagnosis-');
}

export function getStandardDiagnosisId(diag: Diagnosis | null | undefined): string {
  if (
    diag?.catalogMatchStatus === 'compatible'
    || diag?.catalogMatchStatus === 'ambiguous'
    || diag?.catalogMatchStatus === 'conflict'
    || diag?.catalogMatchStatus === 'unmatched'
  ) {
    return '';
  }
  const id = (diag?.id || '').trim();
  return id && !isFrontendDiagnosisId(id) ? id : '';
}

export function getStandardDiagnosisKey(diag: Diagnosis | null | undefined): string {
  if (!diag) return '';
  const standardId = getStandardDiagnosisId(diag);
  return standardId ? `id:${standardId}` : getDiagnosisKey(diag);
}

export function buildDiagList(input: BuildDiagListInput): Array<Record<string, string>> {
  const primaryKey = getDiagnosisKey(input.primaryDiagnosis);
  const ordered = [...input.selectedDiagnoses].sort((left, right) => {
    if (getDiagnosisKey(left) === primaryKey) return -1;
    if (getDiagnosisKey(right) === primaryKey) return 1;
    return 0;
  });

  return ordered.map((diag) => ({
    idTet: input.patientTetId || '',
    idDiag: getStandardDiagnosisId(diag),
    naDiag: diag.name,
    sdDiag: getDiagnosisCategoryCode(diag),
    cdIcd10: diag.code || '',
    naIcd10: diag.name,
    fgMain: getDiagnosisKey(diag) === primaryKey ? '1' : '0',
    sdDiagText: getDiagnosisCategoryText(diag),
  }));
}

// ===== orderList =====

/**
 * 构造单个 orderList 元素时所需的解析器。
 * 调用方按各自数据源（语音侧/症状侧）实现这些解析器后注入。
 *
 * 所有解析器返回值都允许为空字符串；提交前应由共享必要字段校验拦截缺失字段。
 */
export interface OrderItemResolvers {
  /** PHIS 服务分类 sdSrv：药=11 检=31 验=41 处=21 */
  getServiceCode: (rec: TreatmentRecommendation) => string;
  /** PHIS 标准服务 ID：药品取 idMedPro，非药品取 idCli */
  getServiceId: (rec: TreatmentRecommendation) => string;
  /** PHIS 标准服务名 */
  getServiceName: (rec: TreatmentRecommendation) => string;
  /** 执行位置 ID（药品取药房 idSto，非药品只取当前已选 idDeptExec） */
  getExecDeptId: (rec: TreatmentRecommendation) => string;
  /** 检查部位 ID */
  getPartId: (rec: TreatmentRecommendation) => string;
  /** 检验组合 jsonField（idLisCategory + fgCombination） */
  getJsonField: (rec: TreatmentRecommendation) => string;
  /** 是否检查医嘱标志，缺省 1 */
  getFgCheckOrd?: (rec: TreatmentRecommendation) => string;
  /** 是否皮试，仅药品需要，缺省 0 */
  getFgSkintest?: (rec: TreatmentRecommendation) => string;
  /** 频次 key（idFreq） */
  getFrequencyKey?: (rec: TreatmentRecommendation) => string;
  /** 用法 key（idUsge） */
  getRouteKey?: (rec: TreatmentRecommendation) => string;
  /** 标准化药品字段（剂量、单位、天数等）。可选，未提供则直接读 rec 字段。 */
  normalize?: (rec: TreatmentRecommendation) => TreatmentRecommendation;
}

const DEFAULT_FG_SKINTEST = '0';

function resolveOrderAmount(rec: TreatmentRecommendation, normalized: TreatmentRecommendation): number {
  if (rec.type === 'exam' || rec.type === 'lab_test') {
    return 1;
  }
  return toPositiveNumber(normalized.totalQty, 0);
}

export function buildOrderListItem(
  rec: TreatmentRecommendation,
  resolvers: OrderItemResolvers,
): Record<string, string | number> {
  const normalized = resolvers.normalize ? resolvers.normalize(rec) : rec;
  const orderServiceId = resolvers.getServiceId(rec);
  const execDeptId = resolvers.getExecDeptId(rec);
  const serviceCode =
    resolvers.getServiceCode(rec).trim() || getDefaultOrderServiceCode(rec.type);
  const serviceName =
    resolvers.getServiceName(rec).trim() || rec.matchedItem?.name || rec.name || '';

  const base: Record<string, string | number> = {
    amount: resolveOrderAmount(rec, normalized),
    fgCheckOrd:
      (resolvers.getFgCheckOrd?.(rec).trim() || '') || getOrderFgCheckOrd(rec),
    sdSrv: serviceCode,
    naSrv: serviceName,
    idDeptExec: execDeptId,
    memo: normalized.remark || '',
    ...(orderServiceId ? { idSrv: orderServiceId } : {}),
  };

  if (rec.type === 'medicine') {
    return {
      ...base,
      doseOnce: normalized.dosage || '',
      unitDose: normalized.dosageUnit || '',
      idFreq: resolvers.getFrequencyKey?.(rec) || '',
      idUsge: resolvers.getRouteKey?.(rec) || '',
      takeDays: toPositiveNumber(normalized.days, 1),
      fgSkintest:
        (resolvers.getFgSkintest?.(rec).trim() || '') || DEFAULT_FG_SKINTEST,
    };
  }

  const partId = resolvers.getPartId(rec);
  const jsonField = resolvers.getJsonField(rec);

  return {
    ...base,
    ...(partId ? { idPart: partId } : {}),
    ...(jsonField ? { jsonField } : { jsonField: '{}' }),
    ...((rec.type === 'exam' || rec.type === 'lab_test')
      ? { mutualRecognitionCode: getOrderMutualRecognitionCode(rec) }
      : {}),
  };
}

// ===== 顶层 payload =====

export type RecordConfirmedResultType = 'record-confirmed' | 'draft';

export const RECORD_CONFIRMED_WRITEBACK_FIELDS = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'pastMedicalHistory',
  'personalHistory',
  'menstrualHistory',
  'familyHistory',
  'physicalExam',
  'precautions',
] as const;

export type RecordConfirmedWritebackField = typeof RECORD_CONFIRMED_WRITEBACK_FIELDS[number];
export type RecordConfirmedWritebackOrderType = 'medicine' | 'exam' | 'lab_test' | 'procedure';

export interface RecordConfirmedWritebackScope {
  recordFields: RecordConfirmedWritebackField[];
  includeDiagnosis: boolean;
  orderTypes: RecordConfirmedWritebackOrderType[];
}

export interface RecordConfirmedPrescriptionAttributes {
  /** 慢病复诊处方头语义；PHIS 校验后映射为 slowMedicine。 */
  chronicLongTerm: true;
}

export interface RecordConfirmedPatientSigningContext {
  /** 仅接受 HIS 明确返回的已签约状态；undefined 表示状态未知。 */
  signed?: boolean;
}

export function resolveRecordConfirmedPrescriptionAttributes(
  channel: ClinicalResultChannel,
  orderList: Array<Record<string, string | number>>,
  patient?: RecordConfirmedPatientSigningContext,
): RecordConfirmedPrescriptionAttributes | undefined {
  if (channel !== 'chronic-refill' || patient?.signed !== true) return undefined;
  const hasMedicine = orderList.some((item) => item.sdSrv === '11' || item.sdSrv === '12');
  return hasMedicine ? { chronicLongTerm: true } : undefined;
}

export interface BuildRecordConfirmedPayloadInput {
  consultationId: string;
  requestId?: string;
  /** 默认 record-confirmed；draft 用于早期阶段（仅主诉/现病史）的写回。 */
  resultType?: RecordConfirmedResultType;
  timestamp?: number;
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  familyHistory?: string;
  outpatientRecord?: Partial<OutpatientRecord>;
  personalHistory?: string;
  menstrualHistory?: string;
  physicalExam?: string;
  precautions?: string;
  vitals?: string;
  patientGender?: string;
  /** 已构造好的 diagList（调用 buildDiagList 得到） */
  diagList: Array<Record<string, string>>;
  /** 已构造好的 orderList（调用 buildOrderListItem 得到） */
  orderList: Array<Record<string, string | number>>;
  /** 自然语言摘要的治疗方案，用于 PHIS 文本字段 */
  treatmentPlan?: string;
  /** 部分回写范围；未传时保持历史完整回写契约。 */
  writebackScope?: RecordConfirmedWritebackScope;
  /** 处方头级中性属性；当前仅慢病复诊实际回写药品时使用。 */
  prescriptionAttributes?: RecordConfirmedPrescriptionAttributes;
  /** 额外字段（如 referenceStatus 等），会浅合并进 payload */
  extra?: Record<string, unknown>;
}

export function buildRecordConfirmedPayload(
  input: BuildRecordConfirmedPayloadInput,
): Record<string, unknown> {
  const {
    consultationId,
    requestId,
    resultType = 'record-confirmed',
    timestamp = Date.now(),
    chiefComplaint,
    historyOfPresentIllness,
    pastMedicalHistory,
    familyHistory,
    outpatientRecord,
    personalHistory,
    menstrualHistory,
    physicalExam,
    precautions,
    vitals,
    patientGender,
    diagList,
    orderList,
    treatmentPlan,
    writebackScope,
    prescriptionAttributes,
    extra,
  } = input;

  const resolvedFamilyHistory = familyHistory || outpatientRecord?.familyHistory || '';
  const fullOutpatientRecord = resultType === 'record-confirmed'
    ? buildOutpatientRecord({
        chiefComplaint: outpatientRecord?.chiefComplaint || chiefComplaint,
        historyOfPresentIllness: outpatientRecord?.historyOfPresentIllness || historyOfPresentIllness,
        pastMedicalHistory: outpatientRecord?.pastMedicalHistory || pastMedicalHistory,
        personalHistory: outpatientRecord?.personalHistory || personalHistory,
        menstrualHistory: outpatientRecord?.menstrualHistory || menstrualHistory,
        familyHistory: resolvedFamilyHistory,
        physicalExam: outpatientRecord?.physicalExam || physicalExam,
        precautions: outpatientRecord?.precautions || precautions,
        vitals,
        diagnosisNames: diagList.map((item) => item.naDiag).filter(Boolean),
        patientGender,
      })
    : undefined;
  const isScopedWriteback = resultType === 'record-confirmed' && Boolean(writebackScope);
  const selectedRecordFields = new Set<RecordConfirmedWritebackField>(
    isScopedWriteback ? writebackScope?.recordFields || [] : RECORD_CONFIRMED_WRITEBACK_FIELDS,
  );
  const writebackOutpatientRecord = fullOutpatientRecord
    ? RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<OutpatientRecord>((record, field) => {
        const value = fullOutpatientRecord[field] || '';
        record[field] = stripHistoryRecordTemplateMarkers(value);
        return record;
      }, { ...fullOutpatientRecord })
    : undefined;
  const outpatientRecordPayload = writebackOutpatientRecord && selectedRecordFields.size > 0
    ? RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<Record<string, string>>((record, field) => {
        const value = writebackOutpatientRecord[field] || '';
        if (selectedRecordFields.has(field) && (field !== 'menstrualHistory' || value.trim())) {
          record[field] = value;
        }
        return record;
      }, { schemaVersion: writebackOutpatientRecord.schemaVersion })
    : undefined;
  const selectedHistoryTemplateFields = (['pastMedicalHistory', 'personalHistory', 'familyHistory'] as const)
    .filter((field): field is HistoryRecordTemplateField => selectedRecordFields.has(field));
  const recordTemplateChanges = fullOutpatientRecord
    ? collectHistoryRecordTemplateChanges(fullOutpatientRecord, selectedHistoryTemplateFields)
    : undefined;
  const physicalExamVitalSigns = fullOutpatientRecord && selectedRecordFields.has('physicalExam')
    ? collectPhysicalExamVitalSigns(fullOutpatientRecord.physicalExam)
    : undefined;
  const resolvedChiefComplaint = writebackOutpatientRecord?.chiefComplaint || chiefComplaint;
  const resolvedHistoryOfPresentIllness = writebackOutpatientRecord?.historyOfPresentIllness || historyOfPresentIllness;
  const resolvedPastMedicalHistory = writebackOutpatientRecord?.pastMedicalHistory || stripHistoryRecordTemplateMarkers(pastMedicalHistory);
  const resolvedMenstrualHistory = writebackOutpatientRecord?.menstrualHistory || '';
  const resolvedWritebackFamilyHistory = writebackOutpatientRecord?.familyHistory || stripHistoryRecordTemplateMarkers(resolvedFamilyHistory);
  const resolvedPrecautions = writebackOutpatientRecord?.precautions || precautions || '';
  const includeDiagnosis = !isScopedWriteback || Boolean(writebackScope?.includeDiagnosis);
  const includeOrders = !isScopedWriteback || Boolean(writebackScope?.orderTypes.length);
  // PHIS 会直接遍历 orderList；未选医嘱时仍传空数组，并由空 orderTypes 表达“不处理”。
  const orderListPayload = includeOrders ? orderList : [];

  return {
    consultationId,
    timestamp,
    resultType,
    ...(requestId ? { requestId } : {}),
    ...(!isScopedWriteback || selectedRecordFields.has('chiefComplaint') ? { chiefComplaint: resolvedChiefComplaint } : {}),
    ...(!isScopedWriteback || selectedRecordFields.has('historyOfPresentIllness') ? { historyOfPresentIllness: resolvedHistoryOfPresentIllness } : {}),
    ...(!isScopedWriteback || selectedRecordFields.has('pastMedicalHistory') ? { pastMedicalHistory: resolvedPastMedicalHistory } : {}),
    ...((!isScopedWriteback || selectedRecordFields.has('menstrualHistory')) && resolvedMenstrualHistory
      ? { menstrualHistory: resolvedMenstrualHistory }
      : {}),
    ...((!isScopedWriteback || selectedRecordFields.has('familyHistory')) && resolvedWritebackFamilyHistory
      ? { familyHistory: resolvedWritebackFamilyHistory }
      : {}),
    ...((!isScopedWriteback || selectedRecordFields.has('precautions')) && resultType === 'record-confirmed'
      ? { precautions: resolvedPrecautions }
      : {}),
    ...(includeDiagnosis ? { diagList } : {}),
    orderList: orderListPayload,
    ...(treatmentPlan && includeOrders ? { treatmentPlan } : {}),
    ...(outpatientRecordPayload ? { outpatientRecord: outpatientRecordPayload } : {}),
    ...(extra || {}),
    ...(recordTemplateChanges ? { recordTemplateChanges } : {}),
    ...(physicalExamVitalSigns ? { physicalExamVitalSigns } : {}),
    ...(isScopedWriteback ? { writebackScope } : {}),
    ...(prescriptionAttributes?.chronicLongTerm === true ? { prescriptionAttributes } : {}),
  };
}
