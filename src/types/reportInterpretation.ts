import type { ReportConsistencyContext, ReportConsistencyResult } from '@features/report-interpretation/lib/reportConsistency';
export type ReportInterpretationTaskId = 'inspectReport' | 'checkReport';

export type ReportInterpretationUrgency = 'low' | 'medium' | 'high';

/** 报告解读后用于决定是否可进入报告回诊方案的处置结论。 */
export type ReportFollowUpActionability =
  | 'no_treatment_needed'
  | 'observe'
  | 'needs_follow_up'
  | 'needs_treatment';

export interface ReportFollowUpProblem {
  title: string;
  evidence: string;
  urgency?: ReportInterpretationUrgency;
}

/**
 * 这是治疗意图而不是处方：只用于从当前有效库存精确找候选，不能携带剂量或包装数量。
 */
export interface ReportFollowUpMedicationIntent {
  indication: string;
  preferredGenericNames: string[];
  aliases?: string[];
  route?: string;
}

export interface ReportFollowUpAssessment {
  actionability: ReportFollowUpActionability;
  summary: string;
  problems: ReportFollowUpProblem[];
  medicationIntents: ReportFollowUpMedicationIntent[];
}

export interface ReportInterpretationPatientInput {
  patientId?: string;
  idPi?: string;
  visitId?: string;
  idVis?: string;
  name?: string;
  naPi?: string;
  gender?: string;
  sdSexText?: string;
  age?: string;
  ageText?: string;
  allergyHistory?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  diagnosis?: string;
  [key: string]: unknown;
}

export interface ReportInterpretationRequestPayload {
  taskId: ReportInterpretationTaskId;
  query: string;
  requestId?: string;
  patient?: ReportInterpretationPatientInput | null;
  abnormalItems?: ReportInterpretationAbnormalItem[];
}

export interface ReportInterpretationPatientProfile {
  patientId?: string;
  visitId?: string;
  patientName?: string;
  genderText?: string;
  ageText?: string;
  allergyHistory?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  diagnosis?: string;
  raw?: Record<string, unknown>;
}

export interface ReportInterpretationResolvedRequest {
  consistencyContext?: ReportConsistencyContext;
  requestId: string;
  taskId: ReportInterpretationTaskId;
  reportKindLabel: string;
  query: string;
  patient: ReportInterpretationPatientProfile | null;
  abnormalItems?: ReportInterpretationAbnormalItem[];
}

export interface ReportInterpretationSection {
  title: string;
  content: string;
}

export interface ReportInterpretationKeyPoint {
  title: string;
  detail: string;
  urgency?: ReportInterpretationUrgency;
}

export type ReportInterpretationAbnormalDirection = 'up' | 'down' | 'positive' | 'abnormal' | 'neutral';

export interface ReportInterpretationReportMeta {
  reportTitle?: string;
  reportItem?: string;
  reportDate?: string;
  outpatientNo?: string;
  sampleNo?: string;
  submitDoctor?: string;
  requestTime?: string;
  resultTime?: string;
  historyText?: string;
}

export interface ReportInterpretationAbnormalItem {
  name: string;
  result: string;
  direction?: ReportInterpretationAbnormalDirection;
  referenceRange?: string;
  meaning?: string;
  urgency?: ReportInterpretationUrgency;
}

export interface ReportInterpretationWindowPayload {
  crossReportConsistency?: ReportConsistencyResult;
  requestId: string;
  taskId: ReportInterpretationTaskId;
  reportKindLabel: string;
  patientSummary: string;
  patient?: ReportInterpretationPatientProfile | null;
  reportMeta: ReportInterpretationReportMeta;
  abnormalItems: ReportInterpretationAbnormalItem[];
  /** true 表示异常项来自完整结构化报告，可据此安全展示“总体正常”。 */
  abnormalAssessmentComplete?: boolean;
  sourceQuery: string;
  summary: string;
  conclusion: string;
  keyPoints: ReportInterpretationKeyPoint[];
  sections: ReportInterpretationSection[];
  recommendations: string[];
  cautions: string[];
  /** 报告回诊只消费该结构化结论，不以展示文案反向推断处方需求。 */
  followUpAssessment: ReportFollowUpAssessment;
  generatedAt: string;
}

export interface ReportInterpretationWindowStateEvent {
  loading: boolean;
  phase?: 'preparing' | 'generating' | 'rendering' | 'success' | 'error';
  message?: string;
  detail?: string;
  clearPayload?: boolean;
}
