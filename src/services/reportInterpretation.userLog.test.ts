import type { AppPatient } from '@/types/appState';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReportConsistencyContext } from '@features/report-interpretation/lib/reportConsistency';
import type { ReportHistoryEntry } from '@features/report-interpretation/types';
import type { ConsultationUserLogSnapshot } from './consultationUserLog';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  buildSnapshot: vi.fn(),
  buildSelection: vi.fn(),
  submit: vi.fn(async () => undefined),
}));

vi.mock('./llm', () => ({ chat: mocks.chat }));
vi.mock('./consultationUserLog', () => ({
  buildReportInterpretationUserLogSnapshot: mocks.buildSnapshot,
  buildConsultationSelectionSnapshot: mocks.buildSelection,
  submitConsultationUserLog: mocks.submit,
}));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

describe('report interpretation user log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    });
    mocks.chat.mockResolvedValue(JSON.stringify({
      summary: '白细胞升高。',
      conclusion: '考虑感染相关改变。',
      keyPoints: [],
      sections: [],
      recommendations: ['结合症状复诊'],
      cautions: [],
      followUpAssessment: {
        actionability: 'needs_treatment',
        summary: '考虑感染相关改变，需要抗感染治疗。',
        problems: [{ title: '白细胞升高', evidence: '12.0×10^9/L', urgency: 'medium' }],
        medicationIntents: [{ indication: '感染治疗', preferredGenericNames: ['阿莫西林'], aliases: ['阿莫西林片'], route: '口服' }],
      },
    }));
    const snapshot: ConsultationUserLogSnapshot = {
      chiefComplaint: '',
      historyOfPresentIllness: '',
      pastMedicalHistory: '',
      personalHistory: '',
      familyHistory: '',
      physicalExam: '',
      precautions: '',
      diagnoses: [],
      medicines: [],
      examinations: [],
      labTests: [],
      procedures: [],
    };
    mocks.buildSnapshot.mockReturnValue(snapshot);
    mocks.buildSelection.mockReturnValue({});
  });

  it('submits a completed report interpretation log after payload generation', async () => {
    const { buildReportInterpretationPayload } = await import('./reportInterpretation');
    const payload = await buildReportInterpretationPayload({
      requestId: 'report-request-1',
      taskId: 'inspectReport',
      reportKindLabel: '检验报告',
      query: '白细胞 12.0×10^9/L ↑',
      patient: { patientId: 'patient-1', visitId: 'visit-1', patientName: '测试患者' },
    });

    expect(mocks.buildSnapshot).toHaveBeenCalledTimes(1);
    expect(payload.followUpAssessment).toMatchObject({
      actionability: 'needs_treatment',
      medicationIntents: [{ preferredGenericNames: ['阿莫西林'] }],
    });
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      consultationId: 'visit-1',
      consultationType: 'report_interpretation',
      firstSnapshot: expect.any(Object),
      finalSnapshot: expect.any(Object),
      changeSummary: expect.objectContaining({ totalChanges: 0 }),
    }));
  });

  it('does not promote negated normal imaging findings into abnormal items', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('offline'));
    const { buildReportInterpretationPayload } = await import('./reportInterpretation');

    const payload = await buildReportInterpretationPayload({
      requestId: 'report-request-normal-xray',
      taskId: 'checkReport',
      reportKindLabel: '检查报告',
      query: [
        '检查项目：胸椎侧位X线平片',
        '检查所见：胸椎生理曲度存在，序列线连续；各椎体骨质结构完整，未见明显骨折及骨质破坏，周围软组织未见异常。',
        '检查结论：胸椎侧位X线检查未发现结构性异常。可排除急性骨折、骨质破坏及退行性椎间隙改变。',
      ].join('\n'),
      patient: { patientId: 'patient-1', visitId: 'visit-1', patientName: '测试患者' },
    });

    expect(payload.abnormalItems).toEqual([]);
    expect(payload.keyPoints.some((item) => item.urgency === 'high')).toBe(false);
    expect(payload.recommendations.join('；')).not.toContain('转急诊');
  });
});


describe('report consistency integration', () => {
  const a: ReportHistoryEntry = { id: 'a', patientId: 'p1', visitId: 'v1', visitTime: 0, taskId: 'inspectReport',
    title: '血检', reportTime: '2026-09-09', diagnosisNames: [], available: true, isFollowUpSource: false,
    sourceQuery: '指标A 12', labItems: [{ itemName: '指标A', result: '12', unit: 'U' }] };
  const b: ReportHistoryEntry = { ...a, id: 'b', title: '检查', taskId: 'checkReport', sourceQuery: '检查所见', examFinding: '原始所见' };
  const request = { requestId: 'r1', taskId: 'inspectReport' as const, reportKindLabel: '检验报告',
    query: a.sourceQuery, patient: { patientId: 'p1' }, consistencyContext: buildReportConsistencyContext(a, [a, b], 'p1') };
  it('uses one model call and separates real cross-report evidence from current abnormalities', async () => {
    vi.clearAllMocks();
    mocks.chat.mockResolvedValueOnce(JSON.stringify({ crossReportConsistency: { status: 'checked', conflicts: [{
      title: '需核查', relationship: '关联', explanation: '冲突', evidenceIds: ['e1', 'e2'], possibleCauses: ['原因待核查'], suggestions: ['复核'],
    }] } }));
    const { buildReportInterpretationPayload } = await import('./reportInterpretation');
    const result = await buildReportInterpretationPayload(request);
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    const messages = mocks.chat.mock.calls[0]![0];
    expect(messages[1].content).toContain('原始所见');
    expect(result.sourceQuery).toBe(a.sourceQuery);
    expect(result.crossReportConsistency?.status).toBe('conflicts');
    expect(result.crossReportConsistency?.conflicts[0]?.evidence[0]?.result).toBe('12');
  });
  it('marks model failure as not assessed rather than no conflicts', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('offline'));
    const { buildReportInterpretationPayload } = await import('./reportInterpretation');
    expect((await buildReportInterpretationPayload(request)).crossReportConsistency?.status).toBe('not_assessed');
  });
  it('does not merge a different current patient into an explicit external patient', async () => {
    const { resolveReportInterpretationRequest } = await import('./reportInterpretation');
    const result = resolveReportInterpretationRequest({ taskId: 'inspectReport', query: '报告', patient: { patientId: 'p2' } },
      { patientId: 'p1', visitId: 'v1', name: '旧患者', pastMedicalHistory: '旧病史' } as AppPatient);
    expect(result.patient?.visitId).toBeUndefined();
    expect(result.patient?.pastMedicalHistory).toBeUndefined();
  });
});
