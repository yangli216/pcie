<script setup lang="ts">
import { computed } from 'vue';
import type { ClinicalRecordExplicitFact, ClinicalRecordFactSuggestion } from '@features/clinical-result';
import VoiceRecordFieldEditor from '@features/voice-consultation/ui/VoiceRecordFieldEditor.vue';
import { resolveOutpatientEmrFinalDictionaryItem } from '../lib/outpatientEmrDictionary';
import { OUTPATIENT_EMR_FIELD_CONFLICT_LABEL, OUTPATIENT_EMR_FIELD_SOURCE_LABELS } from '../lib/outpatientEmrTemplate';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';

const props = withDefaults(defineProps<{
  field: OutpatientEmrTemplateField;
  title: string;
  value: string;
  source?: OutpatientEmrFieldValueSource;
  editable?: boolean;
  conflict?: boolean;
  presentation?: 'form' | 'document';
  factHighlights?: ClinicalRecordExplicitFact[];
  factSuggestions?: ClinicalRecordFactSuggestion[];
}>(), { editable: true, presentation: 'document' });

const emit = defineEmits<{
  'update-field': [fieldId: string, value: string];
  'dismiss-fact-suggestion': [id: string];
}>();

const sourceDescription = computed(() => props.conflict
  ? OUTPATIENT_EMR_FIELD_CONFLICT_LABEL
  : props.source && OUTPATIENT_EMR_FIELD_SOURCE_LABELS[props.source]);
const dictionaryItem = computed(() => resolveOutpatientEmrFinalDictionaryItem(props.field, props.value));
const dictionaryText = computed(() => dictionaryItem.value?.text ?? props.value);

function update(value: string): void {
  if (props.editable) emit('update-field', props.field.id, value);
}
</script>

<template>
  <div
    v-if="field.visible !== false"
    class="outpatient-record-field"
    :data-outpatient-emr-field-id="field.id"
    :data-outpatient-emr-source="source"
    :aria-invalid="conflict || undefined"
    :title="sourceDescription"
  >
    <div v-if="field.dictionaryItems.length" class="record-field record-field-document">
      <label class="dictionary-line">
        <strong>{{ title }}：</strong>
        <span class="dictionary-value">
          <select
            :aria-label="title"
            :disabled="!editable"
            :value="dictionaryText"
            @change="update(($event.target as HTMLSelectElement).value)"
          >
            <option value="">未选择</option>
            <option v-if="dictionaryText && !dictionaryItem" :value="dictionaryText" disabled>
              {{ dictionaryText }}
            </option>
            <option v-for="item in field.dictionaryItems" :key="item.text" :value="item.text">{{ item.text }}</option>
          </select>
          <span aria-hidden="true">{{ dictionaryText || '未选择' }}</span>
        </span>
      </label>
    </div>
    <VoiceRecordFieldEditor
      v-else
      :model-value="value"
      :title="title"
      :placeholder="`请输入${title}...`"
      :rows="2"
      :presentation="presentation"
      :commit-on-blur="presentation === 'form'"
      :readonly="!editable"
      :fact-highlights="factHighlights"
      :fact-suggestions="factSuggestions"
      @update:model-value="update"
      @dismiss-fact-suggestion="emit('dismiss-fact-suggestion', $event)"
    />
  </div>
</template>

<style scoped>
.dictionary-line { color: var(--voice-text); font-size: 15px; line-height: 1.75; }
.dictionary-value { display: inline-block; position: relative; max-width: 100%; border-bottom: var(--field-underline, 1px dashed currentColor); }
.dictionary-value select { position: absolute; inset: 0; width: 100%; height: 100%; min-width: 0; padding: 0; opacity: 0; font: inherit; cursor: pointer; }
.dictionary-value select:disabled { cursor: default; }
.dictionary-value:focus-within { outline: 2px solid var(--voice-accent); outline-offset: 2px; }
.outpatient-record-field[data-outpatient-emr-source="template"] { --field-underline: 1px dashed #b7791f; }
.outpatient-record-field[data-outpatient-emr-source="template-matched"] { --field-underline: 1px solid #b7791f; }
.outpatient-record-field[data-outpatient-emr-source="unmentioned-default"] { --field-underline: 1px dotted currentColor; }
.outpatient-record-field :deep(.clinical-record-line > span:not(.clinical-record-placeholder)) { border-bottom: var(--field-underline); }
.outpatient-record-field[aria-invalid="true"] { outline: 1px solid var(--voice-danger, #b52f2f); border-radius: 3px; }
</style>
