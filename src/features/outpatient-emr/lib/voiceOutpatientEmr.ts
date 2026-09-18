import { RECORD_CONFIRMED_WRITEBACK_FIELDS } from '@features/clinical-result/recordConfirmedPayload';
import type {
  OutpatientEmrPatientInput,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordContext,
  VoiceOutpatientEmrStartContext,
  VoiceOutpatientEmrTemplateInput,
} from '../types';
import { collectOutpatientEmrStructuredEvidence } from './outpatientEmrStructuredProjection';

const VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS = [
  'templateId',
  'templateName',
  'templateHtml',
  'templateDefinition',
  'targetFieldIds',
  'requestId',
] as const;

const RECORD_FIELD_LABELS: Record<string, string> = {
  chiefComplaint: '主诉',
  historyOfPresentIllness: '现病史',
  pastMedicalHistory: '既往史',
  personalHistory: '个人史',
  menstrualHistory: '月经史',
  familyHistory: '家族史',
  physicalExam: '体格检查',
  precautions: '注意事项',
};

export type VoiceOutpatientEmrStartResolution =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; context: VoiceOutpatientEmrStartContext };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExactNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function hasOnlyTemplateFields(value: Record<string, unknown>): boolean {
  const allowedFields = new Set<string>(VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS);
  return Object.keys(value).every((key) => allowedFields.has(key))
    && Object.keys(value).length === VOICE_OUTPATIENT_EMR_TEMPLATE_FIELDS.length;
}

export function resolveVoiceOutpatientEmrStartContext(
  payload: unknown,
): VoiceOutpatientEmrStartResolution {
  if (!isRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, 'outpatientEmr')) {
    return { kind: 'none' };
  }
  if (!isExactNonEmptyString(payload.idVis)) {
    return { kind: 'invalid', message: '动态门诊模板语音问诊必须提供无首尾空白的 idVis。' };
  }
  const template = payload.outpatientEmr;
  if (!isRecord(template) || !hasOnlyTemplateFields(template)) {
    return {
      kind: 'invalid',
      message: 'outpatientEmr 必须且只能包含模板 ID、名称、两份模板原文、目标字段和 requestId。',
    };
  }
  if (
    !isExactNonEmptyString(template.templateId)
    || !isExactNonEmptyString(template.templateName)
    || !isExactNonEmptyString(template.requestId)
    || typeof template.templateHtml !== 'string'
    || !template.templateHtml.trim()
    || typeof template.templateDefinition !== 'string'
    || !template.templateDefinition.trim()
  ) {
    return { kind: 'invalid', message: '动态门诊模板身份或模板原文无效。' };
  }
  if (
    !Array.isArray(template.targetFieldIds)
    || template.targetFieldIds.length === 0
    || !template.targetFieldIds.every(isExactNonEmptyString)
    || new Set(template.targetFieldIds).size !== template.targetFieldIds.length
  ) {
    return { kind: 'invalid', message: '动态门诊模板 targetFieldIds 必须非空、无空白且不重复。' };
  }

  return {
    kind: 'ready',
    context: {
      visitId: payload.idVis,
      template: {
        templateId: template.templateId,
        templateName: template.templateName,
        templateHtml: template.templateHtml,
        templateDefinition: template.templateDefinition,
        targetFieldIds: [...template.targetFieldIds],
        requestId: template.requestId,
      },
    },
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

export function isPreparedOutpatientEmrWritebackPayload(
  value: unknown,
  visitId: string,
  requestId: string,
): value is OutpatientEmrPreparedWritebackPayload {
  if (!isRecord(value)) return false;
  const scope = value.writebackScope;
  if (!isRecord(scope)) return false;
  if (
    value.consultationId !== visitId
    || value.requestId !== requestId
    || value.resultType !== 'record-confirmed'
    || value.referenceType !== 'batch'
    || value.action !== 'batch'
    || value.referenceStatus !== 'pending'
    || typeof value.timestamp !== 'number'
    || !Number.isFinite(value.timestamp)
    || !Array.isArray(value.orderList)
    || !Array.isArray(scope.recordFields)
    || !scope.recordFields.every((field) => (
      typeof field === 'string'
      && (RECORD_CONFIRMED_WRITEBACK_FIELDS as readonly string[]).includes(field)
    ))
    || new Set(scope.recordFields).size !== scope.recordFields.length
    || typeof scope.includeDiagnosis !== 'boolean'
    || !Array.isArray(scope.orderTypes)
  ) {
    return false;
  }
  if (value.outpatientRecord !== undefined && !isStringRecord(value.outpatientRecord)) {
    return false;
  }
  if (value.emrFieldValues !== undefined && !isStringRecord(value.emrFieldValues)) {
    return false;
  }
  return value.diagList === undefined || Array.isArray(value.diagList);
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDiagnosisFacts(value: unknown): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  return value.reduce<Array<Record<string, string>>>((items, rawItem) => {
    if (!isRecord(rawItem)) return items;
    const item = {
      name: readText(rawItem.naDiag),
      code: readText(rawItem.cdIcd10),
      category: readText(rawItem.sdDiagText),
      primary: rawItem.fgMain === '1' ? '是' : '否',
    };
    if (item.name || item.code) items.push(item);
    return items;
  }, []);
}

function resolveOrderType(serviceCode: string): string {
  if (serviceCode === '11') return '用药';
  if (serviceCode === '31') return '检查';
  if (serviceCode === '41') return '检验';
  if (serviceCode === '21') return '处置';
  return '诊疗项目';
}

function buildOrderFacts(value: unknown): Array<Record<string, string | number>> {
  if (!Array.isArray(value)) return [];
  return value.reduce<Array<Record<string, string | number>>>((items, rawItem) => {
    if (!isRecord(rawItem)) return items;
    const name = readText(rawItem.naSrv);
    if (!name) return items;
    const serviceCode = readText(rawItem.sdSrv);
    const item: Record<string, string | number> = {
      type: resolveOrderType(serviceCode),
      name,
    };
    const dose = [readText(rawItem.doseOnce), readText(rawItem.unitDose)]
      .filter(Boolean)
      .join('');
    if (dose) item.dose = dose;
    if (typeof rawItem.takeDays === 'number' && Number.isFinite(rawItem.takeDays)) {
      item.days = rawItem.takeDays;
    }
    if (typeof rawItem.amount === 'number' && Number.isFinite(rawItem.amount)) {
      item.amount = rawItem.amount;
    }
    items.push(item);
    return items;
  }, []);
}

export function buildVoiceOutpatientEmrRecordContext(
  payload: OutpatientEmrPreparedWritebackPayload,
): OutpatientEmrRecordContext {
  const sourceRecord: Record<string, unknown> = isRecord(payload.outpatientRecord)
    ? payload.outpatientRecord
    : {};
  const sections = Object.fromEntries(RECORD_CONFIRMED_WRITEBACK_FIELDS.flatMap((field) => {
    const value = readText(sourceRecord[field]);
    return value ? [[field, value]] : [];
  }));
  const recordText = Object.entries(sections)
    .map(([field, value]) => `${RECORD_FIELD_LABELS[field]}：${value}`)
    .join('\n');
  const diagnoses = buildDiagnosisFacts(payload.diagList);
  const orders = buildOrderFacts(payload.orderList);
  const treatmentPlan = readText(payload.treatmentPlan);
  const structuredEvidence = collectOutpatientEmrStructuredEvidence(payload);

  if (!recordText && diagnoses.length === 0 && orders.length === 0 && !treatmentPlan) {
    throw new Error('已选回写内容中没有可用于动态模板分析的病例事实。');
  }

  return {
    ...(recordText ? { recordText } : {}),
    ...(Object.keys(sections).length > 0 ? { sections } : {}),
    structuredFacts: {
      diagnoses,
      orders,
      ...(treatmentPlan ? { treatmentPlan } : {}),
      ...structuredEvidence,
    },
  };
}

export function buildVoiceOutpatientEmrPatientInput(input: {
  idPi?: unknown;
  name?: unknown;
  sdSexText?: unknown;
  ageText?: unknown;
}): OutpatientEmrPatientInput | undefined {
  const patient: OutpatientEmrPatientInput = {};
  const pairs: Array<[keyof OutpatientEmrPatientInput, unknown]> = [
    ['idPi', input.idPi],
    ['name', input.name],
    ['sdSexText', input.sdSexText],
    ['ageText', input.ageText],
  ];
  pairs.forEach(([key, value]) => {
    if (typeof value === 'string' && value.trim()) patient[key] = value.trim();
  });
  return Object.keys(patient).length > 0 ? patient : undefined;
}

export function summarizeOutpatientEmrCombinedWriteback(
  payload: OutpatientEmrPreparedWritebackPayload | null,
): { recordFieldCount: number; diagnosisCount: number; orderCount: number } {
  return {
    recordFieldCount: payload?.writebackScope.recordFields.length || 0,
    diagnosisCount: payload?.diagList?.length || 0,
    orderCount: payload?.orderList.length || 0,
  };
}

export type { VoiceOutpatientEmrTemplateInput };
