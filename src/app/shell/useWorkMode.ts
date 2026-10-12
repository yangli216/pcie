/**
 * 工作模式 Composable
 *
 * 负责悬浮球 ↔ 工作面板的展开/收起切换逻辑，包括：
 * - 进入工作模式（展开动画 + 窗口调整）
 * - 退出工作模式（收起动画 + 位置恢复）
 * - 智能收起（问诊→胶囊 or 完全退出）
 * - 变形动画原点计算
 * - 会话生命周期管理
 *
 * @module app/shell/useWorkMode
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { Window as TauriWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { getWindowSizeForView, isCapsuleView, type WindowSize, type ViewType } from '@/constants/windowSizes';
import { MORPH_ORIGIN_DEFAULT } from '@/constants/animation';
import { feedbackService } from '@/services/feedback';
import { trackClick } from '@/services/operationTracker';
import type { useWindowManagement } from './useWindowManagement';
import type { useWindowTransitionCoordinator } from './useWindowTransitionCoordinator';
import type { AppPatient } from '@/types/appState';
import { getPatientContextId, getPatientContextName } from '@/utils/patientContext';

/**
 * 位置坐标类型
 */
interface Position {
  x: number;
  y: number;
}

/**
 * 工作模式配置参数
 */
export interface WorkModeOptions {
  /** Tauri 窗口实例引用 */
  appWindow: Ref<TauriWindow | null>;
  /** 窗口管理 composable 实例 */
  windowMgmt: ReturnType<typeof useWindowManagement>;
  /** 单主窗口过渡协调器 */
  windowTransition: ReturnType<typeof useWindowTransitionCoordinator>;
  /** 当前视图 */
  currentView: Ref<ViewType>;
  /** 是否处于工作模式 */
  isWorking: Ref<boolean>;
  /** 是否正在过渡动画中 */
  transitioning: Ref<boolean>;
  /** 是否悬停 */
  isHovered: Ref<boolean>;
  /** 当前患者信息 */
  currentPatient: Ref<AppPatient | null>;
  /** 返回接待胶囊时当前应使用的窗口尺寸 */
  getReceptionWindowSize?: () => WindowSize;
}

/**
 * 工作模式 Composable
 *
 * @param options - 配置参数
 * @returns 工作模式 API
 *
 * @example
 * ```typescript
 * const workMode = useWorkMode({
 *   appWindow,
 *   windowMgmt,
 *   currentView,
 *   isWorking,
 *   transitioning,
 *   isHovered,
 *   currentPatient,
 *   windowTransition,
 * });
 *
 * // 展开到工作模式
 * await workMode.enterWorkMode();
 *
 * // 收起到小球
 * await workMode.exitWork();
 * ```
 */
export function useWorkMode(options: WorkModeOptions) {
  const {
    appWindow,
    windowMgmt,
    windowTransition,
    currentView,
    isWorking,
    transitioning,
    isHovered,
    currentPatient,
    getReceptionWindowSize,
  } = options;

  const {
    lastBallPos,
    isMoving,
    getPreferredWindowSize,
  } = windowMgmt;
  const {
    contentVisible,
    resizeCurrentView,
    transitionToBall,
    transitionToView,
  } = windowTransition;

  // ========== 状态 ==========

  /** 是否正在退出工作模式 */
  const exiting = ref(false);
  let activeExitPromise: Promise<void> | null = null;

  /** 小球视觉偏移量（退出动画中使用） */
  const ballOffset = ref<Position>({ x: 0, y: 0 });

  /** 变形动画原点（CSS transform-origin） */
  const morphOrigin = ref(MORPH_ORIGIN_DEFAULT);

  /** 容器样式（绑定 transform-origin） */
  const containerStyle: ComputedRef<Record<string, string>> = computed(() => ({
    transformOrigin: morphOrigin.value,
  }));

  /** 小球样式（绑定 translate 偏移） */
  const ballStyle: ComputedRef<Record<string, string>> = computed(() => ({
    transform: `translate(${ballOffset.value.x}px, ${ballOffset.value.y}px)`,
    transition: 'opacity 0.2s ease',
  }));

  // ========== 内部工具 ==========

  /**
   * 根据视图类型确定目标窗口尺寸
   */
  async function resolveTargetSize(customW?: number, customH?: number): Promise<{ w: number; h: number }> {
    if (customW !== undefined && customH !== undefined) {
      return { w: customW, h: customH };
    }
    const size = await getPreferredWindowSize(currentView.value);
    return { w: customW ?? size.width, h: customH ?? size.height };
  }

  /**
   * 计算变形动画原点
   *
   * 根据小球位置和当前窗口位置计算 CSS transform-origin，
   * 确保展开/收起动画从小球中心位置开始。
   */
  async function calculateMorphOrigin(mode: 'expand' | 'shrink'): Promise<void> {
    if (!appWindow.value || !lastBallPos.value) {
      morphOrigin.value = MORPH_ORIGIN_DEFAULT;
      return;
    }

    try {
      const winPos = await appWindow.value.outerPosition();
      const scale = (await appWindow.value.scaleFactor()) || 1;

      const dx = (lastBallPos.value.x - winPos.x) / scale;
      const dy = (lastBallPos.value.y - winPos.y) / scale;

      if (mode === 'expand') {
        // 展开：原点 = 小球中心相对于窗口的位置
        morphOrigin.value = `${dx + 80}px ${dy + 80}px`;
      } else {
        // 收起：同时设置小球偏移和动画原点
        ballOffset.value = { x: dx, y: dy };
        morphOrigin.value = `${dx + 80}px ${dy + 80}px`;
      }
    } catch (e) {
      console.warn('[WorkMode] Failed to calculate morph origin:', e);
      morphOrigin.value = MORPH_ORIGIN_DEFAULT;
    }
  }

  /**
   * 确定会话类型
   */
  function getSessionType(): 'chat' | 'consultation' | 'voice' | 'reception' {
    switch (currentView.value) {
      case 'consultation': return 'consultation';
      case 'voice-interaction': return 'voice';
      case 'reception-capsule': return 'reception';
      default: return 'chat';
    }
  }

  // ========== 核心方法 ==========

  /**
   * 进入工作模式（展开窗口）
   *
   * 流程：
   * 1. 如果已在工作模式，仅调整窗口尺寸
   * 2. 记录小球位置
   * 3. 调整窗口尺寸
   * 4. 计算动画原点
   * 5. 触发展开动画
   * 6. 启动会话
   *
   * @param customW - 自定义宽度（可选）
   * @param customH - 自定义高度（可选）
   */
  const enterWorkMode = async (customW?: number, customH?: number): Promise<void> => {
    const { w: targetW, h: targetH } = await resolveTargetSize(customW, customH);

    // 已在工作模式：仅调整尺寸
    if (isWorking.value) {
      await resizeCurrentView({ width: targetW, height: targetH }, {
        resizable: !isCapsuleView(currentView.value),
      });
      return;
    }

    // 应用 Always on Top 配置
    if (appWindow.value) {
      const saved = localStorage.getItem('ALWAYS_ON_TOP');
      const isAlwaysOnTop = saved === null || saved === 'true';
      await appWindow.value.setAlwaysOnTop(isAlwaysOnTop);
    }

    // 记录小球位置（优先使用缓存）
    if (!lastBallPos.value && appWindow.value) {
      try {
        const pos = await appWindow.value.outerPosition();
        lastBallPos.value = { x: pos.x, y: pos.y };
      } catch (e) {
        console.error('[WorkMode] Failed to record ball position:', e);
      }
    }

    const targetView = currentView.value;
    let workStateCommitted = false;
    await transitionToView(targetView, {
      size: { width: targetW, height: targetH },
      resizable: !isCapsuleView(targetView),
      commitViewState: async () => {
        await calculateMorphOrigin('expand');
        isWorking.value = true;
        workStateCommitted = true;
        trackClick('enter_work_mode', { view: targetView });
      },
    });

    if (!workStateCommitted) return;

    // 公卫任务有独立居民上下文，不将门诊 currentPatient 关联到通用会话日志。
    if (targetView === 'public-health') return;

    // 会话启动不阻塞窗口已经完成的视觉切换。
    void feedbackService.startSession(
      getSessionType(),
      getPatientContextId(currentPatient.value) || currentPatient.value?.piOi,
      getPatientContextName(currentPatient.value)
    )
      .then(() => console.log(`[WorkMode] Session started for ${getSessionType()}`))
      .catch((error) => console.error('[WorkMode] Failed to start session:', error));
  };

  const openReceptionCapsule = async (size: WindowSize): Promise<void> => {
    if (!currentPatient.value) {
      console.info('[WorkMode] Ignore stale reception resize without an active patient');
      return;
    }

    if (!isWorking.value) {
      currentView.value = 'reception-capsule';
      await enterWorkMode(size.width, size.height);
      return;
    }

    if (currentView.value === 'reception-capsule') {
      await resizeReceptionCapsule(size);
      return;
    }

    await transitionToView('reception-capsule', {
      size,
      preferredPosition: lastBallPos.value,
      resizable: false,
    });
  };

  /**
   * 仅刷新当前患者胶囊尺寸。
   *
   * 接诊风险与机会分析可能晚于医生导航完成；这类迟到更新只能调整仍然显示的
   * 患者胶囊，不能重新打开胶囊或覆盖语音采集/工作台。
   */
  const resizeReceptionCapsule = async (size: WindowSize): Promise<void> => {
    if (!isWorking.value || currentView.value !== 'reception-capsule') {
      console.info('[WorkMode] Ignore stale reception capsule resize outside reception view');
      return;
    }

    await resizeCurrentView(size, {
      preferredPosition: lastBallPos.value,
      resizable: false,
      fade: false,
    });
  };

  /**
   * 退出工作模式（收起窗口为小球）
   *
   * 流程：
   * 1. 计算小球偏移和动画原点
   * 2. 触发收缩动画
   * 3. 结束会话
   * 4. 等待动画完成
   * 5. 移动窗口到小球位置
   * 6. 缩小窗口尺寸
   * 7. 重置状态
   *
   * @param sessionStatus - 会话结束状态
   */
  const performExitWork = async (
    sessionStatus: 'completed' | 'cancelled' | 'error' = 'completed'
  ): Promise<void> => {
    const hadActiveWork = isWorking.value || transitioning.value || isMoving.value;
    if (hadActiveWork) {
      trackClick('exit_work_mode', { view: currentView.value, sessionStatus });
    }
    exiting.value = true;
    try {
      if (appWindow.value) {
        await appWindow.value.setAlwaysOnTop(true);
      }

      if (hadActiveWork) {
        // 取消与反馈属于非视觉副作用，不再阻塞窗口收口。
        void invoke('cancel_consultation_if_pending')
          .catch((error) => console.warn('[WorkMode] cancel_consultation_if_pending failed:', error));
        void feedbackService.endSession(undefined, sessionStatus)
          .then(() => console.log('[WorkMode] Session ended successfully'))
          .catch((error) => console.error('[WorkMode] Failed to end session:', error));
      }

      isHovered.value = false;
      await transitionToBall({
        preferredPosition: lastBallPos.value,
        commitBallState: () => {
          ballOffset.value = { x: 0, y: 0 };
          morphOrigin.value = MORPH_ORIGIN_DEFAULT;
          isWorking.value = false;
        },
      });
      lastBallPos.value = null;

      try {
        const isHoveredNow = await invoke('check_mouse_hover');
        console.log('[WorkMode] Forced hover check:', isHoveredNow);
        isHovered.value = isHoveredNow as boolean;
      } catch (e) {
        console.error('[WorkMode] Failed to force hover check:', e);
      }
    } finally {
      exiting.value = false;
    }
  };

  const exitWork = (
    sessionStatus: 'completed' | 'cancelled' | 'error' = 'completed'
  ): Promise<void> => {
    if (activeExitPromise) return activeExitPromise;

    activeExitPromise = performExitWork(sessionStatus).finally(() => {
      activeExitPromise = null;
    });
    return activeExitPromise;
  };

  /**
   * 智能收起处理
   *
   * 问诊态统一先回到风险提示页，其他视图则直接回到悬浮球。
   * - 症状问诊 / 语音问诊 在收起前已由 App.handleUserCollapse 写入最小化会话记录；
   * - reception-capsule 作为问诊态与球态之间的统一过渡页；
   * - 医生从风险提示页再次关闭时，才真正退出到悬浮球。
   */
  const handleCollapse = async (): Promise<void> => {
    const shouldReturnToReception =
      (currentView.value === 'consultation' ||
       currentView.value === 'voice-consultation' ||
       currentView.value === 'treatment-plan' ||
       currentView.value === 'outpatient-follow-up' ||
       currentView.value === 'report-interpretation' ||
       currentView.value === 'differential-diagnosis') &&
      !!currentPatient.value;

    trackClick('collapse', {
      from: currentView.value,
      toReception: shouldReturnToReception,
    });

    if (shouldReturnToReception && currentPatient.value) {
      const receptionSize = getReceptionWindowSize?.() ?? getWindowSizeForView('reception-capsule');
      await transitionToView('reception-capsule', {
        size: receptionSize,
        preferredPosition: lastBallPos.value,
        resizable: false,
      });
      return;
    }

    await exitWork();
  };

  // ========== 导出 ==========

  return {
    // 状态
    exiting,
    ballOffset,
    morphOrigin,
    containerStyle,
    ballStyle,
    contentVisible,

    // 方法
    enterWorkMode,
    openReceptionCapsule,
    resizeReceptionCapsule,
    exitWork,
    handleCollapse,
  };
}
