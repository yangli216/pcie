// @vitest-environment jsdom
// Real result page, parser, model prompt/normalization, template editor and
// merged writeback builder. Only native I/O, model and snapshot HTTP are Fake.
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPatientContext } from '@/utils/patientContext';
import { buildOutpatientRecord } from '@features/clinical-result/outpatientRecord';
import type { ClinicalResultInput } from '@features/clinical-result/clinicalResultContract';
import type { VoiceOutpatientEmrStartContext } from '@features/outpatient-emr/types';
import VoiceConsultationNew from './VoiceConsultationNew.vue';

const host = vi.hoisted(() => ({
  received: [] as Array<Record<string, any>>,
  listeners: new Map<string, Set<(event: any) => void>>(),
  model: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', async original => ({
  ...await original<any>(),
  invoke: async (command: string, args: any) => {
    if (command === 'complete_consultation') host.received.push(JSON.parse(JSON.stringify(args.result)));
  },
}));
vi.mock('@tauri-apps/api/event', async original => ({
  ...await original<any>(),
  listen: async (name: string, callback: (event: any) => void) => {
    const callbacks = host.listeners.get(name) || new Set();
    host.listeners.set(name, callbacks);
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  },
  emit: async () => {},
  emitTo: async () => {},
}));
vi.mock('@tauri-apps/plugin-store', async original => {
  const store = { get: async () => null, set: async () => {}, save: async () => {}, delete: async () => true };
  return { ...await original<any>(), load: async () => store,
    Store: class { static load = async () => store; static get = async () => null; },
    LazyStore: class { get = store.get; set = store.set; save = store.save; delete = store.delete; } };
});
vi.mock('@/services/his', async original => ({
  ...await original<any>(),
  getHisAdapter: () => ({
    fetchFrequencyDictionary: async () => [],
    fetchMedicineUsageDictionary: async () => [],
    fetchAvailablePharmacies: async () => [],
    fetchMedicineStoreIds: async () => [],
    fetchExecutionDepartments: async () => [],
    getDefaultExecDeptId: () => '',
  }),
}));
vi.mock('@/services/llm', async original => ({
  ...await original<any>(),
  chat: async () => { throw new Error('Synthetic test: unrelated model offline'); },
  chatFast: (...args: any[]) => args[4]?.traceContext?.scene === 'outpatient-emr-analysis'
    ? host.model(...args)
    : Promise.resolve(JSON.stringify({ isNeeded: false, severity: 'none', items: [] })),
}));
vi.mock('@/services/consultationUserLog', async original => ({
  ...await original<any>(),
  submitConsultationUserLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService', () => ({
  resolveOutpatientEmrTemplateSnapshot: vi.fn().mockResolvedValue({ cacheHit: false }),
  persistOutpatientEmrTemplateSnapshot: vi.fn().mockResolvedValue({ id: 'SYN-TEMPLATE-SNAPSHOT' }),
}));
vi.mock('@tauri-apps/plugin-http', async original => ({
  ...await original<any>(),
  fetch: async () => { throw new Error('Synthetic test: HTTP offline'); },
}));

let app: App | undefined;
let container: HTMLDivElement;
async function settle(): Promise<void> {
  await nextTick();
  await new Promise(resolve => setTimeout(resolve, 10));
  await nextTick();
}

beforeEach(() => {
  host.received.length = 0;
  host.listeners.clear();
  host.model.mockReset();
  host.model.mockResolvedValue(JSON.stringify({ 主诉文本: '咳嗽3天', 现病史文本: '受凉后咳嗽3天，无发热。' }));
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('Synthetic test: browser HTTP offline'); });
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText')) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return this.textContent || ''; },
      set(value: string) { this.textContent = value; },
    });
  }
  if (!HTMLElement.prototype.scrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value() {} });
  }
});
afterEach(async () => {
  app?.unmount();
  app = undefined;
  container?.remove();
  await settle();
  vi.unstubAllGlobals();
});

function templateContext(): VoiceOutpatientEmrStartContext {
  return {
    visitId: 'SYN-VOICE-TPL-VISIT',
    template: {
      templateId: 'SYN-VOICE-TPL', templateName: '合成 HIS 内科布局', requestId: 'SYN-VOICE-TPL-REQUEST',
      targetFieldIds: ['主诉文本', '现病史文本'],
      templateHtml: '<table><tbody><tr><td>HIS 自定义门诊抬头</td></tr></tbody></table>'
        + '<section data-id="article-chief" data-article="主诉" data-name="主诉"><h3>HIS 主诉栏</h3>'
        + '<span data-id="主诉文本" data-name="主诉文本" data-type="text" data-readonly="false"><span class="tag-value"></span></span></section>'
        + '<section data-id="article-history" data-article="现病史" data-name="现病史"><h3>HIS 病史栏</h3>'
        + '<span data-id="现病史文本" data-name="现病史文本" data-type="text" data-readonly="false"><span class="tag-value"></span></span></section>',
      templateDefinition: JSON.stringify([
        { ID: 'article-chief', NAME: '主诉', ARTICLE: '主诉', eles: [
          { ID: '主诉文本', NAME: '主诉文本', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
        ] },
        { ID: 'article-history', NAME: '现病史', ARTICLE: '现病史', eles: [
          { ID: '现病史文本', NAME: '现病史文本', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
        ] },
      ]),
    },
  };
}

async function mountResult(context: VoiceOutpatientEmrStartContext): Promise<ReturnType<typeof vi.fn>> {
  const generated = buildOutpatientRecord({ chiefComplaint: '咳嗽3天', historyOfPresentIllness: '受凉后咳嗽3天，无发热。' });
  const intent: ClinicalResultInput = {
    ...generated, allergyHistory: '', currentMedicationHistory: '', symptoms: ['咳嗽'], negativeSymptoms: ['发热'],
    diagnoses: [{ name: '急性上呼吸道感染', code: 'J06.900', matchedItem: { id: 'SYN-DX', name: '急性上呼吸道感染', code: 'J06.900' } }],
    treatments: [], treatmentPlan: '', healthEducation: '', outpatientRecord: generated,
    recommendationPolicy: { autoFetchTreatments: false, allowTreatmentRefresh: false },
    generation: { status: 'complete', readySections: ['record_core', 'history_context', 'diagnoses', 'record_suggestions', 'record_extra'] },
  };
  const patient = buildPatientContext({ payload: {
    patientId: 'SYN-VOICE-TPL-PATIENT', visitId: context.visitId, patientName: '合成患者', gender: '男', ageText: '55岁',
  } })!;
  container = document.createElement('div');
  document.body.appendChild(container);
  const closed = vi.fn();
  app = createApp(defineComponent({ setup: () => () => h(VoiceConsultationNew, {
    initialPatientData: patient, intentResult: intent, intentSource: 'llm', channel: 'voice',
    consultationRoundId: 'SYN-VOICE-TPL-ROUND', voiceOutpatientEmrContext: context, onClose: closed,
  }) }));
  app.use(createPinia());
  app.provide('showToast', vi.fn());
  app.mount(container);
  await settle();
  return closed;
}

function submit(): HTMLButtonElement {
  return container.querySelector<HTMLButtonElement>('.footer-submit-btn')!;
}

function field(id: string): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-outpatient-emr-field-id="${id}"]`)!;
}

async function feedback(requestId: string, consultationId = 'SYN-VOICE-TPL-VISIT'): Promise<void> {
  for (const callback of host.listeners.get('consultation-reference-feedback') || []) {
    callback({ payload: { requestId, consultationId, referenceType: 'batch', action: 'batch', status: 'success' } });
  }
  await settle();
}

describe('voice result with an HIS outpatient template', () => {
  it('generates in the supplied layout before writeback, preserves doctor edits and sends one combined result', async () => {
    const closed = await mountResult(templateContext());
    await vi.waitFor(() => expect(field('主诉文本')?.textContent).toBe('咳嗽3天'));
    expect(host.model).toHaveBeenCalled();
    expect(host.received).toEqual([]);
    expect(container.querySelector('.template-document table')?.textContent).toBe('HIS 自定义门诊抬头');
    expect(container.textContent).toContain('HIS 主诉栏');
    expect(container.textContent).toContain('HIS 病史栏');
    expect(container.querySelector('.clinical-record-line')).toBeNull();

    field('主诉文本').textContent = '医生确认：咳嗽、咽痛3天';
    field('主诉文本').dispatchEvent(new InputEvent('input', { bubbles: true }));
    await vi.waitFor(() => expect(field('主诉文本').title).toBe('医生已修改'));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));

    const payload = host.received[0];
    expect(payload).toMatchObject({
      consultationId: 'SYN-VOICE-TPL-VISIT', requestId: 'SYN-VOICE-TPL-REQUEST',
      resultType: 'record-confirmed', emrType: 'outpatient-emr', referenceStatus: 'pending',
      fieldValues: { 主诉文本: '医生确认：咳嗽、咽痛3天', 现病史文本: '受凉后咳嗽3天，无发热。' },
      emrFieldValues: { 主诉文本: '医生确认：咳嗽、咽痛3天', 现病史文本: '受凉后咳嗽3天，无发热。' },
      outpatientRecord: { chiefComplaint: '医生确认：咳嗽、咽痛3天', historyOfPresentIllness: '受凉后咳嗽3天，无发热。' },
      diagList: [expect.objectContaining({ naDiag: '急性上呼吸道感染' })], orderList: [],
    });
    expect(payload.templateMetadata.templateId).toBe('SYN-VOICE-TPL');
    await vi.waitFor(() => expect(submit().disabled).toBe(true));
    submit().click();
    expect(host.received).toHaveLength(1);
    await feedback('OLD-REQUEST');
    await feedback(payload.requestId, 'OTHER-VISIT');
    expect(closed).not.toHaveBeenCalled();
    await feedback(payload.requestId);
    await feedback(payload.requestId);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it.each(['parse', 'model'] as const)('blocks %s failure without a fixed-record fallback or outbound result', async (failure) => {
    const context = templateContext();
    if (failure === 'parse') context.template.templateDefinition = '[';
    else host.model.mockRejectedValue(new Error('合成模板模型失败'));
    const closed = await mountResult(context);
    await vi.waitFor(() => expect(container.querySelector('.voice-template-record [role="alert"]')).not.toBeNull());
    expect(container.querySelector('.clinical-record-line')).toBeNull();
    expect(submit().disabled).toBe(true);
    submit().click();
    await settle();
    expect(host.received).toEqual([]);
    expect(closed).not.toHaveBeenCalled();
    if (failure === 'parse') expect(host.model).not.toHaveBeenCalled();
    else expect(container.textContent).toContain('重新生成模板病历');
  });
});
