<script setup lang="ts">
import type {
  OutpatientEmrAnalysisStatus,
  OutpatientEmrFieldValueSource,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
} from '../types';
import OutpatientEmrTemplatePreview from './OutpatientEmrTemplatePreview.vue';

withDefaults(defineProps<{
  templateName: string;
  template: OutpatientEmrTemplateParseResult | null;
  fields: OutpatientEmrTemplateField[];
  values: Record<string, string>;
  sources: Record<string, OutpatientEmrFieldValueSource>;
  status: OutpatientEmrAnalysisStatus;
  errorCode?: string;
  errorMessage?: string;
  validationMessage?: string;
  conflictFieldIds?: ReadonlySet<string>;
  editable?: boolean;
  canRetry?: boolean;
}>(), {
  errorCode: '',
  errorMessage: '',
  validationMessage: '',
  conflictFieldIds: () => new Set<string>(),
  editable: true,
  canRetry: false,
});

const emit = defineEmits<{
  'update-field': [fieldId: string, value: string];
  retry: [];
}>();
</script>

<template>
  <div class="voice-template-record" :aria-busy="status === 'analyzing'">
    <div class="template-source">当前门诊模板：{{ templateName }}</div>
    <p v-if="status === 'idle'" class="template-status" role="status">
      正在等待本次语音病历，完成后按当前模板生成。
    </p>
    <p v-else-if="status === 'analyzing'" class="template-status" role="status">
      正在按当前门诊模板生成病历，请稍候……
    </p>
    <div v-else-if="status === 'error'" class="template-error" role="alert">
      <span>{{ errorMessage || errorCode || '当前模板病历生成失败，请重试。' }}</span>
      <button v-if="canRetry" class="template-retry" type="button" @click="emit('retry')">
        重新生成模板病历
      </button>
    </div>
    <p v-if="validationMessage" class="template-error" role="alert">{{ validationMessage }}</p>
    <OutpatientEmrTemplatePreview
      v-if="template"
      :sanitized-html="template.sanitizedHtml"
      :fields="fields"
      :field-values="values"
      :field-sources="sources"
      :conflict-field-ids="conflictFieldIds"
      :editable="editable"
      @update-field="(fieldId, value) => emit('update-field', fieldId, value)"
    />
  </div>
</template>

<style scoped>
.voice-template-record { display: grid; gap: 12px; min-width: 0; }
.template-source { color: var(--text-secondary, #64748b); font-size: 13px; }
.template-status { margin: 0; color: var(--text-secondary, #64748b); line-height: 1.6; }
.template-error { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; color: #b91c1c; line-height: 1.6; }
.template-retry { padding: 5px 10px; border: 1px solid currentColor; border-radius: 6px; background: transparent; color: inherit; cursor: pointer; }
</style>
