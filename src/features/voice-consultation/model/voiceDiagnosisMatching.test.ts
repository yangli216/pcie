// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatStream } from '@/services/llm';
import { medicalDataService, type DiagnosisItem } from '@/services/medicalData';
import { assessDiagnosisCatalogMatch } from '@/services/diagnosisCatalogMatch';
import { useVoiceIntentRecognition, type VoiceIntentProgress } from './useVoiceIntentRecognition';

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
