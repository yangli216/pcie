import type {
  ReportInterpretationKeyPoint,
  ReportInterpretationPatientProfile,
  ReportInterpretationSection,
  ReportInterpretationWindowPayload,
} from '@/types/reportInterpretation';

function normalizeNarrative(value: string | undefined): string {
  return (value || '').replace(/[\s，,。；;：:（）()、"“”'‘’]/g, '').toLowerCase();
}

function isDuplicateNarrative(candidate: string, references: string[]): boolean {
  const normalized = normalizeNarrative(candidate);
  if (!normalized) return true;
  return references.some((reference) => {
    const compared = normalizeNarrative(reference);
    if (!compared) return false;
    if (normalized === compared) return true;
    return Math.min(normalized.length, compared.length) >= 18
      && (normalized.includes(compared) || compared.includes(normalized));
  });
}

export function dedupeNarratives(items: string[] | undefined): string[] {
  const result: string[] = [];
  for (const item of items || []) {
    if (!item?.trim() || isDuplicateNarrative(item, result)) continue;
    result.push(item.trim());
  }
  return result;
}

export function selectKeyPoints(items: ReportInterpretationKeyPoint[] | undefined): ReportInterpretationKeyPoint[] {
  const result: ReportInterpretationKeyPoint[] = [];
  for (const item of items || []) {
    if (!item?.detail?.trim()) continue;
    if (isDuplicateNarrative(item.detail, result.map((current) => current.detail))) continue;
    result.push(item);
    if (result.length >= 3) break;
  }
  return result;
}

export function selectSupplementalSections(
  payload: Pick<ReportInterpretationWindowPayload, 'summary' | 'conclusion' | 'keyPoints' | 'sections' | 'recommendations' | 'cautions'>,
): ReportInterpretationSection[] {
  const keyPoints = selectKeyPoints(payload.keyPoints);
  const represented = [
    payload.summary,
    payload.conclusion,
    ...keyPoints.map((item) => item.detail),
    ...dedupeNarratives(payload.recommendations),
    ...dedupeNarratives(payload.cautions),
  ];
  const result: ReportInterpretationSection[] = [];
  for (const section of payload.sections || []) {
    const title = section?.title?.trim();
    const content = section?.content?.trim();
    if (!title || !content) continue;
    if (/报告核心发现|核心发现|建议下一步|下一步建议|行动建议|处置建议|注意事项/u.test(title)) continue;
    if (isDuplicateNarrative(content, [...represented, ...result.map((item) => item.content)])) continue;
    result.push({ title, content });
    if (result.length >= 2) break;
  }
  return result;
}

export function selectHistoryText(
  historyText: string | undefined,
  patient: ReportInterpretationPatientProfile | null | undefined,
): string {
  const history = historyText?.trim() || '';
  if (!history) return '';
  const demographicParts = [patient?.patientName, patient?.genderText, patient?.ageText]
    .map((item) => normalizeNarrative(item))
    .filter(Boolean);
  let remainder = normalizeNarrative(history).replace(/^(病历|患者)/u, '');
  for (const part of demographicParts) {
    remainder = remainder.replace(part, '');
  }
  return demographicParts.length > 0 && !remainder ? '' : history;
}

export type ReportOverallStatusLevel = 'unknown' | 'normal' | 'attention' | 'high';

export interface ReportOverallStatus {
  level: ReportOverallStatusLevel;
  label: string;
  title: string;
  description: string;
  icon: string;
}

export function resolveReportOverallStatus(
  payload: Pick<ReportInterpretationWindowPayload, 'abnormalItems' | 'abnormalAssessmentComplete' | 'keyPoints' | 'crossReportConsistency'>,
): ReportOverallStatus {
  const abnormalItems = payload.abnormalItems || [];
  const hasHighRisk = abnormalItems.some((item) => item.urgency === 'high');
  if (hasHighRisk) {
    return {
      level: 'high',
      label: '重点异常',
      title: '存在重点异常，建议优先评估',
      description: `报告识别到 ${abnormalItems.length} 项异常或阳性结果，并包含高风险提示。`,
      icon: 'lucide:triangle-alert',
    };
  }
  if (payload.crossReportConsistency?.status === 'conflicts') {
    return { level: 'attention', label: '跨报告待核查', title: '同日报告存在需核查的矛盾',
      description: '请核查关联报告原始结果、可能原因和建议。', icon: 'lucide:files' };
  }
  if (abnormalItems.length > 0) {
    return {
      level: 'attention',
      label: '需要关注',
      title: `发现 ${abnormalItems.length} 项异常或阳性结果`,
      description: '建议结合症状、既往结果和动态变化进一步判断。',
      icon: 'lucide:circle-alert',
    };
  }
  if (payload.crossReportConsistency?.status === 'not_assessed' && payload.crossReportConsistency.reports.length >= 2) {
    return { level: 'unknown', label: '跨报告校验未完成', title: '请继续核查同日原始报告',
      description: '单报告未识别到异常不代表跨报告一致性已验证。', icon: 'lucide:circle-help' };
  }
  if (!payload.abnormalAssessmentComplete) {
    return {
      level: 'unknown',
      label: '结果待确认',
      title: '未识别到明确异常',
      description: '当前为文本解析结果，请结合原始报告确认完整项目与参考范围。',
      icon: 'lucide:circle-help',
    };
  }
  return {
    level: 'normal',
    label: '总体正常',
    title: '未发现明确异常',
    description: '本次报告结构化结果未发现异常或阳性项目。',
    icon: 'lucide:circle-check',
  };
}

export function stripPatientBasics(
  text: string | undefined,
  patient: ReportInterpretationPatientProfile | null | undefined,
): string {
  const original = text?.trim() || '';
  if (!original) return '';
  let result = original;
  let removedPatientPrefix = false;
  if (/^患者\s*/u.test(result)) {
    result = result.replace(/^患者\s*/u, '');
    removedPatientPrefix = true;
  }
  const patientName = patient?.patientName?.trim();
  if (patientName && result.startsWith(patientName)) {
    result = result.slice(patientName.length).trim();
    removedPatientPrefix = true;
  }
  if (!removedPatientPrefix) return original;

  result = result.replace(/^[（(][^）)]{0,24}[）)]\s*/u, '');
  const demographicTokens = [patient?.genderText, patient?.ageText]
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
  for (let index = 0; index < 3; index += 1) {
    result = result.replace(/^[，,：:；;\s]+/u, '');
    const token = demographicTokens.find((item) => result.startsWith(item));
    if (!token) break;
    result = result.slice(token.length).trim();
  }
  result = result.replace(/^[，,：:；;\s]+/u, '');
  return result || original;
}
