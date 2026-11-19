import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { ViewType } from '@/constants/windowSizes';
import type { AppPatient } from '@/types/appState';
import type { useWindowTransitionCoordinator } from '@app/shell/useWindowTransitionCoordinator';
import { useNavigation } from './useNavigation';

vi.mock('@/services/operationTracker', () => ({
  trackViewChange: vi.fn(),
}));

function createNavigation(currentViewValue: ViewType, isWorking = true) {
  const currentView = ref<ViewType>(currentViewValue);
  const transitionToView = vi.fn(async () => undefined);
  const enterWorkMode = vi.fn(async () => undefined);
  const navigation = useNavigation({
    currentView,
    isWorking: ref(isWorking),
    currentPatient: ref<AppPatient | null>({ patientId: 'patient-1' } as AppPatient),
    windowTransition: {
      transitionToView,
    } as unknown as ReturnType<typeof useWindowTransitionCoordinator>,
    workMode: {
      enterWorkMode,
    },
  });
  return { navigation, transitionToView, enterWorkMode };
}

describe('useNavigation voice entry', () => {
  it('does not fade the whole window when moving from patient capsule to voice capture', async () => {
    const { navigation, transitionToView } = createNavigation('reception-capsule');

    await navigation.startVoiceInteraction();

    expect(transitionToView).toHaveBeenCalledWith('voice-interaction', expect.objectContaining({
      resizable: false,
      fade: false,
    }));
  });

  it('keeps the normal fade when entering voice capture from a workspace', async () => {
    const { navigation, transitionToView } = createNavigation('consultation');

    await navigation.startVoiceInteraction();

    expect(transitionToView).toHaveBeenCalledWith('voice-interaction', expect.objectContaining({
      fade: true,
    }));
  });

  it('opens the compact recording window from reception or the ball', async () => {
    const reception = createNavigation('reception-capsule');
    await reception.navigation.startVoiceInteraction();
    expect(reception.transitionToView).toHaveBeenCalledWith('voice-interaction', {
      size: { width: 360, height: 80 }, resizable: false, fade: false,
    });

    const ball = createNavigation('chat', false);
    await ball.navigation.startVoiceInteraction();
    expect(ball.enterWorkMode).toHaveBeenCalledWith(360, 80);
  });
});

describe('useNavigation outpatient EMR entry', () => {
  it('opens the dedicated outpatient EMR workspace', async () => {
    const { navigation, transitionToView } = createNavigation('chat');

    await navigation.openOutpatientEmr();

    expect(transitionToView).toHaveBeenCalledWith('outpatient-emr');
  });
});
