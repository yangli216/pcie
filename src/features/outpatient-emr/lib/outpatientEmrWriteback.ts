import { OUTPATIENT_RECORD_SCHEMA_VERSION } from '@features/clinical-result/outpatientRecord';
import { RECORD_CONFIRMED_WRITEBACK_FIELDS } from '@features/clinical-result/recordConfirmedPayload';
import {
  isOutpatientEmrDictionaryFieldType,
  resolveOutpatientEmrFinalDictionaryItem,
  validateOutpatientEmrDictionaryItems,
} from './outpatientEmrDictionary';
import { findConflictingOutpatientEmrRecordFieldMapping } from './outpatientEmrFieldMapping';
import { OutpatientEmrError } from './outpatientEmrTemplate';
import { isPreparedOutpatientEmrWritebackPayload } from './voiceOutpatientEmr';
import type {
  OutpatientEmrAnalysisRequest,
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
): Record<string, string> {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    throw new OutpatientEmrError(
      'ANALYSIS_FAILED',
      '模型分析结果必须是模板字段 JSON 对象。',
    );
  }
  const source = rawValue as Record<string, unknown>;

  return Object.fromEntries(fields.map((field) => {
    const hasCandidate = Object.prototype.hasOwnProperty.call(source, field.id);
    const candidate = source[field.id];
    if (field.dictionaryItems.length > 0) {
      if (!hasCandidate) {
        throw new OutpatientEmrError(
          'ANALYSIS_FAILED',
          `模型结果缺少字典字段 ${field.name || field.id}。`,
        );
      }
      const dictionaryItem = resolveOutpatientEmrFinalDictionaryItem(field, candidate);
      return [field.id, dictionaryItem?.text || ''];
    }
    if (typeof candidate !== 'string') {
      return [field.id, field.baselineValue];
    }
    const normalized = candidate.replace(/\r\n?/g, '\n').trim();
    if (!normalized) {
      return [field.id, field.baselineValue];
    }
    return [field.id, normalized];
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

export function buildOutpatientEmrRecordConfirmedPayload(input: {
  request: OutpatientEmrAnalysisRequest;
  templateHash: string;
  fields: OutpatientEmrTemplateField[];
  fieldValues: Record<string, string>;
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
  const activeFields = input.fields;
  const conflictingRecordFieldMapping = findConflictingOutpatientEmrRecordFieldMapping(activeFields);
  if (conflictingRecordFieldMapping) {
    throw new Error(
      `多个模板字段对同一标准字段 ${conflictingRecordFieldMapping.recordField} 形成歧义：${conflictingRecordFieldMapping.fieldIds.join('、')}`,
    );
  }

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

    if (
      !Object.prototype.hasOwnProperty.call(input.fieldValues, field.id)
      || typeof input.fieldValues[field.id] !== 'string'
    ) {
      throw new OutpatientEmrError(
        'WRITEBACK_FAILED',
        `医生最终值缺少模板字段 ${field.name || field.id}。`,
      );
    }
    const value = input.fieldValues[field.id];
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
    (recordField): recordField is OutpatientEmrRecordField => mappedFields.has(recordField),
  );
  const allowedProjectedRecordFields = baseWritebackPayload
    ? new Set(baseWritebackPayload.writebackScope.recordFields)
    : null;
  const projectedRecordFields = mappedRecordFields.filter((recordField) => (
    !allowedProjectedRecordFields || allowedProjectedRecordFields.has(recordField)
  ));
  const projectedValues: Partial<Record<OutpatientEmrRecordField, string>> = {};
  projectedRecordFields.forEach((recordField) => {
    const fields = mappedFields.get(recordField)!;
    const isSectionComposition = fields.some(
      (field) => field.projectionMode === 'section-compose',
    );
    projectedValues[recordField] = isSectionComposition
      ? composeOutpatientEmrSectionValue(fields, fieldValues)
      : fieldValues[fields[0].id];
  });
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
        ? [[recordField, projectedValues[recordField] || '']]
        : []
    )),
  );
  const templateBindValues = Object.fromEntries(activeFields.map((field) => [
    field.id,
    dictionarySelections[field.id]?.value ?? fieldValues[field.id],
  ]));

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
      ...(baseWritebackPayload?.emrFieldValues || {}),
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
