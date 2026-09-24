import type {
  OutpatientEmrRecordContext,
  OutpatientEmrTemplateField,
} from '../types';
import {
  HISTORY_DATA_ID_BY_SLOT,
  PHYSICAL_EXAM_DATA_ID_BY_SLOT,
} from '@features/clinical-result/recordConfirmedEmrFieldValues';
import { stripPhysicalExamStructuredNarrative } from '@features/clinical-result/physicalExamVitalTemplate';

interface StructuredHistoryChange {
  field: string;
  slotKey: string;
  fromValue: string;
  toValue: string;
}

interface StructuredVitalSign {
  slotKey: string;
  value: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => (
    typeof item === 'string' ? [[key, item]] : []
  )));
}

const OTHER_PHYSICAL_EXAM_FIELD_ALIASES = new Set([
  '其他体格检查',
  '其他体格检查文本',
  '其他查体',
  '其他查体文本',
]);

function normalizeFieldAlias(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[\s_\-./\\:：·（）()\[\]{}]+/gu, '');
}

function isOtherPhysicalExamField(field: OutpatientEmrTemplateField): boolean {
  return [field.id, field.name].some((value) => (
    OTHER_PHYSICAL_EXAM_FIELD_ALIASES.has(normalizeFieldAlias(value))
  ));
}

function readPhysicalExamSection(recordContext: OutpatientEmrRecordContext): string | undefined {
  const sections = isRecord(recordContext.sections) ? recordContext.sections : null;
  const sectionValue = sections?.physicalExam;
  if (typeof sectionValue === 'string') return sectionValue;
  const directValue = recordContext.physicalExam;
  return typeof directValue === 'string' ? directValue : undefined;
}

function readHistoryChanges(value: unknown): StructuredHistoryChange[] {
  if (!isRecord(value) || value.schemaVersion !== 'outpatient-record-template-changes.v1') {
    return [];
  }
  if (!Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => (
    isRecord(item)
    && typeof item.field === 'string'
    && typeof item.slotKey === 'string'
    && typeof item.fromValue === 'string'
    && typeof item.toValue === 'string'
      ? [{
          field: item.field,
          slotKey: item.slotKey,
          fromValue: item.fromValue,
          toValue: item.toValue,
        }]
      : []
  ));
}

function isValidVitalValue(slotKey: string, value: string): boolean {
  const ranges: Readonly<Record<string, readonly [number, number]>> = {
    temperature: [30, 45],
    pulse: [20, 250],
    respiration: [5, 80],
    systolicBloodPressure: [40, 300],
    diastolicBloodPressure: [20, 200],
  };
  const range = ranges[slotKey];
  if (!range || !/^\d+(?:\.\d+)?$/u.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= range[0] && numeric <= range[1];
}

function readVitalSigns(value: unknown): StructuredVitalSign[] {
  if (!isRecord(value) || value.schemaVersion !== 'outpatient-record-physical-exam-vitals.v1') {
    return [];
  }
  if (!Array.isArray(value.items)) return [];
  return value.items.flatMap((item) => {
    if (
      !isRecord(item)
      || typeof item.slotKey !== 'string'
      || typeof item.value !== 'string'
    ) return [];
    const normalizedValue = item.value.trim();
    return isValidVitalValue(item.slotKey, normalizedValue)
      ? [{ slotKey: item.slotKey, value: normalizedValue }]
      : [];
  });
}

export function collectOutpatientEmrStructuredEvidence(
  source: Record<string, unknown>,
): Record<string, unknown> {
  const historyChanges = readHistoryChanges(source.recordTemplateChanges);
  const vitalSigns = readVitalSigns(source.physicalExamVitalSigns);
  const confirmedEmrFieldValues = readStringRecord(source.emrFieldValues);
  return {
    ...(Object.keys(confirmedEmrFieldValues).length > 0
      ? { confirmedEmrFieldValues }
      : {}),
    ...(historyChanges.length > 0
      ? {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: historyChanges,
          },
        }
      : {}),
    ...(vitalSigns.length > 0
      ? {
          physicalExamVitalSigns: {
            schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
            items: vitalSigns,
          },
        }
      : {}),
  };
}

export function resolveOutpatientEmrStructuredFieldValues(input: {
  recordContext: OutpatientEmrRecordContext;
  fields: OutpatientEmrTemplateField[];
}): Record<string, string> {
  const structuredFacts = isRecord(input.recordContext.structuredFacts)
    ? input.recordContext.structuredFacts
    : {};
  const historyChanges = readHistoryChanges(structuredFacts.historyTemplateChanges);
  const vitalSigns = readVitalSigns(structuredFacts.physicalExamVitalSigns);
  const confirmedEmrFieldValues = readStringRecord(structuredFacts.confirmedEmrFieldValues);
  const physicalExamSection = readPhysicalExamSection(input.recordContext);
  const otherPhysicalExamValue = physicalExamSection === undefined
    ? undefined
    : stripPhysicalExamStructuredNarrative(physicalExamSection);
  const fieldsById = new Map(input.fields.map((field) => [field.id, field]));
  const values: Record<string, string> = {};

  Object.entries(confirmedEmrFieldValues).forEach(([fieldId, bindValue]) => {
    const field = fieldsById.get(fieldId);
    if (!field) return;
    if (field.dictionaryItems.length === 0) {
      values[field.id] = bindValue;
      return;
    }
    const dictionaryItem = field.dictionaryItems.find((item) => (
      item.value === bindValue || item.text === bindValue
    ));
    if (dictionaryItem) values[field.id] = dictionaryItem.text;
  });

  historyChanges.forEach((change) => {
    if (
      change.field !== 'pastMedicalHistory'
      || change.fromValue !== '否认'
      || change.toValue !== '有'
    ) return;
    const fieldId = HISTORY_DATA_ID_BY_SLOT[change.slotKey];
    const field = fieldId ? fieldsById.get(fieldId) : undefined;
    const positiveItem = field?.dictionaryItems.find((item) => item.value === '1');
    if (field && positiveItem) values[field.id] = positiveItem.text;
  });

  vitalSigns.forEach((vitalSign) => {
    const fieldId = PHYSICAL_EXAM_DATA_ID_BY_SLOT[vitalSign.slotKey];
    const field = fieldId ? fieldsById.get(fieldId) : undefined;
    if (field && field.dictionaryItems.length === 0) values[field.id] = vitalSign.value;
  });

  if (otherPhysicalExamValue !== undefined) {
    input.fields.filter(isOtherPhysicalExamField).forEach((field) => {
      if (field.dictionaryItems.length === 0) values[field.id] = otherPhysicalExamValue;
    });
  }

  return values;
}
