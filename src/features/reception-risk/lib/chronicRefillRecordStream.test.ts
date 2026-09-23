import { describe, expect, it } from 'vitest';
import {
  applyChronicRefillRecordStreamEvent,
  createChronicRefillRecordStreamAccumulator,
  createChronicRefillRecordStreamParser,
} from './chronicRefillRecordStream';

describe('chronicRefillRecordStream', () => {
  it('parses chunked NDJSON and accumulates display-ready sections', () => {
    const accumulator = createChronicRefillRecordStreamAccumulator<Record<string, unknown>>({});
    const parser = createChronicRefillRecordStreamParser((event) => {
      applyChronicRefillRecordStreamEvent(accumulator, event);
    });

    parser.push('{"event":"record_core","data":{"chiefComplaint":"高血压复诊配药"}}\n');
    parser.push('{"event":"medication_scope","data":{"assignments":[{"itemId":"rx-1","conditionId":"高血压","confidence":"high"}]}}\n');
    parser.push('{"event":"review_plan","data":{"summary":"请核查","items":[]}}\n{"event":"recommended_');
    parser.push('medicines","data":["氨氯地平"]}\n{"event":"record_extra","data":{"healthEducation":"监测血压"}}');
    parser.flush();

    expect(accumulator.draft).toMatchObject({
      chiefComplaint: '高血压复诊配药',
      medicationScope: {
        assignments: [{ itemId: 'rx-1', conditionId: '高血压', confidence: 'high' }],
      },
      reviewPlan: { summary: '请核查', items: [] },
      recommendedMedicines: ['氨氯地平'],
      healthEducation: '监测血压',
    });
    expect(accumulator.readySections).toEqual([
      'record_core',
      'history_context',
      'diagnoses',
      'review_plan',
      'recommended_medicines',
      'record_extra',
    ]);
  });

  it('ignores markdown and malformed output without throwing', () => {
    const events: unknown[] = [];
    const parser = createChronicRefillRecordStreamParser((event) => events.push(event));
    parser.push('说明文字\n```json\n{"event":"unknown","data":{}}\n```');
    parser.flush();
    expect(events).toEqual([]);
  });
});
