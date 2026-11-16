import type {
  OutpatientEmrFieldValueSource,
  OutpatientEmrTemplateField,
} from '../types';

export interface OutpatientEmrDraftValue {
  value: string;
  source: OutpatientEmrFieldValueSource;
}

function comparable(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/gu, '')
    .replace(/[。；;，,.]+$/u, '');
}

/** Draft shown before the model answers: text fields render the template preset draft. */
export function buildOutpatientEmrInitialDraft(
  field: OutpatientEmrTemplateField,
): OutpatientEmrDraftValue {
  if (field.dictionaryItems.length === 0 && field.baselineValue) {
    return { value: field.baselineValue, source: 'template' };
  }
  return { value: '', source: 'empty' };
}

/**
 * Merges one normalized model value with the template draft.
 * Dictionary fields never inherit the template selection. Text fields keep the template
 * preset draft when the model found no related fact, and record whether the model
 * confirmed it, so the preview can tell unverified presets from case-derived text.
 */
export function resolveOutpatientEmrModelDraft(
  field: OutpatientEmrTemplateField,
  modelValue: string,
): OutpatientEmrDraftValue {
  if (field.dictionaryItems.length > 0) {
    return modelValue ? { value: modelValue, source: 'ai' } : { value: '', source: 'empty' };
  }
  const baseline = field.baselineValue;
  if (!modelValue) {
    return baseline ? { value: baseline, source: 'template' } : { value: '', source: 'empty' };
  }
  if (baseline && comparable(modelValue) === comparable(baseline)) {
    return { value: modelValue, source: 'template-matched' };
  }
  return { value: modelValue, source: 'ai' };
}
