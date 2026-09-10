import type {
  ChronicRefillReviewPlan,
  Diagnosis,
  TreatmentRecommendation,
} from '@/types/consultation';
import type { DiagnosisHint, TreatmentHint } from '@/prompts';
import type { OutpatientRecord } from './outpatientRecord';
import type { ClinicalRecordFactSuggestion } from './clinicalRecordFactConfirmation';

export type ClinicalResultChannel = 'voice' | 'symptom' | 'chronic-refill';

export type ClinicalResultRecommendationType = 'medicine' | 'exam' | 'lab_test' | 'procedure';

export type ClinicalResultRecommendationMode =
  | 'diagnostic_first'
  | 'treatment_first'
  | 'parallel'
  | 'explicit_only'
  | 'urgent_referral';

export interface ClinicalResultRecommendationPlan {
  mode: ClinicalResultRecommendationMode;
  recommendNow: ClinicalResultRecommendationType[];
  defer: ClinicalResultRecommendationType[];
  skip: ClinicalResultRecommendationType[];
  reason: string;
  resumeCondition: 'report_available' | 'doctor_request' | '';
  confidence: 'high' | 'medium' | 'low';
}

export type ClinicalResultGenerationSection =
  | 'record_core'
  | 'history_context'
  | 'record_suggestions'
  | 'explicit_orders'
  | 'diagnoses'
  | 'recommendation_plan'
  | 'review_plan'
  | 'recommended_medicines'
  | 'record_extra';

export type ClinicalResultGenerationStage =
  | 'preparing-context'
  | 'generating-content'
  | 'finalizing-result';

export interface ClinicalResultGenerationState {
  status: 'streaming' | 'complete' | 'error';
  readySections: ClinicalResultGenerationSection[];
  /** 非流式生成的真实任务节点；语音分区流可继续只使用 readySections。 */
  stage?: ClinicalResultGenerationStage;
  message?: string;
}

export interface ClinicalResultMatchedItem {
  id: string;
  name: string;
  spec?: string;
  manufacturer?: string;
  code?: string;
  idSrv?: string;
  naSrv?: string;
  sdSrv?: string;
  idDeptExec?: string;
  idPart?: string;
  jsonField?: string;
  fgCheckOrd?: string;
  fgSkintest?: string;
  storeIds?: string[];
  raw?: Record<string, unknown>;
}

export interface ClinicalResultMatchedDiagnosis extends DiagnosisHint {
  matchedItem?: { id: string; code: string; name: string } | null;
  suggestedMatchItem?: Diagnosis['suggestedMatchItem'];
  catalogMatchStatus?: Diagnosis['catalogMatchStatus'];
  catalogMatchReason?: string;
  catalogAlternatives?: Diagnosis['catalogAlternatives'];
}

export interface ClinicalResultMatchedTreatment extends TreatmentHint {
  matchedItem?: ClinicalResultMatchedItem | null;
  suggestedMatchItem?: ClinicalResultMatchedItem | null;
  matchStatus?: TreatmentRecommendation['matchStatus'];
  selected?: boolean;
  rejected?: boolean;
  manualMatched?: boolean;
  originalName?: string;
  reason?: string;
  goalGroup?: string;
  goalGroupPurpose?: string;
  necessity?: TreatmentRecommendation['necessity'];
}

export type ClinicalResultDiagnosis = ClinicalResultMatchedDiagnosis & Partial<Diagnosis>;

export type ClinicalResultTreatment =
  Omit<ClinicalResultMatchedTreatment, 'matchedItem'>
  & Omit<Partial<TreatmentRecommendation>, 'type' | 'matchedItem'>
  & {
    matchedItem?:
      | TreatmentRecommendation['matchedItem']
      | ClinicalResultMatchedTreatment['matchedItem']
      | null;
  };

export interface ClinicalResultRecommendationPolicy {
  /** false 表示调用方已提供完整治疗清单，结果页不得自动补拉通用方案。 */
  autoFetchTreatments?: boolean;
  /** false 表示不向医生提供“刷新方案”入口。 */
  allowTreatmentRefresh?: boolean;
  /** 限定该场景允许出现的治疗类型。 */
  allowedTreatmentTypes?: Array<'medicine' | 'examination' | 'labTest' | 'procedure'>;
  /** 语音病例抽取阶段给出的按类型推荐路由。 */
  plan?: ClinicalResultRecommendationPlan;
}

export interface ClinicalResultInput {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  allergyHistory: string;
  currentMedicationHistory: string;
  menstrualHistory?: string;
  familyHistory: string;
  symptoms: string[];
  negativeSymptoms: string[];
  diagnoses: ClinicalResultDiagnosis[];
  treatments: ClinicalResultTreatment[];
  treatmentPlan: string;
  healthEducation: string;
  outpatientRecord?: OutpatientRecord;
  /** 同次结构化生成返回的 AI 病历候选；旧结果可缺省并走稳定态兜底。 */
  factSuggestions?: ClinicalRecordFactSuggestion[];
  recommendationPolicy?: ClinicalResultRecommendationPolicy;
  /** 慢病复诊结果页的回写前核查；推荐值不等于医生已确认。 */
  chronicRefillReview?: ChronicRefillReviewPlan;
  /** 共享结果页的分区流式生成状态；非流式场景可不提供。 */
  generation?: ClinicalResultGenerationState;
  channel?: ClinicalResultChannel;
}
