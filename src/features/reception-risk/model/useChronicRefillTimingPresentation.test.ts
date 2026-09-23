// @vitest-environment jsdom
import { effectScope, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  useChronicRefillTimingPresentation,
  type ChronicRefillTimingPresentationState,
} from './useChronicRefillTimingPresentation';
import { chronicRefillTimingTracker } from './chronicRefillTimingTracker';

vi.mock('./chronicRefillTimingTracker', () => ({
  chronicRefillTimingTracker: { get: vi.fn() },
}));

const flush = async () => {
  await nextTick();
  await nextTick();
};

describe('chronic refill presentation timing readiness', () => {
  it('marks dom updates for core, review plan, treatments and finishes when ready', async () => {
    const timing = { mark: vi.fn(), finish: vi.fn(), span: vi.fn(), measure: vi.fn() };
    vi.mocked(chronicRefillTimingTracker.get).mockReturnValue(timing);
    const state = reactive<ChronicRefillTimingPresentationState>({
      sessionId: 'session-1',
      enabled: true,
      complete: false,
      failed: false,
      pending: true,
      coreReady: false,
      diagnosisCount: 0,
      reviewPlanReady: false,
      treatmentsReady: false,
    });
    const scope = effectScope();
    scope.run(() => useChronicRefillTimingPresentation(() => ({ ...state })));
    try {
      state.coreReady = true;
      state.reviewPlanReady = true;
      state.treatmentsReady = true;
      state.diagnosisCount = 1;
      await flush();

      expect(timing.mark).toHaveBeenCalledWith('record_core_dom_updated');
      expect(timing.mark).toHaveBeenCalledWith('review_plan_dom_updated');
      expect(timing.mark).toHaveBeenCalledWith('treatments_dom_updated');
      expect(timing.mark).toHaveBeenCalledWith('diagnoses_dom_updated', 1);

      state.complete = true;
      await flush();
      expect(timing.finish).not.toHaveBeenCalled(); // pending is still true

      state.pending = false;
      await flush();
      expect(timing.finish).toHaveBeenCalledWith('ready');
    } finally {
      scope.stop();
    }
  });

  it('finishes with failed when state.failed is true', async () => {
    const timing = { mark: vi.fn(), finish: vi.fn(), span: vi.fn(), measure: vi.fn() };
    vi.mocked(chronicRefillTimingTracker.get).mockReturnValue(timing);
    const state = reactive<ChronicRefillTimingPresentationState>({
      sessionId: 'session-2',
      enabled: true,
      complete: false,
      failed: false,
      pending: true,
      coreReady: false,
      diagnosisCount: 0,
    });
    const scope = effectScope();
    scope.run(() => useChronicRefillTimingPresentation(() => ({ ...state })));
    try {
      state.failed = true;
      await flush();
      expect(timing.finish).toHaveBeenCalledWith('failed');
    } finally {
      scope.stop();
    }
  });
});
