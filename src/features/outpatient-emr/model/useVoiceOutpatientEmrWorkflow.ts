import { computed, shallowRef, watch, type Ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import { getPatientContextAnchorId } from '@/utils/patientContext';
import { resolveVoiceOutpatientEmrStartContext } from '../lib/voiceOutpatientEmr';
import { clearVoiceOutpatientEmrRecordDraftCache } from '../lib/voiceOutpatientEmrDraftCache';
import type { VoiceOutpatientEmrStartContext } from '../types';

export interface VoiceOutpatientEmrWorkflowOptions {
  currentPatient: Ref<AppPatient | null>;
  notify?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export function useVoiceOutpatientEmrWorkflow(
  options: VoiceOutpatientEmrWorkflowOptions,
) {
  const startContext = shallowRef<VoiceOutpatientEmrStartContext | null>(null);

  function clear(): void {
    clearVoiceOutpatientEmrRecordDraftCache();
    startContext.value = null;
  }

  function prepareFromStartVoice(payload: unknown): boolean {
    const resolution = resolveVoiceOutpatientEmrStartContext(payload);
    if (resolution.kind === 'none') {
      clear();
      return true;
    }
    if (resolution.kind === 'invalid') {
      clear();
      options.notify?.(resolution.message, 'error');
      return false;
    }
    const currentVisitId = getPatientContextAnchorId(options.currentPatient.value);
    if (currentVisitId !== resolution.context.visitId) {
      clear();
      options.notify?.('动态门诊模板与当前接诊就诊不一致，已拒绝启动语音问诊。', 'error');
      return false;
    }
    startContext.value = resolution.context;
    return true;
  }

  watch(
    () => getPatientContextAnchorId(options.currentPatient.value),
    (visitId) => {
      if (startContext.value && visitId !== startContext.value.visitId) clear();
    },
  );

  return {
    startContext: computed(() => startContext.value),
    hasTemplateContinuation: computed(() => Boolean(startContext.value)),
    deferredWritebackRequestId: computed(() => startContext.value?.template.requestId || ''),
    prepareFromStartVoice,
    clear,
  };
}

export type VoiceOutpatientEmrWorkflow = ReturnType<typeof useVoiceOutpatientEmrWorkflow>;
