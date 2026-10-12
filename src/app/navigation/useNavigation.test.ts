import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { ViewType } from '@/constants/windowSizes';
import type { AppPatient } from '@/types/appState';
import type { useWindowTransitionCoordinator } from '@app/shell/useWindowTransitionCoordinator';
import { useNavigation } from './useNavigation';

vi.mock('@/services/operationTracker', () => ({
  trackViewChange: vi.fn(),
}));

function createNavigation(currentViewValue: ViewType) {
  const currentView = ref<ViewType>(currentViewValue);
  const transitionToView = vi.fn(async () => undefined);
  const navigation = useNavigation({
    currentView,
    isWorking: ref(true),
    currentPatient: ref<AppPatient | null>({ patientId: 'patient-1' } as AppPatient),
    windowTransition: {
      transitionToView,
    } as unknown as ReturnType<typeof useWindowTransitionCoordinator>,
    workMode: {
      enterWorkMode: vi.fn(async () => undefined),
    },
  });
  return { navigation, transitionToView };
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
});

describe('useNavigation outpatient EMR entry', () => {
  it('opens the dedicated outpatient EMR workspace', async () => {
    const { navigation, transitionToView } = createNavigation('chat');

    await navigation.openOutpatientEmr();

    expect(transitionToView).toHaveBeenCalledWith('outpatient-emr');
  });
});

describe('independent public health entry', () => {
  it('uses the coordinated public health view rather than a consultation view', async () => {
    const { navigation, transitionToView } = createNavigation('consultation');
    await navigation.openPublicHealth();
    expect(transitionToView).toHaveBeenCalledWith('public-health');
  });
});
