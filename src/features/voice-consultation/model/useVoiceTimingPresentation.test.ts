// @vitest-environment jsdom
import { effectScope, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useVoiceTimingPresentation, type VoiceTimingPresentationState } from './useVoiceTimingPresentation';
import { voiceTimingTracker } from './voiceTimingTracker';

vi.mock('./voiceTimingTracker', () => ({ voiceTimingTracker: { get: vi.fn() } }));
const flush = async () => { await nextTick(); await nextTick(); };

describe('voice timing DOM readiness', () => {
  it('waits for final application and treatment, and supports an empty formal diagnosis result', async () => {
    const timing = { mark: vi.fn(), finish: vi.fn(), span: vi.fn() };
    vi.mocked(voiceTimingTracker.get).mockReturnValue(timing);
    const state = reactive<VoiceTimingPresentationState>({
      round: 'a', enabled: true, complete: false, failed: false, pending: true,
      coreReady: false, diagnosisCount: 0, treatmentErrors: false,
    });
    const scope = effectScope();
    scope.run(() => useVoiceTimingPresentation(() => ({ ...state })));
    try {
      state.coreReady = true;
      await flush();
      expect(timing.mark).toHaveBeenCalledWith('record_core_dom_updated');
      state.complete = true;
      await flush();
      expect(timing.finish).not.toHaveBeenCalled();
      state.pending = false;
      state.treatmentErrors = true;
      await flush();
      expect(timing.finish).toHaveBeenCalledWith('ready-with-errors');
      expect(timing.mark).not.toHaveBeenCalledWith('diagnoses_dom_updated', 0);
    } finally { scope.stop(); }
  });

  it('does not label a switched round, cache or non-voice page as rendered', async () => {
    const timing = { mark: vi.fn(), finish: vi.fn(), span: vi.fn() };
    vi.mocked(voiceTimingTracker.get).mockImplementation(round => round === 'a' ? timing : undefined);
    const state = reactive<VoiceTimingPresentationState>({
      round: 'a', enabled: true, complete: true, failed: false, pending: false,
      coreReady: true, diagnosisCount: 1, treatmentErrors: false,
    });
    const scope = effectScope();
    scope.run(() => useVoiceTimingPresentation(() => ({ ...state })));
    try {
      state.round = 'b';
      await flush();
      expect(timing.mark).not.toHaveBeenCalled();
      state.enabled = false;
      state.round = 'a';
      await flush();
      expect(timing.finish).not.toHaveBeenCalled();
      state.enabled = true;
      await flush();
      expect(timing.mark).toHaveBeenCalledWith('diagnoses_dom_updated', 1);
      expect(timing.finish).toHaveBeenCalledWith('ready');
    } finally { scope.stop(); }
  });
});
