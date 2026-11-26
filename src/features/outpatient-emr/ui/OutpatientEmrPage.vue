<script setup lang="ts">
import { computed, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import '@shared/styles/workspace-page.css';
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
  targetFields, aiTargetCount, resultSummary,
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
  <section class="outpatient-emr-page workspace-page">
    <header class="page-header workspace-header">
      <div class="title-group workspace-title-group">
        <span class="title-icon workspace-title-icon"><Icon icon="lucide:file-pen" :size="20" /></span>
        <div>
          <h1 class="workspace-title">{{ isCombinedWriteback ? '门诊模板映射确认' : '门诊病历模板分析' }}</h1>
          <p class="workspace-subtitle">
            {{ pageSubtitle }}
            <span v-if="request && activeRequest?.visitId"> · 就诊 {{ activeRequest.visitId }}</span>
          </p>
        </div>
      </div>
      <button class="icon-button workspace-button is-icon" type="button" title="收起" aria-label="收起" @click="emit('close')">
        <Icon icon="lucide:chevron-down" :size="18" />
      </button>
    </header>

    <main class="page-content">
      <template v-if="request">
        <OutpatientEmrAnalysisPanel
          :analysis-status="analysisStatus"
          :writeback-status="writebackStatus"
          :field-count="aiTargetCount"
          :result-summary="resultSummary"
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
          :visibility-fields="template.fields"
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

    <footer v-if="request" class="page-footer workspace-footer">
      <button
        class="secondary-button danger-button workspace-button is-danger"
        type="button"
        :disabled="cancelDisabled"
        @click="handleCancel"
      >
        放弃
      </button>
      <div class="footer-actions workspace-actions">
        <span
          v-if="dictionaryValidationMessage"
          class="dictionary-validation-message"
          role="alert"
        >{{ dictionaryValidationMessage }}</span>
        <button
          v-if="analysisStatus === 'error' || analysisStatus === 'draft'"
          class="secondary-button workspace-button"
          type="button"
          :disabled="!canRetry"
          @click="handleRetry"
        >
          重新分析
        </button>
        <button
          class="primary-button workspace-button is-primary"
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
.footer-actions {
  justify-content: flex-end;
}

.dictionary-validation-message {
  max-width: 360px;
  color: #b45309;
  font-size: 12px;
  line-height: 1.5;
  text-align: right;
  overflow-wrap: anywhere;
}

.page-content {
  display: grid;
  flex: 1;
  min-height: 0;
  align-content: start;
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
  background: var(--workspace-surface);
}

@container workspace-page (max-width: 720px) {
  .page-content {
    padding: 14px;
  }

  .footer-actions {
    flex: 1 1 auto;
  }

  .dictionary-validation-message {
    flex-basis: 100%;
    max-width: none;
    text-align: left;
  }
}
</style>
