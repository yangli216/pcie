<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, provide, ref, shallowRef, watch } from "vue";
import { getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import { exit } from '@tauri-apps/plugin-process';
import { load, Store } from '@tauri-apps/plugin-store';
import ChatPanel from "./components/ChatPanel.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import ConsultationPage from "./components/ConsultationPage.vue";
import { DiagnosisPathWindow } from "@features/diagnosis-path";
import { ReportInterpretationWindow, ReportInterpretationWorkspace } from "@features/report-interpretation";
import Toast from "@shared/ui/Toast.vue";
import { RiskAlertPanel } from "@features/reception-risk";
import {
  ReceptionCapsule,
  useReceptionSessionController,
} from "@features/reception";
import { VoiceCapsule, clearVoiceConsultationCache } from "@features/voice-consultation";
import SvgIcon from "./components/svgIcon.vue";
import { KnowledgeBasePanel } from "@features/knowledge";
import { ConsultationResultPage } from "@features/consultation-result";
import { FeedbackSubmissionPanel } from "@features/feedback";
import { HisIntegrationLogPanel } from "@features/settings";
import { MedicalCatalogCachePanel } from "@features/medical-catalog";
import { TreatmentPlanPage } from "@features/treatment-plan";
import { OutpatientFollowUpPage } from "@features/outpatient-follow-up";
import { InpatientEmrPage, type InpatientEmrGenerationRequest } from "@features/inpatient-emr";
import {
  OutpatientEmrPage,
  useVoiceOutpatientEmrWorkflow,
} from "@features/outpatient-emr";
import { DifferentialDiagnosisModalPage } from "@features/differential-diagnosis";
import { PatientMemoryWorkspace } from '@features/patient-memory';
import Icon from "@shared/ui/Icon.vue";
import { formatUserFacingError } from "@shared/lib/errorMessages";
import { trackClick } from "./services/operationTracker";
import { getWindowSizeForView, isLargeWorkspaceView, WINDOW_SIZES, type ViewType } from "./constants/windowSizes";
import { useNavigation } from "@app/navigation/useNavigation";
import { useOutpatientEmrBridgeController } from "@app/events/useOutpatientEmrBridgeController";
import { useAppKeyboardShortcuts } from "@app/shortcuts/useAppKeyboardShortcuts";
import { useWindowManagement } from "@app/shell/useWindowManagement";
import { useWindowTransitionCoordinator } from "@app/shell/useWindowTransitionCoordinator";
import { useWorkMode } from "@app/shell/useWorkMode";
import { useVoiceConsultation } from "./composables/useVoiceConsultation";
import { useEventListeners } from "./composables/useEventListeners";
import { useMinimizedSessions } from "./composables/useMinimizedSessions";
import {
  getPatientContextAnchorId,
  getPatientContextName,
} from "./utils/patientContext";
import {
  medicalDataService,
  type MedicalCatalogClearOptions,
  type MedicalCatalogClearResult,
  type MedicalCatalogContext,
  type MedicalCatalogDebugState,
} from "./services/medicalData";
import {
  checkForceUpdateRequired,
  getCurrentForceUpdateState,
  subscribeForceUpdateRequired,
  type ForceUpdateState,
} from "./services/updatePolicy";
import type { AppPatient, AppStore } from "./types/appState";
import type { ConsultationAssistAction } from "./types/consultationAssist";
import { useWin7WindowRegion } from '@/app/shell/useWin7WindowRegion';

const ForceUpdateGate = defineAsyncComponent(() => import("@features/settings").then((module) => module.ForceUpdateGate));

type MedicalCatalogDebugApi = {
  help: () => string[];
  state: () => Promise<MedicalCatalogDebugState>;
  sync: (context?: string | MedicalCatalogContext | null) => Promise<MedicalCatalogDebugState>;
  clear: (options?: MedicalCatalogClearOptions) => Promise<MedicalCatalogClearResult>;
  sample: (limit?: number) => {
    diagnoses: ReturnType<typeof medicalDataService.getAllDiagnoses>;
    items: ReturnType<typeof medicalDataService.getAllItems>;
    medicines: ReturnType<typeof medicalDataService.getAllMedicines>;
  };
};

declare global {
  interface Window {
    __medicalCatalogDebug__?: MedicalCatalogDebugApi;
  }
}

const appWindow = shallowRef<TauriWindow | null>(null);
const standaloneWindowParam = typeof window !== 'undefined'
  ? new URLSearchParams(window.location.search).get('window')
  : null;
const standaloneWindowKind = standaloneWindowParam === 'diagnosis-path' || standaloneWindowParam === 'report-interpretation'
  ? standaloneWindowParam
  : 'main';
const isStandaloneWindow = standaloneWindowKind !== 'main';
const isDiagnosisPathWindow = standaloneWindowKind === 'diagnosis-path';
const isReportInterpretationWindow = standaloneWindowKind === 'report-interpretation';
const toastRef = ref<InstanceType<typeof Toast> | null>(null);
const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info', duration = 3000) => {
  const displayMessage = type === 'error' ? formatUserFacingError(msg) : msg;
  toastRef.value?.show(displayMessage, type, duration);
};
provide('showToast', showToast);
const isFocused = ref(false);
const isHovered = ref(false);
const hoveredBtnIndex = ref(-1); // -1 means no button hovered
const isWorking = ref(false);
const currentView = ref<ViewType>('chat');
const currentPatient = ref<AppPatient | null>(null);
const ringMenuRef = ref<HTMLElement | null>(null);
const forceUpdateState = ref<ForceUpdateState>(getCurrentForceUpdateState());
const isForceUpdateRequired = computed(() => forceUpdateState.value.required);

// 接诊胶囊状态：患者展示信息从 currentPatient 派生，其余状态只经 controller action 修改。
const receptionSession = useReceptionSessionController(currentPatient);
const {
  patientName: riskPatientName,
  patientGender: riskPatientGender,
  patientAgeText: riskPatientAgeText,
  risks: riskItems,
  isAnalyzing: isRiskAnalyzing,
  chronicRefillCandidate,
  chronicRefillGenerating,
  outpatientFollowUpContext,
  reportInterpretationVisits,
  reportAssistantOpening,
  patientMemoryStatus,
  patientMemoryBrief,
} = receptionSession;

// 语音问诊状态
const voiceInteractionSessionKey = ref(0);
const consultationAssistTrigger = ref<{ kind: ConsultationAssistAction; token: number } | null>(null);
const inpatientEmrRequest = ref<InpatientEmrGenerationRequest | null>(null);
const patientDisplayName = computed(
  () => getPatientContextName(currentPatient.value) || '未知患者'
);
const assistantTitle = computed(() => {
  switch (currentView.value) {
    case 'chat':
      return '全医慧助（PCIE）';
    case 'consultation':
      return currentPatient.value ? `智能问诊 - ${patientDisplayName.value}` : '智能问诊';
    case 'voice-consultation':
      if (intentResult.value?.channel === 'chronic-refill') {
        return currentPatient.value ? `复诊配药 - ${patientDisplayName.value}` : '复诊配药';
      }
      return currentPatient.value ? `语音问诊 - ${patientDisplayName.value}` : '语音问诊';
    case 'treatment-plan':
      return currentPatient.value ? `诊疗方案 - ${patientDisplayName.value}` : '诊疗方案';
    case 'outpatient-follow-up':
      return currentPatient.value ? `门诊复诊 - ${patientDisplayName.value}` : '门诊复诊';
    case 'report-interpretation':
      return currentPatient.value ? `报告助手 - ${patientDisplayName.value}` : '报告助手';
    case 'patient-memory':
      return currentPatient.value ? `健康画像 - ${patientDisplayName.value}` : '健康画像';
    case 'inpatient-emr':
      return '住院病历生成';
    case 'outpatient-emr':
      return '门诊模板分析';
    case 'differential-diagnosis':
      return currentPatient.value ? `鉴别诊断 - ${patientDisplayName.value}` : '鉴别诊断';
    case 'his-log':
      return 'HIS 联调日志';
    case 'medical-cache':
      return '缓存管理';
    case 'knowledge-base':
      return '知识库检索';
    default:
      return '系统设置';
  }
});
const showSessionEntry = computed(
  () =>
    Boolean(currentPatient.value) &&
    currentView.value !== 'consultation'
);
const feedbackDialogVisible = ref(false);
const feedbackDialogSuspended = ref(false);
const feedbackSourceModule = computed(() => `view:${currentView.value}`);
const feedbackConsultationId = computed(() => getPatientContextAnchorId(currentPatient.value) || '');

function openFeedbackDialog(): void {
  trackClick('open_global_feedback_dialog', { currentView: currentView.value });
  feedbackDialogVisible.value = true;
}

function closeFeedbackDialog(): void {
  feedbackDialogVisible.value = false;
  feedbackDialogSuspended.value = false;
}

function suspendFeedbackDialogForCapture(): void {
  feedbackDialogSuspended.value = true;
}

function resumeFeedbackDialogAfterCapture(): void {
  feedbackDialogSuspended.value = false;
}

function createMedicalCatalogDebugApi(): MedicalCatalogDebugApi {
  const printState = (state: MedicalCatalogDebugState): MedicalCatalogDebugState => {
    console.log('[MedicalCatalogDebug] State:', state);
    if (state.syncStates.length > 0) {
      console.table(state.syncStates);
    } else {
      console.info('[MedicalCatalogDebug] No sync state records');
    }
    return state;
  };

  return {
    help() {
      const messages = [
        'window.__medicalCatalogDebug__.state()  // 查看 SQLite 缓存状态',
        'window.__medicalCatalogDebug__.sync()  // 按当前机构上下文触发同步',
        "window.__medicalCatalogDebug__.sync('机构ID')  // 仅切换机构并同步",
        "window.__medicalCatalogDebug__.sync({ orgCode: '机构ID', tenantId: '租户ID' })  // 切换机构/租户并同步",
        'window.__medicalCatalogDebug__.clear()  // 清空全部目录缓存',
        "window.__medicalCatalogDebug__.clear({ catalogType: 'items', orgCode: '机构ID', tenantId: '租户ID' })  // 清理指定机构/租户的其他诊疗项目（检查检验不持久化）",
        "window.__medicalCatalogDebug__.clear({ catalogType: 'medicines', orgCode: '机构ID', tenantId: '租户ID', storeId: '药房ID' })  // 清理指定药房药品缓存",
        'window.__medicalCatalogDebug__.sample(5)  // 查看当前内存目录前几条'
      ];
      messages.forEach((message) => console.info(message));
      return messages;
    },
    async state() {
      return printState(await medicalDataService.getDebugState());
    },
    async sync(context?: string | MedicalCatalogContext | null) {
      if (typeof context !== 'undefined') {
        const nextContext = typeof context === 'string'
          ? { orgCode: context }
          : (context || {});
        await medicalDataService.setCatalogContext(nextContext);
      } else {
        await medicalDataService.ensureLocalCatalogsSynced();
      }
      return printState(await medicalDataService.getDebugState());
    },
    async clear(options: MedicalCatalogClearOptions = {}) {
      const result = await medicalDataService.clearDebugCache(options);
      console.log('[MedicalCatalogDebug] Clear result:', result);
      return result;
    },
    sample(limit = 10) {
      return {
        diagnoses: medicalDataService.getAllDiagnoses().slice(0, limit),
        items: medicalDataService.getAllItems().slice(0, limit),
        medicines: medicalDataService.getAllMedicines().slice(0, limit),
      };
    },
  };
}

function queueConsultationAssistTrigger(kind: ConsultationAssistAction): void {
  consultationAssistTrigger.value = {
    kind,
    token: Date.now(),
  };
}

function clearConsultationAssistTrigger(): void {
  consultationAssistTrigger.value = null;
}

async function openConsultationAssist(): Promise<void> {
  queueConsultationAssistTrigger('record');
  await openConsultation();
}

let store: Store | null = null;
const resizeTimeoutRef = ref<ReturnType<typeof setTimeout> | null>(null);
const storeRef = shallowRef<AppStore | null>(null);
const transitioning = ref(false);
const chronicRefillScopeSelecting = ref(false);
let unsubscribeForceUpdate: (() => void) | null = null;

// 初始化窗口管理 composable
const windowMgmt = useWindowManagement({
  appWindow,
  store: storeRef,
  isWorking,
  transitioning,
});

const {
  saveWindowPosition,
  updateCurrentMonitor,
  handleWindowMove,
  persistCurrentWindowSize,
} = windowMgmt;

const win7WindowRegion = useWin7WindowRegion({
  enabled: !isStandaloneWindow,
  isWorking,
  transitioning,
  isHovered,
  scaleFactor: computed(() => windowMgmt.cachedMonitor.value?.scaleFactor ?? null),
});

const windowTransition = useWindowTransitionCoordinator({
  currentView,
  isWorking,
  transitioning,
  windowMgmt,
  windowRegion: win7WindowRegion,
});

const getCurrentReceptionWindowSize = () => getWindowSizeForView('reception-capsule', {
  expanded: !isRiskAnalyzing.value && riskItems.value.length > 0,
  riskCount: riskItems.value.length,
  hasChronicRefill: Boolean(chronicRefillCandidate.value),
  chronicScopeSelecting: chronicRefillScopeSelecting.value,
  hasFollowUp: Boolean(outpatientFollowUpContext.value),
  hasReportInterpretation: reportInterpretationVisits.value.length > 0,
});

// 初始化工作模式 composable
const workMode = useWorkMode({
  appWindow,
  windowMgmt,
  windowTransition,
  currentView,
  isWorking,
  transitioning,
  isHovered,
  currentPatient,
  getReceptionWindowSize: getCurrentReceptionWindowSize,
});

// 解构工作模式 API
const { exiting, containerStyle, ballStyle } = workMode;
const { contentVisible } = windowTransition;
const { enterWorkMode, openReceptionCapsule, resizeReceptionCapsule, exitWork, handleCollapse } = workMode;

// 初始化导航管理 composable
const navigation = useNavigation({
  currentView,
  isWorking,
  currentPatient,
  windowTransition,
  workMode,
});

// 解构导航 API
const {
  openSettings,
  openChat,
  openKnowledgeBase,
  openHisIntegrationLog,
  openMedicalCatalogCache,
  openConsultation,
  openVoiceConsultation,
  openTreatmentPlan,
  openOutpatientFollowUp,
  openReportInterpretation,
  openPatientMemory,
  openInpatientEmr,
  openOutpatientEmr,
  openDifferentialDiagnosis,
  startVoiceInteraction: startVoiceInteractionBase,
} = navigation;

const outpatientEmrBridge = useOutpatientEmrBridgeController({
  openOutpatientEmr,
  onCancelled: () => exitWork('cancelled'),
  onCompleted: () => exitWork('completed'),
  notify: showToast,
  autoStart: !isStandaloneWindow,
});
const {
  activeRequest: outpatientEmrRequest,
  handleStartAnalysis: startOutpatientEmrAnalysis,
  cancelAnalysis: cancelOutpatientEmrAnalysisRaw,
  completeAnalysis: completeOutpatientEmrAnalysisRaw,
} = outpatientEmrBridge;

const voiceOutpatientEmrWorkflow = useVoiceOutpatientEmrWorkflow({
  currentPatient,
  startAnalysis: startOutpatientEmrAnalysis,
  notify: showToast,
});
const outpatientEmrBaseWritebackPayload = computed(() => (
  voiceOutpatientEmrWorkflow.resolveBaseWritebackPayload(outpatientEmrRequest.value)
));

async function cancelOutpatientEmrAnalysis(): Promise<void> {
  voiceOutpatientEmrWorkflow.clear();
  await cancelOutpatientEmrAnalysisRaw();
}

async function completeOutpatientEmrAnalysis(): Promise<void> {
  voiceOutpatientEmrWorkflow.clear();
  await completeOutpatientEmrAnalysisRaw();
}

// 初始化语音问诊 composable
let routeVoiceTranscriptScenario: ((transcript: string) => Promise<boolean>) | null = null;
const voiceConsultation = useVoiceConsultation({
  currentPatient,
  patientMemoryBrief,
  showToast,
  openVoiceConsultation,
  routeVoiceTranscript: (transcript) => (
    routeVoiceTranscriptScenario?.(transcript) || Promise.resolve(false)
  ),
  workMode: { exitWork },
});

// 解构语音问诊 API
const {
  intentResult,
  intentSource,
  isProcessingVoice,
  consultationRoundId,
  resetVoiceSessionState,
  beginGeneratedClinicalResult,
  completeGeneratedClinicalResult,
  failGeneratedClinicalResult,
  updateGeneratedClinicalResultProgress,
  updateGeneratedClinicalResultPartial,
  resumeCachedVoiceResult,
  hasCachedVoiceResult,
  handleVoiceStop,
  handleVoiceError,
  abandonVoiceCapture: abandonVoiceCaptureRaw,
  cancelVoiceResult: cancelVoiceResultRaw,
} = voiceConsultation;

// 最小化会话管理：记录从症状问诊 / 语音问诊收起到小球的现场，
// 用于通过悬浮球按钮 / 双击小球恢复。跨自然日自动失效。
const minimizedSessions = useMinimizedSessions();

// 语音问诊结束（取消）时一并清除最小化会话标记
async function cancelVoiceResult(): Promise<void> {
  voiceOutpatientEmrWorkflow.clear();
  await cancelVoiceResultRaw();
  minimizedSessions.clear('voice');
}

async function abandonVoiceCapture(): Promise<void> {
  voiceOutpatientEmrWorkflow.clear();
  await abandonVoiceCaptureRaw();
  minimizedSessions.clear('voice');
  if (!currentPatient.value) {
    await exitWork('cancelled');
    return;
  }
  await openReceptionCapsule(getCurrentReceptionWindowSize());
}

async function cancelSymptomConsultation(): Promise<void> {
  minimizedSessions.clear('symptom');
  await exitWork('cancelled');
}

async function closeTreatmentPlan(): Promise<void> {
  await handleUserCollapse();
}

async function closeReportInterpretationWorkspace(): Promise<void> {
  await handleUserCollapse();
}

async function closePatientMemoryWorkspace(): Promise<void> {
  await openReceptionCapsule(getCurrentReceptionWindowSize());
}

// 可见性/可点击门禁：
// 问诊按钮始终可见；在有活跃接诊患者或有未结束的最小化会话时可点击，
// 作为“恢复工作界面”的入口；否则置灰禁用。
const hasResumableConsultation = computed(() => {
  if (minimizedSessions.latestType.value === 'inpatient-emr') {
    return inpatientEmrRequest.value !== null;
  }
  return currentPatient.value !== null;
});

const resumableConsultationIcon = computed(() => {
  const latest = minimizedSessions.latestType.value;
  if (latest === 'voice') return 'lucide:mic';
  if (latest === 'inpatient-emr') return 'lucide:file-pen';
  if (latest === 'symptom') return 'lucide:stethoscope';
  return 'lucide:user';
});

const resumableConsultationTitle = computed(() => {
  if (!hasResumableConsultation.value) {
    return '暂无未结束的问诊或病历生成';
  }
  const latest = minimizedSessions.latestType.value;
  if (latest === 'inpatient-emr') return '恢复住院病历生成';
  if (latest === 'voice') return '恢复语音问诊';
  if (latest === 'symptom') return '恢复问诊界面';
  return '恢复患者接诊信息';
});

function recordInpatientEmrMinimizedSession(): void {
  const request = inpatientEmrRequest.value;
  if (!request?.admissionId) return;
  minimizedSessions.recordByAnchor('inpatient-emr', request.admissionId, {
    patientId: request.patient?.patientId || request.patient?.idPi,
    patientName: request.patient?.name || request.admissionId,
  });
}

function shouldRestoreInpatientEmrRequest(request: InpatientEmrGenerationRequest): boolean {
  const activeInpatientEmrSession = minimizedSessions.getActive('inpatient-emr');
  return Boolean(
    activeInpatientEmrSession
    && activeInpatientEmrSession.anchorId === request.admissionId
    && inpatientEmrRequest.value?.admissionId === request.admissionId,
  );
}

/**
 * 用户主动收起的统一入口：
 *  - 如果当前在症状问诊 / 语音问诊未结束的视图，记录最小化；
 *  - 问诊态会先回到接待胶囊；从接待胶囊再次关闭时才退出到球；
 *  - 接待胶囊自身不再覆写最小化类型，避免语音链路被误记成症状链路。
 */
async function handleUserCollapse(): Promise<void> {
  const startedFromSymptomConsultation = currentView.value === 'consultation' && !!currentPatient.value;

  if (startedFromSymptomConsultation && currentPatient.value) {
    minimizedSessions.record('symptom', currentPatient.value);
    await handleCollapse();
    return;
  } else if (currentView.value === 'voice-consultation' && currentPatient.value) {
    minimizedSessions.record('voice', currentPatient.value);
  } else if (currentView.value === 'inpatient-emr' && inpatientEmrRequest.value) {
    recordInpatientEmrMinimizedSession();
  } else if (
    currentView.value === 'voice-interaction' &&
    currentPatient.value &&
    currentPatient.value._receptionEnsured
  ) {
    // 语音采集页点击取消/收起：如果当前还有已接诊的患者上下文，
    // 返回接诊胶囊态，而不是一路退出到小球，避免医生丢失当前患者上下文。
    resetVoiceSessionState();
    const receptionSize = getCurrentReceptionWindowSize();
    try {
      await openReceptionCapsule(receptionSize);
    } catch (e) {
      console.warn('[App] Failed to switch back to reception capsule on voice cancel:', e);
    }
    return;
  }
  await handleCollapse();
}

/**
 * 点击悬浮球的"问诊"按钮：
 *  - 仅在存在未结束问诊会话时可点（由 hasResumableConsultation 控制）；
 *  - 点击后按"最后一次"原则恢复语音 / 症状问诊现场。
 *
 * 注意：不在这里清掉最小化记录。下一次再次收起时会以更新后的 timestamp 覆盖；
 * 真正清理发生在「会话完成 / 取消 / 跨自然日」时。
 */
async function handleConsultationRingClick(): Promise<void> {
  if (!hasResumableConsultation.value) return;
  const latest = minimizedSessions.latestType.value;
  if (latest === 'voice' && currentPatient.value) {
    await openVoiceConsultation();
    return;
  }
  if (latest === 'inpatient-emr' && inpatientEmrRequest.value) {
    await openInpatientEmr();
    return;
  }
  if (latest === 'symptom' && currentPatient.value) {
    await openConsultation();
    return;
  }
  if (currentPatient.value) {
    const targetSize = getCurrentReceptionWindowSize();
    await openReceptionCapsule(targetSize);
    return;
  }
  await openConsultation();
}

/**
 * 双击悬浮球：
 *  - 优先恢复最近一次最小化的会话（症状问诊或语音问诊）；
 *  - 否则维持原行为（打开聊天）。
 *
 * 与症状问诊按钮一样，恢复后不主动清最小化记录，让下一次收起时再覆盖；
 * 这样医生在多个会话之间来回切换时不会丢失"还有未完会话"的信号。
 */
async function handleBallDblClick(): Promise<void> {
  const latest = minimizedSessions.latestType.value;
  if (latest === 'voice' && currentPatient.value) {
    await openVoiceConsultation();
    return;
  }
  if (latest === 'symptom' && currentPatient.value) {
    await openConsultation();
    return;
  }
  if (latest === 'inpatient-emr' && inpatientEmrRequest.value) {
    await openInpatientEmr();
    return;
  }
  if (currentPatient.value) {
    const targetSize = getCurrentReceptionWindowSize();
    await openReceptionCapsule(targetSize);
    return;
  }
  await openChat();
}

function handleBallKeyboardActivate(event: MouseEvent): void {
  if (event.detail === 0) void handleBallDblClick();
}

const keyboardShortcutsEnabled = computed(() => (
  !isStandaloneWindow
  && !isForceUpdateRequired.value
  && !transitioning.value
  && !feedbackDialogVisible.value
));
const {
  bindings: keyboardShortcutBindings,
  updateBindings: updateKeyboardShortcuts,
} = useAppKeyboardShortcuts({
  enabled: keyboardShortcutsEnabled,
  actions: {
    'toggle-assistant': () => (isWorking.value ? handleUserCollapse() : handleBallDblClick()),
    'open-chat': openChat,
    'open-settings': openSettings,
  },
});

async function cancelInpatientEmrGeneration(): Promise<void> {
  minimizedSessions.clear('inpatient-emr');
  inpatientEmrRequest.value = null;
  await exitWork('cancelled');
}

async function completeInpatientEmrGeneration(): Promise<void> {
  minimizedSessions.clear('inpatient-emr');
  inpatientEmrRequest.value = null;
  await exitWork('completed');
}

async function startVoiceInteraction(options?: { skipCacheRestore?: boolean }): Promise<void> {
  resetVoiceSessionState();
  if (!options?.skipCacheRestore && await resumeCachedVoiceResult()) {
    return;
  }
  voiceInteractionSessionKey.value += 1;
  await startVoiceInteractionBase();
}

const handleFocus = () => { isFocused.value = true; };
const handleBlur = () => { isFocused.value = false; };

// 关闭风险提示界面
const closeRiskAlert = async () => {
  chronicRefillScopeSelecting.value = false;
  await exitWork();
};

const handleRiskExpand = async (expanded: boolean) => {
  console.log('[App] handleRiskExpand:', expanded);
  const targetSize = getWindowSizeForView('reception-capsule', {
    expanded,
    riskCount: riskItems.value.length,
    hasChronicRefill: Boolean(chronicRefillCandidate.value),
    chronicScopeSelecting: chronicRefillScopeSelecting.value,
    hasFollowUp: Boolean(outpatientFollowUpContext.value),
    hasReportInterpretation: reportInterpretationVisits.value.length > 0,
  });

  try {
    await windowTransition.resizeCurrentView(targetSize, { resizable: false });
  } catch (e) {
    console.error('Failed to resize for risk details:', e);
  }
};

const handleChronicRefillScopeSelecting = async (selecting: boolean) => {
  chronicRefillScopeSelecting.value = selecting;
  try {
    await windowTransition.resizeCurrentView(getCurrentReceptionWindowSize(), { resizable: false });
  } catch (error) {
    console.error('Failed to resize chronic refill scope selector:', error);
  }
};

// 初始化事件监听管理 composable
const eventListeners = useEventListeners({
  appWindow,
  currentView,
  isWorking,
  transitioning,
  isHovered,
  hoveredBtnIndex,
  ringMenuRef,
  currentPatient,
  inpatientEmrRequest,
  shouldRestoreInpatientEmrRequest,
  clearMinimizedInpatientEmrSession: () => minimizedSessions.clear('inpatient-emr'),
  receptionSession,
  showToast,
  handleWindowMove,
  persistCurrentWindowSize,
  workMode: { enterWorkMode, openReceptionCapsule, resizeReceptionCapsule, exitWork },
  navigation: { openConsultation, openVoiceConsultation, openTreatmentPlan, openOutpatientFollowUp, openReportInterpretation, openInpatientEmr, openDifferentialDiagnosis, startVoiceInteraction },
  generatedClinicalResultSession: {
    begin: beginGeneratedClinicalResult,
    updateProgress: updateGeneratedClinicalResultProgress,
    updatePartial: updateGeneratedClinicalResultPartial,
    complete: completeGeneratedClinicalResult,
    fail: failGeneratedClinicalResult,
  },
  resetVoiceSessionState,
  clearVoiceConsultationCache,
  clearMinimizedConsultationSessions: minimizedSessions.clearAll,
  hasCachedVoiceResult,
  queueConsultationAssistTrigger,
  prepareVoiceOutpatientEmr: voiceOutpatientEmrWorkflow.prepareFromStartVoice,
  clearVoiceOutpatientEmr: voiceOutpatientEmrWorkflow.clear,
  getVoiceOutpatientEmrRequestId: () => (
    voiceOutpatientEmrWorkflow.deferredWritebackRequestId.value || null
  ),
  simulateVoiceTranscript: (transcript) => handleVoiceStop(
    new Blob([], { type: 'audio/wav' }),
    transcript,
  ),
  requestChronicRefillScopeSelection: async () => {
    chronicRefillScopeSelecting.value = true;
    await openReceptionCapsule(getCurrentReceptionWindowSize());
  },
  exiting,
  resizeTimeoutRef,
});
routeVoiceTranscriptScenario = eventListeners.routeVoiceTranscript;

async function applyForceUpdateWindowState(state: ForceUpdateState): Promise<void> {
  const wasRequired = forceUpdateState.value.required;
  forceUpdateState.value = state;
  if (isStandaloneWindow) {
    return;
  }
  if (!state.required) {
    // 防御：强升状态从 true → false（如服务端解除策略 / 网络恢复后重新拉取）时，
    // 把之前为了显示升级页强行撑开的窗口恢复成小球态，避免用户卡在已无内容的工作面板上。
    if (wasRequired) {
      try {
        await handleCollapse();
      } catch (error) {
        console.warn('[App] Failed to collapse after force update lifted:', error);
      }
    }
    return;
  }
  feedbackDialogVisible.value = false;
  feedbackDialogSuspended.value = false;
  isWorking.value = true;
  try {
    if (appWindow.value) {
      await windowTransition.transitionToView('settings', {
        size: { width: 760, height: 620 },
        resizable: true,
      });
      await appWindow.value.show();
      await appWindow.value.setFocus();
    }
  } catch (error) {
    console.warn('[App] Failed to apply force update window state:', error);
  }
}

// 监听状态变化并持久化
watch([isWorking, currentView], async () => {
  if (isStandaloneWindow) return;
  if (!store) return;
  try {
    await store.set('app_state', {
      isWorking: isWorking.value,
      currentView: currentView.value
    });
    await store.save();
  } catch (err) {
    console.error('保存应用状态失败:', err);
  }
});

onMounted(async () => {
  try {
    appWindow.value = getCurrentWindow();

    if (isStandaloneWindow) {
      await appWindow.value.show();
      await appWindow.value.setFocus();
      return;
    }

        // 初始化 store
        try {
          store = await load('.settings.dat');
          storeRef.value = store;
        } catch (storeErr) {
          console.warn('[App] ⚠️ Failed to load store:', storeErr);
        }
        
        // 恢复应用状态
        try {
            console.log('[App] 🌟 Application starting. mode: Floating Ball');
            isWorking.value = false;
            currentView.value = 'chat';
            
            if (appWindow.value) {
                await windowMgmt.resizeWorkWindow(
                  WINDOW_SIZES.BALL.width,
                  WINDOW_SIZES.BALL.height,
                  { minSize: WINDOW_SIZES.BALL, resizable: false },
                );
                
                // 【核心修复】：不要在这里调用 restoreWindowPosition！
                // 因为 Rust 后端已经在窗口启动前，读取本地文件并完美赋予了物理坐标。
                // 如果在这里使用基于 Tauri-Plugin-Store 的 JS API 读取，刚启动时极易读取异步落后得到空值，
                // 导致 fallback 到了 (200, 200)，从而强行把位置给毁了。
                // 我们只需把当前真实位置同步给内存状态即可：
                try {
                    const currentPos = await appWindow.value.outerPosition();
                    windowMgmt.lastBallPos.value = { x: currentPos.x, y: currentPos.y };
                    console.log('[App] Synchronized Rust position to Vue memory:', currentPos);
                } catch (posErr) {
                    console.warn('[App] Failed to read outer position:', posErr);
                }
            }
        } catch (err) {
          console.warn('[App] ⚠️ Initialization state failed:', err);
        }

    unsubscribeForceUpdate = subscribeForceUpdateRequired((state) => {
      void applyForceUpdateWindowState(state);
    });
    void checkForceUpdateRequired().then(applyForceUpdateWindowState);

    // 注册所有事件监听
    await eventListeners.registerAllListeners();

    // Initial monitor update
    updateCurrentMonitor();

    window.__medicalCatalogDebug__ = createMedicalCatalogDebugApi();
    console.info('[MedicalCatalogDebug] Debug API ready: window.__medicalCatalogDebug__');
  } catch (e) {
    console.warn("初始化窗口失败:", e);
  }
});

onUnmounted(() => {
  delete window.__medicalCatalogDebug__;
  if (unsubscribeForceUpdate) {
    unsubscribeForceUpdate();
    unsubscribeForceUpdate = null;
  }
  if (!isStandaloneWindow) {
    eventListeners.unregisterAllListeners();
  }
});

// 使用 Tauri 原生拖拽
const handleMouseDown = async (e: MouseEvent) => {
  // 只有左键且在球体上才能拖拽 (利用 target 判断，避免拖拽按钮)
  const target = e.target as HTMLElement;
  if (e.button === 0 && appWindow.value && target.closest('.floating-ball')) {
    try {
      await appWindow.value.startDragging();
    } catch (error) {
      console.error('拖拽失败:', error);
    }
  }
};


// 退出应用
const handleExitApp = async (e: MouseEvent) => {
  e.preventDefault();
  trackClick('exit_app');
  try {
    // 退出前强制保存一次位置
    console.log('[App] 🚪 App exiting, triggering final position save...');
    await saveWindowPosition(true);
    await exit(0);
  } catch (err) {
    console.error('[App] ❌ Failed to exit app:', err);
    // 降级方案
    if (appWindow.value) {
      await appWindow.value.close();
    }
  }
};


</script>

<template>
  <DiagnosisPathWindow v-if="isDiagnosisPathWindow" />
  <ReportInterpretationWindow v-else-if="isReportInterpretationWindow" />
  <template v-else>
  <a href="#main-content" class="skip-link">跳转到主要内容</a>

  <div class="state-layer" id="main-content" tabindex="-1">
    <Transition name="morph">
      <div v-show="!isWorking" class="ball-layer" :class="{ 'is-content-hidden': !contentVisible }" :style="containerStyle">
        <div 
          class="ball-container" 
          :class="{ 'no-interaction': transitioning }"
          :style="ballStyle"
        >
          <!-- 环绕菜单 -->
          <div ref="ringMenuRef" class="ring-menu" :class="{ 'is-active': isHovered }" role="navigation" aria-label="主菜单">
            <button
              type="button"
              class="ring-btn right"
              :tabindex="isHovered ? 0 : -1"
              :class="{ 'manual-hover': hoveredBtnIndex === 1 }"
              @click.stop="openChat"
              aria-label="打开对话"
              title="打开对话"
            >
              <svgIcon file="/chat.svg" :color="'#262626'" :hoverColor="'#2B7FE3'" :fontSize="'18px'"></svgIcon>
            </button>
            <button
              type="button"
              class="ring-btn bottom"
              :tabindex="isHovered ? 0 : -1"
              :class="{ 'manual-hover': hoveredBtnIndex === 2 }"
              @click.stop="openSettings"
              aria-label="打开设置"
              title="设置"
            >
              <svgIcon file="/setting.svg" :color="'#262626'" :hoverColor="'#2B7FE3'" :fontSize="'18px'"></svgIcon>
            </button>
            <button
              type="button"
              class="ring-btn top"
              :tabindex="isHovered ? 0 : -1"
              :class="{ 'manual-hover': hoveredBtnIndex === 0 }"
              @click.stop="handleExitApp"
              aria-label="退出应用"
              title="退出"
            >
              <svgIcon file="/off.svg" :color="'#262626'" :hoverColor="'#2B7FE3'" :fontSize="'18px'"></svgIcon>
            </button>
	             <button
	              type="button"
	              class="ring-btn left"
	              :tabindex="isHovered ? 0 : -1"
	              :class="{ 'manual-hover': hoveredBtnIndex === 3, 'is-disabled': !hasResumableConsultation }"
	              :disabled="!hasResumableConsultation"
	              @click.stop="handleConsultationRingClick"
                :aria-label="resumableConsultationTitle"
                :title="resumableConsultationTitle"
	            >
                <Icon :icon="resumableConsultationIcon" :size="18" class="ring-btn-icon" aria-hidden="true" />
            </button>
          </div>
          
          <button
            type="button"
            class="floating-ball"
            aria-label="打开或恢复全医慧助（PCIE）"
            :class="{ 'is-focused': isFocused, 'is-hovered': isHovered }"
            @click="handleBallKeyboardActivate"
            @mousedown="handleMouseDown"
            @focus="handleFocus"
            @blur="handleBlur"
            @contextmenu.stop
            @dblclick="handleBallDblClick"
          >
            <div class="ball-content">
              <img 
                class="robot-avatar" 
                src="/robot-avatar.png"
                alt=""
                draggable="false"
              />
            </div>
          </button>
        </div>
      </div>
    </Transition>
    <Transition name="morph">
      <div v-show="isWorking" class="assistant-layer" :style="containerStyle">
        <div 
          class="assistant-container" 
          :class="{ 'no-toolbar': isForceUpdateRequired || currentView === 'risk-alert' || currentView === 'voice-interaction' || currentView === 'reception-capsule' || currentView === 'differential-diagnosis', 'is-content-hidden': !contentVisible, 'is-large-workspace': isLargeWorkspaceView(currentView) }"
          :style="currentView === 'reception-capsule' || currentView === 'differential-diagnosis' ? { borderRadius: '16px', background: 'transparent', backdropFilter: 'none', WebkitBackdropFilter: 'none', border: 'none', boxShadow: 'none' } : currentView === 'chat' ? { borderRadius: '8px', paddingTop: '0' } : { borderRadius: '20px' }"
        >
          <ForceUpdateGate v-if="isForceUpdateRequired" :state="forceUpdateState" />
          <template v-else>
          <!-- 工具栏 (risk-alert, voice-interaction, reception-capsule 视图不显示) -->
          <div v-if="currentView !== 'risk-alert' && currentView !== 'voice-interaction' && currentView !== 'reception-capsule' && currentView !== 'differential-diagnosis' && currentView !== 'chat'" class="assistant-toolbar" data-tauri-drag-region>
            <div class="toolbar-left" data-tauri-drag-region>
	              <button v-if="currentView === 'settings' || currentView === 'his-log' || currentView === 'medical-cache' || currentView === 'knowledge-base' || currentView === 'treatment-plan' || currentView === 'outpatient-follow-up' || currentView === 'report-interpretation' || currentView === 'inpatient-emr' || currentView === 'outpatient-emr'" class="icon-btn back-btn" @click="currentView === 'report-interpretation' ? closeReportInterpretationWorkspace() : handleUserCollapse()" title="返回">
	                 <Icon icon="lucide:arrow-left" class="toolbar-icon" size="20" />
	              </button>
	              <span class="assistant-title" data-tauri-drag-region>{{ assistantTitle }}</span>
	            </div>
	            <div class="toolbar-right" style="display: flex; gap: 8px;">
	              <button
	                v-if="showSessionEntry"
	                class="icon-btn"
	                aria-label="灵活触发"
	                title="灵活触发"
	                @click="openConsultationAssist"
	              >
	                <Icon icon="lucide:sparkles" class="toolbar-icon" size="20" />
	              </button>
	              <button class="icon-btn" aria-label="知识库" title="知识库" @click="openKnowledgeBase">
	                <Icon icon="lucide:book-open" class="toolbar-icon" size="20" />
	              </button>
                <button class="icon-btn feedback-entry-btn" aria-label="问题反馈" title="问题反馈" @click="openFeedbackDialog">
                  <Icon icon="lucide:message-square-warning" class="toolbar-icon" size="20" />
                </button>
              <button class="icon-btn" aria-label="收起" title="收起" @click="handleUserCollapse">
                <Icon icon="lucide:chevron-down" class="toolbar-icon" size="20" />
              </button>
            </div>
          </div>
          <!-- 问诊页面用 v-show 保持常驻，避免切换视图时组件销毁导致数据丢失 -->
          <ConsultationPage
            v-show="currentView === 'consultation'"
            :active="currentView === 'consultation'"
            @close="handleUserCollapse"
            @cancel="cancelSymptomConsultation"
            :initialPatientData="currentPatient ?? undefined"
            :assistTrigger="consultationAssistTrigger"
            @consume-auto-trigger="clearConsultationAssistTrigger"
          />
          <ChatPanel
            v-if="currentView === 'chat'"
            @open-consultation-assist="openConsultationAssist"
            @open-inside-cloud-home="openKnowledgeBase"
            @open-feedback-dialog="openFeedbackDialog"
            @handle-user-collapse="handleUserCollapse"
          />
          <RiskAlertPanel
            v-if="currentView === 'risk-alert'"
            :patientName="riskPatientName"
            :gender="riskPatientGender"
            :age-text="riskPatientAgeText"
            :risks="riskItems"
            @close="closeRiskAlert"
            @confirm="closeRiskAlert"
          />
          <!-- Voice Interaction View -->
          <VoiceCapsule
            :key="voiceInteractionSessionKey"
            v-if="currentView === 'voice-interaction'"
            :processing="isProcessingVoice"
            @stop="handleVoiceStop"
            @error="handleVoiceError"
            @abandon="abandonVoiceCapture"
            @close="handleUserCollapse"
            @window-stage-change="windowTransition.resizeVoiceInteractionStage"
          />

          <!-- Reception Service (Risk) Capsule -->
          <ReceptionCapsule
            v-if="currentView === 'reception-capsule'"
            :patient-name="riskPatientName"
            :gender="riskPatientGender"
            :age-text="riskPatientAgeText"
            :risks="riskItems"
            :analyzing="isRiskAnalyzing"
            :chronic-refill-candidate="chronicRefillCandidate"
            :chronic-refill-generating="chronicRefillGenerating"
            :chronic-scope-selecting="chronicRefillScopeSelecting"
            :outpatient-follow-up-context="outpatientFollowUpContext"
            :report-interpretation-visits="reportInterpretationVisits"
            :report-assistant-opening="reportAssistantOpening"
            :patient-memory-status="patientMemoryStatus"
            :patient-memory-brief="patientMemoryBrief"
            @close="closeRiskAlert"
            @toggle-expand="handleRiskExpand"
            @chronic-scope-selecting="handleChronicRefillScopeSelecting"
            @confirm-chronic-refill="eventListeners.confirmChronicRefill"
            @confirm-report-assistant="eventListeners.confirmReportAssistant"
            @open-patient-memory="openPatientMemory"
          />

          <PatientMemoryWorkspace
            v-if="currentView === 'patient-memory'"
            :patient="currentPatient"
            :brief="patientMemoryBrief"
            @close="closePatientMemoryWorkspace"
          />

          <HisIntegrationLogPanel v-if="currentView === 'his-log'" />
          <MedicalCatalogCachePanel v-if="currentView === 'medical-cache'" />
          <ConsultationResultPage
            v-if="currentView === 'voice-consultation'"
            :initialPatientData="currentPatient ?? undefined"
            :intentResult="intentResult"
            :intentSource="intentSource"
            :consultationRoundId="consultationRoundId"
            :processing="isProcessingVoice"
            :channel="intentResult?.channel"
            :deferred-writeback-request-id="voiceOutpatientEmrWorkflow.deferredWritebackRequestId.value"
            @close="handleUserCollapse"
            @cancel="cancelVoiceResult"
            @writeback-prepared="voiceOutpatientEmrWorkflow.handleWritebackPrepared"
          />
          <TreatmentPlanPage
            v-if="currentView === 'treatment-plan'"
            :patient="currentPatient"
            @close="closeTreatmentPlan"
          />
          <OutpatientFollowUpPage
            v-if="currentView === 'outpatient-follow-up'"
            :patient="currentPatient"
            :context="outpatientFollowUpContext"
            @close="closeTreatmentPlan"
          />
          <ReportInterpretationWorkspace
            v-if="currentView === 'report-interpretation'"
            :patient="currentPatient"
            :visits="reportInterpretationVisits"
            :follow-up-context="outpatientFollowUpContext"
            @open-follow-up="eventListeners.confirmFollowUp"
          />
          <InpatientEmrPage
            v-show="currentView === 'inpatient-emr'"
            :request="inpatientEmrRequest"
            :active="currentView === 'inpatient-emr'"
            @close="handleUserCollapse"
            @cancel="cancelInpatientEmrGeneration"
            @completed="completeInpatientEmrGeneration"
          />
          <OutpatientEmrPage
            v-show="currentView === 'outpatient-emr'"
            :request="outpatientEmrRequest"
            :base-writeback-payload="outpatientEmrBaseWritebackPayload"
            @close="handleUserCollapse"
            @cancel="cancelOutpatientEmrAnalysis"
            @completed="completeOutpatientEmrAnalysis"
          />
          <DifferentialDiagnosisModalPage
            v-if="currentView === 'differential-diagnosis'"
            :patient="currentPatient"
            @close="handleUserCollapse"
          />
          <KnowledgeBasePanel v-if="currentView === 'knowledge-base'" @close="handleUserCollapse" />
          <SettingsPanel
            v-if="currentView === 'settings'"
            :keyboard-shortcuts="keyboardShortcutBindings"
            @open-medical-cache="openMedicalCatalogCache"
            @open-his-log="openHisIntegrationLog"
            @save-keyboard-shortcuts="updateKeyboardShortcuts"
          />
          </template>
        </div>
      </div>
    </Transition>
  </div>
  <Transition name="fade">
    <div
      v-if="feedbackDialogVisible && !isForceUpdateRequired"
      class="feedback-overlay"
      :class="{ 'feedback-overlay--suspended': feedbackDialogSuspended }"
      @click.self="closeFeedbackDialog"
    >
      <div class="feedback-dialog">
        <FeedbackSubmissionPanel
          variant="dialog"
          :consultation-id="feedbackConsultationId || undefined"
          :source-module="feedbackSourceModule"
          @close="closeFeedbackDialog"
          @submitted="closeFeedbackDialog"
          @screenshot-capture-start="suspendFeedbackDialogForCapture"
          @screenshot-capture-end="resumeFeedbackDialogAfterCapture"
        />
      </div>
    </div>
  </Transition>
  <Toast ref="toastRef" />
  </template>
</template>

<style scoped>
.ball-container {
  width: 160px;
  height: 160px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 0;
  left: 0;
  background: transparent;
  pointer-events: auto;
}

/* 动画过程中禁用交互，防止环绕菜单误触发 */
.ball-container.no-interaction {
  pointer-events: none !important;
}
.ball-container.no-interaction .ring-menu {
  display: none;
}

.floating-ball {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: linear-gradient(135deg, #4DA2FF 0%, #2B7FE3 50%, #1A6FD5 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
  padding: 0;
  border: 0;
  user-select: none;
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  will-change: transform, box-shadow;
  transform: translateZ(0);
  position: relative;
  z-index: 5;
  box-shadow:
    0 2px 8px rgba(43, 127, 227, 0.3),
    0 4px 16px rgba(43, 127, 227, 0.15);
}

.floating-ball:focus-visible {
  outline: 3px solid #fff;
  outline-offset: 4px;
  box-shadow: 0 0 0 7px rgba(43, 127, 227, 0.38), 0 4px 16px rgba(43, 127, 227, 0.3);
}

/* 呼吸光晕动画 */
.floating-ball::before {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(77, 162, 255, 0.4), rgba(43, 127, 227, 0.2));
  z-index: -1;
  opacity: 0.6;
  animation: ball-breathe 3s ease-in-out infinite;
}

@keyframes ball-breathe {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.15); opacity: 0.7; }
}

/* 环绕菜单层 */
.ring-menu {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 1;
}

/* 展开时的柔和光晕背景 */
/* .ring-menu::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 130px;
  height: 130px;
  margin-top: -65px;
  margin-left: -65px;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    rgba(240, 245, 255, 0.92) 0%,
    rgba(235, 243, 255, 0.75) 45%,
    rgba(230, 240, 255, 0.3) 70%,
    transparent 100%
  );
  opacity: 0;
  transform: scale(0.5);
  transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: -1;
} */

.ring-menu.is-active::before {
  opacity: 1;
  transform: scale(1);
}

/* JS 驱动 (is-active) 或 CSS 原生 Hover 均可触发 */
.ring-menu.is-active {
  pointer-events: auto;
}

/* .floating-ball:hover,
.floating-ball.is-hovered {
  transform: scale(1.08);
  box-shadow:
    0 3px 12px rgba(43, 127, 227, 0.35),
    0 6px 24px rgba(43, 127, 227, 0.2);
}

.floating-ball:hover::before,
.floating-ball.is-hovered::before {
  animation-play-state: paused;
  opacity: 0.8;
  transform: scale(1.2);
} */

/* 环绕菜单按钮 */
.ring-btn {
  position: absolute;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(43, 127, 227, 0.08);
  background: rgba(255, 255, 255, 0.92);
  color: #6B7B8D;
  box-shadow:
    0 1px 4px rgba(0, 0, 0, 0.06),
    0 2px 8px rgba(43, 127, 227, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transform: scale(0.3);
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.ring-menu.is-active .ring-btn {
  opacity: 1;
  pointer-events: auto;
  transform: scale(1);
}

/* 按钮依次弹出的延迟动画 */
.ring-menu.is-active .ring-btn.top { transition-delay: 0ms; }
.ring-menu.is-active .ring-btn.right { transition-delay: 40ms; }
.ring-menu.is-active .ring-btn.bottom { transition-delay: 80ms; }
.ring-menu.is-active .ring-btn.left { transition-delay: 120ms; }

.ring-btn:hover,
.ring-btn.manual-hover {
  background: #fff;
  color: #2B7FE3;
  border-color: rgba(43, 127, 227, 0.2);
  transform: scale(1.12) !important;
  box-shadow:
    0 2px 8px rgba(43, 127, 227, 0.15),
    0 4px 16px rgba(43, 127, 227, 0.1);
}

.ring-btn:active {
  transform: scale(0.95) !important;
  transition-duration: 0.1s;
}

.ring-btn.is-disabled,
.ring-btn:disabled {
  cursor: not-allowed;
  /* opacity: 0.4; */
  filter: grayscale(0.6);
}

.ring-btn.is-disabled:hover,
.ring-btn:disabled:hover {
  background: rgba(255, 255, 255, 0.92);
  color: inherit;
  border-color: rgba(43, 127, 227, 0.08);
  transform: none !important;
  box-shadow:
    0 2px 8px rgba(43, 127, 227, 0.06),
    0 4px 16px rgba(43, 127, 227, 0.04);
}

/* 禁用状态下：让图标本身不响应 hover 颜色切换，避免“看上去还可点”的误导；
   但仍保留按钮外圈的 cursor: not-allowed 作为禁用标识。 */
.ring-btn.is-disabled .svg-icon,
.ring-btn:disabled .svg-icon,
.ring-btn.is-disabled .ring-btn-icon,
.ring-btn:disabled .ring-btn-icon {
  pointer-events: none;
}

.ring-icon { width: 16px; height: 16px; stroke-width: 1.8; }

/* 按钮分布位置 */
.ring-btn.top { top: 4px; left: 47%; margin-left: -17px; }
.ring-btn.right { top: 50%; right: 4px; margin-top: -17px; }
.ring-btn.bottom { bottom: 4px; left: 47%; margin-left: -17px; }
.ring-btn.left { top: 50%; left: 4px; margin-top: -17px; }

/* 未激活时的收缩动画 */
.ring-menu:not(.is-active):not(div:hover > *) .ring-btn.top { transform: translateY(12px) scale(0.1); }
.ring-menu:not(.is-active):not(div:hover > *) .ring-btn.right { transform: translateX(-12px) scale(0.1); }
.ring-menu:not(.is-active):not(div:hover > *) .ring-btn.bottom { transform: translateY(-12px) scale(0.1); }
.ring-menu:not(.is-active):not(div:hover > *) .ring-btn.left { transform: translateX(12px) scale(0.1); }

.ball-content {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  position: relative;
  z-index: 2;
}

.robot-avatar {
  width: 56x;
  height: 56px;
  border-radius: 50%;
  object-fit: cover;
  transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
  pointer-events: none;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1));
}

.floating-ball:hover .robot-avatar,
.floating-ball.is-hovered .robot-avatar {
  transform: scale(1.06);
}

.tooltip {
  display: none;
}

.feedback-entry-btn {
  color: #f97316;
}

.feedback-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 72px 24px 24px;
  background: rgba(15, 23, 42, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

.feedback-dialog {
  width: min(720px, calc(100vw - 48px));
  max-height: calc(100vh - 96px);
  overflow: auto;
  border-radius: 24px;
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.22);
}

.feedback-overlay--suspended {
  opacity: 0;
  pointer-events: none;
}

</style>

<style>
/* 导入统一设计令牌 - 医疗产品设计系统 */
@import './styles/design-tokens.css';

/**
 * 应用特定的变量覆盖
 *
 * 注意：大部分样式已迁移到独立的 CSS 模块
 * - global.css: 全局基础样式
 * - layouts/app-layout.css: 布局和容器样式
 * - animations/morph.css: 过渡动画
 *
 * 此处仅保留应用特定的变量覆盖
 */
:root {
  /* 玻璃态效果 - 使用自定义透明度以适配浮动球设计 */
  --surface-glass: rgba(255, 255, 255, 0.65);
  --surface-glass-weak: rgba(255, 255, 255, 0.45);
}
</style>
