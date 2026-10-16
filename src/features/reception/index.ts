export { default as ReceptionCapsule } from './ui/ReceptionCapsule.vue';
export {
  applyReceptionClinicalHistorySummaries,
  buildReceptionPatientDraft,
  resolveIncomingPatientTracking,
} from './lib/receptionPatientSummary';
export {
  getRecentReportedVisits,
  hasPatientReportedLabOrExamResults,
  hasReportedApplyResult,
} from './lib/reportedApplyResults';
export {
  useReceptionSessionController,
  type ReceptionSessionController,
  type ReceptionSessionStatus,
  type ReceptionPatientMemoryStatus,
} from './model/useReceptionSessionController';
export {
  resolveOutpatientVoiceEntry,
  useOutpatientScenarioRouter,
  type OutpatientScenarioRouter,
  type OutpatientScenarioRouterOptions,
} from './model/useOutpatientScenarioRouter';
export {
  resolveVoiceChronicRefillRoute,
  type VoiceChronicRefillRouteDecision,
} from './lib/voiceChronicRefillRouting';
export type {
  OutpatientVoiceEntryDecision,
  ReceptionOpportunity,
  ReceptionOpportunityType,
} from './types';
