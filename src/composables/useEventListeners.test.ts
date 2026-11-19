// @vitest-environment jsdom
import { createApp, ref, type App } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import type { ViewType } from '@/constants/windowSizes';
import { buildPatientContext } from '@/utils/patientContext';
import { useReceptionSessionController } from '@features/reception/model/useReceptionSessionController';
import { useEventListeners } from './useEventListeners';

vi.mock('@tauri-apps/api/event', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tauri-apps/api/event')>(),
  listen: vi.fn(async () => vi.fn()),
}));
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl: vi.fn(async () => vi.fn()) }));
vi.mock('@/services/operationTracker', () => ({ trackApiCall: vi.fn(), trackError: vi.fn() }));
vi.mock('@/services/featureUsageEntryTracker', () => ({ trackVoiceConsultationEntry: vi.fn() }));

let app: App | undefined;
afterEach(() => { app?.unmount(); });

it('keeps the active patient and template when another start-voice event arrives during capture', async () => {
  const currentView = ref<ViewType>('reception-capsule');
  const patient = { idPi: 'SYN-P1', idVis: 'SYN-V1' };
  const currentPatient = ref(buildPatientContext({ payload: patient, receptionEnsured: true }));
  const prepareVoiceOutpatientEmr = vi.fn(() => true);
  const clearVoiceOutpatientEmr = vi.fn();
  const showToast = vi.fn();
  const startVoiceInteraction = vi.fn(async () => { currentView.value = 'voice-interaction'; });
  let listeners!: ReturnType<typeof useEventListeners>;
  app = createApp({
    setup() {
      listeners = useEventListeners({
        currentView, currentPatient, isWorking: ref(true), showToast, prepareVoiceOutpatientEmr, clearVoiceOutpatientEmr,
        appWindow: ref(null), transitioning: ref(false), isHovered: ref(false), hoveredBtnIndex: ref(-1),
        ringMenuRef: ref(null), inpatientEmrRequest: ref(null), exiting: ref(false), resizeTimeoutRef: ref(null),
        receptionSession: useReceptionSessionController(currentPatient),
        handleWindowMove: vi.fn(), persistCurrentWindowSize: vi.fn(),
        workMode: { enterWorkMode: vi.fn(), openReceptionCapsule: vi.fn(), resizeReceptionCapsule: vi.fn(), exitWork: vi.fn() },
        navigation: {
          openConsultation: vi.fn(), openVoiceConsultation: vi.fn(), openTreatmentPlan: vi.fn(),
          openOutpatientFollowUp: vi.fn(), openReportInterpretation: vi.fn(), openInpatientEmr: vi.fn(),
          openDifferentialDiagnosis: vi.fn(), startVoiceInteraction,
        },
        generatedClinicalResultSession: {
          begin: vi.fn(), updateProgress: vi.fn(), updatePartial: vi.fn(), complete: vi.fn(), fail: vi.fn(),
        },
        resetVoiceSessionState: vi.fn(), clearVoiceConsultationCache: vi.fn(), clearMinimizedConsultationSessions: vi.fn(),
        hasCachedVoiceResult: () => false, queueConsultationAssistTrigger: vi.fn(),
      });
      return () => null;
    },
  });
  app.mount(document.createElement('div'));
  await listeners.registerAllListeners();
  const event = 'start-voice-consultation';
  const handle = vi.mocked(listen).mock.calls.find(([name]) => name === event)?.[1];
  if (!handle) throw new Error('Missing start-voice listener');

  const template = {
    requestId: 'SYN-REQ-1', templateId: 'SYN-TPL-1', templateName: '合成模板',
    templateHtml: '<p>合成模板</p>', templateDefinition: '[]', targetFieldIds: ['field'],
  };
  const first = { ...patient, outpatientEmr: template };
  handle({ event, id: 1, payload: first });
  await vi.waitFor(() => expect(startVoiceInteraction).toHaveBeenCalledOnce());
  expect(prepareVoiceOutpatientEmr).toHaveBeenCalledWith(first);
  const activePatient = currentPatient.value;

  handle({ event, id: 2, payload: { ...first, outpatientEmr: { ...template, templateId: 'SYN-TPL-2' } } });
  handle({ event, id: 3, payload: patient });
  handle({ event, id: 4, payload: { idPi: 'SYN-P2', idVis: 'SYN-V2' } });
  await Promise.resolve();

  expect(currentPatient.value).toBe(activePatient);
  expect(prepareVoiceOutpatientEmr).toHaveBeenCalledOnce();
  expect(clearVoiceOutpatientEmr).not.toHaveBeenCalled();
  expect(startVoiceInteraction).toHaveBeenCalledOnce();
  expect(showToast).toHaveBeenCalledWith('当前已接诊其他患者，请先结束当前就诊', 'error');
});
