<script setup lang="ts">
import { computed, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import { useConsultationReferenceFeedbackListener } from '@features/consultation-result';
import { useOutpatientEmrAnalysis } from '../model/useOutpatientEmrAnalysis';
import { summarizeOutpatientEmrCombinedWriteback } from '../lib/voiceOutpatientEmr';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrReferenceFeedbackPayload,
} from '../types';
import OutpatientEmrAnalysisPanel from './OutpatientEmrAnalysisPanel.vue';
import OutpatientEmrCombinedWritebackSummary from './OutpatientEmrCombinedWritebackSummary.vue';
import OutpatientEmrTemplatePreview from './OutpatientEmrTemplatePreview.vue';

const props = defineProps<{
  request: OutpatientEmrAnalysisRequest | null;
  baseWritebackPayload?: OutpatientEmrPreparedWritebackPayload | null;
}>();

const emit = defineEmits<{
  close: [];
  cancel: [];
  completed: [];
}>();

const {
  request: activeRequest,
  template,
  targetFields,
  fieldValues,
  fieldValueSources,
  analysisStatus,
  analysisErrorCode,
  analysisErrorMessage,
  writebackStatus,
  writebackMessage,
  pendingWritebackRequestId,
  dictionaryValidationMessage,
  conflictFieldIds,
  canSubmit,
  canRetry,
  start,
  retry,
  updateFieldValue,
  writeBack,
  cancel,
  applyReferenceFeedback,
  reset,
} = useOutpatientEmrAnalysis();

const previewEditable = computed(() => ![
  'submitting',
  'pending',
  'success',
].includes(writebackStatus.value));

const cancelDisabled = computed(() => [
  'submitting',
  'pending',
  'success',
].includes(writebackStatus.value));

const isCombinedWriteback = computed(() => Boolean(props.baseWritebackPayload));
const combinedSummary = computed(() => summarizeOutpatientEmrCombinedWriteback(
  props.baseWritebackPayload || null,
));

const primaryActionLabel = computed(() => {
  if (writebackStatus.value === 'submitting') {
    return isCombinedWriteback.value ? '正在一键回写' : '正在返回参数';
  }
  if (writebackStatus.value === 'pending') return '等待 HIS 回执';
  if (writebackStatus.value === 'success') return '回填已完成';
  if (writebackStatus.value === 'failed') {
    return isCombinedWriteback.value ? '重新一键回写' : '重新返回参数';
  }
  return isCombinedWriteback.value ? '一键回写' : '返回参数';
});

const pageSubtitle = computed(() => (
  activeRequest.value?.templateName || props.request?.templateName || '等待 HIS 传入门诊病历模板'
));

watch(
  () => props.request,
  (nextRequest) => {
    if (nextRequest) {
      void start(nextRequest);
    } else {
      reset();
    }
  },
  { immediate: true },
);

useConsultationReferenceFeedbackListener<OutpatientEmrReferenceFeedbackPayload>({
  resolveConsultationId: () => activeRequest.value?.visitId ?? '',
  isActive: () => Boolean(activeRequest.value && pendingWritebackRequestId.value),
  logContext: 'OutpatientEmrPage',
  onFeedback: (payload) => {
    if (applyReferenceFeedback(payload) === 'success') {
      emit('completed');
    }
  },
});

async function handleRetry(): Promise<void> {
  await retry();
}

function handleUpdateField(fieldId: string, value: string): void {
  updateFieldValue(fieldId, value);
}

async function handlePrimaryAction(): Promise<void> {
  await writeBack(props.baseWritebackPayload || null);
}

async function handleCancel(): Promise<void> {
  if (await cancel()) emit('cancel');
}
</script>

<template>
  <section class="outpatient-emr-page">
    <header class="page-header">
      <div class="title-group">
        <span class="title-icon"><Icon icon="lucide:file-pen" :size="20" /></span>
        <div>
          <h1>{{ isCombinedWriteback ? '门诊模板映射确认' : '门诊病历模板分析' }}</h1>
          <p>
            {{ pageSubtitle }}
            <span v-if="request && activeRequest?.visitId"> · 就诊 {{ activeRequest.visitId }}</span>
          </p>
        </div>
      </div>
      <button class="icon-button" type="button" title="收起" @click="emit('close')">
        <Icon icon="lucide:chevron-down" :size="18" />
      </button>
    </header>

    <main class="page-content">
      <template v-if="request">
        <OutpatientEmrAnalysisPanel
          :analysis-status="analysisStatus"
          :writeback-status="writebackStatus"
          :field-count="targetFields.length"
          :error-code="analysisErrorCode"
          :error-message="analysisErrorMessage"
          :writeback-message="writebackMessage"
        />

        <OutpatientEmrCombinedWritebackSummary
          v-if="isCombinedWriteback"
          :template-field-count="targetFields.length"
          :record-field-count="combinedSummary.recordFieldCount"
          :diagnosis-count="combinedSummary.diagnosisCount"
          :order-count="combinedSummary.orderCount"
        />

        <OutpatientEmrTemplatePreview
          v-if="template"
          :sanitized-html="template.sanitizedHtml"
          :fields="targetFields"
          :field-values="fieldValues"
          :field-sources="fieldValueSources"
          :conflict-field-ids="conflictFieldIds"
          :editable="previewEditable"
          @update-field="handleUpdateField"
        />

        <div v-else class="empty-preview">
          <Icon icon="lucide:triangle-alert" :size="28" />
          <span>等待安全解析当前 HIS 模板</span>
        </div>
      </template>
      <div v-else class="empty-preview">
        <Icon icon="lucide:inbox" :size="28" />
        <span>等待 HIS 通过 Bridge 或 SDK 传入门诊病历模板</span>
      </div>
    </main>

    <footer v-if="request" class="page-footer">
      <button
        class="secondary-button danger-button"
        type="button"
        :disabled="cancelDisabled"
        @click="handleCancel"
      >
        放弃
      </button>
      <div class="footer-actions">
        <span
          v-if="dictionaryValidationMessage"
          class="dictionary-validation-message"
          role="alert"
        >{{ dictionaryValidationMessage }}</span>
        <button
          v-if="analysisStatus === 'error'"
          class="secondary-button"
          type="button"
          :disabled="!canRetry"
          @click="handleRetry"
        >
          重新分析
        </button>
        <button
          class="primary-button"
          type="button"
          :disabled="!canSubmit"
          @click="handlePrimaryAction"
        >
          <Icon icon="lucide:send" :size="16" />
          <span>{{ primaryActionLabel }}</span>
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.outpatient-emr-page {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: #172033;
  background: #f5f7fb;
}

.page-header,
.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-color: #e2e8f0;
  background: #fff;
}

.page-header { border-bottom: 1px solid #e2e8f0; }
.page-footer { border-top: 1px solid #e2e8f0; }

.title-group,
.footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.dictionary-validation-message {
  max-width: 360px;
  color: #b45309;
  font-size: 12px;
  text-align: right;
}

.title-icon {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 10px;
  color: #1d4ed8;
  background: #dbeafe;
}

h1 {
  margin: 0;
  font-size: 16px;
}

.title-group p {
  margin: 3px 0 0;
  color: #64748b;
  font-size: 12px;
}

.page-content {
  display: grid;
  min-height: 0;
  gap: 14px;
  padding: 16px 20px;
  overflow: auto;
}

.empty-preview {
  display: grid;
  min-height: 300px;
  place-content: center;
  justify-items: center;
  gap: 10px;
  border: 1px dashed #cbd5e1;
  border-radius: 12px;
  color: #94a3b8;
  background: #fff;
}

button {
  font: inherit;
}

.icon-button,
.secondary-button,
.primary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  border-radius: 9px;
  cursor: pointer;
}

.icon-button {
  width: 36px;
  border: 0;
  color: #64748b;
  background: transparent;
}

.secondary-button,
.primary-button {
  padding: 0 16px;
  border: 1px solid #cbd5e1;
}

.secondary-button {
  color: #334155;
  background: #fff;
}

.danger-button { color: #b91c1c; }

.primary-button {
  border-color: #2563eb;
  color: #fff;
  background: #2563eb;
}

button:disabled {
  cursor: not-allowed;
  opacity: .5;
}
</style>
