export type PublicHealthCapability = 'health_prescription' | 'weight_management';
export type PublicHealthScene = 'hypertension_followup' | 'diabetes_followup' | 'elderly_exam';
export type PublicHealthSectionId = 'check_plan' | 'medication_guidance' | 'lifestyle_guidance' | 'exercise_plan' | 'meal_plan';
export interface FactSource { system: string; recordId: string }
export interface PublicHealthObservation {
  id: string; code: string; value: string | number; unit?: string;
  observedAt: string; source: FactSource;
}
export interface WeightProfile {
  heightCm: number; weightKg: number;
  region: '东北' | '华北' | '华东' | '华中' | '华南' | '西南' | '西北';
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  heightObservationId?: string; weightObservationId?: string; contextSource?: FactSource;
  activityDescription?: string; dietPreferences?: string; limitations?: string;
}
export interface PublicHealthFacts {
  observations: PublicHealthObservation[];
  conditions: Array<{ code: string; name: string; status: string }>;
  medicationClasses: Array<{ code: string; name: string }>;
  lifestyle: Partial<Record<'smoking' | 'alcohol' | 'exercise' | 'diet' | 'exerciseAbility' | 'occupation', string>>;
  historySummary?: string; nextFollowUpDate?: string; weightProfile?: WeightProfile;
}
export interface PublicHealthPatient { name: string; sex: 'male' | 'female' | 'unknown'; ageYears: number; sexSource?: FactSource }
export interface PublicHealthIdentity {
  capability: PublicHealthCapability; scene: PublicHealthScene; patientId: string;
  businessRecordId: string; recordVersion: string; snapshotAt: string;
  originRequestId: string; requestId: string;
}
export interface PublicHealthTarget {
  targetFieldId: string; label: string; sourceSections: PublicHealthSectionId[];
  valueType: 'string'; mode: 'replace';
}
export interface PublicHealthRequest extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; patient: PublicHealthPatient;
  facts: PublicHealthFacts; writebackTargets: PublicHealthTarget[];
}
export interface PublicHealthMealOption { id: string; title: string; content: string }
export interface PublicHealthSection {
  id: PublicHealthSectionId; title: string; content: string;
  /** Meal only: recommended option first, followed by two alternatives. */
  options?: PublicHealthMealOption[];
}
export interface PublicHealthMetrics { bmi: number; bmrKcalPerDay: number; formulaVersion: string }
export interface PublicHealthResult extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; sections: PublicHealthSection[];
  metrics?: PublicHealthMetrics; generatedAt: string;
  promptVersions: Array<{ code: string; version: string }>;
  knowledgeVersions: Array<{ assetId: string; version: string; sha256: string }>;
  warnings: Array<{ code: string; message: string; sectionId?: PublicHealthSectionId }>;
}
export interface PublicHealthConfirmed extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; writebackRequestId: string;
  items: Array<{ targetFieldId: string; sourceSections: PublicHealthSectionId[]; value: string }>;
  confirmedAt: string;
}
export interface PublicHealthFeedback extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; writebackRequestId: string;
  status: 'success' | 'failed'; savedRecordVersion?: string; errorCode?: string;
  message?: string; feedbackAt: string;
}
export interface PublicHealthLaunch { bridgeSessionId: string; request: PublicHealthRequest }
export interface PublicHealthFeedbackEvent { bridgeSessionId: string; feedback: PublicHealthFeedback }
export interface PublicHealthStreamBase extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; streamId: string; sequence: number;
}
export type PublicHealthStreamEvent =
  | { event: 'accepted'; data: PublicHealthStreamBase & { mode: 'new' | 'replayed'; acceptedAt: string } }
  | { event: 'progress'; data: PublicHealthStreamBase & { stage: string; message: string } }
  | { event: 'section'; data: PublicHealthStreamBase & { section: PublicHealthSection; provisional: true } }
  | { event: 'metrics'; data: PublicHealthStreamBase & { metrics: PublicHealthMetrics } }
  | { event: 'completed'; data: PublicHealthStreamBase & { result: PublicHealthResult } }
  | { event: 'failed'; data: PublicHealthStreamBase & { errorCode: string; message: string; retryable: false; failedAt: string } };
export type PublicHealthState = 'idle' | 'ready' | 'generating' | 'reviewable' | 'generation-failed'
  | 'knowledge-missing' | 'awaiting-writeback' | 'saved' | 'writeback-failed' | 'conflict' | 'expired';
export interface PublicHealthManualFacts {
  historySummary: string; sex: PublicHealthPatient['sex'];
  heightCm?: number; weightKg?: number; heightMeasuredAt?: string; weightMeasuredAt?: string;
  region?: WeightProfile['region']; season?: WeightProfile['season'];
  activityDescription?: string; dietPreferences?: string; limitations?: string;
}
