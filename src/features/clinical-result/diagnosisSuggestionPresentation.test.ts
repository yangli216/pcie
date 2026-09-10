import { describe, expect, it } from 'vitest';
import type { Diagnosis } from '@/types/consultation';
import {
  buildDiagnosisSuggestionSections,
  getDiagnosisSuggestionDirectionKey,
  parseDiagnosisMatchRate,
} from './diagnosisSuggestionPresentation';

function diagnosis(name: string, rate: string, extra: Partial<Diagnosis> = {}): Diagnosis {
  return { name, code: name, rate, rationale: '', ...extra };
}

describe('diagnosisSuggestionPresentation', () => {
  it('sorts formal diagnoses by confidence and exposes at most three without padding', () => {
    const sections = buildDiagnosisSuggestionSections([
      diagnosis('诊断D', '72%'),
      diagnosis('诊断B', '88%'),
      diagnosis('诊断A', '95%'),
      diagnosis('诊断C', '80%'),
    ]);

    expect(sections.formal.map((item) => item.name)).toEqual(['诊断A', '诊断B', '诊断C']);
    expect(sections.differential).toEqual([]);

    const single = buildDiagnosisSuggestionSections([diagnosis('唯一诊断', '91%')]);
    expect(single.formal).toHaveLength(1);
  });

  it('keeps low-confidence or explicitly differential items in a separate section', () => {
    const sections = buildDiagnosisSuggestionSections([
      diagnosis('正式诊断', '85%', { suggestionType: 'formal' }),
      diagnosis('待排诊断', '55%', { missingInformation: '补充影像检查' }),
      diagnosis('模型鉴别诊断', '82%', { suggestionType: 'differential' }),
      diagnosis('误标正式诊断', '45%', { suggestionType: 'formal' }),
    ]);

    expect(sections.formal.map((item) => item.name)).toEqual(['正式诊断']);
    expect(sections.differential.map((item) => item.name)).toEqual(['模型鉴别诊断', '待排诊断', '误标正式诊断']);
  });

  it('lets an explicitly doctor-promoted direction bypass the AI formal limit', () => {
    const promoted = diagnosis('医生转入诊断', '45%', {
      id: 'standard-promoted',
      suggestionType: 'differential',
    });
    const promotedKeys = new Set([getDiagnosisSuggestionDirectionKey(promoted)]);
    const sections = buildDiagnosisSuggestionSections([
      diagnosis('诊断A', '95%'),
      diagnosis('诊断B', '90%'),
      diagnosis('诊断C', '85%'),
      diagnosis('诊断D', '80%'),
      promoted,
    ], 3, promotedKeys);

    expect(sections.formal.map((item) => item.name)).toEqual([
      '诊断A',
      '诊断B',
      '诊断C',
      '医生转入诊断',
    ]);
    expect(sections.differential.map((item) => item.name)).not.toContain('医生转入诊断');
  });

  it('keeps a validated symptom working diagnosis formal even when its rationale mentions further tests', () => {
    const sections = buildDiagnosisSuggestionSections([
      diagnosis('胸痛', '中置信', {
        suggestionType: 'formal',
        diagnosisKind: 'symptom_working',
        rationale: '当前为症状性工作诊断，需进一步检查明确病因',
      }),
    ]);

    expect(sections.formal.map((item) => item.name)).toEqual(['胸痛']);
    expect(sections.differential).toEqual([]);
  });

  it('parses numeric and textual confidence labels', () => {
    expect(parseDiagnosisMatchRate('匹配度 87%')).toBe(87);
    expect(parseDiagnosisMatchRate('高置信度')).toBe(80);
    expect(parseDiagnosisMatchRate('低置信')).toBe(45);
    expect(parseDiagnosisMatchRate('AI分析')).toBeNull();
  });
});
