import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const mocks = vi.hoisted(() => ({
  clearTranscripts: vi.fn(),
  addTranscript: vi.fn(),
  processTranscript: vi.fn(),
  persistCache: vi.fn(),
  clearCache: vi.fn(),
  invoke: vi.fn(),
  timing: { mark: vi.fn(), span: vi.fn(), finish: vi.fn() },
  getPatientContextPersonalHistory: vi.fn(() => '吸烟20年。'),
  getPatientContextFamilyHistory: vi.fn(() => '父亲有高血压病史。'),
  getPatientContextMenstrualHistory: vi.fn(() => '周期28天。'),
  getPatientContextMaritalReproductiveHistory: vi.fn(() => '已婚已育；未孕。'),
  getPatientContextGenderText: vi.fn(() => '女性'),
  getPatientContextAgeText: vi.fn(() => '8岁'),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@services/operationTracker', () => ({
  trackClick: vi.fn(), trackError: vi.fn(), trackRecommendationAction: vi.fn(),
}));
vi.mock('@services/consultationUserLog', () => ({ submitConsultationUserLog: vi.fn() }));
vi.mock('@/utils/patientContext', () => ({
  getPatientContextAllergyHistory: vi.fn(() => ''),
  getPatientContextAgeText: mocks.getPatientContextAgeText,
  getPatientContextCurrentMedicationHistory: vi.fn(() => ''),
  getPatientContextFamilyHistory: mocks.getPatientContextFamilyHistory,
  getPatientContextGenderText: mocks.getPatientContextGenderText,
  getPatientContextMenstrualHistory: mocks.getPatientContextMenstrualHistory,
  getPatientContextMaritalReproductiveHistory: mocks.getPatientContextMaritalReproductiveHistory,
  getPatientContextPastMedicalHistory: vi.fn(() => ''),
  getPatientContextPersonalHistory: mocks.getPatientContextPersonalHistory,
}));
vi.mock('@shared/lib/errorMessages', () => ({ formatUserFacingError: vi.fn(() => 'error') }));
vi.mock('@features/clinical-result', () => ({
  cloneClinicalResultInput: vi.fn((value) => value),
  isFemaleHistoryEligible: vi.fn(({ gender, ageText }) => (
    gender === '女性' && Number.parseFloat(ageText) >= 14 && Number.parseFloat(ageText) < 60
  )),
}));
vi.mock('@features/voice-consultation', () => ({
  voiceTimingTracker: { start: vi.fn(() => mocks.timing) },
  clearVoiceConsultationCacheById: mocks.clearCache,
  hasVoiceConsultationCache: vi.fn(() => false),
  loadVoiceConsultationCacheEntry: vi.fn(() => null),
  persistVoiceConsultationCacheEntry: mocks.persistCache,
  resolveVoiceConsultationId: vi.fn(() => 'visit-1'),
  useVoiceIntentRecognition: vi.fn(() => ({
    clearTranscripts: mocks.clearTranscripts,
    addTranscript: mocks.addTranscript,
    processTranscript: mocks.processTranscript,
    processingError: ref(null),
  })),
}));

import { useVoiceConsultation } from './useVoiceConsultation';

const result = {
  chiefComplaint: '咳嗽2天',
  historyOfPresentIllness: '受凉后咳嗽',
  pastMedicalHistory: '',
  allergyHistory: '',
  currentMedicationHistory: '',
  familyHistory: '',
  symptoms: [],
  negativeSymptoms: [],
  diagnoses: [],
  treatments: [],
  treatmentPlan: '',
  healthEducation: '',
  generation: { status: 'complete' as const, readySections: [] },
};

describe('useVoiceConsultation result navigation ordering', () => {
  it('opens the result view before enabling processing state', async () => {
    let currentView = 'voice-interaction';
    let api: ReturnType<typeof useVoiceConsultation>;
    const openVoiceConsultation = vi.fn(async () => {
      expect(api.isProcessingVoice.value).toBe(false);
      currentView = 'voice-consultation';
    });
    mocks.processTranscript.mockImplementation(async () => {
      expect(currentView).toBe('voice-consultation');
      expect(api.isProcessingVoice.value).toBe(true);
      return result;
    });

    api = useVoiceConsultation({
      currentPatient: ref({ idPi: 'patient-1' } as never),
      showToast: vi.fn(),
      openVoiceConsultation,
      workMode: { exitWork: vi.fn(async () => undefined) },
    });

    await api.handleVoiceStop(new Blob(['voice']), '真实语音文本');

    expect(openVoiceConsultation).toHaveBeenCalledTimes(1);
    expect(mocks.processTranscript).toHaveBeenCalledTimes(1);
    expect(mocks.processTranscript).toHaveBeenCalledWith('真实语音文本', expect.objectContaining({
      patientContext: expect.objectContaining({
        personalHistory: '吸烟20年。',
        menstrualHistory: null,
        maritalReproductiveHistory: null,
        familyHistory: '父亲有高血压病史。',
        gender: '女性',
        ageText: '8岁',
      }),
    }));
    expect(api.isProcessingVoice.value).toBe(false);
    expect(api.intentResult.value?.chiefComplaint).toBe('咳嗽2天');
    expect(mocks.processTranscript.mock.calls[0][1].timing).toBe(mocks.timing);
    expect(mocks.timing.mark).toHaveBeenCalledWith('window_and_skeleton_ready');
    expect(mocks.timing.finish).not.toHaveBeenCalled();
  });

  it('creates a user-log round for a non-voice generated clinical result', async () => {
    const api = useVoiceConsultation({
      currentPatient: ref({ idPi: 'patient-1' } as never),
      showToast: vi.fn(),
      openVoiceConsultation: vi.fn(async () => undefined),
      workMode: { exitWork: vi.fn(async () => undefined) },
    });

    await api.showGeneratedClinicalResult(result);

    expect(api.consultationRoundId.value).toMatch(/[0-9a-f-]{36}/u);
    expect(api.intentResult.value?.chiefComplaint).toBe('咳嗽2天');
  });

  it('abandons the capture without exiting work so App can return to the patient capsule', async () => {
    const exitWork = vi.fn(async () => undefined);
    const api = useVoiceConsultation({
      currentPatient: ref({ idPi: 'patient-1' } as never),
      showToast: vi.fn(),
      openVoiceConsultation: vi.fn(async () => undefined),
      workMode: { exitWork },
    });
    await api.showGeneratedClinicalResult(result);

    await api.abandonVoiceCapture();

    expect(api.intentResult.value).toBeNull();
    expect(api.consultationRoundId.value).toBeNull();
    expect(mocks.clearCache).toHaveBeenCalledWith('visit-1');
    expect(mocks.invoke).toHaveBeenCalledWith('complete_consultation', expect.objectContaining({
      result: expect.objectContaining({
        resultType: 'cancelled',
        reason: '用户主动放弃语音问诊采集',
      }),
    }));
    expect(exitWork).not.toHaveBeenCalled();
  });
});
