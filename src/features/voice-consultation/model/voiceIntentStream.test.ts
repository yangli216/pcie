import { describe, expect, it } from 'vitest';
import {
  applyVoiceIntentStreamEvent,
  createVoiceIntentStreamAccumulator,
  createVoiceIntentStreamParser,
  sanitizeExplicitTreatmentHints,
  sanitizeVoiceExtractionTreatmentSections,
} from './voiceIntentStream';

describe('voiceIntentStream', () => {
  it('parses chunked NDJSON events and builds a compatible extraction payload', () => {
    const accumulator = createVoiceIntentStreamAccumulator();
    const parser = createVoiceIntentStreamParser((event) => applyVoiceIntentStreamEvent(accumulator, event));

    parser.push('{"event":"record_core","data":{"chiefComplaint":"咳嗽2天"}}\n{"event":"diag');
    parser.push('noses","data":[{"name":"急性支气管炎"}]}\n');
    parser.push('{"event":"history_context","data":{"personalHistory":"吸烟20年","menstrualHistory":"周期28天"}}\n');
    parser.push('{"event":"record_suggestions","data":[{"field":"physicalExam","question":"核查肺部听诊","negativeRecordText":"双肺未闻及啰音","priority":"general"}]}\n');
    parser.push('{"event":"record_extra","data":{"physicalExam":"血压128/76mmHg"}}\n');
    parser.push('{"event":"recommendation_plan","data":{"mode":"diagnostic_first","recommendNow":["lab_test"]}}');
    parser.flush();

    expect(accumulator.payload.recordDraft?.chiefComplaint).toBe('咳嗽2天');
    expect(accumulator.payload.recordDraft?.personalHistory).toBe('吸烟20年');
    expect(accumulator.payload.recordDraft?.menstrualHistory).toBe('周期28天');
    expect(accumulator.payload.recordDraft?.physicalExam).toBe('血压128/76mmHg');
    expect(accumulator.payload.recordFactSuggestions?.[0]?.negativeRecordText).toBe('双肺未闻及啰音');
    expect(accumulator.payload.diagnosisHints?.[0]?.name).toBe('急性支气管炎');
    expect(accumulator.payload.recommendationPlan?.mode).toBe('diagnostic_first');
    expect(accumulator.readySections).toEqual([
      'record_core',
      'diagnoses',
      'history_context',
      'record_suggestions',
      'record_extra',
      'recommendation_plan',
    ]);
  });

  it('ignores ordinary pretty-printed JSON so the legacy parser can handle it at completion', () => {
    const events: unknown[] = [];
    const parser = createVoiceIntentStreamParser((event) => events.push(event));
    parser.push('{\n  "recordDraft": {\n    "chiefComplaint": "咳嗽"\n  }\n}');
    parser.flush();
    expect(events).toEqual([]);
  });

  it('keeps chapter patches by source ID when an optional record partition reports a partial map', () => {
    const state = createVoiceIntentStreamAccumulator();
    applyVoiceIntentStreamEvent(state, { event: 'template_chapter', data: { chapterId: 'first', text: '已到达正文' } });
    applyVoiceIntentStreamEvent(state, { event: 'record_extra', data: { templateChapterTexts: { second: '第二章', first: null } } });
    expect(state.payload.recordDraft?.templateChapterTexts).toEqual({ first: '已到达正文', second: '第二章' });
    expect(state.readySections).toEqual(['record_extra']);
  });

  it('parses pretty-printed, concatenated and array-wrapped stream events', () => {
    const accumulator = createVoiceIntentStreamAccumulator();
    const parser = createVoiceIntentStreamParser((event) => applyVoiceIntentStreamEvent(accumulator, event));

    parser.push('```json\n{\n  "event": "record_core",\n  "data": {"chiefComplaint": "头晕3天"}\n}\n```');
    parser.push('{"event":"diagnoses","data":[{"name":"眩晕综合征"}]}');
    parser.push('[{"event":"recommendation_plan","data":{"mode":"diagnostic_first"}},');
    parser.push('{"event":"done","data":{"error":false}}]');
    parser.flush();

    expect(accumulator.payload.recordDraft?.chiefComplaint).toBe('头晕3天');
    expect(accumulator.payload.diagnosisHints?.[0]?.name).toBe('眩晕综合征');
    expect(accumulator.payload.recommendationPlan?.mode).toBe('diagnostic_first');
    expect(accumulator.eventCount).toBe(4);
  });

  it('isolates malformed explicit orders without discarding valid orders or core payload', () => {
    const sanitized = sanitizeExplicitTreatmentHints([
      { type: { value: 'medicine' }, name: '硝苯地平片' },
      { type: 'exam', name: ' 心电图 ' },
      { type: 'medicine', name: '' },
    ]);

    expect(sanitized.hints).toEqual([
      expect.objectContaining({ type: 'examination', name: '心电图' }),
    ]);
    expect(sanitized.warnings).toHaveLength(2);

    const payloadResult = sanitizeVoiceExtractionTreatmentSections({
      recordDraft: { chiefComplaint: '头晕' },
      diagnosisHints: [{ name: '高血压' }],
      explicitTreatmentHints: [{ type: null, name: '氨氯地平片' }],
      error: false,
    });
    expect(payloadResult.payload).toEqual(expect.objectContaining({
      recordDraft: { chiefComplaint: '头晕' },
      diagnosisHints: [{ name: '高血压' }],
      explicitTreatmentHints: [],
      error: false,
    }));
    expect(payloadResult.warnings).toHaveLength(1);
  });

  it('records an explicit-order warning while keeping required stream sections usable', () => {
    const accumulator = createVoiceIntentStreamAccumulator();
    applyVoiceIntentStreamEvent(accumulator, {
      event: 'record_core',
      data: { chiefComplaint: '咳嗽2天' },
    });
    applyVoiceIntentStreamEvent(accumulator, {
      event: 'diagnoses',
      data: [{ name: '急性支气管炎' }],
    });
    applyVoiceIntentStreamEvent(accumulator, {
      event: 'recommendation_plan',
      data: { mode: 'parallel' },
    });
    applyVoiceIntentStreamEvent(accumulator, {
      event: 'explicit_orders',
      data: [{ type: ['medicine'], name: '阿莫西林胶囊' }],
    });

    expect(accumulator.readySections).toEqual(expect.arrayContaining([
      'record_core',
      'diagnoses',
      'recommendation_plan',
      'explicit_orders',
    ]));
    expect(accumulator.payload.explicitTreatmentHints).toEqual([]);
    expect(accumulator.protocolWarnings).toHaveLength(1);
  });
});
