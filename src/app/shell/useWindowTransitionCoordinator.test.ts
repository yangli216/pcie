import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewType, WindowSize } from '@/constants/windowSizes';
import type { useWindowManagement } from './useWindowManagement';
import { useWindowTransitionCoordinator } from './useWindowTransitionCoordinator';

function createWindowManagementMock(
  resize?: (width: number, height: number) => Promise<void>,
): ReturnType<typeof useWindowManagement> {
  return {
    getPreferredWindowSize: vi.fn(async (view: ViewType): Promise<WindowSize> => (
      view === 'consultation'
        ? { width: 1120, height: 760 }
        : { width: 1280, height: 760 }
    )),
    resizeWorkWindow: vi.fn(resize ?? (async () => undefined)),
  } as unknown as ReturnType<typeof useWindowManagement>;
}

describe('useWindowTransitionCoordinator', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: true }),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('commits the new view only after the target geometry is applied', async () => {
    const currentView = ref<ViewType>('reception-capsule');
    const transitioning = ref(false);
    const order: string[] = [];
    const windowMgmt = createWindowManagementMock(async () => {
      order.push(`resize:${currentView.value}`);
    });
    const prepareForGeometry = vi.fn(async () => {
      order.push('region:full');
    });
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking: ref(true),
      transitioning,
      windowMgmt,
      windowRegion: { prepareForGeometry },
    });

    await coordinator.transitionToView('consultation', {
      commitViewState: () => {
        order.push(`commit:${currentView.value}`);
      },
    });
    order.push(`view:${currentView.value}`);

    expect(order).toEqual([
      'region:full',
      'resize:reception-capsule',
      'commit:consultation',
      'view:consultation',
    ]);
    expect(prepareForGeometry).toHaveBeenCalledOnce();
    expect(windowMgmt.resizeWorkWindow).toHaveBeenCalledWith(1120, 760, {
      minSize: { width: 1120, height: 760 },
      preferredPosition: undefined,
      resizable: true,
    });
    expect(coordinator.contentVisible.value).toBe(true);
    expect(transitioning.value).toBe(false);
  });

  it('drops a stale queued target and leaves the latest view visible', async () => {
    const currentView = ref<ViewType>('reception-capsule');
    const transitioning = ref(false);
    let releaseFirstResize!: () => void;
    let markFirstResizeStarted: (() => void) | null = null;
    const firstResizeStarted = new Promise<void>((resolve) => {
      markFirstResizeStarted = resolve;
    });
    let resizeCount = 0;
    const windowMgmt = createWindowManagementMock(async () => {
      resizeCount += 1;
      if (resizeCount === 1) {
        markFirstResizeStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstResize = resolve;
        });
      }
    });
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking: ref(true),
      transitioning,
      windowMgmt,
    });

    const first = coordinator.transitionToView('consultation');
    await firstResizeStarted;
    const second = coordinator.transitionToView('report-interpretation');
    releaseFirstResize();

    await Promise.all([first, second]);

    expect(currentView.value).toBe('report-interpretation');
    expect(windowMgmt.resizeWorkWindow).toHaveBeenCalledTimes(2);
    expect(coordinator.contentVisible.value).toBe(true);
    expect(transitioning.value).toBe(false);
  });

  it('keeps the old view visible when native geometry application fails', async () => {
    const currentView = ref<ViewType>('reception-capsule');
    const transitioning = ref(false);
    const windowMgmt = createWindowManagementMock(async () => {
      throw new Error('native resize failed');
    });
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking: ref(true),
      transitioning,
      windowMgmt,
    });

    await expect(coordinator.transitionToView('consultation')).rejects.toThrow('native resize failed');

    expect(currentView.value).toBe('reception-capsule');
    expect(coordinator.contentVisible.value).toBe(true);
    expect(transitioning.value).toBe(false);
  });

  it('clips the stable ball before making its content visible', async () => {
    const order: string[] = [];
    const isWorking = ref(true);
    const coordinator = useWindowTransitionCoordinator({
      currentView: ref<ViewType>('chat'),
      isWorking,
      transitioning: ref(false),
      windowMgmt: createWindowManagementMock(async () => {
        order.push('resize');
      }),
      windowRegion: {
        prepareForGeometry: async () => { order.push('region:full'); },
        prepareBallContent: async () => { order.push('region:ball'); },
      },
    });

    await coordinator.transitionToBall({
      commitBallState: () => {
        isWorking.value = false;
        order.push('commit');
      },
    });

    expect(order).toEqual(['region:full', 'resize', 'commit', 'region:ball']);
    expect(coordinator.contentVisible.value).toBe(true);
  });

  it('restores content without waiting for a browser animation frame', async () => {
    const suspendedAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', suspendedAnimationFrame);
    const currentView = ref<ViewType>('reception-capsule');
    const transitioning = ref(false);
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking: ref(true),
      transitioning,
      windowMgmt: createWindowManagementMock(),
    });

    await coordinator.transitionToView('consultation');

    expect(currentView.value).toBe('consultation');
    expect(coordinator.contentVisible.value).toBe(true);
    expect(transitioning.value).toBe(false);
    expect(suspendedAnimationFrame).not.toHaveBeenCalled();
  });

  it('keeps voice content visible while resizing between recording stages', async () => {
    const currentView = ref<ViewType>('voice-interaction');
    const transitioning = ref(false);
    let releaseResize!: () => void;
    let markResizeStarted!: () => void;
    const resizeStarted = new Promise<void>((resolve) => {
      markResizeStarted = resolve;
    });
    const windowMgmt = createWindowManagementMock(async () => {
      markResizeStarted();
      await new Promise<void>((resolve) => {
        releaseResize = resolve;
      });
    });
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking: ref(true),
      transitioning,
      windowMgmt,
    });

    const resize = coordinator.resizeVoiceInteractionStage('processing');
    await resizeStarted;

    expect(coordinator.contentVisible.value).toBe(true);
    releaseResize();
    await resize;

    expect(currentView.value).toBe('voice-interaction');
    expect(coordinator.contentVisible.value).toBe(true);
  });

  it('ignores capture stage changes after the result page opens', async () => {
    const windowMgmt = createWindowManagementMock();
    const coordinator = useWindowTransitionCoordinator({
      currentView: ref<ViewType>('voice-consultation'),
      isWorking: ref(true),
      transitioning: ref(false),
      windowMgmt,
    });

    await coordinator.resizeVoiceInteractionStage('processing');
    expect(windowMgmt.resizeWorkWindow).not.toHaveBeenCalled();
  });

  it('serializes the terminal ball geometry after an in-flight view resize', async () => {
    const currentView = ref<ViewType>('reception-capsule');
    const isWorking = ref(true);
    const transitioning = ref(false);
    let releaseFirstResize!: () => void;
    let markFirstResizeStarted: (() => void) | null = null;
    const firstResizeStarted = new Promise<void>((resolve) => {
      markFirstResizeStarted = resolve;
    });
    let resizeCount = 0;
    const windowMgmt = createWindowManagementMock(async () => {
      resizeCount += 1;
      if (resizeCount === 1) {
        markFirstResizeStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstResize = resolve;
        });
      }
    });
    const coordinator = useWindowTransitionCoordinator({
      currentView,
      isWorking,
      transitioning,
      windowMgmt,
    });

    const staleViewTransition = coordinator.transitionToView('consultation');
    await firstResizeStarted;
    const ballTransition = coordinator.transitionToBall({
      preferredPosition: { x: 1800, y: 400 },
      commitBallState: () => {
        isWorking.value = false;
      },
    });
    releaseFirstResize();

    await Promise.all([staleViewTransition, ballTransition]);

    expect(currentView.value).toBe('reception-capsule');
    expect(isWorking.value).toBe(false);
    expect(windowMgmt.resizeWorkWindow).toHaveBeenLastCalledWith(160, 160, {
      minSize: { width: 160, height: 160 },
      preferredPosition: { x: 1800, y: 400 },
      resizable: false,
    });

    await coordinator.resizeVoiceInteractionStage('processing');
    expect(windowMgmt.resizeWorkWindow).toHaveBeenCalledTimes(2);

    await coordinator.transitionToView('consultation', {
      commitViewState: () => {
        isWorking.value = true;
      },
    });
    expect(isWorking.value).toBe(true);
    expect(currentView.value).toBe('consultation');
    expect(windowMgmt.resizeWorkWindow).toHaveBeenCalledTimes(3);
  });
});
