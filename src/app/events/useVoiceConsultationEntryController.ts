import type { Ref } from 'vue';
import type { ViewType } from '@/constants/windowSizes';
import type { AppPatient } from '@/types/appState';
import { getPatientContextId, getPatientContextVisitId } from '@/utils/patientContext';
import { buildReceptionPatientDraft } from '@features/reception';
import { trackApiCall } from '@/services/operationTracker';
import { trackVoiceConsultationEntry } from '@/services/featureUsageEntryTracker';
import type { SessionAssistPayload } from './useReceptionController';

interface VoiceConsultationEntryOptions {
  currentPatient: Ref<AppPatient | null>;
  currentView: Ref<ViewType>;
  isWorking: Ref<boolean>;
  hasActiveVoiceResult: () => boolean;
  ensureReceptionContext: (payload: SessionAssistPayload | null) => Promise<boolean>;
  mergeCurrentPatient: (payload: SessionAssistPayload | null) => void;
  prepareVoiceOutpatientEmr?: (payload: unknown) => boolean | Promise<boolean>;
  refreshVoiceOutpatientEmr?: () => Promise<boolean>;
  clearVoiceOutpatientEmr?: () => void;
  openVoiceConsultation: () => Promise<void>;
  openVoiceEntry: () => Promise<unknown>;
}

/** Keeps repeated HIS entry requests from replacing an unfinished voice workspace. */
export function useVoiceConsultationEntryController(options: VoiceConsultationEntryOptions) {
  async function handleStartVoice(payload: SessionAssistPayload | null): Promise<void> {
    const incoming = buildReceptionPatientDraft(payload);
    const incomingPatientId = getPatientContextId(incoming);
    trackApiCall('his_start_voice', true, undefined, { patientId: incomingPatientId || undefined });

    const success = await options.ensureReceptionContext(payload);
    const hasActiveResult = options.hasActiveVoiceResult();
    const capturing = options.isWorking.value && options.currentView.value === 'voice-interaction';
    if (!success) {
      if (!capturing && !hasActiveResult) options.clearVoiceOutpatientEmr?.();
      return;
    }

    const incomingVisitId = getPatientContextVisitId(incoming);
    const sameEncounter = Boolean(getPatientContextId(options.currentPatient.value))
      && (!incomingPatientId || incomingPatientId === getPatientContextId(options.currentPatient.value))
      && (!incomingVisitId || incomingVisitId === getPatientContextVisitId(options.currentPatient.value));

    if (capturing) {
      if (sameEncounter) await options.refreshVoiceOutpatientEmr?.();
      return;
    }

    if (sameEncounter && hasActiveResult) {
      trackVoiceConsultationEntry({ patient: options.currentPatient.value, payload });
      // The Bridge already brings the window forward. Leave an open editor mounted.
      if (!options.isWorking.value || options.currentView.value !== 'voice-consultation') {
        await options.openVoiceConsultation();
      }
      return;
    }

    options.mergeCurrentPatient(payload);
    if (options.prepareVoiceOutpatientEmr && !await options.prepareVoiceOutpatientEmr(payload)) return;
    trackVoiceConsultationEntry({ patient: options.currentPatient.value, payload });
    await options.openVoiceEntry();
  }

  async function handleVoiceDeepLink(url: string): Promise<void> {
    let payload: SessionAssistPayload | null = null;
    try {
      const data = new URL(url).searchParams.get('data');
      if (data) {
        const decoded: unknown = JSON.parse(data);
        if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return;
        payload = decoded as SessionAssistPayload;
      }
    } catch (error) {
      console.warn('[VoiceEntry] Invalid voice deep link payload', error);
      return;
    }
    await handleStartVoice(payload);
  }

  return { handleStartVoice, handleVoiceDeepLink };
}
