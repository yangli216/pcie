import { describe, expect, it } from 'vitest';
import type { ClinicalResultTreatment } from './clinicalResultContract';
import { getAllowedIntentTreatments } from './intentTreatmentScope';

function treatment(
  patch: Pick<ClinicalResultTreatment, 'type' | 'name'> & Partial<ClinicalResultTreatment>,
): ClinicalResultTreatment {
  return { ...patch };
}

const medicine = treatment({ type: 'medicine', name: '苯磺酸氨氯地平片', sourceType: 'inferred' });
const legacyExam = treatment({
  type: 'examination',
  name: '胸部正位X线',
  sourceType: 'uncertain',
  goalGroup: '健康处方推荐',
  text: '健康处方推荐：胸部正位X线',
  selected: true,
});
const legacyLab = treatment({
  type: 'labTest',
  name: '糖化血红蛋白',
  sourceType: 'uncertain',
  evidenceText: '来源：getUserInfo；核对范围：PHIS近90天返回的已出报告。',
});
const doctorExam = treatment({ type: 'examination', name: '胸部正位X线', sourceType: 'explicit' });
const ordinaryInferredExam = treatment({
  type: 'examination',
  name: '腹部B超',
  sourceType: 'inferred',
  goalGroup: '腹部影像评估',
});

describe('getAllowedIntentTreatments', () => {
  it('drops legacy health-prescription examination candidates from an old chronic result with a wide whitelist', () => {
    const names = getAllowedIntentTreatments({
      channel: 'chronic-refill',
      treatments: [medicine, legacyExam, legacyLab, doctorExam, ordinaryInferredExam],
      recommendationPolicy: { allowedTreatmentTypes: ['medicine', 'examination', 'labTest'] },
    }).map((item) => item.name);

    expect(names).toEqual(['苯磺酸氨氯地平片', '胸部正位X线', '腹部B超']);
  });

  it('drops legacy health-prescription candidates from an old chronic result without a whitelist', () => {
    const names = getAllowedIntentTreatments({
      channel: 'chronic-refill',
      treatments: [medicine, legacyExam, doctorExam, ordinaryInferredExam],
    }).map((item) => item.name);

    expect(names).toEqual(['苯磺酸氨氯地平片', '胸部正位X线', '腹部B超']);
  });

  it('keeps only medicine and explicit doctor orders under the current chronic whitelist', () => {
    const names = getAllowedIntentTreatments({
      channel: 'chronic-refill',
      treatments: [medicine, legacyExam, doctorExam, ordinaryInferredExam],
      recommendationPolicy: { allowedTreatmentTypes: ['medicine'] },
    }).map((item) => item.name);

    expect(names).toEqual(['苯磺酸氨氯地平片', '胸部正位X线']);
  });

  it('does not apply the chronic filtering to ordinary voice or other channels', () => {
    const voice = getAllowedIntentTreatments({
      channel: 'voice',
      treatments: [medicine, legacyExam, doctorExam],
    }).map((item) => item.name);
    const symptom = getAllowedIntentTreatments({
      channel: 'symptom',
      treatments: [medicine, legacyExam, doctorExam],
      recommendationPolicy: { allowedTreatmentTypes: ['medicine', 'examination'] },
    }).map((item) => item.name);

    expect(voice).toEqual(['苯磺酸氨氯地平片', '胸部正位X线', '胸部正位X线']);
    expect(symptom).toEqual(['苯磺酸氨氯地平片', '胸部正位X线', '胸部正位X线']);
  });
});
