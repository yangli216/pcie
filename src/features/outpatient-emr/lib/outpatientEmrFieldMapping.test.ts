import { describe, expect, it } from 'vitest';
import {
  findConflictingOutpatientEmrRecordFieldMapping,
  isOutpatientEmrRecordField,
  resolveOutpatientEmrFieldMapping,
} from './outpatientEmrFieldMapping';

describe('outpatient EMR field mapping', () => {
  it('uses explicit metadata before canonical ids and aliases', () => {
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'familyHistory',
      fieldName: '家族史',
      explicitRecordField: 'personalHistory',
    })).toEqual({
      recordField: 'personalHistory',
      mappingSource: 'definition-record-field',
      projectionMode: 'direct',
    });
  });

  it('maps canonical ids and deterministic aliases without model inference', () => {
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'chiefComplaint',
      fieldName: '任意显示名',
    })).toEqual({
      recordField: 'chiefComplaint',
      mappingSource: 'canonical-id',
      projectionMode: 'direct',
    });
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'personal_history',
      fieldName: '个人情况',
    })).toEqual({
      recordField: 'personalHistory',
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    });
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'field-001',
      fieldName: '体格检查文本',
    })).toEqual({
      recordField: 'physicalExam',
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    });
  });

  it('maps the other physical-exam field as a section-composed physicalExam projection', () => {
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'other-exam-field',
      fieldName: '其他体格检查',
      articleId: '体格检查',
      articleName: '体格检查',
    })).toEqual({
      recordField: 'physicalExam',
      mappingSource: 'deterministic-alias',
      projectionMode: 'section-compose',
    });
  });

  it('maps structured leaf fields through their deterministic article', () => {
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: '肝炎史标志',
      fieldName: '肝炎史标志',
      articleId: '既往史',
      articleName: '既往史',
    })).toEqual({
      recordField: 'pastMedicalHistory',
      mappingSource: 'deterministic-article',
      projectionMode: 'section-compose',
    });
  });

  it('keeps unknown fields unmapped and detects duplicate standard projections', () => {
    expect(resolveOutpatientEmrFieldMapping({
      fieldId: 'specialtySupplement',
      fieldName: '专科补充描述',
    })).toEqual({
      recordField: null,
      mappingSource: 'unmapped',
      projectionMode: null,
    });
    expect(findConflictingOutpatientEmrRecordFieldMapping([
      { id: 'one', articleId: '', recordField: 'personalHistory', projectionMode: 'direct' },
      { id: 'two', articleId: '', recordField: 'personalHistory', projectionMode: 'direct' },
      { id: 'dynamic', articleId: '', recordField: null, projectionMode: null },
    ])).toEqual({
      recordField: 'personalHistory',
      fieldIds: ['one', 'two'],
    });
    expect(findConflictingOutpatientEmrRecordFieldMapping([
      { id: 'smoking', articleId: '个人史', recordField: 'personalHistory', projectionMode: 'section-compose' },
      { id: 'drinking', articleId: '个人史', recordField: 'personalHistory', projectionMode: 'section-compose' },
    ])).toBeNull();
    expect(findConflictingOutpatientEmrRecordFieldMapping([
      { id: 'smoking', articleId: '个人史', recordField: 'personalHistory', projectionMode: 'section-compose' },
      { id: 'unknownArticle', articleId: '', recordField: 'personalHistory', projectionMode: 'section-compose' },
    ])).toEqual({
      recordField: 'personalHistory',
      fieldIds: ['smoking', 'unknownArticle'],
    });
  });

  it('recognizes only the fixed outpatient record field enum', () => {
    expect(isOutpatientEmrRecordField('familyHistory')).toBe(true);
    expect(isOutpatientEmrRecordField('family_history')).toBe(false);
    expect(isOutpatientEmrRecordField('diagnosisText')).toBe(false);
  });
});
