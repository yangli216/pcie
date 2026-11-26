import { nextTick, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearFeedbackActor, setFeedbackActor } from '@/services/feedbackContext';
import type { AppPatient } from '@/types/appState';
import { prepareVoiceOutpatientRecognitionTemplate } from '../lib/voiceOutpatientEmrRecognition';
import { useVoiceOutpatientEmrWorkflow } from './useVoiceOutpatientEmrWorkflow';

vi.mock('../lib/voiceOutpatientEmrRecognition', () => ({ prepareVoiceOutpatientRecognitionTemplate: vi.fn(async () => undefined) }));

function createPatient(): AppPatient {
  return {
    identity: { patientId: 'P001', visitId: 'VIS-001' },
    demographics: {
      patientName: '张三',
      genderText: '男性',
      ageText: '45岁',
    },
    clinical: {},
    patientId: 'P001',
    visitId: 'VIS-001',
    patientName: '张三',
    genderText: '男性',
    ageText: '45岁',
    idPi: 'P001',
    idVis: 'VIS-001',
    naPi: '张三',
    sdSexText: '男性',
  };
}

function createPayload() {
  return {
    idPi: 'P001',
    idVis: 'VIS-001',
    outpatientEmr: {
      templateId: 'TPL-001',
      templateName: '门诊模板',
      templateHtml: '<section data-id="chief"></section>',
      templateDefinition: '[{"ID":"chief"}]',
      targetFieldIds: ['chief'],
      requestId: 'REQ-001',
    },
  };
}

describe('useVoiceOutpatientEmrWorkflow', () => {
  afterEach(clearFeedbackActor);

  it('keeps the starting HIS institution for display when the handshake changes', async () => {
    setFeedbackActor({ orgName: '合成社区中心' });
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()) });
    await workflow.prepareFromStartVoice(createPayload());
    setFeedbackActor({ orgName: '另一合成机构' });
    expect(workflow.startContext.value?.displayOrgName).toBe('合成社区中心');
    expect(workflow.startContext.value?.template).toEqual(createPayload().outpatientEmr);
  });

  it('retains an isolated template snapshot for the inline voice result', async () => {
    const currentPatient = ref<AppPatient | null>(createPatient());
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient });
    const payload = createPayload();
    await expect(workflow.prepareFromStartVoice(payload)).resolves.toBe(true);
    expect(workflow.startContext.value).toEqual({ visitId: 'VIS-001', template: payload.outpatientEmr });
    payload.outpatientEmr.templateName = '已在 HIS 切换';
    payload.outpatientEmr.targetFieldIds.push('not-authorized');
    expect(workflow.startContext.value?.template.templateName).toBe('门诊模板');
    expect(workflow.startContext.value?.template.targetFieldIds).toEqual(['chief']);
    expect(workflow.hasTemplateContinuation.value).toBe(true);
    expect(workflow.deferredWritebackRequestId.value).toBe('REQ-001');
  });

  it.each([
    { ...createPayload(), idVis: '' },
    { ...createPayload(), idVis: 'OTHER-VISIT' },
    { ...createPayload(), outpatientEmr: { ...createPayload().outpatientEmr, unsupported: true } },
    { ...createPayload(), outpatientEmr: { ...createPayload().outpatientEmr, targetFieldIds: ['chief', 'chief'] } },
  ])('rejects invalid or mismatched template input and clears the previous task', async (payload) => {
    const notify = vi.fn();
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()), notify });
    await expect(workflow.prepareFromStartVoice(createPayload())).resolves.toBe(true);
    await expect(workflow.prepareFromStartVoice(payload)).resolves.toBe(false);
    expect(workflow.startContext.value).toBeNull();
    expect(workflow.deferredWritebackRequestId.value).toBe('');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('clears a previous template when the next voice request has no template', async () => {
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()) });
    await workflow.prepareFromStartVoice(createPayload());
    await expect(workflow.prepareFromStartVoice({ idPi: 'P001', idVis: 'VIS-001' })).resolves.toBe(true);
    expect(workflow.startContext.value).toBeNull();
    expect(workflow.hasTemplateContinuation.value).toBe(false);
    expect(workflow.deferredWritebackRequestId.value).toBe('');
    await workflow.prepareFromStartVoice(createPayload());
    workflow.clear();
    expect(workflow.startContext.value).toBeNull();
  });

  it('clears the continuation when the current visit changes', async () => {
    const currentPatient = ref<AppPatient | null>(createPatient());
    const workflow = useVoiceOutpatientEmrWorkflow({
      currentPatient,
    });
    await workflow.prepareFromStartVoice(createPayload());

    currentPatient.value = {
      ...createPatient(),
      identity: { patientId: 'P001', visitId: 'VIS-002' },
      visitId: 'VIS-002',
      idVis: 'VIS-002',
    };
    await nextTick();

    expect(workflow.hasTemplateContinuation.value).toBe(false);
  });
  it('prepares every repeated voice start with the same template and request', async () => {
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()) });
    const payload = createPayload();
    await expect(workflow.prepareFromStartVoice(payload)).resolves.toBe(true);
    await expect(workflow.prepareFromStartVoice(payload)).resolves.toBe(true);
    expect(prepareVoiceOutpatientRecognitionTemplate).toHaveBeenCalledTimes(2);
  });

  it('allows recording after a synchronization error and retries on the next start', async () => {
    vi.mocked(prepareVoiceOutpatientRecognitionTemplate).mockRejectedValueOnce(new Error('synthetic network error'));
    const notify = vi.fn();
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()), notify });
    await expect(workflow.prepareFromStartVoice(createPayload())).resolves.toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('确认转写后将重试'), 'error');
    await expect(workflow.prepareFromStartVoice(createPayload())).resolves.toBe(true);
    expect(prepareVoiceOutpatientRecognitionTemplate).toHaveBeenCalledTimes(2);
  });

  it('does not open a voice session after its pending template query was invalidated', async () => {
    let finish!: () => void;
    vi.mocked(prepareVoiceOutpatientRecognitionTemplate).mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { finish = resolve; });
      return undefined;
    });
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()) });
    const pending = workflow.prepareFromStartVoice(createPayload());
    workflow.clear();
    finish();
    await expect(pending).resolves.toBe(false);
    expect(workflow.startContext.value).toBeNull();
  });

});
