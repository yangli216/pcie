/**
 * 事件监听管理 Composable
 *
 * 统一管理应用的所有事件监听，包括：
 * - Deep Link 监听
 * - HIS 集成事件监听（患者风险、问诊控制等）
 * - 鼠标事件监听（hover、position）
 * - 窗口事件监听（move、resize）
 *
 * @module composables/useEventListeners
 */

import { type Ref } from 'vue';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import type { Event as TauriEvent, UnlistenFn } from '@tauri-apps/api/event';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { supportsPersistentWindowSize, type ViewType } from '../constants/windowSizes';
import { openReportInterpretationWindow } from '../services/reportInterpretation';
import { trackApiCall, trackError } from '../services/operationTracker';
import {
  trackConsultationAssistEntry,
  trackSmartConsultationEntry,
  trackVoiceConsultationEntry,
} from '../services/featureUsageEntryTracker';
import {
  resolveIncomingPatientTracking,
  useOutpatientScenarioRouter,
  type ReceptionSessionController,
} from '@features/reception';
import type { AppPatient } from '../types/appState';
import {
  normalizeConsultationAssistAction,
  type ConsultationAssistAction,
} from '../types/consultationAssist';
import type { ReportInterpretationRequestPayload } from '../types/reportInterpretation';
import type { InpatientEmrGenerationRequest } from '@features/inpatient-emr';
import {
  buildOutpatientFollowUpPatientOverrides,
  fetchOutpatientFollowUpContext,
} from '@features/outpatient-follow-up/api/outpatientFollowUpContext';
import { getPatientContextId } from '../utils/patientContext';
import { useTauriEventListener } from '@shared/composables/useTauriEventListener';
import { formatUserFacingError } from '@shared/lib/errorMessages';
import {
  useReceptionController,
  type PatientRisksPayload,
  type SessionAssistPayload,
  type StartConsultationPayload,
} from '@app/events/useReceptionController';
import { usePatientMemorySync } from '@features/patient-memory';
import {
  useSdkHandshakeController,
  type SdkHandshakePayload,
} from '@app/events/useSdkHandshakeController';
import { generateChronicRefillRecord } from '@features/reception-risk';
import type {
  ClinicalResultGenerationStage,
  ClinicalResultInput,
} from '@features/clinical-result';
import {
  resolveSimulatedVoiceTranscript,
  type SimulatedVoiceTranscriptPayload,
} from '@features/voice-consultation';

/**
 * 事件监听配置参数
 */
export interface EventListenersOptions {
  /** Tauri 窗口实例引用 */
  appWindow: Ref<TauriWindow | null>;
  /** 当前视图 */
  currentView: Ref<ViewType>;
  /** 是否处于工作模式 */
  isWorking: Ref<boolean>;
  /** 是否正在过渡动画中 */
  transitioning: Ref<boolean>;
  /** 是否悬停 */
  isHovered: Ref<boolean>;
  /** 悬停按钮索引 */
  hoveredBtnIndex: Ref<number>;
  /** 环绕菜单 DOM 引用 */
  ringMenuRef: Ref<HTMLElement | null>;
  /** 当前患者信息 */
  currentPatient: Ref<AppPatient | null>;
  /** 住院病历生成请求 */
  inpatientEmrRequest: Ref<InpatientEmrGenerationRequest | null>;
  /** 是否应复用当前最小化的住院病历生成现场 */
  shouldRestoreInpatientEmrRequest?: (request: InpatientEmrGenerationRequest) => boolean;
  /** 清理住院病历最小化恢复入口 */
  clearMinimizedInpatientEmrSession?: () => void;
  /** 接诊胶囊局部状态 */
  receptionSession: ReceptionSessionController;
  /** Toast 提示函数 */
  showToast: (msg: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  /** 窗口移动处理函数 */
  handleWindowMove: () => void;
  /** 窗口大小持久化函数 */
  persistCurrentWindowSize: (view: ViewType) => Promise<void>;
  /** 工作模式相关函数 */
  workMode: {
    enterWorkMode: (customW?: number, customH?: number) => Promise<void>;
    openReceptionCapsule: (size: { width: number; height: number }) => Promise<void>;
    resizeReceptionCapsule: (size: { width: number; height: number }) => Promise<void>;
    exitWork: (sessionStatus?: 'completed' | 'cancelled' | 'error') => Promise<void>;
  };
  /** 导航函数 */
  navigation: {
    openConsultation: () => Promise<void>;
    openVoiceConsultation: () => Promise<void>;
    openTreatmentPlan: () => Promise<void>;
    openOutpatientFollowUp: () => Promise<void>;
    openReportInterpretation: () => Promise<void>;
    openInpatientEmr: () => Promise<void>;
    openDifferentialDiagnosis: () => Promise<void>;
    startVoiceInteraction: (options?: { skipCacheRestore?: boolean }) => Promise<void>;
  };
  /** 非语音场景共享结果页的生成会话；用于先展示状态、再原位填充。 */
  generatedClinicalResultSession: {
    begin: (input: {
      channel: 'chronic-refill';
      message: string;
      stage: 'preparing-context';
    }) => Promise<string>;
    updateProgress: (sessionId: string, progress: {
      message: string;
      stage: ClinicalResultGenerationStage;
    }) => boolean;
    updatePartial: (sessionId: string, result: ClinicalResultInput) => boolean;
    complete: (sessionId: string, result: ClinicalResultInput) => boolean;
    fail: (sessionId: string, message: string) => boolean;
  };
  /** 重置语音会话状态 */
  resetVoiceSessionState: () => void;
  /** 清理指定患者/就诊的语音缓存 */
  clearVoiceConsultationCache: (patient?: AppPatient | null) => void;
  /** 清理问诊最小化恢复入口 */
  clearMinimizedConsultationSessions: () => void;
  /** 检查指定患者是否存在未提交语音缓存 */
  hasCachedVoiceResult: (patient?: AppPatient | null) => boolean;
  /** 队列化快进模式自动触发请求 */
  queueConsultationAssistTrigger: (kind: ConsultationAssistAction) => void;
  /** 读取并固定 start-voice 中可选的动态门诊模板续接规格 */
  prepareVoiceOutpatientEmr?: (payload: unknown) => boolean;
  /** 清理当前语音动态门诊模板续接现场 */
  clearVoiceOutpatientEmr?: () => void;
  /** 读取当前动态门诊模板语音会话的 requestId（仅 debug 模拟转写使用） */
  getVoiceOutpatientEmrRequestId?: () => string | null;
  /** 把已校验的 debug 模拟转写交给真实语音停止处理链 */
  simulateVoiceTranscript?: (transcript: string) => Promise<void>;
  /** 从语音采集返回接诊胶囊并展开慢病范围选择。 */
  requestChronicRefillScopeSelection?: () => Promise<void>;
  /** 退出标志（来自 workMode） */
  exiting: Ref<boolean>;
  /** 窗口大小变化防抖超时 */
  resizeTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
}

interface ReportInterpretationEventPayload extends ReportInterpretationRequestPayload {
  patient?: ReportInterpretationRequestPayload['patient'];
}

/**
 * 事件监听管理 Composable
 *
 * @param options - 配置参数
 * @returns 事件监听管理 API
 */
export function useEventListeners(options: EventListenersOptions) {
  const patientMemorySync = usePatientMemorySync();
  const {
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
    clearMinimizedInpatientEmrSession,
    receptionSession,
    showToast,
    handleWindowMove,
    persistCurrentWindowSize,
    workMode,
    navigation,
    resetVoiceSessionState,
    clearVoiceConsultationCache,
    clearMinimizedConsultationSessions,
    hasCachedVoiceResult,
    queueConsultationAssistTrigger,
    prepareVoiceOutpatientEmr,
    clearVoiceOutpatientEmr,
    exiting,
    resizeTimeoutRef,
  } = options;

  const {
    executeReceptionFlow,
    ensureReceptionContext,
    invalidateReceptionFlow,
    mergeCurrentPatient,
    showPatientRisks,
  } = useReceptionController({
    currentPatient,
    receptionSession,
    showToast,
    workMode,
    resetVoiceSessionState,
    clearVoiceConsultationCache,
    clearMinimizedConsultationSessions,
    fetchFollowUpContext: fetchOutpatientFollowUpContext,
    syncPatientMemory: patientMemorySync.syncForPatient,
  });
  const outpatientScenarioRouter = useOutpatientScenarioRouter({
    currentPatient,
    session: receptionSession,
    hasCachedVoiceResult,
    fetchFollowUpContext: fetchOutpatientFollowUpContext,
    applyFollowUpContext: (followUpContext) => {
      mergeCurrentPatient(
        null,
        buildOutpatientFollowUpPatientOverrides(currentPatient.value, followUpContext),
      );
    },
    generateChronicRefillRecord,
    beginGeneratedClinicalResult: options.generatedClinicalResultSession.begin,
    updateGeneratedClinicalResultProgress: options.generatedClinicalResultSession.updateProgress,
    updateGeneratedClinicalResultPartial: options.generatedClinicalResultSession.updatePartial,
    completeGeneratedClinicalResult: options.generatedClinicalResultSession.complete,
    failGeneratedClinicalResult: options.generatedClinicalResultSession.fail,
    resetVoiceSessionState,
    openOutpatientFollowUp: navigation.openOutpatientFollowUp,
    openReportInterpretation: navigation.openReportInterpretation,
    startVoiceInteraction: navigation.startVoiceInteraction,
    requestChronicRefillScopeSelection: options.requestChronicRefillScopeSelection,
    showToast,
    trackError,
  });
  const { handleSdkHandshake } = useSdkHandshakeController();

  // ========== 事件监听句柄 ==========

  let unlistenDeepLink: UnlistenFn | null = null;
  let unlistenMoved: UnlistenFn | null = null;
  let unlistenResize: UnlistenFn | null = null;

  // ========== Deep Link 监听 ==========

  /**
   * 注册 Deep Link 监听
   */
  async function registerDeepLinkListener(): Promise<void> {
    try {
      unlistenDeepLink = await onOpenUrl((urls) => {
        console.log('Deep link received:', urls);
        if (urls && urls.length > 0) {
          const url = urls[0];
          trackApiCall('deep_link_received', true, undefined, { url });
          showToast(`收到外部调用: ${url}`, 'info');

          // Simple routing based on URL
          if (url.includes('voice-consultation')) {
            clearVoiceOutpatientEmr?.();
            resetVoiceSessionState();
            navigation.startVoiceInteraction();
          } else if (!isWorking.value) {
            workMode.enterWorkMode();
          }
        }
      });
    } catch (e) {
      console.warn('Failed to register deep link listener:', e);
    }
  }

  // ========== SDK 握手监听 ==========

  /**
   * 注册 SDK 握手完成监听
   * 用于初始化 HIS 服务工具类
   */
  async function handleSdkHandshakeEvent(event: TauriEvent<SdkHandshakePayload>): Promise<void> {
    await handleSdkHandshake(event.payload);
  }

  // ========== HIS 集成事件监听 ==========

  /**
   * 注册患者风险提示事件监听
   */
  async function handlePatientRisksEvent(event: TauriEvent<PatientRisksPayload>): Promise<void> {
    console.log('Received patient risks request:', event.payload);
    await showPatientRisks(event.payload);
  }

  /**
   * 注册开始问诊事件监听
   */
  async function handleStartConsultationEvent(event: TauriEvent<StartConsultationPayload>): Promise<void> {
    console.log('Received consultation request:', event.payload);
    const payload = event.payload || {};
    const incomingPatient = resolveIncomingPatientTracking(payload as Record<string, unknown> | null | undefined);
    trackApiCall('his_start_consultation', true, undefined, {
      patientId: incomingPatient.patientId,
    });

    // 入口拦截：必须先走过接诊流程，如果未接诊且带有 patientId，会自动补齐接诊流程
    const success = await ensureReceptionContext(payload);
    if (!success) {
      return;
    }

    // Update/Merge Global Patient Context
    // This ensures we have the correct keys (naPi, sdSexText) for ConsultationPage
    mergeCurrentPatient(payload);
    trackSmartConsultationEntry({
      patient: currentPatient.value,
      payload: payload as Record<string, unknown>,
    });

    await navigation.openConsultation();
  }

  /**
   * 注册接诊患者事件监听
   */
  async function handleReceivePatientEvent(event: TauriEvent<StartConsultationPayload>): Promise<void> {
    console.log('Received patient reception request:', event.payload);
    const payload = event.payload || {};
    await executeReceptionFlow(payload, false);
  }

  async function handleConsultationAssistEvent(event: TauriEvent<SessionAssistPayload>): Promise<void> {
    console.log('Received consultation session request:', event.payload);
    const payload = event.payload || {};
    const isSuggestedDx = payload.action === 'suggestedDx';
    const normalizedPayload = isSuggestedDx ? { ...payload, diagnosis: '' } : payload;
    const patientOverrides = isSuggestedDx
      ? {
          diagnosis: undefined,
          clinical: { diagnosis: undefined },
        }
      : undefined;
    const incomingPatient = resolveIncomingPatientTracking(payload as Record<string, unknown> | null | undefined);
    trackApiCall('his_start_consultation_session', true, undefined, {
      patientId: incomingPatient.patientId,
      action: payload.action,
    });

    const success = await ensureReceptionContext(normalizedPayload);
    if (!success) {
      return;
    }

    mergeCurrentPatient(normalizedPayload, patientOverrides);
    trackConsultationAssistEntry(normalizedPayload.action, {
      patient: currentPatient.value,
      payload: normalizedPayload as Record<string, unknown>,
    });

    const triggerKind = normalizeConsultationAssistAction(normalizedPayload.action);
    if (triggerKind === 'treatment_plan') {
      await navigation.openTreatmentPlan();
      return;
    }

    if (triggerKind === 'differential') {
      await navigation.openDifferentialDiagnosis();
      return;
    }

    if (triggerKind) {
      queueConsultationAssistTrigger(triggerKind);
    }

    await navigation.openConsultation();
  }

  /**
   * 注册停止问诊事件监听
   */
  async function handleStopConsultationEvent(): Promise<void> {
    console.log('Received stop consultation request');
    const patientToClear = currentPatient.value;
    invalidateReceptionFlow();
    resetVoiceSessionState();
    clearVoiceOutpatientEmr?.();
    clearVoiceConsultationCache(patientToClear);
    clearMinimizedConsultationSessions();
    // 清理患者上下文，保证"结束就诊后必须重新接诊"的机制生效：
    // 如果不清，后续不带 payload 的 startVoice / startConsultation 会
    // 被 mergeCurrentPatient 用残留的 patient 填充，绕过几个入口的
    // "请先接诊患者" guard。
    currentPatient.value = null;
    // 无条件重申球态几何；即使响应式状态已先变为 ball，也要修复可能被迟到 resize 留下的错误外窗高度。
    await workMode.exitWork();
  }

  /**
   * 注册语音问诊事件监听
   */
  async function handleVoiceConsultationEvent(
    event: TauriEvent<SessionAssistPayload | null>
  ): Promise<void> {
    console.log('Received start voice consultation command');
    const incomingPatient = resolveIncomingPatientTracking(event.payload as Record<string, unknown> | null | undefined);
    trackApiCall('his_start_voice', true, undefined, {
      patientId: incomingPatient.patientId,
    });

    const success = await ensureReceptionContext(event.payload);
    if (!success) {
      clearVoiceOutpatientEmr?.();
      return;
    }

    // 走到这里说明接诊上下文已存在且身份一致，payload 可能带额外字段需要合并
    mergeCurrentPatient(event.payload);

    if (prepareVoiceOutpatientEmr && !prepareVoiceOutpatientEmr(event.payload)) {
      return;
    }

    if (isWorking.value && currentView.value === 'voice-interaction') {
      console.info('[EventListeners] Duplicate start voice request ignored while voice interaction is already active');
      return;
    }

    trackVoiceConsultationEntry({
      patient: currentPatient.value,
      payload: event.payload as Record<string, unknown> | null | undefined,
    });

    await outpatientScenarioRouter.openVoiceEntry();
  }

  async function handleSimulatedVoiceTranscriptEvent(
    event: TauriEvent<SimulatedVoiceTranscriptPayload>,
  ): Promise<void> {
    if (!import.meta.env.DEV) return;

    const resolution = resolveSimulatedVoiceTranscript(
      event.payload,
      options.getVoiceOutpatientEmrRequestId?.(),
    );
    if (resolution.kind === 'invalid') {
      showToast(resolution.message, 'error');
      return;
    }
    if (currentView.value !== 'voice-interaction' || !options.simulateVoiceTranscript) {
      showToast('当前不在可接收模拟转写的语音采集阶段。', 'error');
      return;
    }

    try {
      await options.simulateVoiceTranscript(resolution.payload.transcript);
    } catch (error) {
      trackError('debug_simulated_voice_transcript_failed', error, {
        requestId: resolution.payload.requestId,
      });
      showToast('模拟语音转写处理失败，请查看本地联调日志。', 'error');
    }
  }

  async function handleReportInterpretationEvent(
    event: TauriEvent<ReportInterpretationEventPayload>
  ): Promise<void> {
    const payload = event.payload;

    trackApiCall('his_start_report_interpretation', true, undefined, {
      taskId: payload?.taskId,
      patientId: getPatientContextId(currentPatient.value) || undefined,
    });

    try {
      await openReportInterpretationWindow(payload, currentPatient.value);
    } catch (error) {
      console.error('[EventListeners] Failed to open report interpretation window:', error);
      trackError('report_interpretation_failed', error, {
        taskId: payload?.taskId,
      });
      showToast(formatUserFacingError(error, {
        fallback: '报告解读打开失败，请稍后重试。',
      }), 'error');
    }
  }

  async function handleInpatientEmrGenerationEvent(
    event: TauriEvent<InpatientEmrGenerationRequest>
  ): Promise<void> {
    const payload = event.payload;
    trackApiCall('his_start_inpatient_emr_generation', true, undefined, {
      admissionId: payload?.admissionId,
      requestId: payload?.requestId,
    });

    if (!payload?.admissionId || !payload?.templateId || !payload?.templateName || !payload?.htmlContent) {
      showToast('住院病历生成请求缺少 admissionId、templateId、templateName 或 htmlContent', 'error');
      return;
    }

    if (shouldRestoreInpatientEmrRequest?.(payload)) {
      await navigation.openInpatientEmr();
      return;
    }

    clearMinimizedInpatientEmrSession?.();
    inpatientEmrRequest.value = payload;
    await navigation.openInpatientEmr();
  }

  // ========== 鼠标事件监听 ==========

  /**
   * 注册鼠标悬停事件监听
   */
  function handleHoverEvent(event: TauriEvent<boolean>): void {
    // 仅在非工作模式下响应
    if (!isWorking.value) {
      isHovered.value = event.payload;
      if (!event.payload) {
        hoveredBtnIndex.value = -1; // 移出窗口时重置按钮 hover 状态
      }
    }
  }

  /**
   * 注册鼠标位置事件监听
   */
  function handleMousePosEvent(event: TauriEvent<{ x: number; y: number }>): void {
    if (!isWorking.value && isHovered.value && ringMenuRef.value) {
      // Rust 发送的是物理坐标，需要转换为 CSS 像素
      const dpr = window.devicePixelRatio || 1;
      const logicalX = event.payload.x / dpr;
      const logicalY = event.payload.y / dpr;

      // 查找鼠标下的元素
      const el = document.elementFromPoint(logicalX, logicalY);
      if (el) {
        const btn = el.closest('.ring-btn');
        if (btn) {
          // 根据类名判断是哪个按钮
          if (btn.classList.contains('top')) hoveredBtnIndex.value = 0;
          else if (btn.classList.contains('right')) hoveredBtnIndex.value = 1;
          else if (btn.classList.contains('bottom')) hoveredBtnIndex.value = 2;
          else if (btn.classList.contains('left')) hoveredBtnIndex.value = 3;
          else hoveredBtnIndex.value = -1;
          return;
        }
      }
      hoveredBtnIndex.value = -1;
    }
  }

  const sdkHandshakeListener = useTauriEventListener<SdkHandshakePayload>({
    eventName: 'sdk-handshake',
    handler: (event) => { void handleSdkHandshakeEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const patientRisksListener = useTauriEventListener<PatientRisksPayload>({
    eventName: 'show-patient-risks',
    handler: (event) => { void handlePatientRisksEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const startConsultationListener = useTauriEventListener<StartConsultationPayload>({
    eventName: 'start-consultation',
    handler: (event) => { void handleStartConsultationEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const receivePatientListener = useTauriEventListener<StartConsultationPayload>({
    eventName: 'receive-patient',
    handler: (event) => { void handleReceivePatientEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const consultationAssistListener = useTauriEventListener<SessionAssistPayload>({
    eventName: 'start-consultation-session',
    handler: (event) => { void handleConsultationAssistEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const stopConsultationListener = useTauriEventListener<void>({
    eventName: 'stop-consultation',
    handler: () => { void handleStopConsultationEvent(); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const voiceConsultationListener = useTauriEventListener<SessionAssistPayload | null>({
    eventName: 'start-voice-consultation',
    handler: (event) => { void handleVoiceConsultationEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const simulatedVoiceTranscriptListener = useTauriEventListener<SimulatedVoiceTranscriptPayload>({
    eventName: 'debug-simulate-voice-transcript',
    handler: (event) => { void handleSimulatedVoiceTranscriptEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const reportInterpretationListener = useTauriEventListener<ReportInterpretationEventPayload>({
    eventName: 'start-report-interpretation',
    handler: (event) => { void handleReportInterpretationEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const inpatientEmrGenerationListener = useTauriEventListener<InpatientEmrGenerationRequest>({
    eventName: 'start-inpatient-emr-generation',
    handler: (event) => { void handleInpatientEmrGenerationEvent(event); },
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const hoverListener = useTauriEventListener<boolean>({
    eventName: 'hover-change',
    handler: handleHoverEvent,
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const mousePosListener = useTauriEventListener<{ x: number; y: number }>({
    eventName: 'mouse-pos',
    handler: handleMousePosEvent,
    logContext: 'EventListeners',
    autoStart: false,
    throwOnError: true,
  });

  const appEventListeners = [
    patientRisksListener,
    startConsultationListener,
    consultationAssistListener,
    stopConsultationListener,
    voiceConsultationListener,
    simulatedVoiceTranscriptListener,
    reportInterpretationListener,
    inpatientEmrGenerationListener,
    receivePatientListener,
    sdkHandshakeListener,
    hoverListener,
    mousePosListener,
  ];

  // ========== 窗口事件监听 ==========

  /**
   * 注册窗口移动事件监听
   */
  async function registerWindowMoveListener(): Promise<void> {
    if (!appWindow.value) return;
    unlistenMoved = await appWindow.value.listen('tauri://move', handleWindowMove);
  }

  /**
   * 注册窗口大小变化事件监听
   */
  async function registerWindowResizeListener(): Promise<void> {
    if (!appWindow.value) return;

    unlistenResize = await appWindow.value.listen('tauri://resize', async () => {
      if (isWorking.value && !transitioning.value && !exiting.value && appWindow.value) {
        if (resizeTimeoutRef.value) clearTimeout(resizeTimeoutRef.value);
        resizeTimeoutRef.value = setTimeout(async () => {
          if (!isWorking.value) return;
          if (!supportsPersistentWindowSize(currentView.value)) {
            return;
          }

          await persistCurrentWindowSize(currentView.value);
        }, 200);
      }
    });
  }

  // ========== 统一注册/注销 ==========

  /**
   * 注册所有事件监听
   */
  async function registerAllListeners(): Promise<void> {
    try {
      // 防御式清理：避免重复注册导致事件重复处理
      unregisterAllListeners();

      // Deep Link 监听
      await registerDeepLinkListener();

      // 窗口事件监听
      await registerWindowMoveListener();
      await registerWindowResizeListener();

      // App 级 Tauri 事件监听，顺序沿用原显式注册链路
      for (const listener of appEventListeners) {
        await listener.startListener();
      }

      console.log('[EventListeners] All event listeners registered');
    } catch (e) {
      console.error('监听事件失败:', e);
    }
  }

  /**
   * 注销所有事件监听
   */
  function unregisterAllListeners(): void {
    if (unlistenDeepLink) {
      unlistenDeepLink();
      unlistenDeepLink = null;
    }
    appEventListeners.forEach((listener) => listener.clearListener());
    if (unlistenMoved) {
      unlistenMoved();
      unlistenMoved = null;
    }
    if (unlistenResize) {
      unlistenResize();
      unlistenResize = null;
    }
    if (resizeTimeoutRef.value) {
      clearTimeout(resizeTimeoutRef.value);
      resizeTimeoutRef.value = null;
    }

    console.log('[EventListeners] All event listeners unregistered');
  }

  // ========== 导出 ==========

  return {
    registerAllListeners,
    confirmChronicRefill: outpatientScenarioRouter.confirmChronicRefill,
    confirmFollowUp: outpatientScenarioRouter.confirmFollowUp,
    confirmReportAssistant: outpatientScenarioRouter.confirmReportAssistant,
    routeVoiceTranscript: outpatientScenarioRouter.routeVoiceTranscript,
    unregisterAllListeners,
  };
}
