<script setup lang="ts">
import { computed } from 'vue';
import type { OutpatientEmrNarrativeSection } from '../lib/outpatientEmrNarrative';
import type { OutpatientEmrFieldValueSource } from '../types';
import VoiceOutpatientEmrRecord from './VoiceOutpatientEmrRecord.vue';

const props = defineProps<{
  chapters: OutpatientEmrNarrativeSection[];
  values: Readonly<Record<string, string>>;
  sources: Readonly<Record<string, OutpatientEmrFieldValueSource>>;
  conflicts: ReadonlySet<string>;
  editable: boolean;
}>();
const emit = defineEmits<{ 'update-field': [id: string, value: string] }>();

const groups = computed(() => props.chapters.map(chapter => ({
  key: chapter.key,
  title: chapter.title,
  fields: chapter.fields.filter(field => field.visible !== false && (chapter.fallback || ['template', 'unmentioned-default'].includes(props.sources[field.id]) || !field.recordField || chapter.directField?.id !== field.id)),
})).filter(group => group.fields.length));
</script>

<template>
  <details v-if="groups.length" class="template-review">
    <summary>模板回写字段</summary>
    <fieldset v-for="group in groups" :key="group.key">
      <legend>{{ group.title }}</legend>
      <template v-for="field in group.fields" :key="field.id">
        <VoiceOutpatientEmrRecord presentation="form"
          :title="field.name || field.id" :field="field" :value="values[field.id] ?? ''"
          :source="sources[field.id]" :conflict="conflicts.has(field.id)" :editable="editable"
          @update-field="(id, value) => emit('update-field', id, value)"
        />
        <button v-if="editable && (sources[field.id] === 'template' || sources[field.id] === 'unmentioned-default')" type="button"
          @click="emit('update-field', field.id, values[field.id])">
          {{ sources[field.id] === 'template' ? '确认采用此模板预置' : '确认采用此默认项' }}
        </button>
      </template>
    </fieldset>
  </details>
</template>

<style scoped>
.template-review { margin: 10px 0; }
.template-review summary { cursor: pointer; font-weight: 600; }
.template-review fieldset { display: grid; gap: 8px; margin: 8px 0; padding: 10px; border: 1px solid var(--voice-border); border-radius: 6px; }
.template-review legend { padding: 0 4px; font-weight: 600; }
</style>
