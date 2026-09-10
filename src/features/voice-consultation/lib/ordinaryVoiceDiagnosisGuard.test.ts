import { describe, expect, it } from 'vitest';
import type { DiagnosisHint, VoiceRecommendationPlan } from '@/prompts';
import {
  constrainOrdinaryVoiceWorkingDiagnosisPlan,
  guardOrdinaryVoiceDiagnosisHints,
  promoteOrdinaryVoiceSymptomWorkingDiagnosis,
} from './ordinaryVoiceDiagnosisGuard';

function diagnosis(extra: Partial<DiagnosisHint> = {}): DiagnosisHint {
  return {
    name: '原发性高血压',
    confidence: 'high',
    suggestionType: 'formal',
    evidenceText: '既往有高血压病史',
    rationale: '患者既往确诊高血压',
    ...extra,
  };
}

function matchedDiagnosis(extra: Partial<DiagnosisHint> & {
  matchedItem?: { id: string; code: string; name: string } | null;
} = {}) {
  return {
    ...diagnosis({
      name: '胸痛',
      confidence: 'medium',
      suggestionType: 'differential',
      evidenceText: '胸口不适伴偶发隐痛2至3个月',
      evidenceScope: 'current_visit',
      currentVisitEvidenceText: '胸口不适伴偶发隐痛2至3个月',
      clinicalRole: 'current_diagnosis',
      diagnosisKind: 'symptom_working',
      sourceType: 'explicit',
    }),
    matchedItem: { id: 'diag-r07400', code: 'R07.400', name: '胸痛' },
    ...extra,
  };
}

describe('guardOrdinaryVoiceDiagnosisHints', () => {
  it('removes historical hypertension instead of showing it as a differential', () => {
    const results = guardOrdinaryVoiceDiagnosisHints([
      diagnosis({
        evidenceScope: 'history_only',
        clinicalRole: 'history_only',
        currentVisitEvidenceText: '',
      }),
      diagnosis({
        name: '良性阵发性位置性眩晕',
        evidenceText: '起床转头时突发视物旋转，伴恶心呕吐',
        evidenceScope: 'current_visit',
        currentVisitEvidenceText: '起床转头时突发视物旋转，伴恶心呕吐',
        clinicalRole: 'current_diagnosis',
        confidence: 'medium',
        suggestionType: 'formal',
      }),
    ]);

    expect(results.map((item) => item.name)).toEqual(['良性阵发性位置性眩晕']);
  });

  it('removes history-only and risk-modifier comorbidities from diagnosis suggestions', () => {
    const results = guardOrdinaryVoiceDiagnosisHints([
      diagnosis({ evidenceScope: 'history_only', clinicalRole: 'history_only' }),
      diagnosis({
        name: '贫血',
        evidenceScope: 'history_only',
        clinicalRole: 'risk_modifier',
      }),
    ]);

    expect(results).toEqual([]);
  });

  it('keeps a chronic condition when current-visit evidence and role are explicit', () => {
    const item = diagnosis({
      evidenceScope: 'both',
      currentVisitEvidenceText: '本次测得血压180/110mmHg，伴头痛',
      evidenceText: '既往高血压，本次血压明显升高',
      clinicalRole: 'current_diagnosis',
      diagnosisKind: 'disease',
    });

    expect(guardOrdinaryVoiceDiagnosisHints([item])).toEqual([item]);
  });

  it('downgrades a current diagnosis declaration without current-visit evidence', () => {
    const [result] = guardOrdinaryVoiceDiagnosisHints([
      diagnosis({
        evidenceScope: 'current_visit',
        currentVisitEvidenceText: '',
        clinicalRole: 'current_diagnosis',
      }),
    ]);

    expect(result).toMatchObject({ confidence: 'low', suggestionType: 'differential' });
  });

  it('removes a current-visit field that only repeats historical evidence', () => {
    const results = guardOrdinaryVoiceDiagnosisHints([
      diagnosis({
        evidenceScope: 'both',
        currentVisitEvidenceText: '既往有高血压病史',
      }),
    ], {
      historicalContextText: '既往史：有高血压病史。',
    });

    expect(results).toEqual([]);
  });

  it('removes legacy high-confidence diagnoses supported only by past history', () => {
    const results = guardOrdinaryVoiceDiagnosisHints([
      diagnosis(),
      diagnosis({
        name: '2型糖尿病',
        evidenceText: '既往有糖尿病病史',
        rationale: '糖尿病病史明确',
      }),
    ], {
      historicalContextText: '既往史：有高血压病史；有糖尿病病史。',
    });

    expect(results).toEqual([]);
  });

  it('keeps a complaint-related differential cause but never marks it formal', () => {
    const item = diagnosis({
      name: '冠状动脉粥样硬化性心脏病',
      evidenceText: '胸痛需要排除心肌缺血',
      evidenceScope: 'current_visit',
      currentVisitEvidenceText: '反复胸痛2至3个月',
      clinicalRole: 'differential_cause',
      confidence: 'medium',
    });

    expect(guardOrdinaryVoiceDiagnosisHints([item])).toEqual([{
      ...item,
      suggestionType: 'differential',
      missingInformation: expect.any(String),
    }]);
  });
});

describe('promoteOrdinaryVoiceSymptomWorkingDiagnosis', () => {
  it('keeps chest pain as the only formal diagnosis and removes unrelated diabetes and anemia', () => {
    const guarded = guardOrdinaryVoiceDiagnosisHints([
      matchedDiagnosis(),
      diagnosis({
        name: '2型糖尿病',
        clinicalRole: 'history_only',
        diagnosisKind: 'disease',
        evidenceScope: 'history_only',
      }),
      diagnosis({
        name: '贫血',
        clinicalRole: 'risk_modifier',
        diagnosisKind: 'disease',
        evidenceScope: 'history_only',
      }),
    ]);
    const results = promoteOrdinaryVoiceSymptomWorkingDiagnosis(guarded, {
      chiefComplaint: '胸口不适伴偶发隐痛2至3个月',
      historyOfPresentIllness: '近2至3个月胸部不适间断发作，程度较轻。',
    });

    expect(results.map((item) => item.name)).toEqual(['胸痛']);
    expect(results[0]).toMatchObject({
      diagnosisKind: 'symptom_working',
      suggestionType: 'formal',
    });
  });

  it('promotes one matched current R-code symptom when no disease diagnosis is formal', () => {
    const [result] = promoteOrdinaryVoiceSymptomWorkingDiagnosis([matchedDiagnosis()]);

    expect(result).toMatchObject({
      name: '胸痛',
      diagnosisKind: 'symptom_working',
      clinicalRole: 'current_diagnosis',
      suggestionType: 'formal',
    });
  });

  it('does not promote a symptom whose claimed evidence is absent from the chief complaint and HPI', () => {
    const result = promoteOrdinaryVoiceSymptomWorkingDiagnosis([
      matchedDiagnosis({
        name: '头晕',
        currentVisitEvidenceText: '本次反复头晕伴视物旋转',
        matchedItem: { id: 'diag-r42', code: 'R42.x00', name: '头晕' },
      }),
    ], {
      chiefComplaint: '胸口不适伴偶发隐痛2至3个月',
      historyOfPresentIllness: '胸部不适间断发作，无放射痛。',
    });

    expect(result).toEqual([]);
  });

  it('promotes only the highest-confidence eligible symptom', () => {
    const results = promoteOrdinaryVoiceSymptomWorkingDiagnosis([
      matchedDiagnosis({ name: '胸痛', confidence: 'medium' }),
      matchedDiagnosis({
        name: '头晕',
        confidence: 'high',
        currentVisitEvidenceText: '本次反复头晕',
        matchedItem: { id: 'diag-r42', code: 'R42.x00', name: '头晕' },
      }),
    ]);

    expect(results.filter((item) => item.suggestionType === 'formal').map((item) => item.name))
      .toEqual(['头晕']);
  });

  it.each([
    ['unmatched', matchedDiagnosis({ matchedItem: null })],
    ['low-confidence', matchedDiagnosis({ confidence: 'low' })],
    ['negated', matchedDiagnosis({ currentVisitEvidenceText: '否认胸痛' })],
    ['contradictory', matchedDiagnosis({ currentVisitEvidenceText: '胸闷有，也没有，基本没有' })],
    ['history-only', matchedDiagnosis({ evidenceScope: 'history_only' })],
  ])('does not promote a %s symptom', (_label, item) => {
    expect(promoteOrdinaryVoiceSymptomWorkingDiagnosis([item])).toEqual([]);
  });

  it('does not promote a symptom when a matched etiologic disease is already formal', () => {
    const results = promoteOrdinaryVoiceSymptomWorkingDiagnosis([
      matchedDiagnosis(),
      {
        ...diagnosis({
          name: '肋软骨炎',
          confidence: 'medium',
          suggestionType: 'formal',
          evidenceScope: 'current_visit',
          currentVisitEvidenceText: '胸壁局部压痛',
          diagnosisKind: 'disease',
          clinicalRole: 'current_diagnosis',
        }),
        matchedItem: { id: 'diag-m94', code: 'M94.000', name: '肋软骨炎' },
      },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: '肋软骨炎', suggestionType: 'formal' });
  });
});

describe('constrainOrdinaryVoiceWorkingDiagnosisPlan', () => {
  const plan: VoiceRecommendationPlan = {
    mode: 'parallel',
    recommendNow: ['medicine', 'exam'],
    defer: [],
    skip: ['lab_test'],
    reason: '',
  };

  it('allows only examination branches and defers medicine for a working diagnosis', () => {
    const result = constrainOrdinaryVoiceWorkingDiagnosisPlan(plan, [
      matchedDiagnosis({ suggestionType: 'formal' }),
    ]);

    expect(result).toMatchObject({
      mode: 'diagnostic_first',
      recommendNow: ['exam'],
      defer: ['medicine'],
      skip: [],
      resumeCondition: 'report_available',
    });
  });

  it('preserves urgent-referral and explicit-only safety decisions', () => {
    const working = [matchedDiagnosis({ suggestionType: 'formal' })];
    const urgent = { ...plan, mode: 'urgent_referral' as const };
    const explicit = { ...plan, mode: 'explicit_only' as const };

    expect(constrainOrdinaryVoiceWorkingDiagnosisPlan(urgent, working)).toBe(urgent);
    expect(constrainOrdinaryVoiceWorkingDiagnosisPlan(explicit, working)).toBe(explicit);
  });
});
