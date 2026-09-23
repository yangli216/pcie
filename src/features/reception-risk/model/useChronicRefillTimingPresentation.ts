import { nextTick, watch } from 'vue';
import { chronicRefillTimingTracker } from './chronicRefillTimingTracker';

export interface ChronicRefillTimingPresentationState {
  sessionId?: string | null;
  enabled: boolean;
  complete: boolean;
  failed: boolean;
  pending: boolean;
  coreReady: boolean;
  diagnosisCount: number;
  reviewPlanReady?: boolean;
  treatmentsReady?: boolean;
}

export function useChronicRefillTimingPresentation(
  getState: () => ChronicRefillTimingPresentationState,
) {
  watch(
    getState,
    async () => {
      const before = getState();
      if (!before.enabled) return;
      const timing = chronicRefillTimingTracker.get(before.sessionId);
      if (!timing) return;

      await nextTick();
      const state = getState();
      if (!state.enabled || state.sessionId !== before.sessionId) return;

      if (state.coreReady) timing.mark('record_core_dom_updated');
      if (state.diagnosisCount > 0) timing.mark('diagnoses_dom_updated', state.diagnosisCount);
      if (state.reviewPlanReady) timing.mark('review_plan_dom_updated');
      if (state.treatmentsReady) timing.mark('treatments_dom_updated');

      if (state.failed) {
        timing.finish('failed');
      } else if (state.complete && !state.pending) {
        timing.finish('ready');
      }
    },
    { flush: 'post', immediate: true },
  );
}
