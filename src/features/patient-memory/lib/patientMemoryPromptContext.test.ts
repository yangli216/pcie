import { describe, expect, it } from 'vitest';
import type { PatientMemoryBrief } from '@entities/patient-memory';
import { buildPatientMemoryPromptContext } from './patientMemoryPromptContext';

function briefFixture(): PatientMemoryBrief {
  return {
    memoryId: 'MEM-1',
    memoryVersion: 2,
    patientId: 'PAT-1',
    qualityStatus: 'conflicted',
    conflictCount: 1,
    allergies: [{
      factId: 'A-1',
      factType: 'allergy',
      name: '青霉素',
      status: 'active',
      confidence: 'structured',
    }],
    chronicConditions: [{
      factId: 'D-1',
      factType: 'chronic_condition',
      name: '2型糖尿病',
      status: 'historical',
      confidence: 'structured',
    }],
    recentDiagnoses: [],
    recentMedications: [{
      factId: 'M-1',
      factType: 'medication',
      name: '盐酸二甲双胍片',
      valueText: '0.5g · 每日2次 · 口服',
      status: 'historical',
      confidence: 'structured',
    }, {
      factId: 'M-2',
      factType: 'medication',
      name: '已停用药物',
      status: 'inactive',
      confidence: 'structured',
    }],
    otherFacts: [],
  };
}

describe('buildPatientMemoryPromptContext', () => {
  it('frames memory as verification clues instead of current-visit facts', () => {
    const context = buildPatientMemoryPromptContext(briefFixture());

    expect(context).toContain('仅作本次核对线索');
    expect(context).toContain('不等同于本次就诊事实');
    expect(context).toContain('青霉素');
    expect(context).toContain('2型糖尿病');
    expect(context).toContain('盐酸二甲双胍片');
    expect(context).not.toContain('0.5g');
    expect(context).not.toContain('每日2次');
    expect(context).toContain('存在未消解冲突');
    expect(context).not.toContain('已停用药物');
  });

  it('returns no prompt block when no usable memory facts exist', () => {
    const brief = briefFixture();
    brief.allergies = [];
    brief.chronicConditions = [];
    brief.recentMedications = [];
    expect(buildPatientMemoryPromptContext(brief)).toBe('');
  });

  it('removes clues already present in authoritative patient context', () => {
    const context = buildPatientMemoryPromptContext(briefFixture(), {
      knownAllergyText: '药物过敏：青霉素',
      knownConditionText: '既往确诊2型糖尿病',
      knownMedicationText: '目前服用盐酸二甲双胍片',
    });

    expect(context).toBe('');
  });
});
