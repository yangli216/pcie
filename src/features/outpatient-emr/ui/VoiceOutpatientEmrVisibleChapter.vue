<script setup lang="ts">
import { computed } from 'vue';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';
import VoiceOutpatientEmrRecord from './VoiceOutpatientEmrRecord.vue';

const props = defineProps<{
  title: string;
  fields: OutpatientEmrTemplateField[];
  targetFieldIds: string[];
  values: Readonly<Record<string, string>>;
  sources: Readonly<Record<string, OutpatientEmrFieldValueSource>>;
  conflicts: ReadonlySet<string>;
  editable: boolean;
}>();
const emit = defineEmits<{ 'update-field': [id: string, value: string] }>();
const visibleFields = computed(() => props.fields.filter(field => field.visible !== false));
</script>

<template>
  <section v-if="visibleFields.length" :aria-label="title">
    <VoiceOutpatientEmrRecord v-for="field in visibleFields" :key="field.id"
      :field="field" :title="field.name || title"
      :value="values[field.id] ?? field.baselineValue" :source="sources[field.id]"
      :conflict="conflicts.has(field.id)" :editable="editable && !field.readonly && targetFieldIds.includes(field.id)"
      @update-field="(id, value) => emit('update-field', id, value)"
    />
  </section>
</template>
