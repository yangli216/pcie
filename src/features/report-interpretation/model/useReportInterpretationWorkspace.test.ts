import { ref, effectScope } from 'vue';
import type { AppPatient } from '@/types/appState';
import { describe, expect, it, vi } from 'vitest';
import type { ReportInterpretationWindowPayload } from '@/types/reportInterpretation';
import type { ReportHistoryEntry } from '../types';
import { useReportInterpretationWorkspace } from './useReportInterpretationWorkspace';

const report: ReportHistoryEntry = {
  id: 'report-1',
  visitId: 'visit-1',
  visitTime: Date.parse('2026-07-02 09:43:33'),
  diagnosisNames: [],
  taskId: 'inspectReport',
  title: '尿常规',
  reportTime: '2026-07-02 09:43:33',
  sourceQuery: '尿糖：阳性（参考范围：阴性）',
  available: true,
  isFollowUpSource: false,
};

const payload: ReportInterpretationWindowPayload = {
  requestId: 'report-1',
  taskId: 'inspectReport',
  reportKindLabel: '检验报告',
  patientSummary: '测试患者',
  reportMeta: { reportTitle: '尿常规' },
  abnormalItems: [],
  sourceQuery: report.sourceQuery,
  summary: '存在阳性结果。',
  conclusion: '请结合临床判断。',
  keyPoints: [],
  sections: [],
  recommendations: [],
  cautions: [],
  followUpAssessment: {
    actionability: 'observe',
    summary: '建议结合临床观察随访。',
    problems: [],
    medicationIntents: [],
  },
  generatedAt: '2026-07-02 10:00:00',
};

describe('useReportInterpretationWorkspace', () => {
  it('selects the latest report without automatically starting AI interpretation', async () => {
    const buildInterpretation = vi.fn(async () => payload);
    const controller = useReportInterpretationWorkspace({
      patient: ref(null),
      visits: ref([]),
      followUpContext: ref(null),
      loadHistory: vi.fn(async () => [report]),
      buildInterpretation,
    });

    controller.reports.value = [report];
    controller.selectReport(report);

    expect(controller.selectedId.value).toBe(report.id);
    expect(controller.activeView.value).toBe('source');
    expect(controller.interpreting.value).toBe(false);
    expect(buildInterpretation).not.toHaveBeenCalled();
  });

  it('runs AI only after an explicit action and then allows returning to source', async () => {
    const buildInterpretation = vi.fn(async () => payload);
    const controller = useReportInterpretationWorkspace({
      patient: ref(null),
      visits: ref([]),
      followUpContext: ref(null),
      loadHistory: vi.fn(async () => [report]),
      buildInterpretation,
    });

    controller.reports.value = [report];
    controller.selectReport(report);
    await controller.runInterpretation();

    expect(buildInterpretation).toHaveBeenCalledOnce();
    expect(controller.interpretation.value).toEqual(payload);
    expect(controller.activeView.value).toBe('interpretation');

    controller.showSource();
    expect(controller.activeView.value).toBe('source');
    controller.showInterpretation();
    expect(controller.activeView.value).toBe('interpretation');
  });
});


describe('report consistency lifecycle', () => {
  const a = { ...report, patientId: 'p1', labItems: [{ itemName: '项目A', result: '1' }] };
  const b = { ...a, id: 'report-2', visitId: 'visit-2', taskId: 'checkReport' as const, title: '影像', examFinding: '所见', labItems: [] };
  function setup(buildInterpretation = vi.fn(async () => payload), loadHistory = vi.fn(async () => [a, b])) {
    const scope = effectScope();
    const patient = ref({ patientId: 'p1', visitId: 'v1' } as AppPatient);
    const controller = scope.run(() => useReportInterpretationWorkspace({
      patient, visits: ref([]), followUpContext: ref(null), loadHistory, buildInterpretation,
    }))!;
    return { scope, patient, controller, buildInterpretation };
  }
  it('includes hidden exam reports when the lab filter is selected and reuses unchanged cache', async () => {
    const { controller, buildInterpretation, scope } = setup();
    await controller.load();
    controller.setFilter('lab');
    await controller.runInterpretation();
    expect(buildInterpretation).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ reports: expect.any(Array) }));
    expect(controller.consistencyContext.value?.reports).toHaveLength(2);
    await controller.runInterpretation();
    expect(buildInterpretation).toHaveBeenCalledTimes(1);
    controller.reports.value[1]!.examFinding = '报告已修订';
    expect(controller.interpretation.value).toBeNull();
    await controller.runInterpretation();
    expect(buildInterpretation).toHaveBeenCalledTimes(2);
    scope.stop();
  });
  it('discards late interpretation after a patient switch', async () => {
    let resolve!: (value: ReportInterpretationWindowPayload) => void;
    const build = vi.fn(() => new Promise<ReportInterpretationWindowPayload>((done) => { resolve = done; }));
    const { controller, patient, scope } = setup(build);
    await controller.load();
    const running = controller.runInterpretation();
    patient.value = { patientId: 'p2', visitId: 'v2' } as AppPatient;
    resolve(payload);
    await running;
    expect(controller.interpretation.value).toBeNull();
    expect(controller.activeView.value).toBe('source');
    scope.stop();
  });
  it('discards an older history response arriving after a newer load', async () => {
    let resolve!: (value: typeof a[]) => void;
    const history = vi.fn().mockImplementationOnce(() => new Promise<typeof a[]>((done) => { resolve = done; }))
      .mockResolvedValueOnce([b]);
    const { controller, scope } = setup(undefined, history);
    const old = controller.load();
    await controller.load();
    resolve([a]);
    await old;
    expect(controller.reports.value.map((item) => item.id)).toEqual([b.id]);
    expect(controller.loadingHistory.value).toBe(false);
    scope.stop();
  });
});
