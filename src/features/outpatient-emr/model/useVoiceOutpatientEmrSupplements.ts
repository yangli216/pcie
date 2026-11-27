import { watch } from 'vue';
import { mergeClinicalRecordSuggestionIntoText } from '@features/clinical-result/clinicalRecordAnnotation';
import type { ClinicalRecordFactSuggestion } from '@features/clinical-result/clinicalRecordFactConfirmation';
import { resolveVoiceSupplementTarget, type VoiceSupplementChapter } from '../lib/voiceOutpatientEmrSupplements';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';

export interface VoiceOutpatientEmrSupplements {
  suggestions: readonly ClinicalRecordFactSuggestion[];
  precautions: string;
}

export function useVoiceOutpatientEmrSupplements(options: {
  owner: () => object | null;
  ready: () => boolean;
  chapters: () => readonly VoiceSupplementChapter[];
  source: () => VoiceOutpatientEmrSupplements | undefined;
  values: () => Readonly<Record<string, string>>;
  sources: () => Readonly<Record<string, OutpatientEmrFieldValueSource>>;
  isEdited: (id: string) => boolean;
  apply: (fields: OutpatientEmrTemplateField[], values: Record<string, string>) => void;
}) {
  let owner: object | null = null;
  let lastPrecautions: { id: string; value: string } | undefined;
  watch(() => [options.owner(), options.ready(), options.chapters(), options.source(), options.values(), options.sources()] as const,
    ([nextOwner, ready, chapters, source, values, sources]) => {
      if (nextOwner !== owner) { owner = nextOwner; lastPrecautions = undefined; }
      if (!owner || !ready || !source) return;
      const patches: Record<string, string> = {};
      const targets = new Map<string, OutpatientEmrTemplateField>();
      const edited = (id: string) => options.isEdited(id) || sources[id] === 'doctor';
      for (const item of source.suggestions) {
        if (item.status !== 'pending') continue;
        const field = resolveVoiceSupplementTarget(chapters, item.field, item.chapterId);
        if (!field || edited(field.id)) continue;
        const previous = patches[field.id] ?? values[field.id] ?? '';
        const next = mergeClinicalRecordSuggestionIntoText(previous, item);
        if (next !== previous) { patches[field.id] = next; targets.set(field.id, field); }
      }
      const field = resolveVoiceSupplementTarget(chapters, 'precautions');
      if (field && !edited(field.id)) {
        const current = values[field.id] ?? '';
        const owned = lastPrecautions?.id === field.id && lastPrecautions.value === current;
        // A first-pass template paragraph is authoritative. Fill its empty slot;
        // later diagnosis-scope changes may replace only our own system value.
        if ((!current || owned) && current !== source.precautions) {
          patches[field.id] = source.precautions;
          targets.set(field.id, field);
          lastPrecautions = { id: field.id, value: source.precautions };
        }
      }
      if (targets.size) options.apply([...targets.values()], patches);
    }, { immediate: true });
}
