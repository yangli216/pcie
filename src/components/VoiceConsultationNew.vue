<script setup lang="ts">
import { ref, computed, watch, inject, onMounted, onUnmounted, nextTick } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { PatientHeader } from '@entities/patient';
import Icon from '@shared/ui/Icon.vue';
import { chat } from '../services/llm';
import { PROMPTS } from '../prompts';
import { getHisAdapter } from '../services/his';
import { medicalDataService, type DiagnosisItem } from '../services/medicalData';
import { useVoiceFeedback } from '@features/feedback';
import {
  checkDiagnosis,
  checkMedicine,
  checkExamination,
  isReviewerEnabled,
} from '../services/factChecker';
import {
  buildConsultationUserLogSnapshot,
  submitConsultationUserLog,
} from '../services/consultationUserLog';
import {
  applyRecommendationPreferenceRanking,
  buildDiagnosisPreferenceCandidate,
  buildTreatmentPreferenceCandidate,
  trackFinalRecommendationPreferences,
  trackTreatmentMatchPreference,
} from '../services/recommendationPreferenceTracker';
import type { TreatmentRecommendation, Diagnosis } from '../types/consultation';
import type { AppPatient } from '../types/appState';
import type { VoiceIntentResult, MatchedTreatment, MatchedDiagnosis } from '@features/voice-consultation';
import {
  applyManualMatchCandidate,
  assessTreatmentCatalogMatch,
  buildClinicalResultDiagnosisRequestSpec,
  buildDiagnosisScopedPrecautions,
  buildClinicalRecordFactSuggestionRequest,
  buildClinicalResultRegenerationRequest,
  buildDiagnosisSuggestionSections,
  buildDiagnosisRationale as buildSharedDiagnosisRationale,
  buildInventoryBlockedSubmitMessage,
  buildRecordConfirmedPayload,
  buildSelectedTreatments,
  buildTreatmentPlanSummary,
  buildTreatmentReason as buildSharedTreatmentReason,
  findManualMatchCandidates,
  findUsageOptionByValue,
  getDiagnosisRecommendationFeedbackKey,
  getDiagnosisSuggestionDirectionKey,
  getMatchedItemRaw,
  getMedicineCollapsedSummary as getSharedMedicineCollapsedSummary,
  getMedicineFieldDisplay as getSharedMedicineFieldDisplay,
  getReasonTooltipKey,
  getStandardDiagnosisId,
  getStandardDiagnosisKey,
  getSuggestedMatchName,
  getTreatmentEditorFieldKey,
  getTreatmentEditorKey,
  getTreatmentMatchLabel as getSharedTreatmentMatchLabel,
  getTreatmentOriginalName,
  getTreatmentRecommendationFeedbackKey,
  getTreatmentSpec,
  hasProbableMatch,
  initClinicalDiagnoses,
  initClinicalTreatments,
  mapClinicalResultAiDiagnoses,
  mergeClinicalRecordSuggestionIntoText,
  parseLLMJson,
  normalizeClinicalResultRegenerationOutput,
  rememberManualCatalogMatch,
  resolveRecordConfirmedPrescriptionAttributes,
  shouldAutoSelectTreatment,
  syncTreatmentExecDeptSelections as syncSharedTreatmentExecDeptSelections,
  toManualMatchCandidateView,
  type ClinicalResultInput,
  type ClinicalResultChannel,
  type ClinicalResultGenerationSection,
  type ClinicalResultRecommendationType,
  type ClinicalResultRecordSummaryInput,
  type ClinicalResultRegenerationRecord,
  type ClinicalRecordFactField,
  type ClinicalRecordFactSuggestion,
  type MedicinePrimaryField,
  type ManualMatchRawCandidate,
} from '@features/clinical-result';
import { requestDiagnosisChecklist } from '@features/clinical-result/api/diagnosisChecklistRequest';
import {
  type UsageOption,
} from '../utils/medicalDictionaryHelpers';
import {
  inferFrequencyFromText as inferFrequencyFromTextPure,
  inferRouteFromText as inferRouteFromTextPure,
} from '../utils/treatmentInference';
import { useOutsideInteraction } from '@shared/composables/useOutsideInteraction';
import { formatUserFacingError } from '@shared/lib/errorMessages';
import {
  VoiceRecordFieldEditor,
  guardOrdinaryVoiceDiagnosisHints,
  getVoiceConsultationEditorSnapshot,
  updateVoiceConsultationCache,
  generateVoiceTreatmentRecommendations,
  useVoiceEditorSnapshotPersistence,
  useVoiceFeedbackActions,
  useVoiceRecordFieldState,
  useVoiceResultFactCheckState,
  type VoiceEditorSnapshot,
} from '@features/voice-consultation';
import {
  ClinicalGenerationProgress,
  ClinicalDecisionDisclaimer,
  ClinicalResultColumnNavigator,
  ChronicRefillReviewPanel,
  ClinicalResultSupplementDialog,
  ClinicalResultWritebackScopeSelector,
  DiagnosisDifferentialList,
  DiagnosisRecommendationCard,
  isDoctorOwnedTreatment,
  mergeGeneratedTreatmentBranches,
  MutualRecognitionDecisionHost,
  TreatmentGenerationPlaceholder,
  TreatmentRecommendationSection,
  buildClinicalResultIntentRecordSnapshot,
  buildClinicalResultNavigationItems,
  useBodySiteOptions,
  useClinicalResultCancelController,
  useClinicalResultColumnNavigation,
  useClinicalRecordFactConfirmation,
  useClinicalRecordFactSuggestionScheduler,
  useChronicRefillReview,
  useClinicalResultChannelStrategy,
  useClinicalResultDiagnosisChecklist,
  useDifferentialDiagnosisDirection,
  useClinicalResultFinalization,
  useClinicalResultGenerationSequence,
  useClinicalResultIntentReset,
  useClinicalResultProgressiveIntentApplication,
  useClinicalResultPrecautionsScope,
  useClinicalResultPatientContext,
  useClinicalResultWritebackPayload,
  useClinicalResultWritebackPreflight,
  useClinicalResultWritebackScope,
  useConsultationReferenceFeedbackListener,
  useClinicalResultUserLogController,
  useDiagnosisSelection,
  useManualMatchState,
  useMedicalDictionaries,
  useMedicineFieldEditing,
  useMedicineUsageSearch,
  useMutualRecognitionDecision,
  useReasonTooltipState,
  useRecommendationFeedbackPopover,
  useRelatedDiagnosisDropdown,
  useSecondarySelector,
  useTreatmentAttributeSearch,
  useTreatmentGates,
  useTreatmentEditorState,
  useTreatmentHydration,
  useTreatmentNormalization,
  useTreatmentPharmacyResolution,
  useTreatmentQuickSelector,
  useTreatmentSelectionReadiness,
  useTreatmentSections,
  useWritebackFeedbackController,
  useWritebackStatus,
  type ManualMatchCandidate,
  type ClinicalResultDiagnosisRequestMode,
  type SecondarySelectorField,
  type WritebackFeedbackPayload,
} from '@features/consultation-result';
import type { VoiceRecommendationFeedbackDraft } from '../types/voiceFeedback';

type ReferenceFeedbackPayload = WritebackFeedbackPayload;
type TreatmentAttributeOption = Pick<UsageOption, 'key' | 'text'> & Partial<Pick<UsageOption, 'mcode'>>;

const props = withDefaults(defineProps<{
  initialPatientData?: AppPatient;
  intentResult: ClinicalResultInput | VoiceIntentResult | null;
  channel?: ClinicalResultChannel;
  showPatientHeader?: boolean;
  /**
   * intentResult 的来源。
   * - 'llm'：本次 LLM 刚刚解析出的全新结果，不叠加 editorSnapshot
   * - 'cache'：从同就诊缓存恢复，需叠加 editorSnapshot 还原现场
   * - null/undefined：未明确，默认不叠加
   */
  intentSource?: 'llm' | 'cache' | null;
  /**
   * 当前语音问诊轮次 ID。
   * 由 useVoiceConsultation 在 handleVoiceStop 时生成，
   * 贯穿该轮所有用户日志提交（speech → firstSnapshot → finalSnapshot/abandoned）。
   */
  consultationRoundId?: string | null;
  /** M1 仍在分区流式生成时为 true；页面展示已就绪区块但禁止回写。 */
  processing?: boolean;
  secondaryFooterActionText?: string;
  secondaryFooterActionDisabled?: boolean;
}>(), {
  channel: 'voice',
  showPatientHeader: true,
  intentSource: null,
  consultationRoundId: null,
  processing: false,
  secondaryFooterActionText: '',
  secondaryFooterActionDisabled: false,
});

const emit = defineEmits(['close', 'cancel', 'secondary-footer-action']);

const showToast = inject<(msg: string, type?: string) => void>('showToast');
const recommendationPolicy = computed(() => props.intentResult?.recommendationPolicy);
const resultRegenerating = ref(false);
const showSupplementDialog = ref(false);
const supplementGuidance = ref('');

const chiefComplaint = ref('');
const historyOfPresentIllness = ref('');
const pastMedicalHistory = ref('');
const personalHistory = ref('');
const menstrualHistory = ref('');
const familyHistory = ref('');
const physicalExam = ref('');
const precautions = ref('');

const aiDiagnoses = ref<Diagnosis[]>([]);
const differentialDiagnosisDirection = useDifferentialDiagnosisDirection();
const {
  includedKeys: includedDifferentialDiagnosisKeys,
  promotedKeys: promotedDifferentialDiagnosisKeys,
  include: includeDifferentialDiagnosisDirection,
  remove: removeDifferentialDiagnosisDirection,
  promote: promoteDifferentialDiagnosisDirection,
  reset: resetDifferentialDiagnosisDirection,
  restore: restoreDifferentialDiagnosisDirection,
  serialize: serializeDifferentialDiagnosisDirection,
} = differentialDiagnosisDirection;
const diagnosisSuggestionSections = computed(() => buildDiagnosisSuggestionSections(
  aiDiagnoses.value,
  props.channel === 'chronic-refill' ? aiDiagnoses.value.length : 3,
  promotedDifferentialDiagnosisKeys.value,
));
const formalDiagnoses = computed(() => diagnosisSuggestionSections.value.formal);
const differentialDiagnoses = computed(() => diagnosisSuggestionSections.value.differential);
const diagnosisSelection = useDiagnosisSelection({ diagnoses: formalDiagnoses });
const {
  selectedDiagnosis,
  selectedDiagnoses,
  getDiagnosisIdentity,
  isDiagnosisSelected,
  isPrimaryDiagnosis,
  replaceDiagnosisSelection,
  replaceInitialDiagnosisSelection,
  resetDiagnosisSelection,
  toggleDiagnosis: toggleDiagnosisSelection,
  setPrimaryDiagnosis: setPrimaryDiagnosisSelection,
  removeDiagnosis: removeDiagnosisSelection,
  replaceDiagnosisInSelection,
} = diagnosisSelection;
const diagnosisRequestSeq = ref(0);

const treatments = ref<TreatmentRecommendation[]>([]);
const treatmentLoading = ref(false);
const treatmentRequestSeq = ref(0);
const autoTreatmentFetchAttemptKey = ref('');
let intentResultApplicationSequence = 0;
type TreatmentGenerationStatus = 'idle' | 'loading' | 'ready' | 'deferred' | 'skipped' | 'error';
const treatmentGenerationState = ref<Record<ClinicalResultRecommendationType, TreatmentGenerationStatus>>({
  medicine: 'idle',
  exam: 'idle',
  lab_test: 'idle',
  procedure: 'idle',
});

function resolveRequestedTreatmentTypes(): ClinicalResultRecommendationType[] {
  const plan = recommendationPolicy.value?.plan;
  if (plan) return [...plan.recommendNow];
  const allowed = recommendationPolicy.value?.allowedTreatmentTypes;
  if (!allowed) return ['medicine', 'exam', 'lab_test', 'procedure'];
  return allowed.map((type) => type === 'examination' ? 'exam' : type === 'labTest' ? 'lab_test' : type);
}

function resetTreatmentGenerationState(): void {
  const plan = recommendationPolicy.value?.plan;
  const requested = new Set(resolveRequestedTreatmentTypes());
  const deferred = new Set(plan?.defer || []);
  const skipped = new Set(plan?.skip || []);
  treatmentGenerationState.value = {
    medicine: deferred.has('medicine') ? 'deferred' : skipped.has('medicine') || !requested.has('medicine') ? 'skipped' : 'idle',
    exam: deferred.has('exam') ? 'deferred' : skipped.has('exam') || !requested.has('exam') ? 'skipped' : 'idle',
    lab_test: deferred.has('lab_test') ? 'deferred' : skipped.has('lab_test') || !requested.has('lab_test') ? 'skipped' : 'idle',
    procedure: deferred.has('procedure') ? 'deferred' : skipped.has('procedure') || !requested.has('procedure') ? 'skipped' : 'idle',
  };
}

const lastAppliedIntentKey = ref('');

const submitting = ref(false);
const writebackStatus = useWritebackStatus({
  isSubmitting: () => submitting.value,
});
const {
  waitingWritebackFeedback,
  pendingWritebackRequestId,
  isWritebackBusy,
  writebackBannerTone,
  writebackBannerText,
  clearLastFeedback,
  resetWritebackState,
  markWritebackPending,
  applyWritebackFeedback: applyWritebackFeedbackStatus,
} = writebackStatus;
const channelStrategy = useClinicalResultChannelStrategy({
  channel: () => props.channel,
  showPatientHeader: () => props.showPatientHeader,
});
const {
  channel: resultChannel,
  userLogType: consultationUserLogType,
  shouldUseVoiceCache,
  shouldShowPatientHeader,
  cancelDialogTitle,
  cancelDialogText,
  diagnosisChecklistTraceContext,
  buildPreferenceContext: buildChannelPreferenceContext,
} = channelStrategy;

const patientContext = useClinicalResultPatientContext({
  patient: computed(() => props.initialPatientData),
});
const {
  consultationId,
  patientAge,
  patientAnchorId,
  patientGender,
  patientName,
  patientTetId,
} = patientContext;
const isFemalePatient = computed(() => /^(?:F|2|女)/iu.test(patientGender.value.trim()));

const diagnosisChecklist = useClinicalResultDiagnosisChecklist({
  isEnabled: () => {
    if (resultChannel.value === 'chronic-refill') return false;
    const generation = props.intentResult?.generation;
    return generation?.status !== 'streaming'
      || generation.readySections.includes('record_suggestions');
  },
  getConsultationId: () => consultationId.value,
  getPrimaryDiagnosis: () => selectedDiagnosis.value,
  getChiefComplaint: () => chiefComplaint.value,
  getHistoryOfPresentIllness: () => historyOfPresentIllness.value,
  request: (input) => requestDiagnosisChecklist(input, {
    ...diagnosisChecklistTraceContext.value,
    consultationId: consultationId.value,
  }),
  formatError: (error) => formatUserFacingError(error, {
    context: '诊断鉴别生成失败',
    fallback: '请稍后重试。',
  }),
  notify: showToast,
});
const {
  closeDiagnosisChecklist,
  getDiagnosisChecklistPreview,
  getDiagnosisChecklistStatus,
  isDiagnosisChecklistOpen,
  openDiagnosisChecklist,
} = diagnosisChecklist;

const lastTreatmentDiagnosisKey = ref('');
const clinicalResultGenerationSequence = useClinicalResultGenerationSequence({
  getChannel: () => props.channel,
  getGeneration: () => props.intentResult?.generation,
  getFormalDiagnosisCount: () => formalDiagnoses.value.length,
  getSelectedDiagnosisKey: () => getDiagnosisIdentity(selectedDiagnosis.value),
  getLastTreatmentDiagnosisKey: () => lastTreatmentDiagnosisKey.value,
});
const {
  beginDiagnosis: beginDiagnosisGeneration,
  beginTreatment: beginTreatmentGeneration,
  canShowGeneratedTreatments,
  canStartAutoTreatment,
  coreRecordEditable,
  diagnosisLoading,
  diagnosisRequestMode,
  finishDiagnosis: finishDiagnosisGeneration,
  finishTreatment: finishTreatmentGeneration,
  initialDiagnosisPending,
  reset: resetGenerationSequence,
  shouldRecoverMissingDiagnosis,
  showBlockingDiagnosisLoading,
  treatmentGenerationIsInitial,
} = clinicalResultGenerationSequence;
const clinicalResultFinalization = useClinicalResultFinalization({
  getChannel: () => props.channel,
  getGeneration: () => props.intentResult?.generation,
  getDiagnosisPending: () => initialDiagnosisPending.value,
  getTreatmentPending: () => treatmentLoading.value && !lastTreatmentDiagnosisKey.value,
});
const {
  allowsPostResultFactSuggestions,
  allowsTreatmentAutoFetchInBackground,
  applyingFinalResult,
  begin: beginFinalResultApplication,
  displayedGeneration,
  finish: finishFinalResultApplication,
  reset: resetFinalResultApplication,
} = clinicalResultFinalization;
const isResultGenerating = computed(() => (
  resultRegenerating.value
  || applyingFinalResult.value
  || initialDiagnosisPending.value
  || props.processing
  || props.intentResult?.generation?.status === 'streaming'
));
const isResultGenerationFailed = computed(() => props.intentResult?.generation?.status === 'error');
const isResultUnavailable = computed(() => isResultGenerating.value || isResultGenerationFailed.value);
const allowTreatmentRefresh = computed(() => recommendationPolicy.value?.allowTreatmentRefresh !== false);
const autoFetchTreatments = computed(() => recommendationPolicy.value?.autoFetchTreatments !== false);
const suppressDiagnosisTreatmentRefetch = ref(false);
const canRefreshDiagnosis = computed(() => (
  chiefComplaint.value.trim().length > 0
  || historyOfPresentIllness.value.trim().length > 0
));
const displayedTreatments = computed(() => (
  canShowGeneratedTreatments.value
    ? treatments.value
    : treatments.value.filter(isDoctorOwnedTreatment)
));
const selectedTreatments = computed(() => buildSelectedTreatments({ items: displayedTreatments.value }));
const treatmentRefreshNeeded = computed(() => {
  const currentIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  if (!currentIdentity || suppressDiagnosisTreatmentRefetch.value) {
    return false;
  }
  // 没有已加载的治疗方案时不显示"保留上一版"提示
  if (treatments.value.length === 0) {
    return false;
  }
  return currentIdentity !== lastTreatmentDiagnosisKey.value;
});
const treatmentSectionState = useTreatmentSections({
  treatments: displayedTreatments,
  selectedDiagnosis,
  isRefreshNeeded: treatmentRefreshNeeded,
  getLastTreatmentDiagnosisKey: () => lastTreatmentDiagnosisKey.value,
  generationStates: treatmentGenerationState,
  showGenerationPlaceholders: computed(() => (
    resultChannel.value === 'voice'
    && treatmentLoading.value
    && canShowGeneratedTreatments.value
  )),
});
const {
  treatmentEmptyText,
  treatmentPresentationRows,
  treatmentSections,
} = treatmentSectionState;
const clinicalResultNavigationItems = computed(() => buildClinicalResultNavigationItems(
  formalDiagnoses.value.length,
  treatmentSections.value,
));
const clinicalResultColumnNavigation = useClinicalResultColumnNavigation(
  () => clinicalResultNavigationItems.value,
);
const {
  containerRef: clinicalResultRightColumnRef,
  activeKey: activeClinicalResultSection,
  navigateTo: navigateClinicalResultSection,
  revealOverlayAnchor: revealClinicalResultOverlayAnchor,
  syncActiveSection: syncActiveClinicalResultSection,
} = clinicalResultColumnNavigation;
watch(clinicalResultNavigationItems, (items) => {
  if (!items.some((item) => item.key === activeClinicalResultSection.value)) {
    activeClinicalResultSection.value = 'diagnosis';
  }
  void nextTick(syncActiveClinicalResultSection);
}, { flush: 'post' });
const displayedTreatmentEmptyText = computed(() => (
  resultChannel.value === 'voice'
    && formalDiagnoses.value.length === 0
    && differentialDiagnoses.value.length > 0
    ? '当前只有待鉴别方向，请补充依据或由医生转为正式诊断后再生成治疗方案。'
    : recommendationPolicy.value?.plan?.mode === 'diagnostic_first'
    ? (recommendationPolicy.value.plan.reason || '当前先完善必要的检验检查，药品建议将在结果返回后继续生成。')
    : allowTreatmentRefresh.value
      ? treatmentEmptyText.value
    : (props.intentResult?.treatmentPlan || '当前有效库存中没有可直接续方的历史药品，请医生核实后手工调整。')
));

// 库存校验状态 / 药品详情 hydrate / 库存检查均迁移到共享 `useTreatmentHydration`，
// 实例化在 `treatmentNormalization` 之后（依赖 pharmacyOptions / treatmentGates / 字典查找函数）。
// 这里仅保留对外暴露的解构变量名（hydration.* -> 同名函数），call site 不变。

const getPatientAnchorId = (): string => patientAnchorId.value;
const resolveConsultationId = (): string => consultationId.value;

const mutualRecognition = useMutualRecognitionDecision({
  resolveConsultationId,
  resolvePendingRequestId: () => pendingWritebackRequestId.value,
  notify: showToast,
});

function getFactRecord() {
  return {
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    pastMedicalHistory: pastMedicalHistory.value,
    personalHistory: personalHistory.value,
    menstrualHistory: isFemalePatient.value ? menstrualHistory.value : '',
    familyHistory: familyHistory.value,
    physicalExam: physicalExam.value,
  };
}

function getFactRecordFieldValue(field: ClinicalRecordFactField): string {
  return getFactRecord()[field];
}

function setFactRecordFieldValue(field: ClinicalRecordFactField, value: string): void {
  if (field === 'historyOfPresentIllness') historyOfPresentIllness.value = value;
  else if (field === 'pastMedicalHistory') pastMedicalHistory.value = value;
  else if (field === 'personalHistory') personalHistory.value = value;
  else if (field === 'familyHistory') familyHistory.value = value;
  else physicalExam.value = value;
}

function mergeFactSuggestionIntoRecord(suggestion: ClinicalRecordFactSuggestion): boolean {
  const currentValue = getFactRecordFieldValue(suggestion.field);
  const nextValue = mergeClinicalRecordSuggestionIntoText(currentValue, suggestion);
  const baselineValue = getRecordFieldOriginalValue(suggestion.field);
  const nextBaseline = mergeClinicalRecordSuggestionIntoText(baselineValue, suggestion);
  if (nextBaseline !== baselineValue) {
    setInitialRecordFieldValue(suggestion.field, nextBaseline);
  }
  if (nextValue === currentValue) return false;
  setFactRecordFieldValue(suggestion.field, nextValue);
  return true;
}

const recordFactConfirmation = useClinicalRecordFactConfirmation({
  getRecord: getFactRecord,
  getDiagnoses: () => formalDiagnoses.value,
  getNegativeSymptoms: () => props.intentResult?.negativeSymptoms || [],
  getPositiveSymptoms: () => props.intentResult?.symptoms || [],
  request: async ({ record, diagnoses, explicitFacts }) => {
    const requestSpec = buildClinicalRecordFactSuggestionRequest({
      channel: resultChannel.value,
      consultationId: resolveConsultationId(),
      patient: {
        gender: patientGender.value,
        age: patientAge.value,
      },
      record,
      diagnoses,
      explicitFacts,
    });
    return chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
  },
  formatError: (error) => formatUserFacingError(error, {
    context: '病历补问分析失败',
    fallback: '请稍后重试，当前病历内容不会受到影响。',
  }),
  notify: showToast,
  mergeSuggestionIntoRecord: mergeFactSuggestionIntoRecord,
  onRecordChanged: () => refreshWritebackScope(),
});
const {
  suggestions: factSuggestions,
  generateSuggestions: generateFactSuggestions,
  getFieldHighlights: getRecordFieldFactHighlights,
  getFieldSuggestions: getRecordFieldFactSuggestions,
  dismissSuggestion: dismissFactSuggestion,
  reset: resetFactConfirmationState,
  restoreSuggestions: restoreFactSuggestions,
} = recordFactConfirmation;
const hasPendingFactSuggestions = computed(() => (
  factSuggestions.value.some((item) => item.status === 'pending')
));
const factSuggestionScheduler = useClinicalRecordFactSuggestionScheduler({
  isAllowed: () => allowsPostResultFactSuggestions.value,
  isBlocked: () => isResultUnavailable.value,
  getSuggestionCount: () => factSuggestions.value.length,
  generate: generateFactSuggestions,
});
const {
  reset: resetFactSuggestionScheduler,
  schedule: scheduleFactSuggestionGeneration,
} = factSuggestionScheduler;

function resetFactConfirmation(): void {
  resetFactSuggestionScheduler();
  resetFactConfirmationState();
}

const chronicRefillReview = useChronicRefillReview({
  getHistoryOfPresentIllness: () => historyOfPresentIllness.value,
  setHistoryOfPresentIllness: (value) => { historyOfPresentIllness.value = value; },
  getTreatments: () => treatments.value,
  notify: showToast,
});
const {
  expanded: chronicRefillReviewExpanded,
  plan: chronicRefillReviewPlan,
  reviewedCount: chronicRefillReviewedCount,
  selections: chronicRefillReviewSelections,
  treatmentReviewTriggered: chronicRefillTreatmentReviewTriggered,
  reset: resetChronicRefillReview,
  select: selectChronicRefillReview,
  setExpanded: setChronicRefillReviewExpanded,
} = chronicRefillReview;

const writebackScopeController = useClinicalResultWritebackScope({
  getRecord: () => ({
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    pastMedicalHistory: pastMedicalHistory.value,
    personalHistory: personalHistory.value,
    menstrualHistory: isFemalePatient.value ? menstrualHistory.value : '',
    familyHistory: familyHistory.value,
    physicalExam: physicalExam.value,
    precautions: precautions.value,
  }),
  getSelectedDiagnosisCount: () => selectedDiagnoses.value.length,
  getSelectedTreatments: () => selectedTreatments.value,
  notify: showToast,
});
const {
  selectorOpen: writebackScopeOpen,
  recordExpanded: writebackRecordExpanded,
  recordFieldOptions: writebackRecordFields,
  recordGroupChecked: writebackRecordGroupChecked,
  recordGroupIndeterminate: writebackRecordGroupIndeterminate,
  recordSelectionSummary: writebackRecordSelectionSummary,
  availableRecordFieldCount: writebackAvailableRecordFieldCount,
  selectedRecordFieldCount: writebackSelectedRecordFieldCount,
  selectedDiagnosisCount: writebackDiagnosisCount,
  selectedMedicineCount: writebackMedicineCount,
  selectedClinicalOrderCount: writebackClinicalOrderCount,
  diagnosisAvailable: writebackDiagnosisAvailable,
  medicineAvailable: writebackMedicineAvailable,
  clinicalOrdersAvailable: writebackClinicalOrdersAvailable,
  includeDiagnosis: writebackIncludeDiagnosis,
  includeMedicine: writebackIncludeMedicine,
  includeClinicalOrders: writebackIncludeClinicalOrders,
  selectedOptionCount: writebackSelectedOptionCount,
  availableOptionCount: writebackAvailableOptionCount,
  hasAnySelection: hasWritebackSelection,
  allAvailableSelected: allWritebackContentSelected,
  partialSelection: partialWritebackSelection,
  writebackScope,
  toggleSelector: toggleWritebackScope,
  closeSelector: closeWritebackScope,
  setRecordExpanded: setWritebackRecordExpanded,
  toggleRecordField: toggleWritebackRecordField,
  toggleRecordGroup: toggleWritebackRecordGroup,
  toggleDiagnosis: toggleWritebackDiagnosis,
  toggleMedicine: toggleWritebackMedicine,
  toggleClinicalOrders: toggleWritebackClinicalOrders,
  toggleAll: toggleAllWritebackContent,
  filterTreatments: filterWritebackTreatments,
  ensureSelection: ensureWritebackSelection,
  refreshAvailableContent: refreshWritebackScope,
  reset: resetWritebackScope,
  serialize: serializeWritebackScope,
  restore: restoreWritebackScope,
} = writebackScopeController;
const hasExistingOutpatientRecord = computed(() => Boolean(
  props.initialPatientData?.currentOutpatientRecordText?.trim(),
));
const creatingPartialOutpatientRecord = computed(() => (
  !hasExistingOutpatientRecord.value
  && writebackSelectedRecordFieldCount.value > 0
  && writebackSelectedRecordFieldCount.value < writebackAvailableRecordFieldCount.value
));
function buildPreferenceContext(sceneSuffix: string) {
  return buildChannelPreferenceContext(resolveConsultationId(), sceneSuffix);
}

// ---- 编辑器快照（用于跨会话恢复全部病历，避免重新调 fetchAITreatment） ----

const editorSnapshotPersistence = useVoiceEditorSnapshotPersistence({
  getPatient: () => props.initialPatientData,
  shouldPersist: () => shouldUseVoiceCache.value && !suppressDiagnosisTreatmentRefetch.value,
  getSnapshot: () => ({
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    pastMedicalHistory: pastMedicalHistory.value,
    personalHistory: personalHistory.value,
    menstrualHistory: isFemalePatient.value ? menstrualHistory.value : '',
    familyHistory: familyHistory.value,
    physicalExam: physicalExam.value,
    precautions: precautions.value,
    factSuggestions: factSuggestions.value as unknown[],
    differentialDiagnosisDirection: serializeDifferentialDiagnosisDirection(),
    writebackScope: serializeWritebackScope(),
    treatments: treatments.value as unknown[],
    diagnoses: aiDiagnoses.value as unknown[],
    selectedDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
    selectedDiagnosisIdentities: selectedDiagnoses.value
      .map((item) => getDiagnosisIdentity(item))
      .filter(Boolean),
    treatmentDiagnosisKey: lastTreatmentDiagnosisKey.value,
  }),
  persist: updateVoiceConsultationCache,
});
const {
  clearPendingSnapshotPersist,
  persistEditorSnapshotImmediate,
  schedulePersistEditorSnapshot,
} = editorSnapshotPersistence;

/**
 * 从缓存快照恢复编辑器状态。覆盖 LLM intentResult 已写入的初值。
 *
 * 注意：调用方必须在 `suppressDiagnosisTreatmentRefetch.value === true` 时段调用，
 * 否则诊断/治疗的副作用 watcher 会把 treatments 清空再重拉。
 */
async function applyEditorSnapshot(snapshot: VoiceEditorSnapshot): Promise<void> {
  if (typeof snapshot.chiefComplaint === 'string') {
    chiefComplaint.value = snapshot.chiefComplaint;
  }
  if (typeof snapshot.historyOfPresentIllness === 'string') {
    historyOfPresentIllness.value = snapshot.historyOfPresentIllness;
  }
  if (typeof snapshot.pastMedicalHistory === 'string') {
    pastMedicalHistory.value = snapshot.pastMedicalHistory;
  }
  if (typeof snapshot.personalHistory === 'string') {
    personalHistory.value = snapshot.personalHistory;
  }
  if (isFemalePatient.value && typeof snapshot.menstrualHistory === 'string') {
    menstrualHistory.value = snapshot.menstrualHistory;
  } else if (!isFemalePatient.value) {
    menstrualHistory.value = '';
  }
  if (typeof snapshot.familyHistory === 'string') {
    familyHistory.value = snapshot.familyHistory;
  }
  if (typeof snapshot.physicalExam === 'string') {
    physicalExam.value = snapshot.physicalExam;
  }
  if (typeof snapshot.precautions === 'string') {
    precautions.value = snapshot.precautions;
  }
  if (snapshot.differentialDiagnosisDirection) {
    restoreDifferentialDiagnosisDirection(snapshot.differentialDiagnosisDirection);
  }
  if (Array.isArray(snapshot.diagnoses) && snapshot.diagnoses.length > 0) {
    aiDiagnoses.value = snapshot.diagnoses as Diagnosis[];
    const matchedKey = snapshot.selectedDiagnosisIdentity;
    const selectedKeys = new Set(
      Array.isArray(snapshot.selectedDiagnosisIdentities)
        ? snapshot.selectedDiagnosisIdentities.filter((item): item is string => typeof item === 'string' && Boolean(item))
        : matchedKey ? [matchedKey] : [],
    );
    const target = matchedKey
      ? formalDiagnoses.value.find((diag) => getDiagnosisIdentity(diag) === matchedKey)
      : null;
    const fallback = formalDiagnoses.value.find((diag) => diag.id || diag.code) || formalDiagnoses.value[0] || null;
    const chosen = target || fallback;
    const restoredSelected = formalDiagnoses.value.filter(
      (diag) => selectedKeys.has(getDiagnosisIdentity(diag)),
    );
    replaceDiagnosisSelection(
      restoredSelected.length > 0 ? restoredSelected : chosen ? [chosen] : [],
      chosen,
    );
  }
  if (Array.isArray(snapshot.treatments) && snapshot.treatments.length > 0) {
    await fetchPharmacyOptions();
    treatments.value = snapshot.treatments as TreatmentRecommendation[];
    normalizeMedicinePharmacyValues(treatments.value);
    lastTreatmentDiagnosisKey.value =
      snapshot.treatmentDiagnosisKey || getDiagnosisIdentity(selectedDiagnosis.value);
    await reconcileAutoSelectedMedicineInventory(treatments.value);
    void registerCurrentRecommendations();
    console.info('[VoiceConsultationNew] Applied editor snapshot from cache', {
      treatmentCount: treatments.value.length,
      diagnosisIdentity: lastTreatmentDiagnosisKey.value,
    });
  }
  if (snapshot.writebackScope) {
    restoreWritebackScope(snapshot.writebackScope);
  } else {
    resetWritebackScope();
  }
  // 旧版缓存中的 AI 候选可能只存在于阅读层。先恢复医生的回写范围，再做字段迁移，
  // 这样新增的非空字段可复用统一刷新规则：默认范围自动选中，自定义范围保持医生选择。
  if (Array.isArray(snapshot.factSuggestions)) {
    restoreFactSuggestions(snapshot.factSuggestions);
  }
}

const canSubmit = computed(() => (
  !isResultUnavailable.value
  && !diagnosisLoading.value
  && !treatmentLoading.value
  && !isWritebackBusy.value
  && hasWritebackSelection.value
));

async function handleCancelConfirmed(): Promise<void> {
  clearVoiceFeedbackDraft();
  await submitVoiceAbandonedUserLog();
  emit('cancel');
}
const cancelController = useClinicalResultCancelController({
  isSubmitting: () => submitting.value,
  isWaitingWritebackFeedback: () => waitingWritebackFeedback.value,
  notify: showToast,
  onConfirm: handleCancelConfirmed,
});
const {
  showCancelConfirm,
  handleCancelClick,
  closeCancelConfirm,
  confirmCancel,
} = cancelController;

const reasonTooltipState = useReasonTooltipState();
const {
  activeReasonTooltipKey,
  closeReasonTooltip,
  closeReasonTooltipIfOpen,
  toggleReasonTooltip,
} = reasonTooltipState;
const manualMatchState = useManualMatchState();
const {
  getManualMatchKeyword,
  setManualMatchKeyword,
  isManualMatchOpen,
  openManualMatch,
  closeManualMatch,
  toggleManualMatch: toggleManualMatchState,
} = manualMatchState;
const treatmentEditorState = useTreatmentEditorState({
  getEditorKey: (rec) => getTreatmentEditorKey(rec),
  getFieldKey: (rec, field) => getEditableFieldKey(rec, field as MedicinePrimaryField),
  resetDependents: () => {
    medicineUsageSearch.resetAll();
    secondarySelector.resetAll();
  },
});
const {
  resetTreatmentEditorState,
  isTreatmentEditorExpanded,
  toggleTreatmentEditor,
  expandTreatmentEditor,
  collapseTreatmentEditor,
  shouldShowTreatmentEditor,
  registerEditableFieldElement,
  isEditableFieldActive,
  setActiveEditableField,
  clearActiveEditableField,
  focusActiveEditableField,
} = treatmentEditorState;
const treatmentQuickSelector = useTreatmentQuickSelector({
  expandTreatmentEditor,
  openSecondarySelector: (rec, field) => secondarySelector.open(rec, field),
  getEditorKey: getTreatmentEditorKey,
});
const {
  openQuickSelector,
} = treatmentQuickSelector;
const {
  recommendationSubmittingKey,
  recommendationSubmittedMap,
  ensureRecommendationDraft,
  updateRecommendationDraft,
  registerRecommendations,
  submitRecommendationFeedback,
  clearVoiceFeedbackDraft,
} = useVoiceFeedback({
  consultationId,
  patientId: computed(() => getPatientAnchorId()),
  patientName,
  chiefComplaint,
  historyOfPresentIllness,
});
const recordFieldState = useVoiceRecordFieldState({
  fields: {
    chiefComplaint,
    historyOfPresentIllness,
    pastMedicalHistory,
    personalHistory,
    familyHistory,
    physicalExam,
    precautions,
  },
});
const {
  getRecordFieldOriginalValue,
  isRecordFieldModified,
  setInitialRecordFieldValue,
  setInitialRecordSnapshot,
} = recordFieldState;
const precautionsScope = useClinicalResultPrecautionsScope({
  precautions,
  buildScopedPrecautions: (diagnosisNames) => buildDiagnosisScopedPrecautions({
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    diagnosisNames,
  }),
  setSystemBaseline: (value) => setInitialRecordFieldValue('precautions', value),
});
const {
  captureGeneratedPrecautions,
  resetPrecautionsScope,
  syncToSelectedDiagnoses: syncPrecautionsToSelectedDiagnoses,
} = precautionsScope;
const suppressPrecautionsScopeSync = ref(false);

function getDiagnosisNames(items: readonly Diagnosis[]): string[] {
  return items.map((item) => item.name?.trim()).filter(Boolean);
}

function syncPrecautionsToSelection(): void {
  syncPrecautionsToSelectedDiagnoses(getDiagnosisNames(selectedDiagnoses.value));
}
const recommendationFeedbackPopover = useRecommendationFeedbackPopover({
  ensureDraft: ensureRecommendationDraft,
  submittedMap: recommendationSubmittedMap,
});

async function registerCurrentRecommendations(): Promise<void> {
  try {
    await registerRecommendations({
      diagnoses: aiDiagnoses.value,
      treatments: treatments.value,
      selectedDiagnosis: selectedDiagnosis.value,
    });
  } catch (error) {
    console.error('[VoiceConsultationNew] Failed to register voice recommendations for feedback', error);
  }
}

function getDiagnosisFeedbackKey(diag: Diagnosis): string {
  return getDiagnosisRecommendationFeedbackKey(diag);
}

function getTreatmentFeedbackKey(rec: TreatmentRecommendation): string {
  return getTreatmentRecommendationFeedbackKey(rec);
}

function getTreatmentReasonKey(rec: TreatmentRecommendation): string {
  return getReasonTooltipKey('treatment', rec.type, rec.name);
}

function getTreatmentFeedbackDraft(rec: TreatmentRecommendation): VoiceRecommendationFeedbackDraft {
  return getRecommendationDraft(getTreatmentFeedbackKey(rec));
}

function isTreatmentFeedbackOpen(rec: TreatmentRecommendation): boolean {
  return isRecommendationFeedbackOpen(getTreatmentFeedbackKey(rec));
}

function isTreatmentFeedbackSubmitting(rec: TreatmentRecommendation): boolean {
  return recommendationSubmittingKey.value === getTreatmentFeedbackKey(rec);
}

function getTreatmentFeedbackSubmittedLabel(rec: TreatmentRecommendation): string {
  return getRecommendationSubmittedLabel(getTreatmentFeedbackKey(rec));
}

function getTreatmentIssue(rec: TreatmentRecommendation) {
  return getIssueForTreatment(rec.name);
}

function shouldShowTreatmentEditorToggle(rec: TreatmentRecommendation): boolean {
  return !requiresManualMatchBeforeSelect(rec);
}

function getRecommendationDraft(recommendationKey: string): VoiceRecommendationFeedbackDraft {
  return recommendationFeedbackPopover.getDraft(recommendationKey);
}

function getRecommendationSubmittedLabel(recommendationKey: string): string {
  return recommendationFeedbackPopover.getSubmittedLabel(recommendationKey);
}

function isRecommendationFeedbackOpen(recommendationKey: string): boolean {
  return recommendationFeedbackPopover.isOpen(recommendationKey);
}

function toggleRecommendationFeedback(recommendationKey: string, event?: Event): void {
  revealClinicalResultOverlayAnchor(event);
  recommendationFeedbackPopover.toggle(recommendationKey, event);
}

function toggleClinicalResultReasonTooltip(reasonKey: string, event?: Event): void {
  revealClinicalResultOverlayAnchor(event);
  toggleReasonTooltip(reasonKey, event);
}

function buildVoiceUserLogSnapshot() {
  return buildConsultationUserLogSnapshot({
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    pastMedicalHistory: pastMedicalHistory.value,
    personalHistory: personalHistory.value,
    menstrualHistory: isFemalePatient.value ? menstrualHistory.value : '',
    familyHistory: familyHistory.value,
    physicalExam: physicalExam.value,
    precautions: precautions.value,
    diagnoses: aiDiagnoses.value,
    selectedDiagnosis: selectedDiagnosis.value,
    treatments: treatments.value,
  });
}

const userLogController = useClinicalResultUserLogController({
  consultationId,
  consultationRoundId: () => props.consultationRoundId,
  consultationType: consultationUserLogType,
  patient: () => props.initialPatientData || null,
  buildSnapshot: buildVoiceUserLogSnapshot,
  submit: submitConsultationUserLog,
  getChangeFlags: () => ({
    pastMedicalHistoryChanged: isRecordFieldModified('pastMedicalHistory'),
    personalHistoryChanged: isRecordFieldModified('personalHistory'),
    familyHistoryChanged: isRecordFieldModified('familyHistory'),
    physicalExamChanged: isRecordFieldModified('physicalExam'),
    precautionsChanged: isRecordFieldModified('precautions'),
  }),
});
const {
  resetFirstSnapshot: resetFirstUserLogSnapshot,
  submitGeneratedUserLog: submitVoiceGeneratedUserLog,
  submitFinalUserLog: submitVoiceFinalUserLog,
  submitAbandonedUserLog: submitVoiceAbandonedUserLog,
} = userLogController;

const {
  completeVoiceConsultationFlow,
  handleDiagnosisFeedbackSubmit,
  handleTreatmentFeedbackSubmit,
} = useVoiceFeedbackActions({
  isDiagnosisSelected,
  isPrimaryDiagnosis,
  submitRecommendationFeedback,
  closeRecommendationFeedback: () => {
    recommendationFeedbackPopover.close();
  },
  clearVoiceFeedbackDraft,
  clearWritebackFeedback: clearLastFeedback,
  closeResult: () => {
    emit('close');
  },
  notify: showToast,
});

const writebackFeedbackController = useWritebackFeedbackController({
  applyFeedback: applyWritebackFeedbackStatus,
  notify: showToast,
  onSuccess: (payload) => {
    console.info('[VoiceConsultationNew] Complete result flow after writeback success', {
      requestId: payload.requestId,
      consultationId: payload.consultationId,
    });
    persistEditorSnapshotImmediate();
    submitVoiceFinalUserLog();
    completeVoiceConsultationFlow();
  },
});
const {
  applyWritebackFeedback,
} = writebackFeedbackController;

function getCurrentRecordSummaryInput(): ClinicalResultRecordSummaryInput {
  return {
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
  };
}

function buildDiagnosisRationale(matchedDiagnosis: MatchedDiagnosis, displayName: string): string {
  return buildSharedDiagnosisRationale(matchedDiagnosis, displayName, getCurrentRecordSummaryInput());
}

function buildTreatmentReason(item: MatchedTreatment, name: string): string {
  return buildSharedTreatmentReason(item, name, getCurrentRecordSummaryInput());
}

function getEditableFieldKey(rec: TreatmentRecommendation, field: MedicinePrimaryField): string {
  return getTreatmentEditorFieldKey(rec, field);
}

// 频次/给药途径推断需要使用 reactive 字典选项，封装为本地包装函数
function inferFrequencyFromText(text: string): string {
  return inferFrequencyFromTextPure(text, frequencyOptions.value);
}

function inferRouteFromText(text: string): string {
  return inferRouteFromTextPure(text, routeOptions.value);
}

// 治疗项归一化：薄包装委托给 useTreatmentNormalization composable，
// composable 实例（treatmentNormalization）在 useMedicalDictionaries 之后初始化。
// 函数声明会被 hoist，调用时机均晚于 composable 实例化，所以引用安全。
function normalizeTreatmentRecommendation(rec: Partial<TreatmentRecommendation>): TreatmentRecommendation {
  return treatmentNormalization.normalize(rec);
}

function initDiagnosesFromIntent(matched: MatchedDiagnosis[]): Diagnosis[] {
  return initClinicalDiagnoses(matched, {
    buildRationale: buildDiagnosisRationale,
  });
}

function initTreatmentsFromIntent(matched: MatchedTreatment[]): TreatmentRecommendation[] {
  return initClinicalTreatments(matched, {
    assessCatalogMatch: assessTreatmentCatalogMatch,
    inferFrequency: inferFrequencyFromText,
    inferRoute: inferRouteFromText,
    normalize: normalizeTreatmentRecommendation,
    buildReason: buildTreatmentReason,
    shouldAutoSelect: shouldAutoSelectTreatment,
  });
}

function normalizeIntentKeyPart(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function invalidateTreatmentRequests(): void {
  treatmentRequestSeq.value += 1;
  treatmentLoading.value = false;
  finishTreatmentGeneration();
}

function invalidateDiagnosisRequests(): void {
  diagnosisRequestSeq.value += 1;
  finishDiagnosisGeneration();
}

function buildTreatmentAutoFetchKey(diagnosisIdentity: string): string {
  return `${patientAnchorId.value || 'unknown'}|${diagnosisIdentity}`;
}

function buildIntentDiagnosisKey(item: ClinicalResultInput['diagnoses'][number]): string {
  const inherited = item as Partial<Diagnosis>;
  const matched = item.matchedItem;
  return [
    matched?.id,
    matched?.code,
    matched?.name,
    inherited.id,
    item.code,
    item.name,
    inherited.rate,
    item.confidence,
    inherited.suggestionType,
    inherited.missingInformation,
  ].map(normalizeIntentKeyPart).join('~');
}

function buildIntentTreatmentKey(item: ClinicalResultInput['treatments'][number]): string {
  const inherited = item as Partial<TreatmentRecommendation>;
  const matched = inherited.matchedItem || item.matchedItem;
  const suggested = inherited.suggestedMatchItem;
  return [
    item.type,
    item.name,
    inherited.originalName,
    matched?.id,
    matched?.name,
    matched?.spec,
    suggested?.id,
    suggested?.name,
    inherited.matchStatus,
    inherited.selected,
    inherited.rejected,
    inherited.manualMatched,
    item.spec,
    item.frequency,
    item.frequencyKey,
    item.usage,
    item.usageKey,
    item.dosage,
    item.dosageUnit,
    item.totalQty,
    item.totalUnit,
    item.days,
    inherited.pharmacy,
    inherited.pharmacyCleared,
    inherited.execDept,
    inherited.execDeptCleared,
    inherited.insuranceType,
    inherited.insuranceCleared,
    inherited.bodySite,
    inherited.bodySiteId,
  ].map(normalizeIntentKeyPart).join('~');
}

function buildIntentResultKey(result: ClinicalResultInput | VoiceIntentResult): string {
  return JSON.stringify({
    channel: resultChannel.value,
    source: props.intentSource || '',
    patient: patientAnchorId.value,
    record: {
      chiefComplaint: normalizeIntentKeyPart(result.chiefComplaint),
      historyOfPresentIllness: normalizeIntentKeyPart(result.historyOfPresentIllness),
      pastMedicalHistory: normalizeIntentKeyPart(result.pastMedicalHistory),
      personalHistory: normalizeIntentKeyPart(result.outpatientRecord?.personalHistory),
      menstrualHistory: normalizeIntentKeyPart(result.outpatientRecord?.menstrualHistory || result.menstrualHistory),
      familyHistory: normalizeIntentKeyPart(result.outpatientRecord?.familyHistory || result.familyHistory),
      physicalExam: normalizeIntentKeyPart(result.outpatientRecord?.physicalExam),
      precautions: normalizeIntentKeyPart(result.outpatientRecord?.precautions),
    },
    diagnoses: result.diagnoses.map(buildIntentDiagnosisKey),
    treatments: result.treatments.map(buildIntentTreatmentKey),
    factSuggestions: result.factSuggestions,
    chronicRefillReview: result.chronicRefillReview,
    recommendationPolicy: result.recommendationPolicy,
    generation: result.generation
      ? {
        status: result.generation.status,
        readySections: result.generation.readySections,
      }
      : undefined,
  });
}

function getAllowedIntentTreatments(result: ClinicalResultInput): ClinicalResultInput['treatments'] {
  const allowed = result.recommendationPolicy?.allowedTreatmentTypes;
  if (!allowed) return result.treatments;
  return result.treatments.filter((item) => item.sourceType === 'explicit' || allowed.includes(item.type));
}

function getManualMatchPickerCandidates(rec: TreatmentRecommendation): ManualMatchCandidate[] {
  return getManualMatchCandidates(rec).map(toManualMatchCandidateView);
}

function handleManualMatchPickerSelect(rec: TreatmentRecommendation, candidate: ManualMatchCandidate): void {
  const raw = getManualMatchCandidates(rec).find((item) => item.id === candidate.id);
  if (!raw) {
    return;
  }
  void applyManualMatch(rec, raw);
}

function requiresManualMatchBeforeSelect(rec: TreatmentRecommendation): boolean {
  return !rec.matchedItem;
}

function toggleManualMatch(rec: TreatmentRecommendation, event?: Event): void {
  event?.stopPropagation();
  closeReasonTooltipIfOpen();
  toggleManualMatchState(rec);
}

function getManualMatchCandidates(rec: TreatmentRecommendation): ManualMatchRawCandidate[] {
  return findManualMatchCandidates(rec, getManualMatchKeyword(rec));
}

// 部位选项落地：来自 HIS `fetchMedicalItemPartOptions(idCli)`，统一在 useBodySiteOptions 内处理。
const { applyMedicalItemPartOption, applyMedicalItemPartOptions } = useBodySiteOptions();

// 药品 / 非药品明细 hydrate 已抽到 useTreatmentHydration；
// 语音侧通过 applyMedicalItemPartOptions / afterMedicalItemHydrated 注入检查部位与执行科室同步副作用。

async function confirmSuggestedMatch(rec: TreatmentRecommendation, event?: Event): Promise<void> {
  event?.stopPropagation();
  if (!rec.suggestedMatchItem) {
    return;
  }

  const sourceName = rec.originalName || rec.name;
  rec.originalName = sourceName;
  rec.matchedItem = { ...rec.suggestedMatchItem };
  rec.name = rec.suggestedMatchItem.name || rec.name;
  rec.matchStatus = 'confirmed';
  rec.manualMatched = false;
  rec.selected = false;
  rec.pharmacyCleared = false;
  rec.execDeptCleared = false;
  rec.insuranceCleared = false;
  rec.suggestedMatchItem = undefined;
  rememberManualCatalogMatch(rec.type, sourceName, rec.matchedItem);

  if (!(await ensureTreatmentSelectable(rec, {
    medicineUnavailableMessage: `${rec.name} 已确认匹配，但当前药房无药品详情，暂不能选中`,
  }))) {
    return;
  }

  rec.selected = true;
  rec.rejected = false;
  collapseTreatmentEditor(rec);
  trackTreatmentMatchPreference(rec, 'confirm_match', buildPreferenceContext('treatment'));

  showToast?.(`${rec.name} 已确认匹配`, 'success');
}

async function applyManualMatch(rec: TreatmentRecommendation, candidate: ManualMatchRawCandidate, event?: Event): Promise<void> {
  event?.stopPropagation();

  if (!applyManualMatchCandidate(rec, candidate)) {
    return;
  }
  rec.pharmacyCleared = false;
  rec.execDeptCleared = false;
  rec.insuranceCleared = false;

  if (!(await ensureTreatmentSelectable(rec, {
    labelName: candidate.name,
    medicineUnavailableMessage: `${candidate.name} 已完成标准库匹配，但当前药房无药品详情，暂不能选中`,
  }))) {
    return;
  }

  rec.selected = true;
  rec.rejected = false;
  collapseTreatmentEditor(rec);
  trackTreatmentMatchPreference(rec, 'manual_match', buildPreferenceContext('treatment'));
  closeManualMatch();
  showToast?.(`${candidate.name} 已完成标准库匹配`, 'success');
}

async function toggleTreatment(item: TreatmentRecommendation): Promise<void> {
  closeReasonTooltipIfOpen();
  if (item.rejected) {
    item.rejected = false;
  }
  if (!item.selected && requiresManualMatchBeforeSelect(item)) {
    if (hasProbableMatch(item)) {
      showToast?.('该推荐存在候选标准项，请先确认匹配或改为手动匹配', 'warning');
      return;
    }
    openManualMatch(item);
    showToast?.('该推荐尚未匹配标准库，请先手动匹配', 'warning');
    return;
  }
  const nextSelected = !item.selected;

  if (nextSelected && !(await ensureTreatmentSelectable(item, {
    showMedicineUnavailableWarning: true,
    pharmacyMissingMessage: '当前发药药房不可用，请选择实际拥有该药品的药房后再选中',
    execDeptMissingMessage: '请先设置执行科室后再选中该项目',
    bodySiteMissingMessage: '请先设置检查部位后再选中该项目',
    hydrateNonMedicine: item.type !== 'medicine',
  }))) {
    focusFirstMissingMedicinePrimaryField(item);
    return;
  }

  item.selected = nextSelected;
  if (nextSelected) {
    item.rejected = false;
  }
  if (nextSelected) {
    collapseTreatmentEditor(item);
  }
}

function toggleTreatmentRejected(item: TreatmentRecommendation, event?: Event): void {
  event?.stopPropagation();
  if (item.type !== 'medicine') return;

  item.rejected = !item.rejected;
  item.selected = false;
  closeManualMatch();
  collapseTreatmentEditor(item);
  clearMedicineInventoryWarning(item);
  showToast?.(item.rejected ? `已标记不采用：${item.name}` : `已恢复药品推荐：${item.name}`, 'info');
}

function focusFirstMissingMedicinePrimaryField(item: TreatmentRecommendation): void {
  if (item.type !== 'medicine') return;

  expandTreatmentEditor(item);
  if (!hasRequiredPharmacy(item)) {
    openPharmacyQuickSelector(item);
    return;
  }

  const normalized = normalizeTreatmentRecommendation(item);
  const dosage = Number((normalized.dosage || '').trim());
  const totalQty = Number((normalized.totalQty || '').trim());
  let field: MedicinePrimaryField | null = null;

  if (!Number.isFinite(dosage) || dosage <= 0 || !(normalized.dosageUnit || '').trim()) {
    field = 'dosage';
  } else if (!(normalized.frequencyKey || '').trim()) {
    field = 'frequency';
  } else if (!(normalized.routeKey || '').trim()) {
    field = 'route';
  } else if (!Number.isFinite(totalQty) || totalQty <= 0) {
    field = 'total';
  }

  if (field) {
    setActiveEditableField(item, field);
    focusActiveEditableField();
    return;
  }

  if (!Number.isFinite(Number((normalized.days || '').trim())) || Number((normalized.days || '').trim()) <= 0) {
    void nextTick(() => {
      const editorKey = getTreatmentEditorKey(item);
      const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-treatment-days-input]'))
        .find((element) => element.dataset.treatmentDaysInput === editorKey);
      input?.focus();
      input?.select();
    });
    return;
  }

  if (!(normalized.insuranceType || '').trim()) {
    openInsuranceQuickSelector(item);
  }
}

function toggleDiagnosis(diag: Diagnosis): void {
  closeReasonTooltipIfOpen();
  toggleDiagnosisSelection(diag);
}

function includeDifferentialDirection(diag: Diagnosis): void {
  includeDifferentialDiagnosisDirection(getDiagnosisSuggestionDirectionKey(diag));
  persistEditorSnapshotImmediate();
}

function removeDifferentialDirection(diag: Diagnosis): void {
  removeDifferentialDiagnosisDirection(getDiagnosisSuggestionDirectionKey(diag));
  persistEditorSnapshotImmediate();
}

function openGeneralSupplementDialog(): void {
  supplementGuidance.value = '';
  showSupplementDialog.value = true;
}

function closeSupplementDialog(): void {
  showSupplementDialog.value = false;
  supplementGuidance.value = '';
}

function supplementDifferentialDirection(diag: Diagnosis): void {
  includeDifferentialDirection(diag);
  const missingInformation = diag.missingInformation?.trim()
    || '与该方向相关的症状特征、持续时间、查体或检查结果';
  supplementGuidance.value = `当前关注方向：${diag.name}。建议重点补充：${missingInformation}`;
  showSupplementDialog.value = true;
}

async function promoteDifferentialToFormal(diag: Diagnosis): Promise<void> {
  const originalDirectionKey = getDiagnosisSuggestionDirectionKey(diag);
  const assessment = getStandardDiagnosisId(diag)
    ? null
    : medicalDataService.assessDiagnosisMatch(
        diag.originalName || diag.name,
        diag.code ? { icdCode: diag.code } : undefined,
      );
  const standardMatch = assessment?.matchedItem || assessment?.suggestedMatchItem || null;

  if (!getStandardDiagnosisId(diag) && !standardMatch) {
    showToast?.(`${diag.name} 未匹配院内标准诊断库，暂不能转为正式诊断`, 'warning');
    return;
  }

  const promotedDiagnosis: Diagnosis = standardMatch
    ? {
        ...diag,
        id: standardMatch.id,
        code: standardMatch.code,
        name: standardMatch.name,
        originalName: diag.originalName || diag.name,
        catalogMatchStatus: assessment?.status === 'compatible' ? 'confirmed' : 'exact',
        suggestedMatchItem: assessment?.status === 'compatible' ? standardMatch : null,
        catalogMatchReason: assessment?.status === 'compatible'
          ? '医生转入正式诊断时确认标准库近似项'
          : assessment?.reason,
      }
    : diag;
  const diagnosisIndex = aiDiagnoses.value.findIndex(
    (item) => getDiagnosisSuggestionDirectionKey(item) === originalDirectionKey,
  );
  if (diagnosisIndex < 0) return;

  aiDiagnoses.value[diagnosisIndex] = promotedDiagnosis;
  const promotedDirectionKey = getDiagnosisSuggestionDirectionKey(promotedDiagnosis);
  promoteDifferentialDiagnosisDirection(originalDirectionKey, promotedDirectionKey);
  await nextTick();

  const formalDiagnosis = formalDiagnoses.value.find(
    (item) => getDiagnosisSuggestionDirectionKey(item) === promotedDirectionKey,
  );
  if (!formalDiagnosis) return;

  const primaryDiagnosis = selectedDiagnosis.value;
  const formalIdentity = getDiagnosisIdentity(formalDiagnosis);
  const nextSelectedDiagnoses = selectedDiagnoses.value.some(
    (item) => getDiagnosisIdentity(item) === formalIdentity,
  )
    ? [...selectedDiagnoses.value]
    : [...selectedDiagnoses.value, formalDiagnosis];
  const previousTreatmentRefetchSuppression = suppressDiagnosisTreatmentRefetch.value;
  suppressDiagnosisTreatmentRefetch.value = true;
  try {
    replaceDiagnosisSelection(
      nextSelectedDiagnoses,
      primaryDiagnosis || formalDiagnosis,
    );
    await nextTick();
  } finally {
    suppressDiagnosisTreatmentRefetch.value = previousTreatmentRefetchSuppression;
  }
  refreshWritebackScope();
  persistEditorSnapshotImmediate();
  void registerCurrentRecommendations();
  void performDiagnosisFactCheck([formalDiagnosis]);
  showToast?.(
    primaryDiagnosis
      ? `已将 ${formalDiagnosis.name} 转为正式次诊断，原主诊断保持不变`
      : `已将 ${formalDiagnosis.name} 转为正式主诊断`,
    'success',
  );
}

async function handleDiagnosisDifferential(diag: Diagnosis, event?: Event): Promise<void> {
  event?.stopPropagation();
  revealClinicalResultOverlayAnchor(event);
  closeReasonTooltipIfOpen();
  await openDiagnosisChecklist(diag);
}

function handleCloseDiagnosisDifferential(diag: Diagnosis, event?: Event): void {
  event?.stopPropagation();
  closeDiagnosisChecklist(diag);
}

function setPrimaryDiagnosis(diag: Diagnosis, event?: Event): void {
  event?.stopPropagation();
  setPrimaryDiagnosisSelection(diag);
}

function removeDiagnosis(diag: Diagnosis, event?: Event): void {
  event?.stopPropagation();
  removeDiagnosisSelection(diag);
}

useOutsideInteraction({
  eventName: 'pointerdown',
  targets: [
    {
      isActive: activeReasonTooltipKey,
      selectors: ['.reason-tooltip-trigger'],
      onOutside: closeReasonTooltip,
    },
    {
      isActive: () => Boolean(recommendationFeedbackPopover.activeKey.value),
      selectors: ['.voice-feedback-anchor'],
      onOutside: recommendationFeedbackPopover.close,
    },
    {
      isActive: () => Boolean(secondarySelector.activeKey.value?.endsWith(':pharmacy')),
      selectors: ['.pharmacy-chip-anchor'],
      onOutside: () => secondarySelector.closeAll(),
    },
  ],
});

useConsultationReferenceFeedbackListener<ReferenceFeedbackPayload>({
  resolveConsultationId,
  logContext: 'VoiceConsultationNew',
  onFeedback: (payload) => {
    console.info('[VoiceConsultationNew] Received writeback feedback', {
      requestId: payload.requestId,
      consultationId: payload.consultationId,
      status: payload.status,
      action: payload.action,
      referenceType: payload.referenceType,
    });
    if (mutualRecognition.handleFeedback(payload)) return;
    applyWritebackFeedback(payload);
  },
});

async function fetchAIDiagnosis(
  options: {
    notifyOnError?: boolean;
    deferSideEffects?: boolean;
    requestMode?: Exclude<ClinicalResultDiagnosisRequestMode, 'idle'>;
  } = {},
): Promise<boolean> {
  if (diagnosisLoading.value) return false;
  if (!canRefreshDiagnosis.value) {
    showToast?.('请先填写主诉或现病史', 'warning');
    return false;
  }
  const requestMode = options.requestMode || 'manual-refresh';
  if (!beginDiagnosisGeneration(requestMode)) return false;

  const requestSeq = diagnosisRequestSeq.value + 1;
  diagnosisRequestSeq.value = requestSeq;
  const requestRecordKey = [
    patientAnchorId.value,
    chiefComplaint.value,
    historyOfPresentIllness.value,
  ].join('|');
  try {
    const requestSpec = buildClinicalResultDiagnosisRequestSpec({
      patientName: patientName.value,
      gender: patientGender.value,
      age: patientAge.value,
      chiefComplaint: chiefComplaint.value,
      historyOfPresentIllness: historyOfPresentIllness.value,
    }, PROMPTS.consultation.diagnosisRecommendation, {
      consultationId: resolveConsultationId(),
    });

    const response = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
    const parsed = parseLLMJson<Diagnosis[]>(response);
    const currentRecordKey = [
      patientAnchorId.value,
      chiefComplaint.value,
      historyOfPresentIllness.value,
    ].join('|');
    if (requestSeq !== diagnosisRequestSeq.value || requestRecordKey !== currentRecordKey) {
      console.info('[VoiceConsultationNew] Ignore stale diagnosis response', {
        requestSeq,
        latest: diagnosisRequestSeq.value,
        requestRecordKey,
        currentRecordKey,
      });
      return false;
    }

    aiDiagnoses.value = await applyRecommendationPreferenceRanking(
      mapClinicalResultAiDiagnoses({
        rawDiagnoses: parsed,
        assessDiagnosis: (query, context) => medicalDataService.assessDiagnosisMatch(query, context),
      }),
      buildDiagnosisPreferenceCandidate,
      buildPreferenceContext('diagnosis'),
    );

    if (formalDiagnoses.value.length > 0) {
      replaceDiagnosisSelection([formalDiagnoses.value[0]], formalDiagnoses.value[0]);
    } else {
      resetDiagnosisSelection();
    }
    if (!suppressPrecautionsScopeSync.value) {
      syncPrecautionsToSelection();
    }
    resetFactConfirmation();

    if (!options.deferSideEffects) {
      void registerCurrentRecommendations();
      void performDiagnosisFactCheck(formalDiagnoses.value);
      scheduleFactSuggestionGeneration();
    }
    return formalDiagnoses.value.length > 0;
  } catch (error: unknown) {
    if (options.notifyOnError !== false) {
      showToast?.(formatUserFacingError(error, {
        context: '诊断推荐失败',
        fallback: '请稍后重试。',
      }), 'error');
    }
    return false;
  } finally {
    if (requestSeq === diagnosisRequestSeq.value) {
      finishDiagnosisGeneration(requestMode);
    }
  }
}

async function handleDiagnosisRefresh(event?: Event): Promise<void> {
  event?.stopPropagation();
  closeReasonTooltipIfOpen();
  closeRelatedDropdown();
  recommendationFeedbackPopover.close();
  await fetchAIDiagnosis({ requestMode: 'manual-refresh' });
}

async function fetchAITreatment(
  options: { notifyOnError?: boolean; requireAll?: boolean; deferSideEffects?: boolean } = {},
): Promise<boolean> {
  if (treatmentLoading.value || !selectedDiagnosis.value || !allowTreatmentRefresh.value) return false;

  const requestSeq = treatmentRequestSeq.value + 1;
  treatmentRequestSeq.value = requestSeq;
  const requestPatientAnchorId = patientAnchorId.value;
  const requestDiagnosis = selectedDiagnosis.value;
  const diagnosisIdentity = getDiagnosisIdentity(requestDiagnosis);
  if (!diagnosisIdentity) {
    return false;
  }
  const isCurrentTreatmentRequest = () => (
    requestSeq === treatmentRequestSeq.value
    && requestPatientAnchorId === patientAnchorId.value
    && diagnosisIdentity === getDiagnosisIdentity(selectedDiagnosis.value)
  );

  treatmentLoading.value = true;
  beginTreatmentGeneration(diagnosisIdentity);

  console.info('[VoiceConsultationNew] Fetching treatment recommendations', {
    requestSeq,
    patientAnchorId: requestPatientAnchorId,
    diagnosisIdentity,
    diagnosisName: requestDiagnosis.name,
    existingTreatmentCount: treatments.value.length,
  });

  const baseParams = {
    patientName: patientName.value,
    gender: patientGender.value,
    age: patientAge.value,
    diagnosisName: requestDiagnosis.name,
    diagnosisCode: requestDiagnosis.code,
    chiefComplaint: chiefComplaint.value,
  };
  const requestedTypes = resolveRequestedTreatmentTypes();
  if (requestedTypes.length === 0) {
    lastTreatmentDiagnosisKey.value = diagnosisIdentity;
    treatmentLoading.value = false;
    finishTreatmentGeneration(diagnosisIdentity);
    return true;
  }
  requestedTypes.forEach((type) => {
    treatmentGenerationState.value[type] = 'loading';
  });
  const stagedRecommendations: TreatmentRecommendation[] = [];
  const commitBranchesIncrementally = treatmentGenerationIsInitial.value
    && !treatments.value.some((item) => !isDoctorOwnedTreatment(item));

  try {
    if (requestedTypes.includes('medicine')) {
      await fetchPharmacyOptions();
    }
    if (!isCurrentTreatmentRequest()) return false;
    await generateVoiceTreatmentRecommendations({
      ...baseParams,
      clinicalContext: historyOfPresentIllness.value,
      requestedTypes,
      explicitTreatments: treatments.value.filter((item) => item.sourceType === 'explicit'),
      pharmacies: pharmacyOptions.value,
      consultationId: resolveConsultationId(),
      normalize: normalizeTreatmentRecommendation,
      onTaskResult: async (task) => {
        if (!isCurrentTreatmentRequest()) return;
        if (task.error) {
          task.types.forEach((type) => { treatmentGenerationState.value[type] = 'error'; });
          console.warn('[VoiceConsultationNew] Treatment recommendation task failed', {
            key: task.key,
            error: task.error instanceof Error ? task.error.message : String(task.error),
          });
          return;
        }
        const ranked = await applyRecommendationPreferenceRanking(
          task.items,
          buildTreatmentPreferenceCandidate,
          buildPreferenceContext(`treatment-${task.key}`),
        );
        if (!isCurrentTreatmentRequest()) return;
        stagedRecommendations.push(...ranked);
        task.types.forEach((type) => { treatmentGenerationState.value[type] = 'ready'; });
        if (commitBranchesIncrementally) {
          const nextTreatments = mergeGeneratedTreatmentBranches(
            treatments.value,
            task.types,
            ranked,
          );
          if (task.types.includes('medicine')) {
            await reconcileAutoSelectedMedicineInventory(nextTreatments);
          }
          if (!isCurrentTreatmentRequest()) return;
          treatments.value = nextTreatments;
        }
      },
    });

    if (!isCurrentTreatmentRequest()) return false;
    if (options.requireAll) {
      const failedTypes = requestedTypes.filter(
        (type) => treatmentGenerationState.value[type] === 'error',
      );
      if (failedTypes.length > 0) {
        throw new Error('部分治疗方案生成失败');
      }
    }
    // 各目录请求并行完成；普通语音首次生成已经按分支原子落位，
    // 此处再做一次确定性合并。手动刷新仍只在全部完成后替换旧方案。
    const requestedOrder = new Map(requestedTypes.map((type, index) => [type, index]));
    const generated = stagedRecommendations
      .sort((left, right) => (
        (requestedOrder.get(left.type as ClinicalResultRecommendationType) ?? requestedTypes.length)
        - (requestedOrder.get(right.type as ClinicalResultRecommendationType) ?? requestedTypes.length)
      ));
    treatments.value = mergeGeneratedTreatmentBranches(
      treatments.value,
      requestedTypes,
      generated,
    );
    const nextTreatments = treatments.value;

    console.info('[VoiceConsultationNew] Treatment recommendations loaded', {
      requestSeq,
      diagnosisIdentity,
      totalCount: nextTreatments.length,
      medicineCount: nextTreatments.filter((item) => item.type === 'medicine').length,
      medicineWithDosageCount: nextTreatments.filter((item) => item.type === 'medicine' && !!item.dosage).length,
      medicineWithDaysCount: nextTreatments.filter((item) => item.type === 'medicine' && !!item.days).length,
      medicineWithTotalQtyCount: nextTreatments.filter((item) => item.type === 'medicine' && !!item.totalQty).length,
    });

    if (!isCurrentTreatmentRequest()) {
      console.info('[VoiceConsultationNew] Ignore stale treatment response after parsing', {
        requestSeq,
        latest: treatmentRequestSeq.value,
        requestPatientAnchorId,
        currentPatientAnchorId: patientAnchorId.value,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return false;
    }

    lastTreatmentDiagnosisKey.value = diagnosisIdentity;
    autoTreatmentFetchAttemptKey.value = buildTreatmentAutoFetchKey(diagnosisIdentity);
    await reconcileAutoSelectedMedicineInventory(treatments.value);
    if (!options.deferSideEffects) {
      void registerCurrentRecommendations();
      void performTreatmentFactCheck(treatments.value);
      submitVoiceGeneratedUserLog();
      // 把 LLM 推荐的诊疗方案写回缓存，下次同就诊恢复时直接复用、跳过 fetchAITreatment
      persistEditorSnapshotImmediate();
    }
    return true;
  } catch (error: unknown) {
    if (!isCurrentTreatmentRequest()) {
      console.info('[VoiceConsultationNew] Ignore stale treatment error', {
        requestSeq,
        latest: treatmentRequestSeq.value,
        requestPatientAnchorId,
        currentPatientAnchorId: patientAnchorId.value,
        diagnosisIdentity,
        currentDiagnosisIdentity: getDiagnosisIdentity(selectedDiagnosis.value),
      });
      return false;
    }
    if (options.notifyOnError !== false) {
      showToast?.(formatUserFacingError(error, {
        context: '方案推荐失败',
        fallback: '请稍后重试。',
      }), 'error');
    }
    return false;
  } finally {
    if (requestSeq === treatmentRequestSeq.value) {
      treatmentLoading.value = false;
      finishTreatmentGeneration(diagnosisIdentity);
    }
  }
}

function getCurrentRegenerationRecord(): ClinicalResultRegenerationRecord {
  return {
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
    pastMedicalHistory: pastMedicalHistory.value,
    personalHistory: personalHistory.value,
    menstrualHistory: isFemalePatient.value ? menstrualHistory.value : '',
    familyHistory: familyHistory.value,
    physicalExam: physicalExam.value,
    precautions: precautions.value,
  };
}

function applyRegenerationRecord(record: ClinicalResultRegenerationRecord): void {
  chiefComplaint.value = record.chiefComplaint;
  historyOfPresentIllness.value = record.historyOfPresentIllness;
  pastMedicalHistory.value = record.pastMedicalHistory;
  personalHistory.value = record.personalHistory;
  menstrualHistory.value = isFemalePatient.value ? record.menstrualHistory : '';
  familyHistory.value = record.familyHistory;
  physicalExam.value = record.physicalExam;
  precautions.value = record.precautions;
}

async function handleSupplementRegenerate(doctorSupplement: string): Promise<void> {
  if (
    resultRegenerating.value
    || diagnosisLoading.value
    || treatmentLoading.value
    || isWritebackBusy.value
  ) return;

  const previousRecord = getCurrentRegenerationRecord();
  const previousDiagnoses = aiDiagnoses.value.map((item) => ({ ...item }));
  const previousSelectedDiagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  const previousSelectedDiagnosisIdentities = new Set(
    selectedDiagnoses.value.map((item) => getDiagnosisIdentity(item)).filter(Boolean),
  );
  const previousTreatments = treatments.value.map((item) => ({ ...item }));
  const previousTreatmentDiagnosisKey = lastTreatmentDiagnosisKey.value;
  const previousAutoTreatmentFetchAttemptKey = autoTreatmentFetchAttemptKey.value;
  const previousTreatmentGenerationState = { ...treatmentGenerationState.value };
  const previousFactSuggestions = factSuggestions.value.map((item) => ({ ...item }));

  closeSupplementDialog();
  resultRegenerating.value = true;
  suppressDiagnosisTreatmentRefetch.value = true;
  closeReasonTooltipIfOpen();
  closeRelatedDropdown();
  recommendationFeedbackPopover.close();
  console.info('[VoiceConsultationNew] Regenerate result with doctor supplement', {
    consultationId: resolveConsultationId(),
    channel: resultChannel.value,
    supplementLength: doctorSupplement.trim().length,
  });

  try {
    const requestSpec = buildClinicalResultRegenerationRequest({
      channel: resultChannel.value,
      patient: {
        name: patientName.value,
        gender: patientGender.value,
        age: patientAge.value,
      },
      currentRecord: previousRecord,
      doctorSupplement,
      consultationId: resolveConsultationId(),
    });
    const response = await chat(
      requestSpec.messages,
      undefined,
      undefined,
      undefined,
      requestSpec.config,
    );
    const regeneratedRecord = normalizeClinicalResultRegenerationOutput(
      parseLLMJson(response),
      previousRecord,
    );

    suppressPrecautionsScopeSync.value = true;
    applyRegenerationRecord(regeneratedRecord);
    invalidateDiagnosisRequests();
    invalidateTreatmentRequests();
    const diagnosisReady = await fetchAIDiagnosis({
      notifyOnError: false,
      deferSideEffects: true,
      requestMode: 'regeneration',
    });
    if (!diagnosisReady) {
      throw new Error('病例已生成，但诊断建议刷新失败');
    }
    captureGeneratedPrecautions(
      getDiagnosisNames(aiDiagnoses.value),
      regeneratedRecord.precautions,
    );
    syncPrecautionsToSelection();

    if (allowTreatmentRefresh.value) {
      const treatmentReady = await fetchAITreatment({
        notifyOnError: false,
        requireAll: true,
        deferSideEffects: true,
      });
      if (!treatmentReady) {
        throw new Error('病例和诊断已生成，但治疗方案刷新失败');
      }
    }

    refreshWritebackScope();

    setInitialRecordSnapshot({
      ...regeneratedRecord,
      precautions: precautions.value,
    });
    resetFactConfirmation();
    scheduleFactSuggestionGeneration();
    void registerCurrentRecommendations();
    void performDiagnosisFactCheck(formalDiagnoses.value);
    void performTreatmentFactCheck(treatments.value);
    resetFirstUserLogSnapshot();
    submitVoiceGeneratedUserLog();
    showToast?.('已结合补充信息重新生成问诊结果', 'success');
  } catch (error) {
    applyRegenerationRecord(previousRecord);
    aiDiagnoses.value = previousDiagnoses;
    const previousSelectedDiagnosis = previousDiagnoses.find(
      (item) => getDiagnosisIdentity(item) === previousSelectedDiagnosisIdentity,
    ) || previousDiagnoses[0] || null;
    const previousSelectedDiagnoses = previousDiagnoses.filter(
      (item) => previousSelectedDiagnosisIdentities.has(getDiagnosisIdentity(item)),
    );
    replaceDiagnosisSelection(
      previousSelectedDiagnoses.length > 0
        ? previousSelectedDiagnoses
        : previousSelectedDiagnosis ? [previousSelectedDiagnosis] : [],
      previousSelectedDiagnosis,
    );
    treatments.value = previousTreatments;
    lastTreatmentDiagnosisKey.value = previousTreatmentDiagnosisKey;
    autoTreatmentFetchAttemptKey.value = previousAutoTreatmentFetchAttemptKey;
    treatmentGenerationState.value = previousTreatmentGenerationState;
    restoreFactSuggestions(previousFactSuggestions);
    console.error('[VoiceConsultationNew] Result regeneration failed', {
      error,
      consultationId: resolveConsultationId(),
      channel: resultChannel.value,
    });
    showToast?.(formatUserFacingError(error, {
      context: '重新生成失败',
      fallback: '已保留当前结果，请稍后重试。',
    }), 'error');
  } finally {
    await nextTick();
    suppressPrecautionsScopeSync.value = false;
    suppressDiagnosisTreatmentRefetch.value = false;
    resultRegenerating.value = false;
    persistEditorSnapshotImmediate();
  }
}

async function maybeAutoFetchMissingTreatment(reason: string): Promise<boolean> {
  if (!autoFetchTreatments.value) return false;
  if (!canStartAutoTreatment.value) return false;
  if (isResultUnavailable.value && !allowsTreatmentAutoFetchInBackground.value) return false;
  if (suppressDiagnosisTreatmentRefetch.value || treatmentLoading.value) return false;
  if (lastTreatmentDiagnosisKey.value) return false;

  const diagnosisIdentity = getDiagnosisIdentity(selectedDiagnosis.value);
  if (!diagnosisIdentity || !selectedDiagnosis.value) return false;

  const attemptKey = buildTreatmentAutoFetchKey(diagnosisIdentity);
  if (autoTreatmentFetchAttemptKey.value === attemptKey) return false;
  autoTreatmentFetchAttemptKey.value = attemptKey;

  console.info('[VoiceConsultationNew] Auto fetching missing treatment recommendations', {
    reason,
    attemptKey,
    diagnosisIdentity,
    diagnosisName: selectedDiagnosis.value.name,
  });
  return fetchAITreatment();
}

async function handleTreatmentRefresh(event?: Event): Promise<void> {
  event?.stopPropagation();
  closeReasonTooltipIfOpen();
  resetTreatmentEditorState();
  await fetchAITreatment();
}

const relatedDiagnosisDropdown = useRelatedDiagnosisDropdown<DiagnosisItem>({
  getDiagnosisKey: (diag) => diag.id || diag.code,
  getCandidates: (diag) => Array.from(new Map([
    ...(diag.catalogAlternatives || []),
    ...medicalDataService.getRelatedDiagnoses(diag.code),
  ].filter((item) => item.code !== diag.code).map((item) => [item.id, item])).values()),
});
const {
  closeRelatedDropdown,
  completeRelatedSwap,
  getRelatedDropdownCandidates,
  isRelatedDropdownOpen,
  toggleRelatedDropdown,
} = relatedDiagnosisDropdown;
const { resetForIntent } = useClinicalResultIntentReset({
  suppressDiagnosisTreatmentRefetch,
  lastTreatmentDiagnosisKey,
  chiefComplaint,
  historyOfPresentIllness,
  pastMedicalHistory,
  personalHistory,
  menstrualHistory,
  familyHistory,
  physicalExam,
  precautions,
  diagnoses: aiDiagnoses,
  treatments,
  resetTreatmentEditorState,
  closeRelatedDropdown,
  closeManualMatch,
  closeRecommendationFeedback: () => {
    recommendationFeedbackPopover.close();
  },
  closeSessionFeedback: () => undefined,
  resetWritebackState: () => {
    resetWritebackState();
    mutualRecognition.clearDialog();
  },
  resetDiagnosisSelection,
  resetFirstUserLogSnapshot,
  setInitialRecordSnapshot,
});

const progressiveIntentApplication = useClinicalResultProgressiveIntentApplication();
let progressiveMenstrualBaseline = '';

function getProgressiveIntentSessionKey(): string {
  return [
    resultChannel.value,
    patientAnchorId.value,
    props.consultationRoundId || props.intentSource || 'direct',
  ].join('|');
}

function applyProgressiveIntentRecord(
  result: ClinicalResultInput,
  sections: readonly ClinicalResultGenerationSection[],
): void {
  const next = new Set(sections);
  const snapshot = buildClinicalResultIntentRecordSnapshot(result);
  const applyTrackedField = (
    field: 'chiefComplaint' | 'historyOfPresentIllness' | 'pastMedicalHistory' | 'personalHistory' | 'familyHistory' | 'physicalExam' | 'precautions',
    value: string,
  ) => {
    if (isRecordFieldModified(field)) return;
    setInitialRecordFieldValue(field, value);
    if (field === 'chiefComplaint') chiefComplaint.value = value;
    else if (field === 'historyOfPresentIllness') historyOfPresentIllness.value = value;
    else if (field === 'pastMedicalHistory') pastMedicalHistory.value = value;
    else if (field === 'personalHistory') personalHistory.value = value;
    else if (field === 'familyHistory') familyHistory.value = value;
    else if (field === 'physicalExam') physicalExam.value = value;
    else precautions.value = value;
  };

  if (next.has('record_core')) {
    applyTrackedField('chiefComplaint', snapshot.chiefComplaint);
    applyTrackedField('historyOfPresentIllness', snapshot.historyOfPresentIllness);
  }
  if (next.has('history_context')) {
    applyTrackedField('pastMedicalHistory', snapshot.pastMedicalHistory);
    applyTrackedField('personalHistory', snapshot.personalHistory);
    if (
      isFemalePatient.value
      && menstrualHistory.value.trim() === progressiveMenstrualBaseline.trim()
    ) {
      menstrualHistory.value = snapshot.menstrualHistory;
      progressiveMenstrualBaseline = snapshot.menstrualHistory;
    }
  }
  if (next.has('record_extra')) {
    applyTrackedField('familyHistory', snapshot.familyHistory);
    applyTrackedField('physicalExam', snapshot.physicalExam);
    applyTrackedField('precautions', snapshot.precautions);
  }
}

function applyIntentDiagnoses(result: ClinicalResultInput): void {
  const guardedDiagnoses = resultChannel.value === 'voice'
    ? guardOrdinaryVoiceDiagnosisHints(result.diagnoses || [], {
        historicalContextText: [
          pastMedicalHistory.value,
          chiefComplaint.value,
          historyOfPresentIllness.value,
        ].filter(Boolean).join('\n'),
      })
    : result.diagnoses || [];
  aiDiagnoses.value = initDiagnosesFromIntent(guardedDiagnoses);
  if (formalDiagnoses.value.length > 0) {
    captureGeneratedPrecautions(getDiagnosisNames(aiDiagnoses.value), precautions.value);
    replaceInitialDiagnosisSelection(
      formalDiagnoses.value,
      resultChannel.value === 'chronic-refill',
    );
    syncPrecautionsToSelection();
    void registerCurrentRecommendations();
  } else {
    captureGeneratedPrecautions([], precautions.value);
    resetDiagnosisSelection();
  }
}

async function applyIntentExplicitTreatments(
  result: ClinicalResultInput,
  preserveGenerated: boolean,
  applicationSequence: number,
): Promise<void> {
  const allowedIntentTreatments = getAllowedIntentTreatments(result);
  if (allowedIntentTreatments.length === 0) return;
  if (allowedIntentTreatments.some((item) => item.type === 'medicine')) {
    await fetchPharmacyOptions();
    if (applicationSequence !== intentResultApplicationSequence) return;
  }

  const initialized = initTreatmentsFromIntent(allowedIntentTreatments);
  const retainedManualKeys = new Set(
    preserveGenerated
      ? treatments.value
        .filter((item) => item.manualMatched)
        .map((item) => `${item.type}:${item.matchedItem?.id || item.name}`)
      : [],
  );
  const nextExplicit = initialized.filter(
    (item) => !retainedManualKeys.has(`${item.type}:${item.matchedItem?.id || item.name}`),
  );
  const explicitKeys = new Set(nextExplicit.map(
    (item) => `${item.type}:${item.matchedItem?.id || item.name}`,
  ));
  const preserved = preserveGenerated
    ? treatments.value.filter((item) => (
      item.manualMatched
      || (
        item.sourceType !== 'explicit'
        && !explicitKeys.has(`${item.type}:${item.matchedItem?.id || item.name}`)
      )
    ))
    : [];
  treatments.value = [...nextExplicit, ...preserved];
  normalizeMedicinePharmacyValues(treatments.value);
  if (!autoFetchTreatments.value) {
    lastTreatmentDiagnosisKey.value = getDiagnosisIdentity(selectedDiagnosis.value);
  }
  if (treatments.value.some((item) => item.type === 'medicine')) {
    await reconcileAutoSelectedMedicineInventory(treatments.value);
  }
  void registerCurrentRecommendations();
}

function swapDiagnosis(originalDiag: Diagnosis, newItem: { id?: string; code: string; name: string }): void {
  const originalIdentity = getStandardDiagnosisKey(originalDiag);
  const index = aiDiagnoses.value.findIndex((item) => getStandardDiagnosisKey(item) === originalIdentity);
  if (index === -1) return;

  const updatedDiag: Diagnosis = {
    ...aiDiagnoses.value[index],
    id: newItem.id,
    code: newItem.code,
    name: newItem.name,
    originalName: aiDiagnoses.value[index].originalName || aiDiagnoses.value[index].name,
    catalogMatchStatus: 'manual',
    suggestedMatchItem: null,
    catalogMatchReason: '医生手动选择标准诊断',
  };

  aiDiagnoses.value[index] = updatedDiag;

  replaceDiagnosisInSelection(originalDiag, updatedDiag);

  completeRelatedSwap();
  void registerCurrentRecommendations();
}

watch(
  () => selectedDiagnoses.value
    .map((item) => getDiagnosisIdentity(item))
    .filter(Boolean)
    .sort()
    .join('|'),
  () => {
    if (!suppressPrecautionsScopeSync.value) {
      syncPrecautionsToSelection();
    }
  },
);

watch(
  () => getDiagnosisIdentity(selectedDiagnosis.value),
  (currentIdentity, previousIdentity) => {
    closeRelatedDropdown();

    if (!currentIdentity || !selectedDiagnosis.value) {
      invalidateTreatmentRequests();
      treatments.value = resultChannel.value === 'voice'
        ? treatments.value.filter(isDoctorOwnedTreatment)
        : [];
      lastTreatmentDiagnosisKey.value = '';
      resetTreatmentEditorState();
      return;
    }

    if (currentIdentity !== previousIdentity) {
      invalidateTreatmentRequests();
      resetTreatmentEditorState();
    }

    if (suppressDiagnosisTreatmentRefetch.value) {
      console.info('[VoiceConsultationNew] Skip treatment refetch while applying voice intent result', {
        currentIdentity,
        previousIdentity,
        treatmentCount: treatments.value.length,
      });
      return;
    }

    const shouldAutoFetchInitialTreatment = !previousIdentity
      && !lastTreatmentDiagnosisKey.value
      && treatments.value.length === 0;

    if (
      shouldAutoFetchInitialTreatment
      && autoFetchTreatments.value
      && canStartAutoTreatment.value
    ) {
      console.info('[VoiceConsultationNew] Auto fetching initial treatment recommendations', {
        currentIdentity,
      });
      void fetchAITreatment();
      return;
    }

    if (currentIdentity !== lastTreatmentDiagnosisKey.value) {
      console.info('[VoiceConsultationNew] Diagnosis changed, waiting for manual treatment refresh', {
        currentIdentity,
        previousIdentity,
        lastTreatmentDiagnosisKey: lastTreatmentDiagnosisKey.value,
        treatmentCount: treatments.value.length,
      });
    }
  },
);

watch(
  () => [
    patientAnchorId.value,
    getDiagnosisIdentity(selectedDiagnosis.value),
    treatments.value.length,
    lastTreatmentDiagnosisKey.value,
    treatmentLoading.value,
    suppressDiagnosisTreatmentRefetch.value,
  ],
  () => {
    void maybeAutoFetchMissingTreatment('stable-empty-treatment-state');
  },
  { flush: 'post' },
);

const resultFactCheckState = useVoiceResultFactCheckState({
  isEnabled: isReviewerEnabled,
  getRecordText: () => ({
    chiefComplaint: chiefComplaint.value,
    historyOfPresentIllness: historyOfPresentIllness.value,
  }),
  getDiagnosisName: () => selectedDiagnosis.value?.name || '',
  checkDiagnosis,
  checkMedicine,
  checkExamination,
  logContext: 'VoiceConsultationNew',
});
const {
  getIssueForDiagnosis,
  getIssueForTreatment,
  performDiagnosisFactCheck,
  performTreatmentFactCheck,
} = resultFactCheckState;

const {
  frequencyOptions,
  routeOptions,
  pharmacyOptions,
  execDeptOptions,
  loadFrequencyOptions: loadFrequencyDict,
  loadRouteOptions: loadRouteDict,
  loadPharmacyOptions: loadPharmacyDict,
  loadExecDeptOptions: loadExecDeptDict,
} = useMedicalDictionaries();

// 门禁逻辑合并到共享 composable，与症状问诊取同一份判定 / 候选过滤口径。
const treatmentGates = useTreatmentGates({ pharmacyOptions, execDeptOptions });
const treatmentPharmacyResolution = useTreatmentPharmacyResolution({
  pharmacyOptions: () => pharmacyOptions.value,
  treatmentGates,
  warn: (message, payload) => {
    console.warn(`[VoiceConsultationNew] ${message}`, payload);
  },
});
const {
  getCandidatePharmaciesForMedicine,
  getDefaultPharmacyOption,
  ensureMedicineDefaultPharmacy,
  findMatchedPharmacyOption,
  getNormalizedPharmacyValue,
  normalizeMedicinePharmacyValues,
} = treatmentPharmacyResolution;

// 治疗项归一化 composable：注入语音侧的执行科室门禁 & 默认发药药房副作用，
// 与症状问诊共享同一份归一化口径（症状侧调用时传入对应回调或默认值）。
const treatmentNormalization = useTreatmentNormalization({
  frequencyOptions,
  routeOptions,
  ensurePharmacy: ensureMedicineDefaultPharmacy,
  isExecDeptSatisfied: (rec) => !isExecDeptRequired(rec) || !!getExecDeptDisplay(rec),
});

const medicineUsageSearch = useMedicineUsageSearch({
  getEditorKey: (rec) => getTreatmentEditorKey(rec),
  getCurrentValue: (rec, field) => {
    const normalized = normalizeTreatmentRecommendation(rec);
    return field === 'frequency' ? normalized.frequency || '' : normalized.route || '';
  },
  getCurrentKey: (rec, field) => {
    const normalized = normalizeTreatmentRecommendation(rec);
    return field === 'frequency' ? normalized.frequencyKey || '' : normalized.routeKey || '';
  },
  getOptions: (field) => field === 'frequency' ? frequencyOptions.value : routeOptions.value,
});
const medicineFieldEditing = useMedicineFieldEditing({
  normalize: normalizeTreatmentRecommendation,
  syncUsageKeyword: (rec, field) => medicineUsageSearch.syncKeyword(rec, field),
  resolveUsageValue: (rec, field) => medicineUsageSearch.resolveValue(rec, field),
  resolveUsageKey: (rec, field) => medicineUsageSearch.resolveKey(rec, field),
  setActiveField: setActiveEditableField,
  isFieldActive: isEditableFieldActive,
  clearActiveField: clearActiveEditableField,
  focusActiveField: focusActiveEditableField,
  clearInventoryWarning: (rec) => clearMedicineInventoryWarning(rec),
  checkInventoryEnough: (rec, showWarning) => checkMedicineInventoryEnough(rec, showWarning),
});

function activateEditableField(rec: TreatmentRecommendation, field: MedicinePrimaryField, event?: Event): void {
  medicineFieldEditing.activateField(rec, field, event);
}

function handleEditableFieldBlur(rec: TreatmentRecommendation, field: MedicinePrimaryField, event: FocusEvent): void {
  medicineFieldEditing.handleFieldBlur(rec, field, event);
}

function handleTotalQtyInput(rec: TreatmentRecommendation, event: Event): void {
  medicineFieldEditing.handleTotalQtyInput(rec, event);
}

function handleFrequencyOpenChange(rec: TreatmentRecommendation, open: boolean): void {
  medicineFieldEditing.handleUsageOpenChange(rec, 'frequency', open);
}

function handleRouteOpenChange(rec: TreatmentRecommendation, open: boolean): void {
  medicineFieldEditing.handleUsageOpenChange(rec, 'route', open);
}

function handleUsageFieldChange(
  rec: TreatmentRecommendation,
  field: Extract<MedicinePrimaryField, 'frequency' | 'route'>,
  value: string,
  key: string,
): void {
  medicineFieldEditing.handleUsageFieldChange(rec, field, value, key);
}

// 二级搜索下拉（药房 / 执行科室 / 部位 / 医保）的统一状态：activeKey + 每条 rec×field 的 keyword 缓存。
const secondarySelector = useSecondarySelector({
  getEditorKey: (rec) => getTreatmentEditorKey(rec),
  fields: {
    pharmacy: { getCurrentValue: (rec) => getNormalizedPharmacyValue(rec) },
    execDept: {
      getCurrentValue: (rec) => {
        const currentValue = (rec.execDept || '').trim();
        if (!currentValue) return '';
        const matched = execDeptOptions.value.find((option) => option.key === currentValue || option.text === currentValue);
        return matched?.text || currentValue;
      },
    },
    bodySite: { getCurrentValue: (rec) => rec.bodySite || '' },
    insurance: { getCurrentValue: (rec) => rec.insuranceType || '' },
  },
});
const treatmentAttributeSearch = useTreatmentAttributeSearch({
  secondarySelector,
  pharmacyOptions: () => pharmacyOptions.value,
  execDeptOptions: () => execDeptOptions.value,
  getCandidatePharmaciesForMedicine,
  getNormalizedPharmacyValue,
});

// 药品详情 hydrate / 库存校验：与症状问诊共享同一份口径（useTreatmentHydration）。
// 注入：候选药房收窄、字典查找；toast 通过 notify 回调走 voice 侧的 'warning' 级别。
const {
  hydrateMatchedMedicalItemDetail,
  hydrateMatchedMedicalItemDetails,
  isMedicalItemDetailHydrating,
  finalizeMedicineRecommendations,
  ensureMedicineSelectable,
  checkMedicineInventoryEnough,
  getMedicineInventoryWarning,
  clearMedicineInventoryWarning,
  isMedicineInventoryChecking,
} = useTreatmentHydration({
  pharmacyOptions,
  normalizeTreatment: normalizeTreatmentRecommendation,
  getCandidatePharmaciesForMedicine,
  findFrequencyOptionByValue,
  findRouteOptionByValue,
  getInventoryKey: (rec) => getTreatmentEditorKey(rec),
  applyMedicalItemPartOptions,
  afterMedicalItemHydrated: syncTreatmentExecDeptSelections,
  logContext: 'VoiceConsultationNew',
  notify: (message) => {
    showToast?.(message, 'warning');
  },
});

watch(
  treatments,
  (items) => {
    void hydrateMatchedMedicalItemDetails(
      items.filter((item) => item.type !== 'medicine' && !!item.matchedItem),
    );
  },
  { flush: 'post' },
);
const treatmentSelectionReadiness = useTreatmentSelectionReadiness({
  ensureMedicineSelectable,
  hydrateMedicalItemDetail: hydrateMatchedMedicalItemDetail,
  checkMedicineInventoryEnough,
  normalize: normalizeTreatmentRecommendation,
  hasRequiredPharmacy,
  hasRequiredExecDept,
  hasRequiredBodySite,
  openPharmacySelector: openPharmacyQuickSelector,
  openExecDeptSelector: (rec) => {
    expandTreatmentEditor(rec);
    openSecondarySelector(rec, 'execDept');
  },
  openBodySiteSelector: openBodySiteQuickSelector,
  expandTreatmentEditor,
  notify: showToast,
});
const {
  ensureTreatmentSelectable,
} = treatmentSelectionReadiness;

async function fetchFrequencyOptions(): Promise<void> {
  await loadFrequencyDict();
}

async function fetchRouteOptions(): Promise<void> {
  await loadRouteDict();
}

async function fetchPharmacyOptions(): Promise<void> {
  await loadPharmacyDict();
  // 语音侧专属副作用：拿到药房列表后预热药品目录与匹配项详情
  const his = getHisAdapter();
  if (!his) {
    medicalDataService.setActivePharmacyStoreIds(null);
    return;
  }
  const activeStoreIds = pharmacyOptions.value
    .map((option) => (option.idSto || '').trim())
    .filter((value): value is string => Boolean(value));
  if (activeStoreIds.length === 0) {
    medicalDataService.setActivePharmacyStoreIds(null);
    return;
  }
  try {
    await medicalDataService.ensureMedicineCatalogForStoreIds(activeStoreIds, his);
    await finalizeMedicineRecommendations(treatments.value, {
      checkInventory: treatments.value.some((item) => item.type === 'medicine' && item.selected),
    });
  } catch (error) {
    console.error('[VoiceConsultationNew] ensureMedicineCatalogForStoreIds failed', error);
  }
}

function syncTreatmentExecDeptSelections(): void {
  syncSharedTreatmentExecDeptSelections(treatments.value, execDeptOptions.value);
}

async function fetchExecDeptOptions(): Promise<void> {
  await loadExecDeptDict();
  syncTreatmentExecDeptSelections();
}

function isExecDeptRequired(rec: TreatmentRecommendation): boolean {
  return treatmentGates.isExecDeptRequired(rec);
}

function getExecDeptDisplay(rec: TreatmentRecommendation): string {
  return treatmentGates.getExecDeptDisplay(rec);
}

function hasRequiredExecDept(rec: TreatmentRecommendation): boolean {
  return treatmentGates.hasRequiredExecDept(rec);
}

function isBodySiteRequired(rec: TreatmentRecommendation): boolean {
  return treatmentGates.isBodySiteRequired(rec);
}

function hasRequiredBodySite(rec: TreatmentRecommendation): boolean {
  return treatmentGates.hasRequiredBodySite(rec);
}

function openExecDeptQuickSelector(rec: TreatmentRecommendation, event?: Event): void {
  revealClinicalResultOverlayAnchor(event);
  openQuickSelector(rec, 'execDept', event);
}

function openBodySiteQuickSelector(rec: TreatmentRecommendation, event?: Event): void {
  revealClinicalResultOverlayAnchor(event);
  openQuickSelector(rec, 'bodySite', event);
}

// === 药品发药药房必填机制（复用检查/检验“医技科室”同样的门禁与 Chip 呈现方案） ===
function isPharmacyRequired(rec: TreatmentRecommendation): boolean {
  return treatmentGates.isPharmacyRequired(rec);
}

function getPharmacyDisplay(rec: TreatmentRecommendation): string {
  return treatmentGates.getPharmacyDisplay(rec);
}

function hasRequiredPharmacy(rec: TreatmentRecommendation): boolean {
  return treatmentGates.hasRequiredPharmacy(rec);
}

function openPharmacyQuickSelector(rec: TreatmentRecommendation, event?: Event): void {
  event?.stopPropagation();
  if (secondarySelector.isOpen(rec, 'pharmacy')) {
    secondarySelector.closeAll();
    return;
  }
  revealClinicalResultOverlayAnchor(event);
  openSecondarySelector(rec, 'pharmacy');
}

function openInsuranceQuickSelector(rec: TreatmentRecommendation, event?: Event): void {
  event?.stopPropagation();
  revealClinicalResultOverlayAnchor(event);
  expandTreatmentEditor(rec);
  openSecondarySelector(rec, 'insurance');
  void nextTick(() => {
    const editorKey = getTreatmentEditorKey(rec);
    const input = Array.from(document.querySelectorAll<HTMLInputElement>('[data-treatment-insurance-input]'))
      .find((element) => element.dataset.treatmentInsuranceInput === editorKey);
    input?.focus();
    input?.select();
  });
}

onMounted(() => {
  void Promise.all([fetchFrequencyOptions(), fetchRouteOptions(), fetchPharmacyOptions(), fetchExecDeptOptions()]);
});

onUnmounted(() => {
  clearPendingSnapshotPersist();
});

const {
  buildDiagList,
  buildOrderList,
  orderItemResolvers,
} = useClinicalResultWritebackPayload({
  selectedDiagnoses,
  primaryDiagnosis: selectedDiagnosis,
  patientTetId,
  execDeptOptions,
  normalizeTreatment: normalizeTreatmentRecommendation,
  findFrequencyOptionByValue,
  findRouteOptionByValue,
  getDefaultPharmacyOption,
  findMatchedPharmacyOption,
  getDefaultExecDeptId: () => getHisAdapter()?.getDefaultExecDeptId() || '',
});
const {
  run: runWritebackPreflight,
} = useClinicalResultWritebackPreflight({
  selectedDiagnoses,
  treatments,
  ensureMedicineSelectable,
  checkMedicineInventoryEnough,
  hydrateMedicalItemDetail: hydrateMatchedMedicalItemDetail,
  hasRequiredPharmacy,
  hasRequiredExecDept,
  hasRequiredBodySite,
  openPharmacySelector: openPharmacyQuickSelector,
  openExecDeptSelector: (rec) => {
    expandTreatmentEditor(rec);
    openSecondarySelector(rec, 'execDept');
  },
  openBodySiteSelector: openBodySiteQuickSelector,
  requiredFieldOptions: {
    resolvers: orderItemResolvers,
    normalize: normalizeTreatmentRecommendation,
  },
  notify: showToast,
});

function getTreatmentMatchLabel(rec: TreatmentRecommendation): string {
  return getSharedTreatmentMatchLabel(rec, 'detailed');
}

function findFrequencyOptionByValue(value?: string): UsageOption | undefined {
  return findUsageOptionByValue(frequencyOptions.value, value);
}

function findRouteOptionByValue(value?: string): UsageOption | undefined {
  return findUsageOptionByValue(routeOptions.value, value);
}

function getMedicineFieldDisplay(rec: TreatmentRecommendation, field: MedicinePrimaryField): string {
  const normalized = normalizeTreatmentRecommendation(rec);
  return getSharedMedicineFieldDisplay(normalized, field, frequencyOptions.value);
}

function getMedicineCollapsedSummary(rec: TreatmentRecommendation): string {
  const normalized = normalizeTreatmentRecommendation(rec);
  return getSharedMedicineCollapsedSummary(normalized, frequencyOptions.value);
}

// 二级选择器统一接口（详见 `useSecondarySelector`）：保留旧函数名作为薄包装，模板/调用方无需感知重构。

function isSecondarySelectorOpen(rec: TreatmentRecommendation, field: SecondarySelectorField): boolean {
  return secondarySelector.isOpen(rec, field);
}

function openSecondarySelector(rec: TreatmentRecommendation, field: SecondarySelectorField): void {
  secondarySelector.open(rec, field);
}

function closeSecondarySelector(rec: TreatmentRecommendation, field: SecondarySelectorField, event: FocusEvent): void {
  secondarySelector.close(rec, field, event);
}

// === 发药药房 ===
function getPharmacySearchKeyword(rec: TreatmentRecommendation): string {
  return treatmentAttributeSearch.getSearchKeyword(rec, 'pharmacy');
}

function setPharmacySearchKeyword(rec: TreatmentRecommendation, value: string): void {
  treatmentAttributeSearch.setSearchKeyword(rec, 'pharmacy', value);
}

function handlePharmacySearchInput(rec: TreatmentRecommendation, event: Event): void {
  treatmentAttributeSearch.handleSearchInput(rec, 'pharmacy', event);
  const target = event.target as HTMLInputElement | null;
  if ((target?.value || '').trim()) {
    return;
  }
  rec.pharmacy = '';
  rec.pharmacyCleared = true;
  clearMedicineInventoryWarning(rec);
  if (isPharmacyRequired(rec)) {
    rec.selected = false;
  }
}

function getFilteredPharmacyOptionsForRecord(rec: TreatmentRecommendation): UsageOption[] {
  return treatmentAttributeSearch.getPharmacyOptionsForRecord(rec);
}

function selectPharmacyOption(rec: TreatmentRecommendation, option: TreatmentAttributeOption): void {
  rec.pharmacy = option.text;
  rec.pharmacyCleared = false;
  setPharmacySearchKeyword(rec, option.text);
  clearMedicineInventoryWarning(rec);
  if (rec.type === 'medicine' && (rec.totalQty || '').trim()) {
    void checkMedicineInventoryEnough(rec, true);
  }
  secondarySelector.closeAll();
  if (rec.selected) {
    void ensureTreatmentSelectable(rec, { hydrateNonMedicine: false }).then((selectable) => {
      if (selectable) {
        collapseTreatmentEditor(rec);
      }
    });
  }
}

function clearPharmacySelection(rec: TreatmentRecommendation): void {
  rec.pharmacy = '';
  rec.pharmacyCleared = true;
  setPharmacySearchKeyword(rec, '');
  clearMedicineInventoryWarning(rec);
  if (isPharmacyRequired(rec) && rec.selected) {
    rec.selected = false;
    showToast?.('发药药房已清空，请重新设置后再选中该药品', 'warning');
  }
}

// === 执行科室 ===
function getExecDeptSearchKeyword(rec: TreatmentRecommendation): string {
  return treatmentAttributeSearch.getSearchKeyword(rec, 'execDept');
}

function setExecDeptSearchKeyword(rec: TreatmentRecommendation, value: string): void {
  treatmentAttributeSearch.setSearchKeyword(rec, 'execDept', value);
}

function handleExecDeptSearchInput(rec: TreatmentRecommendation, event: Event): void {
  treatmentAttributeSearch.handleSearchInput(rec, 'execDept', event);
  const target = event.target as HTMLInputElement | null;
  if ((target?.value || '').trim()) {
    return;
  }
  rec.execDept = '';
  rec.execDeptCleared = true;
  if (isExecDeptRequired(rec)) {
    rec.selected = false;
  }
}

function getFilteredExecDeptOptionsForRecord(rec: TreatmentRecommendation): UsageOption[] {
  return treatmentAttributeSearch.getExecDeptOptionsForRecord(rec);
}

function selectExecDeptOption(rec: TreatmentRecommendation, option: TreatmentAttributeOption): void {
  rec.execDept = option.key || option.text;
  rec.execDeptCleared = false;
  setExecDeptSearchKeyword(rec, option.text);
  secondarySelector.closeAll();
  if (rec.selected) {
    void ensureTreatmentSelectable(rec, { hydrateNonMedicine: false }).then((selectable) => {
      if (selectable) {
        collapseTreatmentEditor(rec);
      }
    });
  }
}

function clearExecDeptSelection(rec: TreatmentRecommendation): void {
  rec.execDept = '';
  rec.execDeptCleared = true;
  setExecDeptSearchKeyword(rec, '');
  if (isExecDeptRequired(rec)) {
    rec.selected = false;
    showToast?.('执行科室已清空，请重新设置后再选中该项目', 'warning');
  }
}


// === 部位 ===
function getBodySiteSearchKeyword(rec: TreatmentRecommendation): string {
  return treatmentAttributeSearch.getSearchKeyword(rec, 'bodySite');
}

function setBodySiteSearchKeyword(rec: TreatmentRecommendation, value: string): void {
  treatmentAttributeSearch.setSearchKeyword(rec, 'bodySite', value);
}

function handleBodySiteSearchInput(rec: TreatmentRecommendation, event: Event): void {
  treatmentAttributeSearch.handleSearchInput(rec, 'bodySite', event);
  const target = event.target as HTMLInputElement | null;
  if ((target?.value || '').trim()) {
    return;
  }
  rec.bodySite = '';
  rec.bodySiteId = '';
  if (isBodySiteRequired(rec)) {
    rec.selected = false;
  }
}

function getFilteredBodySiteOptionsForRecord(rec: TreatmentRecommendation): UsageOption[] {
  return treatmentAttributeSearch.getBodySiteOptionsForRecord(rec);
}

function selectBodySiteOption(rec: TreatmentRecommendation, option: TreatmentAttributeOption): void {
  const matched = (rec.bodySiteOptions || []).find((candidate) => candidate.partId === option.key || candidate.name === option.text);
  if (matched) {
    applyMedicalItemPartOption(rec, matched);
  } else {
    rec.bodySiteId = option.key;
    rec.bodySite = option.text;
  }
  setBodySiteSearchKeyword(rec, option.text);
  secondarySelector.closeAll();
  if (rec.selected) {
    void ensureTreatmentSelectable(rec, { hydrateNonMedicine: false }).then((selectable) => {
      if (selectable) {
        collapseTreatmentEditor(rec);
      }
    });
  }
}

function clearBodySiteSelection(rec: TreatmentRecommendation): void {
  rec.bodySite = '';
  rec.bodySiteId = '';
  setBodySiteSearchKeyword(rec, '');
  if (rec.matchedItem) {
    rec.matchedItem = {
      ...rec.matchedItem,
      idPart: '',
      raw: {
        ...(getMatchedItemRaw(rec) || {}),
        idPart: '',
      },
    };
  }

  if (isBodySiteRequired(rec) && rec.selected) {
    rec.selected = false;
    showToast?.('检查部位已清空，请重新设置后再选中该项目', 'warning');
  }
}

// === 医保 ===
function getInsuranceSearchKeyword(rec: TreatmentRecommendation): string {
  return treatmentAttributeSearch.getSearchKeyword(rec, 'insurance');
}

function setInsuranceSearchKeyword(rec: TreatmentRecommendation, value: string): void {
  treatmentAttributeSearch.setSearchKeyword(rec, 'insurance', value);
}

function handleInsuranceSearchInput(rec: TreatmentRecommendation, event: Event): void {
  treatmentAttributeSearch.handleSearchInput(rec, 'insurance', event);
  const target = event.target as HTMLInputElement | null;
  if ((target?.value || '').trim()) {
    return;
  }
  rec.insuranceType = '';
  rec.insuranceCleared = true;
  rec.selected = false;
}

function getFilteredInsuranceOptionsForRecord(rec: TreatmentRecommendation): UsageOption[] {
  return treatmentAttributeSearch.getInsuranceOptionsForRecord(rec);
}

function selectInsuranceOption(rec: TreatmentRecommendation, option: TreatmentAttributeOption): void {
  rec.insuranceType = option.text;
  rec.insuranceCleared = false;
  setInsuranceSearchKeyword(rec, option.text);
  secondarySelector.closeAll();
}

function clearInsuranceSelection(rec: TreatmentRecommendation): void {
  rec.insuranceType = '';
  rec.insuranceCleared = true;
  setInsuranceSearchKeyword(rec, '');
  if (rec.selected) {
    rec.selected = false;
    showToast?.('医保限用已清空，请重新设置后再选中该项目', 'warning');
  }
}

async function reconcileAutoSelectedMedicineInventory(items: TreatmentRecommendation[]): Promise<void> {
  const autoSelectedMedicines = items.filter((item) => item.type === 'medicine' && item.selected);
  const results = await finalizeMedicineRecommendations(items, {
    checkInventory: autoSelectedMedicines.length > 0,
  });
  const blockedSet = new Set(
    results
      .filter((result) => !result.ready)
      .map((result) => result.item),
  );
  const blockedItems = autoSelectedMedicines.filter((item) => blockedSet.has(item));
  if (blockedItems.length === 0) {
    return;
  }

  blockedItems.forEach((item) => {
    item.selected = false;
  });
  expandTreatmentEditor(blockedItems[0]);
  showToast?.(buildInventoryBlockedSubmitMessage(blockedItems), 'warning');
}

async function handleBatchWriteBack(): Promise<void> {
  if (!canSubmit.value) return;
  if (!ensureWritebackSelection()) return;
  const selectedScope = {
    recordFields: [...writebackScope.value.recordFields],
    includeDiagnosis: writebackScope.value.includeDiagnosis,
    orderTypes: [...writebackScope.value.orderTypes],
  };
  if (selectedScope.recordFields.includes('precautions')) {
    syncPrecautionsToSelection();
  }
  closeWritebackScope();
  persistEditorSnapshotImmediate();
  submitting.value = true;
  clearLastFeedback();

  try {
    const selectedForWriteback = filterWritebackTreatments(selectedTreatments.value);
    const preflight = await runWritebackPreflight({
      includeDiagnosis: selectedScope.includeDiagnosis,
      treatments: selectedForWriteback,
    });
    if (!preflight.ready) {
      return;
    }
    const { selected } = preflight;

    const diagList = selectedScope.includeDiagnosis ? buildDiagList() : [];
    const orderList = buildOrderList(selected);

    const treatmentPlan = buildTreatmentPlanSummary(selected);

    const requestId = `record-confirmed-${Date.now()}`;
    const result = buildRecordConfirmedPayload({
      consultationId: resolveConsultationId(),
      requestId,
      chiefComplaint: chiefComplaint.value,
      historyOfPresentIllness: historyOfPresentIllness.value,
      pastMedicalHistory: pastMedicalHistory.value,
      familyHistory: familyHistory.value,
      outpatientRecord: {
        chiefComplaint: chiefComplaint.value,
        historyOfPresentIllness: historyOfPresentIllness.value,
        pastMedicalHistory: pastMedicalHistory.value,
        personalHistory: personalHistory.value,
        ...(isFemalePatient.value && menstrualHistory.value.trim()
          ? { menstrualHistory: menstrualHistory.value }
          : {}),
        familyHistory: familyHistory.value,
        physicalExam: physicalExam.value,
        precautions: precautions.value,
      },
      patientGender: patientGender.value,
      diagList,
      orderList,
      treatmentPlan,
      writebackScope: selectedScope,
      prescriptionAttributes: resolveRecordConfirmedPrescriptionAttributes(
        resultChannel.value,
        orderList,
        props.initialPatientData,
      ),
      extra: {
        referenceType: 'batch',
        action: 'batch',
        referenceStatus: 'pending',
        referenceMessage: '等待 HIS 完成已选内容回写并回执。',
      },
    });

    trackFinalRecommendationPreferences({
      diagnoses: selectedScope.includeDiagnosis ? selectedDiagnoses.value : [],
      primaryDiagnosis: selectedScope.includeDiagnosis ? selectedDiagnosis.value : null,
      treatments: selected,
      context: buildPreferenceContext('writeback'),
    });
    markWritebackPending(requestId, '已选内容已发送至 HIS，等待处理结果回执。');
    await invoke('complete_consultation', { result });
    if (waitingWritebackFeedback.value) {
      showToast?.('已选内容已发送至 HIS，等待处理结果回执。', 'info');
    }
  } catch (error: unknown) {
    if (waitingWritebackFeedback.value) {
      resetWritebackState();
    }
    showToast?.(formatUserFacingError(error, {
      context: '提交失败',
      fallback: '请稍后重试。',
    }), 'error');
  } finally {
    submitting.value = false;
  }
}

watch(
  patientAnchorId,
  async (currentAnchorId, previousAnchorId) => {
    if (!previousAnchorId || currentAnchorId === previousAnchorId) {
      return;
    }

    console.info('[VoiceConsultationNew] Patient context changed, reset clinical result state', {
      channel: resultChannel.value,
      previousAnchorId,
      currentAnchorId,
    });
    intentResultApplicationSequence += 1;
    progressiveIntentApplication.reset();
    progressiveMenstrualBaseline = '';
    resetFinalResultApplication();
    invalidateDiagnosisRequests();
    resetGenerationSequence();
    clearPendingSnapshotPersist();
    lastAppliedIntentKey.value = '';
    invalidateTreatmentRequests();
    autoTreatmentFetchAttemptKey.value = '';
    resetPrecautionsScope();
    resetForIntent({});
    resetDifferentialDiagnosisDirection();
    resetFactConfirmation();
    resetChronicRefillReview();
    resetWritebackScope();
    resetTreatmentGenerationState();
    await nextTick();
    suppressDiagnosisTreatmentRefetch.value = false;
    void maybeAutoFetchMissingTreatment('patient-context-reset');
  },
);

watch(
  () => props.intentResult,
  async (result) => {
    if (!result) {
      intentResultApplicationSequence += 1;
      progressiveIntentApplication.reset();
      progressiveMenstrualBaseline = '';
      resetFinalResultApplication();
      invalidateDiagnosisRequests();
      resetGenerationSequence();
      lastAppliedIntentKey.value = '';
      resetPrecautionsScope();
      resetFactConfirmation();
      resetWritebackScope();
      resetChronicRefillReview();
      resetDifferentialDiagnosisDirection();
      return;
    }

    const intentKey = buildIntentResultKey(result);
    if (intentKey === lastAppliedIntentKey.value) {
      console.info('[VoiceConsultationNew] Skip duplicate intent result reset', {
        diagnosisCount: result.diagnoses.length,
        treatmentCount: result.treatments.length,
      });
      return;
    }
    lastAppliedIntentKey.value = intentKey;
    const applicationSequence = ++intentResultApplicationSequence;
    const applicationPlan = progressiveIntentApplication.plan({
      sessionKey: getProgressiveIntentSessionKey(),
      generation: result.generation,
    });
    const isFinalApplication = beginFinalResultApplication(result.generation);
    const newSections = new Set(applicationPlan.newSections);
    const isStreaming = result.generation?.status === 'streaming';

    try {
      suppressDiagnosisTreatmentRefetch.value = true;

      if (applicationPlan.mode === 'reset') {
        invalidateDiagnosisRequests();
        invalidateTreatmentRequests();
        resetGenerationSequence();
        autoTreatmentFetchAttemptKey.value = '';
        resetPrecautionsScope();
        resetForIntent(result);
        progressiveMenstrualBaseline = menstrualHistory.value;
        if (!isFemalePatient.value) menstrualHistory.value = '';
        resetDifferentialDiagnosisDirection();
        resetFactConfirmation();
        resetChronicRefillReview(result.chronicRefillReview);
        resetTreatmentGenerationState();
      } else {
        applyProgressiveIntentRecord(result, applicationPlan.newSections);
        if (newSections.has('recommendation_plan') && !treatmentLoading.value) {
          resetTreatmentGenerationState();
        }
      }

      const receivedRecordPatch = [
        'record_core',
        'history_context',
        'record_extra',
      ].some((section) => newSections.has(section as ClinicalResultGenerationSection));
      if (
        (applicationPlan.mode === 'reset' || newSections.has('record_suggestions') || receivedRecordPatch)
        && result.factSuggestions?.length
      ) {
        restoreFactSuggestions(result.factSuggestions);
      }

      const shouldApplyDiagnoses = applicationPlan.mode === 'reset'
        ? result.diagnoses.length > 0
        : newSections.has('diagnoses');
      if (shouldApplyDiagnoses) {
        applyIntentDiagnoses(result);
      }

      if (!isStreaming || newSections.has('explicit_orders')) {
        await applyIntentExplicitTreatments(
          result,
          applicationPlan.continuesStreamingSession,
          applicationSequence,
        );
        if (applicationSequence !== intentResultApplicationSequence) return;
      }

      if (applicationPlan.mode === 'reset') resetWritebackScope();
      else refreshWritebackScope();

      await nextTick();
      if (applicationSequence !== intentResultApplicationSequence) return;
      suppressDiagnosisTreatmentRefetch.value = false;

      if (shouldApplyDiagnoses && formalDiagnoses.value.length > 0) {
        void performDiagnosisFactCheck(formalDiagnoses.value);
      }

      if (isStreaming) {
        void maybeAutoFetchMissingTreatment('progressive-intent-ready');
        return;
      }

      // 仅在“同就诊缓存恢复”路径上叠加编辑快照，避免上一会话的治疗方案/诊断
      // 污染全新 LLM 语音问诊的默认推荐。
      if (applicationPlan.mode === 'reset' && shouldUseVoiceCache.value && props.intentSource === 'cache') {
        const editorSnapshot = getVoiceConsultationEditorSnapshot(props.initialPatientData);
        if (editorSnapshot) {
          await applyEditorSnapshot(editorSnapshot);
          if (applicationSequence !== intentResultApplicationSequence) return;
        }
      }

      if (!result.factSuggestions?.length) {
        scheduleFactSuggestionGeneration();
      }

      if (shouldRecoverMissingDiagnosis(canRefreshDiagnosis.value)) {
        await fetchAIDiagnosis({
          notifyOnError: false,
          requestMode: 'initial-recovery',
        });
        if (applicationSequence !== intentResultApplicationSequence) return;
      } else if (
        resultChannel.value === 'symptom'
        && formalDiagnoses.value.length === 0
        && canRefreshDiagnosis.value
        && !diagnosisLoading.value
      ) {
        // Preserve the symptom-result fallback. It is independent from the
        // ordinary voice rule that treats a declared differential-only section
        // as a complete diagnosis outcome.
        void fetchAIDiagnosis({ requestMode: 'manual-refresh' });
      }

      if (treatments.value.length > 0) {
        void performTreatmentFactCheck(treatments.value);
      }

      submitVoiceGeneratedUserLog();
      // 治疗分支可能已在 recommendation_plan 到达时启动；这里仅保证旧结果或
      // 非流式入口仍能补发，不能再把它串行纳入核心病历的 finalizing。
      void maybeAutoFetchMissingTreatment('intent-result-applied');
    } finally {
      if (
        isFinalApplication
        && applicationSequence === intentResultApplicationSequence
        && lastAppliedIntentKey.value === intentKey
      ) {
        await nextTick();
        finishFinalResultApplication();
      }
    }
  },
  { immediate: true },
);

// 编辑器关键状态发生变化时，节流写回缓存的 editorSnapshot。
// 下一次恢复同就诊时整张语音病历都从缓存里直接还原。
watch(
  () => [
    chiefComplaint.value,
    historyOfPresentIllness.value,
    pastMedicalHistory.value,
    personalHistory.value,
    menstrualHistory.value,
    familyHistory.value,
    physicalExam.value,
    precautions.value,
    factSuggestions.value,
    includedDifferentialDiagnosisKeys.value,
    promotedDifferentialDiagnosisKeys.value,
    treatments.value,
    aiDiagnoses.value,
    selectedDiagnosis.value,
    lastTreatmentDiagnosisKey.value,
    serializeWritebackScope(),
  ],
  () => {
    schedulePersistEditorSnapshot();
  },
  { deep: true },
);
</script>

<template>
  <div class="voice-consultation-new">
    <PatientHeader v-if="shouldShowPatientHeader" :patient="props.initialPatientData" />

    <div class="voice-content">
      <div v-if="!intentResult" class="loading-state pane-card">
      <div class="ai-spinner">
        <div class="spinner-ring"></div>
        <div class="spinner-core"></div>
      </div>
      <p class="loading-title">AI 正在识别语音意图...</p>
    </div>

    <div v-else :class="['medical-record-page', {
      'is-result-generating': isResultGenerating,
      'is-result-unavailable': isResultUnavailable,
      'is-core-record-editable': coreRecordEditable,
    }]">
      <ClinicalGenerationProgress
        :generation="displayedGeneration"
        :treatment-loading="treatmentLoading"
        :treatment-states="treatmentGenerationState"
        :show-treatment-progress="resultChannel !== 'voice'"
      />
      <div v-if="resultRegenerating" class="writeback-status-banner writeback-status-banner-info">
        正在结合补充信息重新生成问诊结果，请稍候……
      </div>
      <div v-if="writebackBannerText" :class="['writeback-status-banner', `writeback-status-banner-${writebackBannerTone}`]">
        {{ writebackBannerText }}
      </div>
      <div class="record-content">
        <section
          class="vcn-panel pane-card vcn-left-panel"
          tabindex="0"
          aria-label="病历详情，可独立滚动"
        >
          <div class="section-heading">
            <div class="section-heading-main">
              <h3 class="section-title">病历详情</h3>
            </div>
            <button
              class="refresh-recommendation-btn"
              type="button"
              aria-label="补充说明并重新生成病历"
              title="补充文字或语音说明，并重新生成病历、诊断和适用的治疗方案"
              :disabled="isResultUnavailable || diagnosisLoading || treatmentLoading || isWritebackBusy"
              @click="openGeneralSupplementDialog"
            >
              <Icon
                :icon="resultRegenerating ? 'lucide:loader-2' : 'lucide:message-square-plus'"
                :class="{ spin: resultRegenerating }"
                size="14"
                aria-hidden="true"
              />
              <span>{{ resultRegenerating ? '重新生成中...' : '补充说明' }}</span>
            </button>
          </div>

          <div v-if="hasPendingFactSuggestions" class="clinical-record-ai-notice" role="note">
            <Icon icon="lucide:info" size="14" aria-hidden="true" />
            <span title="AI 标记为补充内容，红色为重点；会随所选字段回写，可点击调整或移除。">AI 标记为补充内容，红色为重点；会随所选字段回写，可点击调整或移除。</span>
          </div>

          <div class="record-fields">
            <VoiceRecordFieldEditor
              v-model="chiefComplaint"
              title="主诉"
              presentation="document"
              :rows="2"
              placeholder="请输入主诉..."
            />
            <VoiceRecordFieldEditor
              v-model="historyOfPresentIllness"
              title="现病史"
              presentation="document"
              :rows="6"
              :fact-highlights="getRecordFieldFactHighlights('historyOfPresentIllness')"
              :fact-suggestions="getRecordFieldFactSuggestions('historyOfPresentIllness')"
              placeholder="请输入现病史..."
              @dismiss-fact-suggestion="dismissFactSuggestion"
              grow
            />
            <VoiceRecordFieldEditor
              v-model="pastMedicalHistory"
              title="既往史"
              presentation="document"
              :rows="4"
              :fact-highlights="getRecordFieldFactHighlights('pastMedicalHistory')"
              :fact-suggestions="getRecordFieldFactSuggestions('pastMedicalHistory')"
              placeholder="请输入既往史..."
              @dismiss-fact-suggestion="dismissFactSuggestion"
            />
            <VoiceRecordFieldEditor
              v-model="personalHistory"
              title="个人史"
              presentation="document"
              :rows="3"
              :fact-highlights="getRecordFieldFactHighlights('personalHistory')"
              :fact-suggestions="getRecordFieldFactSuggestions('personalHistory')"
              placeholder="请输入个人史..."
              @dismiss-fact-suggestion="dismissFactSuggestion"
            />
            <VoiceRecordFieldEditor
              v-if="isFemalePatient"
              v-model="menstrualHistory"
              title="月经史"
              presentation="document"
              :rows="3"
              placeholder="请输入月经史..."
            />
            <VoiceRecordFieldEditor
              v-model="familyHistory"
              title="家族史"
              presentation="document"
              :rows="3"
              :fact-highlights="getRecordFieldFactHighlights('familyHistory')"
              :fact-suggestions="getRecordFieldFactSuggestions('familyHistory')"
              placeholder="请输入家族史..."
              @dismiss-fact-suggestion="dismissFactSuggestion"
            />
            <VoiceRecordFieldEditor
              v-model="physicalExam"
              title="体格检查"
              presentation="document"
              :rows="4"
              :fact-highlights="getRecordFieldFactHighlights('physicalExam')"
              :fact-suggestions="getRecordFieldFactSuggestions('physicalExam')"
              placeholder="请输入体格检查..."
              @dismiss-fact-suggestion="dismissFactSuggestion"
            />
            <VoiceRecordFieldEditor
              v-model="precautions"
              title="注意事项"
              presentation="document"
              :rows="3"
              placeholder="请输入注意事项..."
            />
          </div>
        </section>

        <section
          ref="clinicalResultRightColumnRef"
          class="vcn-right-panel"
          tabindex="0"
          aria-label="诊断与治疗建议，可独立滚动"
          @scroll.passive="syncActiveClinicalResultSection"
        >
          <ClinicalResultColumnNavigator
            :primary-diagnosis-name="selectedDiagnosis?.name || ''"
            :items="clinicalResultNavigationItems"
            :active-key="activeClinicalResultSection"
            @navigate="navigateClinicalResultSection"
          />

          <div class="decision-card pane-card" data-clinical-section="diagnosis">
            <div class="section-heading">
              <div class="section-heading-main">
                <h3 class="section-title">诊断建议</h3>
              </div>
              <div class="diagnosis-heading-actions">
                <div v-if="selectedDiagnoses.length > 0" class="section-meta">
                  已纳入 {{ selectedDiagnoses.length }} 项
                </div>
                <button
                  class="refresh-recommendation-btn"
                  type="button"
                  title="基于当前病历重新生成诊断建议"
                  :disabled="isResultUnavailable || diagnosisLoading || !canRefreshDiagnosis"
                  @click="handleDiagnosisRefresh"
                >
                  <Icon
                    :icon="diagnosisLoading ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                    :class="{ spin: diagnosisLoading }"
                    size="14"
                    aria-hidden="true"
                  />
                  <span>{{ diagnosisLoading ? (diagnosisRequestMode === 'initial-recovery' ? '生成中...' : '刷新中...') : '刷新诊断' }}</span>
                </button>
              </div>
            </div>

            <div
              v-if="showBlockingDiagnosisLoading"
              class="loading-inline"
              role="status"
              aria-live="polite"
            >
              <div class="ai-spinner small">
                <div class="spinner-ring"></div>
                <div class="spinner-core"></div>
              </div>
              <span>正在形成诊断建议...</span>
            </div>

            <ul v-else-if="formalDiagnoses.length > 0" class="vcn-diagnosis-list">
              <DiagnosisRecommendationCard
                v-for="diag in formalDiagnoses"
                :key="diag.code + diag.name"
                :diag="diag"
                :selected="isDiagnosisSelected(diag)"
                :is-primary="isPrimaryDiagnosis(diag)"
                :can-remove="selectedDiagnoses.length > 1"
                :reason-open="activeReasonTooltipKey === getReasonTooltipKey('diagnosis', diag.code, diag.name)"
                :related-open="isRelatedDropdownOpen(diag)"
                :related-diagnoses="getRelatedDropdownCandidates(diag)"
                :issue="getIssueForDiagnosis(diag.code)"
                :show-differential="resultChannel !== 'chronic-refill'"
                :actions-overlay-open="resultChannel === 'chronic-refill' && isPrimaryDiagnosis(diag) && chronicRefillReviewExpanded"
                :differential-status="getDiagnosisChecklistStatus(diag)"
                :differential-preview="getDiagnosisChecklistPreview(diag)"
                :differential-open="isDiagnosisChecklistOpen(diag)"
                :feedback-visible="isRecommendationFeedbackOpen(getDiagnosisFeedbackKey(diag))"
                :feedback-draft="getRecommendationDraft(getDiagnosisFeedbackKey(diag))"
                :feedback-submitting="recommendationSubmittingKey === getDiagnosisFeedbackKey(diag)"
                :submitted-label="getRecommendationSubmittedLabel(getDiagnosisFeedbackKey(diag))"
                @toggle="toggleDiagnosis(diag)"
                @toggle-reason="toggleClinicalResultReasonTooltip(getReasonTooltipKey('diagnosis', diag.code, diag.name), $event)"
                @set-primary="setPrimaryDiagnosis(diag, $event)"
                @remove="removeDiagnosis(diag, $event)"
                @toggle-related="toggleRelatedDropdown(diag, $event)"
                @swap-related="swapDiagnosis(diag, $event)"
                @diagnosis-differential="handleDiagnosisDifferential(diag, $event)"
                @close-differential="handleCloseDiagnosisDifferential(diag, $event)"
                @toggle-feedback="toggleRecommendationFeedback(getDiagnosisFeedbackKey(diag), $event)"
                @update:feedback-draft="updateRecommendationDraft(getDiagnosisFeedbackKey(diag), $event)"
                @submit-feedback="handleDiagnosisFeedbackSubmit(diag, $event)"
              >
                <template #actions>
                  <ChronicRefillReviewPanel
                    v-if="resultChannel === 'chronic-refill' && isPrimaryDiagnosis(diag) && chronicRefillReviewPlan"
                    :plan="chronicRefillReviewPlan"
                    :selections="chronicRefillReviewSelections"
                    :expanded="chronicRefillReviewExpanded"
                    :reviewed-count="chronicRefillReviewedCount"
                    :treatment-review-triggered="chronicRefillTreatmentReviewTriggered"
                    :disabled="isResultUnavailable"
                    @toggle="setChronicRefillReviewExpanded"
                    @select="selectChronicRefillReview"
                  />
                  <slot name="diagnosis-actions" :diag="diag" />
                </template>
              </DiagnosisRecommendationCard>
            </ul>

            <div v-else class="diagnosis-empty-state" role="status">
              <Icon icon="lucide:info" size="15" aria-hidden="true" />
              <div class="diagnosis-empty-copy">
                <strong>当前信息不足，暂未形成正式诊断。</strong>
                <span v-if="differentialDiagnoses.length > 0">
                  可从下方纳入诊疗方向并补充依据，确认后再转为正式诊断。
                </span>
                <span v-else>
                  请补充病史、查体或检查结果后刷新诊断。
                </span>
              </div>
            </div>

            <DiagnosisDifferentialList
              :diagnoses="differentialDiagnoses"
              :included-keys="includedDifferentialDiagnosisKeys"
              :disabled="isResultUnavailable || isWritebackBusy"
              @include="includeDifferentialDirection"
              @remove="removeDifferentialDirection"
              @supplement="supplementDifferentialDirection"
              @promote="promoteDifferentialToFormal"
            />
          </div>

          <div class="decision-card pane-card">
            <div class="section-heading treatment-heading">
              <div class="section-heading-main">
                <h3 class="section-title">治疗方案</h3>
              </div>
              <div v-if="allowTreatmentRefresh" class="treatment-heading-actions">
                <button
                  class="refresh-recommendation-btn"
                  type="button"
                  title="基于当前主诊断重新生成治疗方案"
                  :disabled="isResultUnavailable || !selectedDiagnosis || treatmentLoading"
                  @click="handleTreatmentRefresh"
                >
                  <Icon
                    :icon="treatmentLoading ? 'lucide:loader-2' : 'lucide:refresh-cw'"
                    :class="{ spin: treatmentLoading }"
                    size="14"
                    aria-hidden="true"
                  />
                  <span>{{ treatmentLoading ? '刷新中...' : '刷新方案' }}</span>
                </button>
              </div>
            </div>

            <div v-if="allowTreatmentRefresh && treatmentRefreshNeeded && !treatmentLoading" class="refresh-needed-note">
              已切换主诊断，当前方案仍保留上一版；点击“刷新方案”获取当前诊断方案。
            </div>

            <template v-if="treatmentPresentationRows.length > 0">
              <template v-for="section in treatmentPresentationRows" :key="section.presentationKey">
                <TreatmentRecommendationSection
                  v-if="section.items.length > 0"
                  :data-clinical-section="section.type"
                  :section="section"
                  :selected-count="section.items.filter((item) => item.selected).length"
                  :total-count="section.items.length"
                  :requires-manual-match-before-select="requiresManualMatchBeforeSelect"
                  :get-issue="getTreatmentIssue"
                  :get-reason-key="getTreatmentReasonKey"
                  :active-reason-key="activeReasonTooltipKey || ''"
                  :get-treatment-spec="getTreatmentSpec"
                  :get-treatment-match-label="getTreatmentMatchLabel"
                  :has-probable-match="hasProbableMatch"
                  :get-suggested-match-name="getSuggestedMatchName"
                  :get-treatment-original-name="getTreatmentOriginalName"
                  :get-editor-key="getTreatmentEditorKey"
                  :is-pharmacy-required="isPharmacyRequired"
                  :get-pharmacy-display="getPharmacyDisplay"
                  :has-required-pharmacy="hasRequiredPharmacy"
                  :is-exec-dept-required="isExecDeptRequired"
                  :get-exec-dept-display="getExecDeptDisplay"
                  :has-required-exec-dept="hasRequiredExecDept"
                  :is-exec-dept-hydrating="isMedicalItemDetailHydrating"
                  :get-body-site-display="treatmentGates.getBodySiteDisplay"
                  :has-required-body-site="hasRequiredBodySite"
                  :frequency-options="frequencyOptions"
                  :route-options="routeOptions"
                  :should-show-treatment-editor="shouldShowTreatmentEditor"
                  :should-show-editor-toggle="shouldShowTreatmentEditorToggle"
                  :is-treatment-editor-expanded="isTreatmentEditorExpanded"
                  :is-editable-field-active="isEditableFieldActive"
                  :get-editable-field-key="getEditableFieldKey"
                  :get-medicine-field-display="getMedicineFieldDisplay"
                  :get-medicine-inline-summary="getMedicineCollapsedSummary"
                  :is-medicine-inventory-checking="isMedicineInventoryChecking"
                  :get-medicine-inventory-warning="getMedicineInventoryWarning"
                  :is-secondary-selector-open="isSecondarySelectorOpen"
                  :get-pharmacy-search-keyword="getPharmacySearchKeyword"
                  :get-filtered-pharmacy-options="getFilteredPharmacyOptionsForRecord"
                  :get-exec-dept-search-keyword="getExecDeptSearchKeyword"
                  :get-filtered-exec-dept-options="getFilteredExecDeptOptionsForRecord"
                  :get-body-site-search-keyword="getBodySiteSearchKeyword"
                  :get-filtered-body-site-options="getFilteredBodySiteOptionsForRecord"
                  :get-insurance-search-keyword="getInsuranceSearchKeyword"
                  :get-filtered-insurance-options="getFilteredInsuranceOptionsForRecord"
                  :is-manual-match-open="isManualMatchOpen"
                  :get-manual-match-keyword="getManualMatchKeyword"
                  :get-manual-match-candidates="getManualMatchPickerCandidates"
                  :is-feedback-open="isTreatmentFeedbackOpen"
                  :get-feedback-draft="getTreatmentFeedbackDraft"
                  :is-feedback-submitting="isTreatmentFeedbackSubmitting"
                  :get-feedback-submitted-label="getTreatmentFeedbackSubmittedLabel"
                  @toggle="toggleTreatment"
                  @toggle-reason="(rec, event) => toggleClinicalResultReasonTooltip(getTreatmentReasonKey(rec), event)"
                  @confirm-match="confirmSuggestedMatch"
                  @toggle-feedback="(rec, event) => toggleRecommendationFeedback(getTreatmentFeedbackKey(rec), event)"
                  @update-feedback-draft="(rec, draft) => updateRecommendationDraft(getTreatmentFeedbackKey(rec), draft)"
                  @submit-feedback="handleTreatmentFeedbackSubmit"
                  @toggle-treatment-editor="toggleTreatmentEditor"
                  @activate-editable-field="activateEditableField"
                  @editable-field-blur="handleEditableFieldBlur"
                  @register-editable-field-element="registerEditableFieldElement"
                  @total-qty-input="handleTotalQtyInput"
                  @frequency-open-change="handleFrequencyOpenChange"
                  @route-open-change="handleRouteOpenChange"
                  @usage-field-change="handleUsageFieldChange"
                  @open-pharmacy="openPharmacyQuickSelector"
                  @open-exec-dept="openExecDeptQuickSelector"
                  @open-body-site="openBodySiteQuickSelector"
                  @open-insurance="openInsuranceQuickSelector"
                  @close-secondary-selector="closeSecondarySelector"
                  @update-pharmacy-keyword="handlePharmacySearchInput"
                  @select-pharmacy="selectPharmacyOption"
                  @clear-pharmacy="clearPharmacySelection"
                  @update-exec-dept-keyword="handleExecDeptSearchInput"
                  @select-exec-dept="selectExecDeptOption"
                  @clear-exec-dept="clearExecDeptSelection"
                  @update-body-site-keyword="handleBodySiteSearchInput"
                  @select-body-site="selectBodySiteOption"
                  @clear-body-site="clearBodySiteSelection"
                  @update-insurance-keyword="handleInsuranceSearchInput"
                  @select-insurance="selectInsuranceOption"
                  @clear-insurance="clearInsuranceSelection"
                  @toggle-manual-match="toggleManualMatch"
                  @update-manual-match-keyword="setManualMatchKeyword"
                  @select-manual-match-candidate="handleManualMatchPickerSelect"
                  @toggle-rejected="toggleTreatmentRejected"
                />
                <TreatmentGenerationPlaceholder
                  v-else-if="section.placeholder"
                  :data-clinical-section="section.presentationKey"
                  :title="section.title"
                  :status="section.placeholder"
                />
              </template>
            </template>

            <div v-else-if="!treatmentLoading" class="empty-text">{{ displayedTreatmentEmptyText }}</div>
          </div>
        </section>
      </div>

    </div>
    </div>

    <div class="voice-footer">
      <ClinicalDecisionDisclaimer />
      <button
        v-if="secondaryFooterActionText"
        class="footer-secondary-btn"
        type="button"
        :disabled="secondaryFooterActionDisabled || isWritebackBusy || isResultUnavailable || diagnosisLoading"
        @click="emit('secondary-footer-action')"
      >
        {{ secondaryFooterActionText }}
      </button>
      <ClinicalResultWritebackScopeSelector
        :open="writebackScopeOpen"
        :disabled="isWritebackBusy || isResultUnavailable || diagnosisLoading"
        :record-expanded="writebackRecordExpanded"
        :record-fields="writebackRecordFields"
        :record-group-checked="writebackRecordGroupChecked"
        :record-group-indeterminate="writebackRecordGroupIndeterminate"
        :record-selection-summary="writebackRecordSelectionSummary"
        :diagnosis-available="writebackDiagnosisAvailable"
        :diagnosis-selected="writebackIncludeDiagnosis"
        :diagnosis-count="writebackDiagnosisCount"
        :medicine-available="writebackMedicineAvailable"
        :medicine-selected="writebackIncludeMedicine"
        :medicine-count="writebackMedicineCount"
        :clinical-orders-available="writebackClinicalOrdersAvailable"
        :clinical-orders-selected="writebackIncludeClinicalOrders"
        :clinical-orders-count="writebackClinicalOrderCount"
        :selected-option-count="writebackSelectedOptionCount"
        :available-option-count="writebackAvailableOptionCount"
        :all-available-selected="allWritebackContentSelected"
        :partial-selection="partialWritebackSelection"
        :creating-partial-record="creatingPartialOutpatientRecord"
        @toggle="toggleWritebackScope"
        @close="closeWritebackScope"
        @toggle-all="toggleAllWritebackContent"
        @toggle-record-group="toggleWritebackRecordGroup"
        @toggle-record-expanded="setWritebackRecordExpanded(!writebackRecordExpanded)"
        @toggle-record-field="toggleWritebackRecordField"
        @toggle-diagnosis="toggleWritebackDiagnosis"
        @toggle-medicine="toggleWritebackMedicine"
        @toggle-clinical-orders="toggleWritebackClinicalOrders"
      />
      <button
        class="footer-submit-btn"
        type="button"
        :disabled="!canSubmit"
        :aria-busy="isWritebackBusy"
        @click="handleBatchWriteBack"
      >
        一键回写
      </button>
      <button class="footer-cancel-btn" type="button" :disabled="isWritebackBusy || isResultGenerating || diagnosisLoading" @click="handleCancelClick">放弃</button>
    </div>

    <ClinicalResultSupplementDialog
      :open="showSupplementDialog"
      :disabled="resultRegenerating || diagnosisLoading || treatmentLoading || isWritebackBusy"
      :guidance="supplementGuidance"
      @close="closeSupplementDialog"
      @confirm="handleSupplementRegenerate"
    />

    <MutualRecognitionDecisionHost :decision="mutualRecognition" />

    <div v-if="showCancelConfirm" class="confirm-overlay" @click.self="closeCancelConfirm">
      <div class="confirm-dialog pane-card" role="dialog" aria-modal="true" aria-labelledby="voice-cancel-title">
        <div class="confirm-dialog-body">
          <p id="voice-cancel-title" class="confirm-dialog-title">{{ cancelDialogTitle }}</p>
          <p class="confirm-dialog-text">{{ cancelDialogText }}</p>
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-btn secondary" type="button" @click="closeCancelConfirm">继续编辑</button>
          <button class="confirm-btn danger" type="button" @click="confirmCancel">确认放弃</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped src="../features/consultation-result/ui/ClinicalResultEditor.css"></style>

<style scoped>
.is-result-unavailable .record-content {
  pointer-events: none;
}

.is-result-unavailable.is-core-record-editable .vcn-left-panel {
  pointer-events: auto;
}

.is-result-generating .voice-footer {
  pointer-events: none;
  opacity: 0.72;
}

</style>
