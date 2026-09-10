import { describe, expect, it } from 'vitest';
import type { ChronicRefillCandidate } from './chronicRefillAssessment';
import {
  buildConfirmedAnswers,
  buildConfirmedChronicRefillNarrative,
  getChronicRefillNarrativeMedicationNames,
  normalizeChronicRefillConfirmationPlan,
} from './chronicRefillConfirmation';

const candidate: ChronicRefillCandidate = {
  diagnosis: '高血压病',
  diagnoses: ['高血压病'],
  diagnosisGroups: ['高血压'],
  medications: ['苯磺酸氨氯地平片'],
  chronicVisitCount: 2,
  chronicVisits: [],
  diagnosisEvidenceText: '历史诊断为高血压病',
  medicationEvidenceText: '历史用药为苯磺酸氨氯地平片',
  evidenceText: '近期慢病复诊记录',
};

describe('chronic refill confirmation', () => {
  it('normalizes dynamic items and keeps their recommended defaults', () => {
    const plan = normalizeChronicRefillConfirmationPlan({
      summary: '只确认必要信息',
      items: [
        {
          id: 'adherence',
          question: '目前是否规律服药？',
          options: [
            { value: 'regular', label: '规律服药', recordText: '规律服用降压药物' },
            { value: 'unknown', label: '暂未确认', recordText: '待确认' },
          ],
          recommendedValue: 'regular',
          confidence: 'high',
          evidence: 'current-explicit',
          basis: '医生本次补充',
        },
        {
          id: 'control',
          question: '近期血压如何？',
          options: [
            { value: 'stable', label: '血压平稳', recordText: '近期血压平稳' },
            { value: 'unknown', label: '暂未监测', recordText: '' },
          ],
          recommendedValue: 'stable',
          confidence: 'high',
          evidence: 'current-explicit',
          basis: '医生本次补充',
        },
        {
          id: 'symptoms',
          question: '近期有无相关不适？',
          options: [
            { value: 'none', label: '无明显不适', recordText: '近期无明显相关不适' },
            { value: 'unknown', label: '暂未询问', recordText: '' },
          ],
          recommendedValue: 'unknown',
          confidence: 'low',
          evidence: 'unknown',
          basis: '待本次问诊确认',
        },
      ],
    }, candidate);

    expect(plan.items).toHaveLength(3);
    expect(buildConfirmedAnswers(plan, {})).toEqual([
      expect.objectContaining({ itemId: 'adherence', value: 'regular', recordText: '规律服用降压药物' }),
      expect.objectContaining({ itemId: 'control', value: 'stable', recordText: '近期血压平稳' }),
      expect.objectContaining({ itemId: 'symptoms', value: 'unknown', recordText: '' }),
    ]);
  });

  it('removes non-clinical, unknown and demographic text from the record gate', () => {
    const plan = normalizeChronicRefillConfirmationPlan({
      items: [
        {
          id: 'unsafe',
          question: '确认项一',
          options: [
            { value: 'inventory', label: '库存推荐', recordText: '当前库存内推荐药品' },
            { value: 'unknown', label: '待确认', recordText: '待医生核实' },
          ],
          recommendedValue: 'inventory',
        },
        {
          id: 'demographic',
          question: '确认项二',
          options: [
            { value: 'age', label: '基本信息', recordText: '女性36岁，近期血压平稳' },
            { value: 'stable', label: '血压平稳', recordText: '近期血压平稳' },
          ],
          recommendedValue: 'age',
        },
        {
          id: 'unknown',
          question: '确认项三',
          options: [
            { value: 'unknown', label: '暂未确认', recordText: '待确认' },
            { value: 'none', label: '无异常', recordText: '近期无异常' },
          ],
          recommendedValue: 'unknown',
        },
      ],
    }, candidate);

    expect(buildConfirmedAnswers(plan, {}).map((answer) => answer.recordText)).toEqual(['', '', '']);
  });

  it('builds the HPI only from confirmed facts and the refill purpose', () => {
    const result = buildConfirmedChronicRefillNarrative(candidate, {
      supplementText: '近一周晨起偶有轻微口干',
      answers: [
        {
          itemId: 'adherence',
          question: '服药情况',
          value: 'regular',
          label: '规律服药',
          recordText: '规律服用苯磺酸氨氯地平片',
          confidence: 'high',
          evidence: 'current-explicit',
          basis: '医生确认',
        },
        {
          itemId: 'symptoms',
          question: '近期不适',
          value: 'none',
          label: '无明显不适',
          recordText: '近期无头晕、头痛等不适',
          confidence: 'high',
          evidence: 'current-explicit',
          basis: '医生确认',
        },
      ],
    });

    expect(result).toEqual({
      chiefComplaint: '高血压病复诊配药',
      historyOfPresentIllness: '患者既往确诊高血压病，规律服用苯磺酸氨氯地平片，近期无头晕、头痛等不适，近一周晨起偶有轻微口干，今复诊配药。',
    });
    expect(result.historyOfPresentIllness).not.toMatch(/女性|\d+岁|库存|待医生核实/u);
  });

  it('does not add historical medicine names without an explicit current-visit fact', () => {
    expect(buildConfirmedChronicRefillNarrative(candidate, {
      answers: [],
      supplementText: '',
    })).toEqual({
      chiefComplaint: '高血压病复诊配药',
      historyOfPresentIllness: '患者既往确诊高血压病，今复诊配药。',
    });
  });

  it('keeps only concise medicine names in the narrative', () => {
    const detailedCandidate: ChronicRefillCandidate = {
      ...candidate,
      diagnosis: '糖尿病',
      diagnoses: ['糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: [
        '☆阿卡波糖片(卡博平)/50mg*30片/盒（餐前口服 每天三次 每次1片）',
        '☆盐酸二甲双胍片 0.25g*60片/瓶（口服 每天三次）',
      ],
    };

    expect(getChronicRefillNarrativeMedicationNames(detailedCandidate)).toEqual([
      '阿卡波糖片',
      '盐酸二甲双胍片',
    ]);
    expect(buildConfirmedChronicRefillNarrative(detailedCandidate, {
      answers: [],
      supplementText: '原始补充只作为模型输入',
    }, '规律服用阿卡波糖片(卡博平)/50mg*30片/盒（餐前口服）及盐酸二甲双胍片 0.25g*60片/瓶（口服），近期血糖控制平稳').historyOfPresentIllness).toBe(
      '患者既往确诊糖尿病，规律服用阿卡波糖片及盐酸二甲双胍片，近期血糖控制平稳，今复诊配药。',
    );
  });
});
