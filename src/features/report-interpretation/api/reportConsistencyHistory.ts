import { getHisAdapter } from '@/services/his';
import type { ReportInterpretationResolvedRequest } from '@/types/reportInterpretation';
import { fetchReportedReportHistory } from './reportedReportHistory';
import { buildReportConsistencyContext, reportDay, type ReportConsistencyContext } from '../lib/reportConsistency';

/** 外部纯文本入口没有报告列表，按患者锚点补取 HIS 报告；不凭就诊日猜测报告日期。 */
export async function loadExternalReportConsistency(
  request: ReportInterpretationResolvedRequest,
): Promise<ReportConsistencyContext> {
  const patientId = request.patient?.patientId || '';
  const dateText = request.query.match(/(?:报告时间|报告日期|检验时间|检查时间|检验日期|检查日期)\s*[:：]\s*([^\n]+)/u)?.[1];
  const date = reportDay(dateText);
  const empty: ReportConsistencyContext = { patientId, date, reports: [], evidence: [], limitations: [] };
  if (!patientId || !date) return { ...empty, unavailableReason: '患者 ID 或报告日期缺失，无法自动关联同日报告。' };
  const adapter = getHisAdapter();
  if (!adapter) return { ...empty, unavailableReason: 'HIS 暂不可用，无法获取同日报告。' };
  const begin = new Date(`${date}T00:00:00+08:00`);
  begin.setUTCDate(begin.getUTCDate() - 90);
  const startDay = new Date(begin.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const deadline = Date.now() + 10_000;
  const history = await adapter.fetchOutpatientVisitHistory(patientId, {
    requireDiagnosisAndRecord: false, limit: 200, dateRange: [`${startDay} 00:00:00`, `${date} 23:59:59`],
  });
  if (history.some((visit) => visit.patientId && visit.patientId !== patientId)) {
    return { ...empty, unavailableReason: 'HIS 返回的患者身份不匹配，未执行跨报告校验。' };
  }
  const visits = history.map((visit) => ({
    visitId: visit.visitId, visitTime: Date.parse(visit.visitDate), deptName: visit.deptName, diagnoses: visit.diagnoses,
  }));
  const currentVisitId = request.patient?.visitId;
  if (currentVisitId && !visits.some((visit) => visit.visitId === currentVisitId)) {
    visits.unshift({ visitId: currentVisitId, visitTime: Date.parse(`${date}T00:00:00+08:00`), deptName: undefined, diagnoses: undefined });
  }
  const reports = [] as Awaited<ReturnType<typeof fetchReportedReportHistory>>;
  let incomplete = false;
  for (let offset = 0; offset < visits.length; offset += 4) {
    if (Date.now() >= deadline) { incomplete = true; break; }
    reports.push(...await fetchReportedReportHistory(patientId, visits.slice(offset, offset + 4)));
  }
  const compact = (value: string) => value.replace(/[\s:：]/g, '');
  const compactQuery = compact(request.query);
  const matching = reports.filter((report) => {
    if (reportDay(report.reportTime) !== date || report.taskId !== request.taskId || !report.available) return false;
    if (report.sourceQuery.trim() === request.query.trim()) return true;
    if (['检验报告', '检查报告'].includes(report.title) || !request.query.includes(report.title)) return false;
    const contains = (value: string | undefined) => Boolean(value && compactQuery.includes(compact(value)));
    return report.taskId === 'inspectReport'
      ? Boolean(report.labItems?.length) && report.labItems!.every((item) => item.itemName && item.result
        && contains(`${item.itemName}${item.result}${item.unit || ''}`))
      : [report.examFinding, report.examConclusion].filter(Boolean).every((value) => contains(value));
  });
  // 同一标题可能有复查/多个标本，只有唯一 HIS 报告能作为当前原文的锚点。
  const distinct = [...new Map(matching.map((report) => [report.reportId || report.id, report])).values()];
  if (distinct.length !== 1) return { ...empty, unavailableReason: '无法唯一匹配当前报告，请从报告助手选择原报告后校验。' };
  const context = buildReportConsistencyContext(distinct[0]!, reports, patientId);
  context.limitations.push('关联范围为 HIS 可获取的近 90 天就诊所含同日报告；报告时间不代表采样时间。');
  if (incomplete || !history.length || visits.length >= 200) context.limitations.push('历史检索可能不完整，请结合原始报告核查。');
  return context;
}
