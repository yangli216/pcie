import type {
  HisInpatientOrder,
  HisInpatientEmrContextPackage,
  HisInpatientEmrContextPolicy,
  HisInpatientRegistrationInfo,
  HisInpatientTemperatureChart,
  HisOutpatientMedicalRecord,
} from '@/services/his';

export interface InpatientEmrPatientInput {
  idPi?: string;
  patientId?: string;
  idVis?: string;
  visitId?: string;
  naPi?: string;
  name?: string;
  sdSexText?: string;
  gender?: string;
  ageText?: string;
  age?: string;
}

export interface InpatientEmrGenerationRequest {
  admissionId: string;
  templateId: string;
  htmlContent: string;
  templateName?: string;
  recordTime?: string;
  doctorSupplement?: string;
  allowGenerateWithoutExternalBasis?: boolean;
  contextPolicy?: HisInpatientEmrContextPolicy;
  hisContext?: HisInpatientEmrContextPackage;
  requestId?: string;
  patient?: InpatientEmrPatientInput;
  outpatientVisitId?: string;
}

export type InpatientEmrFieldSource =
  | 'ai'
  | 'his_or_system'
  | 'fixed'
  | 'doctor_signature'
  | 'manual_or_his';

export interface InpatientEmrFieldRule {
  source: InpatientEmrFieldSource;
  dependencies?: string[];
  value?: string;
  promptIntent?: string;
  prompt?: string;
  constraints: string[];
}

export interface InpatientEmrTemplateField {
  id: string;
  name: string;
  article?: string;
  type: string;
  readonly: boolean;
  key: boolean;
  defaultValue?: string;
  /** Source text from this rendered template instance, independent of the cached field policy. */
  templateText?: { rendered?: string; attributeDefault?: string };
  meaning: string;
  aiSuitable: boolean;
  rule: InpatientEmrFieldRule;
}

export interface InpatientEmrTemplateParseResult {
  cacheKey: string;
  cacheHit: boolean;
  fields: InpatientEmrTemplateField[];
  /** Unresolved local suggestions; consumed only by the existing fallback classifier. */
  unknownFieldIds?: string[];
}

export interface InpatientEmrDocumentContext {
  templateId: string;
  templateName: string;
  recordType: string;
  recordTime: string;
  recordDate: string;
}

export interface InpatientEmrContext {
  documentContext: InpatientEmrDocumentContext;
  doctorSupplement?: string;
  doctorEdits?: Record<string, string>;
  aiContext?: HisInpatientEmrContextPackage;
  registration: HisInpatientRegistrationInfo | null;
  orders: HisInpatientOrder[];
  temperatureChart: HisInpatientTemperatureChart | null;
  outpatientRecord?: HisOutpatientMedicalRecord | null;
}

export interface InpatientEmrGeneratedPreview {
  emrContent: string;
  htmlContent: string;
  fieldValues: Record<string, string>;
  initialFieldValues: Record<string, string>;
  trace: InpatientEmrGenerationTrace;
  evidenceSummary: InpatientEmrEvidenceSummary;
}

export interface InpatientEmrGenerationResult extends InpatientEmrGeneratedPreview {
  request: InpatientEmrGenerationRequest;
  context: InpatientEmrContext;
  template: InpatientEmrTemplateParseResult;
  generatedAt: number;
}

export type InpatientEmrTraceStageKey =
  | 'hisContext'
  | 'outpatientRecord'
  | 'templateResolve'
  | 'aiFirstToken'
  | 'aiGenerate'
  | 'writebackDispatch'
  | 'writebackFeedback';

export type InpatientEmrTraceStageStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface InpatientEmrTraceStage {
  key: InpatientEmrTraceStageKey;
  title: string;
  status: InpatientEmrTraceStageStatus;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
  detail?: string;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface InpatientEmrGenerationTrace {
  traceId: string;
  startedAt: number;
  endedAt?: number;
  stages: InpatientEmrTraceStage[];
}

export type InpatientEmrEvidenceStatus = 'used' | 'available' | 'missing' | 'waiting' | 'failed' | 'skipped';

export interface InpatientEmrEvidenceSourceSummary {
  title: string;
  status: InpatientEmrEvidenceStatus;
  detail: string;
  count?: number;
  meta?: Record<string, string | number | boolean | null | undefined>;
}

export interface InpatientEmrEvidenceSummary {
  hisContext: InpatientEmrEvidenceSourceSummary;
  outpatientRecord: InpatientEmrEvidenceSourceSummary;
  doctorSupplement: InpatientEmrEvidenceSourceSummary;
  template: InpatientEmrEvidenceSourceSummary;
  aiGeneration: InpatientEmrEvidenceSourceSummary;
}

export type InpatientEmrStepKey = 'patient' | 'orders' | 'temperature' | 'template' | 'generate';
export type InpatientEmrStepStatus = 'pending' | 'running' | 'done' | 'error';

export interface InpatientEmrGenerationStep {
  key: InpatientEmrStepKey;
  title: string;
  description: string;
  status: InpatientEmrStepStatus;
  detail?: string;
}

export interface InpatientEmrGenerationProgress {
  key: InpatientEmrStepKey;
  status: InpatientEmrStepStatus;
  detail?: string;
}

export type InpatientEmrQualityIssueSeverity = 'high' | 'medium';

export interface InpatientEmrQualityIssue {
  id: string;
  severity: InpatientEmrQualityIssueSeverity;
  title: string;
  description: string;
  fieldId?: string;
}
