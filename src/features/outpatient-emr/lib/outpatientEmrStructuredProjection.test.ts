import { describe, expect, it } from 'vitest';
import type { OutpatientEmrTemplateField } from '../types';
import {
  collectOutpatientEmrStructuredEvidence,
  resolveOutpatientEmrStructuredFieldValues,
} from './outpatientEmrStructuredProjection';

function field(
  id: string,
  dictionaryItems: OutpatientEmrTemplateField['dictionaryItems'] = [],
): OutpatientEmrTemplateField {
  return {
    id,
    name: id,
    type: dictionaryItems.length > 0 ? 'select' : 'number',
    articleTemplateId: id.includes('病史') || id === '过敏史标志' ? 'article-history' : 'article-exam',
    articleId: id.includes('病史') || id === '过敏史标志' ? '既往史' : '体格检查',
    articleName: id.includes('病史') || id === '过敏史标志' ? '既往史' : '体格检查',
    articleDefinitionName: id.includes('病史') || id === '过敏史标志' ? '既往史' : '体格检查',
    readonly: false,
    aiSuitable: true,
    baselineValue: '',
    baselineDictionaryValue: '',
    dictionaryItems,
    recordField: null,
    mappingSource: 'unmapped',
    projectionMode: null,
  };
}

const BOOLEAN_ITEMS = [
  { value: '0', text: '否认' },
  { value: '1', text: '有' },
];

const INFECTIOUS_HISTORY_ITEMS = [
  { value: '0', text: '否认' },
  { value: '1', text: '患有' },
];

describe('outpatient EMR structured projection', () => {
  it.each([
    ['hypertensionHistory', '高血压病史标志'],
    ['diabetesHistory', '糖尿病史标志'],
    ['heartDiseaseHistory', '心脏病史标志'],
    ['cerebrovascularDiseaseHistory', '脑血管病史标志'],
    ['lungDiseaseHistory', '肺部疾病史标志'],
    ['kidneyDiseaseHistory', '肾脏疾病史标志'],
    ['otherMajorDiseaseHistory', '其它疾病史标志'],
    ['surgeryHistory', '手术史标志'],
    ['traumaHistory', '外伤史标志'],
    ['transfusionHistory', '输血史标志'],
    ['foodDrugAllergyHistory', '过敏史标志'],
  ])('maps history slot %s to PHIS data-id %s', (slotKey, fieldId) => {
    expect(resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        structuredFacts: {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: [{
              field: 'pastMedicalHistory',
              slotKey,
              fromValue: '否认',
              toValue: '有',
            }],
          },
        },
      },
      fields: [field(fieldId, BOOLEAN_ITEMS)],
    })).toEqual({ [fieldId]: '有' });
  });

  it.each([
    ['hepatitisHistory', '肝炎史标志'],
    ['tuberculosisHistory', '结核史标志'],
    ['malariaHistory', '疟疾史标志'],
    ['otherInfectiousDiseaseHistory', '其他传染病史标志'],
  ])('uses the actual infectious-history display text for slot %s', (slotKey, fieldId) => {
    expect(resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        structuredFacts: {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: [{
              field: 'pastMedicalHistory',
              slotKey,
              fromValue: '否认',
              toValue: '有',
            }],
          },
        },
      },
      fields: [field(fieldId, INFECTIOUS_HISTORY_ITEMS)],
    })).toEqual({ [fieldId]: '患有' });
  });

  it('resolves confirmed PHIS bind codes back to each field actual display text', () => {
    expect(resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        structuredFacts: {
          confirmedEmrFieldValues: {
            肝炎史标志: '1',
            高血压病史标志: '1',
            意识: '1',
          },
        },
      },
      fields: [
        field('肝炎史标志', INFECTIOUS_HISTORY_ITEMS),
        field('高血压病史标志', BOOLEAN_ITEMS),
        field('意识', [{ value: '1', text: '清楚' }, { value: '2', text: '不清' }]),
      ],
    })).toEqual({
      肝炎史标志: '患有',
      高血压病史标志: '有',
      意识: '清楚',
    });
  });

  it('maps confirmed past-history slots to exact PHIS data-id values', () => {
    const values = resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        structuredFacts: {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: [
              { field: 'pastMedicalHistory', slotKey: 'hypertensionHistory', fromValue: '否认', toValue: '有' },
              { field: 'pastMedicalHistory', slotKey: 'diabetesHistory', fromValue: '否认', toValue: '有' },
              { field: 'pastMedicalHistory', slotKey: 'otherMajorDiseaseHistory', fromValue: '否认', toValue: '有' },
              { field: 'pastMedicalHistory', slotKey: 'foodDrugAllergyHistory', fromValue: '否认', toValue: '有' },
            ],
          },
        },
      },
      fields: [
        field('高血压病史标志', BOOLEAN_ITEMS),
        field('糖尿病史标志', BOOLEAN_ITEMS),
        field('其它疾病史标志', BOOLEAN_ITEMS),
        field('过敏史标志', BOOLEAN_ITEMS),
      ],
    });

    expect(values).toEqual({
      高血压病史标志: '有',
      糖尿病史标志: '有',
      其它疾病史标志: '有',
      过敏史标志: '有',
    });
  });

  it('does not infer a positive value without a confirmed slot and a legal positive dictionary item', () => {
    const values = resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        recordText: '既往史：有高血压病史。',
        structuredFacts: {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: [
              { field: 'familyHistory', slotKey: 'hypertensionHistory', fromValue: '否认', toValue: '有' },
              { field: 'pastMedicalHistory', slotKey: 'diabetesHistory', fromValue: '否认', toValue: '否认' },
            ],
          },
        },
      },
      fields: [
        field('高血压病史标志', BOOLEAN_ITEMS),
        field('糖尿病史标志', [{ value: '0', text: '否认' }]),
      ],
    });

    expect(values).toEqual({});
  });

  it('projects other physical-exam text after removing fixed vital signs', () => {
    const values = resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        sections: {
          physicalExam: 'T:36.5℃ P:76次/分 R:18次/分 Bp:128/82mmHg。双肺呼吸音粗，腹部柔软。',
        },
      },
      fields: [
        field('其他体格检查'),
        field('体温'),
      ],
    });

    expect(values).toEqual({
      '其他体格检查': '双肺呼吸音粗，腹部柔软。',
    });
  });

  it('does not synthesize other physical-exam text without a physical-exam section', () => {
    const values = resolveOutpatientEmrStructuredFieldValues({
      recordContext: { recordText: '主诉：咳嗽。' },
      fields: [field('其他体格检查')],
    });

    expect(values).toEqual({});
  });

  it('maps only explicitly collected physical-exam vital values', () => {
    const values = resolveOutpatientEmrStructuredFieldValues({
      recordContext: {
        structuredFacts: {
          physicalExamVitalSigns: {
            schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
            items: [
              { slotKey: 'temperature', value: '36.5' },
              { slotKey: 'systolicBloodPressure', value: '128' },
              { slotKey: 'diastolicBloodPressure', value: '82' },
            ],
          },
        },
      },
      fields: [field('体温'), field('收缩压'), field('舒张压'), field('体重')],
    });

    expect(values).toEqual({ 体温: '36.5', 收缩压: '128', 舒张压: '82' });
  });

  it('keeps only valid prior structured evidence when building model context', () => {
    expect(collectOutpatientEmrStructuredEvidence({
      emrFieldValues: {
        平素: '1',
        肝炎史标志: '0',
        invalid: 1,
      },
      recordTemplateChanges: {
        schemaVersion: 'outpatient-record-template-changes.v1',
        items: [
          { field: 'pastMedicalHistory', slotKey: 'hypertensionHistory', fromValue: '否认', toValue: '有' },
          { field: 123, slotKey: 'invalid', fromValue: '否认', toValue: '有' },
        ],
      },
      physicalExamVitalSigns: {
        schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
        items: [
          { slotKey: 'pulse', value: '78' },
          { slotKey: 'respiration', value: 'not-a-number' },
        ],
      },
    })).toEqual({
      confirmedEmrFieldValues: {
        平素: '1',
        肝炎史标志: '0',
      },
      historyTemplateChanges: {
        schemaVersion: 'outpatient-record-template-changes.v1',
        items: [{
          field: 'pastMedicalHistory',
          slotKey: 'hypertensionHistory',
          fromValue: '否认',
          toValue: '有',
        }],
      },
      physicalExamVitalSigns: {
        schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
        items: [{ slotKey: 'pulse', value: '78' }],
      },
    });
  });
});
