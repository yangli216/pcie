import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { generateInpatientEmrPreviewStream } from '../api/inpatientEmrService';
import { createInpatientLogSession, type InpatientLogSession } from '../api/inpatientEmrLog';
import { retryInpatientLogs, reportInpatientLogFailure } from '../api/inpatientEmrLogOutbox';
import {
  cloneInpatientEmrTrace,
  createInpatientEmrTrace,
  finishInpatientEmrTrace,
  finishInpatientEmrTraceStage,
  startInpatientEmrTraceStage,
} from '../lib/inpatientEmrObservability';
import {
  recordInpatientEmrFailureTraceLog,
  recordInpatientEmrTraceLog,
} from './inpatientEmrTraceLog';
import type {
  InpatientEmrGenerationProgress,
  InpatientEmrGenerationRequest,
  InpatientEmrGenerationResult,
  InpatientEmrGenerationStep,
  InpatientEmrStepKey,
} from '../types';

export interface InpatientEmrReferenceFeedbackPayload {
  consultationId?: string;
  requestId?: string;
  status?: 'pending' | 'success' | 'failed';
  message?: string;
}

const STEP_DEFINITIONS: Array<Pick<InpatientEmrGenerationStep, 'key' | 'title' | 'description'>> = [
  { key: 'patient', title: '获取住院上下文', description: '获取本次文书所需 HIS 数据' },
  { key: 'orders', title: '整理诊疗摘要', description: '汇总诊断、医嘱、检验检查和治疗信息' },
  { key: 'temperature', title: '整理病历依据', description: '核对生命体征、历史病历、会诊和手术资料' },
  { key: 'template', title: '解析病历', description: '识别 data-id 字段和生成规则' },
  { key: 'generate', title: 'AI 生成', description: '按字段规则生成医生审核草稿' },
];

function createInitialSteps(): InpatientEmrGenerationStep[] {
  return STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: 'pending',
    detail: '等待处理',
  }));
}

function getRequestId(request: InpatientEmrGenerationRequest): string {
  return request.requestId || `inpatient-emr-${Date.now()}`;
}

function buildEmrContent(result: InpatientEmrGenerationResult, values: Record<string, string>): string {
  const aiFields = result.template.fields.filter((field) => field.aiSuitable);
  const progressText = values.病程记录文本;
  if (progressText?.trim()) return progressText.trim();
  return aiFields
    .map((field) => values[field.id])
    .filter((value) => value?.trim())
    .join('\n\n');
}

function pickAiGeneratedFieldValues(result: InpatientEmrGenerationResult): Record<string, string> {
  const fieldIds = new Set(
    result.template.fields
      .filter((field) => field.aiSuitable)
      .map((field) => field.id),
  );
  const values: Record<string, string> = {};
  Object.entries(result.fieldValues).forEach(([fieldId, value]) => {
    if (fieldIds.has(fieldId)) {
      values[fieldId] = value;
    }
  });
  return values;
}

export function useInpatientEmrGeneration() {
  const steps = ref<InpatientEmrGenerationStep[]>(createInitialSteps());
  const currentRequest = ref<InpatientEmrGenerationRequest | null>(null);
  const result = ref<InpatientEmrGenerationResult | null>(null);
  const errorMessage = ref('');
  const isGenerating = ref(false);
  const isWritingBack = ref(false);
  const writebackMessage = ref('');
  const writebackStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle');
  const pendingWritebackRequestId = ref('');
  const dispatchedRequestIds = new Set<string>();
  let requestSequence = 0;
  let logSession: InpatientLogSession | null = null;
  let pendingSnapshot: InpatientEmrGenerationResult | null = null;
  void retryInpatientLogs();

  const activeStepKey = computed<InpatientEmrStepKey | null>(() => {
    return steps.value.find((step) => step.status === 'running')?.key || null;
  });

  const completedStepCount = computed(() => steps.value.filter((step) => step.status === 'done').length);

  function resetSteps(): void {
    steps.value = createInitialSteps();
  }

  function reset(): void {
    if (logSession && !logSession.terminal && !pendingWritebackRequestId.value)
      void logSession.record('superseded', result.value, undefined, result.value?.fieldValues);
    requestSequence++;
    logSession = null;
    pendingSnapshot = null;
    currentRequest.value = null;
    result.value = null;
    errorMessage.value = '';
    writebackMessage.value = '';
    writebackStatus.value = 'idle';
    pendingWritebackRequestId.value = '';
    isGenerating.value = false;
    isWritingBack.value = false;
    resetSteps();
  }

  function updateStep(progress: InpatientEmrGenerationProgress): void {
    steps.value = steps.value.map((step) => (
      step.key === progress.key
        ? { ...step, status: progress.status, detail: progress.detail || step.detail }
        : step
    ));
  }

  async function start(request: InpatientEmrGenerationRequest): Promise<void> {
    if (pendingWritebackRequestId.value && currentRequest.value?.admissionId === request.admissionId) {
      errorMessage.value = '正在等待HIS回执，请先处理当前回填请求';
      return;
    }
    if (logSession && !logSession.terminal && !pendingWritebackRequestId.value)
      void logSession.record('superseded', result.value, undefined, result.value?.fieldValues);
    const token = ++requestSequence;
    currentRequest.value = request;
    result.value = null;
    pendingSnapshot = null;
    logSession = null;
    errorMessage.value = '';
    writebackMessage.value = '';
    writebackStatus.value = 'idle';
    pendingWritebackRequestId.value = '';
    isGenerating.value = true;
    isWritingBack.value = false;
    resetSteps();
    const generationTrace = createInpatientEmrTrace(request.requestId);
    let session: InpatientLogSession | null = null;
    try {
      session = await createInpatientLogSession(request);
      if (token !== requestSequence) {
        await session.record('started');
        await session.record('superseded');
        return;
      }
      logSession = session;
      await session.record('started');
    } catch { reportInpatientLogFailure(); }
    if (token !== requestSequence) return;
    try {
      const generated = await generateInpatientEmrPreviewStream(request, progress => {
        if (token === requestSequence) updateStep(progress);
      }, partial => {
        if (token === requestSequence) result.value = partial;
      }, generationTrace);
      if (token !== requestSequence) return;
      result.value = generated;
      const status = generated.evidenceSummary.aiGeneration.status;
      void session?.record(status === 'waiting' ? 'waiting' : status === 'failed' ? 'fallback' : 'generated', generated);
      void recordInpatientEmrTraceLog(generated, 'generation');
    } catch (error) {
      if (token !== requestSequence) return;
      errorMessage.value = error instanceof Error ? error.message : String(error);
      finishInpatientEmrTrace(generationTrace);
      const runningStep = steps.value.find(step => step.status === 'running');
      updateStep({ key: runningStep?.key || 'generate', status: 'error', detail: errorMessage.value });
      void session?.record('generation_failed', result.value, '住院病历生成失败');
      void recordInpatientEmrFailureTraceLog(request, generationTrace, 'generation', errorMessage.value);
    } finally {
      if (token === requestSequence) isGenerating.value = false;
    }
  }

  async function abandon(): Promise<boolean> {
    if (isGenerating.value || isWritingBack.value || pendingWritebackRequestId.value) return false;
    await logSession?.record('abandoned', result.value, undefined, result.value?.fieldValues);
    reset();
    return true;
  }

  function updateFieldValue(fieldId: string, content: string): void {
    if (!result.value) return;
    const fieldValues = {
      ...result.value.fieldValues,
      [fieldId]: content,
    };
    result.value.fieldValues = fieldValues;
    result.value.emrContent = buildEmrContent(result.value, fieldValues);
  }

  function syncResultTrace(): void {
    if (!result.value) return;
    result.value.trace = cloneInpatientEmrTrace(result.value.trace);
  }

  async function writeBack(): Promise<boolean> {
    if (!result.value || isGenerating.value || isWritingBack.value || pendingWritebackRequestId.value || logSession?.terminal) return false;
    const token = requestSequence;
    const session = logSession;
    const currentResult = result.value;
    isWritingBack.value = true;
    writebackStatus.value = 'pending';
    writebackMessage.value = '正在发送回写事件，等待 HIS 侧保存并回执';

    const baseRequest = currentResult.request;
    const previousRequestId = getRequestId(baseRequest);
    const requestId = dispatchedRequestIds.has(previousRequestId) ? crypto.randomUUID() : previousRequestId;
    currentResult.request = {
      ...baseRequest,
      requestId,
    };
    const request = currentResult.request;
    pendingWritebackRequestId.value = requestId;
    startInpatientEmrTraceStage(currentResult.trace, 'writebackDispatch', '正在发送回写事件', {
      requestId,
      admissionId: request.admissionId,
    });
    syncResultTrace();
    const fieldValues = pickAiGeneratedFieldValues(currentResult);
    pendingSnapshot = { ...currentResult, request: { ...request }, fieldValues: { ...currentResult.fieldValues }, initialFieldValues: { ...currentResult.initialFieldValues } };
    const frozenSnapshot = pendingSnapshot;
    await session?.record('writeback_requested', frozenSnapshot, undefined, frozenSnapshot.fieldValues);
    const payload = {
      status: 'success',
      consultationId: request.admissionId,
      timestamp: Date.now(),
      resultType: 'record-confirmed',
      requestId,
      referenceType: 'batch',
      action: 'batch',
      referenceStatus: 'pending',
      referenceMessage: '等待 HIS 完成住院病历回填并回执。',
      emrType: 'inpatient-emr',
      admissionId: request.admissionId,
      templateName: request.templateName || '',
      fieldValues,
      sourceModule: 'inpatient-emr',
    };

    if (token !== requestSequence) return false;
    try {
      await invoke('complete_consultation', { result: payload });
      dispatchedRequestIds.add(requestId);
      if (token !== requestSequence || pendingWritebackRequestId.value !== requestId) return true;
      finishInpatientEmrTraceStage(currentResult.trace, 'writebackDispatch', 'success', '回写事件已发送', {
        requestId,
        fieldCount: Object.keys(fieldValues).length,
      });
      startInpatientEmrTraceStage(currentResult.trace, 'writebackFeedback', '等待 HIS reference-feedback 回执', {
        requestId,
      });
      syncResultTrace();
      void recordInpatientEmrTraceLog(currentResult, 'writeback-dispatch', 'pending', '已发送给 HIS，等待 reference-feedback 回执');
      void session?.record('writeback_dispatched', frozenSnapshot);
      writebackStatus.value = 'pending';
      writebackMessage.value = '已发送给HIS，等待回填结果回执';
      return true;
    } catch (error) {
      if (token !== requestSequence || pendingWritebackRequestId.value !== requestId) return false;
      void session?.record('writeback_failed', frozenSnapshot, '回写事件发送失败');
      finishInpatientEmrTraceStage(
        currentResult.trace,
        'writebackDispatch',
        'error',
        error instanceof Error ? error.message : String(error),
        { requestId },
      );
      syncResultTrace();
      void recordInpatientEmrTraceLog(
        currentResult,
        'writeback-dispatch',
        'error',
        error instanceof Error ? error.message : String(error),
      );
      writebackStatus.value = 'error';
      writebackMessage.value = error instanceof Error ? error.message : String(error);
      pendingWritebackRequestId.value = '';
      return false;
    } finally {
      if (token === requestSequence) isWritingBack.value = false;
    }
  }

  function applyReferenceFeedback(payload: InpatientEmrReferenceFeedbackPayload): 'success' | 'failed' | null {
    if (!result.value || !pendingSnapshot || !pendingWritebackRequestId.value
      || payload.consultationId !== pendingSnapshot.request.admissionId
      || payload.requestId !== pendingWritebackRequestId.value) return null;

    if (payload.status === 'success') {
      dispatchedRequestIds.add(pendingWritebackRequestId.value);
      void logSession?.record('writeback_success', pendingSnapshot, 'HIS已回执回填成功');
      finishInpatientEmrTraceStage(result.value.trace, 'writebackFeedback', 'success', payload.message || 'HIS 已完成病历回填', {
        requestId: payload.requestId || pendingWritebackRequestId.value,
      });
      syncResultTrace();
      void recordInpatientEmrTraceLog(result.value, 'writeback-feedback', 'success', payload.message || 'HIS 已完成病历回填');
      writebackStatus.value = 'success';
      writebackMessage.value = payload.message || 'HIS 已完成病历回填';
      pendingWritebackRequestId.value = '';
      return 'success';
    }

    if (payload.status === 'failed') {
      dispatchedRequestIds.add(pendingWritebackRequestId.value);
      void logSession?.record('writeback_failed', pendingSnapshot, 'HIS已回执回填失败');
      finishInpatientEmrTraceStage(result.value.trace, 'writebackFeedback', 'error', payload.message || 'HIS 病历回填失败', {
        requestId: payload.requestId || pendingWritebackRequestId.value,
      });
      syncResultTrace();
      void recordInpatientEmrTraceLog(result.value, 'writeback-feedback', 'error', payload.message || 'HIS 病历回填失败');
      writebackStatus.value = 'error';
      writebackMessage.value = payload.message || 'HIS 病历回填失败，请调整后重试';
      pendingWritebackRequestId.value = '';
      return 'failed';
    }

    return null;
  }

  return {
    steps,
    currentRequest,
    result,
    errorMessage,
    isGenerating,
    isWritingBack,
    writebackMessage,
    writebackStatus,
    activeStepKey,
    completedStepCount,
    start,
    abandon,
    pendingWritebackRequestId,
    updateFieldValue,
    writeBack,
    applyReferenceFeedback,
    reset,
  };
}
