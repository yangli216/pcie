import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ history: vi.fn(), reports: vi.fn() }));
vi.mock('@/services/his', () => ({ getHisAdapter: () => ({ fetchOutpatientVisitHistory: mocks.history }) }));
vi.mock('./reportedReportHistory', () => ({ fetchReportedReportHistory: mocks.reports }));
import { loadExternalReportConsistency } from './reportConsistencyHistory';

const a = { id: 'a', reportId: 'a', patientId: 'p1', visitId: 'v1', visitTime: 0,
  reportTime: '2026-09-09', taskId: 'inspectReport', title: '血常规', sourceQuery: '报告名称：血常规\n报告时间：2026-09-09\n项目A：12',
  available: true, labItems: [{ itemName: '项目A', result: '12' }] };
const b = { ...a, id: 'b', reportId: 'b', title: '生化', sourceQuery: '项目B：3' };
const request = { requestId: 'q', taskId: 'inspectReport' as const, reportKindLabel: '检验报告', query: a.sourceQuery,
  patient: { patientId: 'p1', visitId: 'v1' } };
beforeEach(() => {
  mocks.history.mockResolvedValue([{ visitId: 'v1', patientId: 'p1', visitDate: '2026-09-09' }]);
  mocks.reports.mockResolvedValue([a, b]);
});
describe('external report association', () => {
  it('retrieves patient-scoped history and links a unique source report', async () => {
    const result = await loadExternalReportConsistency(request);
    expect(result.reports).toHaveLength(2);
    expect(mocks.history).toHaveBeenCalledWith('p1', expect.objectContaining({ requireDiagnosisAndRecord: false }));
    expect(mocks.reports).toHaveBeenCalledWith('p1', expect.any(Array));
  });
  it('does not load history without a reliable report date', async () => {
    expect((await loadExternalReportConsistency({ ...request, query: '结果无日期' })).unavailableReason).toBeTruthy();
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it('rejects mismatched patient and ambiguous same-title reports', async () => {
    mocks.history.mockResolvedValueOnce([{ visitId: 'v2', patientId: 'p2', visitDate: '2026-09-09' }]);
    expect((await loadExternalReportConsistency(request)).unavailableReason).toContain('身份不匹配');
    mocks.reports.mockResolvedValueOnce([a, { ...a, id: 'repeat', reportId: 'repeat' }]);
    expect((await loadExternalReportConsistency(request)).unavailableReason).toContain('唯一匹配');
  });
  it('does not replace differing external numeric results with HIS values', async () => {
    expect((await loadExternalReportConsistency({ ...request, query: request.query.replace('12', '99（参考范围 1-12）') })).unavailableReason).toBeTruthy();
  });
});
