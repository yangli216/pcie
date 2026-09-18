import { computed, ref, shallowRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { analyzeOutpatientEmrFields } from '../api/outpatientEmrService';
import {
  persistOutpatientEmrTemplateSnapshot,
  resolveOutpatientEmrTemplateSnapshot,
} from '../api/outpatientEmrTemplateSnapshotService';
import {
  buildOutpatientEmrAnalysisDraftValues,
  OutpatientEmrError,
  parseOutpatientEmrTemplate,
  restoreOutpatientEmrTemplateFromSnapshot,
} from '../lib/outpatientEmrTemplate';
import {
  buildOutpatientEmrRecordConfirmedPayload,
  hashOutpatientEmrTemplate,
} from '../lib/outpatientEmrWriteback';
import { findInvalidOutpatientEmrDictionaryValue } from '../lib/outpatientEmrDictionary';
import { isSameOutpatientEmrAnalysisRequestSnapshot } from '../lib/outpatientEmrRequestIdentity';
import { resolveOutpatientEmrStructuredFieldValues } from '../lib/outpatientEmrStructuredProjection';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrAnalysisStatus,
  OutpatientEmrCancelledPayload,
  OutpatientEmrErrorCode,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordConfirmedPayload,
  OutpatientEmrReferenceFeedbackPayload,
  OutpatientEmrTemplateParseResult,
  OutpatientEmrWritebackStatus,
} from '../types';

export type OutpatientEmrCompleteConsultation = (
  result: OutpatientEmrRecordConfirmedPayload | OutpatientEmrCancelledPayload,
) => Promise<unknown>;

export interface OutpatientEmrAnalysisDependencies {
  analyzeFields?: typeof analyzeOutpatientEmrFields;
  resolveTemplateSnapshot?: typeof resolveOutpatientEmrTemplateSnapshot;
  persistTemplateSnapshot?: typeof persistOutpatientEmrTemplateSnapshot;
  parseTemplate?: typeof parseOutpatientEmrTemplate;
  restoreTemplateFromSnapshot?: typeof restoreOutpatientEmrTemplateFromSnapshot;
  hashTemplate?: typeof hashOutpatientEmrTemplate;
  completeConsultation?: OutpatientEmrCompleteConsultation;
  now?: () => number;
}

function resolveError(error: unknown): { code: OutpatientEmrErrorCode; message: string } {
  if (error instanceof OutpatientEmrError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'ANALYSIS_FAILED',
    message: error instanceof Error ? error.message : String(error),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function defaultCompleteConsultation(
  result: OutpatientEmrRecordConfirmedPayload | OutpatientEmrCancelledPayload,
): Promise<void> {
  await invoke('complete_consultation', { result });
}

export function useOutpatientEmrAnalysis(
  dependencies: OutpatientEmrAnalysisDependencies = {},
) {
  const request = shallowRef<OutpatientEmrAnalysisRequest | null>(null);
  const template = shallowRef<OutpatientEmrTemplateParseResult | null>(null);
  const templateHash = ref('');
  const fieldValues = ref<Record<string, string>>({});
  const analysisStatus = ref<OutpatientEmrAnalysisStatus>('idle');
  const analysisErrorCode = ref<OutpatientEmrErrorCode | ''>('');
  const analysisErrorMessage = ref('');
  const writebackStatus = ref<OutpatientEmrWritebackStatus>('idle');
  const writebackMessage = ref('');
  const pendingWritebackRequestId = ref('');
  const editedFieldIds = new Set<string>();
  let runToken = 0;
  let activeAbortController: AbortController | null = null;

  const analyzeFields = dependencies.analyzeFields || analyzeOutpatientEmrFields;
  const resolveTemplateSnapshot = dependencies.resolveTemplateSnapshot
    || resolveOutpatientEmrTemplateSnapshot;
  const persistTemplateSnapshot = dependencies.persistTemplateSnapshot
    || persistOutpatientEmrTemplateSnapshot;
  const parseTemplate = dependencies.parseTemplate || parseOutpatientEmrTemplate;
  const restoreTemplateFromSnapshot = dependencies.restoreTemplateFromSnapshot
    || restoreOutpatientEmrTemplateFromSnapshot;
  const hashTemplate = dependencies.hashTemplate || hashOutpatientEmrTemplate;
  const completeConsultation = dependencies.completeConsultation || defaultCompleteConsultation;
  const now = dependencies.now || Date.now;

  const targetFields = computed(() => template.value?.targetFields || []);
  const dictionaryValidationIssue = computed(() => (
    findInvalidOutpatientEmrDictionaryValue(targetFields.value, fieldValues.value)
  ));
  const dictionaryValidationMessage = computed(() => {
    const issue = dictionaryValidationIssue.value;
    return issue
      ? `字典字段“${issue.fieldName || issue.fieldId}”尚未确定，请医生选择模板已有项。`
      : '';
  });
  const canSubmit = computed(() => (
    analysisStatus.value === 'ready'
    && !dictionaryValidationIssue.value
    && writebackStatus.value !== 'submitting'
    && writebackStatus.value !== 'pending'
    && writebackStatus.value !== 'success'
  ));
  const canRetry = computed(() => (
    Boolean(request.value)
    && analysisStatus.value !== 'analyzing'
    && writebackStatus.value !== 'submitting'
    && writebackStatus.value !== 'pending'
    && writebackStatus.value !== 'success'
  ));

  function invalidateActiveRun(): number {
    runToken += 1;
    activeAbortController?.abort();
    activeAbortController = null;
    return runToken;
  }

  function clearErrors(): void {
    analysisErrorCode.value = '';
    analysisErrorMessage.value = '';
  }

  function reset(): void {
    invalidateActiveRun();
    request.value = null;
    template.value = null;
    templateHash.value = '';
    fieldValues.value = {};
    analysisStatus.value = 'idle';
    clearErrors();
    writebackStatus.value = 'idle';
    writebackMessage.value = '';
    pendingWritebackRequestId.value = '';
    editedFieldIds.clear();
  }

  async function runAnalysis(
    nextRequest: OutpatientEmrAnalysisRequest,
    preserveDoctorEdits: boolean,
  ): Promise<boolean> {
    const token = invalidateActiveRun();
    const abortController = new AbortController();
    activeAbortController = abortController;
    request.value = nextRequest;
    clearErrors();
    writebackStatus.value = 'idle';
    writebackMessage.value = '';
    pendingWritebackRequestId.value = '';
    if (!preserveDoctorEdits) {
      template.value = null;
      templateHash.value = '';
      fieldValues.value = {};
      editedFieldIds.clear();
    }

    try {
      analysisStatus.value = 'analyzing';
      templateHash.value = await hashTemplate(
        nextRequest.templateHtml,
        nextRequest.templateDefinition,
      );
      if (token !== runToken || abortController.signal.aborted) return false;

      let resolution: Awaited<ReturnType<typeof resolveTemplateSnapshot>>;
      try {
        resolution = await resolveTemplateSnapshot({
          templateId: nextRequest.templateId,
          templateHash: templateHash.value,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new OutpatientEmrError(
          'TEMPLATE_SNAPSHOT_FAILED',
          `历史模板解析查询失败，尚未启动模型分析：${message}`,
        );
      }
      if (token !== runToken || abortController.signal.aborted) return false;

      let parsedTemplate: OutpatientEmrTemplateParseResult;
      if (resolution.cacheHit) {
        if (!resolution.parseResult) {
          throw new OutpatientEmrError(
            'TEMPLATE_SNAPSHOT_FAILED',
            '历史模板解析命中但缺少完整字段快照，尚未启动模型分析。',
          );
        }
        parsedTemplate = restoreTemplateFromSnapshot(
          nextRequest.templateHtml,
          resolution.parseResult.fields,
          nextRequest.targetFieldIds,
        );
      } else {
        parsedTemplate = parseTemplate(
          nextRequest.templateHtml,
          nextRequest.templateDefinition,
          nextRequest.targetFieldIds,
        );
        if (token !== runToken || abortController.signal.aborted) return false;
        try {
          await persistTemplateSnapshot({
            request: nextRequest,
            template: parsedTemplate,
            templateHash: templateHash.value,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new OutpatientEmrError(
            'TEMPLATE_SNAPSHOT_FAILED',
            `新模板解析登记失败，尚未启动模型分析：${message}`,
          );
        }
      }
      if (token !== runToken || abortController.signal.aborted) return false;

      const previousValues = fieldValues.value;
      template.value = parsedTemplate;
      fieldValues.value = preserveDoctorEdits
        ? Object.fromEntries(parsedTemplate.targetFields.map((field) => [
            field.id,
            Object.prototype.hasOwnProperty.call(previousValues, field.id)
              ? previousValues[field.id]
              : field.dictionaryItems.length > 0
                ? ''
                : field.baselineValue,
          ]))
        : buildOutpatientEmrAnalysisDraftValues(parsedTemplate.targetFields);

      if (preserveDoctorEdits) {
        const nextTargetIds = new Set(parsedTemplate.targetFields.map((field) => field.id));
        Array.from(editedFieldIds).forEach((fieldId) => {
          if (!nextTargetIds.has(fieldId)) editedFieldIds.delete(fieldId);
        });
      } else {
        editedFieldIds.clear();
      }

      const generatedValues = await analyzeFields({
        request: nextRequest,
        fields: parsedTemplate.targetFields,
        signal: abortController.signal,
      });
      if (token !== runToken || abortController.signal.aborted) return false;

      const mergedValues = { ...fieldValues.value };
      parsedTemplate.targetFields.forEach((field) => {
        if (
          !Object.prototype.hasOwnProperty.call(generatedValues, field.id)
          || typeof generatedValues[field.id] !== 'string'
        ) {
          throw new OutpatientEmrError(
            'ANALYSIS_FAILED',
            `模型分析结果缺少模板字段 ${field.name || field.id}。`,
          );
        }
      });
      const structuredValues = resolveOutpatientEmrStructuredFieldValues({
        recordContext: nextRequest.recordContext,
        fields: parsedTemplate.targetFields,
      });
      parsedTemplate.targetFields.forEach((field) => {
        if (!editedFieldIds.has(field.id)) {
          mergedValues[field.id] = Object.prototype.hasOwnProperty.call(structuredValues, field.id)
            ? structuredValues[field.id]
            : generatedValues[field.id];
        }
      });
      fieldValues.value = mergedValues;
      analysisStatus.value = 'ready';
      return true;
    } catch (error) {
      if (token !== runToken || abortController.signal.aborted || isAbortError(error)) {
        return false;
      }
      const resolved = resolveError(error);
      analysisErrorCode.value = resolved.code;
      analysisErrorMessage.value = resolved.message;
      analysisStatus.value = 'error';
      return false;
    } finally {
      if (token === runToken) {
        activeAbortController = null;
      }
    }
  }

  async function start(nextRequest: OutpatientEmrAnalysisRequest): Promise<boolean> {
    const current = request.value;
    if (current?.requestId === nextRequest.requestId) {
      if (isSameOutpatientEmrAnalysisRequestSnapshot(current, nextRequest)) {
        return analysisStatus.value === 'ready';
      }
      analysisErrorCode.value = 'REQUEST_ID_CONFLICT';
      analysisErrorMessage.value = '同一 requestId 不能用于不同就诊或模板。';
      return false;
    }
    return runAnalysis(nextRequest, false);
  }

  async function retry(): Promise<boolean> {
    if (!request.value || !canRetry.value) return false;
    return runAnalysis(request.value, true);
  }

  function updateFieldValue(fieldId: string, value: string): void {
    if (!template.value?.targetFields.some((field) => field.id === fieldId)) return;
    editedFieldIds.add(fieldId);
    fieldValues.value = {
      ...fieldValues.value,
      [fieldId]: value.replace(/\r\n?/g, '\n'),
    };
  }

  function buildConfirmedPayload(
    baseWritebackPayload: OutpatientEmrPreparedWritebackPayload | null = null,
  ): OutpatientEmrRecordConfirmedPayload | null {
    if (
      !request.value
      || !template.value
      || !templateHash.value
      || analysisStatus.value !== 'ready'
    ) {
      return null;
    }

    return buildOutpatientEmrRecordConfirmedPayload({
      request: request.value,
      templateHash: templateHash.value,
      fields: template.value.targetFields,
      fieldValues: fieldValues.value,
      timestamp: now(),
      baseWritebackPayload,
    });
  }

  async function writeBack(
    baseWritebackPayload: OutpatientEmrPreparedWritebackPayload | null = null,
  ): Promise<boolean> {
    if (!request.value || !template.value || !templateHash.value || !canSubmit.value) {
      return false;
    }

    const currentRequest = request.value;
    const payload = buildConfirmedPayload(baseWritebackPayload);
    if (!payload) return false;

    writebackStatus.value = 'submitting';
    writebackMessage.value = baseWritebackPayload
      ? '正在提交模板与已选诊疗内容'
      : '正在返回模板参数';
    pendingWritebackRequestId.value = currentRequest.requestId;
    try {
      await completeConsultation(payload);
      if (request.value !== currentRequest) return false;
      if (
        pendingWritebackRequestId.value === currentRequest.requestId
        && writebackStatus.value === 'submitting'
      ) {
        writebackStatus.value = 'pending';
        writebackMessage.value = baseWritebackPayload
          ? '已发送模板与已选诊疗内容，等待 HIS 回执'
          : '参数已发送，等待 HIS 回填回执';
      }
      return true;
    } catch (error) {
      if (request.value !== currentRequest) return false;
      if (
        pendingWritebackRequestId.value === currentRequest.requestId
        && writebackStatus.value === 'submitting'
      ) {
        pendingWritebackRequestId.value = '';
        writebackStatus.value = 'failed';
        writebackMessage.value = error instanceof Error ? error.message : String(error);
      }
      return false;
    }
  }

  async function cancel(): Promise<boolean> {
    const currentRequest = request.value;
    if (!currentRequest || writebackStatus.value === 'submitting' || writebackStatus.value === 'pending') {
      return false;
    }
    const previousAnalysisStatus = analysisStatus.value;
    invalidateActiveRun();
    if (previousAnalysisStatus === 'analyzing') {
      analysisStatus.value = 'error';
      analysisErrorCode.value = 'WRITEBACK_FAILED';
      analysisErrorMessage.value = '分析已停止，正在结束本次任务。';
    }
    writebackStatus.value = 'submitting';
    writebackMessage.value = '正在结束本次模板分析';
    try {
      await completeConsultation({
        consultationId: currentRequest.visitId,
        visitId: currentRequest.visitId,
        timestamp: now(),
        requestId: currentRequest.requestId,
        resultType: 'cancelled',
        status: 'cancelled',
        emrType: 'outpatient-emr',
      });
      if (request.value !== currentRequest) return false;
      reset();
      return true;
    } catch (error) {
      if (request.value !== currentRequest) return false;
      analysisStatus.value = previousAnalysisStatus === 'analyzing'
        ? 'error'
        : previousAnalysisStatus;
      if (previousAnalysisStatus === 'analyzing') {
        analysisErrorCode.value = 'WRITEBACK_FAILED';
        analysisErrorMessage.value = '分析已停止，但取消结果发送失败，可重新分析或再次放弃。';
      }
      writebackStatus.value = 'failed';
      writebackMessage.value = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  function applyReferenceFeedback(
    payload: OutpatientEmrReferenceFeedbackPayload,
  ): 'success' | 'failed' | null {
    const currentRequest = request.value;
    if (
      !currentRequest
      || !pendingWritebackRequestId.value
      || payload.consultationId !== currentRequest.visitId
      || payload.requestId !== pendingWritebackRequestId.value
    ) {
      return null;
    }

    if (payload.status === 'success') {
      writebackStatus.value = 'success';
      writebackMessage.value = payload.message || 'HIS 已完成门诊模板参数回填';
      pendingWritebackRequestId.value = '';
      return 'success';
    }
    if (payload.status === 'failed') {
      writebackStatus.value = 'failed';
      writebackMessage.value = payload.message || 'HIS 回填失败，请修改后重试';
      pendingWritebackRequestId.value = '';
      return 'failed';
    }
    return null;
  }

  return {
    request,
    template,
    templateHash,
    targetFields,
    dictionaryValidationIssue,
    dictionaryValidationMessage,
    fieldValues,
    analysisStatus,
    analysisErrorCode,
    analysisErrorMessage,
    writebackStatus,
    writebackMessage,
    pendingWritebackRequestId,
    canSubmit,
    canRetry,
    start,
    retry,
    updateFieldValue,
    buildConfirmedPayload,
    writeBack,
    cancel,
    applyReferenceFeedback,
    reset,
  };
}

export type OutpatientEmrAnalysis = ReturnType<typeof useOutpatientEmrAnalysis>;
