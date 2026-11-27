import type { ClinicalRecordFactSuggestion } from '@features/clinical-result';
import { resolveOutpatientEmrFieldMapping } from './outpatientEmrFieldMapping';
import { resolveOutpatientEmrFieldPromptProfile } from './outpatientEmrPromptGenerator';
import type { OutpatientEmrRecordField, OutpatientEmrTemplateField } from '../types';

export interface VoiceSupplementChapter {
  key: string;
  fields: OutpatientEmrTemplateField[];
}

/** Use approved semantics and a full-body name, never infer a target from visibility. */
export function isVoiceSupplementTextField(field: OutpatientEmrTemplateField): boolean {
  if (!field.aiSuitable || field.readonly || !field.recordField || field.dictionaryItems.length
    || !['text', 'textarea'].includes(field.type.toLowerCase())
    || resolveOutpatientEmrFieldPromptProfile(field).shape !== 'narrative') return false;
  if (field.projectionMode === 'direct') return true;
  const ownMeaning = resolveOutpatientEmrFieldMapping({
    fieldId: field.id.replace(/^(?:请输入|请填写)/u, ''),
    fieldName: field.name.replace(/^(?:请输入|请填写)/u, ''),
  });
  return ownMeaning.recordField === field.recordField;
}

export function resolveVoiceSupplementTarget(
  chapters: readonly VoiceSupplementChapter[], recordField: OutpatientEmrRecordField, chapterId?: string,
): OutpatientEmrTemplateField | undefined {
  const matchingChapters = chapters.filter(chapter => chapterId ? chapter.key === chapterId
    : chapter.fields.some(field => field.recordField === recordField));
  if (matchingChapters.length !== 1) return;
  const candidates = matchingChapters[0].fields.filter(field => field.recordField === recordField && isVoiceSupplementTextField(field));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function voiceFieldSuggestions(
  field: OutpatientEmrTemplateField, siblings: OutpatientEmrTemplateField[], suggestions: readonly ClinicalRecordFactSuggestion[],
): ClinicalRecordFactSuggestion[] {
  return suggestions.filter(item => item.status === 'pending' && resolveVoiceSupplementTarget(
    [{ key: '', fields: siblings }], item.field,
  )?.id === field.id);
}
