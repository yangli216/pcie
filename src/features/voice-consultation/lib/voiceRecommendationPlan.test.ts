import { describe, expect, it } from 'vitest';
import type { VoiceRecommendationPlan } from '@/prompts';
import {
  normalizeRecommendationPlan,
  stabilizeOrdinaryVoiceRecommendationPlan,
  buildVoiceRoutingDecisionSummary,
} from './voiceRecommendationPlan';
import { constrainOrdinaryVoiceWorkingDiagnosisPlan } from './ordinaryVoiceDiagnosisGuard';

const plan = (patch: Partial<VoiceRecommendationPlan> = {}): VoiceRecommendationPlan => ({
  mode: 'diagnostic_first', recommendNow: ['exam', 'lab_test'], defer: ['medicine'],
  skip: [], confidence: 'high', ...patch,
});

describe('voice routing stability', () => {
  it.each(['high', 'medium', 'low', undefined] as const)('never expands branches for confidence=%s', confidence => {
    expect(normalizeRecommendationPlan(plan({ confidence }))).toMatchObject({
      mode: 'diagnostic_first', recommendNow: ['exam', 'lab_test'], defer: ['medicine'], skip: [],
    });
    expect(normalizeRecommendationPlan(plan({
      mode: 'treatment_first', recommendNow: ['medicine'], defer: [], skip: ['exam', 'lab_test'], confidence,
    })).recommendNow).toEqual(['medicine']);
  });

  it('resolves contradictory sets by defer > skip > recommendNow and is idempotent', () => {
    const normalized = normalizeRecommendationPlan(plan({
      mode: 'parallel', recommendNow: ['medicine', 'lab_test', 'exam', 'medicine'],
      defer: ['medicine'], skip: ['medicine', 'exam'],
    }));
    expect(normalized).toMatchObject({ recommendNow: ['lab_test'], defer: ['medicine'], skip: ['exam'] });
    expect(normalizeRecommendationPlan(normalized)).toEqual(normalized);
  });

  it('holds medicine even when a diagnostic-first model contradicts itself', () => {
    expect(normalizeRecommendationPlan(plan({
      recommendNow: ['medicine'], defer: [], skip: ['medicine'], confidence: 'low',
    }))).toMatchObject({ recommendNow: [], defer: ['medicine'], skip: [], resumeCondition: 'report_available' });
  });

  it.each(['urgent_referral', 'explicit_only'] as const)('disables auto generation for %s', mode => {
    expect(normalizeRecommendationPlan(plan({ mode, recommendNow: ['medicine', 'exam'], confidence: 'low' })).recommendNow)
      .toEqual([]);
  });

  it('allows missing or invalid branch lists to remain empty instead of guessing all types', () => {
    expect(normalizeRecommendationPlan(undefined).recommendNow).toEqual([]);
    expect(normalizeRecommendationPlan(plan({ recommendNow: ['procedure', 'unknown'] as never })).recommendNow).toEqual([]);
  });

  it('keeps working diagnosis constraints mutually exclusive after normalization', () => {
    const diagnoses = [{ diagnosisKind: 'symptom_working', suggestionType: 'formal' }] as never;
    const normalized = stabilizeOrdinaryVoiceRecommendationPlan(
      constrainOrdinaryVoiceWorkingDiagnosisPlan(
        plan({ mode: 'parallel', recommendNow: ['medicine'], skip: ['medicine'], defer: [] }),
        diagnoses,
      ),
      diagnoses,
    );
    expect(normalized).toMatchObject({ mode: 'diagnostic_first', recommendNow: ['exam', 'lab_test'], defer: ['medicine'], skip: [] });
  });

  it.each([
    ['parallel', ['medicine', 'exam', 'lab_test'], [], []],
    ['treatment_first', ['medicine'], [], ['exam', 'lab_test']],
    ['diagnostic_first', ['exam', 'lab_test'], ['medicine'], []],
  ] as const)('maps disease mode %s to fixed executable branches', (mode, recommendNow, defer, skip) => {
    const diagnoses = [{ diagnosisKind: 'disease', suggestionType: 'formal' }];
    const sparse = stabilizeOrdinaryVoiceRecommendationPlan(plan({
      mode, recommendNow: [], defer: [], skip: [],
    }), diagnoses);
    const contradictory = stabilizeOrdinaryVoiceRecommendationPlan(plan({
      mode, recommendNow: ['lab_test'], defer: ['exam'], skip: ['medicine'],
    }), diagnoses);
    expect(sparse).toMatchObject({ mode, recommendNow, defer, skip });
    expect(contradictory).toMatchObject({ mode, recommendNow, defer, skip });
  });

  it('does not start treatment without a formal diagnosis', () => {
    expect(stabilizeOrdinaryVoiceRecommendationPlan(plan({ mode: 'parallel' }), [
      { diagnosisKind: 'disease', suggestionType: 'differential' },
    ]).recommendNow).toEqual([]);
  });

  it('logs decisions using only whitelisted enums and counts, never patient text', () => {
    const raw = plan({ reason: '患者私人病历内容', recommendNow: ['medicine', 'exam'], confidence: 'low' });
    const summary = buildVoiceRoutingDecisionSummary(raw, stabilizeOrdinaryVoiceRecommendationPlan(raw, [
      { diagnosisKind: 'disease', suggestionType: 'formal' },
    ]), [
      { diagnosisKind: 'disease', suggestionType: 'formal' },
    ]);
    expect(summary).toContain('低置信不改变模式');
    expect(summary).toContain('客户端按模式固定执行分支');
    expect(summary).toContain('正式疾病=1');
    expect(summary).not.toContain(raw.reason);
    const invalid = buildVoiceRoutingDecisionSummary({ ...raw, mode: '患者姓名' as never }, normalizeRecommendationPlan(raw), []);
    expect(invalid).not.toContain('患者姓名');
  });
});
