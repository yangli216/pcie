import { describe, expect, it } from 'vitest';
import type { ChronicRefillCandidate } from '@features/reception-risk/lib/chronicRefillAssessment';
import { resolveVoiceChronicRefillRoute } from './voiceChronicRefillRouting';

function candidate(diagnoses = ['原发性高血压', '前列腺增生']): ChronicRefillCandidate {
  return {
    diagnosis: diagnoses[0],
    diagnoses,
    diagnosisGroups: diagnoses.map((diagnosis) => (
      diagnosis.includes('高血压') ? '高血压' : diagnosis
    )),
    medications: [],
    chronicVisitCount: 1,
    chronicVisits: [],
    diagnosisEvidenceText: '历史慢病诊断',
    medicationEvidenceText: '暂无历史用药',
    evidenceText: '历史慢病候选',
    conditions: diagnoses.map((diagnosis) => ({
      id: diagnosis.includes('高血压') ? '高血压' : diagnosis,
      diagnosis,
      diagnosisGroup: diagnosis.includes('高血压') ? '高血压' : diagnosis,
      hasMedicationEvidence: false,
      medicationEvidenceScope: 'none',
    })),
  };
}

describe('resolveVoiceChronicRefillRoute', () => {
  it('uses every explicitly mentioned historical chronic condition as the refill scope', () => {
    expect(resolveVoiceChronicRefillRoute(
      '原发性高血压、前列腺增生今天来复诊配药',
      candidate(),
    )).toEqual({
      type: 'confirm-chronic-refill',
      reason: 'explicit-scope',
      conditionIds: ['高血压', '前列腺增生'],
    });
  });

  it('does not add an unmentioned chronic condition to a specific refill request', () => {
    expect(resolveVoiceChronicRefillRoute('高血压复诊续方', candidate())).toEqual({
      type: 'confirm-chronic-refill',
      reason: 'explicit-scope',
      conditionIds: ['高血压'],
    });
  });

  it('auto-confirms the only candidate but asks for scope when multiple candidates are ambiguous', () => {
    expect(resolveVoiceChronicRefillRoute('今天来复诊配药', candidate(['原发性高血压']))).toEqual({
      type: 'confirm-chronic-refill',
      reason: 'single-candidate',
      conditionIds: ['高血压'],
    });
    expect(resolveVoiceChronicRefillRoute('今天来复诊配药', candidate())).toEqual({
      type: 'select-chronic-refill-scope',
      reason: 'multiple-candidates-without-explicit-scope',
    });
  });

  it.each([
    ['高血压复诊，今天带检查结果来配药', 'report-follow-up'],
    ['高血压复诊配药，最近胸痛加重', 'clinical-change'],
    ['原发性高血压、前列腺增生复诊', 'not-refill-purpose'],
  ] as const)('keeps %s in the ordinary/report assessment path', (transcript, reason) => {
    expect(resolveVoiceChronicRefillRoute(transcript, candidate())).toEqual({
      type: 'continue-ordinary-voice',
      reason,
    });
  });

  it('does not treat negated urgent symptoms as an acute-change signal', () => {
    expect(resolveVoiceChronicRefillRoute(
      '高血压复诊配药，无胸痛、呼吸困难',
      candidate(),
    )).toEqual({
      type: 'confirm-chronic-refill',
      reason: 'explicit-scope',
      conditionIds: ['高血压'],
    });
  });
});
