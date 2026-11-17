import { computed, onScopeDispose, watch, type Ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import { getPatientContextAnchorId } from '@/utils/patientContext';
import { isSameOutpatientEmrAnalysisRequestSnapshot } from '../lib/outpatientEmrRequestIdentity';
import { OutpatientEmrError } from '../lib/outpatientEmrTemplate';
import { buildVoiceOutpatientEmrPatientInput } from '../lib/voiceOutpatientEmr';
import {
  voiceOutpatientEmrDraftCache,
  clearVoiceOutpatientEmrRecordDraftCache,
} from '../lib/voiceOutpatientEmrDraftCache';
export { clearVoiceOutpatientEmrRecordDraftCache } from '../lib/voiceOutpatientEmrDraftCache';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordContext,
  OutpatientEmrRecordField,
  VoiceOutpatientEmrStartContext,
} from '../types';
import {
  useOutpatientEmrAnalysis,
  type OutpatientEmrAnalysisDependencies,
} from './useOutpatientEmrAnalysis';

export interface VoiceOutpatientEmrRecordOptions {
  context: Ref<VoiceOutpatientEmrStartContext | null>;
  patient: Ref<AppPatient | null | undefined>;
  recordContext: Ref<OutpatientEmrRecordContext | null>;
  enabled: Ref<boolean>;
}

/** Owns the current voice result's template draft; the result page owns submission. */
export function useVoiceOutpatientEmrRecord(
  options: VoiceOutpatientEmrRecordOptions,
  dependencies: OutpatientEmrAnalysisDependencies = {},
) {
  const analysis = useOutpatientEmrAnalysis(dependencies);
  let pendingDoctorEdits: Record<string, string> | null = null;
  let cacheEpoch = voiceOutpatientEmrDraftCache.epoch;
  let revision = 0;
  let restoreScheduled = false;
  const currentRequest = computed<OutpatientEmrAnalysisRequest | null>(() => {
    const context = options.context.value;
    const patient = options.patient.value;
    const recordContext = options.recordContext.value;
    if (
      !options.enabled.value
      || !context
      || !recordContext
      || getPatientContextAnchorId(patient) !== context.visitId
    ) return null;

    return {
      ...context.template,
      visitId: context.visitId,
      targetFieldIds: [...context.template.targetFieldIds],
      // Freeze the clinical input so a later reactive edit cannot mutate an
      // in-flight request or make a stale analysis appear current.
      recordContext: JSON.parse(JSON.stringify(recordContext)) as OutpatientEmrRecordContext,
      patient: buildVoiceOutpatientEmrPatientInput({
        idPi: patient?.idPi || patient?.patientId,
        name: patient?.naPi || patient?.patientName,
        sdSexText: patient?.sdSexText || patient?.genderText,
        ageText: patient?.ageText,
      }),
    };
  });

  const isCurrent = computed(() => Boolean(
    currentRequest.value
    && analysis.request.value
    && isSameOutpatientEmrAnalysisRequestSnapshot(
      analysis.request.value,
      currentRequest.value,
    ),
  ));
  const canSubmit = computed(() => isCurrent.value && analysis.canSubmit.value);
  const canRetry = computed(() => isCurrent.value && analysis.canRetry.value);
  // These values only determine the existing record-section selector's
  // availability. Final section composition remains in the payload builder.
  const recordFieldValues = computed(() => {
    const values: Partial<Record<OutpatientEmrRecordField, string>> = {};
    analysis.targetFields.value.forEach((field) => {
      const value = analysis.fieldValues.value[field.id]?.trim();
      if (!field.recordField || !value) return;
      values[field.recordField] = [values[field.recordField], value].filter(Boolean).join('；');
    });
    return values;
  });

  function reset(): void {
    revision += 1;
    restoreScheduled = false;
    pendingDoctorEdits = null;
    clearVoiceOutpatientEmrRecordDraftCache();
    cacheEpoch = voiceOutpatientEmrDraftCache.epoch;
    analysis.reset();
  }

  function collectDoctorEdits(): Record<string, string> {
    return {
      ...pendingDoctorEdits,
      ...Object.fromEntries(Object.entries(analysis.fieldValueSources.value)
        .filter(([, source]) => source === 'doctor')
        .map(([fieldId]) => [fieldId, analysis.fieldValues.value[fieldId]])),
    };
  }

  watch(analysis.fieldValueSources, () => {
    if (!pendingDoctorEdits || !analysis.template.value || restoreScheduled) return;
    const activeRevision = revision;
    restoreScheduled = true;
    // Let the shared controller finish clearing its initial edited-field set.
    // This microtask runs before its awaited model response can be applied.
    queueMicrotask(() => {
      if (revision !== activeRevision) return;
      restoreScheduled = false;
      const edits = pendingDoctorEdits;
      pendingDoctorEdits = null;
      if (!edits || !isCurrent.value) return;
      Object.entries(edits).forEach(([fieldId, value]) => {
        if (analysis.fieldValueSources.value[fieldId] !== 'doctor') {
          analysis.updateFieldValue(fieldId, value);
        }
      });
    });
  }, { flush: 'sync' });

  watch(currentRequest, (nextRequest) => {
    if (!nextRequest && !analysis.request.value) {
      // A remounted result page restores its ordinary voice refs after setup.
      // Keep the one cache entry until those refs form a comparable request.
      analysis.reset();
      return;
    }
    if (
      nextRequest
      && analysis.request.value
      && isSameOutpatientEmrAnalysisRequestSnapshot(analysis.request.value, nextRequest)
    ) return;

    const previousRequest = analysis.request.value;
    const sameSession = nextRequest && previousRequest
      && isSameOutpatientEmrAnalysisRequestSnapshot({
        ...previousRequest,
        recordContext: nextRequest.recordContext,
      }, nextRequest);
    const cachedEdits = nextRequest && voiceOutpatientEmrDraftCache.draft
      && isSameOutpatientEmrAnalysisRequestSnapshot(voiceOutpatientEmrDraftCache.draft.request, nextRequest)
      ? voiceOutpatientEmrDraftCache.draft.values : null;
    const preservedEdits = sameSession ? collectDoctorEdits() : cachedEdits;
    // Clinical/selection updates are new analysis rounds under the same HIS
    // request. Disabling or replacing the session clears all retained edits.
    reset();
    pendingDoctorEdits = preservedEdits;
    if (nextRequest) void analysis.start(nextRequest);
  }, { immediate: true, flush: 'sync' });

  onScopeDispose(() => {
    const request = currentRequest.value;
    const values = collectDoctorEdits();
    voiceOutpatientEmrDraftCache.draft = cacheEpoch === voiceOutpatientEmrDraftCache.epoch
      && request && isCurrent.value && Object.keys(values).length > 0
      ? { request, values }
      : null;
    pendingDoctorEdits = null;
    revision += 1;
    analysis.reset();
  });

  async function retry(): Promise<boolean> {
    if (!canRetry.value) return false;
    return analysis.retry();
  }

  function buildConfirmedPayload(
    basePayload: OutpatientEmrPreparedWritebackPayload | null = null,
  ) {
    if (!canSubmit.value) return null;
    const payload = analysis.buildConfirmedPayload(basePayload);
    if (!payload || !basePayload) return payload;

    const selectedRecordFields = new Set(basePayload.writebackScope.recordFields);
    const excludedIds = new Set(analysis.targetFields.value.flatMap((field) => (
      field.recordField && !selectedRecordFields.has(field.recordField) ? [field.id] : []
    )));
    const selectedFields = payload.templateMetadata.fields.filter((field) => !excludedIds.has(field.id));
    if (selectedFields.length === 0) {
      throw new OutpatientEmrError('WRITEBACK_FAILED', '请至少选择一个当前模板的病历段后再一键回写。');
    }
    const retainSelected = <T>(values: Record<string, T>): Record<string, T> => (
      Object.fromEntries(Object.entries(values).filter(([id]) => !excludedIds.has(id)))
    );
    return {
      ...payload,
      templateMetadata: {
        ...payload.templateMetadata,
        fields: selectedFields,
      },
      fieldValues: retainSelected(payload.fieldValues),
      dictionarySelections: retainSelected(payload.dictionarySelections),
      emrFieldValues: retainSelected(payload.emrFieldValues),
    };
  }

  return {
    ...analysis,
    canSubmit,
    canRetry,
    recordFieldValues,
    retry,
    buildConfirmedPayload,
    reset,
  };
}

export type VoiceOutpatientEmrRecord = ReturnType<typeof useVoiceOutpatientEmrRecord>;
