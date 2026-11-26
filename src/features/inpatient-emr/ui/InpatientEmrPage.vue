<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import '@shared/styles/workspace-page.css';
import { audioRecorder, getMicrophoneErrorMessage } from '@/services/audioRecorder';
import { transcribeSpeech } from '@/services/aliyunSpeech';
import { useConsultationReferenceFeedbackListener } from '@features/consultation-result';
import {
  type InpatientEmrReferenceFeedbackPayload,
  useInpatientEmrGeneration,
} from '../model/useInpatientEmrGeneration';
import {
  isAdmissionTemplate,
} from '../lib/inpatientEmrTemplate';
import { buildInpatientEmrFieldPrompt } from '../lib/inpatientEmrPrompts';
import { sanitizeExternalHtml } from '@shared/lib/safeHtml';
// import { buildInpatientEmrQualityIssues } from '../lib/inpatientEmrQuality';
import InpatientEmrProcessPanel from './InpatientEmrProcessPanel.vue';
import InpatientEmrTemplatePreview from './InpatientEmrTemplatePreview.vue';
import InpatientEmrWritebackQualityDialog from './InpatientEmrWritebackQualityDialog.vue';
import type {
  InpatientEmrGenerationRequest,
  InpatientEmrQualityIssue,
  InpatientEmrTemplateField,
} from '../types';
import { getHisAdapter } from '@/services/his';
import { inpatientLogUpload, retryInpatientLogs } from '../api/inpatientEmrLogOutbox';
import type { HisOutpatientVisit, HisOutpatientMedicalRecord } from '@/services/his';

const props = defineProps<{
  request: InpatientEmrGenerationRequest | null;
  active?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  cancel: [];
  completed: [];
}>();

const {
  steps,
  result,
  errorMessage,
  isGenerating,
  isWritingBack,
  writebackMessage,
  writebackStatus,
  activeStepKey,
  completedStepCount,
  start,
  regenerate,
  updateFieldValue,
  writeBack,
  applyReferenceFeedback,
  abandon,
  pendingWritebackRequestId,
  reset,
} = useInpatientEmrGeneration();

const showRegenerateDialog = ref(false);
const showCancelConfirm = ref(false);
const showWritebackQualityDialog = ref(false);
const pendingQualityIssues = ref<InpatientEmrQualityIssue[]>([]);

const outpatientVisits = ref<HisOutpatientVisit[]>([]);
const isLoadingVisits = ref(false);
const selectedVisitId = ref<string | null>(null);
const lastOutpatientVisitQueryKey = ref('');
type OutpatientHistoryRangeKey = '7d' | '1m' | '3m';
const outpatientHistoryRangeKey = ref<OutpatientHistoryRangeKey>('7d');
const outpatientHistoryRangeOptions: Array<{ key: OutpatientHistoryRangeKey; label: string; days?: number; months?: number }> = [
  { key: '7d', label: '近7天', days: 7 },
  { key: '1m', label: '近1月', months: 1 },
  { key: '3m', label: '近3月', months: 3 },
];

const showOutpatientPreview = ref(false);
const isDetailLoading = ref(false);
const previewVisitRecord = ref<HisOutpatientMedicalRecord | null>(null);
const safePreviewVisitHtml = computed(() => sanitizeExternalHtml(previewVisitRecord.value?.htmlContent));
let outpatientVisitsLoadSeq = 0;
let outpatientDetailLoadSeq = 0;
const selectedVisitOutsideList = computed(() => Boolean(selectedVisitId.value)
  && !outpatientVisits.value.some(visit => visit.visitId === selectedVisitId.value));

const displayedRequest = computed(() => result.value?.request ?? props.request);
const isAdmission = computed(() => {
  return isAdmissionTemplate(displayedRequest.value?.templateName || '');
});

function trimUnknown(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeForHis(date: Date, endOfDay = false): string {
  const hours = endOfDay ? 23 : 0;
  const minutes = endOfDay ? 59 : 0;
  const seconds = endOfDay ? 59 : 0;
  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-') + ` ${padDatePart(hours)}:${padDatePart(minutes)}:${padDatePart(seconds)}`;
}

function buildOutpatientHistoryDateRange(rangeKey: OutpatientHistoryRangeKey): [string, string] {
  const end = new Date();
  const start = new Date(end);
  const option = outpatientHistoryRangeOptions.find((item) => item.key === rangeKey);
  if (option?.months) {
    start.setMonth(start.getMonth() - option.months);
  } else {
    start.setDate(start.getDate() - (option?.days ?? 7));
  }
  return [formatDateTimeForHis(start), formatDateTimeForHis(end, true)];
}

const outpatientHistoryDateRange = computed(() => buildOutpatientHistoryDateRange(outpatientHistoryRangeKey.value));
const outpatientHistoryRangeText = computed(() => outpatientHistoryDateRange.value.join(' 至 '));
const outpatientVisitEmptyText = computed(() => {
  const option = outpatientHistoryRangeOptions.find((item) => item.key === outpatientHistoryRangeKey.value);
  return `${option?.label || '当前范围'}内暂无同时包含诊断和门诊病历的就诊记录`;
});

function resolveOutpatientHistoryPatientId(request: InpatientEmrGenerationRequest | null): string {
  if (!request) return '';

  const requestPatient = request.patient;
  const aiContextPatient = request.hisContext?.patient as Record<string, unknown> | undefined;
  const loadedContextPatient = result.value?.context.aiContext?.patient as Record<string, unknown> | undefined;
  const loadedRegistration = result.value?.context.registration;

  return trimUnknown(requestPatient?.patientId)
    || trimUnknown(requestPatient?.idPi)
    || trimUnknown(aiContextPatient?.patientId)
    || trimUnknown(aiContextPatient?.idPi)
    || trimUnknown(aiContextPatient?.id_pi)
    || trimUnknown(loadedContextPatient?.patientId)
    || trimUnknown(loadedContextPatient?.idPi)
    || trimUnknown(loadedContextPatient?.id_pi)
    || trimUnknown(loadedRegistration?.patientId);
}

async function loadOutpatientVisits(options: { warnWhenMissingPatient?: boolean; force?: boolean } = {}) {
  const patientId = resolveOutpatientHistoryPatientId(props.request);
  if (!patientId) {
    if (options.warnWhenMissingPatient) {
      console.warn('[InpatientEmrPage] Skip outpatient visit history because patient idPi/patientId is missing', {
        admissionId: props.request?.admissionId,
        hasPatient: Boolean(props.request?.patient),
        hasRequestHisContextPatient: Boolean(props.request?.hisContext?.patient),
        hasLoadedHisContextPatient: Boolean(result.value?.context.aiContext?.patient),
        hasLoadedRegistration: Boolean(result.value?.context.registration),
      });
    }
    outpatientVisits.value = [];
    return;
  }
  const queryKey = `${patientId}|${outpatientHistoryRangeKey.value}|${outpatientHistoryDateRange.value.join('|')}`;
  if (!options.force && lastOutpatientVisitQueryKey.value === queryKey) {
    return;
  }
  const loadSeq = ++outpatientVisitsLoadSeq;
  isLoadingVisits.value = true;
  try {
    const adapter = getHisAdapter();
    if (!adapter) {
      console.warn('[InpatientEmrPage] Skip outpatient visit history because HIS adapter is not ready', {
        patientId,
      });
      outpatientVisits.value = [];
      return;
    }
    const visits = await adapter.fetchOutpatientVisitHistory(patientId, {
      limit: -1,
      dateRange: outpatientHistoryDateRange.value,
      requireDiagnosisAndRecord: true,
    });
    if (loadSeq !== outpatientVisitsLoadSeq) return;
    outpatientVisits.value = visits;
    lastOutpatientVisitQueryKey.value = queryKey;
  } catch (error) {
    console.error('[InpatientEmrPage] Failed to fetch outpatient visits', error);
  } finally {
    if (loadSeq === outpatientVisitsLoadSeq) {
      isLoadingVisits.value = false;
    }
  }
}

function setOutpatientHistoryRange(rangeKey: OutpatientHistoryRangeKey): void {
  if (outpatientHistoryRangeKey.value === rangeKey) return;
  outpatientHistoryRangeKey.value = rangeKey;
  outpatientVisits.value = [];
  lastOutpatientVisitQueryKey.value = '';
  void loadOutpatientVisits({ warnWhenMissingPatient: true, force: true });
}

function selectVisit(visitId: string) {
  if (selectedVisitId.value === visitId) {
    selectedVisitId.value = null;
  } else {
    selectedVisitId.value = visitId;
  }
}

async function viewOutpatientDetail(visitId: string) {
  const loadSeq = ++outpatientDetailLoadSeq;
  isDetailLoading.value = true;
  showOutpatientPreview.value = true;
  previewVisitRecord.value = null;
  try {
    const adapter = getHisAdapter();
    if (adapter) {
      const record = await adapter.fetchOutpatientMedicalRecord(visitId);
      if (loadSeq === outpatientDetailLoadSeq) previewVisitRecord.value = record;
    }
  } catch (error) {
    console.error('[InpatientEmrPage] Failed to fetch outpatient detail', error);
  } finally {
    if (loadSeq === outpatientDetailLoadSeq) isDetailLoading.value = false;
  }
}

function selectVisitAndClosePreview(visitId: string) {
  selectedVisitId.value = visitId;
  showOutpatientPreview.value = false;
}
const supplementText = ref('');
const supplementError = ref('');
const isRecordingSupplement = ref(false);
const isTranscribingSupplement = ref(false);
const supplementRecordingSeconds = ref(0);
const supplementAudioLevels = ref<number[]>(Array.from({ length: 18 }, () => 6));
let supplementTimerId: number | null = null;
let supplementAnimationFrameId: number | null = null;
const supplementPresets = [
  '主诉变化',
  '查体发现',
  '检验检查结果',
  '治疗调整',
  '病情评估',
  '后续计划',
];
const activeStep = computed(() => steps.value.find((step) => step.key === activeStepKey.value));
const activeStepLabel = computed(() => activeStep.value?.title || '准备生成');
const activeStepDetail = computed(() => activeStep.value?.detail || '正在整理住院病历上下文');
const aiFields = computed(() => result.value?.template.fields.filter((field) => field.aiSuitable) || []);
const visibleAiFields = computed(() => aiFields.value.filter(field => field.visible !== false));
const filledFieldCount = computed(() => aiFields.value.filter((field) => result.value?.fieldValues[field.id]?.trim()).length);
const actionDisabled = computed(() => !props.request || isGenerating.value || isWritingBack.value || writebackStatus.value === 'pending');
const previewEditable = computed(() => Boolean(result.value) && !actionDisabled.value && writebackStatus.value !== 'success');
const primaryActionLabel = computed(() => {
  if (isWritingBack.value) return '正在回写';
  if (writebackStatus.value === 'pending') return '等待 HIS 回执';
  if (writebackStatus.value === 'success') return '回写已完成';
  if (writebackStatus.value === 'error') return '重新回写';
  return '一键回写';
});
const generationPresentation = computed(() => {
  if (isGenerating.value) return { icon: 'lucide:loader-circle', title: activeStepLabel.value, detail: activeStepDetail.value, tone: 'working' };
  if (isWritingBack.value) return { icon: 'lucide:loader-circle', title: '正在发送病历', detail: '正在发送回写事件，请等待 HIS 保存并回执', tone: 'working' };
  if (writebackStatus.value === 'pending') return { icon: 'lucide:clock', title: '已发送，等待 HIS 回执', detail: '回填结果以 HIS 回执为准，当前病历为只读', tone: 'working' };
  if (writebackStatus.value === 'success') return { icon: 'lucide:circle-check', title: 'HIS 已完成病历回填', detail: '本次病历已完成回填', tone: 'ready' };
  if (writebackStatus.value === 'error') return { icon: 'lucide:triangle-alert', title: '回写未完成，草稿已保留', detail: '可调整当前正文后重新回写', tone: 'error' };
  if (errorMessage.value) {
    const hasDraft = filledFieldCount.value > 0;
    return { icon: 'lucide:triangle-alert', tone: 'error',
      title: hasDraft ? '生成未完成，请核对已有草稿' : '生成未完成',
      detail: hasDraft ? '可直接修改已有内容，或补充要点后重新生成'
        : result.value ? '可手工填写空字段，或重新生成' : '请查看上方错误提示后重新生成',
    };
  }
  if (result.value) return { icon: 'lucide:file-pen', title: '病历草稿已生成，请核对', detail: '可在原始模板中直接修改蓝色虚线标出的字段', tone: 'ready' };
  return { icon: 'lucide:file-text', title: '准备生成病历', detail: '正在整理本次病历所需资料', tone: 'idle' };
});

const supplementVoiceButtonText = computed(() => {
  if (isTranscribingSupplement.value) return '识别中';
  return isRecordingSupplement.value ? '停止并识别' : '语音录入';
});
const supplementVoiceStatus = computed(() => {
  if (isTranscribingSupplement.value) return '正在识别，结果将追加到补充要点';
  if (isRecordingSupplement.value) return '正在采集音频';
  return '';
});
const formattedSupplementDuration = computed(() => {
  const minutes = Math.floor(supplementRecordingSeconds.value / 60);
  const seconds = supplementRecordingSeconds.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

watch(
  () => props.request,
  (request) => {
    outpatientVisitsLoadSeq += 1;
    outpatientDetailLoadSeq += 1;
    isLoadingVisits.value = false;
    isDetailLoading.value = false;
    outpatientVisits.value = [];
    previewVisitRecord.value = null;
    showOutpatientPreview.value = false;
    showRegenerateDialog.value = false;
    selectedVisitId.value = request?.outpatientVisitId || null;
    if (request) {
      showWritebackQualityDialog.value = false;
      pendingQualityIssues.value = [];
      outpatientHistoryRangeKey.value = '7d';
      lastOutpatientVisitQueryKey.value = '';
      const isAdmission = isAdmissionTemplate(request.templateName || '');
      const generation = start(request);
      if (isAdmission) {
        void loadOutpatientVisits({ warnWhenMissingPatient: false });
      }
      void generation.then(() => {
        if (props.request !== request) return;
        if (isAdmission) {
          void loadOutpatientVisits({ warnWhenMissingPatient: true });
        }
      });
    } else {
      reset();
      showCancelConfirm.value = false;
      showWritebackQualityDialog.value = false;
    }
  },
  { immediate: true },
);

useConsultationReferenceFeedbackListener<InpatientEmrReferenceFeedbackPayload>({
  resolveConsultationId: () => result.value?.request.admissionId || props.request?.admissionId || '',
  isActive: () => Boolean(pendingWritebackRequestId.value),
  logContext: 'InpatientEmrPage',
  onFeedback: (payload) => {
    const status = applyReferenceFeedback(payload);
    if (status === 'success') {
      emit('completed');
    }
  },
});

function openRegenerateDialog(): void {
  const current = displayedRequest.value;
  if (!current || isGenerating.value || isWritingBack.value || writebackStatus.value === 'pending') return;
  supplementText.value = current.doctorSupplement || '';
  supplementError.value = '';
  showRegenerateDialog.value = true;
}

function closeRegenerateDialog(): void {
  if (isRecordingSupplement.value || isTranscribingSupplement.value) return;
  showRegenerateDialog.value = false;
  supplementError.value = '';
}

function handleCancelClick(): void {
  if (isGenerating.value || isWritingBack.value || writebackStatus.value === 'pending') return;
  showCancelConfirm.value = true;
}

function closeCancelConfirm(): void {
  showCancelConfirm.value = false;
}

async function confirmCancel(): Promise<void> {
  if (isGenerating.value || isWritingBack.value || writebackStatus.value === 'pending') return;
  showCancelConfirm.value = false;
  showRegenerateDialog.value = false;
  showOutpatientPreview.value = false;
  showWritebackQualityDialog.value = false;
  if (await abandon()) emit('cancel');
}

function appendSupplementPreset(preset: string): void {
  const text = supplementText.value.trim();
  const prefix = text ? '\n' : '';
  supplementText.value = `${text}${prefix}${preset}：`;
}

function appendSupplementText(text: string): void {
  const cleanText = text.trim();
  if (!cleanText) return;
  supplementText.value = supplementText.value.trim()
    ? `${supplementText.value.trim()}\n${cleanText}`
    : cleanText;
}

function clearSupplementText(): void {
  supplementText.value = '';
  supplementError.value = '';
}

function startSupplementTimer(): void {
  clearSupplementTimer();
  supplementRecordingSeconds.value = 0;
  const startedAt = Date.now();
  supplementTimerId = window.setInterval(() => {
    supplementRecordingSeconds.value = Math.floor((Date.now() - startedAt) / 1000);
  }, 250);
}

function clearSupplementTimer(): void {
  if (supplementTimerId != null) {
    window.clearInterval(supplementTimerId);
    supplementTimerId = null;
  }
}

function resetSupplementAudioLevels(): void {
  supplementAudioLevels.value = supplementAudioLevels.value.map(() => 6);
}

function startSupplementVisualizer(): void {
  clearSupplementVisualizer();
  const draw = (): void => {
    const data = audioRecorder.getByteFrequencyData();
    if (data) {
      const barCount = supplementAudioLevels.value.length;
      const step = Math.max(1, Math.floor(data.length / barCount));
      supplementAudioLevels.value = supplementAudioLevels.value.map((_, index) => {
        const value = data[index * step] || 0;
        return Math.max(6, Math.round((value / 255) * 34));
      });
    }
    supplementAnimationFrameId = window.requestAnimationFrame(draw);
  };
  draw();
}

function clearSupplementVisualizer(): void {
  if (supplementAnimationFrameId != null) {
    window.cancelAnimationFrame(supplementAnimationFrameId);
    supplementAnimationFrameId = null;
  }
  resetSupplementAudioLevels();
}

async function toggleSupplementRecording(): Promise<void> {
  supplementError.value = '';
  if (isRecordingSupplement.value) {
    await stopSupplementRecording();
    return;
  }
  try {
    await audioRecorder.start();
    isRecordingSupplement.value = true;
    startSupplementTimer();
    startSupplementVisualizer();
  } catch (error) {
    supplementError.value = `无法开始录音：${getMicrophoneErrorMessage(error)}`;
    clearSupplementTimer();
    clearSupplementVisualizer();
  }
}

async function stopSupplementRecording(): Promise<void> {
  try {
    clearSupplementTimer();
    clearSupplementVisualizer();
    const blob = await audioRecorder.stop();
    isRecordingSupplement.value = false;
    isTranscribingSupplement.value = true;
    const text = await transcribeSpeech(blob);
    if (!text.trim()) {
      supplementError.value = '未识别到有效语音内容，请重新录制或手动输入';
      return;
    }
    appendSupplementText(text);
  } catch (error) {
    supplementError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isRecordingSupplement.value = false;
    isTranscribingSupplement.value = false;
  }
}

async function discardSupplementRecording(): Promise<void> {
  if (!isRecordingSupplement.value) return;
  try {
    clearSupplementTimer();
    clearSupplementVisualizer();
    await audioRecorder.stop();
  } catch (error) {
    console.warn('[InpatientEmrPage] discard supplement recording failed', error);
  } finally {
    isRecordingSupplement.value = false;
    isTranscribingSupplement.value = false;
  }
}

function confirmRegenerate(): void {
  const doctorSupplement = supplementText.value.trim();
  showRegenerateDialog.value = false;
  regenerate({
    doctorSupplement: doctorSupplement || undefined,
    outpatientVisitId: selectedVisitId.value || undefined,
  });
}

function getFieldPrompt(field: InpatientEmrTemplateField): string {
  return buildInpatientEmrFieldPrompt(field, result.value?.context);
}

function handleWritebackClick(): void {
  if (!result.value || isGenerating.value || isWritingBack.value || writebackStatus.value === 'pending') return;
  // 暂时取消病历回写前的质控，直接回写
  void submitWriteback();
}

async function submitWriteback(): Promise<void> {
  const sent = await writeBack();
  if (sent) {
    showWritebackQualityDialog.value = false;
    pendingQualityIssues.value = [];
  }
}

async function confirmWritebackAfterQuality(): Promise<void> {
  await submitWriteback();
}

onBeforeUnmount(() => {
  void discardSupplementRecording();
});
</script>

<template>
  <section class="inpatient-emr-page workspace-page">
    <header class="emr-header workspace-header" data-tauri-drag-region>
      <div class="title-block workspace-title-group" data-tauri-drag-region>
        <span class="workspace-title-icon"><Icon icon="lucide:file-pen" :size="20" /></span>
        <div>
          <h1 class="workspace-title">AI 住院病历生成</h1>
          <p class="workspace-subtitle">{{ displayedRequest?.templateName || '等待 HIS 传入住院病历模板' }}<span v-if="displayedRequest?.recordTime"> · {{ displayedRequest.recordTime }}</span></p>
        </div>
      </div>
      <button class="workspace-button is-icon" type="button" title="收起，保留当前病历" aria-label="收起，保留当前病历" @click="emit('close')">
        <Icon icon="lucide:chevron-down" :size="18" />
      </button>
    </header>

    <main class="emr-main" :class="{ 'has-request': request }">
      <aside v-if="request || inpatientLogUpload.error || inpatientLogUpload.pending" class="generation-sidebar" aria-label="生成提示与依据">
        <div v-if="inpatientLogUpload.error || inpatientLogUpload.pending" class="inpatient-log-notice" role="status">
          <span>{{ inpatientLogUpload.error || `住院日志待补传 ${inpatientLogUpload.pending} 条` }}</span>
          <button v-if="!inpatientLogUpload.unrecorded || inpatientLogUpload.pending" type="button" :disabled="inpatientLogUpload.uploading" @click="retryInpatientLogs">{{ inpatientLogUpload.uploading ? '补传中…' : '重试补传' }}</button>
        </div>
        <div v-if="errorMessage" class="error-banner" role="alert">
          <Icon icon="lucide:triangle-alert" :size="18" />
          <span>{{ errorMessage }}</span>
        </div>

        <template v-if="request">
          <section class="generation-summary" :data-tone="generationPresentation.tone" role="status" aria-live="polite">
            <span class="summary-icon"><Icon :icon="generationPresentation.icon" :size="20" :class="{ spinning: isGenerating || isWritingBack }" /></span>
            <div class="summary-copy">
              <strong>{{ generationPresentation.title }}</strong>
              <span>{{ generationPresentation.detail }}</span>
              <span v-if="isGenerating" class="step-count">第 {{ Math.min(completedStepCount + 1, steps.length) }}/{{ steps.length }} 步</span>
              <span v-else-if="result" class="field-count">已填写 {{ filledFieldCount }}/{{ aiFields.length }} 项</span>
            </div>
          </section>

          <InpatientEmrProcessPanel
            :steps="steps"
            :completed-step-count="completedStepCount"
            :summary="result?.evidenceSummary"
            :trace="result?.trace"
          />
          <details v-if="result" class="field-panel">
            <summary>生成字段说明 · {{ visibleAiFields.length }} 项</summary>
            <div class="field-list">
              <article v-for="field in visibleAiFields" :key="field.id" class="field-prompt-card">
                <strong>{{ field.name || field.id }}</strong>
                <p>{{ field.meaning }}</p>
                <details class="field-prompt-detail">
                  <summary>查看字段 ID 与提示词</summary>
                  <code>{{ field.id }}</code>
                  <pre>{{ getFieldPrompt(field) }}</pre>
                </details>
              </article>
            </div>
            <p v-if="visibleAiFields.length === 0" class="no-ai-fields">当前模板没有可展示的 AI 生成字段</p>
          </details>
        </template>
      </aside>

      <section v-if="displayedRequest" class="record-pane" aria-label="病历">
        <InpatientEmrTemplatePreview
          :key="displayedRequest.requestId || displayedRequest.admissionId"
          :html-content="displayedRequest.htmlContent"
          :fields="result?.template.fields ?? []"
          :field-values="result?.fieldValues ?? {}"
          :initial-field-values="result?.initialFieldValues ?? {}"
          :editable="previewEditable"
          :is-generating="isGenerating"
          @update-field="updateFieldValue"
        />
      </section>
      <section v-else class="empty-panel">
        <Icon icon="lucide:file-plus-2" :size="28" />
        <strong>等待住院病历生成请求</strong>
        <span>请从 HIS 打开需要辅助书写的住院病历</span>
      </section>
    </main>

    <footer v-if="request" class="emr-footer workspace-footer">
      <button class="workspace-button is-danger" type="button" :disabled="actionDisabled" title="放弃本次生成" @click="handleCancelClick">
        <Icon icon="lucide:trash-2" :size="16" /><span>放弃</span>
      </button>
      <div class="footer-actions workspace-actions">
        <span v-if="writebackMessage" class="writeback-status" :class="`is-${writebackStatus}`" role="status" aria-live="polite">{{ writebackMessage }}</span>
        <button class="workspace-button" type="button" :disabled="actionDisabled" title="补充要点并重新生成" @click="openRegenerateDialog">
          <Icon icon="lucide:refresh-cw" :size="16" /><span>补充要点并重新生成</span>
        </button>
        <button class="workspace-button is-primary" type="button" :disabled="!result || actionDisabled || writebackStatus === 'success'" title="一键回写" @click="handleWritebackClick">
          <Icon icon="lucide:send-horizontal" :size="16" /><span>{{ primaryActionLabel }}</span>
        </button>
      </div>
    </footer>

    <div
      v-if="showRegenerateDialog"
      class="regenerate-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="补充病历要点"
    >
      <section class="regenerate-dialog">
        <header class="regenerate-head">
          <div>
            <span>补充要点并重新生成</span>
            <strong>补充病历要点</strong>
          </div>
          <button
            class="workspace-button is-icon"
            type="button"
            title="关闭"
            aria-label="关闭"
            @click="closeRegenerateDialog"
          >
            <Icon icon="lucide:x" :size="18" />
          </button>
        </header>

        <!-- 门诊历史引用区域 -->
        <div v-if="isAdmission" class="outpatient-reference-section">
          <div class="section-title-row">
            <Icon icon="lucide:history" :size="15" />
            <span>引用历史门诊病历（推荐选择一次门诊就诊作为入院记录基础）</span>
            <span v-if="isLoadingVisits" class="loading-visits-text">
              <Icon icon="lucide:loader-2" :size="12" class="spinning" />
              加载中…
            </span>
          </div>
          <div class="history-range-row" aria-label="门诊就诊时间范围">
            <button
              v-for="option in outpatientHistoryRangeOptions"
              :key="option.key"
              type="button"
              class="range-option-btn"
              :class="{ 'is-active': outpatientHistoryRangeKey === option.key }"
              :disabled="isLoadingVisits"
              @click="setOutpatientHistoryRange(option.key)"
            >
              {{ option.label }}
            </button>
            <span class="range-text">{{ outpatientHistoryRangeText }}</span>
          </div>

          <div v-if="selectedVisitOutsideList" class="selected-reference">
            <span>已引用门诊就诊 {{ selectedVisitId }}</span>
            <button class="action-btn" type="button" @click="selectedVisitId = null">取消引用</button>
          </div>
          <div class="visits-card-list" v-if="outpatientVisits.length > 0">
            <div
              v-for="visit in outpatientVisits"
              :key="visit.visitId"
              class="visit-ref-card"
              :class="{ 'is-selected': selectedVisitId === visit.visitId }"
            >
              <button type="button" class="visit-card-main" :aria-pressed="selectedVisitId === visit.visitId" @click="selectVisit(visit.visitId)">
                <div class="visit-meta">
                  <span class="dept-badge">{{ visit.deptName || '门诊' }}</span>
                  <span class="visit-date">{{ visit.visitDate.split(' ')[0] }}</span>
                </div>
                <div class="visit-diagnoses" :title="visit.diagnoses?.join(', ')">
                  主诊断：{{ visit.diagnoses?.join(', ') || '无明确诊断' }}
                </div>
                <div class="visit-record-meta">
                  病历文书 {{ visit.medicalRecordDocumentCount || 1 }} 份
                </div>
              </button>
              <div class="visit-card-actions">
                <button
                  type="button"
                  class="action-btn view-btn"
                  @click="viewOutpatientDetail(visit.visitId)"
                >
                  <Icon icon="lucide:eye" :size="13" />
                  <span>查看</span>
                </button>
                <button
                  type="button"
                  class="action-btn select-btn"
                  :class="{ 'is-active': selectedVisitId === visit.visitId }"
                  :aria-pressed="selectedVisitId === visit.visitId"
                  @click="selectVisit(visit.visitId)"
                >
                  <Icon :icon="selectedVisitId === visit.visitId ? 'lucide:check-circle-2' : 'lucide:plus-circle'" :size="13" />
                  <span>{{ selectedVisitId === visit.visitId ? '取消引用' : '以此为基准' }}</span>
                </button>
              </div>
            </div>
          </div>
          <div class="no-visits-placeholder" v-else-if="!isLoadingVisits">
            <Icon icon="lucide:info" :size="13" />
            <span>{{ outpatientVisitEmptyText }}</span>
          </div>
        </div>

        <div class="supplement-presets">
          <button
            v-for="preset in supplementPresets"
            :key="preset"
            type="button"
            @click="appendSupplementPreset(preset)"
          >
            {{ preset }}
          </button>
        </div>

        <textarea
          v-model="supplementText"
          class="supplement-input"
          name="doctorSupplement"
          aria-label="补充病历要点"
          rows="8"
          placeholder="例如：今日患者咳嗽较前减轻，无胸闷气促；查体双肺呼吸音稍粗，未闻及明显湿啰音；继续当前抗感染及雾化治疗，复查血常规。"
        ></textarea>

        <div class="voice-row">
          <button
            class="voice-btn"
            type="button"
            :class="{ 'is-recording': isRecordingSupplement }"
            :disabled="isTranscribingSupplement || isGenerating"
            @click="toggleSupplementRecording"
          >
            <Icon
              :icon="isRecordingSupplement ? 'lucide:square' : 'lucide:mic'"
              :size="16"
            />
            <span>{{ supplementVoiceButtonText }}</span>
          </button>
          <button
            class="clear-supplement-btn"
            type="button"
            :disabled="!supplementText.trim() || isRecordingSupplement || isTranscribingSupplement"
            @click="clearSupplementText"
          >
            清空补充
          </button>
          <span v-if="supplementVoiceStatus" class="voice-status">
            {{ supplementVoiceStatus }}
          </span>
        </div>

        <div
          v-if="isRecordingSupplement || isTranscribingSupplement"
          class="capture-visualizer"
          :class="{ 'is-transcribing': isTranscribingSupplement }"
        >
          <div class="recording-dot"></div>
          <div class="meter-bars" aria-hidden="true">
            <span
              v-for="(level, index) in supplementAudioLevels"
              :key="index"
              :style="{ height: `${level}px`, opacity: String(0.36 + (level / 34) * 0.64) }"
            ></span>
          </div>
          <strong>{{ isRecordingSupplement ? formattedSupplementDuration : '识别中' }}</strong>
        </div>

        <div v-if="supplementError" class="supplement-error">
          <Icon icon="lucide:triangle-alert" :size="15" />
          <span>{{ supplementError }}</span>
        </div>

        <footer class="regenerate-footer">
          <button
            class="workspace-button"
            type="button"
            :disabled="isRecordingSupplement || isTranscribingSupplement"
            @click="closeRegenerateDialog"
          >
            取消
          </button>
          <button
            class="workspace-button is-primary"
            type="button"
            :disabled="isRecordingSupplement || isTranscribingSupplement || isGenerating"
            @click="confirmRegenerate"
          >
            <Icon icon="lucide:sparkles" :size="16" />
            <span>{{ supplementText.trim() ? '带补充重新生成' : '直接重新生成' }}</span>
          </button>
        </footer>
      </section>
    </div>

    <div
      v-if="showCancelConfirm"
      class="regenerate-overlay cancel-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inpatient-emr-cancel-title"
    >
      <section class="cancel-dialog">
        <div class="cancel-dialog-body">
          <div class="cancel-icon">
            <Icon icon="lucide:triangle-alert" :size="20" />
          </div>
          <div>
            <strong id="inpatient-emr-cancel-title">确认放弃本次住院病历生成？</strong>
            <p>放弃后将清空当前未回写的病历草稿、编辑内容和生成过程，窗口会退回小球状态。</p>
          </div>
        </div>
        <footer class="cancel-dialog-actions">
          <button class="workspace-button" type="button" @click="closeCancelConfirm">继续编辑</button>
          <button class="workspace-button danger-btn" type="button" @click="confirmCancel">确认放弃</button>
        </footer>
      </section>
    </div>

    <!-- 门诊病历详情预览模态框 -->
    <div
      v-if="showOutpatientPreview"
      class="outpatient-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="门诊病历预览"
    >
      <section class="outpatient-preview-dialog">
        <header class="preview-head">
          <span>门诊病历详情预览</span>
          <button
            class="workspace-button is-icon"
            type="button"
            title="关闭"
            aria-label="关闭"
            @click="showOutpatientPreview = false"
          >
            <Icon icon="lucide:x" :size="18" />
          </button>
        </header>
        <div class="preview-content">
          <div v-if="isDetailLoading" class="preview-loading">
            <Icon icon="lucide:loader-2" :size="24" class="spinning" />
            <span>正在拉取门诊病历…</span>
          </div>
          <div
            v-else-if="previewVisitRecord"
            class="preview-html-container"
            v-html="safePreviewVisitHtml"
          ></div>
          <div v-else class="preview-error">
            <Icon icon="lucide:triangle-alert" :size="20" />
            <span>拉取门诊病历失败</span>
          </div>
        </div>
        <footer class="preview-footer">
          <button
            class="workspace-button"
            type="button"
            @click="showOutpatientPreview = false"
          >
            关闭预览
          </button>
          <button
            v-if="previewVisitRecord"
            class="workspace-button is-primary"
            type="button"
            :disabled="selectedVisitId === previewVisitRecord.visitId"
            @click="selectVisitAndClosePreview(previewVisitRecord.visitId)"
          >
            <Icon icon="lucide:check" :size="16" />
            <span>引用此病历为基准</span>
          </button>
        </footer>
      </section>
    </div>

    <InpatientEmrWritebackQualityDialog
      v-if="showWritebackQualityDialog && pendingQualityIssues.length > 0"
      :issues="pendingQualityIssues"
      :is-writing-back="isWritingBack"
      :writeback-status="writebackStatus"
      :writeback-message="writebackMessage"
      @cancel="showWritebackQualityDialog = false"
      @confirm="confirmWritebackAfterQuality"
    />
  </section>
</template>



<style scoped>
.inpatient-emr-page { position: relative; font-size: 14px; }
.footer-actions { justify-content: flex-end; }
.inpatient-emr-page button { font: inherit; }
.inpatient-emr-page button:focus-visible,
.inpatient-emr-page summary:focus-visible { outline: 2px solid var(--workspace-primary); outline-offset: 3px; }
.emr-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 16px 20px;
  gap: 16px;
  overflow: auto;
}
.emr-main.has-request {
  display: grid;
  grid-template-columns: clamp(248px, 28%, 360px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}
.generation-sidebar, .record-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.generation-sidebar { gap: 12px; }
.generation-sidebar > * { flex-shrink: 0; }
.generation-summary { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border: 1px solid #dce5ef; border-radius: 12px; background: #fff; }
.generation-summary[data-tone='working'] { border-color: #bfdbfe; background: #eff6ff; }
.generation-summary[data-tone='ready'] { border-color: #bbf7d0; background: #f0fdf4; }
.generation-summary[data-tone='error'] { border-color: #fecaca; background: #fff7f7; }
.summary-icon { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border-radius: 9px; color: #2563eb; background: #dbeafe; }
.generation-summary[data-tone='ready'] .summary-icon { color: #15803d; background: #dcfce7; }
.generation-summary[data-tone='error'] .summary-icon { color: #b91c1c; background: #fee2e2; }
.summary-copy { display: grid; min-width: 0; flex: 1; gap: 4px; }
.summary-copy strong { font-size: 14px; }
.summary-copy > span { color: #64748b; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.step-count, .field-count { flex-shrink: 0; color: #64748b; font-size: 12px; line-height: 1.6; }
.field-panel { padding: 12px 14px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; color: #475569; font-size: 13px; }
.field-panel summary { cursor: pointer; }
.field-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 10px; margin-top: 12px; }
.field-prompt-card { min-width: 0; padding: 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.field-prompt-card p { margin: 6px 0; font-size: 12px; line-height: 1.6; }
.field-prompt-detail { color: #64748b; font-size: 12px; }
.field-prompt-detail code { display: block; margin-top: 8px; overflow-wrap: anywhere; }
.field-prompt-detail pre { max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.no-ai-fields { color: #64748b; }
.empty-panel { display: grid; flex: 1; min-height: 260px; gap: 10px; place-content: center; justify-items: center; padding: 24px; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; background: #fff; text-align: center; }
.empty-panel span { font-size: 13px; }
.error-banner { display: flex; gap: 8px; align-items: flex-start; padding: 12px 14px; border: 1px solid #fecaca; border-radius: 8px; color: #b91c1c; background: #fef2f2; font-size: 13px; overflow-wrap: anywhere; }
.writeback-status { max-width: 360px; color: #64748b; font-size: 12px; line-height: 1.6; text-align: right; overflow-wrap: anywhere; }
.writeback-status.is-pending { color: #1d4ed8; }
.writeback-status.is-success { color: #15803d; }
.writeback-status.is-error { color: #b91c1c; }

.regenerate-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 31, 37, 0.28);
  backdrop-filter: blur(7px);
}

.regenerate-dialog {
  box-sizing: border-box;
  width: min(640px, 100%);
  max-height: 100%;
  overflow: auto;
  overscroll-behavior: contain;
  display: grid;
  gap: 14px;
  border-radius: 12px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(101, 125, 134, 0.22);
  box-shadow: 0 26px 70px rgba(12, 28, 34, 0.22);
}

.cancel-overlay {
  z-index: 26;
}

.cancel-dialog {
  box-sizing: border-box;
  width: min(420px, 100%);
  max-height: 100%;
  overflow: auto;
  display: grid;
  gap: 18px;
  border-radius: 8px;
  padding: 18px;
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(180, 61, 46, 0.18);
  box-shadow: 0 26px 70px rgba(12, 28, 34, 0.22);
}

.cancel-dialog-body {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
  align-items: start;
}

.cancel-icon {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  color: #b43d2e;
  background: #fff1ee;
}

.cancel-dialog-body strong {
  display: block;
  color: #172033;
  font-size: 16px;
  line-height: 1.4;
}

.cancel-dialog-body p {
  margin: 6px 0 0;
  color: #64748b;
  font-size: 13px;
  line-height: 1.6;
}

.cancel-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.workspace-button.danger-btn { color: #fff; background: #b91c1c; border-color: #b91c1c; }
.workspace-button.danger-btn:hover { background: #991b1b; border-color: #991b1b; }

.regenerate-head,
.voice-row,
.regenerate-footer,
.supplement-error {
  display: flex;
  align-items: center;
}

.regenerate-head {
  justify-content: space-between;
  gap: 12px;
}

.regenerate-head div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.regenerate-head span {
  color: #2563eb;
  font-size: 12px;
  font-weight: 800;
}

.regenerate-head strong {
  color: #172033;
  font-size: 18px;
}

.supplement-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.supplement-presets button {
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  color: #1d4ed8;
  background: #eff6ff;
  border: 1px solid rgba(37, 99, 235, 0.18);
  cursor: pointer;
  font-size: 12px;
  font-weight: 800;
}

.supplement-presets button:hover {
  background: #dbeafe;
}

.supplement-input {
  width: 100%;
  min-height: 168px;
  resize: vertical;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid rgba(102, 124, 133, 0.28);
  background: #fbfcfc;
  color: #172033;
  font: inherit;
  line-height: 1.6;
}

.supplement-input:focus {
  border-color: rgba(37, 99, 235, 0.62);
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.11);
}

.voice-row {
  gap: 10px;
  min-height: 32px;
  flex-wrap: wrap;
}

.voice-btn,
.clear-supplement-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 11px;
  border-radius: 7px;
  color: #334155;
  background: #ffffff;
  border: 1px solid rgba(99, 121, 129, 0.24);
  cursor: pointer;
}

.voice-btn.is-recording {
  color: #b43d2e;
  background: #fff1ee;
  border-color: rgba(180, 61, 46, 0.26);
}

.voice-btn:disabled {
  opacity: 1 !important;
  color: #334650 !important;
  background: #e8eef0 !important;
  border-color: rgba(72, 91, 99, 0.28) !important;
  cursor: not-allowed;
}

.clear-supplement-btn {
  color: #64748b;
  background: #f5f8f9;
}

.clear-supplement-btn:disabled {
  opacity: 1 !important;
  color: #3e5058 !important;
  background: #e8eef0 !important;
  cursor: not-allowed;
}

.voice-status {
  color: #65777f;
  font-size: 12px;
}

.capture-visualizer {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-height: 42px;
  padding: 9px 11px;
  border-radius: 8px;
  background: #eff6ff;
  border: 1px solid rgba(37, 99, 235, 0.16);
}

.recording-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: #e24b3b;
  box-shadow: 0 0 0 0 rgba(226, 75, 59, 0.34);
  animation: recordPulse 1.2s ease-in-out infinite;
}

.capture-visualizer.is-transcribing .recording-dot {
  background: #1976c9;
  animation: pulse 1.4s ease-in-out infinite;
}

.meter-bars {
  height: 34px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.meter-bars span {
  width: 4px;
  min-width: 4px;
  border-radius: 999px;
  background: linear-gradient(180deg, #2563eb, #93c5fd);
  transition: height 0.08s ease, opacity 0.08s ease;
}

.capture-visualizer.is-transcribing .meter-bars span {
  height: 12px !important;
  opacity: 0.4 !important;
  animation: transcribingBars 1s ease-in-out infinite;
}

.capture-visualizer.is-transcribing .meter-bars span:nth-child(2n) {
  animation-delay: 0.12s;
}

.capture-visualizer.is-transcribing .meter-bars span:nth-child(3n) {
  animation-delay: 0.24s;
}

.capture-visualizer strong {
  color: #334155;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.supplement-error {
  gap: 7px;
  padding: 9px 10px;
  border-radius: 7px;
  color: #a94d22;
  background: #fff3ed;
  border: 1px solid rgba(217, 118, 67, 0.24);
  font-size: 12px;
}

.regenerate-footer {
  justify-content: flex-end;
  gap: 8px;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}





@keyframes recordPulse {
  0%, 100% {
    transform: scale(0.92);
    box-shadow: 0 0 0 0 rgba(226, 75, 59, 0.34);
  }
  50% {
    transform: scale(1.08);
    box-shadow: 0 0 0 6px rgba(226, 75, 59, 0);
  }
}

@keyframes transcribingBars {
  0%, 100% { transform: scaleY(0.7); }
  50% { transform: scaleY(1.35); }
}

/* 门诊历史引用区域样式 */
.outpatient-reference-section {
  margin-bottom: 16px;
  padding: 14px;
  background: #f8fafc;
  border: 1px dashed rgba(37, 99, 235, 0.3);
  border-radius: 8px;
}

.selected-reference {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.section-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 12px;
  font-size: 13px;
  font-weight: 700;
  color: #172033;
}

.loading-visits-text {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #2563eb;
  font-weight: normal;
}

.history-range-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: -2px 0 10px;
  min-height: 28px;
}

.range-option-btn {
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(119, 135, 143, 0.22);
  background: rgba(255, 255, 255, 0.82);
  color: #48606a;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.range-option-btn:hover:not(:disabled) {
  border-color: rgba(37, 99, 235, 0.44);
  color: #1d4ed8;
  background: #eff6ff;
}

.range-option-btn.is-active {
  color: #ffffff;
  border-color: #2563eb;
  background: #2563eb;
}

.range-option-btn:disabled {
  cursor: not-allowed;
  color: #526871;
  background: #e8eef0;
  border-color: rgba(72, 91, 99, 0.2);
}

.range-text {
  margin-left: auto;
  color: #7b8f97;
  font-size: 11px;
  white-space: nowrap;
}

.visits-card-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.visit-ref-card {
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid rgba(121, 145, 153, 0.2);
  border-radius: 7px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
}

.visit-ref-card:hover {
  border-color: rgba(37, 99, 235, 0.5);
  box-shadow: 0 6px 14px rgba(37, 99, 235, 0.08);
}

.visit-ref-card.is-selected {
  border-color: #2563eb;
  background: #eff6ff;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.12);
}

.visit-card-main {
  border: 0;
  text-align: left;
  color: inherit;
  background: transparent;
  cursor: pointer;
  flex: 1;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.visit-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
}

.dept-badge {
  padding: 2px 6px;
  border-radius: 4px;
  background: #dbeafe;
  color: #2563eb;
  font-size: 11px;
  font-weight: 700;
}

.visit-date {
  font-size: 11px;
  color: #8a9ba3;
}

.visit-diagnoses {
  font-size: 12px;
  font-weight: 700;
  color: #2c3e50;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.visit-record-meta {
  color: #71838b;
  font-size: 11px;
}

.visit-card-actions {
  display: grid;
  grid-template-columns: 1fr 1.2fr;
  border-top: 1px solid rgba(121, 145, 153, 0.12);
  background: #fafbfc;
}

.visit-ref-card.is-selected .visit-card-actions {
  background: rgba(37, 99, 235, 0.03);
}

.action-btn {
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  background: transparent;
  transition: background 0.15s ease, color 0.15s ease;
  border: none;
}

.action-btn:disabled {
  opacity: 1 !important;
  color: #334650 !important;
  background: #e8eef0 !important;
  cursor: not-allowed;
}

.view-btn {
  color: #475569;
  border-right: 1px solid rgba(121, 145, 153, 0.12);
}

.view-btn:hover {
  background: rgba(0, 0, 0, 0.03);
  color: #0f172a;
}

.select-btn {
  color: #2563eb;
}

.select-btn:hover {
  background: rgba(37, 99, 235, 0.06);
}

.select-btn.is-active {
  background: #2563eb;
  color: #ffffff;
  font-weight: bold;
}

.no-visits-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  font-size: 12px;
  color: #64748b;
}

/* 门诊预览弹层样式 */
.outpatient-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
  animation: fadeIn 0.22s ease-out;
}

.outpatient-preview-dialog {
  box-sizing: border-box;
  width: min(920px, 100%);
  max-width: 920px;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.85);
  overflow: hidden;
  animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.preview-head {
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.preview-head span {
  font-size: 15px;
  font-weight: 800;
  color: #0f172a;
}

.preview-content {
  flex: 1;
  min-height: 0;
  overscroll-behavior: contain;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px;
  background: #f1f5f9;
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 260px;
  color: #64748b;
}

.preview-html-container {
  min-width: 0;
  max-width: 100%;
  overflow-x: hidden;
  background: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  border: 1px solid #e2e8f0;
  padding: 10px;
}

.preview-html-container :deep(*) {
  max-width: 100% !important;
  box-sizing: border-box;
}

.preview-html-container :deep(table) {
  width: 100% !important;
  table-layout: fixed;
}

.preview-html-container :deep(td),
.preview-html-container :deep(th),
.preview-html-container :deep(div),
.preview-html-container :deep(p),
.preview-html-container :deep(span) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.preview-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 260px;
  color: #ef4444;
}

.preview-footer {
  padding: 14px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
}

/* 动画定义 */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(16px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>

<style scoped>
.inpatient-log-notice { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border: 1px solid #f3dcae; border-radius: 8px; background: #fff4dc; color: #725513; font-size: 12px; }
.inpatient-log-notice button { flex-shrink: 0; padding: 4px 10px; border: 1px solid currentColor; border-radius: 4px; color: inherit; background: transparent; cursor: pointer; }

@media (prefers-reduced-motion: reduce) {
  .spinning, .recording-dot, .capture-visualizer .meter-bars span, .outpatient-preview-overlay, .outpatient-preview-dialog { animation: none; }
  .visit-ref-card, .meter-bars span { transition: none; }
}
@container workspace-page (max-width: 720px) {
  .emr-main { padding: 12px 14px; }
  .emr-main.has-request { display: flex; }
  .generation-sidebar, .record-pane { flex: 0 0 auto; overflow: visible; }
  .footer-actions { flex: 1; }
  .footer-actions .writeback-status { flex-basis: 100%; max-width: none; }
  .history-range-row, .section-title-row { flex-wrap: wrap; }
  .history-range-row .range-text { width: 100%; margin-left: 0; white-space: normal; }
  .visits-card-list { grid-template-columns: 1fr; }
  .regenerate-overlay, .outpatient-preview-overlay { padding: 14px; }
}
</style>
