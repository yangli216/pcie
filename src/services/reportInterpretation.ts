import { consistencyPrompt, normalizeReportConsistency, REPORT_CONSISTENCY_INSTRUCTION } from '@features/report-interpretation/lib/reportConsistency';
import { loadExternalReportConsistency } from '@features/report-interpretation/api/reportConsistencyHistory';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { PROMPTS } from '../prompts';
import { chat, type ChatMessage } from './llm';
import type { AppPatient } from '../types/appState';
import type {
  ReportInterpretationAbnormalDirection,
  ReportInterpretationAbnormalItem,
  ReportInterpretationKeyPoint,
  ReportInterpretationUrgency,
  ReportFollowUpActionability,
  ReportFollowUpAssessment,
  ReportFollowUpMedicationIntent,
  ReportFollowUpProblem,
  ReportInterpretationPatientInput,
  ReportInterpretationPatientProfile,
  ReportInterpretationReportMeta,
  ReportInterpretationRequestPayload,
  ReportInterpretationResolvedRequest,
  ReportInterpretationTaskId,
  ReportInterpretationWindowPayload,
  ReportInterpretationWindowStateEvent,
} from '../types/reportInterpretation';
import {
  getPatientContextAgeText,
  getPatientContextAllergyHistory,
  getPatientContextId,
  getPatientContextName,
  getPatientContextVisitId,
  getPatientContextGenderText,
  getPatientContextPastMedicalHistory,
} from '../utils/patientContext';
import { formatUserFacingError } from '@shared/lib/errorMessages';
import {
  buildConsultationSelectionSnapshot,
  buildReportInterpretationUserLogSnapshot,
  submitConsultationUserLog,
} from './consultationUserLog';

const REPORT_INTERPRETATION_WINDOW_LABEL = 'report-interpretation-window';
const REPORT_INTERPRETATION_WINDOW_URL = 'index.html?window=report-interpretation';
const UPDATE_EVENT = 'report-interpretation:update';
const STATUS_EVENT = 'report-interpretation:status';
const READY_EVENT = 'report-interpretation:ready';
const WINDOW_EVENT_RETRY_DELAYS = [0, 120, 320] as const;
const REPORT_INTERPRETATION_LLM_TIMEOUT_MS = 45_000;
const REPORT_INTERPRETATION_WINDOW_READY_TIMEOUT_MS = 8_000;

interface ReportInterpretationWindowReadyEvent {
  label?: string;
}

interface ReportInterpretationWindowReadyWaiter {
  wait: () => Promise<void>;
  cancel: () => void;
}

interface ReportInterpretationLLMResponse {
  crossReportConsistency?: unknown;
  summary?: string;
  conclusion?: string;
  keyPoints?: Array<{
    title?: string;
    detail?: string;
    urgency?: 'low' | 'medium' | 'high' | string;
  }>;
  sections?: Array<{
    title?: string;
    content?: string;
  }>;
  recommendations?: string[] | string;
  cautions?: string[] | string;
  followUpAssessment?: {
    actionability?: string;
    summary?: string;
    problems?: Array<{
      title?: string;
      evidence?: string;
      urgency?: string;
    }>;
    medicationIntents?: Array<{
      indication?: string;
      preferredGenericNames?: string[] | string;
      aliases?: string[] | string;
      route?: string;
    }>;
  };
}

interface ReportInterpretationFindingRule {
  pattern: RegExp;
  meaning: string;
  action: string;
  urgency: 'low' | 'medium' | 'high';
}

interface ReportInterpretationQueryInsight {
  reportDate?: string;
  reportItem?: string;
  reportMeta: ReportInterpretationReportMeta;
  abnormalItems: ReportInterpretationAbnormalItem[];
  resultLines: string[];
  conclusionLines: string[];
  reportHighlights: string[];
  redFlagLines: string[];
  recommendedActions: string[];
}

const REPORT_DATE_LABELS = ['报告日期', '检查日期', '检验日期'];
const REPORT_ITEM_LABELS = ['检查项目', '检验项目', '项目'];
const OUTPATIENT_NO_LABELS = ['门诊编号', '门诊号', '就诊号', '就诊编号'];
const SAMPLE_NO_LABELS = ['样本编号', '样本号', '标本编号', '标本号'];
const SUBMIT_DOCTOR_LABELS = ['送检医生', '申请医生', '开单医生', '送检医师', '申请医师'];
const REQUEST_TIME_LABELS = ['申请时间', '送检时间', '采样时间', '采集时间'];
const RESULT_TIME_LABELS = ['检验时间', '检查时间', '报告时间', '审核时间'];
const HISTORY_LABELS = ['病历', '病史', '临床诊断', '临床信息', '简要病史'];
const REPORT_RESULT_LABELS = ['检查结果', '检验结果', '检查所见', '影像表现', '结果'];
const REPORT_CONCLUSION_LABELS = ['影像诊断', '检查结论', '检验结论', '诊断意见', '提示'];
const KNOWN_REPORT_LABELS = [
  ...REPORT_DATE_LABELS,
  ...REPORT_ITEM_LABELS,
  ...OUTPATIENT_NO_LABELS,
  ...SAMPLE_NO_LABELS,
  ...SUBMIT_DOCTOR_LABELS,
  ...REQUEST_TIME_LABELS,
  ...RESULT_TIME_LABELS,
  ...HISTORY_LABELS,
  ...REPORT_RESULT_LABELS,
  ...REPORT_CONCLUSION_LABELS,
];
const REPORT_BLOCK_STOP_LABELS = [
  ...REPORT_DATE_LABELS,
  ...REPORT_ITEM_LABELS,
  ...OUTPATIENT_NO_LABELS,
  ...SAMPLE_NO_LABELS,
  ...SUBMIT_DOCTOR_LABELS,
  ...REQUEST_TIME_LABELS,
  ...RESULT_TIME_LABELS,
  ...HISTORY_LABELS,
  ...REPORT_CONCLUSION_LABELS,
  '建议',
  '备注',
];
const GENERIC_INTERPRETATION_PHRASES = [
  '需结合临床表现综合判断',
  '不足以单独下结论',
  '仅供医生快速判读',
  '不应脱离症状',
  '建议结合临床',
  '请结合临床',
  '优先安排复查或进一步检查',
];
const HIGH_RISK_FINDING_PATTERN = /出血|梗死|梗阻|栓塞|夹层|气胸|穿孔|恶性|占位|肿块|骨折|脱位|大面积|重度|急性|坏死/i;
const ABNORMAL_MARK_PATTERN = /↑|↓|阳性|异常|升高|降低|增高|减少|偏高|偏低|高于|低于|\(\+\)|（\+）|\+{1,3}/i;
const LAB_ABNORMAL_PATTERN = /↑|↓|阳性|异常|升高|降低|增高|减少|偏高|偏低|高于|低于|[A-Za-z]{2,}[A-Za-z0-9%/.-]*\s*[:：]?\s*\d/i;
const CHECK_FINDING_PATTERN = /阳性|高密度影|低密度影|斑片|结节|实变|磨玻璃|积液|增粗|阴影|占位|肿块|狭窄|扩张|骨折|脱位|出血|梗死|梗阻|钙化/i;
const NEGATED_FINDING_PREFIX_PATTERN = /(?:未见|未发现|未提示|未显示|未检出|无|否认|排除|可排除)/i;
const NORMAL_FINDING_TEXT_PATTERN = /(?:未见明显异常|未见异常|未发现异常|未发现结构性异常|无明显异常|阴性|正常|结构完整|骨质结构完整|序列线连续|生理曲度正常)/i;
const CHECK_FINDING_CLAUSE_SPLIT_PATTERN = /[，,；;。.!！?？\n]+/;
const REFERENCE_RANGE_PATTERN = /(?:参考范围|参考值|正常范围|正常值)\s*[:：]?\s*([^）)\n，,；;]+)/i;
const DATE_TIME_VALUE_PATTERN = /\d{4}[-/年]\d{1,2}(?:[-/月]\d{1,2}日?)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/;

const LAB_FINDING_RULES: ReportInterpretationFindingRule[] = [
  {
    pattern: /WBC|白细胞|NEUT|中性粒|CRP|C反应蛋白|PCT|降钙素原/i,
    meaning: '提示炎症或感染活动可能增强，需结合发热、局部感染灶和抗感染治疗反应判断。',
    action: '结合症状和查体评估感染灶；必要时复查炎症指标动态变化。',
    urgency: 'medium',
  },
  {
    pattern: /HGB|Hb|血红蛋白|RBC|红细胞/i,
    meaning: '提示可能存在贫血或血液浓缩，建议结合出血史、营养状态和红细胞参数综合判断。',
    action: '若伴乏力、头晕或慢性失血线索，建议完善贫血病因评估。',
    urgency: 'medium',
  },
  {
    pattern: /PLT|血小板/i,
    meaning: '血小板异常需分别关注出血风险或血栓风险，并结合病因进一步判断。',
    action: '结合出血点、凝血功能和基础疾病判断是否需要进一步复查。',
    urgency: 'medium',
  },
  {
    pattern: /ALT|AST|转氨酶|胆红素|ALP|GGT/i,
    meaning: '提示肝细胞损伤或胆汁淤积可能，需结合药物史、饮酒史和基础肝病。',
    action: '复核肝功能相关指标，并结合用药和既往肝病史评估。',
    urgency: 'medium',
  },
  {
    pattern: /Cr|CREA|肌酐|尿素氮|eGFR/i,
    meaning: '提示肾功能变化，需结合基础肾病、尿量和近期用药判断。',
    action: '必要时复查肾功能并评估是否存在脱水、感染或药物相关影响。',
    urgency: 'medium',
  },
  {
    pattern: /D-二聚体|D二聚体|FDP|肌钙蛋白|TnI|TnT/i,
    meaning: '属于需要结合临床高危线索优先判断的指标异常，单份结果不足以定性，但不能忽视。',
    action: '结合胸痛、呼吸困难、下肢肿痛等高危表现，必要时尽快进一步排查。',
    urgency: 'high',
  },
];

const CHECK_FINDING_RULES: ReportInterpretationFindingRule[] = [
  {
    pattern: /感染|炎|斑片状|实变|磨玻璃|高密度影/i,
    meaning: '更偏向炎症或感染性改变，需结合体温、痰色、血氧和炎症指标判断严重程度。',
    action: '结合呼吸道症状和炎症指标评估是否需要复查影像或调整治疗。',
    urgency: 'medium',
  },
  {
    pattern: /积液/i,
    meaning: '提示局部渗出或液体潴留，需结合炎症、心肾功能及病程综合判断。',
    action: '结合症状和病程判断是否需要进一步明确积液性质或复查。',
    urgency: 'medium',
  },
  {
    pattern: /结节|占位|肿块|恶性/i,
    meaning: '提示存在占位性病变或随访重点，需要结合既往片和高危因素评估性质。',
    action: '建议对照既往检查，并按专科路径决定是否进一步增强检查或随访。',
    urgency: 'high',
  },
  {
    pattern: /骨折|脱位/i,
    meaning: '提示明确器质性损伤，应尽快结合体征和专科处理方案评估稳定性。',
    action: '结合疼痛、活动受限和局部查体决定固定、复位或转诊。',
    urgency: 'high',
  },
  {
    pattern: /出血|梗死|梗阻|栓塞|夹层|气胸|穿孔/i,
    meaning: '属于高危影像信号，需优先判断是否存在急诊处理指征。',
    action: '结合生命体征和急性症状，必要时立即转入急诊或专科评估。',
    urgency: 'high',
  },
];

function normalizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function normalizeReportQuery(value: unknown): string {
  if (typeof value !== 'string') {
    return normalizeText(value);
  }

  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function readIncomingPatientText(
  patient: ReportInterpretationPatientInput | null | undefined,
  keys: string[],
): string {
  if (!patient) {
    return '';
  }

  for (const key of keys) {
    const value = normalizeText((patient as Record<string, unknown>)[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function generateRequestId(): string {
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskLabel(taskId: ReportInterpretationTaskId): string {
  return taskId === 'inspectReport' ? '检验报告' : '检查报告';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => normalizeText(item)).filter(Boolean)));
}

function normalizeUrgency(value: unknown): ReportInterpretationUrgency | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined;
}

function normalizeFollowUpActionability(value: unknown): ReportFollowUpActionability | null {
  if (value === 'no_treatment_needed' || value === 'observe' || value === 'needs_follow_up' || value === 'needs_treatment') {
    return value;
  }
  return null;
}

function normalizeStringList(value: unknown, limit = 6): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return uniqueStrings(values.filter((item): item is string => typeof item === 'string')).slice(0, limit);
}

function buildFallbackFollowUpAssessment(
  request: ReportInterpretationResolvedRequest,
  insight: ReportInterpretationQueryInsight,
): ReportFollowUpAssessment {
  const hasHighRisk = insight.redFlagLines.length > 0
    || insight.abnormalItems.some((item) => item.urgency === 'high');
  const hasAbnormality = insight.abnormalItems.length > 0 || insight.reportHighlights.length > 0;
  const actionability: ReportFollowUpActionability = hasHighRisk
    ? 'needs_follow_up'
    : hasAbnormality
      ? 'observe'
      : 'no_treatment_needed';
  const problems = insight.abnormalItems.slice(0, 4).map((item) => ({
    title: item.name,
    evidence: [item.result, item.referenceRange ? `参考范围${item.referenceRange}` : ''].filter(Boolean).join('；'),
    urgency: item.urgency,
  }));
  return {
    actionability,
    summary: actionability === 'no_treatment_needed'
      ? '当前报告未见需要新增治疗的明确依据。'
      : actionability === 'needs_follow_up'
        ? '报告存在需优先复查、转诊或进一步临床评估的信号。'
        : `报告存在需结合病历观察随访的结果${request.reportKindLabel ? `（${request.reportKindLabel}）` : ''}。`,
    problems,
    medicationIntents: [],
  };
}

function normalizeFollowUpAssessment(
  response: ReportInterpretationLLMResponse['followUpAssessment'],
  fallback: ReportFollowUpAssessment,
): ReportFollowUpAssessment {
  const actionability = normalizeFollowUpActionability(response?.actionability) || fallback.actionability;
  const problems: ReportFollowUpProblem[] = Array.isArray(response?.problems)
    ? response.problems.map((item) => ({
        title: normalizeText(item?.title),
        evidence: normalizeText(item?.evidence),
        urgency: normalizeUrgency(item?.urgency),
      })).filter((item) => item.title && item.evidence).slice(0, 4)
    : fallback.problems;
  const medicationIntents: ReportFollowUpMedicationIntent[] = Array.isArray(response?.medicationIntents)
    ? response.medicationIntents.map((item) => ({
        indication: normalizeText(item?.indication),
        preferredGenericNames: normalizeStringList(item?.preferredGenericNames, 4),
        aliases: normalizeStringList(item?.aliases, 6),
        route: normalizeText(item?.route) || undefined,
      })).filter((item) => item.indication && item.preferredGenericNames.length > 0).slice(0, 3)
    : [];

  // 无药物治疗意图时，不能把模型的药物名称误带入后续处方生成。
  if (actionability !== 'needs_treatment') {
    return {
      actionability,
      summary: normalizeText(response?.summary) || fallback.summary,
      problems,
      medicationIntents: [],
    };
  }

  // 模型未能给出可检索的规范通用名时，降级为进一步临床处置，避免空依据处方。
  if (medicationIntents.length === 0) {
    return {
      ...fallback,
      actionability: 'needs_follow_up',
      summary: '报告提示需进一步结合临床评估；当前未形成可安全检索的药物治疗意图。',
      problems,
    };
  }

  return {
    actionability,
    summary: normalizeText(response?.summary) || fallback.summary,
    problems,
    medicationIntents,
  };
}

function splitReportLines(query: string): string[] {
  const normalized = query
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  return normalized.flatMap(splitLineByKnownLabels);
}

function splitLineByKnownLabels(line: string): string[] {
  const normalized = normalizeText(line);
  if (!normalized) {
    return [];
  }

  const labelPattern = KNOWN_REPORT_LABELS
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const boundaryPattern = new RegExp(`\\s+(?=(${labelPattern})\\s*[:：])`, 'g');

  return normalized
    .replace(boundaryPattern, '\n')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractInlineValue(line: string, labels: string[]): string {
  for (const label of labels) {
    if (line.startsWith(label)) {
      return normalizeText(line.slice(label.length).replace(/^[:：]\s*/, ''));
    }
  }

  return '';
}

function extractTaggedValue(lines: string[], labels: string[]): string {
  for (const line of lines) {
    const value = extractInlineValue(line, labels);
    if (value) {
      return value;
    }
  }

  return '';
}

function extractTaggedDateTimeValue(lines: string[], labels: string[]): string {
  const rawValue = extractTaggedValue(lines, labels);
  const match = rawValue.match(DATE_TIME_VALUE_PATTERN);
  return normalizeText(match?.[0] || rawValue);
}

function startsWithAnyLabel(line: string, labels: string[]): boolean {
  return labels.some((label) => line.startsWith(label));
}

function collectTaggedBlock(lines: string[], startLabels: string[], stopLabels: string[]): string[] {
  const values: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const inlineValue = extractInlineValue(line, startLabels);
    if (line.startsWith(startLabels[0]) || startsWithAnyLabel(line, startLabels)) {
      collecting = true;
      if (inlineValue) {
        values.push(inlineValue);
      }
      continue;
    }

    if (!collecting) {
      continue;
    }

    if (startsWithAnyLabel(line, stopLabels)) {
      break;
    }

    values.push(normalizeText(line));
  }

  return uniqueStrings(values);
}

function buildReportMeta(
  request: ReportInterpretationResolvedRequest,
  lines: string[],
  reportDate: string,
  reportItem: string,
): ReportInterpretationReportMeta {
  const historyFromReport = collectTaggedBlock(lines, HISTORY_LABELS, [
    ...REPORT_RESULT_LABELS,
    ...REPORT_CONCLUSION_LABELS,
    '建议',
    '备注',
  ]).join('；');
  const historyFromPatient = uniqueStrings([
    request.patient?.diagnosis ? `当前诊断：${request.patient.diagnosis}` : '',
    request.patient?.chiefComplaint ? `主诉：${request.patient.chiefComplaint}` : '',
    request.patient?.historyOfPresentIllness ? `现病史：${request.patient.historyOfPresentIllness}` : '',
  ]).join('；');

  return {
    reportTitle: reportItem || request.reportKindLabel,
    reportItem: reportItem || undefined,
    reportDate: reportDate || undefined,
    outpatientNo: extractTaggedValue(lines, OUTPATIENT_NO_LABELS) || request.patient?.visitId || undefined,
    sampleNo: extractTaggedValue(lines, SAMPLE_NO_LABELS) || undefined,
    submitDoctor: extractTaggedValue(lines, SUBMIT_DOCTOR_LABELS) || undefined,
    requestTime: extractTaggedDateTimeValue(lines, REQUEST_TIME_LABELS) || undefined,
    resultTime: extractTaggedDateTimeValue(lines, RESULT_TIME_LABELS) || reportDate || undefined,
    historyText: historyFromReport || historyFromPatient || undefined,
  };
}

function pickFindingRule(taskId: ReportInterpretationTaskId, finding: string): ReportInterpretationFindingRule {
  if (isNormalOrNegatedFinding(taskId, finding)) {
    return {
      pattern: /.*/,
      meaning: taskId === 'inspectReport'
        ? '当前文本未提示明确异常或阳性结果，仍需结合原始项目、参考范围和动态变化判断。'
        : '当前影像描述未提示明确阳性结构性改变，仍需结合症状、查体和既往同类检查判断。',
      action: taskId === 'inspectReport'
        ? '如症状持续或与结果不符，可结合参考范围和动态复查进一步确认。'
        : '如症状持续、体征不符或外伤后疼痛加重，可结合既往片或复查进一步确认。',
      urgency: 'low',
    };
  }

  const rules = taskId === 'inspectReport' ? LAB_FINDING_RULES : CHECK_FINDING_RULES;
  const matched = rules.find((rule) => rule.pattern.test(finding));
  if (matched) {
    return matched;
  }

  return taskId === 'inspectReport'
    ? {
        pattern: /.*/,
        meaning: '需要结合参考范围、采样时点和动态复查结果综合判断。',
        action: '建议对照参考范围并结合症状决定是否复查。',
        urgency: 'medium',
      }
    : {
        pattern: /.*/,
        meaning: '需要结合症状、病程、查体和既往同类检查综合判断。',
        action: '建议结合临床表现决定是否复查或补充进一步检查。',
        urgency: 'medium',
      };
}

function extractReferenceRange(line: string): string {
  const match = line.match(REFERENCE_RANGE_PATTERN);
  return normalizeText(match?.[1]);
}

function stripReferenceRange(line: string): string {
  return normalizeText(
    line
      .replace(/[（(]\s*(?:参考范围|参考值|正常范围|正常值)\s*[:：]?\s*[^）)]*[）)]/gi, '')
      .replace(REFERENCE_RANGE_PATTERN, '')
  );
}

function resolveAbnormalDirection(line: string): ReportInterpretationAbnormalDirection {
  if (/↓|降低|减少|偏低|低于/i.test(line)) {
    return 'down';
  }

  if (/↑|升高|增高|偏高|高于/i.test(line)) {
    return 'up';
  }

  if (/阳性|\(\+\)|（\+）|\+{1,3}/i.test(line)) {
    return 'positive';
  }

  if (/异常/i.test(line)) {
    return 'abnormal';
  }

  return 'neutral';
}

function isNegatedFindingClause(clause: string): boolean {
  const normalized = normalizeText(clause);
  if (!normalized) return false;
  if (NORMAL_FINDING_TEXT_PATTERN.test(normalized)) return true;
  return NEGATED_FINDING_PREFIX_PATTERN.test(normalized)
    && /(阳性|异常|升高|降低|增高|减少|偏高|偏低|高于|低于|病变|改变|损伤|高密度影|低密度影|斑片|结节|实变|磨玻璃|积液|增粗|阴影|占位|肿块|狭窄|扩张|骨折|脱位|出血|梗死|梗阻|钙化|破坏)/i.test(normalized);
}

function extractCheckFindingClauses(line: string): string[] {
  const clauses = normalizeText(line)
    .split(CHECK_FINDING_CLAUSE_SPLIT_PATTERN)
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return clauses.filter((clause) => CHECK_FINDING_PATTERN.test(clause) && !isNegatedFindingClause(clause));
}

function isNormalOrNegatedFinding(taskId: ReportInterpretationTaskId, text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  if (taskId === 'checkReport') {
    return CHECK_FINDING_PATTERN.test(normalized) && extractCheckFindingClauses(normalized).length === 0;
  }

  return ABNORMAL_MARK_PATTERN.test(normalized)
    && !/[↑↓]|\(\+\)|（\+）|\+{1,3}|阳性|升高|降低|增高|减少|偏高|偏低|高于|低于/i.test(normalized.replace(NORMAL_FINDING_TEXT_PATTERN, ''))
    && (NORMAL_FINDING_TEXT_PATTERN.test(normalized) || isNegatedFindingClause(normalized));
}

function parseLabAbnormalItem(line: string, taskId: ReportInterpretationTaskId): ReportInterpretationAbnormalItem | null {
  const normalized = normalizeText(line);
  if (!normalized || !ABNORMAL_MARK_PATTERN.test(normalized) || isNormalOrNegatedFinding(taskId, normalized)) {
    return null;
  }

  const referenceRange = extractReferenceRange(normalized);
  const withoutReference = stripReferenceRange(normalized).replace(/[↑↓]/g, '').trim();
  const firstSegment = normalizeText(withoutReference.split(/[，,；;]/)[0]);
  const match = firstSegment.match(/^(.+?)\s+([^，,；;（(]+(?:\s*[^，,；;（(]+)?)/);
  const direction = resolveAbnormalDirection(normalized);
  const name = normalizeText(match?.[1] || firstSegment.replace(/(阳性|弱阳性|异常|升高|降低|增高|减少|偏高|偏低)$/i, ''));
  const result = normalizeText(match?.[2] || (direction === 'positive' ? '阳性' : firstSegment));

  if (!name || !result) {
    return null;
  }

  const rule = pickFindingRule(taskId, `${name} ${result}`);
  return {
    name,
    result,
    direction,
    referenceRange: referenceRange || undefined,
    meaning: rule.meaning,
    urgency: rule.urgency,
  };
}

function buildCheckAbnormalItem(
  line: string,
  taskId: ReportInterpretationTaskId,
  index: number,
): ReportInterpretationAbnormalItem | null {
  const normalized = normalizeText(line);
  const findingClauses = extractCheckFindingClauses(normalized);
  if (!normalized || findingClauses.length === 0) {
    return null;
  }

  const findingText = uniqueStrings(findingClauses).join('；');
  const rule = pickFindingRule(taskId, findingText);
  return {
    name: index === 0 ? '核心影像发现' : '阳性所见',
    result: findingText,
    direction: rule.urgency === 'high' ? 'abnormal' : 'positive',
    referenceRange: '影像/检查描述',
    meaning: rule.meaning,
    urgency: rule.urgency,
  };
}

function buildAbnormalItems(
  request: ReportInterpretationResolvedRequest,
  resultLines: string[],
  conclusionLines: string[],
): ReportInterpretationAbnormalItem[] {
  const candidates = request.taskId === 'inspectReport'
    ? resultLines
    : uniqueStrings([...conclusionLines, ...resultLines]);
  const items = candidates
    .map((line, index) => request.taskId === 'inspectReport'
      ? parseLabAbnormalItem(line, request.taskId)
      : buildCheckAbnormalItem(line, request.taskId, index)
    )
    .filter((item): item is ReportInterpretationAbnormalItem => Boolean(item));

  return items.slice(0, 6);
}

function analyzeReportQuery(request: ReportInterpretationResolvedRequest): ReportInterpretationQueryInsight {
  const lines = splitReportLines(request.query);
  const reportDate = extractTaggedValue(lines, REPORT_DATE_LABELS);
  const reportItem = extractTaggedValue(lines, REPORT_ITEM_LABELS);
  const reportMeta = buildReportMeta(request, lines, reportDate, reportItem);
  const resultLines = collectTaggedBlock(lines, REPORT_RESULT_LABELS, REPORT_BLOCK_STOP_LABELS);
  const conclusionLines = uniqueStrings([
    ...collectTaggedBlock(lines, REPORT_CONCLUSION_LABELS, ['建议', '备注']),
    ...lines.filter((line) => extractInlineValue(line, REPORT_CONCLUSION_LABELS)),
  ]);
  const abnormalItems = request.abnormalItems?.slice(0, 6)
    || buildAbnormalItems(request, resultLines, conclusionLines);

  const rawCandidates = request.taskId === 'inspectReport'
    ? uniqueStrings([
        ...abnormalItems.map((item) => `${item.name} ${item.result}`),
        ...resultLines.filter((line) => LAB_ABNORMAL_PATTERN.test(line)),
        ...resultLines,
        ...conclusionLines,
      ])
    : uniqueStrings([
        ...abnormalItems.map((item) => item.result),
        ...conclusionLines,
        ...lines.filter((line) => CHECK_FINDING_PATTERN.test(line)),
        ...resultLines,
      ]);

  const reportHighlights = rawCandidates.slice(0, 4);
  const redFlagLines = reportHighlights.filter((line) => (
    !isNormalOrNegatedFinding(request.taskId, line)
    && (HIGH_RISK_FINDING_PATTERN.test(line) || pickFindingRule(request.taskId, line).urgency === 'high')
  ));
  const recommendedActions = uniqueStrings(
    reportHighlights.map((line) => pickFindingRule(request.taskId, line).action)
  ).slice(0, 4);

  return {
    reportDate: reportDate || undefined,
    reportItem: reportItem || undefined,
    reportMeta,
    abnormalItems,
    resultLines,
    conclusionLines,
    reportHighlights,
    redFlagLines,
    recommendedActions,
  };
}

function isGenericInterpretationText(text: string, clues: string[]): boolean {
  const normalized = normalizeText(text);
  if (!normalized) {
    return true;
  }

  const hasClue = clues.some((item) => {
    const clue = normalizeText(item);
    if (!clue) {
      return false;
    }

    return normalized.includes(clue) || normalized.includes(clue.split(/[；，,。]/)[0] || clue);
  });

  return GENERIC_INTERPRETATION_PHRASES.some((item) => normalized.includes(item)) && !hasClue;
}

function pickMeaningfulText(value: unknown, fallback: string, clues: string[]): string {
  const normalized = normalizeText(value);
  if (!normalized || isGenericInterpretationText(normalized, clues)) {
    return fallback;
  }

  return normalized;
}

function normalizeMeaningfulList(value: string[] | string | undefined, fallback: string[], clues: string[]): string[] {
  const normalized = normalizeList(value, []).filter((item) => !isGenericInterpretationText(item, clues));
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeList(value: string[] | string | undefined, fallback: string[]): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const normalized = items
    .flatMap((item) => item.split(/[\n；;。]/))
    .map((item) => normalizeText(item))
    .filter(Boolean);

  return normalized.length > 0 ? Array.from(new Set(normalized)).slice(0, 5) : fallback;
}

function normalizeKeyPoints(value: ReportInterpretationLLMResponse['keyPoints']): ReportInterpretationKeyPoint[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const urgency = item?.urgency === 'high' || item?.urgency === 'medium' || item?.urgency === 'low'
        ? item.urgency
        : 'medium';

      return {
        title: normalizeText(item?.title),
        detail: normalizeText(item?.detail),
        urgency,
      } satisfies ReportInterpretationKeyPoint;
    })
    .filter((item) => item.title && item.detail)
    .slice(0, 4);
}

function extractJsonObject<T>(response: string): T {
  const clean = response.replace(/```json\n?|\n?```|```\n?/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : clean);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timer);
      });
  });
}

async function createReportInterpretationWindowReadyWaiter(
  expectedLabel: string,
): Promise<ReportInterpretationWindowReadyWaiter> {
  let settled = false;
  let resolveReady: () => void = () => {};

  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const unlisten = await listen<ReportInterpretationWindowReadyEvent>(READY_EVENT, (event) => {
    if (event.payload?.label !== expectedLabel) {
      return;
    }

    settled = true;
    resolveReady();
  });

  const cleanup = (): void => {
    unlisten();
    if (!settled) {
      settled = true;
      resolveReady();
    }
  };

  return {
    wait: async () => {
      try {
        await withTimeout(
          readyPromise,
          REPORT_INTERPRETATION_WINDOW_READY_TIMEOUT_MS,
          '报告解读窗口初始化超时，请关闭后重试。',
        );
      } finally {
        cleanup();
      }
    },
    cancel: cleanup,
  };
}

function buildPatientProfile(
  currentPatient: AppPatient | null | undefined,
  incomingPatient: ReportInterpretationPatientInput | null | undefined,
): ReportInterpretationPatientProfile | null {
  const incomingId = readIncomingPatientText(incomingPatient, ['patientId', 'idPi']);
  if (incomingId && incomingId !== getPatientContextId(currentPatient)) currentPatient = null;
  const hasCurrent = Boolean(getPatientContextId(currentPatient) || getPatientContextName(currentPatient));
  const hasIncoming = Boolean(
    incomingPatient && Object.values(incomingPatient).some((item) => normalizeText(item).length > 0)
  );

  if (!hasCurrent && !hasIncoming) {
    return null;
  }

  const rawIncoming = incomingPatient ? { ...incomingPatient } : undefined;

  return {
    patientId: readIncomingPatientText(incomingPatient, ['patientId', 'idPi']) || getPatientContextId(currentPatient) || undefined,
    visitId: readIncomingPatientText(incomingPatient, ['visitId', 'idVis']) || getPatientContextVisitId(currentPatient) || undefined,
    patientName: readIncomingPatientText(incomingPatient, ['name', 'naPi']) || getPatientContextName(currentPatient) || undefined,
    genderText: readIncomingPatientText(incomingPatient, ['gender', 'sdSexText']) || getPatientContextGenderText(currentPatient) || undefined,
    ageText: readIncomingPatientText(incomingPatient, ['age', 'ageText']) || getPatientContextAgeText(currentPatient) || undefined,
    allergyHistory:
      readIncomingPatientText(incomingPatient, ['allergyHistory']) || getPatientContextAllergyHistory(currentPatient) || undefined,
    chiefComplaint:
      readIncomingPatientText(incomingPatient, ['chiefComplaint'])
      || normalizeText(currentPatient?.chiefComplaint)
      || undefined,
    historyOfPresentIllness:
      readIncomingPatientText(incomingPatient, ['historyOfPresentIllness'])
      || normalizeText(currentPatient?.historyOfPresentIllness)
      || undefined,
    pastMedicalHistory:
      readIncomingPatientText(incomingPatient, ['pastMedicalHistory'])
      || getPatientContextPastMedicalHistory(currentPatient)
      || undefined,
    diagnosis: readIncomingPatientText(incomingPatient, ['diagnosis']) || normalizeText(currentPatient?.diagnosis) || undefined,
    raw: rawIncoming,
  };
}

export function resolveReportInterpretationRequest(
  payload: ReportInterpretationRequestPayload,
  currentPatient: AppPatient | null | undefined,
): ReportInterpretationResolvedRequest {
  const query = normalizeReportQuery(payload.query);
  if (!query) {
    throw new Error('报告原文不能为空。');
  }

  return {
    requestId: normalizeText(payload.requestId) || generateRequestId(),
    taskId: payload.taskId,
    reportKindLabel: taskLabel(payload.taskId),
    query,
    patient: buildPatientProfile(currentPatient, payload.patient),
    abnormalItems: payload.abnormalItems,
  };
}

export function formatPatientSummary(patient: ReportInterpretationPatientProfile | null): string {
  if (!patient) {
    return '未提供患者背景，仅基于报告原文解读。';
  }

  const base = [patient.patientName, patient.genderText, patient.ageText]
    .map((item) => normalizeText(item))
    .filter(Boolean);

  const supplements = [
    patient.diagnosis ? `当前诊断：${patient.diagnosis}` : '',
    patient.chiefComplaint ? `主诉：${patient.chiefComplaint}` : '',
    patient.historyOfPresentIllness ? `现病史：${patient.historyOfPresentIllness}` : '',
    patient.pastMedicalHistory ? `既往史：${patient.pastMedicalHistory}` : '',
    patient.allergyHistory ? `过敏史：${patient.allergyHistory}` : '',
  ].filter(Boolean);

  const summary = [...base, ...supplements].join('；');
  return summary || '未提供患者背景，仅基于报告原文解读。';
}

function buildFallbackPayload(request: ReportInterpretationResolvedRequest): ReportInterpretationWindowPayload {
  const insight = analyzeReportQuery(request);
  const followUpAssessment = buildFallbackFollowUpAssessment(request, insight);
  const patientSummary = formatPatientSummary(request.patient);
  const lines = request.query
    .split(/\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean);
  const preview = lines.slice(0, 3).join('；') || '已接收报告原文';
  const headline = insight.reportHighlights[0] || preview;
  const reportLabel = insight.reportItem || request.reportKindLabel;
  const leadingRule = pickFindingRule(request.taskId, headline);
  const keyPoints = insight.reportHighlights.length > 0
    ? insight.reportHighlights.slice(0, 3).map((item, index) => {
        const rule = pickFindingRule(request.taskId, item);
        return {
          title: index === 0 ? '报告核心发现' : index === 1 ? '临床关注点' : '处置提醒',
          detail: `原文提示“${item}”。${rule.meaning}`,
          urgency: rule.urgency,
        } satisfies ReportInterpretationKeyPoint;
      })
    : [
        {
          title: '报告核心发现',
          detail: `当前报告最值得先看的内容为：${preview}。`,
          urgency: leadingRule.urgency,
        },
      ];

  const sectionHighlights = insight.reportHighlights.length > 0 ? insight.reportHighlights.join('；') : preview;
  const contextInterpretation = patientSummary.includes('未提供患者背景')
    ? `${headline}。${leadingRule.meaning}`
    : `结合患者背景（${patientSummary}），当前报告最值得关注的是：${headline}。${leadingRule.meaning}`;
  const nextActionText = uniqueStrings([
    ...insight.recommendedActions,
    insight.redFlagLines.length > 0 ? '若伴生命体征不稳、进行性加重或明确高危症状，应优先转急诊或专科处理。' : '',
    request.taskId === 'inspectReport'
      ? '如与当前症状不符，建议复核参考范围、采样时点，并结合动态复查判断。'
      : '建议与既往同类检查对照，必要时结合进一步影像或专科意见判断。',
  ]).join('；');

  return {
    requestId: request.requestId,
    taskId: request.taskId,
    reportKindLabel: request.reportKindLabel,
    patientSummary,
    patient: request.patient,
    reportMeta: insight.reportMeta,
    abnormalItems: insight.abnormalItems,
    abnormalAssessmentComplete: request.abnormalItems !== undefined,
    crossReportConsistency: normalizeReportConsistency(undefined, request.consistencyContext),
    sourceQuery: request.query,
    summary: `${reportLabel}最值得关注的发现是：${headline}`,
    conclusion: `${insight.reportDate ? `${insight.reportDate} ` : ''}${reportLabel}提示：${sectionHighlights}。${contextInterpretation}`,
    keyPoints,
    sections: [
      {
        title: '报告核心发现',
        content: sectionHighlights,
      },
      {
        title: '结合患者背景的判断',
        content: contextInterpretation,
      },
      {
        title: '建议下一步',
        content: nextActionText,
      },
    ],
    recommendations: uniqueStrings([
      ...insight.recommendedActions,
      request.taskId === 'inspectReport'
        ? '对照参考范围与动态趋势，必要时补充复查以判断变化方向。'
        : '结合既往影像或同类检查对照，避免孤立解读单次结果。',
    ]).slice(0, 4),
    cautions: [
      'AI 解读不能替代医生最终诊断。',
      request.taskId === 'inspectReport'
        ? '请结合原始报告数值、参考范围、采样时点和动态变化趋势判断。'
        : '请结合原始影像描述、查体和既往同类检查共同判断。',
    ],
    followUpAssessment,
    generatedAt: new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }),
  };
}

function sanitizeLLMResponse(
  request: ReportInterpretationResolvedRequest,
  response: ReportInterpretationLLMResponse,
  fallback: ReportInterpretationWindowPayload,
): ReportInterpretationWindowPayload {
  const clues = analyzeReportQuery(request).reportHighlights;
  const keyPoints = normalizeKeyPoints(response.keyPoints)
    .filter((item) => !isGenericInterpretationText(`${item.title} ${item.detail}`, clues));
  const sections = Array.isArray(response.sections)
    ? response.sections
        .map((item) => ({
          title: normalizeText(item?.title),
          content: normalizeText(item?.content),
        }))
        .filter((item) => item.title && item.content && !isGenericInterpretationText(item.content, clues))
        .slice(0, 4)
    : [];

  return {
    ...fallback,
    crossReportConsistency: normalizeReportConsistency(response.crossReportConsistency, request.consistencyContext),
    requestId: request.requestId,
    taskId: request.taskId,
    reportKindLabel: request.reportKindLabel,
    patientSummary: formatPatientSummary(request.patient),
    patient: request.patient,
    reportMeta: fallback.reportMeta,
    abnormalItems: fallback.abnormalItems,
    sourceQuery: request.query,
    summary: pickMeaningfulText(response.summary, fallback.summary, clues),
    conclusion: pickMeaningfulText(response.conclusion, fallback.conclusion, clues),
    keyPoints: keyPoints.length > 0 ? keyPoints : fallback.keyPoints,
    sections: sections.length > 0 ? sections : fallback.sections,
    recommendations: normalizeMeaningfulList(response.recommendations, fallback.recommendations, clues),
    cautions: normalizeMeaningfulList(response.cautions, fallback.cautions, clues),
    followUpAssessment: normalizeFollowUpAssessment(
      response.followUpAssessment,
      fallback.followUpAssessment,
    ),
  };
}

export async function buildReportInterpretationPayload(
  request: ReportInterpretationResolvedRequest,
): Promise<ReportInterpretationWindowPayload> {
  // 工作台已提供同日证据；外部单报告入口才从 HIS 补取，超时不阻断原报告解读。
  if (!request.consistencyContext) {
    try {
      const consistencyContext = await withTimeout(loadExternalReportConsistency(request), 12_000, '同日报告加载超时。');
      request = { ...request, consistencyContext };
    } catch {
      request = { ...request, consistencyContext: {
        patientId: request.patient?.patientId || '', date: '', reports: [], evidence: [], limitations: [],
        unavailableReason: '同日报告加载失败或超时，本次未完成跨报告校验。',
      } };
    }
  }
  const fallback = buildFallbackPayload(request);
  const reportInsights = analyzeReportQuery(request);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${PROMPTS.consultation.reportInterpretation.system}\n${REPORT_CONSISTENCY_INSTRUCTION}`,
    },
    {
      role: 'user',
      content: PROMPTS.consultation.reportInterpretation.buildUserPrompt({
        reportKindLabel: request.reportKindLabel,
        patientSummary: formatPatientSummary(request.patient),
        taskId: request.taskId,
        query: request.query,
        reportHighlights: reportInsights.reportHighlights,
      }) + consistencyPrompt(request.consistencyContext),
    },
  ];

  let result: ReportInterpretationWindowPayload;
  try {
    const response = await withTimeout(
      chat(messages, undefined, undefined, undefined, {
        traceContext: {
          scene: 'report-interpretation',
          sourceModule: 'report_interpretation',
          operationModule: 'report_interpretation',
          operationAction: 'build_report_interpretation',
          title: '生成报告解读',
        },
      }),
      REPORT_INTERPRETATION_LLM_TIMEOUT_MS,
      `报告解读生成超时（超过 ${Math.round(REPORT_INTERPRETATION_LLM_TIMEOUT_MS / 1000)} 秒）。`,
    );

    const parsed = extractJsonObject<ReportInterpretationLLMResponse>(response);
    result = sanitizeLLMResponse(request, parsed, fallback);
  } catch (error) {
    console.warn('[ReportInterpretation] Falling back to local interpretation:', error);
    result = fallback;
  }

  const snapshot = buildReportInterpretationUserLogSnapshot(request, result);
  void submitConsultationUserLog({
    consultationId: request.patient?.visitId || request.patient?.patientId || request.requestId,
    consultationRoundId: crypto.randomUUID(),
    consultationType: 'report_interpretation',
    patient: request.patient,
    firstSnapshot: snapshot,
    finalSnapshot: snapshot,
    selectionSnapshot: buildConsultationSelectionSnapshot(snapshot),
    changeSummary: {
      totalChanges: 0,
      recordFieldChanges: 0,
      diagnosisChanges: 0,
      treatmentChanges: 0,
    },
  });
  return result;
}

async function ensureReportInterpretationWindow(): Promise<{ window: WebviewWindow; isNewWindow: boolean }> {
  const existingWindow = await WebviewWindow.getByLabel(REPORT_INTERPRETATION_WINDOW_LABEL);
  if (existingWindow) {
    console.info('[ReportInterpretation] Reusing existing window:', existingWindow.label);
    return { window: existingWindow, isNewWindow: false };
  }

  const readyWaiter = await createReportInterpretationWindowReadyWaiter(REPORT_INTERPRETATION_WINDOW_LABEL);
  const createdWindow = new WebviewWindow(REPORT_INTERPRETATION_WINDOW_LABEL, {
    url: REPORT_INTERPRETATION_WINDOW_URL,
    title: '报告解读',
    decorations: false,
    width: 1040,
    height: 760,
    minWidth: 880,
    minHeight: 620,
    resizable: true,
    center: true,
    focus: true,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const finalize = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        callback();
      };

      void createdWindow.once('tauri://created', () => finalize(resolve));
      void createdWindow.once('tauri://error', (event) => {
        const message = normalizeText(event.payload) || '报告解读窗口创建失败。';
        finalize(() => reject(new Error(message)));
      });
    });
    await readyWaiter.wait();
  } catch (error) {
    readyWaiter.cancel();
    throw error;
  }

  console.info('[ReportInterpretation] Created window:', createdWindow.label);

  return { window: createdWindow, isNewWindow: true };
}

async function emitWindowEventWithRetry<T>(
  reportWindow: WebviewWindow,
  eventName: string,
  payload: T,
): Promise<void> {
  let lastError: unknown = null;

  for (const delay of WINDOW_EVENT_RETRY_DELAYS) {
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delay);
      });
    }

    try {
      await reportWindow.emit(eventName, payload);
      console.info('[ReportInterpretation] Emitted window event:', {
        eventName,
        target: reportWindow.label,
        delay,
      });
      lastError = null;
    } catch (error) {
      console.warn('[ReportInterpretation] Failed to emit window event:', {
        eventName,
        target: reportWindow.label,
        delay,
        error,
      });
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }
}

export async function openReportInterpretationWindow(
  payload: ReportInterpretationRequestPayload,
  currentPatient: AppPatient | null | undefined,
): Promise<ReportInterpretationWindowPayload> {
  const request = resolveReportInterpretationRequest(payload, currentPatient);
  const { window: reportWindow } = await ensureReportInterpretationWindow();

  console.info('[ReportInterpretation] Opening report window:', {
    requestId: request.requestId,
    taskId: request.taskId,
    windowLabel: reportWindow.label,
  });

  const loadingState: ReportInterpretationWindowStateEvent = {
    loading: true,
    phase: 'generating',
    message: `正在生成${request.reportKindLabel}解读...`,
    detail: '正在结合报告原文和患者背景生成结构化说明。',
    clearPayload: true,
  };

  await reportWindow.show();
  await emitWindowEventWithRetry(reportWindow, STATUS_EVENT, loadingState);

  try {
    await reportWindow.setFocus();
  } catch (error) {
    console.warn('[ReportInterpretation] Failed to focus report window, continue without blocking delivery:', {
      requestId: request.requestId,
      taskId: request.taskId,
      error,
    });
  }

  try {
    const result = await buildReportInterpretationPayload(request);
    console.info('[ReportInterpretation] Built payload successfully:', {
      requestId: request.requestId,
      taskId: request.taskId,
    });
    await emitWindowEventWithRetry(reportWindow, UPDATE_EVENT, result);
    await emitWindowEventWithRetry(reportWindow, STATUS_EVENT, {
      loading: false,
      phase: 'success',
      message: '',
      detail: '',
    } satisfies ReportInterpretationWindowStateEvent);
    return result;
  } catch (error) {
    const message = formatUserFacingError(error, { fallback: '报告解读生成失败，请稍后重试。' });
    console.error('[ReportInterpretation] Failed to build or deliver payload:', {
      requestId: request.requestId,
      taskId: request.taskId,
      error,
    });
    await emitWindowEventWithRetry(reportWindow, STATUS_EVENT, {
      loading: false,
      phase: 'error',
      message: '报告解读生成失败，请稍后重试。',
      detail: message,
      clearPayload: true,
    } satisfies ReportInterpretationWindowStateEvent);
    throw error;
  }
}

export const reportInterpretationWindowLabel = REPORT_INTERPRETATION_WINDOW_LABEL;
