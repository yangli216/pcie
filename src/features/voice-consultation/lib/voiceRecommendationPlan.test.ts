import { describe, expect, it } from 'vitest';
import type { VoiceRecommendationPlan } from '@/prompts';
import { normalizeRecommendationPlan, buildVoiceRoutingDecisionSummary } from './voiceRecommendationPlan';
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
    const normalized = normalizeRecommendationPlan(constrainOrdinaryVoiceWorkingDiagnosisPlan(
      plan({ mode: 'parallel', recommendNow: ['medicine'], skip: ['medicine'], defer: [] }),
      [{ diagnosisKind: 'symptom_working', suggestionType: 'formal' }] as never,
    ));
    expect(normalized).toMatchObject({ mode: 'diagnostic_first', recommendNow: ['exam', 'lab_test'], defer: ['medicine'], skip: [] });
  });

  it('logs decisions using only whitelisted enums and counts, never patient text', () => {
    const raw = plan({ reason: '患者私人病历内容', recommendNow: ['medicine', 'exam'], confidence: 'low' });
    const summary = buildVoiceRoutingDecisionSummary(raw, normalizeRecommendationPlan(raw), [
      { diagnosisKind: 'disease', suggestionType: 'formal' },
    ]);
    expect(summary).toContain('低置信不扩展');
    expect(summary).toContain('剔除受限或冲突分支');
    expect(summary).toContain('正式疾病=1');
    expect(summary).not.toContain(raw.reason);
    const invalid = buildVoiceRoutingDecisionSummary({ ...raw, mode: '患者姓名' as never }, normalizeRecommendationPlan(raw), []);
    expect(invalid).not.toContain('患者姓名');
  });
});
