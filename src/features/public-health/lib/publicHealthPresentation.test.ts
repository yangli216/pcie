import { describe, expect, it } from 'vitest';
import { supplementFacts } from './publicHealthContract';
import { testTime, testUuid, testWeightRequest } from '../testFixtures';
import { formatFactSource, formatMeasurementTime, presentPublicHealthLifestyle, presentPublicHealthMeasurements } from './publicHealthPresentation';

describe('public health measurement presentation', () => {
  it('shows the same instant in Beijing time including a UTC day boundary', () => {
    expect(formatMeasurementTime('2026-09-28T01:30:00.000Z')).toBe('2026-09-28 09:30:00（北京时间）');
    expect(formatMeasurementTime('2026-09-28T09:30:00+08:00')).toBe('2026-09-28 09:30:00（北京时间）');
    expect(formatMeasurementTime('2026-09-28T16:30:00.000Z')).toBe('2026-09-29 00:30:00（北京时间）');
  });
  it('labels manual provenance without replacing upstream source identities', () => {
    expect(formatFactSource('PCIE_MANUAL')).toBe('人工补充');
    expect(formatFactSource('PHIS')).toBe('PHIS');
    expect(formatMeasurementTime('bad')).toBe('测量时间待核对');
  });
  it('puts explicitly adopted measurements first and preserves original and later unadopted facts in history', () => {
    const original = testWeightRequest(); let id = 100;
    const updated = supplementFacts(original, {
      sex: 'female', historySummary: '合成更新', heightCm: 170, weightKg: 68,
      heightMeasuredAt: testTime, weightMeasuredAt: testTime, region: '华东', season: 'autumn',
    }, () => testUuid(id++), () => testTime);
    updated.facts.observations.push({
      id: 'later-unadopted-height', code: 'height', value: 175, unit: 'cm', observedAt: '2026-10-01T10:00:00+08:00',
      source: { system: 'PHIS', recordId: 'later-height' },
    });
    const before = structuredClone(updated);
    const view = presentPublicHealthMeasurements(updated);
    expect(view.observations.map(item => [item.label, item.value, item.isAdopted])).toEqual([
      ['身高', 170, true], ['体重', 68, true], ['systolic_bp', 138, false],
    ]);
    expect(view.historical.map(item => item.id)).toEqual(['phis-height', 'phis-weight', 'later-unadopted-height']);
    expect(view.historical[0]).toMatchObject(original.facts.observations[1]);
    expect(updated).toEqual(before);
  });
  it.each(['missing', 'wrong-code', 'wrong-unit', 'wrong-value'] as const)(
    'does not guess an adopted height for a %s reference', (problem) => {
      const request = testWeightRequest();
      if (problem === 'missing') delete request.facts.weightProfile!.heightObservationId;
      if (problem === 'wrong-code') request.facts.observations[1].code = 'other';
      if (problem === 'wrong-unit') request.facts.observations[1].unit = 'm';
      if (problem === 'wrong-value') request.facts.observations[1].value = 170;
      const view = presentPublicHealthMeasurements(request);
      expect(view.observations.filter(item => item.isAdopted).map(item => item.id)).toEqual(['phis-weight']);
      expect(view.observations.find(item => item.id === 'phis-height')).toBeDefined();
      expect(view.historical).toEqual([]);
    },
  );
  it('keeps the original measurement order and lifestyle for health-prescription tasks', () => {
    const request = testWeightRequest(); request.capability = 'health_prescription';
    request.facts.weightProfile!.activityDescription = '减重采用活动';
    const view = presentPublicHealthMeasurements(request);
    expect(view.observations.map(item => item.id)).toEqual(['phis-bp', 'phis-height', 'phis-weight']);
    expect(view.observations.every(item => !item.isAdopted)).toBe(true);
    expect(view.historical).toEqual([]);
    expect(presentPublicHealthLifestyle(request).find(item => item.key === 'exercise')?.value).toBe('原始散步资料');
  });
  it('uses current weight-profile lifestyle and does not restore original values when cleared', () => {
    const request = testWeightRequest();
    request.facts.weightProfile!.activityDescription = '合成调整后的活动';
    request.facts.weightProfile!.dietPreferences = '合成调整后的饮食';
    expect(presentPublicHealthLifestyle(request).map(item => item.value)).toEqual([
      '不吸烟（合成资料）', '合成调整后的活动', '合成调整后的饮食',
    ]);
    delete request.facts.weightProfile!.activityDescription;
    delete request.facts.weightProfile!.dietPreferences;
    expect(presentPublicHealthLifestyle(request).map(item => item.key)).toEqual(['smoking']);
    expect(request.facts.lifestyle).toMatchObject({ exercise: '原始散步资料', diet: '原始饮食资料' });
  });
});
