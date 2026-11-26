// @vitest-environment jsdom
import { ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewType } from '@/constants/windowSizes';
import { buildPatientContext } from '@/utils/patientContext';
import type { ClinicalResultInput } from '@features/clinical-result';
import { useGeneratedClinicalResultSession } from '@features/consultation-result/model/useGeneratedClinicalResultSession';
import { useVoiceConsultationEntryController } from './useVoiceConsultationEntryController';

vi.mock('@/services/operationTracker', () => ({ trackApiCall: vi.fn() }));
vi.mock('@/services/featureUsageEntryTracker', () => ({ trackVoiceConsultationEntry: vi.fn() }));

const patient = { idPi: 'SYN-P1', idVis: 'SYN-V1' };

function setup(view: ViewType = 'voice-consultation', working = true) {
  const currentPatient = ref(buildPatientContext({ payload: patient, receptionEnsured: true }));
  const currentView = ref(view);
  const isWorking = ref(working);
  const intentResult = ref<ClinicalResultInput | null>(null);
  const intentSource = ref<'llm' | 'cache' | null>(null);
  const consultationRoundId = ref<string | null>(null);
  const reset = vi.fn(() => {
    intentResult.value = null;
    intentSource.value = null;
    consultationRoundId.value = null;
  });
  const generation = useGeneratedClinicalResultSession({
    intentResult, intentSource, consultationRoundId,
    resetCurrentSession: reset,
    openResultView: async () => {},
    cloneResult: value => ({ ...value }),
  });
  const options = {
    currentPatient, currentView, isWorking,
    hasActiveVoiceResult: () => intentResult.value !== null,
    ensureReceptionContext: vi.fn(async () => true),
    mergeCurrentPatient: vi.fn(),
    prepareVoiceOutpatientEmr: vi.fn(async () => true),
    refreshVoiceOutpatientEmr: vi.fn(async () => true),
    clearVoiceOutpatientEmr: vi.fn(),
    openVoiceConsultation: vi.fn(async () => {
      currentView.value = 'voice-consultation';
      isWorking.value = true;
    }),
    openVoiceEntry: vi.fn(async () => {}),
  };
  return {
    ...options, ...useVoiceConsultationEntryController(options),
    intentResult, intentSource, consultationRoundId, generation, reset,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('repeated voice entry', () => {
  it.each([
    { name: 'visible results', view: 'voice-consultation', working: true },
    { name: 'floating ball', view: 'voice-consultation', working: false },
    { name: 'reception capsule', view: 'reception-capsule', working: true },
  ] as const)(
    'keeps an unfinished generation and its round when reopening from $name', async ({ view, working }) => {
      const ctx = setup(view, working);
      const round = await ctx.generation.begin({ channel: 'voice', message: '合成病历生成中' });
      ctx.generation.updatePartial(round, {
        ...ctx.intentResult.value!, chiefComplaint: '合成主诉',
        generation: { status: 'streaming', readySections: ['record_core'] },
      });
      const intermediate = ctx.intentResult.value;
      const patientBefore = ctx.currentPatient.value;
      for (const payload of [patient, null, { patientId: patient.idPi }, {
        ...patient, outpatientEmr: { requestId: 'SYN-NEW-REQUEST', templateId: 'SYN-NEW-TEMPLATE' },
      }]) await ctx.handleStartVoice(payload);

      expect(ctx.intentResult.value).toBe(intermediate);
      expect(ctx.currentPatient.value).toBe(patientBefore);
      expect(ctx.consultationRoundId.value).toBe(round);
      expect(ctx.reset).toHaveBeenCalledTimes(1);
      expect(ctx.currentView.value).toBe('voice-consultation');
      expect(ctx.openVoiceConsultation).toHaveBeenCalledTimes(view === 'voice-consultation' && working ? 0 : 1);
      expect(ctx.mergeCurrentPatient).not.toHaveBeenCalled();
      expect(ctx.prepareVoiceOutpatientEmr).not.toHaveBeenCalled();
      expect(ctx.refreshVoiceOutpatientEmr).not.toHaveBeenCalled();
      expect(ctx.clearVoiceOutpatientEmr).not.toHaveBeenCalled();
      expect(ctx.openVoiceEntry).not.toHaveBeenCalled();
      // Original asynchronous work can still finish after the repeated entry.
      expect(ctx.generation.complete(round, { ...intermediate!, chiefComplaint: '合成病历完成' })).toBe(true);
      expect(ctx.intentResult.value?.chiefComplaint).toBe('合成病历完成');
    },
  );

  it.each(['complete', 'error'] as const)('preserves a %s result until the encounter ends', async (status) => {
    const ctx = setup();
    const round = await ctx.generation.begin({ channel: 'voice', message: '生成中' });
    const edited = { ...ctx.intentResult.value!, chiefComplaint: '医生已修改的合成主诉' };
    if (status === 'complete') ctx.generation.complete(round, edited);
    else {
      ctx.generation.updatePartial(round, edited);
      ctx.generation.fail(round, '部分内容生成失败');
    }
    const before = ctx.intentResult.value;
    await ctx.handleStartVoice(patient);
    expect(ctx.intentResult.value).toBe(before);
    expect(ctx.openVoiceEntry).not.toHaveBeenCalled();
    expect(ctx.prepareVoiceOutpatientEmr).not.toHaveBeenCalled();

    ctx.reset(); // Existing stop/cancel path clears the active result.
    await ctx.handleStartVoice(patient);
    expect(ctx.prepareVoiceOutpatientEmr).toHaveBeenCalledOnce();
    expect(ctx.openVoiceEntry).toHaveBeenCalledOnce();
  });

  it('does not reuse the previous visit result for another explicit visit', async () => {
    const ctx = setup();
    await ctx.generation.begin({ channel: 'voice', message: '生成中' });
    const next = { ...patient, idVis: 'SYN-V2' };
    await ctx.handleStartVoice(next);
    expect(ctx.openVoiceConsultation).not.toHaveBeenCalled();
    expect(ctx.mergeCurrentPatient).toHaveBeenCalledWith(next);
    expect(ctx.prepareVoiceOutpatientEmr).toHaveBeenCalledWith(next);
    expect(ctx.openVoiceEntry).toHaveBeenCalledOnce();
  });

  it('leaves an active result and template intact when reception rejects another patient', async () => {
    const ctx = setup('voice-consultation', false);
    await ctx.generation.begin({ channel: 'voice', message: '生成中' });
    const before = ctx.intentResult.value;
    ctx.ensureReceptionContext.mockResolvedValueOnce(false);
    await ctx.handleStartVoice({ idPi: 'SYN-P2', idVis: 'SYN-V2' });
    expect(ctx.intentResult.value).toBe(before);
    expect(ctx.clearVoiceOutpatientEmr).not.toHaveBeenCalled();
    expect(ctx.openVoiceConsultation).not.toHaveBeenCalled();
    expect(ctx.openVoiceEntry).not.toHaveBeenCalled();
  });

  it('keeps capture and transcription review on their existing capsule', async () => {
    const ctx = setup('voice-interaction');
    await ctx.handleStartVoice(patient);
    expect(ctx.refreshVoiceOutpatientEmr).toHaveBeenCalledOnce();
    await ctx.handleStartVoice({ ...patient, idVis: 'SYN-V2' });
    expect(ctx.refreshVoiceOutpatientEmr).toHaveBeenCalledOnce();
    expect(ctx.prepareVoiceOutpatientEmr).not.toHaveBeenCalled();
    expect(ctx.openVoiceEntry).not.toHaveBeenCalled();
    expect(ctx.currentView.value).toBe('voice-interaction');
  });

  it('uses the same encounter check for protocol launch and ignores malformed deep links', async () => {
    const ctx = setup();
    const round = await ctx.generation.begin({ channel: 'voice', message: '生成中' });
    await ctx.handleVoiceDeepLink(`med-hermes://voice-consultation?data=${encodeURIComponent(JSON.stringify(patient))}`);
    await ctx.handleVoiceDeepLink('med-hermes://voice-consultation?data=%5B%5D');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await ctx.handleVoiceDeepLink('med-hermes://voice-consultation?data=%7B');
    } finally {
      warning.mockRestore();
    }
    expect(ctx.ensureReceptionContext).toHaveBeenCalledOnce();
    expect(ctx.consultationRoundId.value).toBe(round);
    expect(ctx.prepareVoiceOutpatientEmr).not.toHaveBeenCalled();
    expect(ctx.openVoiceEntry).not.toHaveBeenCalled();
  });
});
