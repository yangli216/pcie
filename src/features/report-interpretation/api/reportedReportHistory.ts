import { getHisAdapter } from '@/services/his';
import type {
  HisOutpatientFollowUpContext,
  HisOutpatientFollowUpExam,
  HisOutpatientFollowUpLabItem,
  HisOutpatientFollowUpLabReport,
  HisOutpatientFollowUpReportResults,
  HisVisitRecord,
} from '@/services/his/types';
import type {
  ReportInterpretationAbnormalDirection,
  ReportInterpretationAbnormalItem,
  ReportInterpretationTaskId,
} from '@/types/reportInterpretation';
import type { ReportHistoryEntry } from '../types';
import {
  normalizeHisOutpatientExam,
  normalizeHisReportText,
} from '@/services/his/reportNormalization';

function parseTime(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createEntryId(
  visitId: string,
  taskId: ReportInterpretationTaskId,
  title: string,
  reportTime: string | undefined,
  index: number,
): string {
  return [visitId, taskId, reportTime || 'unknown-time', title, index].join('::');
}

function parseNumericValue(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.trim().match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseReferenceBounds(referenceRange: string | undefined): { low: number | null; high: number | null } {
  const normalized = referenceRange?.trim() || '';
  const interval = normalized.match(/^\s*(-?\d+(?:\.\d+)?)\s*(?:-|~|—|–|至)\s*(-?\d+(?:\.\d+)?)/);
  if (interval) {
    return {
      low: Number(interval[1]),
      high: Number(interval[2]),
    };
  }
  const upper = normalized.match(/^(?:<|<=|≤)\s*(-?\d+(?:\.\d+)?)/);
  if (upper) return { low: null, high: Number(upper[1]) };
  const lower = normalized.match(/^(?:>|>=|≥)\s*(-?\d+(?:\.\d+)?)/);
  if (lower) return { low: Number(lower[1]), high: null };
  return { low: null, high: null };
}

function flagDirection(flag: string | undefined): HisOutpatientFollowUpLabItem['direction'] | null {
  const normalized = flag?.trim().toUpperCase() || '';
  if (!normalized) return null;
  if (/^(H|HH)$/.test(normalized) || /↑|偏高|升高|增高/.test(normalized)) return 'up';
  if (/^(L|LL)$/.test(normalized) || /↓|偏低|降低|减低/.test(normalized)) return 'down';
  if (/阳性|POSITIVE/.test(normalized) || normalized === '+') return 'positive';
  if (/异常|ABNORMAL/.test(normalized) || normalized === 'A') return 'abnormal';
  if (/正常|NORMAL|阴性|NEGATIVE/.test(normalized) || normalized === 'N' || normalized === '0') return 'normal';
  return null;
}

export function resolveLabItemDirection(
  item: HisOutpatientFollowUpLabItem,
): HisOutpatientFollowUpLabItem['direction'] {
  if (item.direction && item.direction !== 'normal') return item.direction;

  const fromFlag = flagDirection(item.abnormalFlag);
  if (fromFlag && fromFlag !== 'normal') return fromFlag;

  const fromResult = flagDirection(item.result);
  if (fromResult && fromResult !== 'normal') return fromResult;

  const result = parseNumericValue(item.result);
  const rangeBounds = parseReferenceBounds(item.referenceRange);
  const low = parseNumericValue(item.referenceLow) ?? rangeBounds.low;
  const high = parseNumericValue(item.referenceHigh) ?? rangeBounds.high;
  if (result !== null && low !== null && result < low) return 'down';
  if (result !== null && high !== null && result > high) return 'up';
  if (item.abnormal === true) return 'abnormal';
  return 'normal';
}

export function buildLabReferenceRange(item: HisOutpatientFollowUpLabItem): string | undefined {
  if (item.referenceRange) return item.referenceRange;
  if (item.referenceLow && item.referenceHigh) return `${item.referenceLow}-${item.referenceHigh}`;
  if (item.referenceLow) return `>=${item.referenceLow}`;
  if (item.referenceHigh) return `<=${item.referenceHigh}`;
  return undefined;
}

export function buildStructuredLabAbnormalItems(
  items: HisOutpatientFollowUpLabItem[] | undefined,
): ReportInterpretationAbnormalItem[] {
  return (items || []).flatMap((item) => {
    const direction = resolveLabItemDirection(item);
    const abnormal = direction !== 'normal' || item.abnormal === true;
    if (!abnormal) return [];
    const directionMap: Record<Exclude<HisOutpatientFollowUpLabItem['direction'], undefined>, ReportInterpretationAbnormalDirection> = {
      normal: 'neutral',
      up: 'up',
      down: 'down',
      positive: 'positive',
      abnormal: 'abnormal',
    };
    const meaning = direction === 'up'
      ? '高于当前报告参考上限，请结合病情与动态变化判断。'
      : direction === 'down'
        ? '低于当前报告参考下限，请结合病情与动态变化判断。'
        : direction === 'positive'
          ? '报告结果为阳性，请结合项目性质与临床表现判断。'
          : '报告标记为异常结果，请结合临床判断。';
    return [{
      name: item.itemName || '未命名项目',
      result: [item.result, item.unit].filter(Boolean).join(' ') || '未提供',
      direction: directionMap[direction || 'abnormal'],
      referenceRange: buildLabReferenceRange(item),
      meaning,
      urgency: 'medium' as const,
    }];
  });
}

export function serializeLabReport(report: HisOutpatientFollowUpLabReport): string {
  const applicationNames = (report.applications || [])
    .map((item) => item.applicationName?.trim() || '')
    .filter(Boolean);
  const lines = [
    `报告名称：${report.reportName || '检验报告'}`,
    report.reportTime ? `报告时间：${report.reportTime}` : '',
    applicationNames.length > 0 ? `本报告单覆盖申请项目：${applicationNames.join('、')}` : '',
    '检验结果：',
    ...(report.items || []).map((item) => {
      const result = [item.result, item.unit].filter(Boolean).join(' ') || '未提供';
      const referenceRange = buildLabReferenceRange(item);
      const direction = resolveLabItemDirection(item);
      const attributes = [
        referenceRange ? `参考范围：${referenceRange}` : '',
        item.abnormalFlag ? `异常标记：${item.abnormalFlag}` : '',
        direction !== 'normal' ? `方向：${direction}` : '',
      ].filter(Boolean);
      return `${item.itemName || '项目'}：${result}${attributes.length ? `（${attributes.join('，')}）` : ''}`;
    }),
  ].filter(Boolean);
  return lines.join('\n');
}

export function serializeExamReport(report: HisOutpatientFollowUpExam): string {
  const normalized = normalizeHisOutpatientExam(report);
  return [
    `报告名称：${normalizeHisReportText(normalized.examName) || '检查报告'}`,
    normalizeHisReportText(normalized.reportTime)
      ? `报告时间：${normalizeHisReportText(normalized.reportTime)}`
      : '',
    normalized.finding ? `检查所见：${normalized.finding}` : '',
    normalized.conclusion ? `检查结论：${normalized.conclusion}` : '',
  ].filter(Boolean).join('\n');
}

function mapReportResults(
  visit: Pick<HisVisitRecord, 'visitId' | 'visitTime' | 'deptName' | 'diagnoses'>,
  results: Pick<HisOutpatientFollowUpReportResults, 'labReports' | 'examReports'>,
  isFollowUpSource: boolean,
): ReportHistoryEntry[] {
  const visitId = visit.visitId || '';
  const diagnoses = visit.diagnoses || [];
  const labEntries = (results.labReports || []).map((report, index) => {
    const title = report.reportName || '检验报告';
    const sourceQuery = serializeLabReport(report);
    return {
      id: createEntryId(visitId, 'inspectReport', title, report.reportTime, index),
      visitId,
      visitTime: visit.visitTime,
      deptName: visit.deptName,
      diagnosisNames: diagnoses,
      taskId: 'inspectReport' as const,
      title,
      reportTime: report.reportTime,
      reportId: report.reportId || report.reportGroupId,
      applicationId: report.applicationId,
      applications: report.applications || [],
      labItems: report.items || [],
      sourceQuery,
      available: Boolean((report.items || []).length && sourceQuery),
      isFollowUpSource,
    };
  });
  const examEntries = (results.examReports || []).map((report, index) => {
    const normalized = normalizeHisOutpatientExam(report);
    const title = normalizeHisReportText(normalized.examName) || '检查报告';
    const sourceQuery = serializeExamReport(normalized);
    return {
      id: createEntryId(visitId, 'checkReport', title, report.reportTime, index),
      visitId,
      visitTime: visit.visitTime,
      deptName: visit.deptName,
      diagnosisNames: diagnoses,
      taskId: 'checkReport' as const,
      title,
      reportTime: normalized.reportTime,
      reportId: normalized.reportId,
      applicationId: normalized.applicationId,
      examFinding: normalized.finding,
      examConclusion: normalized.conclusion,
      reportUrl: normalized.reportUrl,
      sourceQuery,
      available: Boolean((normalized.finding || normalized.conclusion) && sourceQuery),
      isFollowUpSource,
    };
  });
  return [...labEntries, ...examEntries];
}

function buildUnavailableEntries(visit: HisVisitRecord): ReportHistoryEntry[] {
  if (!visit.visitId) return [];
  return (visit.reportedApplications || []).map((application, index) => {
    const taskId = application.type === 'exam' ? 'checkReport' : 'inspectReport';
    return {
      id: createEntryId(visit.visitId!, taskId, application.name, application.requestedAt, index),
      visitId: visit.visitId!,
      visitTime: visit.visitTime,
      deptName: visit.deptName,
      diagnosisNames: visit.diagnoses || [],
      taskId,
      title: application.name,
      reportTime: undefined,
      sourceQuery: '',
      available: false,
      isFollowUpSource: false,
    };
  });
}

function mapFollowUpContext(context: HisOutpatientFollowUpContext): ReportHistoryEntry[] {
  const visitId = context.source?.visitId || 'current-follow-up';
  const visitTime = parseTime(context.source?.visitTime, Date.now());
  const diagnoses = context.currentDiagnosis ? [context.currentDiagnosis] : [];
  return mapReportResults({ visitId, visitTime, diagnoses }, context, true);
}

export async function fetchReportedReportHistory(
  patientId: string,
  visits: HisVisitRecord[],
  followUpContext?: HisOutpatientFollowUpContext | null,
): Promise<ReportHistoryEntry[]> {
  const adapter = getHisAdapter();
  const historicalResults = adapter
    ? await Promise.all(visits.map(async (visit) => {
        if (!visit.visitId) return [];
        try {
          const results = await adapter.fetchOutpatientFollowUpReportResults({
            patientId,
            currentVisitId: visit.visitId,
          });
          const entries = results ? mapReportResults(visit, results, false) : [];
          return entries.length > 0 ? entries : buildUnavailableEntries(visit);
        } catch (error) {
          console.warn('[ReportedReportHistory] Failed to load visit reports', {
            visitId: visit.visitId,
            error,
          });
          return buildUnavailableEntries(visit);
        }
      }))
    : visits.map(buildUnavailableEntries);

  const entries = [
    ...(followUpContext?.followUpEligible ? mapFollowUpContext(followUpContext) : []),
    ...historicalResults.flat(),
  ];
  return Array.from(new Map(entries.map((entry) => [entry.id, { ...entry, patientId }])).values())
    .sort((left, right) => (
      parseTime(right.reportTime, right.visitTime) - parseTime(left.reportTime, left.visitTime)
    ));
}
