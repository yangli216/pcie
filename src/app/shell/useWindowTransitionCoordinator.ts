import { nextTick, ref, type Ref } from 'vue';
import { ANIMATION } from '@/constants/animation';
import {
  getVoiceInteractionWindowSize,
  getWindowSizeConstraints,
  isCapsuleView,
  WINDOW_SIZES,
  type ViewType,
  type VoiceInteractionWindowStage,
  type WindowSize,
} from '@/constants/windowSizes';
import type { Position, ResizeWindowOptions } from './useWindowManagement';
import type { useWindowManagement } from './useWindowManagement';

export interface WindowTransitionCoordinatorOptions {
  currentView: Ref<ViewType>;
  isWorking: Ref<boolean>;
  transitioning: Ref<boolean>;
  windowMgmt: ReturnType<typeof useWindowManagement>;
  windowRegion?: {
    prepareForGeometry: () => Promise<void>;
    prepareBallContent?: () => Promise<void>;
  };
}

export interface WindowViewTransitionOptions {
  size?: WindowSize;
  preferredPosition?: Position | null;
  resizable?: boolean;
  fade?: boolean;
  commitViewState?: () => void | Promise<void>;
}

export interface WindowBallTransitionOptions {
  preferredPosition?: Position | null;
  commitBallState: () => void | Promise<void>;
}

export function useWindowTransitionCoordinator(options: WindowTransitionCoordinatorOptions) {
  const { currentView, isWorking, transitioning, windowMgmt, windowRegion } = options;
  const contentVisible = ref(true);
  let latestRequestId = 0;
  let transitionTail: Promise<void> = Promise.resolve();
  let terminalBallPending = false;

  const getFadeDelay = (): number => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return 0;
    }
    return ANIMATION.CONTENT_FADE_MS;
  };

  const hideContent = async (): Promise<void> => {
    if (!contentVisible.value) return;
    contentVisible.value = false;
    const delay = getFadeDelay();
    if (delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  };

  const showContent = async (): Promise<void> => {
    await nextTick().catch((error) => {
      console.warn('[WindowTransition] Vue flush failed before showing content:', error);
    });
    // 不等待 requestAnimationFrame：macOS WebView 在后台或整窗透明时可能暂停帧回调，
    // 若可见性恢复依赖该回调，会形成原生窗口存在但内容永久透明的死锁。
    contentVisible.value = true;
  };

  const enqueueLatest = (task: (requestId: number) => Promise<void>): Promise<void> => {
    const requestId = ++latestRequestId;
    const run = transitionTail
      .catch(() => undefined)
      .then(async () => {
        if (requestId !== latestRequestId) return;
        await task(requestId);
      });

    transitionTail = run.catch((error) => {
      console.warn('[WindowTransition] Transition failed:', error);
    });
    return run;
  };

  const applyGeometry = async (
    targetSize: WindowSize,
    resizeOptions: ResizeWindowOptions,
  ): Promise<void> => {
    await windowRegion?.prepareForGeometry();
    await windowMgmt.resizeWorkWindow(targetSize.width, targetSize.height, resizeOptions);
  };

  const transitionToView = (
    targetView: ViewType,
    transitionOptions: WindowViewTransitionOptions = {},
  ): Promise<void> => {
    // 显式打开新视图可以结束球态终态；普通阶段 resize 不能。
    terminalBallPending = false;
    return enqueueLatest(async (requestId) => {
      transitioning.value = true;
      const shouldFade = transitionOptions.fade !== false;

      try {
        if (shouldFade) await hideContent();
        if (requestId !== latestRequestId) return;

        const targetSize = transitionOptions.size
          ?? await windowMgmt.getPreferredWindowSize(targetView);
        const constraints = getWindowSizeConstraints(targetView);
        await applyGeometry(targetSize, {
          minSize: { width: constraints.minWidth, height: constraints.minHeight },
          preferredPosition: transitionOptions.preferredPosition,
          resizable: transitionOptions.resizable ?? !isCapsuleView(targetView),
        });
        if (requestId !== latestRequestId) return;

        currentView.value = targetView;
        await transitionOptions.commitViewState?.();
        await showContent();
      } finally {
        if (requestId === latestRequestId) {
          contentVisible.value = true;
          transitioning.value = false;
        }
      }
    });
  };

  const transitionToBall = (
    transitionOptions: WindowBallTransitionOptions,
  ): Promise<void> => {
    terminalBallPending = true;
    return enqueueLatest(async (requestId) => {
      transitioning.value = true;

      try {
        await hideContent();
        if (requestId !== latestRequestId) return;

        await applyGeometry(WINDOW_SIZES.BALL, {
          minSize: WINDOW_SIZES.BALL,
          preferredPosition: transitionOptions.preferredPosition,
          resizable: false,
        });
        if (requestId !== latestRequestId) return;

        await transitionOptions.commitBallState();
        await windowRegion?.prepareBallContent?.();
        await showContent();
      } finally {
        if (requestId === latestRequestId) {
          terminalBallPending = false;
          contentVisible.value = true;
          transitioning.value = false;
        }
      }
    });
  };

  const resizeCurrentView = (
    targetSize: WindowSize,
    transitionOptions: Omit<WindowViewTransitionOptions, 'size'> = {},
  ): Promise<void> => {
    if (terminalBallPending || !isWorking.value) {
      return Promise.resolve();
    }

    return transitionToView(currentView.value, {
      ...transitionOptions,
      size: targetSize,
    });
  };

  const resizeVoiceInteractionStage = (
    stage: VoiceInteractionWindowStage,
  ): Promise<void> => {
    if (currentView.value !== 'voice-interaction') return Promise.resolve();
    return resizeCurrentView(getVoiceInteractionWindowSize(stage), {
      resizable: false,
      fade: false,
    });
  };

  return {
    contentVisible,
    hideContent,
    showContent,
    transitionToView,
    transitionToBall,
    resizeCurrentView,
    resizeVoiceInteractionStage,
  };
}
