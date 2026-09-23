import { describe, expect, it } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';
import { normalizeChronicRefillConfirmationPlan } from '@features/reception-risk/lib/chronicRefillConfirmation';
import type { ChronicRefillCandidate } from '@features/reception-risk/lib/chronicRefillAssessment';
import {
  updateChronicRefillReviewRecordText,
  useChronicRefillReview,
} from './useChronicRefillReview';

const plan = {
  summary: '请核查本次复诊信息',
  items: [
    {
      id: 'control',
      question: '近期控制情况如何？',
      description: '',
      options: [
        { value: 'stable', label: '控制平稳', recordText: '近期血压控制平稳' },
        { value: 'poor', label: '控制欠佳', recordText: '近期血压控制欠佳', treatmentReviewRequired: true },
        { value: 'unknown', label: '暂未评估', recordText: '' },
      ],
      recommendedValue: 'unknown',
      confidence: 'low' as const,
      evidence: 'unknown' as const,
      basis: '待本次核查',
      priority: 'critical' as const,
    },
  ],
};

describe('updateChronicRefillReviewRecordText', () => {
  it('appends and replaces only the review fragment', () => {
    const initial = '患者既往确诊高血压。今复诊配药。';
    const stable = updateChronicRefillReviewRecordText(initial, '', '近期血压控制平稳');
    expect(stable).toBe('患者既往确诊高血压。今复诊配药。近期血压控制平稳');
    expect(updateChronicRefillReviewRecordText(
      stable,
      '近期血压控制平稳',
      '近期血压控制欠佳',
    )).toBe('患者既往确诊高血压。今复诊配药。近期血压控制欠佳');
    expect(updateChronicRefillReviewRecordText(
      stable,
      '',
      '近期血压控制平稳',
    )).toBe(stable);
  });
});

describe('useChronicRefillReview', () => {
  it('selects fallback medication status without copying historical prescriptions', () => {
    const candidate = {
      diagnoses: ['高血压病'],
      medications: ['苯磺酸氨氯地平片', '缬沙坦'],
    } as ChronicRefillCandidate;
    const fallback = normalizeChronicRefillConfirmationPlan(null, candidate);
    let history = '患者既往确诊高血压病。今复诊配药。';
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => [],
    });
    controller.reset(fallback);
    const item = fallback.items[0];
    expect(item.description).toContain('苯磺酸氨氯地平片');
    controller.select(item.id, item.options[0]);
    controller.select(item.id, item.options[0]);
    expect(history).toBe('患者既往确诊高血压病。今复诊配药。仍按近期方案服药');
    controller.select(item.id, item.options[1]);
    expect(history).toBe('患者既往确诊高血压病。今复诊配药。近期用药方案已有调整');
    controller.select(item.id, item.options[3]);
    expect(history).toBe('患者既往确诊高血压病。今复诊配药。');
  });

  it('guards an existing model plan at click time and preserves manual history and safety behavior', () => {
    const manualHistory = '医生记录：服用缬沙坦后头晕。';
    let history = manualHistory;
    const treatments = [{ type: 'medicine', name: '缬沙坦', selected: true }] as TreatmentRecommendation[];
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => treatments,
    });
    const unsafePlan = structuredClone(plan);
    unsafePlan.items[0].options[1].recordText = '近期自行停用缬沙坦，血压控制欠佳';
    controller.reset(unsafePlan);
    controller.select('control', unsafePlan.items[0].options[1]);
    expect(history).toBe(manualHistory);
    expect(controller.selections.value.control).toBe('poor');
    expect(treatments[0].selected).toBe(false);
    expect(controller.treatmentReviewTriggered.value).toBe(true);
    controller.select('control', unsafePlan.items[0].options[0]);
    expect(history).toBe(`${manualHistory}近期血压控制平稳`);
  });

  it('cleans prescription details already present before applying a review answer', () => {
    let history = '患者既往确诊2型糖尿病、高血压2级。今复诊配药：厄贝沙坦片口服1天共1盒。';
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => [],
    });

    controller.reset(plan);
    controller.select('control', plan.items[0].options[0]);

    expect(history).toBe('患者既往确诊2型糖尿病、高血压2级。今复诊配药。近期血压控制平稳');
    expect(history).not.toMatch(/厄贝沙坦|口服|共1盒/u);
  });

  it('keeps review optional and only writes explicitly selected facts', () => {
    let history = '患者既往确诊高血压。今复诊配药。';
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => [],
    });

    controller.reset(plan);
    expect(controller.selections.value).toEqual({});
    expect('ensureWritebackReady' in controller).toBe(false);
    expect(history).toBe('患者既往确诊高血压。今复诊配药。');

    controller.select('control', plan.items[0].options[2]);
    expect(history).not.toContain('控制平稳');
  });

  it('writes a confirmed fact and clears selected medicines when the answer affects refill safety', () => {
    let history = '患者既往确诊高血压。今复诊配药。';
    const treatments = [{
      type: 'medicine',
      name: '苯磺酸氨氯地平片',
      reason: '历史续方',
      selected: true,
    }] as TreatmentRecommendation[];
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => treatments,
    });

    controller.reset(plan);
    controller.select('control', plan.items[0].options[1]);

    expect(history).toContain('近期血压控制欠佳');
    expect(treatments[0].selected).toBe(false);
    expect(controller.treatmentReviewTriggered.value).toBe(true);
  });

  it('preserves a manually edited history even when it contains prescription wording', () => {
    const manualHistory = '医生记录：今复诊配药：口服药物后头晕。';
    let history = manualHistory;
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      isHistoryOfPresentIllnessModified: () => true,
      getTreatments: () => [],
    });

    controller.reset(plan);
    controller.select('control', plan.items[0].options[0]);

    expect(history).toBe(`${manualHistory}近期血压控制平稳`);
  });

  it('replaces an option fragment restored from an editor snapshot', () => {
    let history = '患者既往确诊高血压。今复诊配药。近期血压控制平稳';
    const controller = useChronicRefillReview({
      getHistoryOfPresentIllness: () => history,
      setHistoryOfPresentIllness: (value) => { history = value; },
      getTreatments: () => [],
    });

    controller.reset(plan);
    controller.select('control', plan.items[0].options[1]);

    expect(history).toContain('近期血压控制欠佳');
    expect(history).not.toContain('近期血压控制平稳');
  });
});
