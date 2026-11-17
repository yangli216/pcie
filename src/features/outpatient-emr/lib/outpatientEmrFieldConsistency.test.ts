import { describe, expect, it } from 'vitest';
import type { OutpatientEmrTemplateField } from '../types';
import { findOutpatientEmrFieldConflicts } from './outpatientEmrFieldConsistency';

function field(overrides: Partial<OutpatientEmrTemplateField>): OutpatientEmrTemplateField {
  return {
    id: 'x',
    name: 'x',
    type: 'text',
    articleTemplateId: 'article-personal',
    articleId: '个人史',
    articleName: '个人史',
    articleDefinitionName: '个人史',
    readonly: false,
    aiSuitable: true,
    baselineValue: '',
    baselineDictionaryValue: '',
    dictionaryItems: [],
    recordField: 'personalHistory',
    mappingSource: 'deterministic-article',
    projectionMode: 'section-compose',
    ...overrides,
  };
}

const smokingFlag = field({
  id: '吸烟史标志',
  name: '吸烟史标志',
  type: 'select',
  dictionaryItems: [{ value: '0', text: '否认' }, { value: '1', text: '有' }],
});
const smokingDetail = field({ id: '吸烟史补充', name: '吸烟史补充' });
const otherSectionDetail = field({
  id: '吸烟史补充-其他章节',
  name: '吸烟史补充',
  articleTemplateId: 'article-other',
});
const freeSupplement = field({ id: '医嘱其他补充', name: '医嘱其他补充' });
const fields = [smokingFlag, smokingDetail, otherSectionDetail, freeSupplement];

describe('outpatient EMR flag/detail consistency', () => {
  it('flags a positive presence flag paired with a negated supplement', () => {
    const conflicts = findOutpatientEmrFieldConflicts(fields, {
      吸烟史标志: '有',
      吸烟史补充: '否认吸烟史',
    });
    expect(conflicts).toEqual([expect.objectContaining({
      flagFieldId: '吸烟史标志',
      detailFieldId: '吸烟史补充',
    })]);
  });

  it('flags a negative presence flag paired with a positive supplement', () => {
    expect(findOutpatientEmrFieldConflicts(fields, {
      吸烟史标志: '0',
      吸烟史补充: '吸烟20年，每日10支。',
    })).toHaveLength(1);
  });

  it('accepts consistent, empty, unknown and unpaired values', () => {
    expect(findOutpatientEmrFieldConflicts(fields, {
      吸烟史标志: '有',
      吸烟史补充: '吸烟20年，每日10支。',
    })).toEqual([]);
    expect(findOutpatientEmrFieldConflicts(fields, {
      吸烟史标志: '否认',
      吸烟史补充: '无吸烟史',
    })).toEqual([]);
    expect(findOutpatientEmrFieldConflicts(fields, { 吸烟史标志: '', 吸烟史补充: '否认吸烟史' })).toEqual([]);
    expect(findOutpatientEmrFieldConflicts(fields, { 吸烟史标志: '有', 吸烟史补充: '不详' })).toEqual([]);
    expect(findOutpatientEmrFieldConflicts(fields, {
      吸烟史标志: '有',
      '吸烟史补充-其他章节': '否认吸烟史',
      医嘱其他补充: '否认',
    })).toEqual([]);
  });
});
