import { describe, expect, it } from 'vitest';
import type { HisVisitRecord } from '@/services/his/types';
import {
  assessChronicRefillCandidate,
  isReportFollowUpIntent,
  scopeChronicRefillCandidate,
} from './chronicRefillAssessment';

const DAY = 24 * 60 * 60 * 1000;

function history(visits: HisVisitRecord[]) {
  return {
    patientId: 'patient-1',
    visits,
  };
}

describe('assessChronicRefillCandidate', () => {
  it('accepts one chronic visit with medication in the queried history window', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 3 * DAY,
        diagnoses: ['冠心病'],
        medications: ['阿司匹林肠溶片（100mg*30片）'],
      },
      {
        visitTime: now - 20 * DAY,
        diagnoses: ['普通感冒'],
      },
    ]));

    expect(result?.diagnosis).toBe('冠心病');
    expect(result?.chronicVisitCount).toBe(1);
    expect(result?.medications).toEqual(['阿司匹林肠溶片（100mg*30片）']);
    expect(result?.evidenceText).not.toMatch(/\d+次|最近3次/u);
    expect(result?.diagnosisEvidenceText).toBe('近期历史就诊记录有“冠心病”诊断');
    expect(result?.medicationEvidenceText).toContain('阿司匹林肠溶片');
  });

  it('collects chronic visits and medications from the queried history window without requiring repetition', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 7 * DAY,
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片（5mg*28片）'],
      },
      {
        visitTime: now - 35 * DAY,
        diagnoses: ['糖尿病'],
        medications: ['盐酸二甲双胍片 0.5g'],
      },
      {
        visitTime: now - 50 * DAY,
        diagnoses: ['急性上呼吸道感染'],
        medications: ['阿莫西林胶囊'],
      },
    ]));

    expect(result?.diagnosis).toBe('高血压');
    expect(result?.diagnoses).toEqual(['高血压', '糖尿病']);
    expect(result?.diagnosisGroups).toEqual(['高血压', '糖尿病']);
    expect(result?.chronicVisitCount).toBe(2);
    expect(result?.medications).toEqual([
      '苯磺酸氨氯地平片（5mg*28片）',
      '盐酸二甲双胍片 0.5g',
    ]);
    expect(result?.chronicVisits).toHaveLength(2);
    expect(result?.prescriptionHistoryVisits).toHaveLength(3);
    expect(result?.conditions).toEqual([
      expect.objectContaining({ id: '高血压', diagnosis: '高血压', diagnosisGroup: '高血压' }),
      expect.objectContaining({ id: '糖尿病', diagnosis: '糖尿病', diagnosisGroup: '糖尿病' }),
    ]);
  });

  it('scopes a multi-condition candidate to the chronic disease confirmed by the doctor', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const candidate = assessChronicRefillCandidate(history([
      {
        visitTime: now - 7 * DAY,
        diagnoses: ['高血压病'],
        medications: ['苯磺酸氨氯地平片'],
      },
      {
        visitTime: now - 35 * DAY,
        diagnoses: ['2型糖尿病'],
        medications: ['盐酸二甲双胍片'],
      },
    ]));

    const scoped = scopeChronicRefillCandidate(candidate!, ['高血压']);

    expect(scoped).toMatchObject({
      diagnosis: '高血压病',
      diagnoses: ['高血压病'],
      diagnosisGroups: ['高血压'],
      medications: ['苯磺酸氨氯地平片'],
      chronicVisitCount: 1,
    });
    expect(scoped?.chronicVisits[0].diagnoses).toEqual(['高血压病']);
    expect(scoped?.evidenceText).not.toContain('糖尿病');
    expect(scoped?.medications).not.toContain('盐酸二甲双胍片');
    expect(scoped?.prescriptionHistoryVisits).toHaveLength(2);
    expect(scoped?.historicalDiagnoses).toEqual(['高血压病', '2型糖尿病']);
    expect(scopeChronicRefillCandidate(scoped!, ['高血压'])?.historicalDiagnoses)
      .toEqual(['高血压病', '2型糖尿病']);
    const diabetesOnly = scopeChronicRefillCandidate(candidate!, ['糖尿病']);
    expect(diabetesOnly?.diagnoses).toEqual(['2型糖尿病']);
    expect(diabetesOnly?.historicalDiagnoses).toEqual(['高血压病', '2型糖尿病']);
    expect(candidate?.diagnoses).toEqual(['高血压病', '2型糖尿病']);
  });

  it('does not inherit an ambiguous mixed prescription when only part of that visit conditions are selected', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const candidate = assessChronicRefillCandidate(history([{
      visitTime: now - 7 * DAY,
      diagnoses: ['高血压', '2型糖尿病'],
      medications: ['苯磺酸氨氯地平片', '盐酸二甲双胍片'],
      medicationOrders: [
        { orderId: 'hypertension-med', name: '苯磺酸氨氯地平片' },
        { orderId: 'diabetes-med', name: '盐酸二甲双胍片' },
      ],
    }]));

    const hypertensionOnly = scopeChronicRefillCandidate(candidate!, ['高血压']);
    const bothConditions = scopeChronicRefillCandidate(candidate!, ['高血压', '糖尿病']);
    const hypertensionMedication = candidate?.medicationAttributions?.find((item) => (
      item.medication.name === '苯磺酸氨氯地平片'
    ));
    const attributedCandidate = {
      ...candidate!,
      medicationAttributionStatus: 'ready' as const,
      medicationAttributions: candidate?.medicationAttributions?.map((item) => (
        item.id === hypertensionMedication?.id
          ? {
            ...item,
            suggestedConditionId: '高血压',
            confidence: 'high' as const,
            reason: '常用降压药',
          }
          : {
            ...item,
            suggestedConditionId: '糖尿病',
            confidence: 'high' as const,
            reason: '常用降糖药',
          }
      )),
    };
    const automaticallyAttributedHypertensionMedication = scopeChronicRefillCandidate(
      attributedCandidate,
      ['高血压'],
    );

    expect(candidate?.conditions?.map((condition) => condition.medicationEvidenceScope)).toEqual([
      'shared',
      'shared',
    ]);
    expect(hypertensionOnly?.chronicVisits).toHaveLength(1);
    expect(hypertensionOnly?.medications).toEqual([]);
    expect(hypertensionOnly?.medicationOrders).toBeUndefined();
    expect(candidate?.medicationAttributionStatus).toBe('loading');
    expect(candidate?.medicationAttributions).toHaveLength(2);
    expect(automaticallyAttributedHypertensionMedication?.medications).toEqual(['苯磺酸氨氯地平片']);
    expect(automaticallyAttributedHypertensionMedication?.medicationOrders).toEqual([
      expect.objectContaining({ orderId: 'hypertension-med' }),
    ]);
    expect(automaticallyAttributedHypertensionMedication?.medications).not.toContain('盐酸二甲双胍片');
    expect(bothConditions?.medications).toEqual(['苯磺酸氨氯地平片', '盐酸二甲双胍片']);
    expect(bothConditions?.medicationOrders).toHaveLength(2);
  });

  it('keeps the latest structured prescription attributes for each medicine', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 3 * DAY,
        diagnoses: ['糖尿病'],
        medications: ['盐酸二甲双胍片（30天）'],
        medicationOrders: [{
          orderId: 'latest-order',
          productId: 'med-metformin',
          name: '盐酸二甲双胍片',
          days: '30',
        }],
      },
      {
        visitTime: now - 20 * DAY,
        diagnoses: ['糖尿病'],
        medications: ['盐酸二甲双胍片（14天）'],
        medicationOrders: [{
          orderId: 'older-order',
          productId: 'med-metformin',
          name: '盐酸二甲双胍片',
          days: '14',
        }],
      },
    ]));

    expect(result?.medicationOrders).toEqual([
      expect.objectContaining({ orderId: 'latest-order', days: '30' }),
    ]);
  });

  it('preserves a specific historical diagnosis instead of replacing it with the chronic group name', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 7 * DAY,
      diagnoses: ['2型糖尿病'],
      medications: ['盐酸二甲双胍片 0.5g'],
    }]));

    expect(result?.diagnosis).toBe('2型糖尿病');
    expect(result?.diagnoses).toEqual(['2型糖尿病']);
    expect(result?.diagnosisGroups).toEqual(['糖尿病']);
    expect(result?.evidenceText).toContain('2型糖尿病');
  });

  it('prefers a specific diagnosis over a generic name in the same chronic group', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 3 * DAY,
        diagnoses: ['糖尿病'],
        medications: ['盐酸二甲双胍片 0.5g'],
      },
      {
        visitTime: now - 20 * DAY,
        diagnoses: ['2型糖尿病'],
        medications: ['盐酸二甲双胍片 0.5g'],
      },
    ]));

    expect(result?.diagnosis).toBe('2型糖尿病');
    expect(result?.diagnoses).toEqual(['2型糖尿病']);
    expect(result?.diagnosisGroups).toEqual(['糖尿病']);
  });

  it('keeps a generic diagnosis when history does not provide a supported subtype', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 7 * DAY,
      diagnoses: ['糖尿病'],
      medications: ['盐酸二甲双胍片 0.5g'],
    }]));

    expect(result?.diagnosis).toBe('糖尿病');
    expect(result?.diagnoses).toEqual(['糖尿病']);
    expect(result?.diagnosisGroups).toEqual(['糖尿病']);
  });

  it('keeps a prescription from 90 days ago even when five newer acute visits would have pushed it beyond the old limit', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 5 * DAY,
        diagnoses: ['普通感冒'],
      },
      {
        visitTime: now - 10 * DAY,
        diagnoses: ['急性咽炎'],
      },
      {
        visitTime: now - 20 * DAY,
        diagnoses: ['急性胃肠炎'],
      },
      {
        visitTime: now - 30 * DAY,
        diagnoses: ['外伤'],
      },
      {
        visitTime: now - 45 * DAY,
        diagnoses: ['急性支气管炎'],
      },
      {
        visitTime: now - 90 * DAY,
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片'],
      },
    ]));

    expect(result?.diagnosis).toBe('高血压');
    expect(result?.medications).toEqual(['苯磺酸氨氯地平片']);
  });

  it('keeps the chronic candidate but excludes medication from an unrelated acute visit', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 5 * DAY,
        diagnoses: ['高血压'],
      },
      {
        visitTime: now - 30 * DAY,
        diagnoses: ['急性上呼吸道感染'],
        medications: ['苯磺酸氨氯地平片'],
      },
    ]));

    expect(result?.diagnosis).toBe('高血压');
    expect(result?.medications).toEqual([]);
    expect(result?.medicationEvidenceText).toBe('未获取到可确认的历史用药记录');
  });

  it('keeps a chronic candidate when the chronic visit has no historical medication', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnoses: ['2型糖尿病'],
    }]));

    expect(result).toMatchObject({
      diagnosis: '2型糖尿病',
      diagnoses: ['2型糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: [],
      diagnosisEvidenceText: '近期历史就诊记录有“2型糖尿病”诊断',
      medicationEvidenceText: '未获取到可确认的历史用药记录',
    });
  });

  it.each([
    ['甲状腺功能亢进症', 'E05.900', '甲状腺功能亢进'],
    ['前列腺增生症', 'N40.x00', '前列腺增生'],
    ['骨质疏松症', 'M81.900', '骨质疏松'],
    ['脑梗死后遗症', 'I69.300', '脑血管病后遗症'],
  ])('recognizes common maintenance conditions beyond hypertension and diabetes: %s', (
    diagnosis,
    code,
    group,
  ) => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnosisEntries: [{ name: diagnosis, code }],
    }]));

    expect(result?.diagnosis).toBe(diagnosis);
    expect(result?.diagnosisGroups).toEqual([group]);
  });

  it('uses the ICD code when the HIS diagnosis name is not one of the configured aliases', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnosisEntries: [{ name: '肾功能不全3期', code: 'N18.3' }],
    }]));

    expect(result?.diagnosis).toBe('肾功能不全3期');
    expect(result?.diagnosisGroups).toEqual(['慢性肾脏病']);
  });

  it('accepts an explicit chronic diagnosis outside stable groups only with medication evidence', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnoses: ['慢性鼻窦炎'],
      medications: ['糠酸莫米松鼻喷雾剂'],
    }]));

    expect(result?.diagnosis).toBe('慢性鼻窦炎');
    expect(result?.diagnosisGroups).toEqual(['慢性鼻窦炎']);
  });

  it('does not use the generic chronic fallback without same-visit medication evidence', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnoses: ['慢性鼻窦炎'],
    }]));

    expect(result).toBeNull();
  });

  it.each([
    '慢性粒细胞白血病',
    '慢性乙肝病毒感染',
    '陈旧性骨折术后',
  ])('does not route excluded generic chronic wording into refill: %s', (diagnosis) => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnoses: [diagnosis],
      medications: ['历史处方药品'],
    }]));

    expect(result).toBeNull();
  });

  it('rejects an acute exacerbation even when its ICD code belongs to a stable chronic group', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([{
      visitTime: now - 5 * DAY,
      diagnosisEntries: [{ name: '支气管哮喘急性发作', code: 'J45.901' }],
      medications: ['布地奈德福莫特罗吸入粉雾剂'],
    }]));

    expect(result).toBeNull();
  });

  it('suppresses chronic refill when the current encounter is a report follow-up', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 7 * DAY,
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片'],
      },
    ]), {
      chiefComplaint: '携上次化验结果回诊',
      historyOfPresentIllness: '血脂检查结果已出，本次希望医生解读并调整后续治疗。',
      diagnosis: '高血压',
    });

    expect(result).toBeNull();
  });

  it('keeps an explicit refill encounter eligible when no report-return intent exists', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 7 * DAY,
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片'],
      },
    ]), {
      chiefComplaint: '高血压复诊配药',
      historyOfPresentIllness: '长期服药，本次续方。',
      diagnosis: '高血压',
    });

    expect(result?.diagnosis).toBe('高血压');
  });

  it('returns null if hasFollowUpReport parameter is true', () => {
    const now = new Date('2026-06-25T08:00:00+08:00').getTime();
    const result = assessChronicRefillCandidate(history([
      {
        visitTime: now - 7 * DAY,
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片'],
      },
    ]), {
      chiefComplaint: '高血压复诊配药',
    }, true);

    expect(result).toBeNull();
  });
});

describe('isReportFollowUpIntent', () => {
  it.each([
    '携检查报告回诊',
    '回来查看化验结果',
    '检验结果已出',
    '本次复诊解读影像报告',
  ])('recognizes report follow-up wording: %s', (chiefComplaint) => {
    expect(isReportFollowUpIntent({ chiefComplaint })).toBe(true);
  });

  it.each([
    '高血压复诊配药',
    '糖尿病长期用药续方',
    '复查血常规',
  ])('does not treat ordinary refill or future recheck wording as report follow-up: %s', (chiefComplaint) => {
    expect(isReportFollowUpIntent({ chiefComplaint })).toBe(false);
  });
});
