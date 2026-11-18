<script setup lang="ts">
import ClinicalRecordAnnotatedText from '../../consultation-result/ui/ClinicalRecordAnnotatedText.vue';
import type {
  ClinicalRecordExplicitFact,
  ClinicalRecordFactSuggestion,
} from '@features/clinical-result';

withDefaults(defineProps<{
  modelValue: string;
  title: string;
  rows: number;
  placeholder: string;
  emptyText?: string;
  grow?: boolean;
  readonly?: boolean;
  titleDescription?: string;
  commitOnBlur?: boolean;
  presentation?: 'form' | 'document';
  factHighlights?: ClinicalRecordExplicitFact[];
  factSuggestions?: ClinicalRecordFactSuggestion[];
}>(), {
  grow: false,
  presentation: 'form',
  factHighlights: () => [],
  factSuggestions: () => [],
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'dismiss-fact-suggestion', id: string): void;
}>();

function handleInput(event: Event): void {
  const target = event.target as HTMLTextAreaElement | null;
  emit('update:modelValue', target?.value || '');
}

</script>

<template>
  <div
    class="record-field"
    :title="titleDescription"
    :class="{ 'field-grow': grow, 'record-field-document': presentation === 'document' }"
    :style="{ '--record-field-rows': String(rows) }"
  >
    <template v-if="presentation === 'document'">
      <ClinicalRecordAnnotatedText
        :model-value="modelValue"
        :title="title"
        :readonly="readonly"
        :commit-on-blur="commitOnBlur"
        :placeholder="placeholder"
        :empty-text="emptyText"
        :facts="factHighlights"
        :suggestions="factSuggestions"
        @update:model-value="emit('update:modelValue', $event)"
        @dismiss-suggestion="emit('dismiss-fact-suggestion', $event)"
      />
    </template>

    <template v-else>
      <div class="record-field-head">
        <label>{{ title }}</label>
      </div>
      <textarea
        :value="modelValue"
        :aria-label="title"
        :rows="rows"
        :readonly="readonly"
        :placeholder="placeholder"
        @input="!commitOnBlur && handleInput($event)"
        @change="commitOnBlur && handleInput($event)"
      ></textarea>
    </template>
  </div>
</template>

<style scoped>
.record-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.record-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.field-grow {
  flex: 1;
}

.record-field label {
  font-size: 13px;
  color: #334155;
  font-weight: 600;
}

.record-field textarea {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--voice-border);
  border-radius: 12px;
  background: var(--voice-surface);
  color: var(--voice-text);
  font-size: var(--voice-font-main);
  line-height: 1.7;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.015) inset;
}

.record-field textarea:focus {
  border-color: var(--voice-accent);
  box-shadow: 0 0 0 3px var(--voice-accent-soft);
  background: rgba(255, 255, 255, 0.98);
}

.record-field-document {
  display: block;
}
</style>
