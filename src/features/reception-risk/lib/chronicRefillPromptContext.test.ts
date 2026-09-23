import { describe, expect, it } from 'vitest';
import type { ChronicRefillCandidate } from './chronicRefillAssessment';
import {
  buildChronicRefillInventoryPromptContext,
  buildChronicRefillMedicationScopePromptContext,
  buildCompactChronicRefillHistoryEvidence,
} from './chronicRefillPromptContext';

function candidate(overrides: Partial<ChronicRefillCandidate> = {}): ChronicRefillCandidate {
  return {
    diagnosis: '原发性高血压',
    diagnoses: ['原发性高血压'],
    diagnosisGroups: ['高血压'],
    medications: [],
    chronicVisitCount: 0,
    chronicVisits: [],
    diagnosisEvidenceText: '',
    medicationEvidenceText: '',
    evidenceText: '',
    ...overrides,
  };
}

describe('chronicRefillPromptContext', () => {
  it('aggregates repeated visits by medicine and omits empty visit fields', () => {
    const value = buildCompactChronicRefillHistoryEvidence(candidate({
      chronicVisits: [
        {
          visitTime: Date.parse('2026-09-18T08:00:00+08:00'),
          chiefComplaint: '',
          presentIllness: '',
          medicationOrders: [{
            name: '☆盐酸二甲双胍缓释片', dose: '1', doseUnit: 'g', frequency: '每日一次', route: '口服', days: '30',
          }],
        },
        {
          visitTime: Date.parse('2026-09-09T08:00:00+08:00'),
          medicationOrders: [{
            name: '☆盐酸二甲双胍缓释片', dose: '1', doseUnit: 'g', frequency: '每日一次', route: '口服', days: '30',
          }],
        },
      ],
    }));

    expect(value).toContain('H1|盐酸二甲双胍缓释片');
    expect(value).toContain('出现2次');
    expect(value).toContain('最近方案:每次1g 每日一次 口服 30天');
    expect(value).not.toMatch(/第1次|主诉|现病史|未记录/u);
    expect(value.match(/盐酸二甲双胍缓释片/gu)).toHaveLength(1);
  });

  it('groups repeated attribution items behind short refs and expands accepted refs safely', () => {
    const shared = {
      medication: { name: '苯磺酸氨氯地平片', spec: '5mg*28片/盒' },
      source: 'structured' as const,
      candidateConditionIds: ['高血压', '糖尿病'],
    };
    const context = buildChronicRefillMedicationScopePromptContext(candidate({
      conditions: [
        { id: '高血压', diagnosis: '原发性高血压', diagnosisGroup: '高血压', hasMedicationEvidence: true },
        { id: '糖尿病', diagnosis: '2型糖尿病', diagnosisGroup: '糖尿病', hasMedicationEvidence: true },
      ],
      medicationAttributions: [
        { id: 'long-visit-id::rx-1', visitTime: 2, ...shared },
        { id: 'other-long-visit-id::rx-2', visitTime: 1, ...shared },
      ],
    }));

    expect(context.itemCount).toBe(2);
    expect(context.groupCount).toBe(1);
    expect(context.prompt).toContain('M1');
    expect(context.prompt).toContain('C1');
    expect(context.prompt).not.toContain('long-visit-id');
    expect(context.decode({ accepted: [['M1', 'C1', 'h'], ['unknown', 'C1', 'h']] })).toEqual({
      assignments: [
        { itemId: 'long-visit-id::rx-1', conditionId: '高血压', confidence: 'high' },
        { itemId: 'other-long-visit-id::rx-2', conditionId: '高血压', confidence: 'high' },
      ],
    });
    expect(context.decode({ accepted: [['M1', 'C2', 'low']] })).toEqual({ assignments: [] });
  });

  it('uses short inventory refs without losing the local catalog mapping', () => {
    const item = {
      productId: 'med-1', productName: '☆盐酸二甲双胍片', spec: '0.5g*60片/瓶',
      availableQuantity: 20, storeIds: ['1'], storeNames: ['西药房'],
    };
    const context = buildChronicRefillInventoryPromptContext([item]);

    expect(context.prompt).toContain('S1|盐酸二甲双胍片|0.5g*60片/瓶');
    expect(context.prompt).not.toContain('med-1');
    expect(context.byRef.get('S1')).toBe(item);
  });
});
