import { nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import { useVoiceOutpatientEmrWorkflow } from './useVoiceOutpatientEmrWorkflow';

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
  it('retains an isolated template snapshot for the inline voice result', () => {
    const currentPatient = ref<AppPatient | null>(createPatient());
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient });
    const payload = createPayload();
    expect(workflow.prepareFromStartVoice(payload)).toBe(true);
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
  ])('rejects invalid or mismatched template input and clears the previous task', (payload) => {
    const notify = vi.fn();
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()), notify });
    expect(workflow.prepareFromStartVoice(createPayload())).toBe(true);
    expect(workflow.prepareFromStartVoice(payload)).toBe(false);
    expect(workflow.startContext.value).toBeNull();
    expect(workflow.deferredWritebackRequestId.value).toBe('');
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'error');
  });

  it('clears a previous template when the next voice request has no template', () => {
    const workflow = useVoiceOutpatientEmrWorkflow({ currentPatient: ref(createPatient()) });
    workflow.prepareFromStartVoice(createPayload());
    expect(workflow.prepareFromStartVoice({ idPi: 'P001', idVis: 'VIS-001' })).toBe(true);
    expect(workflow.startContext.value).toBeNull();
    expect(workflow.hasTemplateContinuation.value).toBe(false);
    expect(workflow.deferredWritebackRequestId.value).toBe('');
    workflow.prepareFromStartVoice(createPayload());
    workflow.clear();
    expect(workflow.startContext.value).toBeNull();
  });

  it('clears the continuation when the current visit changes', async () => {
    const currentPatient = ref<AppPatient | null>(createPatient());
    const workflow = useVoiceOutpatientEmrWorkflow({
      currentPatient,
    });
    workflow.prepareFromStartVoice(createPayload());

    currentPatient.value = {
      ...createPatient(),
      identity: { patientId: 'P001', visitId: 'VIS-002' },
      visitId: 'VIS-002',
      idVis: 'VIS-002',
    };
    await nextTick();

    expect(workflow.hasTemplateContinuation.value).toBe(false);
  });
});
