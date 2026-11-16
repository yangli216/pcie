import { describe, expect, it } from 'vitest';
import type { OutpatientEmrTemplateField } from '../types';
import {
  buildOutpatientEmrInitialDraft,
  resolveOutpatientEmrModelDraft,
} from './outpatientEmrDraftSource';

function field(overrides: Partial<OutpatientEmrTemplateField> = {}): OutpatientEmrTemplateField {
  return {
    id: 'personalHistory',
    name: '个人史',
    type: 'text',
    articleTemplateId: 'article-personal',
    articleId: '个人史',
    articleName: '个人史',
    articleDefinitionName: '个人史',
    readonly: false,
    aiSuitable: true,
    baselineValue: '否认吸烟史。',
    baselineDictionaryValue: '',
    dictionaryItems: [],
    recordField: 'personalHistory',
    mappingSource: 'canonical-id',
    projectionMode: 'direct',
    ...overrides,
  };
}

const dictionaryField = field({
  id: '吸烟史标志',
  name: '吸烟史标志',
  type: 'select',
  baselineValue: '否认',
  baselineDictionaryValue: '0',
  dictionaryItems: [{ value: '0', text: '否认' }, { value: '1', text: '有' }],
});

describe('outpatient EMR draft provenance', () => {
  it('renders the text template preset in the draft but never a dictionary selection', () => {
    expect(buildOutpatientEmrInitialDraft(field())).toEqual({ value: '否认吸烟史。', source: 'template' });
    expect(buildOutpatientEmrInitialDraft(field({ baselineValue: '' }))).toEqual({ value: '', source: 'empty' });
    expect(buildOutpatientEmrInitialDraft(dictionaryField)).toEqual({ value: '', source: 'empty' });
  });

  it('keeps the preset as an unverified draft when the model has no related fact', () => {
    expect(resolveOutpatientEmrModelDraft(field(), '')).toEqual({ value: '否认吸烟史。', source: 'template' });
    expect(resolveOutpatientEmrModelDraft(field({ baselineValue: '' }), '')).toEqual({ value: '', source: 'empty' });
  });

  it('marks a model answer that matches the preset separately from new AI text', () => {
    expect(resolveOutpatientEmrModelDraft(field(), '否认吸烟史')).toEqual({
      value: '否认吸烟史',
      source: 'template-matched',
    });
    expect(resolveOutpatientEmrModelDraft(field(), '吸烟20年，每日10支。')).toEqual({
      value: '吸烟20年，每日10支。',
      source: 'ai',
    });
  });

  it('never inherits the dictionary template selection for an empty model answer', () => {
    expect(resolveOutpatientEmrModelDraft(dictionaryField, '')).toEqual({ value: '', source: 'empty' });
    expect(resolveOutpatientEmrModelDraft(dictionaryField, '有')).toEqual({ value: '有', source: 'ai' });
  });
});
