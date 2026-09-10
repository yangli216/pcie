export { default as VoiceCapsule } from './ui/VoiceCapsule.vue';
export { default as VoiceRecommendationFeedbackPopover } from './ui/VoiceRecommendationFeedbackPopover.vue';
export { default as VoiceRecordFieldEditor } from './ui/VoiceRecordFieldEditor.vue';
export { default as VoiceResultHeader } from './ui/VoiceResultHeader.vue';
export { default as VoiceRigidBlockBanner } from './ui/VoiceRigidBlockBanner.vue';
export { default as VoiceSafetyReviewPanel } from './ui/VoiceSafetyReviewPanel.vue';
export { default as VoiceSessionFeedbackBar } from './ui/VoiceSessionFeedbackBar.vue';
export {
  constrainOrdinaryVoiceWorkingDiagnosisPlan,
  guardOrdinaryVoiceDiagnosisHints,
  promoteOrdinaryVoiceSymptomWorkingDiagnosis,
} from './lib/ordinaryVoiceDiagnosisGuard';
export { useVoiceEditorSnapshotPersistence } from './model/useVoiceEditorSnapshotPersistence';
export { useVoiceFeedbackActions } from './model/useVoiceFeedbackActions';
export { useVoiceCatalogMatching } from './model/useVoiceCatalogMatching';
export { useVoiceIntentRecognition } from './model/useVoiceIntentRecognition';
export { generateVoiceTreatmentRecommendations } from './model/voiceTreatmentRecommendationGeneration';
export type {
  VoiceTreatmentGenerationInput,
  VoiceTreatmentGenerationTaskResult,
} from './model/voiceTreatmentRecommendationGeneration';
export { useVoiceKnowledgeSearch } from './model/useVoiceKnowledgeSearch';
export { useVoiceRecordFieldState } from './model/useVoiceRecordFieldState';
export { useVoiceResultRecord } from './model/useVoiceResultRecord';
export { useVoiceResultFactCheck } from './model/useVoiceResultFactCheck';
export { useVoiceResultFactCheckState } from './model/useVoiceResultFactCheckState';
export { useVoiceRigidBlock } from './model/useVoiceRigidBlock';
export { useVoiceSafetyReview } from './model/useVoiceSafetyReview';
export {
  deriveSafetyIssueActionPlan,
  useIssueActionLabel,
  useSafetyIssueResolver,
} from './model/useSafetyIssueResolver';
export {
  clearVoiceConsultationCache,
  clearVoiceConsultationCacheById,
  getVoiceConsultationCacheKey,
  getVoiceConsultationEditorSnapshot,
  hasVoiceConsultationCache,
  loadVoiceConsultationCacheEntry,
  persistVoiceConsultationCacheEntry,
  resolveVoiceConsultationId,
  updateVoiceConsultationCache,
} from './model/voiceConsultationCache';
export type {
  VoiceFeedbackActions,
  VoiceFeedbackActionsNotify,
  VoiceFeedbackActionsOptions,
} from './model/useVoiceFeedbackActions';
export type {
  MatchedDiagnosis,
  MatchedTreatment,
  VoiceIntentResult,
} from './model/useVoiceIntentRecognition';
export type {
  AddLabTestsPlan,
  NoActionPlan,
  RemoveMedicationsPlan,
  SafetyIssueActionKind,
  SafetyIssueActionPlan,
  UseSafetyIssueResolverReturn,
} from './model/useSafetyIssueResolver';
export type { UseVoiceRigidBlockReturn } from './model/useVoiceRigidBlock';
export type { VoiceSafetyReviewStatus } from './model/useVoiceSafetyReview';
export type {
  VoiceConsultationCacheEntry,
  VoiceEditorSnapshot,
} from './model/voiceConsultationCache';
export {
  resolveSimulatedVoiceTranscript,
  type SimulatedVoiceTranscriptPayload,
  type SimulatedVoiceTranscriptResolution,
} from './lib/simulatedVoiceTranscript';
