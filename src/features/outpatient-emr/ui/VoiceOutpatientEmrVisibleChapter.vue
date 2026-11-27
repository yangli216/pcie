<script setup lang="ts">
import { computed } from 'vue';
import type { ClinicalRecordExplicitFact, ClinicalRecordFactSuggestion } from '@features/clinical-result';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';
import { voiceFieldSuggestions } from '../lib/voiceOutpatientEmrSupplements';
import VoiceOutpatientEmrRecord from './VoiceOutpatientEmrRecord.vue';

const props = withDefaults(defineProps<{
  title: string;
  fields: OutpatientEmrTemplateField[];
  targetFieldIds: string[];
  values: Readonly<Record<string, string>>;
  sources: Readonly<Record<string, OutpatientEmrFieldValueSource>>;
  conflicts: ReadonlySet<string>;
  editable: boolean;
  factHighlights?: ClinicalRecordExplicitFact[];
  factSuggestions?: ClinicalRecordFactSuggestion[];
}>(), { factHighlights: () => [], factSuggestions: () => [] });
const emit = defineEmits<{
  'update-field': [id: string, value: string];
  'dismiss-fact-suggestion': [id: string];
}>();
const visibleFields = computed(() => props.fields.filter(field => field.visible !== false).map(field => ({
  field,
  facts: props.factHighlights.filter(fact => fact.field === field.recordField),
  suggestions: voiceFieldSuggestions(field, props.fields, props.factSuggestions),
})));
</script>

<template>
  <section v-if="visibleFields.length" :aria-label="title">
    <VoiceOutpatientEmrRecord v-for="{ field, facts, suggestions } in visibleFields" :key="field.id"
      :field="field" :title="field.name || title"
      :value="values[field.id] ?? field.baselineValue" :source="sources[field.id]"
      :conflict="conflicts.has(field.id)" :editable="editable && !field.readonly && targetFieldIds.includes(field.id)"
      :fact-highlights="facts" :fact-suggestions="suggestions"
      @update-field="(id, value) => emit('update-field', id, value)"
      @dismiss-fact-suggestion="emit('dismiss-fact-suggestion', $event)"
    />
  </section>
</template>
