import { describe, expect, it } from 'vitest';
import { VoiceIntentRecognitionStreamPrompt } from '@/prompts/prompts';
import { applyVoiceIntentStreamProtocol, VOICE_INTENT_STREAM_ORDER } from './voiceIntentStreamProtocol';

const schemaLines = (system: string) => system.split('\n').filter(line => line.startsWith('{"event":'));

describe('voice stream diagnosis-first protocol', () => {
  it('keeps local example order aligned with the runtime protocol', () => {
    expect(schemaLines(VoiceIntentRecognitionStreamPrompt.system).map(line => JSON.parse(line).event))
      .toEqual(VOICE_INTENT_STREAM_ORDER);
  });

  it('reorders a cached hosted example without losing its custom clinical fields or rules', () => {
    const oldOrder = ['record_core', 'history_context', 'record_suggestions', 'diagnoses',
      'recommendation_plan', 'explicit_orders', 'record_extra', 'done'];
    const examples = oldOrder.map(event => JSON.stringify({ event, data: { institutionRule: event } }));
    const clinicalRule = '机构临床规则：过敏史必须保留；仅历史共病不能作为本次正式诊断。';
    const formatted = applyVoiceIntentStreamProtocol(`${clinicalRule}\n${examples.join('\n')}\n保留附加规则。`);
    const result = schemaLines(formatted);
    expect(result.map(line => JSON.parse(line).event)).toEqual(VOICE_INTENT_STREAM_ORDER);
    expect([...result].sort()).toEqual([...examples].sort());
    expect(formatted).toContain(clinicalRule);
    expect(formatted).toContain('保留附加规则。');
    expect(formatted).toContain('AI候选不是已核实诊断或治疗依据');
    expect(formatted).toContain('基础查体候选由客户端');
    expect(formatted).not.toContain('基础项目库（均为未核实的书写候选）');
  });

  it('preserves incomplete or non-NDJSON hosted instructions and adds the system-level order', () => {
    const system = '机构自定义规则\n{"event":"record_core","data":{}}\n不是JSON的说明';
    const formatted = applyVoiceIntentStreamProtocol(system);
    expect(formatted.startsWith(system)).toBe(true);
    expect(formatted).toContain(VOICE_INTENT_STREAM_ORDER.join('>'));
    expect(formatted).toContain('本段顺序优先于旧说明');
  });
});
