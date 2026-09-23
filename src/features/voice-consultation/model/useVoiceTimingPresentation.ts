import { nextTick, watch } from 'vue';
import { voiceTimingTracker } from './voiceTimingTracker';

export interface VoiceTimingPresentationState {
  round?: string | null;
  enabled: boolean;
  complete: boolean;
  failed: boolean;
  pending: boolean;
  coreReady: boolean;
  diagnosisCount: number;
  treatmentErrors: boolean;
}

export function useVoiceTimingPresentation(getState: () => VoiceTimingPresentationState) {
  watch(getState, async () => {
    const before = getState();
    if (!before.enabled) return;
    const timing = voiceTimingTracker.get(before.round);
    if (!timing) return;
    await nextTick();
    const state = getState();
    if (!state.enabled || state.round !== before.round) return;
    if (state.coreReady) timing.mark('record_core_dom_updated');
    if (state.diagnosisCount > 0) timing.mark('diagnoses_dom_updated', state.diagnosisCount);
    if (state.failed) timing.finish('failed');
    else if (state.complete && !state.pending) {
      timing.finish(state.treatmentErrors ? 'ready-with-errors' : 'ready');
    }
  }, { flush: 'post', immediate: true });
}
