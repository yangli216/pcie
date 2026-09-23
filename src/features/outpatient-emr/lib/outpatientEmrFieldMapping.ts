import { RECORD_CONFIRMED_WRITEBACK_FIELDS } from '@features/clinical-result/recordConfirmedPayload';
import type {
  OutpatientEmrFieldMappingSource,
  OutpatientEmrProjectionMode,
  OutpatientEmrRecordField,
  OutpatientEmrTemplateField,
} from '../types';

const RECORD_FIELD_SET = new Set<string>(RECORD_CONFIRMED_WRITEBACK_FIELDS);

const RECORD_FIELD_ALIASES: Readonly<Record<OutpatientEmrRecordField, readonly string[]>> = {
  chiefComplaint: [
    'chiefComplaint',
    'chiefComplaintText',
    'chief_complaint',
    '主诉',
    '主诉文本',
    '主诉内容',
  ],
  historyOfPresentIllness: [
    'historyOfPresentIllness',
    'historyOfPresentIllnessText',
    'history_of_present_illness',
    'presentIllness',
    'hpi',
    '现病史',
    '现病史文本',
    '现病史内容',
  ],
  pastMedicalHistory: [
    'pastMedicalHistory',
    'pastMedicalHistoryText',
    'past_medical_history',
    'pastHistory',
    '既往史',
    '既往病史',
    '既往史文本',
  ],
  personalHistory: [
    'personalHistory',
    'personalHistoryText',
    'personal_history',
    '个人史',
    '个人史文本',
  ],
  maritalReproductiveHistory: ['maritalReproductiveHistory', '婚育史', '婚育史文本'],
  menstrualHistory: [
    'menstrualHistory',
    'menstrualHistoryText',
    'menstrual_history',
    '月经史',
    '月经史文本',
  ],
  familyHistory: [
    'familyHistory',
    'familyHistoryText',
    'family_history',
    '家族史',
    '家族史文本',
  ],
  physicalExam: [
    'physicalExam',
    'physicalExamText',
    'physical_examination',
    'physicalExamination',
    '体格检查',
    '体格检查文本',
    '查体',
    '查体文本',
    '其他体格检查',
    '其他体格检查文本',
    '其他查体',
    '其他查体文本',
  ],
  precautions: [
    'precautions',
    'precautionsText',
    'healthEducation',
    'healthGuidance',
    '注意事项',
    '注意事项文本',
    '健康指导',
    '健康教育',
  ],
};

const RECORD_ARTICLE_ALIASES: Readonly<Record<OutpatientEmrRecordField, readonly string[]>> = {
  chiefComplaint: ['chiefComplaint', 'chief_complaint', '主诉'],
  historyOfPresentIllness: [
    'historyOfPresentIllness',
    'history_of_present_illness',
    'presentIllness',
    'hpi',
    '现病史',
  ],
  pastMedicalHistory: [
    'pastMedicalHistory',
    'past_medical_history',
    'pastHistory',
    '既往史',
    '既往病史',
  ],
  personalHistory: ['personalHistory', 'personal_history', '个人史'],
  menstrualHistory: ['menstrualHistory', 'menstrual_history', '月经史'],
  maritalReproductiveHistory: ['maritalReproductiveHistory', '婚育史'],
  familyHistory: ['familyHistory', 'family_history', '家族史'],
  physicalExam: [
    'physicalExam',
    'physicalExamination',
    'physical_examination',
    '体格检查',
    '查体',
  ],
  precautions: [
    'precautions',
    'healthEducation',
    'healthGuidance',
    '注意事项',
    '注意事项及宣教',
    '健康指导',
    '健康教育',
  ],
};

function normalizeAlias(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./\\:：·（）()\[\]{}]+/gu, '');
}

const NORMALIZED_ALIAS_MAP = new Map<string, OutpatientEmrRecordField>();
Object.entries(RECORD_FIELD_ALIASES).forEach(([recordField, aliases]) => {
  aliases.forEach((alias) => {
    NORMALIZED_ALIAS_MAP.set(normalizeAlias(alias), recordField as OutpatientEmrRecordField);
  });
});

const NORMALIZED_ARTICLE_ALIAS_MAP = new Map<string, OutpatientEmrRecordField>();
Object.entries(RECORD_ARTICLE_ALIASES).forEach(([recordField, aliases]) => {
  aliases.forEach((alias) => {
    NORMALIZED_ARTICLE_ALIAS_MAP.set(
      normalizeAlias(alias),
      recordField as OutpatientEmrRecordField,
    );
  });
});

export function isOutpatientEmrRecordField(
  value: string,
): value is OutpatientEmrRecordField {
  return RECORD_FIELD_SET.has(value);
}

export function resolveOutpatientEmrFieldMapping(input: {
  fieldId: string;
  fieldName: string;
  articleId?: string;
  articleName?: string;
  articleDefinitionName?: string;
  explicitRecordField?: string;
  explicitArticleRecordField?: string;
}): {
  recordField: OutpatientEmrRecordField | null;
  mappingSource: OutpatientEmrFieldMappingSource;
  projectionMode: OutpatientEmrProjectionMode | null;
} {
  if (input.explicitRecordField && isOutpatientEmrRecordField(input.explicitRecordField)) {
    return {
      recordField: input.explicitRecordField,
      mappingSource: 'definition-record-field',
      projectionMode: 'direct',
    };
  }

  if (isOutpatientEmrRecordField(input.fieldId)) {
    return {
      recordField: input.fieldId,
      mappingSource: 'canonical-id',
      projectionMode: 'direct',
    };
  }

  const aliasRecordField = NORMALIZED_ALIAS_MAP.get(normalizeAlias(input.fieldId))
    || NORMALIZED_ALIAS_MAP.get(normalizeAlias(input.fieldName));
  if (aliasRecordField) {
    const articleFields = [input.articleId, input.articleName, input.articleDefinitionName]
      .map((value) => NORMALIZED_ARTICLE_ALIAS_MAP.get(normalizeAlias(value || '')));
    // 其他体格检查是体格检查章节的文本投影，需与固定体征保持同一章节归并。
    if (aliasRecordField === 'physicalExam' && [input.fieldId, input.fieldName].some((value) => /^其他(?:体格检查|查体)(?:文本)?$/u.test(value.trim()))) {
      return { recordField: aliasRecordField, mappingSource: 'deterministic-alias', projectionMode: 'section-compose' };
    }
    if (['menstrualHistory', 'maritalReproductiveHistory'].includes(aliasRecordField)
      && articleFields.includes(aliasRecordField)) {
      return { recordField: aliasRecordField, mappingSource: 'deterministic-article', projectionMode: 'section-compose' };
    }
    return {
      recordField: aliasRecordField,
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    };
  }

  if (
    input.explicitArticleRecordField
    && isOutpatientEmrRecordField(input.explicitArticleRecordField)
  ) {
    return {
      recordField: input.explicitArticleRecordField,
      mappingSource: 'definition-article-record-field',
      projectionMode: 'section-compose',
    };
  }

  const articleRecordField = NORMALIZED_ARTICLE_ALIAS_MAP.get(normalizeAlias(input.articleId || ''))
    || NORMALIZED_ARTICLE_ALIAS_MAP.get(normalizeAlias(input.articleName || ''))
    || NORMALIZED_ARTICLE_ALIAS_MAP.get(normalizeAlias(input.articleDefinitionName || ''));
  if (articleRecordField) {
    return {
      recordField: articleRecordField,
      mappingSource: 'deterministic-article',
      projectionMode: 'section-compose',
    };
  }

  return {
    recordField: null,
    mappingSource: 'unmapped',
    projectionMode: null,
  };
}

export function findConflictingOutpatientEmrRecordFieldMapping(
  fields: ReadonlyArray<Pick<
    OutpatientEmrTemplateField,
    'id' | 'recordField' | 'projectionMode' | 'articleId'
  >>,
): { recordField: OutpatientEmrRecordField; fieldIds: string[] } | null {
  const owners = new Map<OutpatientEmrRecordField, Array<Pick<
    OutpatientEmrTemplateField,
    'id' | 'recordField' | 'projectionMode' | 'articleId'
  >>>();
  fields.forEach((field) => {
    if (!field.recordField) return;
    const mappedFields = owners.get(field.recordField);
    if (mappedFields) {
      mappedFields.push(field);
    } else {
      owners.set(field.recordField, [field]);
    }
  });

  for (const [recordField, mappedFields] of owners) {
    if (mappedFields.length <= 1) continue;

    const articleId = mappedFields[0].articleId;
    const isSingleArticleComposition = Boolean(articleId)
      && mappedFields.every((field) => (
        field.articleId === articleId
        && field.projectionMode === 'section-compose'
      ));
    if (!isSingleArticleComposition) {
      return {
        recordField,
        fieldIds: mappedFields.map((field) => field.id),
      };
    }
  }
  return null;
}
