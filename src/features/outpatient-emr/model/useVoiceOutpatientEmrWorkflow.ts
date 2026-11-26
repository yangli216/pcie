import { computed, shallowRef, watch, type Ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import { getPatientContextAnchorId, getPatientContextId } from '@/utils/patientContext';
import { getFeedbackActor } from '@/services/feedbackContext';
import { resolveVoiceOutpatientEmrStartContext } from '../lib/voiceOutpatientEmr';
import { prepareVoiceOutpatientRecognitionTemplate } from '../lib/voiceOutpatientEmrRecognition';
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

  async function prepareFromStartVoice(payload: unknown): Promise<boolean> {
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
    const displayOrgName = getFeedbackActor().orgName;
    const session = {
      ...resolution.context,
      ...(displayOrgName ? { displayOrgName } : {}),
    };
    startContext.value = session;
    return refreshTemplate();
  }

  async function refreshTemplate(): Promise<boolean> {
    const session = startContext.value;
    if (!session) return true;
    const patientId = getPatientContextId(options.currentPatient.value);
    const isCurrent = () => startContext.value === session
      && getPatientContextAnchorId(options.currentPatient.value) === session.visitId
      && getPatientContextId(options.currentPatient.value) === patientId;
    try {
      // Every accepted start reads the server, even for the same template and request.
      await prepareVoiceOutpatientRecognitionTemplate(session, [], isCurrent);
    } catch (error) {
      if (isCurrent()) {
        console.error('[VoiceOutpatientEmr] Template synchronization failed at voice start:', error);
        options.notify?.('门诊模板同步失败，可继续录音，确认转写后将重试。', 'error');
      }
    }
    return isCurrent();
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
    refreshTemplate,
    clear,
  };
}

export type VoiceOutpatientEmrWorkflow = ReturnType<typeof useVoiceOutpatientEmrWorkflow>;
