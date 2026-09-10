import { computed, ref, watch, getCurrentScope, onScopeDispose, type Ref } from 'vue';
import { getPatientContextId, getPatientContextVisitId } from '@/utils/patientContext';
import { buildReportConsistencyContext, type ReportConsistencyContext } from '../lib/reportConsistency';
import type { HisOutpatientFollowUpContext, HisVisitRecord } from '@/services/his/types';
import type { AppPatient } from '@/types/appState';
import type { ReportInterpretationWindowPayload } from '@/types/reportInterpretation';
import type { ReportHistoryEntry, ReportHistoryFilter } from '../types';

type ReportWorkspaceView = 'source' | 'interpretation';

interface ReportInterpretationWorkspaceOptions {
  patient: Ref<AppPatient | null>;
  visits: Ref<HisVisitRecord[]>;
  followUpContext: Ref<HisOutpatientFollowUpContext | null>;
  loadHistory: (
    patientId: string,
    visits: HisVisitRecord[],
    followUpContext?: HisOutpatientFollowUpContext | null,
  ) => Promise<ReportHistoryEntry[]>;
  buildInterpretation: (
    report: ReportHistoryEntry,
    patient: AppPatient | null,
    consistencyContext: ReportConsistencyContext,
  ) => Promise<ReportInterpretationWindowPayload>;
}

export function useReportInterpretationWorkspace(options: ReportInterpretationWorkspaceOptions) {
  const reports = ref<ReportHistoryEntry[]>([]);
  const selectedId = ref('');
  const filter = ref<ReportHistoryFilter>('all');
  const loadingHistory = ref(false);
  const historyError = ref('');
  const interpretation = ref<ReportInterpretationWindowPayload | null>(null);
  const interpreting = ref(false);
  const interpretationError = ref('');
  const activeView = ref<ReportWorkspaceView>('source');
  const payloadCache = new Map<string, ReportInterpretationWindowPayload>();
  let requestVersion = 0;
  let historyVersion = 0;
  const patientAnchor = computed(() => JSON.stringify([
    getPatientContextId(options.patient.value), getPatientContextVisitId(options.patient.value),
  ]));
  const consistencyContext = computed(() => selectedReport.value
    ? buildReportConsistencyContext(selectedReport.value, reports.value, getPatientContextId(options.patient.value))
    : undefined);
  function cacheKey(report: ReportHistoryEntry): string {
    return JSON.stringify([patientAnchor.value, report, consistencyContext.value]);
  }

  const filteredReports = computed(() => reports.value.filter((report) => {
    if (filter.value === 'lab') return report.taskId === 'inspectReport';
    if (filter.value === 'exam') return report.taskId === 'checkReport';
    return true;
  }));
  const selectedReport = computed(() => (
    reports.value.find((report) => report.id === selectedId.value) || null
  ));
  const canOpenFollowUp = computed(() => Boolean(
    selectedReport.value?.isFollowUpSource
      && options.followUpContext.value?.followUpEligible,
  ));
  const canInterpret = computed(() => Boolean(
    selectedReport.value?.available && selectedReport.value?.sourceQuery,
  ));

  function selectReport(report: ReportHistoryEntry): void {
    requestVersion += 1;
    selectedId.value = report.id;
    interpretationError.value = '';
    interpretation.value = payloadCache.get(cacheKey(report)) || null;
    interpreting.value = false;
    activeView.value = 'source';
  }

  async function runInterpretation(options_: { force?: boolean } = {}): Promise<void> {
    const report = selectedReport.value;
    if (!report?.available || !report.sourceQuery) {
      interpretationError.value = '报告结果正文暂未加载，请稍后重试。';
      return;
    }

    const cached = payloadCache.get(cacheKey(report));
    if (cached && !options_.force) {
      interpretation.value = cached;
      activeView.value = 'interpretation';
      return;
    }

    const currentVersion = ++requestVersion;
    const anchor = patientAnchor.value;
    const key = cacheKey(report);
    interpretationError.value = '';
    interpreting.value = true;
    activeView.value = 'source';
    try {
      const payload = await options.buildInterpretation(report, options.patient.value, consistencyContext.value!);
      if (currentVersion !== requestVersion || selectedId.value !== report.id
          || anchor !== patientAnchor.value || key !== cacheKey(report)) return;
      payloadCache.set(key, payload);
      interpretation.value = payload;
      activeView.value = 'interpretation';
    } catch (error) {
      if (currentVersion !== requestVersion) return;
      interpretationError.value = error instanceof Error ? error.message : '报告解读失败，请稍后重试。';
    } finally {
      if (currentVersion === requestVersion) {
        interpreting.value = false;
      }
    }
  }

  async function load(): Promise<void> {
    const patientId = getPatientContextId(options.patient.value);
    const version = ++historyVersion;
    const anchor = patientAnchor.value;
    payloadCache.clear();
    reports.value = [];
    selectedId.value = '';
    interpreting.value = false;
    loadingHistory.value = true;
    historyError.value = '';
    interpretation.value = null;
    interpretationError.value = '';
    activeView.value = 'source';
    requestVersion += 1;
    try {
      const loaded = patientId
        ? await options.loadHistory(patientId, options.visits.value, options.followUpContext.value)
        : [];
      if (version !== historyVersion || anchor !== patientAnchor.value) return;
      reports.value = loaded;
      const first = reports.value[0];
      if (first) {
        selectReport(first);
      } else {
        selectedId.value = '';
      }
    } catch (error) {
      if (version !== historyVersion || anchor !== patientAnchor.value) return;
      reports.value = [];
      historyError.value = error instanceof Error ? error.message : '近期报告加载失败。';
    } finally {
      if (version === historyVersion) loadingHistory.value = false;
    }
  }

  function setFilter(nextFilter: ReportHistoryFilter): void {
    filter.value = nextFilter;
    const currentVisible = filteredReports.value.some((item) => item.id === selectedId.value);
    if (!currentVisible && filteredReports.value[0]) {
      void selectReport(filteredReports.value[0]);
    }
  }

  function showSource(): void {
    activeView.value = 'source';
  }

  function showInterpretation(): void {
    if (interpretation.value) {
      activeView.value = 'interpretation';
    }
  }

  const stopEvidenceWatch = watch(() => selectedReport.value ? cacheKey(selectedReport.value) : '', () => {
    requestVersion += 1;
    interpreting.value = false;
    interpretation.value = null;
    activeView.value = 'source';
  }, { flush: 'sync' });
  const stopPatientWatch = watch(patientAnchor, () => {
    requestVersion += 1;
    historyVersion += 1;
    payloadCache.clear();
    reports.value = [];
    selectedId.value = '';
    interpretation.value = null;
    interpreting.value = false;
    activeView.value = 'source';
  }, { flush: 'sync' });
  // 等同一轮 props（患者、就诊列表与回诊上下文）更新完成后再加载，避免用新患者查询旧就诊。
  const stop = watch([patientAnchor, options.visits, options.followUpContext], () => { void load(); }, { flush: 'post' });
  if (getCurrentScope()) onScopeDispose(() => {
    stop();
    stopEvidenceWatch();
    stopPatientWatch();
    requestVersion += 1;
    historyVersion += 1;
    payloadCache.clear();
  });

  return {
    consistencyContext,
    reports,
    filteredReports,
    selectedReport,
    selectedId,
    filter,
    loadingHistory,
    historyError,
    interpretation,
    interpreting,
    interpretationError,
    activeView,
    canOpenFollowUp,
    canInterpret,
    load,
    selectReport,
    runInterpretation,
    setFilter,
    showSource,
    showInterpretation,
  };
}
