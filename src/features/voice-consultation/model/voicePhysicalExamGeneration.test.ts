// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { chat, chatStream } from '@/services/llm';
import { useVoiceIntentRecognition } from './useVoiceIntentRecognition';

vi.mock('@/services/llm', () => ({ chat: vi.fn(), chatStream: vi.fn(), chatFast: vi.fn() }));
vi.mock('@/services/aliyunSpeech', () => ({ isTestModeEnabled: () => false }));
vi.mock('@/services/operationTracker', () => ({ trackError: vi.fn() }));
vi.mock('./explicitTreatmentCatalogResolver', () => ({ resolveExplicitTreatmentCatalogHints: vi.fn(async () => []) }));
vi.mock('@/services/medicalData', () => ({ medicalDataService: {} }));

describe('voice physical examination same-stream integration', () => {
  it.each(['', '右肺呼吸音粗，可闻及湿啰音。'])('keeps explicit examination separate from AI candidates: %s', async (physicalExam) => {
    vi.mocked(chatStream).mockImplementation(async (messages, onChunk) => {
      expect(messages[0].content).toContain('双肺呼吸音粗');
      const events = [
        { event: 'record_core', data: { chiefComplaint: '咳嗽2天', historyOfPresentIllness: '咳嗽2天', symptoms: ['咳嗽'], negativeSymptoms: [] } },
        { event: 'history_context', data: {} },
        { event: 'record_suggestions', data: [] },
        { event: 'diagnoses', data: [] },
        { event: 'recommendation_plan', data: { mode: 'diagnostic_first', recommendNow: ['lab_test'], defer: ['medicine'], skip: [], reason: '先检查', resumeCondition: 'report_available', confidence: 'high' } },
        { event: 'explicit_orders', data: [] },
        { event: 'record_extra', data: { physicalExam } },
        { event: 'done', data: { error: false } },
      ];
      for (const event of events) onChunk(`${JSON.stringify(event)}\n`);
    });
    const controller = useVoiceIntentRecognition();
    const result = await controller.processTranscript('咳嗽2天', { onProgress: vi.fn() });
    expect(controller.processingError.value).toBeNull();
    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    expect(result?.factSuggestions?.some((item) => item.negativeRecordText === '扁桃体无肿大')).toBe(true);
    expect(result?.factSuggestions?.some((item) => item.negativeRecordText === '双肺呼吸音粗')).toBe(!physicalExam);
    expect(result?.outpatientRecord?.physicalExam).not.toContain('双肺呼吸音粗');
    if (physicalExam) expect(result?.outpatientRecord?.physicalExam).toContain(physicalExam);
  });
});
