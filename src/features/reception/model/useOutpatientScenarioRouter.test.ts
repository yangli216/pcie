import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { HisOutpatientFollowUpContext } from '@/services/his/types';
import { buildPatientContext } from '@/utils/patientContext';
import {
  resolveOutpatientVoiceEntry,
  useOutpatientScenarioRouter,
} from './useOutpatientScenarioRouter';
import { useReceptionSessionController } from './useReceptionSessionController';

const followUpContext = {
  followUpEligible: true,
  source: { visitId: 'visit-0' },
  medicalRecordText: '既往门诊病历。',
  labReports: [],
  examReports: [{ examName: '胸部CT', conclusion: '未见明显异常。' }],
  ineligibleReason: null,
} as HisOutpatientFollowUpContext;

describe('resolveOutpatientVoiceEntry', () => {
  it('prioritizes cached voice results without querying follow-up context', async () => {
    const fetchFollowUpContext = vi.fn();

    await expect(resolveOutpatientVoiceEntry({
      hasCachedResult: true,
      fetchFollowUpContext,
    })).resolves.toEqual({ type: 'restore-voice-result' });
    expect(fetchFollowUpContext).not.toHaveBeenCalled();
  });

  it('routes eligible report follow-up and falls back to voice capture', async () => {
    await expect(resolveOutpatientVoiceEntry({
      hasCachedResult: false,
      fetchFollowUpContext: async () => followUpContext,
    })).resolves.toEqual({ type: 'report-follow-up', context: followUpContext });

    await expect(resolveOutpatientVoiceEntry({
      hasCachedResult: false,
      fetchFollowUpContext: async () => null,
    })).resolves.toEqual({ type: 'voice-capture' });
  });
});

describe('useOutpatientScenarioRouter', () => {
  it('allows entering report follow-up without AI interpretation and preserves one when available', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-1', name: '张建国' },
    }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('report-follow-up', { type: 'report-follow-up', context: followUpContext });
    const applyFollowUpContext = vi.fn();
    const openOutpatientFollowUp = vi.fn();
    const showToast = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      applyFollowUpContext,
      generateChronicRefillRecord: vi.fn(),
      beginGeneratedClinicalResult: vi.fn(),
      updateGeneratedClinicalResultProgress: vi.fn(),
      updateGeneratedClinicalResultPartial: vi.fn(),
      completeGeneratedClinicalResult: vi.fn(),
      failGeneratedClinicalResult: vi.fn(),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp,
      openReportInterpretation: vi.fn(),
      startVoiceInteraction: vi.fn(),
      showToast,
      trackError: vi.fn(),
    });

    await router.confirmFollowUp();
    expect(applyFollowUpContext).toHaveBeenCalledWith(followUpContext);
    expect(openOutpatientFollowUp).toHaveBeenCalledOnce();

    const assessment = { actionability: 'needs_follow_up' as const, summary: '建议复查', problems: [], medicationIntents: [] };
    await router.confirmFollowUp(assessment);

    expect(applyFollowUpContext).toHaveBeenCalledWith(expect.objectContaining({ assessment }));
    expect(openOutpatientFollowUp).toHaveBeenCalledTimes(2);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('opens the result workspace before waiting for the refill result and fills it in place', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-1',
        name: '张建国',
      },
    }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('chronic-refill', {
      type: 'chronic-refill',
      candidate: {
        diagnosis: '高血压',
        diagnoses: ['高血压'],
        diagnosisGroups: ['高血压'],
        medications: ['苯磺酸氨氯地平片'],
        chronicVisitCount: 1,
        chronicVisits: [],
        diagnosisEvidenceText: '近期历史就诊记录有“高血压”诊断',
        medicationEvidenceText: '历史用药记录：苯磺酸氨氯地平片',
        evidenceText: '近90天就诊中存在高血压慢病就诊和配药',
      },
    });

    const generatedResult = { channel: 'chronic-refill' } as any;
    let resolveGeneration!: (value: typeof generatedResult) => void;
    const generationPromise = new Promise<typeof generatedResult>((resolve) => {
      resolveGeneration = resolve;
    });
    const generateChronicRefillRecord = vi.fn(async (_patient, _candidate, generationOptions) => {
      generationOptions?.onProgress?.('generating-content');
      generationOptions?.onPartial?.({
        ...generatedResult,
        chiefComplaint: '高血压复诊配药',
        generation: { status: 'streaming', readySections: ['record_core'] },
      });
      const value = await generationPromise;
      generationOptions?.onProgress?.('finalizing-result');
      return value;
    });
    const beginGeneratedClinicalResult = vi.fn(async () => 'generation-1');
    const updateGeneratedClinicalResultProgress = vi.fn(() => true);
    const completeGeneratedClinicalResult = vi.fn(() => true);
    const updateGeneratedClinicalResultPartial = vi.fn(() => true);
    const showToast = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      fetchFollowUpContext: async () => null,
      applyFollowUpContext: vi.fn(),
      generateChronicRefillRecord,
      beginGeneratedClinicalResult,
      updateGeneratedClinicalResultProgress,
      updateGeneratedClinicalResultPartial,
      completeGeneratedClinicalResult,
      failGeneratedClinicalResult: vi.fn(() => true),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp: vi.fn(),
      openReportInterpretation: vi.fn(),
      startVoiceInteraction: vi.fn(),
      showToast,
      trackError: vi.fn(),
    });

    const confirmation = router.confirmChronicRefill();
    await vi.waitFor(() => expect(beginGeneratedClinicalResult).toHaveBeenCalledOnce());
    expect(completeGeneratedClinicalResult).not.toHaveBeenCalled();
    resolveGeneration(generatedResult);
    await confirmation;

    expect(generateChronicRefillRecord).toHaveBeenCalledWith(
      currentPatient.value,
      expect.objectContaining({ diagnoses: ['高血压'] }),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(beginGeneratedClinicalResult).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'chronic-refill',
      stage: 'preparing-context',
    }));
    expect(updateGeneratedClinicalResultProgress).toHaveBeenNthCalledWith(1, 'generation-1', {
      stage: 'generating-content',
      message: '正在生成高血压病历与核查项',
    });
    expect(updateGeneratedClinicalResultProgress).toHaveBeenNthCalledWith(2, 'generation-1', {
      stage: 'finalizing-result',
      message: '正在整理诊断与用药方案',
    });
    expect(updateGeneratedClinicalResultPartial).toHaveBeenCalledWith(
      'generation-1',
      expect.objectContaining({ chiefComplaint: '高血压复诊配药' }),
    );
    expect(completeGeneratedClinicalResult).toHaveBeenCalledWith('generation-1', generatedResult);
    expect(showToast).toHaveBeenCalledWith('复诊配药病历与核查项已生成，请核查后回写', 'success');
    expect(session.executingOpportunity.value).toBeNull();
  });

  it('routes an explicit multi-disease refill transcript into the existing single chronic stream', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-1', name: '张建国' },
    }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('chronic-refill', {
      type: 'chronic-refill',
      candidate: {
        diagnosis: '原发性高血压',
        diagnoses: ['原发性高血压', '前列腺增生'],
        diagnosisGroups: ['高血压', '前列腺增生'],
        medications: [],
        chronicVisitCount: 1,
        chronicVisits: [],
        diagnosisEvidenceText: '历史慢病诊断',
        medicationEvidenceText: '暂无历史用药',
        evidenceText: '历史慢病候选',
        conditions: [
          {
            id: '高血压',
            diagnosis: '原发性高血压',
            diagnosisGroup: '高血压',
            hasMedicationEvidence: false,
          },
          {
            id: '前列腺增生',
            diagnosis: '前列腺增生',
            diagnosisGroup: '前列腺增生',
            hasMedicationEvidence: false,
          },
        ],
      },
    });
    const generatedResult = { channel: 'chronic-refill' } as any;
    const generateChronicRefillRecord = vi.fn(async () => generatedResult);
    const startVoiceInteraction = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      applyFollowUpContext: vi.fn(),
      generateChronicRefillRecord,
      beginGeneratedClinicalResult: vi.fn(async () => 'voice-refill-session'),
      updateGeneratedClinicalResultProgress: vi.fn(() => true),
      updateGeneratedClinicalResultPartial: vi.fn(() => true),
      completeGeneratedClinicalResult: vi.fn(() => true),
      failGeneratedClinicalResult: vi.fn(() => true),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp: vi.fn(),
      openReportInterpretation: vi.fn(),
      startVoiceInteraction,
      showToast: vi.fn(),
      trackError: vi.fn(),
    });

    await expect(router.routeVoiceTranscript(
      '原发性高血压、前列腺增生今天来复诊配药',
    )).resolves.toBe(true);

    expect(generateChronicRefillRecord).toHaveBeenCalledWith(
      currentPatient.value,
      expect.objectContaining({
        diagnoses: ['原发性高血压', '前列腺增生'],
        diagnosisGroups: ['高血压', '前列腺增生'],
      }),
      expect.objectContaining({ entrySource: 'voice-transcript' }),
    );
    expect(startVoiceInteraction).not.toHaveBeenCalled();
  });

  it('returns ambiguous multi-disease refill speech to the existing scope selector without a model call', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-1', name: '张建国' },
    }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('chronic-refill', {
      type: 'chronic-refill',
      candidate: {
        diagnosis: '原发性高血压',
        diagnoses: ['原发性高血压', '前列腺增生'],
        diagnosisGroups: ['高血压', '前列腺增生'],
        medications: [],
        chronicVisitCount: 1,
        chronicVisits: [],
        diagnosisEvidenceText: '历史慢病诊断',
        medicationEvidenceText: '暂无历史用药',
        evidenceText: '历史慢病候选',
        conditions: [
          { id: '高血压', diagnosis: '原发性高血压', diagnosisGroup: '高血压', hasMedicationEvidence: false },
          { id: '前列腺增生', diagnosis: '前列腺增生', diagnosisGroup: '前列腺增生', hasMedicationEvidence: false },
        ],
      },
    });
    const generateChronicRefillRecord = vi.fn();
    const requestChronicRefillScopeSelection = vi.fn(async () => undefined);
    const resetVoiceSessionState = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      applyFollowUpContext: vi.fn(),
      generateChronicRefillRecord,
      beginGeneratedClinicalResult: vi.fn(),
      updateGeneratedClinicalResultProgress: vi.fn(),
      updateGeneratedClinicalResultPartial: vi.fn(),
      completeGeneratedClinicalResult: vi.fn(),
      failGeneratedClinicalResult: vi.fn(),
      resetVoiceSessionState,
      openOutpatientFollowUp: vi.fn(),
      openReportInterpretation: vi.fn(),
      startVoiceInteraction: vi.fn(),
      requestChronicRefillScopeSelection,
      showToast: vi.fn(),
      trackError: vi.fn(),
    });

    await expect(router.routeVoiceTranscript('今天来复诊配药')).resolves.toBe(true);

    expect(requestChronicRefillScopeSelection).toHaveBeenCalledOnce();
    expect(resetVoiceSessionState).toHaveBeenCalledOnce();
    expect(generateChronicRefillRecord).not.toHaveBeenCalled();
  });

  it('routes voice entry to report follow-up when HIS context is available', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-1',
        name: '张建国',
      },
    }));
    currentPatient.value!.hasReportedLabOrExamResults = true;
    const session = useReceptionSessionController(currentPatient);
    const applyFollowUpContext = vi.fn();
    const openOutpatientFollowUp = vi.fn();
    const openReportInterpretation = vi.fn();
    const startVoiceInteraction = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      fetchFollowUpContext: async () => followUpContext,
      applyFollowUpContext,
      generateChronicRefillRecord: vi.fn(),
      beginGeneratedClinicalResult: vi.fn(),
      updateGeneratedClinicalResultProgress: vi.fn(),
      updateGeneratedClinicalResultPartial: vi.fn(),
      completeGeneratedClinicalResult: vi.fn(),
      failGeneratedClinicalResult: vi.fn(),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp,
      openReportInterpretation,
      startVoiceInteraction,
      showToast: vi.fn(),
      trackError: vi.fn(),
    });

    await expect(router.openVoiceEntry()).resolves.toEqual({
      type: 'report-follow-up',
      context: followUpContext,
    });

    expect(applyFollowUpContext).not.toHaveBeenCalled();
    expect(openOutpatientFollowUp).not.toHaveBeenCalled();
    expect(openReportInterpretation).toHaveBeenCalledOnce();
    expect(startVoiceInteraction).not.toHaveBeenCalled();
    expect(session.getOpportunity('report-follow-up')).toEqual({
      type: 'report-follow-up',
      context: followUpContext,
    });
  });

  it('starts normal voice entry without querying follow-up context when no report is finished', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-1',
        name: '张建国',
      },
    }));
    const session = useReceptionSessionController(currentPatient);
    const fetchFollowUpContext = vi.fn(async () => followUpContext);
    const startVoiceInteraction = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      fetchFollowUpContext,
      applyFollowUpContext: vi.fn(),
      generateChronicRefillRecord: vi.fn(),
      beginGeneratedClinicalResult: vi.fn(),
      updateGeneratedClinicalResultProgress: vi.fn(),
      updateGeneratedClinicalResultPartial: vi.fn(),
      completeGeneratedClinicalResult: vi.fn(),
      failGeneratedClinicalResult: vi.fn(),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp: vi.fn(),
      openReportInterpretation: vi.fn(),
      startVoiceInteraction,
      showToast: vi.fn(),
      trackError: vi.fn(),
    });

    await expect(router.openVoiceEntry()).resolves.toEqual({ type: 'voice-capture' });

    expect(fetchFollowUpContext).not.toHaveBeenCalled();
    expect(startVoiceInteraction).toHaveBeenCalledWith({ skipCacheRestore: true });
  });

  it('opens the report workspace for a historical report opportunity', async () => {
    const currentPatient = ref(buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-1', name: '张建国' },
    }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('report-interpretation', {
      type: 'report-interpretation',
      visits: [{
        visitId: 'history-1',
        visitTime: Date.now(),
        reportedApplications: [{
          applicationId: 'apply-1',
          name: '血常规',
          type: 'lab',
          status: 'reported',
        }],
      }],
    });
    const openReportInterpretation = vi.fn();
    const router = useOutpatientScenarioRouter({
      currentPatient,
      session,
      hasCachedVoiceResult: () => false,
      applyFollowUpContext: vi.fn(),
      generateChronicRefillRecord: vi.fn(),
      beginGeneratedClinicalResult: vi.fn(),
      updateGeneratedClinicalResultProgress: vi.fn(),
      updateGeneratedClinicalResultPartial: vi.fn(),
      completeGeneratedClinicalResult: vi.fn(),
      failGeneratedClinicalResult: vi.fn(),
      resetVoiceSessionState: vi.fn(),
      openOutpatientFollowUp: vi.fn(),
      openReportInterpretation,
      startVoiceInteraction: vi.fn(),
      showToast: vi.fn(),
      trackError: vi.fn(),
    });

    await router.confirmReportAssistant();

    expect(openReportInterpretation).toHaveBeenCalledOnce();
    expect(session.executingOpportunity.value).toBeNull();
  });
});


describe('chronic examination late result isolation', () => {
  it.each(['patient', 'visit', 'opportunity'] as const)('does not commit recommendations after %s changes', async (change) => {
    const currentPatient = ref(buildPatientContext({ payload: { patientId: 'p', visitId: 'v' } }));
    const session = useReceptionSessionController(currentPatient);
    session.replaceOpportunity('chronic-refill', { type: 'chronic-refill', candidate: {
      diagnosis: '高血压', diagnoses: ['高血压'], diagnosisGroups: ['高血压'], medications: [], chronicVisitCount: 1,
      chronicVisits: [], diagnosisEvidenceText: '', medicationEvidenceText: '', evidenceText: '',
    } });
    let finish!: (value: any) => void;
    const complete = vi.fn(() => true);
    const partial = vi.fn(() => true);
    let emitPartial: ((result: any) => void) | undefined;
    const generate = vi.fn(async (_patient, _candidate, options) => {
      emitPartial = options?.onPartial;
      return new Promise<any>((resolve) => { finish = resolve; });
    });
    const router = useOutpatientScenarioRouter({ currentPatient, session, hasCachedVoiceResult: () => false,
      applyFollowUpContext: vi.fn(), generateChronicRefillRecord: generate,
      beginGeneratedClinicalResult: vi.fn(async () => 'session'), updateGeneratedClinicalResultProgress: vi.fn(() => true),
      updateGeneratedClinicalResultPartial: partial, completeGeneratedClinicalResult: complete,
      failGeneratedClinicalResult: vi.fn(() => true), resetVoiceSessionState: vi.fn(), openOutpatientFollowUp: vi.fn(),
      openReportInterpretation: vi.fn(), startVoiceInteraction: vi.fn(), showToast: vi.fn(), trackError: vi.fn(),
    });
    const pending = router.confirmChronicRefill();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    if (change === 'opportunity') session.replaceOpportunity('chronic-refill', null);
    else currentPatient.value = buildPatientContext({ payload: { patientId: change === 'patient' ? 'other' : 'p', visitId: 'new-visit' } });
    const result = { channel: 'chronic-refill', chronicExaminationReminders: { sourceStatus: 'ready', items: [{ name: '旧患者推荐' }] } };
    emitPartial?.(result);
    finish(result);
    await pending;
    expect(complete).not.toHaveBeenCalled();
    expect(partial).not.toHaveBeenCalled();
  });
});
