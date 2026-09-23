import { effectScope, nextTick, ref, watch } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { restoreVoiceEditorSnapshot } from './voiceEditorSnapshotRestoration';
import type { VoiceEditorSnapshot } from './voiceConsultationCache';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const snapshot: VoiceEditorSnapshot = {
  consultationRoundId: 'round-1',
  chiefComplaint: '医生已编辑的主诉',
  selectedDiagnosisIdentity: 'diagnosis-1',
  treatmentDiagnosisKey: 'diagnosis-1',
  treatments: [{ id: 'medicine-1', selected: false, dosage: '医生调整值' }],
};

describe('ordinary voice editor snapshot restoration', () => {
  it.each([{ items: snapshot.treatments }, { items: [] }])('holds automatic generation until async restoration settles (%j)', async ({ items }) => {
    const pharmacy = deferred();
    const inventory = deferred();
    const suppressed = ref(true);
    const treatmentKey = ref('');
    const treatments = ref<unknown[]>([]);
    const diagnosis = ref('');
    const generate = vi.fn();
    const diagnosisRefetch = vi.fn();
    const scope = effectScope();
    scope.run(() => {
      watch([suppressed, treatmentKey], () => {
        if (!suppressed.value && !treatmentKey.value) generate();
      }, { flush: 'post' });
      watch(diagnosis, () => {
        if (!suppressed.value) diagnosisRefetch();
      });
    });
    try {
      const apply = vi.fn(async (cached: VoiceEditorSnapshot) => {
        diagnosis.value = cached.selectedDiagnosisIdentity || '';
        await pharmacy.promise;
        treatments.value = cached.treatments || [];
        treatmentKey.value = cached.treatmentDiagnosisKey || '';
        await inventory.promise;
      });
      const done = restoreVoiceEditorSnapshot({
        channel: 'voice', source: 'llm', roundId: 'round-1',
        snapshot: { ...snapshot, treatments: items }, suppressed,
        isCurrent: () => true, apply,
      });
      await nextTick();
      expect(suppressed.value).toBe(true);
      expect(generate).not.toHaveBeenCalled();
      pharmacy.resolve();
      await nextTick();
      expect(suppressed.value).toBe(true);
      inventory.resolve();
      expect(await done).toBe(true);
      await nextTick();
      expect(suppressed.value).toBe(false);
      expect(treatments.value).toEqual(items);
      expect(treatmentKey.value).toBe('diagnosis-1');
      expect(generate).not.toHaveBeenCalled();
      expect(diagnosisRefetch).not.toHaveBeenCalled();
      expect(apply).toHaveBeenCalledOnce();
    } finally { scope.stop(); }
  });

  it.each([
    { source: 'llm' as const, roundId: 'round-2', cached: snapshot, restore: false },
    { source: 'llm' as const, roundId: null, cached: snapshot, restore: false },
    { source: 'llm' as const, roundId: 'round-1', cached: {}, restore: false },
    { source: 'llm' as const, roundId: 'round-1', cached: null, restore: false },
    { source: 'cache' as const, roundId: 'round-2', cached: snapshot, restore: true },
    { source: 'cache' as const, roundId: null, cached: {}, restore: true },
  ])('isolates rounds while preserving explicit cache restoration: %j', async ({ source, roundId, cached, restore }) => {
    const apply = vi.fn(async () => undefined);
    const suppressed = ref(true);
    await restoreVoiceEditorSnapshot({
      channel: 'voice', source, roundId, snapshot: cached, suppressed,
      isCurrent: () => true, apply,
    });
    expect(apply).toHaveBeenCalledTimes(restore ? 1 : 0);
    expect(suppressed.value).toBe(false); // Missing cache permits the existing generation fallback.
  });

  it.each(['chronic-refill', 'symptom', 'report-follow-up'])('does not touch %s state or load its snapshot', async (channel) => {
    const apply = vi.fn(async () => undefined);
    const suppressed = ref(false);
    expect(await restoreVoiceEditorSnapshot({
      channel, source: 'cache', roundId: 'round-1', snapshot, suppressed,
      isCurrent: () => true, apply,
    })).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(suppressed.value).toBe(false);
  });

  it('does not release the new session gate when an old restore completes late', async () => {
    const pending = deferred();
    const suppressed = ref(true);
    let current = true;
    const done = restoreVoiceEditorSnapshot({
      channel: 'voice', source: 'llm', roundId: 'round-1', snapshot, suppressed,
      isCurrent: () => current,
      apply: async (_snapshot, isCurrent) => {
        await pending.promise;
        expect(isCurrent()).toBe(false);
      },
    });
    current = false; // Patient / round changed or page unmounted while pharmacy was pending.
    pending.resolve();
    expect(await done).toBe(false);
    expect(suppressed.value).toBe(true);
  });
});
