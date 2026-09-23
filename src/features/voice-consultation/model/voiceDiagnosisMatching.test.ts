// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatStream } from '@/services/llm';
import { medicalDataService, type DiagnosisItem } from '@/services/medicalData';
import { assessDiagnosisCatalogMatch } from '@/services/diagnosisCatalogMatch';
import { useVoiceIntentRecognition, type VoiceIntentProgress } from './useVoiceIntentRecognition';
import { createVoiceTimingTracker } from './voiceTimingTracker';
import { ref } from 'vue';
import * as promptOverride from '@/services/promptOverride';
import { VOICE_INTENT_STREAM_ORDER } from '../lib/voiceIntentStreamProtocol';
import { useClinicalResultGenerationSequence } from '@features/consultation-result/model/useClinicalResultGenerationSequence';
import { useClinicalResultProgressiveIntentApplication } from '@features/consultation-result/model/useClinicalResultProgressiveIntentApplication';

vi.mock('@/services/llm', () => ({ chat: vi.fn(), chatStream: vi.fn(), chatFast: vi.fn() }));
vi.mock('@/services/aliyunSpeech', () => ({ isTestModeEnabled: () => false }));
vi.mock('@/services/operationTracker', () => ({ trackError: vi.fn() }));
vi.mock('./explicitTreatmentCatalogResolver', () => ({ resolveExplicitTreatmentCatalogHints: vi.fn(async () => []) }));
vi.mock('@/services/medicalData', () => ({ medicalDataService: { getAllDiagnoses: vi.fn(), assessDiagnosisMatch: vi.fn() } }));

const hint = {
  name: '急性上呼吸道感染', code: 'J06.9', sourceType: 'inferred', confidence: 'high',
  suggestionType: 'formal', clinicalRole: 'current_diagnosis', diagnosisKind: 'disease',
  evidenceScope: 'current_visit', currentVisitEvidenceText: '本次咳嗽2天', rationale: '初始依据',
};
const events = () => [
  { event: 'record_core', data: { chiefComplaint: '咳嗽2天', historyOfPresentIllness: '咳嗽2天' } },
  { event: 'diagnoses', data: [hint] },
  { event: 'recommendation_plan', data: { mode: 'recommend_now', recommendNow: ['medicine'], defer: [], skip: [], confidence: 'high' } },
  { event: 'history_context', data: { pastMedicalHistory: '高血压病史' } },
  { event: 'record_suggestions', data: [] },
  { event: 'explicit_orders', data: [] },
  { event: 'record_extra', data: { physicalExam: '咽红', healthEducation: '休息' } },
  { event: 'done', data: { error: false } },
];
let catalog: DiagnosisItem[];

beforeEach(() => {
  catalog = [{ id: 'dx-1', name: hint.name, code: hint.code, keywords: [] }];
  vi.mocked(medicalDataService.getAllDiagnoses).mockImplementation(() => catalog);
  vi.mocked(medicalDataService.assessDiagnosisMatch).mockImplementation((queryName, context) =>
    assessDiagnosisCatalogMatch({ queryName, icdCode: context?.icdCode, catalog }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
    for (const event of events()) onChunk(`${JSON.stringify(event)}\n`);
  });
});

describe('voice diagnosis catalog assessment reuse', () => {
  it.each(['女性', '男性'])('keeps female histories separate in the same stream and guards %s', async (gender) => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        const data = event.event === 'history_context'
          ? { menstrualHistory: '本次末次月经9月1日', maritalReproductiveHistory: '已婚已育；目前未孕' }
          : event.data;
        onChunk(`${JSON.stringify({ ...event, data })}\n`);
      }
    });
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', {
      patientContext: {
        gender,
        ageText: '6个月',
        menstrualHistory: '旧月经史',
        maritalReproductiveHistory: '旧婚育史',
      },
    });
    expect(result?.outpatientRecord?.menstrualHistory || '').toBe(gender === '女性' ? '本次末次月经9月1日' : '');
    expect(result?.outpatientRecord?.maritalReproductiveHistory || '').toBe(gender === '女性' ? '已婚已育；目前未孕' : '');
    const messages = vi.mocked(chatStream).mock.calls[0][0];
    expect(messages[1].content).toContain(`【患者特征】性别：${gender}；年龄：6个月`);
    expect(messages[1].content).not.toContain('【本次输出协议】');
    expect(messages[1].content).not.toContain('recordDraft');
    expect(messages.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThan(6_500);
    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
  });

  it('makes diagnosis and treatment routing available before delayed suggestions, including hosted prompts', async () => {
    const oldOrder = ['record_core', 'history_context', 'record_suggestions', 'diagnoses',
      'recommendation_plan', 'explicit_orders', 'record_extra', 'done'];
    const override = vi.spyOn(promptOverride, 'withOverride').mockImplementation((_code, local) => ({
      ...local,
      system: `机构诊断规则保持不变\n${oldOrder.map(event => JSON.stringify({ event, data: {} })).join('\n')}`,
    }));
    let release!: () => void;
    const delayedSuggestions = new Promise<void>(resolve => { release = resolve; });
    const progress: VoiceIntentProgress[] = [];
    const generation = ref<VoiceIntentProgress['result']['generation']>();
    const sequence = useClinicalResultGenerationSequence({
      getChannel: () => 'voice', getGeneration: () => generation.value,
      getFormalDiagnosisCount: () => progress[progress.length - 1]?.result.diagnoses.length || 0,
      getSelectedDiagnosisKey: () => progress[progress.length - 1]?.result.diagnoses[0]?.matchedItem?.id || '',
      getLastTreatmentDiagnosisKey: () => '',
    });
    const application = useClinicalResultProgressiveIntentApplication();
    const modes: string[] = [];
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const section of VOICE_INTENT_STREAM_ORDER) {
        if (section === 'record_suggestions') await delayedSuggestions;
        onChunk(`${JSON.stringify(events().find(event => event.event === section))}\n`);
      }
    });
    const resultPromise = useVoiceIntentRecognition().processTranscript('咳嗽2天', {
      onProgress: value => {
        progress.push(value);
        generation.value = value.result.generation;
        modes.push(application.plan({ sessionKey: 'round-1', generation: value.result.generation }).mode);
      },
    });
    try {
      await vi.waitFor(() => expect(progress).toHaveLength(4));
      expect(progress[progress.length - 1]?.readySections).toEqual(['record_core', 'history_context', 'diagnoses', 'recommendation_plan']);
      expect(progress[progress.length - 1]?.result.diagnoses[0].matchedItem?.id).toBe('dx-1');
      expect(sequence.canStartAutoTreatment.value).toBe(true);
      sequence.beginTreatment('dx-1');
      const messages = vi.mocked(chatStream).mock.calls[0][0];
      expect(messages[0].content).toContain('机构诊断规则保持不变');
      expect(messages[0].content).toContain('置信度不得扩大推荐范围');
      expect(messages[0].content).toContain('voice-intent.v1.7');
      expect(vi.mocked(chatStream).mock.calls[0][5]?.temperature).toBe(0);
      expect(messages[0].content.split('\n').filter(line => line.startsWith('{"event":'))
        .map(line => JSON.parse(line).event)).toEqual(VOICE_INTENT_STREAM_ORDER);
      expect(messages[1].content).not.toContain('【本次输出协议】');
      release();
      const result = await resultPromise;
      expect(result?.generation?.status).toBe('complete');
      expect(result?.diagnoses[0].matchedItem?.id).toBe('dx-1');
      expect(modes).toEqual(['reset', 'patch', 'patch', 'patch', 'patch', 'patch', 'patch']);
      expect(sequence.activeTreatmentDiagnosisKey.value).toBe('dx-1');
      expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(1);
      expect(chatStream).toHaveBeenCalledTimes(1);
      expect(chat).not.toHaveBeenCalled();
    } finally {
      release();
      await resultPromise;
      override.mockRestore();
    }
  });

  it('records stream and processing phases without declaring the UI ready or logging clinical text', async () => {
    const checkpoint = vi.fn();
    const report = vi.fn();
    const timing = createVoiceTimingTracker({ now: () => performance.now(), checkpoint, report }).start('private-round');
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', {
      timing, onProgress: vi.fn(),
    });
    expect(result?.generation?.status).toBe('complete');
    const rows = checkpoint.mock.calls.map(call => call[1]);
    expect(rows.filter(row => row.event === 'llm_first_chunk')).toHaveLength(1);
    expect(rows.map(row => row.event)).toEqual(expect.arrayContaining([
      'section_diagnoses', 'build_intent_diagnoses', 'llm_stream_completed',
      'explicit_catalog_resolution', 'build_intent_complete', 'intent_completed',
      'llm_prompt_chars', 'llm_output_chars', 'llm_stream_chunks', 'llm_chunk_gap_max_ms',
    ]));
    expect(rows.find(row => row.event === 'llm_prompt_chars').count).toBeGreaterThan(0);
    expect(rows.find(row => row.event === 'section_diagnoses').count).toBeGreaterThan(0);
    expect(rows.find(row => row.event === 'build_intent_diagnoses').durationMs).toBeGreaterThanOrEqual(0);
    expect(report).not.toHaveBeenCalled();
    expect(JSON.stringify(rows)).not.toMatch(/咳嗽|高血压|急性上呼吸道感染|private-round/);
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(1);
  });

  it('restores authoritative histories when the model omits history_context fields', async () => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        onChunk(`${JSON.stringify(event.event === 'history_context' ? { ...event, data: {} } : event)}\n`);
      }
    });

    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', {
      patientContext: {
        pastMedicalHistory: '既往有高血压病史',
        allergyHistory: '青霉素',
        currentMedicationHistory: '长期服用氨氯地平',
      },
    });

    expect(result?.pastMedicalHistory).toContain('高血压');
    expect(result?.allergyHistory).toBe('青霉素');
    expect(result?.currentMedicationHistory).toBe('长期服用氨氯地平');
  });

  it('assesses once across eight NDJSON sections and complete, while publishing all fields', async () => {
    const progress: VoiceIntentProgress[] = [];
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', {
      onProgress: (value) => progress.push(value),
    });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(1);
    expect(progress).toHaveLength(7);
    expect(progress[1].result.diagnoses[0].matchedItem?.id).toBe('dx-1');
    expect(result?.diagnoses[0].matchedItem?.id).toBe('dx-1');
    expect(result?.pastMedicalHistory).toContain('高血压');
    expect(result?.outpatientRecord?.physicalExam).toContain('咽红');
    expect(result?.healthEducation).toBe('休息');
    expect(result?.generation?.status).toBe('complete');
    expect(chat).not.toHaveBeenCalled();
  });

  it('keeps clinical metadata fresh but rematches only a changed name or ICD', async () => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        onChunk(`${JSON.stringify(event)}\n`);
        if (event.event === 'diagnoses') {
          for (const data of [
            [{ ...hint, rationale: '更新依据', confidence: 'low', suggestionType: 'differential' }],
            [{ ...hint, code: 'J06.8' }],
            [{ ...hint, name: '急性支气管炎' }],
          ]) onChunk(`${JSON.stringify({ event: 'diagnoses', data })}\n`);
        }
      }
    });
    const progress: VoiceIntentProgress[] = [];
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', { onProgress: p => progress.push(p) });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(3);
    expect(progress[2].result.diagnoses[0]).toMatchObject({ rationale: '更新依据', confidence: 'low', suggestionType: 'differential' });
    expect(result?.diagnoses[0].name).toBe('急性支气管炎');
  });

  it('invalidates assessments when the catalog is replaced during streaming', async () => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        onChunk(`${JSON.stringify(event)}\n`);
        if (event.event === 'diagnoses') catalog = [{ ...catalog[0], id: 'dx-new' }];
      }
    });
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', { onProgress: vi.fn() });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(2);
    expect(result?.diagnoses[0].matchedItem?.id).toBe('dx-new');
  });

  it('isolates consecutive requests on the same controller', async () => {
    const controller = useVoiceIntentRecognition();
    await controller.processTranscript('患者甲咳嗽2天', { onProgress: vi.fn() });
    await controller.processTranscript('患者乙咳嗽2天', { onProgress: vi.fn() });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(2);
  });

  it('matches the final result when no progress callback is supplied', async () => {
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天');
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(1);
    expect(result?.diagnoses[0].matchedItem?.id).toBe('dx-1');
  });

  it('does not retain an unmatched result after an initially empty catalog loads', async () => {
    const loaded = catalog;
    catalog = [];
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        onChunk(`${JSON.stringify(event)}\n`);
        if (event.event === 'diagnoses') catalog = loaded;
      }
    });
    const result = await useVoiceIntentRecognition().processTranscript('咳嗽2天', { onProgress: vi.fn() });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(2);
    expect(result?.diagnoses[0].matchedItem?.id).toBe('dx-1');
  });

  it('reruns current-context clinical guards despite cached catalog matches', async () => {
    const symptom = { ...hint, name: '呕吐', code: 'R11', diagnosisKind: 'symptom_working', currentVisitEvidenceText: '本次呕吐' };
    catalog = [{ id: 'symptom', name: '呕吐', code: 'R11', keywords: [] }];
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of events()) {
        const data = event.event === 'record_core' ? { chiefComplaint: '呕吐', historyOfPresentIllness: '本次呕吐' }
          : event.event === 'diagnoses' ? [symptom]
          : event.event === 'record_extra' ? { historyOfPresentIllness: '咳嗽2天', chiefComplaint: '咳嗽' }
          : event.data;
        onChunk(`${JSON.stringify({ ...event, data })}\n`);
      }
    });
    const progress: VoiceIntentProgress[] = [];
    const result = await useVoiceIntentRecognition().processTranscript('本次呕吐', { onProgress: p => progress.push(p) });
    expect(medicalDataService.assessDiagnosisMatch).toHaveBeenCalledTimes(1);
    expect(progress[1].result.diagnoses).toHaveLength(1);
    expect(result?.diagnoses).toHaveLength(0);
  });
});
