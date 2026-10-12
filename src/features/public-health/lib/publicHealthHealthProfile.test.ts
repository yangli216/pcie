import { describe, expect, it } from 'vitest';
import { buildPublicHealthHealthProfile, compareHealthObservationTime } from './publicHealthHealthProfile';
import { testRequest, testTime } from '../testFixtures';
import type { PublicHealthObservation } from '../types';

function observation(id: string, value: string | number, observedAt = testTime, code = 'systolic_bp'): PublicHealthObservation {
  return { id, code, value, unit: code === 'systolic_bp' ? 'mmHg' : undefined, observedAt, source: { system: 'SYNTHETIC_PHIS', recordId: 'synthetic-followup' } };
}

describe('public health current health profile', () => {
  it.each([
    ['2026-09-29T10:00:00+08:00', '2026-09-29T02:00:00Z', 0],
    ['2026-09-29T10:00:00+08:00', '2026-09-29T10:00:00.0+08:00', 0],
    ['2026-09-29T10:00:00.000100000+08:00', '2026-09-29T02:00:00.0001Z', 0],
    ['2026-09-29T10:00:00.000000001+08:00', '2026-09-29T10:00:00+08:00', 1],
    ['2026-09-29T10:00:00.000000001+08:00', '2026-09-29T10:00:00.000000002+08:00', -1],
    ['2026-09-29T10:00:00.999999999+08:00', '2026-09-29T10:00:01+08:00', -1],
    ['2026-09-29T00:00:00.123456789+08:00', '2026-09-28T16:00:00.123456789Z', 0],
  ])('compares full decimal precision and timezone-equivalent instants: %s vs %s', (left, right, expected) => {
    expect(compareHealthObservationTime(left, right)).toBe(expected);
  });
  it('excludes nanosecond-future facts and distinguishes successive results within the same millisecond', () => {
    const request = testRequest(); request.snapshotAt = '2026-09-29T10:00:00.000000004+08:00';
    request.facts.observations = [observation('earlier', 130, '2026-09-29T10:00:00.000000001+08:00'),
      observation('latest', 140, '2026-09-29T10:00:00.000000003+08:00'),
      observation('future', 160, '2026-09-29T10:00:00.000000005+08:00')];
    const profile = buildPublicHealthHealthProfile(request);
    expect(profile.excludedObservationIds).toEqual(['future']);
    expect(profile.latestObservations.map(item => item.id)).toEqual(['latest']);
    expect(profile.conflicts).toEqual([]);
    expect(profile.evidence.filter(item => item.ref.startsWith('observation:')).map(item => item.ref)).toEqual(['observation:earlier', 'observation:latest']);
    request.facts.observations.push(observation('same-instant-conflict', 150, '2026-09-29T02:00:00.000000003Z'));
    const conflicting = buildPublicHealthHealthProfile(request);
    expect(conflicting.latestObservations).toEqual([]);
    expect(conflicting.conflicts[0].observationIds).toEqual(['latest', 'same-instant-conflict']);
    expect(conflicting.evidence.filter(item => item.ref.startsWith('observation:')).map(item => item.ref)).toEqual(['observation:earlier']);
  });

  it('combines caller facts with source grouping and exact evidence references without changing the request', () => {
    const request = testRequest();
    request.facts.observations = [observation('old', 140, '2026-08-29T10:00:00+08:00'), observation('current', 138),
      { ...observation('exam', 86, testTime, 'diastolic_bp'), source: { system: 'SYNTHETIC_EXAM', recordId: 'synthetic-exam' } }];
    request.facts.conditions = [{ code: 'synthetic-hypertension', name: '合成高血压', status: '随访管理' }];
    request.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成药物类别' }];
    request.facts.lifestyle = { exercise: '合成步行资料', diet: '合成饮食资料' };
    const before = structuredClone(request), profile = buildPublicHealthHealthProfile(request);
    expect(profile.latestObservations.map(item => item.id)).toEqual(['current', 'exam']);
    expect(profile.sources).toEqual([
      { system: 'SYNTHETIC_PHIS', recordId: 'synthetic-followup', observationIds: ['old', 'current'] },
      { system: 'SYNTHETIC_EXAM', recordId: 'synthetic-exam', observationIds: ['exam'] },
    ]);
    expect(profile.evidence.map(item => item.ref)).toEqual(['patient:ageYears', 'patient:sex', 'observation:old', 'observation:current', 'observation:exam', 'condition:0', 'medication:0', 'lifestyle:exercise', 'lifestyle:diet', 'historySummary']);
    profile.latestObservations[0].source.recordId = 'projection-only';
    profile.conditions[0].name = 'projection-only'; profile.patient.name = 'projection-only';
    profile.evidence[2].source!.system = 'projection-only';
    expect(request).toEqual(before);
  });

  it('excludes observations after the snapshot using timezone instants rather than their string order', () => {
    const request = testRequest();
    request.facts.observations = [observation('same-instant', 138, '2026-09-29T02:00:00Z'), observation('future', 160, '2026-09-29T02:00:01Z')];
    const profile = buildPublicHealthHealthProfile(request);
    expect(profile.latestObservations.map(item => item.id)).toEqual(['same-instant']);
    expect(profile.excludedObservationIds).toEqual(['future']);
    expect(profile.sources[0].observationIds).toEqual(['same-instant']);
    expect(profile.evidence.some(item => item.ref === 'observation:future')).toBe(false);
  });

  it('does not choose between different results or units at the same latest instant, but keeps earlier dated evidence', () => {
    const request = testRequest();
    request.facts.observations = [observation('old', 130, '2026-09-01T02:00:00Z'), observation('a', 138),
      observation('b', 150, '2026-09-29T02:00:00Z'), { ...observation('unit-conflict', 138), unit: 'synthetic-unit' }];
    const profile = buildPublicHealthHealthProfile(request);
    expect(profile.latestObservations).toEqual([]);
    expect(profile.conflicts).toEqual([{ code: 'systolic_bp', observedAt: testTime, observationIds: ['a', 'b', 'unit-conflict'] }]);
    expect(profile.evidence.filter(item => item.ref.startsWith('observation:')).map(item => item.ref)).toEqual(['observation:old']);
    expect(profile.sources[0].observationIds).toHaveLength(4);
  });

  it('uses only the four documented risk codes, respects conflicts and refreshes with the new snapshot', () => {
    const request = testRequest();
    request.facts.observations = [observation('old-risk', 'medium', '2026-09-01T10:00:00+08:00', 'risk_level'),
      observation('current-risk', 'high', testTime, 'risk_level'), observation('ai-risk', 'attention', testTime, 'ai_concern'),
      observation('conflict-a', 'low', testTime, 'diabetes_risk_level'), observation('conflict-b', 'high', testTime, 'diabetes_risk_level')];
    expect(buildPublicHealthHealthProfile(request).knownRiskAssessments.map(item => [item.id, item.value])).toEqual([['current-risk', 'high']]);
    const next = structuredClone(request); next.snapshotAt = '2026-09-30T10:00:00+08:00';
    next.facts.observations.push(observation('new-risk', 'low', next.snapshotAt, 'risk_level'));
    expect(buildPublicHealthHealthProfile(next).knownRiskAssessments.map(item => [item.id, item.value])).toEqual([['new-risk', 'low']]);
    expect(buildPublicHealthHealthProfile(request).knownRiskAssessments[0].value).toBe('high');
  });

  it('keeps absent health data absent and does not expose unknown sex as evidence', () => {
    const request = testRequest(); request.patient.sex = 'unknown'; delete request.facts.historySummary;
    const profile = buildPublicHealthHealthProfile(request);
    expect(profile.conditions).toEqual([]); expect(profile.knownRiskAssessments).toEqual([]);
    expect(profile.evidence.map(item => item.ref)).toEqual(['patient:ageYears']);
    expect(profile.historySummary).toBeUndefined();
  });
});
