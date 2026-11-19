import { OUTPATIENT_RECORD_SCHEMA_VERSION } from '@features/clinical-result/outpatientRecord';
import { RECORD_CONFIRMED_WRITEBACK_FIELDS } from '@features/clinical-result/recordConfirmedPayload';
import { buildRecordConfirmedEmrFieldValues } from '@features/clinical-result/recordConfirmedEmrFieldValues';
import { collectHistoryRecordTemplateSlotValues } from '@features/clinical-result/historyRecordTemplates';
import { collectPhysicalExamVitalSigns } from '@features/clinical-result/physicalExamVitalTemplate';
import {
  isOutpatientEmrDictionaryFieldType,
  resolveOutpatientEmrFinalDictionaryItem,
  validateOutpatientEmrDictionaryItems,
} from './outpatientEmrDictionary';
import { findOutpatientEmrFieldConflicts } from './outpatientEmrFieldConsistency';
import { findConflictingOutpatientEmrRecordFieldMapping } from './outpatientEmrFieldMapping';
import { OutpatientEmrError } from './outpatientEmrTemplate';
import { isPreparedOutpatientEmrWritebackPayload } from './voiceOutpatientEmr';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrFieldValueSource,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrProjectedRecord,
  OutpatientEmrRecordConfirmedPayload,
  OutpatientEmrRecordField,
  OutpatientEmrTemplateField,
} from '../types';

async function sha256Text(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持模板 SHA-256 校验。');
  }
  const source = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashOutpatientEmrTemplate(
  templateHtml: string,
  templateDefinition: string,
): Promise<string> {
  const [htmlHash, definitionHash] = await Promise.all([
    sha256Text(templateHtml),
    sha256Text(templateDefinition),
  ]);
  return sha256Text(`outpatient-emr-template-pair.v1:${htmlHash}:${definitionHash}`);
}

export function normalizeOutpatientEmrModelValues(
  rawValue: unknown,
  fields: OutpatientEmrTemplateField[],
): Record<string, string | null> {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new OutpatientEmrError(
      'ANALYSIS_FAILED',
      '模型分析结果必须是模板字段 JSON 对象。',
    );
  }
  const source = rawValue as Record<string, unknown>;

  return Object.fromEntries(fields.map((field) => {
    const candidate = Object.prototype.hasOwnProperty.call(source, field.id) ? source[field.id] : undefined;
    if (candidate === null) return [field.id, null];
    if (field.dictionaryItems.length > 0) {
      const dictionaryItem = resolveOutpatientEmrFinalDictionaryItem(field, candidate);
      return [field.id, dictionaryItem?.text || ''];
    }
    // Text fields: an empty or missing model value means "no case fact for this
    // field"; the analysis session decides whether a template draft is kept.
    if (typeof candidate !== 'string') return [field.id, ''];
    return [field.id, candidate.replace(/\r\n?/g, '\n').trim()];
  }));
}

function resolveSectionProjectionLabel(field: OutpatientEmrTemplateField): string {
  const source = field.name.trim() || field.id.trim();
  return source.replace(/标志$/u, '').trim() || source;
}

function composeOutpatientEmrSectionValue(
  fields: OutpatientEmrTemplateField[],
  fieldValues: Record<string, string>,
): string {
  return fields.reduce<string[]>((parts, field) => {
    const value = fieldValues[field.id].replace(/\r\n?/g, '\n').trim();
    if (!value) return parts;

    const label = resolveSectionProjectionLabel(field);
    const alreadyLabeled = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[：:]`, 'u')
      .test(value);
    parts.push(alreadyLabeled ? value : `${label}：${value}`);
    return parts;
  }, []).join('；');
}

function bindStandardSections(
  record: Partial<Record<OutpatientEmrRecordField, string>>,
  selectedRecordFields: ReadonlySet<OutpatientEmrRecordField>,
) {
  return buildRecordConfirmedEmrFieldValues({
    record,
    selectedRecordFields,
    historyTemplateValues: collectHistoryRecordTemplateSlotValues(record),
    physicalExamVitalSigns: collectPhysicalExamVitalSigns(record.physicalExam || ''),
  });
}

export function isDirectOutpatientEmrTextField(field: OutpatientEmrTemplateField): boolean {
  return field.projectionMode === 'direct' && !field.dictionaryItems.length
    && ['text', 'textarea'].includes(field.type.toLowerCase());
}

export function buildOutpatientEmrRecordConfirmedPayload(input: {
  request: OutpatientEmrAnalysisRequest;
  templateHash: string;
  fields: OutpatientEmrTemplateField[];
  fieldValues: Record<string, string>;
  fieldValueSources?: Readonly<Record<string, OutpatientEmrFieldValueSource>>;
  voiceRecordValues?: Readonly<Partial<Record<OutpatientEmrRecordField, string>>>;
  reviewedRecord?: Readonly<Partial<Record<OutpatientEmrRecordField, string>>>;
  templateFieldIds?: readonly string[];
  documentDirectText?: Readonly<Record<string, string>>;
  timestamp: number;
  baseWritebackPayload?: OutpatientEmrPreparedWritebackPayload | null;
}): OutpatientEmrRecordConfirmedPayload {
  const baseWritebackPayload = input.baseWritebackPayload || null;
  if (
    baseWritebackPayload
    && !isPreparedOutpatientEmrWritebackPayload(
      baseWritebackPayload,
      input.request.visitId,
      input.request.requestId,
    )
  ) {
    throw new OutpatientEmrError(
      'WRITEBACK_FAILED',
      '待合并的语音问诊回写快照与当前门诊模板任务不一致。',
    );
  }
  const conflictingRecordFieldMapping = findConflictingOutpatientEmrRecordFieldMapping(input.fields);
  if (conflictingRecordFieldMapping) {
    throw new Error(
      `多个模板字段对同一标准字段 ${conflictingRecordFieldMapping.recordField} 形成歧义：${conflictingRecordFieldMapping.fieldIds.join('、')}`,
    );
  }

  const currentValues = { ...input.fieldValues, ...input.documentDirectText };
  if (input.reviewedRecord && !input.documentDirectText) {
    for (const field of input.fields) {
      if (!field.recordField || !isDirectOutpatientEmrTextField(field)) continue;
      const reviewed = input.reviewedRecord[field.recordField];
      if (typeof reviewed === 'string') currentValues[field.id] = reviewed;
    }
  }
  const activeFields = input.fields.filter((field) => {
    if (!Object.prototype.hasOwnProperty.call(currentValues, field.id)) return false;
    const value = currentValues[field.id];
    if (typeof value !== 'string') {
      throw new OutpatientEmrError('WRITEBACK_FAILED', `模板字段 ${field.name || field.id} 的值应为文本。`);
    }
    if (value.trim()) return true;
    return !isOutpatientEmrDictionaryFieldType(field.type)
      && field.dictionaryItems.length === 0
      && input.fieldValueSources?.[field.id] === 'doctor';
  });
  const dictionarySelections: OutpatientEmrRecordConfirmedPayload['dictionarySelections'] = {};
  const fieldValues = Object.fromEntries(activeFields.map((field) => {
    if (
      isOutpatientEmrDictionaryFieldType(field.type)
      && field.dictionaryItems.length === 0
    ) {
      throw new OutpatientEmrError(
        'MISSING_DICTIONARY_DEFINITION',
        `模板字段 ${field.id} 是字典字段，但没有可用于回参的字典定义。`,
      );
    }
    const dictionaryValidationError = field.dictionaryItems.length > 0
      ? validateOutpatientEmrDictionaryItems(field.dictionaryItems)
      : null;
    if (dictionaryValidationError) {
      throw new OutpatientEmrError(
        'INVALID_DICTIONARY_DEFINITION',
        `模板字段 ${field.id} 的字典定义无效：${dictionaryValidationError}`,
      );
    }

    const value = currentValues[field.id];
    if (field.dictionaryItems.length === 0) return [field.id, value];

    const dictionaryItem = resolveOutpatientEmrFinalDictionaryItem(field, value);
    if (!dictionaryItem) {
      throw new OutpatientEmrError(
        'INVALID_DICTIONARY_VALUE',
        `模板字典字段 ${field.name || field.id} 必须选择一个已有字典项。`,
      );
    }
    dictionarySelections[field.id] = {
      value: dictionaryItem.value,
      text: dictionaryItem.text,
    };
    return [field.id, dictionaryItem.text];
  }));
  const fieldConflict = findOutpatientEmrFieldConflicts(activeFields, fieldValues)[0];
  if (fieldConflict) {
    throw new OutpatientEmrError('FIELD_VALUE_CONFLICT', fieldConflict.message);
  }
  const mappedFields = new Map<OutpatientEmrRecordField, OutpatientEmrTemplateField[]>();
  activeFields.forEach((field) => {
    if (!field.recordField) return;
    const currentFields = mappedFields.get(field.recordField);
    if (currentFields) {
      currentFields.push(field);
    } else {
      mappedFields.set(field.recordField, [field]);
    }
  });
  const mappedRecordFields = RECORD_CONFIRMED_WRITEBACK_FIELDS.filter(
    (recordField): recordField is OutpatientEmrRecordField => mappedFields.has(recordField)
      || (input.fields.some(field => field.recordField === recordField) && (
        Boolean(input.reviewedRecord?.[recordField]?.trim()) || input.voiceRecordValues?.[recordField] === ''
      )),
  );
  const allowedProjectedRecordFields = baseWritebackPayload
    ? new Set(baseWritebackPayload.writebackScope.recordFields)
    : null;
  const projectedRecordFields = mappedRecordFields.filter((recordField) => (
    !allowedProjectedRecordFields || allowedProjectedRecordFields.has(recordField)
  ));
  const projectedValues: Partial<Record<OutpatientEmrRecordField, string>> = {};
  const reviewedValues: Partial<Record<OutpatientEmrRecordField, string>> = {};
  for (const recordField of projectedRecordFields) {
    const fields = mappedFields.get(recordField);
    const fieldProjection = fields?.length
      ? (fields.some(field => field.projectionMode === 'section-compose')
          ? composeOutpatientEmrSectionValue(fields, fieldValues)
          : fieldValues[fields[0].id])
      : undefined;
    const reviewed = input.reviewedRecord?.[recordField] ?? input.voiceRecordValues?.[recordField];
    // HIS validates the standard projection against the same ordered controls in templateMetadata.
    projectedValues[recordField] = fieldProjection ?? reviewed ?? '';
    reviewedValues[recordField] = reviewed ?? fieldProjection ?? '';
  }
  const baseOutpatientRecord = baseWritebackPayload?.outpatientRecord;
  const outpatientRecord: OutpatientEmrProjectedRecord | undefined = (
    baseOutpatientRecord || projectedRecordFields.length > 0
  )
    ? {
        schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
        ...(baseOutpatientRecord || {}),
        ...projectedValues,
      }
    : undefined;
  const writebackScope = baseWritebackPayload
    ? {
        recordFields: [...baseWritebackPayload.writebackScope.recordFields],
        includeDiagnosis: baseWritebackPayload.writebackScope.includeDiagnosis,
        orderTypes: [...baseWritebackPayload.writebackScope.orderTypes],
      }
    : {
        recordFields: mappedRecordFields,
        includeDiagnosis: false,
        orderTypes: [],
      };
  const compatibilityRecordFields = new Set<OutpatientEmrRecordField>([
    'chiefComplaint',
    'historyOfPresentIllness',
    'pastMedicalHistory',
    'menstrualHistory',
    'maritalReproductiveHistory',
    'familyHistory',
    'precautions',
  ]);
  const projectedCompatibilityValues = Object.fromEntries(
    projectedRecordFields.flatMap((recordField) => (
      baseWritebackPayload && compatibilityRecordFields.has(recordField)
        ? [[recordField, reviewedValues[recordField] || '']]
        : []
    )),
  );
  const templateBindValues = Object.fromEntries(activeFields.map((field) => [
    field.id,
    dictionarySelections[field.id]?.value ?? fieldValues[field.id],
  ]));
  // The template owns all requested IDs, including empty and excluded fields.
  // A standard voice binding for the same ID must not repopulate an omitted field.
  const targetIds = new Set([...input.request.targetFieldIds, ...(input.templateFieldIds ?? [])]);
  const voiceBindValues = Object.fromEntries(
    Object.entries(baseWritebackPayload?.emrFieldValues || {}).filter(([id]) => !targetIds.has(id)),
  );
  if ((input.reviewedRecord || input.voiceRecordValues) && baseWritebackPayload) {
    // The ordinary voice builder may have expanded a short history into its default history form.
    // Rebind only existing compatibility IDs for the selected dynamic sections.
    const selected = new Set(projectedRecordFields);
    const originalBindings = bindStandardSections(baseOutpatientRecord || {}, selected);
    const reviewedBindings = bindStandardSections(reviewedValues, selected);
    for (const id of Object.keys(voiceBindValues)) {
      if (Object.prototype.hasOwnProperty.call(reviewedBindings, id)) voiceBindValues[id] = reviewedBindings[id];
      else if (Object.prototype.hasOwnProperty.call(originalBindings, id)) delete voiceBindValues[id];
    }
  }

  const result: OutpatientEmrRecordConfirmedPayload = {
    ...(baseWritebackPayload
      ? {
          ...baseWritebackPayload,
          ...(baseWritebackPayload.diagList
            ? { diagList: baseWritebackPayload.diagList.map((item) => ({ ...item })) }
            : {}),
        }
      : {}),
    consultationId: input.request.visitId,
    visitId: input.request.visitId,
    timestamp: input.timestamp,
    resultType: 'record-confirmed',
    requestId: input.request.requestId,
    referenceType: 'batch',
    action: 'batch',
    referenceStatus: 'pending',
    referenceMessage: baseWritebackPayload
      ? '等待 HIS 完成动态模板及已选诊疗内容回写并回执'
      : '等待 HIS 完成门诊模板参数回填并回执',
    emrType: 'outpatient-emr',
    templateMetadata: {
      schemaVersion: 'outpatient-emr-template-pair.v1',
      templateId: input.request.templateId,
      templateName: input.request.templateName,
      templateHash: input.templateHash,
      fields: activeFields.map(({
        id,
        name,
        type,
        articleTemplateId,
        articleId,
        articleName,
        articleDefinitionName,
        dictionaryItems,
        recordField,
        mappingSource,
        projectionMode,
      }) => ({
        id,
        name,
        type,
        articleTemplateId,
        articleId,
        articleName,
        articleDefinitionName,
        dictionaryItems: dictionaryItems.map((item) => ({ ...item })),
        recordField,
        mappingSource,
        projectionMode,
      })),
    },
    fieldValues,
    dictionarySelections,
    emrFieldValues: {
      ...voiceBindValues,
      ...templateBindValues,
    },
    ...projectedCompatibilityValues,
    ...(outpatientRecord ? { outpatientRecord } : {}),
    writebackScope,
    orderList: baseWritebackPayload
      ? baseWritebackPayload.orderList.map((item) => ({ ...item }))
      : [],
  };

  if (
    baseWritebackPayload
    && projectedRecordFields.some((field) => [
      'pastMedicalHistory',
      'personalHistory',
      'familyHistory',
    ].includes(field))
  ) {
    delete result.recordTemplateChanges;
  }
  if (baseWritebackPayload && projectedRecordFields.includes('physicalExam')) {
    delete result.physicalExamVitalSigns;
  }

  return result;
}
