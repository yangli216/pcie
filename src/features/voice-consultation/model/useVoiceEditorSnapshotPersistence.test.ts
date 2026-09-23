import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import { useVoiceEditorSnapshotPersistence } from './useVoiceEditorSnapshotPersistence';

describe('voice editor snapshot persistence', () => {
  afterEach(() => vi.useRealTimers());

  it('flushes the latest edits immediately before unmount instead of losing the debounce', () => {
    vi.useFakeTimers();
    let text = 'initial';
    const persist = vi.fn();
    const patient = { idPi: 'patient-1', idVis: 'visit-1' } as AppPatient;
    const controller = useVoiceEditorSnapshotPersistence({
      getPatient: () => patient, shouldPersist: () => true,
      getSnapshot: () => ({ chiefComplaint: text, consultationRoundId: 'round-1' }), persist,
    });
    controller.schedulePersistEditorSnapshot();
    text = 'latest edit';
    controller.persistEditorSnapshotImmediate();
    controller.clearPendingSnapshotPersist();
    vi.runAllTimers();
    expect(persist).toHaveBeenCalledExactlyOnceWith(patient, {
      chiefComplaint: 'latest edit', consultationRoundId: 'round-1',
    });
  });

  it('does not overwrite a saved snapshot during restoration or after context invalidation', () => {
    vi.useFakeTimers();
    let allowed = true;
    const persist = vi.fn();
    const controller = useVoiceEditorSnapshotPersistence({
      getPatient: () => ({ idPi: 'patient-1' } as AppPatient),
      shouldPersist: () => allowed, getSnapshot: () => ({ treatments: [] }), persist,
    });
    controller.schedulePersistEditorSnapshot();
    allowed = false;
    vi.runAllTimers();
    controller.persistEditorSnapshotImmediate();
    expect(persist).not.toHaveBeenCalled();
  });
});
