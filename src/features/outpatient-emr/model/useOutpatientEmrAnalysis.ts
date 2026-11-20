import { computed, ref, shallowRef } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { analyzeOutpatientEmrFields } from '../api/outpatientEmrService';
import { normalizeOutpatientEmrTemplateSource, type OutpatientEmrTemplateSource } from '../api/outpatientEmrTemplateDecodeService';
import {
  persistOutpatientEmrTemplateSnapshot,
  resolveOutpatientEmrTemplateSnapshot,
} from '../api/outpatientEmrTemplateSnapshotService';
import {
  buildOutpatientEmrInitialDraft,
  resolveOutpatientEmrModelDraft,
} from '../lib/outpatientEmrDraftSource';
import {
  OutpatientEmrError,
  parseOutpatientEmrTemplate,
  restoreOutpatientEmrTemplateFromSnapshot,
} from '../lib/outpatientEmrTemplate';
import {
  buildOutpatientEmrRecordConfirmedPayload,
  hashOutpatientEmrTemplate,
  normalizeOutpatientEmrModelValues,
} from '../lib/outpatientEmrWriteback';
import { prepareOutpatientEmrTemplate, type PreparedOutpatientEmrTemplate } from '../lib/prepareOutpatientEmrTemplate';
import { describeOutpatientEmrNarrative, parseOutpatientEmrNarrative } from '../lib/outpatientEmrNarrative';
import { describeOutpatientTemplateReferences, matchesVoiceOutpatientRecognitionTemplate } from '../lib/voiceOutpatientEmrRecognition';
import { findInvalidOutpatientEmrDictionaryValue } from '../lib/outpatientEmrDictionary';
import { isAdministrativeTemplateSlot } from '../lib/outpatientEmrPromptGenerator';
import { findOutpatientEmrFieldConflicts } from '../lib/outpatientEmrFieldConsistency';
import { isSameOutpatientEmrAnalysisRequestSnapshot } from '../lib/outpatientEmrRequestIdentity';
import { resolveOutpatientEmrStructuredFieldValues } from '../lib/outpatientEmrStructuredProjection';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrAnalysisStatus,
  OutpatientEmrCancelledPayload,
  OutpatientEmrErrorCode,
  OutpatientEmrFieldValueSource,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordField,
  OutpatientEmrRecordConfirmedPayload,
  OutpatientEmrReferenceFeedbackPayload,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
  OutpatientEmrWritebackStatus,
  VoiceOutpatientEmrInitialDraft,
} from '../types';

export type OutpatientEmrCompleteConsultation = (
  result: OutpatientEmrRecordConfirmedPayload | OutpatientEmrCancelledPayload,
) => Promise<unknown>;

export interface OutpatientEmrAnalysisDependencies {
  analyzeFields?: typeof analyzeOutpatientEmrFields;
  normalizeTemplateSource?: (source: OutpatientEmrTemplateSource, signal?: AbortSignal) => Promise<OutpatientEmrTemplateSource>;
  resolveTemplateSnapshot?: typeof resolveOutpatientEmrTemplateSnapshot;
  persistTemplateSnapshot?: typeof persistOutpatientEmrTemplateSnapshot;
  parseTemplate?: typeof parseOutpatientEmrTemplate;
  restoreTemplateFromSnapshot?: typeof restoreOutpatientEmrTemplateFromSnapshot;
  hashTemplate?: typeof hashOutpatientEmrTemplate;
  getPreparedVoiceTemplate?: (request: OutpatientEmrAnalysisRequest) => PreparedOutpatientEmrTemplate | undefined;
  isFieldInWriteback?: (field: OutpatientEmrTemplateField, value: string | undefined, source: OutpatientEmrFieldValueSource | undefined) => boolean;
  completeConsultation?: OutpatientEmrCompleteConsultation;
  now?: () => number;
}

export function withOutpatientEmrDoctorEdits(
  request: OutpatientEmrAnalysisRequest,
  edits: Array<Pick<OutpatientEmrTemplateField, 'id' | 'name' | 'recordField' | 'articleName'> & {
    value: string; source: OutpatientEmrFieldValueSource;
  }>,
): OutpatientEmrAnalysisRequest {
  if (!edits.length) return request;
  const previous = request.recordContext.doctorTemplateEdits;
  if (Array.isArray(previous) && JSON.stringify(previous) === JSON.stringify(edits)) return request;
  return {
    ...request,
    recordContext: {
      ...request.recordContext,
      ...(previous !== undefined ? { previousDoctorTemplateEdits: previous } : {}),
      doctorTemplateEdits: edits,
    },
  };
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
  const fieldValueSources = ref<Record<string, OutpatientEmrFieldValueSource>>({});
  const analysisStatus = ref<OutpatientEmrAnalysisStatus>('idle');
  const analysisErrorCode = ref<OutpatientEmrErrorCode | ''>('');
  const analysisErrorMessage = ref('');
  const writebackStatus = ref<OutpatientEmrWritebackStatus>('idle');
  const writebackMessage = ref('');
  const pendingWritebackRequestId = ref('');
  const editedFieldIds = new Set<string>();
  const revisedDuringGeneration = new Set<string>();
  let runToken = 0;
  let activeAbortController: AbortController | null = null;

  const analyzeFields = dependencies.analyzeFields || analyzeOutpatientEmrFields;
  const normalizeTemplateSource = dependencies.normalizeTemplateSource || normalizeOutpatientEmrTemplateSource;
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
  const aiTargetCount = computed(() => targetFields.value.filter(field => field.aiSuitable).length);
  const generatedCount = computed(() => targetFields.value.filter(field => field.aiSuitable && !!fieldValues.value[field.id]?.trim()
    && ['ai', 'template-matched'].includes(fieldValueSources.value[field.id])).length);
  const resultSummary = computed(() => {
    const unresolved = targetFields.value.filter(field => field.policyDisposition === 'unresolved').length;
    if (unresolved) return `AI 已填 ${generatedCount.value}/${aiTargetCount.value} 个字段，另有 ${unresolved} 个字段规则待核对`;
    if (aiTargetCount.value === 0) return '本次无 AI 生成字段';
    if (generatedCount.value) return `AI 已填 ${generatedCount.value}/${aiTargetCount.value} 个字段`;
    const hasOriginal = targetFields.value.filter(field => field.aiSuitable).every(({ id }) =>
      ['structured', 'his', 'doctor'].includes(fieldValueSources.value[id]) && !!fieldValues.value[id]?.trim());
    return hasOriginal ? '已保留原有内容，AI 本轮未新增' : '待补充，AI 本轮没有返回可采用的字段';
  });
  const isFieldInWriteback = dependencies.isFieldInWriteback;
  const writebackFields = computed(() => isFieldInWriteback
    ? targetFields.value.filter(field => isFieldInWriteback(field, fieldValues.value[field.id], fieldValueSources.value[field.id]))
    : targetFields.value);
  const writebackFieldValues = computed(() => isFieldInWriteback
    ? Object.fromEntries(writebackFields.value.map(field => [field.id, fieldValues.value[field.id]]))
    : fieldValues.value);
  const dictionaryValidationIssue = computed(() => (
    findInvalidOutpatientEmrDictionaryValue(writebackFields.value, fieldValues.value)
  ));
  const fieldConflicts = computed(() => (
    findOutpatientEmrFieldConflicts(writebackFields.value, fieldValues.value)
  ));
  const conflictFieldIds = computed(() => new Set(fieldConflicts.value.flatMap((conflict) => [
    conflict.flagFieldId,
    conflict.detailFieldId,
  ])));
  const dictionaryValidationMessage = computed(() => {
    const issue = dictionaryValidationIssue.value;
    if (issue) {
      return `字典字段“${issue.fieldName || issue.fieldId}”的值与模板选项不匹配，请重新选择或清空。`;
    }
    return fieldConflicts.value[0]?.message || '';
  });
  const writebackLocked = computed(() => (
    writebackStatus.value === 'submitting' || writebackStatus.value === 'pending' || writebackStatus.value === 'success'
  ));
  const canSubmit = computed(() => (
    Boolean(template.value && templateHash.value)
    && !dictionaryValidationIssue.value
    && fieldConflicts.value.length === 0
    && !writebackLocked.value
  ));
  const canRetry = computed(() => (
    Boolean(request.value) && analysisStatus.value !== 'analyzing' && !writebackLocked.value
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
    fieldValueSources.value = {};
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
    initialDraft?: VoiceOutpatientEmrInitialDraft,
  ): Promise<boolean> {
    const token = invalidateActiveRun();
    const abortController = new AbortController();
    activeAbortController = abortController;
    revisedDuringGeneration.clear();
    request.value = nextRequest;
    clearErrors();
    writebackStatus.value = 'idle';
    writebackMessage.value = '';
    pendingWritebackRequestId.value = '';
    if (!preserveDoctorEdits) {
      template.value = null;
      templateHash.value = '';
      fieldValues.value = {};
      fieldValueSources.value = {};
      editedFieldIds.clear();
    }

    try {
      analysisStatus.value = 'analyzing';
      const isCurrent = () => token === runToken && !abortController.signal.aborted;
      function acceptHash(hash: string): void {
        if (initialDraft && (initialDraft.templateHash !== hash ||
          !matchesVoiceOutpatientRecognitionTemplate(initialDraft, { visitId: nextRequest.visitId, template: nextRequest }))) {
          throw new OutpatientEmrError('REQUEST_ID_CONFLICT', '本次语音生成的字段与当前就诊或模板版本不一致，请重新核对。');
        }
        templateHash.value = hash;
      }
      let prepared = initialDraft ? dependencies.getPreparedVoiceTemplate?.(nextRequest) : undefined;
      if (prepared) {
        acceptHash(prepared.templateHash);
      } else {
        const source = await normalizeTemplateSource(nextRequest, abortController.signal);
        if (!isCurrent()) return false;
        prepared = await prepareOutpatientEmrTemplate(nextRequest, source, {
          hashTemplate, resolveTemplateSnapshot, restoreTemplateFromSnapshot, parseTemplate, persistTemplateSnapshot,
        }, isCurrent, acceptHash);
      }
      if (!isCurrent() || !prepared) return false;
      const parsedTemplate = prepared.template;
      const modelFields = parsedTemplate.targetFields.filter(field => field.aiSuitable);
      const localRequest = { ...nextRequest, ...prepared.source };
      const identityWords = [localRequest.patient?.name, localRequest.patient?.idPi, localRequest.visitId];
      const policy = parsedTemplate.fieldPolicy;
      if (initialDraft && policy && (initialDraft.policyRevision !== policy.revision || initialDraft.ruleSetVersion !== policy.ruleSetVersion)) {
        initialDraft = undefined;
      }
      const previousValues = fieldValues.value;
      const previousSources = fieldValueSources.value;
      const structuredValues = resolveOutpatientEmrStructuredFieldValues({
        recordContext: nextRequest.recordContext,
        fields: parsedTemplate.targetFields,
      });
      const initialDrafts = parsedTemplate.targetFields.map((field) => {
        if (!editedFieldIds.has(field.id) && Object.prototype.hasOwnProperty.call(structuredValues, field.id)) {
          return [field.id, { value: structuredValues[field.id], source: 'structured' }] as const;
        }
        const keepPrevious = preserveDoctorEdits && (editedFieldIds.has(field.id) || previousSources[field.id] === 'doctor')
          && Object.prototype.hasOwnProperty.call(previousValues, field.id);
        return [field.id, keepPrevious
          ? { value: previousValues[field.id], source: previousSources[field.id] || 'empty' }
          : buildOutpatientEmrInitialDraft(field)] as const;
      });
      fieldValues.value = Object.fromEntries(
        initialDrafts.map(([fieldId, draft]) => [fieldId, draft.value]),
      );
      template.value = parsedTemplate;
      fieldValueSources.value = Object.fromEntries(
        initialDrafts.map(([fieldId, draft]) => [fieldId, draft.source]),
      );

      if (preserveDoctorEdits) {
        const nextTargetIds = new Set(parsedTemplate.targetFields.map((field) => field.id));
        Array.from(editedFieldIds).forEach((fieldId) => {
          if (!nextTargetIds.has(fieldId)) editedFieldIds.delete(fieldId);
        });
      } else {
        editedFieldIds.clear();
      }

      const doctorTemplateEdits = parsedTemplate.targetFields
        .filter(field => editedFieldIds.has(field.id) && !isAdministrativeTemplateSlot(field.id, field.name, [
          field.articleId, field.articleTemplateId, field.articleDefinitionName, field.articleName,
        ]))
        .map(({ id, name, recordField, articleName }) => ({
          id, name, recordField, articleName, value: fieldValues.value[id], source: 'doctor' as const,
        }));
      const generatedValues = !modelFields.length ? {} : initialDraft
        ? normalizeOutpatientEmrModelValues(initialDraft.fieldValues, modelFields)
        : await analyzeFields({
          request: withOutpatientEmrDoctorEdits(localRequest, doctorTemplateEdits),
          fields: modelFields,
          templateNarrative: describeOutpatientEmrNarrative(parseOutpatientEmrNarrative(parsedTemplate.sanitizedHtml, parsedTemplate.targetFields), identityWords),
          templateReferenceChapters: describeOutpatientTemplateReferences(parsedTemplate, prepared.source.templateDefinition, identityWords, modelFields),
          ...(parsedTemplate.templateSourceNotes?.length ? { templateSourceNotes: parsedTemplate.templateSourceNotes } : {}),
          signal: abortController.signal,
        });
      if (token !== runToken || abortController.signal.aborted) return false;

      const mergedValues = { ...fieldValues.value };
      const mergedSources = { ...fieldValueSources.value };
      parsedTemplate.targetFields.forEach((field) => {
        if (!field.aiSuitable || editedFieldIds.has(field.id) || revisedDuringGeneration.has(field.id)) return;
        if (Object.prototype.hasOwnProperty.call(structuredValues, field.id)) return;
        const value = Object.prototype.hasOwnProperty.call(generatedValues, field.id) ? generatedValues[field.id] : undefined;
        const draft = resolveOutpatientEmrModelDraft(field, value === undefined ? '' : value);
        mergedValues[field.id] = draft.value;
        mergedSources[field.id] = draft.source;
      });
      fieldValues.value = mergedValues;
      fieldValueSources.value = mergedSources;
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

  async function refreshPolicyForModel(stillCurrent: () => boolean): Promise<OutpatientEmrTemplateParseResult | undefined> {
    const input = request.value;
    const token = runToken;
    const current = () => stillCurrent() && token === runToken && request.value === input && !writebackLocked.value;
    if (!input || !template.value || !current()) return;
    const source = await normalizeTemplateSource(input);
    if (!current()) return;
    const prepared = await prepareOutpatientEmrTemplate(input, source, {
      hashTemplate, resolveTemplateSnapshot, restoreTemplateFromSnapshot, parseTemplate, persistTemplateSnapshot,
    }, current);
    if (!prepared || !current()) return;
    if (templateHash.value !== prepared.templateHash) throw new OutpatientEmrError('REQUEST_ID_CONFLICT', '当前模板版本已变化，请重新核对。');
    const previous = template.value.fieldPolicy;
    const next = prepared.template.fieldPolicy;
    if (next?.revision !== previous?.revision || next?.ruleSetVersion !== previous?.ruleSetVersion) {
      const values = { ...fieldValues.value };
      const sources = { ...fieldValueSources.value };
      for (const f of prepared.template.targetFields) {
        if (['doctor', 'structured', 'his'].includes(sources[f.id])) continue;
        const draft = buildOutpatientEmrInitialDraft(f);
        values[f.id] = draft.value;
        sources[f.id] = draft.source;
      }
      template.value = prepared.template;
      fieldValues.value = values;
      fieldValueSources.value = sources;
    }
    return prepared.template;
  }

  async function start(nextRequest: OutpatientEmrAnalysisRequest, initialDraft?: VoiceOutpatientEmrInitialDraft): Promise<boolean> {
    const current = request.value;
    if (current?.requestId === nextRequest.requestId) {
      if (isSameOutpatientEmrAnalysisRequestSnapshot(current, nextRequest)) {
        return analysisStatus.value === 'ready';
      }
      analysisErrorCode.value = 'REQUEST_ID_CONFLICT';
      analysisErrorMessage.value = '同一 requestId 不能用于不同就诊或模板。';
      return false;
    }
    return runAnalysis(nextRequest, false, initialDraft);
  }

  async function retry(): Promise<boolean> {
    if (!request.value || !canRetry.value) return false;
    return runAnalysis(request.value, true);
  }

  function updateFieldValue(fieldId: string, value: string): void {
    if (writebackLocked.value || !template.value?.targetFields.some((field) => field.id === fieldId)) return;
    editedFieldIds.add(fieldId);
    fieldValues.value = {
      ...fieldValues.value,
      [fieldId]: value.replace(/\r\n?/g, '\n'),
    };
    fieldValueSources.value = {
      ...fieldValueSources.value,
      [fieldId]: 'doctor',
    };
  }

  function replaceReviewedSectionValues(fields: OutpatientEmrTemplateField[], result: Record<string, string | null>, sectionClear = false): void {
    const normalized = normalizeOutpatientEmrModelValues(result, fields);
    const values = { ...fieldValues.value };
    const sources = { ...fieldValueSources.value };
    for (const field of fields) {
      if (sectionClear) editedFieldIds.delete(field.id);
      else if (editedFieldIds.has(field.id)) continue;
      revisedDuringGeneration.add(field.id);
      const value = normalized[field.id];
      const draft = value ? resolveOutpatientEmrModelDraft(field, value)
        : { value: '', source: sectionClear ? 'doctor' as const : 'empty' as const };
      values[field.id] = draft.value;
      sources[field.id] = draft.source;
    }
    fieldValues.value = values;
    fieldValueSources.value = sources;
  }

  function buildConfirmedPayload(
    baseWritebackPayload: OutpatientEmrPreparedWritebackPayload | null = null,
    voiceRecordValues?: Readonly<Partial<Record<OutpatientEmrRecordField, string>>>,
    reviewedRecord?: Readonly<Partial<Record<OutpatientEmrRecordField, string>>>,
    selectedFields?: { ids: ReadonlySet<string>; directText: Readonly<Record<string, string>> },
  ): OutpatientEmrRecordConfirmedPayload | null {
    if (
      !request.value
      || !template.value
      || !templateHash.value
    ) {
      return null;
    }

    return buildOutpatientEmrRecordConfirmedPayload({
      request: request.value,
      templateHash: templateHash.value,
      fields: selectedFields ? template.value.targetFields.filter(field => selectedFields.ids.has(field.id)) : template.value.targetFields,
      fieldValues: writebackFieldValues.value,
      documentDirectText: selectedFields?.directText,
      templateFieldIds: selectedFields && [
        ...template.value.fields.map(field => field.id),
        ...(template.value.templateSourceNotes ?? []).map(note => note.fieldId),
      ],
      fieldValueSources: fieldValueSources.value,
      voiceRecordValues, reviewedRecord,
      timestamp: now(),
      baseWritebackPayload,
    });
  }

  // An early confirmation fixes the displayed draft even if HIS later asks for a retry.
  function stopGenerationForWriteback(): void {
    if (analysisStatus.value !== 'analyzing' || !template.value) return;
    invalidateActiveRun();
    analysisStatus.value = 'draft';
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
    stopGenerationForWriteback();

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
    aiTargetCount, generatedCount, resultSummary, refreshPolicyForModel,
    dictionaryValidationIssue,
    dictionaryValidationMessage,
    fieldConflicts,
    conflictFieldIds,
    fieldValues,
    writebackFieldValues,
    fieldValueSources,
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
    isIndividuallyEdited: (id: string) => editedFieldIds.has(id),
    replaceReviewedSectionValues,
    buildConfirmedPayload,
    stopGenerationForWriteback,
    writeBack,
    cancel,
    applyReferenceFeedback,
    reset,
  };
}

export type OutpatientEmrAnalysis = ReturnType<typeof useOutpatientEmrAnalysis>;
