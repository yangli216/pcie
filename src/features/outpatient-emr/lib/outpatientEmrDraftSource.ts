import type {
  OutpatientEmrFieldValueSource,
  OutpatientEmrTemplateField,
} from '../types';
import { resolveOutpatientEmrUnmentionedDefault } from './outpatientEmrPromptGenerator';

export interface OutpatientEmrDraftValue {
  value: string;
  source: OutpatientEmrFieldValueSource;
}

/** Only case-derived values and deliberate text clears can be submitted by the voice result page. */
export function isVoiceOutpatientEmrFieldBound(
  field: OutpatientEmrTemplateField, value: string | undefined, source: OutpatientEmrFieldValueSource | undefined,
): boolean {
  if (typeof value !== 'string' || !source || source === 'template' || source === 'empty' || source === 'unmentioned-default') return false;
  return Boolean(value.trim()) || (source === 'doctor' && !field.dictionaryItems.length);
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
  modelValue: string | null,
): OutpatientEmrDraftValue {
  if (modelValue === null) {
    const value = resolveOutpatientEmrUnmentionedDefault(field);
    if (value !== undefined) return { value, source: 'unmentioned-default' };
  }
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
