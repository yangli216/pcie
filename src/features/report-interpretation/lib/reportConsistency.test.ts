import { describe, expect, it } from 'vitest';
import type { ReportHistoryEntry } from '../types';
import { buildReportConsistencyContext, consistencyPrompt, normalizeReportConsistency, reportDay } from './reportConsistency';

const report = (id: string, extra: Partial<ReportHistoryEntry> = {}): ReportHistoryEntry => ({
  id, patientId: 'p1', visitId: id, visitTime: 0, taskId: 'inspectReport', title: id,
  reportId: id, reportTime: '2026-09-09 10:00:00', diagnosisNames: [],
  available: true, isFollowUpSource: false, sourceQuery: id,
  labItems: [{ itemName: '项目', result: '12', unit: 'mmol/L', referenceRange: '1-10' }], ...extra,
});
const first = report('a');
const second = report('b', { taskId: 'checkReport', examFinding: '原始所见', labItems: [] });
const context = buildReportConsistencyContext(first, [first, second], 'p1');
const conflict = { title: '需核查', relationship: '生理关联', explanation: '存在不一致', evidenceIds: ['e1', 'e2'], possibleCauses: ['检测方法差异'], suggestions: ['核对采样时点'] };

describe('same day cross-report consistency', () => {
  it('uses report dates with timezone and rejects missing/invalid dates', () => {
    expect(reportDay('2026-09-08T18:00:00Z')).toBe('2026-09-09');
    expect(reportDay('2026/9/9 01:00:00')).toBe('2026-09-09');
    expect(reportDay('2026-02-30')).toBe('');
    expect(reportDay(undefined)).toBe('');
  });
  it('links across visits and report types, excludes other patients/days, and deduplicates reports', () => {
    const result = buildReportConsistencyContext(first, [first, second,
      report('a-copy', { reportId: 'a' }), report('foreign', { patientId: 'p2' }),
      report('yesterday', { reportTime: '2026-09-08' }), report('undated', { reportTime: undefined }),
    ], 'p1');
    expect(result.reports.map((item) => item.title)).toEqual(['a', 'b']);
    expect(result.evidence).toHaveLength(2);
    expect(result.limitations).not.toHaveLength(0);
    expect(consistencyPrompt(result)).toContain('mmol/L');
    expect(consistencyPrompt(result)).not.toContain('foreign');
  });
  it('keeps normal values as physiological comparison evidence', () => {
    const normal = report('normal', { labItems: [{ itemName: '正常项', result: '5', direction: 'normal' }] });
    expect(buildReportConsistencyContext(first, [first, normal], 'p1').evidence[1]?.name).toBe('正常项');
  });
  it('hydrates evidence from source values, ignoring model-supplied results', () => {
    const result = normalizeReportConsistency({ status: 'checked', conflicts: [{ ...conflict, result: '999', evidence: [] }] }, context);
    expect(result.status).toBe('conflicts');
    expect(result.conflicts[0]?.evidence[0]).toMatchObject({ result: '12', unit: 'mmol/L', reportTitle: 'a' });
  });
  it.each([['e1', 'invented'], ['e1', 'e1'], ['e1']])('rejects invalid or single-report evidence %j', (...evidenceIds) => {
    const result = normalizeReportConsistency({ status: 'checked', conflicts: [{ ...conflict, evidenceIds }] }, context);
    expect(result.status).toBe('not_assessed');
    expect(result.conflicts).toEqual([]);
  });
  it('only explicitly checked empty conflicts may produce no_conflict', () => {
    expect(normalizeReportConsistency({ status: 'checked', conflicts: [] }, context).status).toBe('no_conflict');
    for (const value of [undefined, {}, { conflicts: [] }, { status: 'not_assessed', conflicts: [] }]) {
      expect(normalizeReportConsistency(value, context).status).toBe('not_assessed');
    }
  });
  it('does not claim consistency for insufficient, unknown-patient or oversized evidence', () => {
    for (const input of [
      buildReportConsistencyContext(first, [first], 'p1'),
      buildReportConsistencyContext(first, [first, second], 'p2'),
      buildReportConsistencyContext(first, [first, report('big', { labItems: [{ itemName: '项', result: 'a'.repeat(60001) }] })], 'p1'),
    ]) {
      expect(consistencyPrompt(input)).toBe('');
      expect(normalizeReportConsistency({ status: 'checked', conflicts: [] }, input).status).toBe('not_assessed');
    }
  });
});
