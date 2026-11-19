import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { AppPatient } from '@/types/appState';

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
  getVoiceConsultationCacheScope: (patient: { idPi: string }) => patient.idPi,
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

import * as templates from '@features/outpatient-emr/lib/voiceOutpatientEmrRecognition';
import { loadVoiceConsultationCacheEntry } from '@features/voice-consultation';
import type { OutpatientEmrTemplateField, VoiceOutpatientEmrStartContext } from '@features/outpatient-emr/types';
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

  it('does not expose or cache a late result after a different patient reuses the visit', async () => {
    const patient = ref<AppPatient>({ patientId: 'SYN-A', visitId: 'visit-1', patientName: '合成患者',
      identity: { patientId: 'SYN-A', visitId: 'visit-1' }, demographics: { patientName: '合成患者' },
      clinical: {}, idPi: 'SYN-A', idVis: 'visit-1' });
    const priorWrites = mocks.persistCache.mock.calls.length;
    let finish!: (value: typeof result) => void;
    const model = vi.fn(() => new Promise<typeof result>(resolve => { finish = resolve; }));
    mocks.processTranscript.mockImplementationOnce(model);
    const api = useVoiceConsultation({
      currentPatient: patient, showToast: vi.fn(), openVoiceConsultation: async () => {},
      workMode: { exitWork: vi.fn(async () => undefined) },
    });
    const pending = api.handleVoiceStop(new Blob([]), '首位患者的合成文字');
    await vi.waitFor(() => expect(model).toHaveBeenCalled());
    patient.value = { ...patient.value, patientId: 'SYN-B', idPi: 'SYN-B',
      identity: { patientId: 'SYN-B', visitId: 'visit-1' } };
    finish(result);
    await pending;
    expect(api.intentResult.value).toBeNull();
    expect(api.isProcessingVoice.value).toBe(false);
    expect(mocks.persistCache.mock.calls).toHaveLength(priorWrites);
  });

  it('lets a deterministic follow-up route consume the transcript before ordinary voice generation', async () => {
    const ordinaryProcessCallCount = mocks.processTranscript.mock.calls.length;
    const routeVoiceTranscript = vi.fn(async () => true);
    const openVoiceConsultation = vi.fn(async () => undefined);
    const api = useVoiceConsultation({
      currentPatient: ref({ idPi: 'patient-1' } as never),
      showToast: vi.fn(),
      openVoiceConsultation,
      routeVoiceTranscript,
      workMode: { exitWork: vi.fn(async () => undefined) },
    });

    await api.handleVoiceStop(
      new Blob(['voice']),
      '原发性高血压、前列腺增生今天来复诊配药',
    );

    expect(routeVoiceTranscript).toHaveBeenCalledWith('原发性高血压、前列腺增生今天来复诊配药');
    expect(mocks.processTranscript).toHaveBeenCalledTimes(ordinaryProcessCallCount);
    expect(openVoiceConsultation).not.toHaveBeenCalled();
    expect(api.consultationRoundId.value).toBeNull();
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
    expect(mocks.clearCache).toHaveBeenCalledWith('visit-1', 'patient-1');
    expect(mocks.invoke).toHaveBeenCalledWith('complete_consultation', expect.objectContaining({
      result: expect.objectContaining({
        resultType: 'cancelled',
        reason: '用户主动放弃语音问诊采集',
      }),
    }));
    expect(exitWork).not.toHaveBeenCalled();
  });
});

function templateRound() {
  const session: VoiceOutpatientEmrStartContext = {
    visitId: 'visit-1',
    template: { templateId: 'SYN-TPL', templateName: '合成模板', requestId: 'SYN-REQ',
      targetFieldIds: ['合成字段'], templateHtml: '<p>合成</p>', templateDefinition: '[]' },
  };
  const prepared: templates.VoiceOutpatientRecognitionTemplate = {
    identity: { visitId: 'visit-1', templateId: 'SYN-TPL', requestId: 'SYN-REQ', targetFieldIds: ['合成字段'], templateHash: 'a'.repeat(64) },
    fields: [], chapters: [], fieldRules: '', promptData: { fields: [], chapters: [] },
  };
  const current = ref<VoiceOutpatientEmrStartContext | null>(session);
  const openVoiceConsultation = vi.fn(async () => undefined);
  const api = useVoiceConsultation({
    currentPatient: ref({ idPi: 'patient-1' } as never), voiceOutpatientEmrContext: current,
    showToast: vi.fn(), openVoiceConsultation, workMode: { exitWork: vi.fn(async () => undefined) },
  });
  return { current, api, prepared, openVoiceConsultation };
}

describe('confirmed voice transcript template preparation', () => {
  it('offers a cached result only for the current outpatient binding', () => {
    const { api, current, prepared } = templateRound();
    const cached = { consultationId: 'visit-1', transcribedText: '相同转写', savedAt: Date.now(), ownerScope: 'patient-1' };
    const draft = { ...prepared.identity, fieldValues: {} };
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({ ...cached, intentResult: result });
    expect(api.hasCachedVoiceResult()).toBe(false);
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({ ...cached, intentResult: { ...result, voiceTemplateDraft: draft } });
    expect(api.hasCachedVoiceResult()).toBe(true);
    current.value = null;
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({ ...cached, intentResult: { ...result, voiceTemplateDraft: draft } });
    expect(api.hasCachedVoiceResult()).toBe(false);
  });

  it('publishes a prepared document even with zero clinical chapters before the first model progress', async () => {
    const { api, prepared } = templateRound();
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockResolvedValueOnce(prepared);
    try {
      const document = { ...prepared.identity, chapters: [] };
      mocks.processTranscript.mockImplementationOnce(async () => {
        expect(api.intentResult.value?.voiceTemplateDocument).toEqual(document);
        expect(api.intentResult.value?.voiceTemplateDraft).toBeUndefined();
        return { ...result, voiceTemplateDocument: document, voiceTemplateDraft: { ...prepared.identity, fieldValues: {} } };
      });
      await api.handleVoiceStop(new Blob(['audio']), '零章合成转写');
      expect(api.intentResult.value?.voiceTemplateDocument).toEqual(document);
    } finally { prepare.mockRestore(); }
  });

  it('opens a matching legacy field cache as a source document without generating a second time', async () => {
    const { api, prepared } = templateRound();
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockResolvedValueOnce(prepared);
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({
      consultationId: 'visit-1', transcribedText: '旧缓存转写', savedAt: Date.now(), ownerScope: 'patient-1',
      intentResult: { ...result, voiceTemplateDraft: { ...prepared.identity, fieldValues: {} } },
    });
    try {
      await expect(api.resumeCachedVoiceResult()).resolves.toBe(true);
      expect(api.intentResult.value?.voiceTemplateDocument).toEqual({ ...prepared.identity, chapters: [] });
      expect(mocks.processTranscript).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); }
  });

  it.each(['resume', 'same transcript'] as const)('rebuilds cached composite prose from its verified leaves via %s', async mode => {
    const { api, prepared, current } = templateRound();
    const duration: OutpatientEmrTemplateField = { id: 'duration', name: '持续时间', type: 'text', articleId: '现病史',
      articleTemplateId: 'history', articleName: '现病史', articleDefinitionName: '现病史', readonly: false, aiSuitable: true,
      baselineValue: '', baselineDictionaryValue: '', dictionaryItems: [], recordField: 'historyOfPresentIllness',
      mappingSource: 'manual-override', projectionMode: 'section-compose' };
    const unit = { ...duration, id: 'unit', name: '时间单位', type: 'select', dictionaryItems: [{ value: 'D', text: '天' }] };
    const sourceFields = [duration, unit];
    current.value!.template.targetFieldIds = prepared.identity.targetFieldIds = sourceFields.map(field => field.id);
    prepared.fields = sourceFields;
    prepared.chapters = [{ id: 'history', title: '现病史', fields: sourceFields.map(field => ({ field, editable: true })),
      sections: [{ key: 'history', title: '现病史', recordField: 'historyOfPresentIllness', directField: null,
        fields: sourceFields, clauses: [{ parts: [{ kind: 'field', field: duration }, { kind: 'field', field: unit },
          { kind: 'text', text: '前' }], separator: '' }] }] }];
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({
      consultationId: 'visit-1', transcribedText: '已确认合成转写', savedAt: Date.now(), ownerScope: 'patient-1',
      intentResult: { ...result, voiceTemplateDraft: { ...prepared.identity, fieldValues: { duration: '3', unit: 'D' } },
        voiceTemplateDocument: { ...prepared.identity, chapters: [{ chapterId: 'history', title: '现病史',
          fieldIds: ['duration', 'unit'], editableFieldIds: ['duration', 'unit'], text: '旧缓存自由章节中另写的内容。' }] } },
    });
    const hash = vi.spyOn(templates, 'hashVoiceOutpatientRecognitionTemplate').mockResolvedValue(prepared.identity.templateHash);
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockResolvedValueOnce(prepared);
    try {
      if (mode === 'resume') await expect(api.resumeCachedVoiceResult()).resolves.toBe(true);
      else await api.handleVoiceStop(new Blob([]), '已确认合成转写');
      expect(api.intentResult.value?.voiceTemplateDocument?.chapters[0].text).toBe('3天前');
      expect(api.intentResult.value?.voiceTemplateDraft?.fieldValues).toEqual({ duration: '3', unit: '天' });
      expect(api.intentSource.value).toBe('cache');
      expect(mocks.processTranscript).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); hash.mockRestore(); }
  });

  it('regenerates on the first voice stream for identical text bound to different template bytes', async () => {
    const { api, prepared } = templateRound();
    const draft = { ...prepared.identity, fieldValues: { 合成字段: '新一轮结果' } };
    vi.mocked(loadVoiceConsultationCacheEntry).mockReturnValueOnce({
      consultationId: 'visit-1', transcribedText: '相同转写', savedAt: Date.now(), ownerScope: 'patient-1',
      intentResult: { ...result, voiceTemplateDraft: { ...draft, templateHash: 'b'.repeat(64) } },
    });
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockResolvedValueOnce(prepared);
    try {
      mocks.processTranscript.mockResolvedValueOnce({ ...result, voiceTemplateDraft: draft });
      await api.handleVoiceStop(new Blob(['audio']), '相同转写');
      expect(prepare).toHaveBeenCalledOnce();
      expect(mocks.processTranscript).toHaveBeenCalledWith('相同转写', expect.objectContaining({ outpatientTemplate: prepared }));
      expect(api.intentSource.value).toBe('llm');
      expect(api.intentResult.value?.voiceTemplateDraft).toEqual(draft);
    } finally { prepare.mockRestore(); }
  });

  it('keeps the original note if template preparation fails and exposes only the template failure status', async () => {
    const { api } = templateRound();
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockRejectedValueOnce(new Error('private fixture source'));
    try {
      mocks.processTranscript.mockResolvedValueOnce(result);
      await api.handleVoiceStop(new Blob(['audio']), '保留原语音病历');
      expect(mocks.processTranscript).toHaveBeenCalledOnce();
      expect(mocks.processTranscript).toHaveBeenCalledWith('保留原语音病历', expect.objectContaining({ skipTranscriptTestCache: true }));
      expect(api.intentResult.value?.chiefComplaint).toBe(result.chiefComplaint);
      expect(api.intentResult.value?.voiceTemplateError).toContain('门诊模板准备失败');
      expect(api.intentResult.value?.voiceTemplateError).not.toContain('private');
      expect(api.intentResult.value?.voiceTemplateDraft).toBeUndefined();
      expect(result).not.toHaveProperty('voiceTemplateError');
    } finally { prepare.mockRestore(); }
  });

  it('ignores the old preparation when a new template request replaces the same visit', async () => {
    const { current, api, prepared } = templateRound();
    const prepare = vi.spyOn(templates, 'prepareVoiceOutpatientRecognitionTemplate').mockImplementationOnce(async () => {
      current.value = { ...current.value!, template: { ...current.value!.template, requestId: 'new-request' } };
      return prepared;
    });
    try {
      await api.handleVoiceStop(new Blob(['audio']), '旧请求的转写');
      expect(mocks.processTranscript).not.toHaveBeenCalled();
      expect(mocks.persistCache).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); }
  });
});
