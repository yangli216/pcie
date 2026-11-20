// @vitest-environment jsdom
// Real result page, parser, model prompt/normalization, template editor and
// merged writeback builder. Only native I/O, model and snapshot HTTP are Fake.
import { syntheticReceipt } from '@/test/template-parsing/outpatientFieldPolicyFixture';
import policyWire from '@/test/template-parsing/fixtures/outpatient-field-policy-wire.json';
import * as snapshots from '@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService';
import { createApp, defineComponent, h, nextTick, ref, type App, type Ref } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  getVoiceConsultationCacheScope, persistVoiceConsultationCacheEntry, type VoiceEditorSnapshot,
} from '@features/voice-consultation/model/voiceConsultationCache';
import { buildPatientContext } from '@/utils/patientContext';
import * as regionalClient from '@/services/regionalClient';
import { audioRecorder } from '@/services/audioRecorder';
import { RealtimeSpeechService } from '@/services/aliyunSpeech';
import { buildOutpatientRecord } from '@features/clinical-result/outpatientRecord';
import type { ClinicalResultInput } from '@features/clinical-result/clinicalResultContract';
import { buildVoiceOutpatientEmrDocument, prepareVoiceOutpatientRecognitionTemplate } from '@features/outpatient-emr/lib/voiceOutpatientEmrRecognition';
import { hashOutpatientEmrTemplate } from '@features/outpatient-emr/lib/outpatientEmrWriteback';
import { clearVoiceOutpatientEmrRecordDraftCache } from '@features/outpatient-emr/lib/voiceOutpatientEmrDraftCache';
import type { VoiceOutpatientEmrStartContext } from '@features/outpatient-emr/types';
import internalMedicineHtml from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import internalMedicineDefinition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';
import VoiceCapsule from '@features/voice-consultation/ui/VoiceCapsule.vue';
import VoiceConsultationNew from './VoiceConsultationNew.vue';

const host = vi.hoisted(() => ({
  received: [] as Array<Record<string, any>>,
  listeners: new Map<string, Set<(event: any) => void>>(),
  model: vi.fn(),
  diagnosis: vi.fn(),
  regenerate: vi.fn(),
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
    fetchFrequencyDictionary: async () => [{ key: 'BID', text: '每日两次', execCount: 2 }],
    fetchMedicineUsageDictionary: async () => [],
    fetchAvailablePharmacies: async () => [{ name: '合成药房', idSto: 'SYN-STORE', idDept: 'SYN-DEPT' }],
    fetchMedicineProDetail: async () => ({
      active: true, productName: '合成片', productId: 'SYN-PRIVATE-CATALOG-ID',
      dose: '1', doseUnit: '片', defaultSingleDose: '1', defaultFrequency: 'BID',
      defaultRoute: '口服', storeId: 'SYN-STORE', specSale: '5mg/片', unitSale: '片',
      raw: { idMedPro: 'SYN-PRIVATE-CATALOG-ID', idSto: 'SYN-STORE', unitDose: '片',
        dose: '1', unitPre: '片', unitSale: '片', unitSaleFactor: 1, priceSale: 2 },
    }),
    getContextScope: () => ({ orgCode: 'SYN-ORG', tenantId: 'SYN-TENANT' }),
    fetchAvailableMedicineInventory: async () => [{
      storeId: 'SYN-STORE', productId: 'SYN-PRIVATE-CATALOG-ID', availableQuantity: 100, unitPrice: 2,
    }],
    checkMedicineInventoryEnough: async () => ({ code: 200, message: '' }),
    fetchMedicineStoreIds: async () => [],
    fetchExecutionDepartments: async () => [],
    getDefaultExecDeptId: () => '',
  }),
}));
vi.mock('@/services/llm', async original => ({
  ...await original<any>(),
  chat: async (...args: any[]) => {
    if (args[4]?.traceContext?.scene === 'voice-consultation-diagnosis') return host.diagnosis(...args);
    if (args[4]?.traceContext?.scene === 'clinical-result-regeneration') return host.regenerate(...args);
    throw new Error('Synthetic test: unrelated model offline');
  },
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
  persistOutpatientEmrTemplateSnapshot: vi.fn().mockImplementation(input => syntheticReceipt(input)),
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
  clearVoiceOutpatientEmrRecordDraftCache();
  host.received.length = 0;
  host.listeners.clear();
  host.diagnosis.mockReset().mockResolvedValue('[]');
  host.model.mockReset();
  host.regenerate.mockReset();
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

async function mountResult(
  context: VoiceOutpatientEmrStartContext,
  factsReady: Ref<boolean> = ref(true),
  capturing: Ref<boolean> = ref(false),
  treatments: ClinicalResultInput['treatments'] = [],
  editorSnapshot?: VoiceEditorSnapshot,
  patientGender = '男',
  factSuggestions: ClinicalResultInput['factSuggestions'] = [],
  options: {
    legacyCache?: boolean;
    templateError?: string;
    fieldValues?: Record<string, string | null>;
    policyRevision?: number;
    decoded?: { templateHtml: string; templateDefinition: string };
    streaming?: Ref<boolean>;
    chapters?: Array<Pick<NonNullable<ClinicalResultInput['voiceTemplateDocument']>['chapters'][number], 'chapterId' | 'title' | 'fieldIds'>>;
    cachedChapterTexts?: Record<string, string>;
    record?: Partial<ReturnType<typeof buildOutpatientRecord>>;
    diagnoses?: ClinicalResultInput['diagnoses'];
  } = {},
): Promise<ReturnType<typeof vi.fn>> {
  const generated = buildOutpatientRecord({ chiefComplaint: '咳嗽3天', historyOfPresentIllness: '受凉后咳嗽3天，无发热。', ...options.record });
  const intent: ClinicalResultInput = {
    ...generated, allergyHistory: '', currentMedicationHistory: '', symptoms: ['咳嗽'], negativeSymptoms: ['发热'],
    diagnoses: options.diagnoses ?? [{ name: '急性上呼吸道感染', code: 'J06.900', matchedItem: { id: 'SYN-DX', name: '急性上呼吸道感染', code: 'J06.900' } }],
    treatments, treatmentPlan: '', healthEducation: '', outpatientRecord: generated, factSuggestions,
    recommendationPolicy: { autoFetchTreatments: false, allowTreatmentRefresh: false },
    generation: { status: 'complete', readySections: ['record_core', 'history_context', 'diagnoses', 'record_suggestions', 'record_extra'] },
  };
  const { template } = context;
  const source = options.decoded || template;
  if (options.templateError) intent.voiceTemplateError = options.templateError;
  else if (!options.legacyCache) intent.voiceTemplateDraft = {
    visitId: context.visitId, templateId: template.templateId, requestId: template.requestId,
    policyRevision: options.policyRevision ?? 0, ruleSetVersion: 'outpatient-emr-field-prompt.v5',
    templateHash: await hashOutpatientEmrTemplate(source.templateHtml, source.templateDefinition),
    targetFieldIds: [...template.targetFieldIds], fieldValues: options.fieldValues ?? {},
  };
  if (options.chapters && intent.voiceTemplateDraft) {
    const prepared = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    expect(prepared).toBeDefined();
    intent.voiceTemplateDocument = buildVoiceOutpatientEmrDocument(prepared!, options.fieldValues);
    expect(intent.voiceTemplateDocument.chapters.map(chapter => ({
      chapterId: chapter.chapterId, title: chapter.title, fieldIds: chapter.editableFieldIds,
    }))).toEqual(expect.arrayContaining(options.chapters));
    for (const chapter of intent.voiceTemplateDocument.chapters) {
      if (options.cachedChapterTexts?.[chapter.chapterId]) chapter.text = options.cachedChapterTexts[chapter.chapterId];
    }
  }
  const streamingIntent: ClinicalResultInput = {
    ...intent, voiceTemplateDraft: undefined, generation: { ...intent.generation!, status: 'streaming' },
  };
  const patient = buildPatientContext({ payload: {
    patientId: 'SYN-VOICE-TPL-PATIENT', visitId: context.visitId, patientName: '合成患者', gender: patientGender, ageText: '55岁',
  } })!;
  if (editorSnapshot) persistVoiceConsultationCacheEntry({
    consultationId: context.visitId, ownerScope: getVoiceConsultationCacheScope(patient),
    intentResult: intent, transcribedText: '合成同轮语音', savedAt: Date.now(),
    editorSnapshot: { ...editorSnapshot, consultationRoundId: 'SYN-VOICE-TPL-ROUND' },
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  const closed = vi.fn();
  app = createApp(defineComponent({ setup: () => () => capturing.value
    ? h(VoiceCapsule, { onStop: () => { capturing.value = false; } })
    : h(VoiceConsultationNew, {
      initialPatientData: patient, intentResult: factsReady.value ? (options.streaming?.value ? streamingIntent : intent) : null,
      intentSource: editorSnapshot || options.legacyCache || options.cachedChapterTexts ? 'cache' : 'llm', channel: 'voice',
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
  return recordLine(id.replace(/文本$/u, ''))?.closest<HTMLElement>('.record-field')!;
}

async function editField(id: string, text: string): Promise<void> {
  const target = field(id);
  target.querySelector<HTMLElement>('.clinical-record-line')!.click();
  await nextTick();
  const editor = target.querySelector<HTMLElement>('[role="textbox"][contenteditable="plaintext-only"]')!;
  editor.innerText = text;
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  editor.dispatchEvent(new FocusEvent('blur'));
  await nextTick();
}

function recordLabels(): string[] {
  return Array.from(container.querySelectorAll('.vcn-left-panel .clinical-record-line label'))
    .map(label => label.textContent?.trim() || '');
}

function recordLine(title: string): HTMLElement {
  return Array.from(container.querySelectorAll<HTMLElement>('.vcn-left-panel .clinical-record-line'))
    .find(line => line.querySelector('label')?.textContent === title + '：')!;
}

function recordText(title: string): string {
  const copy = recordLine(title).cloneNode(true) as HTMLElement;
  copy.querySelectorAll('label, .clinical-record-annotation-sign').forEach(node => node.remove());
  copy.querySelectorAll('.clinical-record-annotation').forEach(node => { node.textContent = node.textContent?.trim() || ''; });
  return copy.textContent?.trim() || '';
}

async function openSectionEditor(title: string): Promise<HTMLElement> {
  const trigger = container.querySelector<HTMLButtonElement>('.writeback-scope-trigger')!;
  if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
  await nextTick();
  const details = await vi.waitFor(() => {
    const review = container.querySelector<HTMLDetailsElement>('.template-review');
    expect(review).not.toBeNull();
    return review!;
  });
  details.open = true;
  return Array.from(details.querySelectorAll('fieldset')).find(group => group.querySelector('legend')?.textContent === title)!;
}

function changeSectionText(group: HTMLElement, title: string, value: string): void {
  const input = group.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${title}"]`)!;
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function clickButton(root: HTMLElement, text: string): void {
  Array.from(root.querySelectorAll('button')).find(button => button.textContent?.trim() === text)!.click();
}

function familyTemplateContext(): VoiceOutpatientEmrStartContext {
  const context = templateContext();
  context.template.targetFieldIds.push('家族史分类', '家族史说明');
  context.template.templateHtml += '<section data-id="family" data-article="家族史" data-name="家族史">'
    + '<span data-id="家族史分类" data-name="家族史分类" data-type="select" data-readonly="false"></span>家族'
    + '<span data-id="家族史说明" data-name="家族史说明" data-type="text" data-readonly="false"></span>。</section>';
  const chapters = JSON.parse(context.template.templateDefinition);
  chapters.push({ ID: 'family', NAME: '家族史', ARTICLE: '家族史', eles: [
    { ID: '家族史分类', NAME: '家族史分类', TYPE: 'select', READONLY: false, VALUE: '', TEXT: '',
      BINDINGDATA: [{ VALUE: '1', TEXT: '有' }, { VALUE: '0', TEXT: '无' }] },
    { ID: '家族史说明', NAME: '家族史说明', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
  ] });
  context.template.templateDefinition = JSON.stringify(chapters);
  host.model.mockResolvedValue(JSON.stringify({ 主诉文本: '咳嗽3天', 现病史文本: '无发热', 家族史分类: '无', 家族史说明: '遗传病史' }));
  return context;
}

async function feedback(requestId: string, consultationId = 'SYN-VOICE-TPL-VISIT', status = 'success'): Promise<void> {
  for (const callback of host.listeners.get('consultation-reference-feedback') || []) {
    callback({ payload: { requestId, consultationId, referenceType: 'batch', action: 'batch', status } });
  }
  await settle();
}

describe('voice result with an HIS outpatient template', () => {
  it('refreshes the saved split-field rule for a doctor supplement and submits the reviewed raw controls', async () => {
    const { templateHtml, templateDefinition, templateId, templateName } = policyWire.request;
    const context = { visitId: 'SYN-VOICE-TPL-VISIT', template: { templateId, templateName, templateHtml, templateDefinition,
      requestId: 'SYN-SUPPLEMENT', targetFieldIds: ['symptom', 'duration', 'manualRemark'] } };
    const api = await vi.importActual<typeof snapshots>('@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService');
    const http = vi.spyOn(regionalClient, 'regionalPost').mockResolvedValue(policyWire.configured);
    const resolve = vi.mocked(snapshots.resolveOutpatientEmrTemplateSnapshot);
    const previous = resolve.getMockImplementation()!;
    resolve.mockImplementation(api.resolveOutpatientEmrTemplateSnapshot);
    onTestFinished(() => { http.mockRestore(); resolve.mockImplementation(previous); });
    host.diagnosis.mockResolvedValue(JSON.stringify([{ id: 'SYN-DX', code: 'J06.900', name: '急性上呼吸道感染', rate: '95%' }]));
    host.regenerate.mockResolvedValue(JSON.stringify({ templateFieldValues: { duration: '4', manualRemark: '越权的模型值' } }));
    await mountResult(context, ref(true), ref(false), [], undefined, '男', [], {
      policyRevision: 2, fieldValues: { symptom: '咳嗽', duration: '3' }, diagnoses: [],
    });
    await vi.waitFor(() => expect(recordText('主诉')).toBe('咳嗽3天'));
    const beforeSupplement = http.mock.calls.length;
    container.querySelector<HTMLButtonElement>('[aria-label="补充说明并重新生成病历"]')!.click();
    await settle();
    const supplement = document.querySelector<HTMLTextAreaElement>('.supplement-textarea')!;
    supplement.value = '患者核对咳嗽已经4天';
    supplement.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('.supplement-dialog .primary-button')!.click();
    await vi.waitFor(() => expect(host.regenerate).toHaveBeenCalledOnce());
    const [system, data] = host.regenerate.mock.calls[0][0];
    const request = JSON.parse(data.content.split('输入数据如下：\n\n')[1]);
    expect(http.mock.calls.slice(beforeSupplement).map(([path]) => path)).toContain('/v1/client/outpatient-emr/templates/snapshots/resolve');
    expect(system.content.split('持续时间由相邻栏填写。')).toHaveLength(2);
    expect(JSON.stringify(request.templateReferenceChapters)).toContain('HIS已登记');
    expect(request.templateChapters.flatMap((chapter: { editableFieldIds: string[] }) => chapter.editableFieldIds)).toEqual(['symptom', 'duration']);
    await vi.waitFor(() => expect(recordText('主诉')).toBe('咳嗽4天'));
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].fieldValues).toMatchObject({ symptom: '咳嗽', duration: '4' });
    expect(JSON.stringify(host.received[0])).not.toContain('越权的模型值');
    expect(host.received[0].outpatientRecord.chiefComplaint).toBe('症状名称：咳嗽；持续时间：4');
  });

  it('opens the clinical document when transcription is confirmed and decodes its HIS field metadata once', async () => {
    const capturing = ref(true);
    const factsReady = ref(false);
    const context = templateContext();
    const source = {
      schemaVersion: 'outpatient-emr-template-decoded.v1',
      templateHtml: '<script>unsafe()</script>' + context.template.templateHtml,
      templateDefinition: context.template.templateDefinition,
    };
    context.template.templateHtml = 'data:text/html;charset=utf-8;base64,PHNlY3Rpb24+';
    context.template.templateDefinition = 'data:application/json;charset=utf-8;base64,W10=';
    let finishDecode!: (value: typeof source) => void;
    const decoding = new Promise<typeof source>(resolve => { finishDecode = resolve; });
    const post = vi.spyOn(regionalClient, 'regionalPost').mockReturnValueOnce(decoding);
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const spies = [
      post,
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null),
      vi.spyOn(audioRecorder, 'start').mockResolvedValue(undefined),
      vi.spyOn(audioRecorder, 'stop').mockResolvedValue(new Blob(['synthetic recording'], { type: 'audio/wav' })),
      vi.spyOn(RealtimeSpeechService.prototype, 'start').mockResolvedValue(undefined),
      vi.spyOn(RealtimeSpeechService.prototype, 'finish').mockResolvedValue('合成转写'),
    ];
    onTestFinished(() => { spies.forEach(spy => spy.mockRestore()); });

    await mountResult(context, factsReady, capturing, [], undefined, '男', [], { decoded: source });
    expect(container.querySelector('[aria-label="门诊病历模板预览"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    container.querySelector<HTMLButtonElement>('button[title="结束接诊"]')!.click();
    const confirm = await vi.waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>('.stopped-actions .confirm');
      expect(button?.disabled).toBe(false);
      return button!;
    });
    expect(container.textContent).toContain('合成转写');
    expect(container.querySelector('[aria-label="门诊病历模板预览"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();
    confirm.click();

    await vi.waitFor(() => expect(post).toHaveBeenCalled());
    expect(recordLabels()).toEqual([]);
    expect(container.textContent).not.toContain('HIS 自定义门诊抬头');
    expect(post).toHaveBeenCalledWith('/v1/client/outpatient-emr/templates/decode', {
      schemaVersion: 'outpatient-emr-template-decode.v1',
      templateHtml: context.template.templateHtml,
      templateDefinition: context.template.templateDefinition,
    });
    finishDecode(source);
    await settle();
    expect(recordLabels().every(title => ['主诉：', '现病史：'].includes(title))).toBe(true);
    expect(container.querySelector('.vcn-left-panel script, .template-document')).toBeNull();
    expect(container.textContent).not.toContain('HIS 自定义门诊抬头');
    expect(host.model).not.toHaveBeenCalled();
    expect(submit().disabled).toBe(true);
    factsReady.value = true;
    await vi.waitFor(() => expect(field('主诉文本')?.querySelector('.clinical-record-line')).toBeTruthy());
    expect(post.mock.calls.filter(([path]) => path.endsWith('templates/decode'))).toHaveLength(1);
    expect(host.received).toEqual([]);
  });

  it('finalizes the same rendered paragraphs and annotations without starting another model or applying template prose', async () => {
    const streaming = ref(true);
    const context = familyTemplateContext();
    const suggestion = {
      id: 'synthetic-suggestion', field: 'historyOfPresentIllness', question: '核对伴随症状',
      negativeRecordText: '无发热', rationale: '合成依据', priority: 'critical', status: 'pending',
    } as const;
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [suggestion], {
      streaming, fieldValues: { 主诉文本: '咳嗽3天', 现病史文本: '受凉后咳嗽3天，无发热。', 家族史分类: '有', 家族史说明: '合成说明' },
      chapters: [
        { chapterId: 'article-chief', title: '主诉', fieldIds: ['主诉文本'] },
        { chapterId: 'article-history', title: '现病史', fieldIds: ['现病史文本'] },
        { chapterId: 'family', title: '家族史', fieldIds: ['家族史分类', '家族史说明'] },
      ],
    });
    const lines = () => Array.from(container.querySelectorAll('.record-fields .clinical-record-line'));
    const before = lines();
    const texts = before.map(line => line.textContent);
    const annotation = recordLine('现病史').querySelector('[data-clinical-fact-id="synthetic-suggestion"]');
    expect(recordLabels()).toEqual(['主诉：', '现病史：', '家族史：']);
    expect(annotation).not.toBeNull();
    expect(submit().disabled).toBe(true);
    streaming.value = false;
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    for (const [index, line] of lines().entries()) expect(line).toBe(before[index]);
    expect(lines().map(line => line.textContent)).toEqual(texts);
    expect(recordLine('现病史').querySelector('[data-clinical-fact-id="synthetic-suggestion"]')).toBe(annotation);
    expect(host.model).not.toHaveBeenCalled();
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].outpatientRecord.historyOfPresentIllness).toBe('受凉后咳嗽3天，无发热。');
    expect(host.received[0].fieldValues.现病史文本).toBe('受凉后咳嗽3天，无发热。');
    expect(host.received[0].dictionarySelections.家族史分类.value).toBe('1');
  });

  it('keeps the clinical result when initial template preparation fails and retries the binding only on request', async () => {
    await mountResult(templateContext(), ref(true), ref(false), [], undefined, '男', [], {
      templateError: '本次门诊模板准备失败，已保留语音病历。',
    });
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')?.textContent).toContain('模板准备失败'));
    expect(recordLabels().every(title => ['主诉：', '现病史：'].includes(title))).toBe(true);
    expect(submit().disabled).toBe(true);
    expect(host.model).not.toHaveBeenCalled();
    clickButton(container, '重试模板回写字段');
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(host.model).toHaveBeenCalledTimes(1);
    expect(recordLabels()).toEqual(['主诉：', '现病史：']);
    expect(recordLine('现病史').textContent).toContain('咳嗽3天');
  });

  it('renders the mapped draft in the original sections, preserves doctor edits and sends one combined result', async () => {
    const closed = await mountResult(templateContext());
    await vi.waitFor(() => expect(field('主诉文本')?.textContent).toContain('咳嗽3天'));
    expect(host.model).not.toHaveBeenCalled();
    expect(host.received).toEqual([]);
    expect(container.querySelector('.template-document')).toBeNull();
    expect(container.textContent).not.toMatch(/HIS 自定义门诊抬头|HIS 主诉栏|HIS 病史栏/);
    expect(recordLabels()).toEqual(['主诉：', '现病史：']);
    expect(field('现病史文本').querySelector('.clinical-record-annotation.is-positive')?.textContent).toContain('咳嗽');

    await editField('主诉文本', '医生确认：咳嗽、咽痛3天');
    expect(recordText('主诉')).toBe('医生确认：咳嗽、咽痛3天');
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

  it('renders the current source chapters for a female patient when a restored result lacks a chapter document', async () => {
    await mountResult(templateContext(), ref(true), ref(false), [], undefined, '女');
    await vi.waitFor(() => expect(field('主诉文本')?.textContent).toContain('咳嗽3天'));
    expect(recordLabels()).toEqual(['主诉：', '现病史：']);
    expect(container.textContent).not.toContain('HIS 自定义门诊抬头');
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].fieldValues).not.toHaveProperty('月经史');
    expect(host.received[0].writebackScope.recordFields).not.toContain('menstrualHistory');
    expect(host.received[0].outpatientRecord).not.toHaveProperty('menstrualHistory');
  });

  it('retains source order and independent chapters through streaming, editing and the one confirmed result', async () => {
    const context = templateContext();
    const fieldValues = {
      辅助检查结果文本: '检验单尚待补充。', 注意事项文本: '留存报告。', 体温: '37.4', 主诉文本: '合成主诉。',
      时间单位: '天', 持续时间: '2', 肝炎史标志: '0', 医嘱其他补充: '合成医嘱。', 西医诊断: '待查',
    };
    Object.assign(context.template, {
      templateHtml: internalMedicineHtml, templateDefinition: internalMedicineDefinition,
      targetFieldIds: Object.keys(fieldValues),
    });
    const chapters = [
      { chapterId: '主诉', title: '主诉', fieldIds: ['主诉文本'] },
      { chapterId: '现病史', title: '现病史', fieldIds: ['持续时间', '时间单位'] },
      { chapterId: '既往史', title: '既往史', fieldIds: ['肝炎史标志'] },
      { chapterId: '体格检查', title: '体格检查', fieldIds: ['体温'] },
      { chapterId: '辅助检查', title: '辅助检查', fieldIds: ['辅助检查结果文本'] },
      { chapterId: '门急诊诊断', title: '西医诊断', fieldIds: ['西医诊断'] },
      { chapterId: '处理', title: '医嘱', fieldIds: ['医嘱其他补充'] },
      { chapterId: '注意事项', title: '注意事项及宣教', fieldIds: ['注意事项文本'] },
    ];
    const streaming = ref(true);
    const suggestion = {
      id: 'synth-history', field: 'historyOfPresentIllness', question: '核对伴随症状',
      negativeRecordText: '无发热', rationale: '合成依据', priority: 'critical', status: 'pending',
    } as const;
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [suggestion], { streaming, fieldValues, chapters });
    const lines = () => Array.from(container.querySelectorAll('.record-fields .clinical-record-line'));
    const titles = chapters.map(chapter => chapter.title + '：');
    await vi.waitFor(() => expect(recordLabels()).toEqual(titles));
    const before = lines();
    const contents = before.map(line => line.textContent);
    const mark = recordLine('现病史').querySelector('[data-clinical-fact-id="synth-history"]');
    expect(mark).not.toBeNull();
    expect(contents[4]).toContain('检验单尚待补充。');
    expect(submit().disabled).toBe(true);
    streaming.value = false;
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(lines().map(line => line.textContent)).toEqual(contents);
    lines().forEach((line, i) => expect(line).toBe(before[i]));
    expect(recordLine('现病史').querySelector('[data-clinical-fact-id="synth-history"]')).toBe(mark);
    await editField('辅助检查', '医生核对检验报告。');
    expect(recordLine('辅助检查').textContent).toContain('医生核对检验报告。');
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    const result = host.received[0];
    expect(result.fieldValues).toMatchObject({ 辅助检查结果文本: '医生核对检验报告。', 西医诊断: '待查', 医嘱其他补充: '合成医嘱。' });
    expect(result.emrFieldValues.辅助检查结果文本).toBe('医生核对检验报告。');
    expect(result.outpatientRecord).not.toHaveProperty('menstrualHistory');
    expect(Object.values(result.outpatientRecord)).not.toContain('医生核对检验报告。');
    expect(host.model).not.toHaveBeenCalled();
  });

  it('uses first-pass history and vitals and keeps read-only and out-of-scope source IDs out of HIS bindings', async () => {
    const context = templateContext();
    const source = document.createElement('template');
    source.innerHTML = internalMedicineHtml;
    source.content.querySelector<HTMLElement>('[data-id="舒张压"]')!.dataset.readonly = 'true';
    const definition = JSON.parse(internalMedicineDefinition) as Array<{ eles: Array<{ ID: string; READONLY: boolean }> }>;
    definition.flatMap(chapter => chapter.eles).find(item => item.ID === '舒张压')!.READONLY = true;
    const fieldValues = { 肝炎史标志: '1', 体温: '37.8', 收缩压: '128' };
    // Diastolic pressure is read-only. Pulse is writable. Both are visible in the source,
    // but the HIS did not request either ID even though the reviewed prose contains both values.
    Object.assign(context.template, {
      templateHtml: source.innerHTML, templateDefinition: JSON.stringify(definition),
      targetFieldIds: Object.keys(fieldValues),
    });
    const cachedHistory = '合成病例报告有肝炎史。';
    const cachedExam = '体温37.8℃，脉搏88次/分，血压128/74mmHg。';
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [], {
      record: { pastMedicalHistory: '否认肝炎史。', physicalExam: '体温36.1℃，脉搏68次/分，血压104/62mmHg。' },
      fieldValues,
      cachedChapterTexts: { 既往史: cachedHistory, 体格检查: cachedExam },
      chapters: [
        { chapterId: '既往史', title: '既往史', fieldIds: ['肝炎史标志'] },
        { chapterId: '体格检查', title: '体格检查', fieldIds: ['体温', '收缩压'] },
      ],
    });
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    const history = recordText('既往史');
    const exam = recordText('体格检查');
    expect(history).toBe('有乙肝');
    expect(exam).toContain('37.8');
    expect(exam).toContain('128');
    expect(exam).not.toContain('88');
    expect(exam).not.toContain('74');
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    const payload = host.received[0];
    expect(payload.pastMedicalHistory).toBe(history);
    expect(payload.outpatientRecord).toMatchObject({ pastMedicalHistory: '肝炎史：有', physicalExam: '体温：37.8；收缩压：128' });
    expect(payload.fieldValues).toEqual({ 肝炎史标志: '有', 体温: '37.8', 收缩压: '128' });
    expect(payload.dictionarySelections.肝炎史标志).toEqual({ value: '1', text: '有' });
    expect(payload.emrFieldValues).toMatchObject(fieldValues);
    expect(payload.emrFieldValues).not.toHaveProperty('舒张压');
    expect(payload.emrFieldValues).not.toHaveProperty('脉搏');
    expect(payload.emrFieldValues).not.toHaveProperty('结核史标志');
    expect(payload.templateMetadata.fields.map((item: { id: string }) => item.id).sort()).toEqual(Object.keys(fieldValues).sort());
    expect(host.model).not.toHaveBeenCalled();
  });

  it('restores source field values when cached chapter prose consists of a field name or a template sentence', async () => {
    const context = familyTemplateContext();
    await mountResult(context, ref(true), ref(false), [], undefined, '男', [], {
      fieldValues: { 主诉文本: '咽痛两天', 现病史文本: '{现病史文本}', 家族史分类: '1', 家族史说明: '高血压史' },
      cachedChapterTexts: { 'article-chief': '主诉文本', 'article-history': '待核实的旧现病史。', family: '自由书写的既往家族情况。' },
      chapters: [{ chapterId: 'article-chief', title: '主诉', fieldIds: ['主诉文本'] }],
    });
    await vi.waitFor(() => expect(recordText('主诉')).toBe('咽痛两天'));
    expect(recordText('现病史')).toBe('未记录');
    expect(recordText('家族史')).toBe('有家族高血压史。');
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].fieldValues).toEqual({ 主诉文本: '咽痛两天', 家族史分类: '有', 家族史说明: '高血压史' });
    expect(host.received[0].outpatientRecord).not.toHaveProperty('historyOfPresentIllness');
  });

  it('keeps a doctor-entered placeholder out of the document and the confirmed HIS field set', async () => {
    await mountResult(templateContext(), ref(true), ref(false), [], undefined, '女', [], {
      fieldValues: { 主诉文本: '首次记录', 现病史文本: '合成现病史' },
    });
    await vi.waitFor(() => expect(recordText('主诉')).toBe('首次记录'));
    await editField('主诉', '请输入主诉文本');
    expect(recordText('主诉')).toBe('未记录');
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].fieldValues).toEqual({ 现病史文本: '合成现病史' });
    expect(host.received[0].outpatientRecord).not.toHaveProperty('chiefComplaint');
  });

  it.each(['诊断', '补录病历字段'] as const)('only submits the reviewed selection (%s) when source prose has empty structured fields', async selection => {
    const context = templateContext();
    Object.assign(context.template, {
      templateHtml: internalMedicineHtml, templateDefinition: internalMedicineDefinition,
      targetFieldIds: ['持续时间', '时间单位', '体重'],
    });
    const historyText = '发病后间歇头晕，具体时长待核对。';
    const examText = '查体配合，体重尚待测量。';
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [], {
      fieldValues: {},
      diagnoses: selection === '诊断' ? undefined : [],
      cachedChapterTexts: { 现病史: historyText, 体格检查: examText },
      chapters: [
        { chapterId: '现病史', title: '现病史', fieldIds: ['持续时间', '时间单位'] },
        { chapterId: '体格检查', title: '体格检查', fieldIds: ['体重'] },
      ],
    });
    const group = await openSectionEditor('现病史');
    const scopeRow = (label: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))
      .find(row => row.querySelector('.writeback-scope-row-copy > :first-child')?.textContent === label)!;
    const history = scopeRow('现病史');
    const exam = scopeRow('体格检查');
    const diagnosis = scopeRow('诊断');
    await vi.waitFor(() => {
      expect(recordText('现病史')).toBe('未记录');
      expect(recordText('体格检查')).toBe('未记录');
      expect(history.disabled).toBe(true);
      expect(exam.disabled).toBe(true);
      expect(history.getAttribute('aria-checked')).toBe('false');
      expect(diagnosis.disabled).toBe(selection !== '诊断');
    });
    if (diagnosis.getAttribute('aria-checked') === 'true') diagnosis.click();
    await vi.waitFor(() => expect(submit().disabled).toBe(true));
    submit().click();
    expect(host.received).toHaveLength(0);

    if (selection === '诊断') {
      diagnosis.click();
    } else {
      changeSectionText(group, '持续时间', '2');
      await vi.waitFor(() => {
        expect(history.disabled).toBe(false);
        expect(exam.disabled).toBe(true);
        expect(container.textContent).toContain('可回写 1/2 项模板字段');
      });
      if (history.getAttribute('aria-checked') !== 'true') history.click();
    }
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    const payload = host.received[0];
    const withHistory = selection === '补录病历字段';
    expect(payload.fieldValues).toEqual(withHistory ? { 持续时间: '2' } : {});
    expect(payload.templateMetadata.fields.map((item: { id: string }) => item.id)).toEqual(withHistory ? ['持续时间'] : []);
    expect(payload.dictionarySelections).toEqual({});
    expect(payload.writebackScope).toMatchObject({
      recordFields: withHistory ? ['historyOfPresentIllness'] : [], includeDiagnosis: !withHistory, orderTypes: [],
    });
    expect(payload.orderList).toEqual([]);
    if (withHistory) {
      expect(payload.diagList).toBeUndefined();
      expect(payload.emrFieldValues.持续时间).toBe('2');
      expect(payload.emrFieldValues).not.toHaveProperty('时间单位');
      expect(payload.emrFieldValues).not.toHaveProperty('体重');
      expect(payload.outpatientRecord.historyOfPresentIllness).toContain('2');
      expect(payload.outpatientRecord.historyOfPresentIllness).not.toContain(historyText);
    } else {
      expect(payload.diagList).toHaveLength(1);
      expect(payload.outpatientRecord).toBeUndefined();
    }
    expect(host.model).not.toHaveBeenCalled();
  });

  it('writes only the history dictionary default that the doctor explicitly adopts', async () => {
    const context = templateContext();
    Object.assign(context.template, {
      templateHtml: internalMedicineHtml, templateDefinition: internalMedicineDefinition,
      targetFieldIds: ['肝炎史标志', '结核史标志'],
    });
    const ids = context.template.targetFieldIds;
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [], {
      diagnoses: [], fieldValues: { 肝炎史标志: null, 结核史标志: null },
      chapters: [{ chapterId: '既往史', title: '既往史', fieldIds: ids }],
    });
    const group = await openSectionEditor('既往史');
    const defaults = () => [...group.querySelectorAll('button')].filter(button => button.textContent?.trim() === '确认采用此默认项');
    const row = [...container.querySelectorAll<HTMLButtonElement>('.writeback-scope-check-row.is-field')]
      .find(button => button.textContent?.includes('既往史'))!;
    await vi.waitFor(() => {
      expect(defaults()).toHaveLength(2);
      expect(row.disabled).toBe(true);
      expect(submit().disabled).toBe(true);
    });
    for (const id of ids) expect(group.querySelector<HTMLSelectElement>(`select[aria-label="${id}"]`)?.value).toBe('无');
    const hepatitis = group.querySelector('[data-outpatient-emr-field-id="肝炎史标志"]')!;
    (hepatitis.nextElementSibling as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(defaults()).toHaveLength(1);
      expect(defaults()[0].previousElementSibling?.getAttribute('data-outpatient-emr-field-id')).toBe('结核史标志');
      expect(row.disabled).toBe(false);
      expect(container.textContent).toContain('可回写 1/2 项模板字段');
    });
    if (row.getAttribute('aria-checked') !== 'true') row.click();
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    const payload = host.received[0];
    expect(payload.fieldValues).toEqual({ 肝炎史标志: '无' });
    expect(payload.dictionarySelections).toEqual({ 肝炎史标志: { value: '0', text: '无' } });
    expect(payload.emrFieldValues.肝炎史标志).toBe('0');
    expect(payload.emrFieldValues).not.toHaveProperty('结核史标志');
    expect(payload.templateMetadata.fields.map((field: { id: string }) => field.id)).toEqual(['肝炎史标志']);
  });

  it('edits two source chapters independently when both have the same standard category', async () => {
    const context = templateContext();
    const definitions = [
      { ID: 'initial', NAME: '首诊主诉', ARTICLE: '主诉', field: '初诊描述' },
      { ID: 'followup', NAME: '复诊主诉', ARTICLE: '主诉', field: '复诊描述' },
    ];
    context.template.templateHtml = definitions.map(({ ID, NAME, ARTICLE, field }) =>
      `<p data-id="${ID}" data-article="${ARTICLE}" data-name="${NAME}"><span data-id="${field}" data-name="${field}" data-type="text" data-readonly="false"></span></p>`,
    ).join('');
    context.template.templateDefinition = JSON.stringify(definitions.map(({ field, ...section }) => ({
      ...section, eles: [{ ID: field, NAME: field, TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' }],
    })));
    context.template.targetFieldIds = ['复诊描述', '初诊描述'];
    const fieldValues = { 初诊描述: '初诊时咳嗽。', 复诊描述: '复诊时好转。' };
    const chapters = definitions.map(section => ({
      chapterId: section.ID, title: section.NAME, fieldIds: [section.field],
    }));
    host.model.mockResolvedValue(JSON.stringify({ 复诊描述: '复诊时已无咳嗽。' }));
    await mountResult(context, ref(true), ref(false), [], undefined, '女', [], { fieldValues, chapters });
    await vi.waitFor(() => expect(recordLabels()).toEqual(['首诊主诉：', '复诊主诉：']));
    await editField('复诊主诉', '复诊时已无咳嗽。');
    expect(recordText('首诊主诉')).toContain('初诊时咳嗽。');
    container.querySelector<HTMLButtonElement>('.writeback-scope-trigger')!.click();
    await nextTick();
    const choices = [...container.querySelectorAll<HTMLButtonElement>('.writeback-scope-check-row.is-field')];
    const initial = choices.find(button => button.textContent?.includes('首诊主诉'))!;
    const followup = choices.find(button => button.textContent?.includes('复诊主诉'))!;
    expect(initial.getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(followup.getAttribute('aria-checked')).toBe('true'));
    initial.click();
    await vi.waitFor(() => expect(initial.getAttribute('aria-checked')).toBe('false'));
    expect(followup.getAttribute('aria-checked')).toBe('true');
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    const payload = host.received[0];
    expect(payload.fieldValues).toEqual({ 复诊描述: '复诊时已无咳嗽。' });
    expect(payload.emrFieldValues).toHaveProperty('复诊描述', '复诊时已无咳嗽。');
    expect(payload.emrFieldValues).not.toHaveProperty('初诊描述');
    expect(payload.templateMetadata.fields.map((item: { id: string }) => item.id)).toEqual(['复诊描述']);
  });

  it('keeps separate HIS identities for dictionary and text values in the same clinical section', async () => {
    const context = familyTemplateContext();
    context.template.templateHtml = '<header>合成患者 SYN-VOICE-TPL-PATIENT SYN-VOICE-TPL-VISIT</header>'
      + context.template.templateHtml;
    await mountResult(context, ref(true), ref(false), [], undefined, '男', [], {
      record: { familyHistory: '家族情况详见本次问诊。' }, fieldValues: { 家族史分类: '无', 家族史说明: '遗传病史' },
    });
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(recordLine('家族史').textContent).toContain('无家族遗传病史。');
    expect(host.model).not.toHaveBeenCalled();
    const group = await openSectionEditor('家族史');
    const select = group.querySelector<HTMLSelectElement>('select[aria-label="家族史分类"]')!;
    expect(select.selectedOptions[0].textContent).toBe('无');
    select.value = '有';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    changeSectionText(group, '家族史说明', '肿瘤史');
    await nextTick();
    expect(recordLine('家族史').textContent).toContain('有家族肿瘤史。');
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0]).toMatchObject({
      fieldValues: { 家族史分类: '有', 家族史说明: '肿瘤史' },
      dictionarySelections: { 家族史分类: { value: '1', text: '有' } },
      emrFieldValues: { 家族史分类: '1', 家族史说明: '肿瘤史', 家族史文本: '有家族肿瘤史。' },
      familyHistory: '有家族肿瘤史。',
      outpatientRecord: { familyHistory: '家族史分类：有；家族史说明：肿瘤史' },
    });
    expect(host.received[0].emrFieldValues).not.toHaveProperty('家族传染病史标志');
    expect(host.received[0].emrFieldValues).not.toHaveProperty('家族精神病史标志');
  });

  it.each(['移除', '应用'] as const)('keeps the main paragraph in reading mode after the %s action and writes the reviewed phrase', async action => {
    const suggestion = {
      id: 'SYN-AI', field: 'historyOfPresentIllness', question: '核对伴随症状',
      negativeRecordText: '否认晕厥', rationale: '合成核对项', priority: 'critical', status: 'pending',
    } as const;
    await mountResult(templateContext(), ref(true), ref(false), [], undefined, '男', [suggestion]);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    const history = recordLine('现病史');
    const annotation = history.querySelector<HTMLButtonElement>('[data-clinical-fact-id="SYN-AI"]')!;
    expect(annotation.classList.contains('is-critical')).toBe(true);
    annotation.click();
    await nextTick();
    const expected = action === '移除' ? '受凉后咳嗽3天，无发热。' : '受凉后咳嗽3天，无发热。否认腹痛。';
    if (action === '应用') {
      clickButton(history, '调整');
      await nextTick();
      const draft = history.querySelector<HTMLTextAreaElement>('[aria-label="调整 AI 病历表述"]')!;
      draft.value = '否认腹痛';
      draft.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
    }
    clickButton(recordLine('现病史'), action);
    await vi.waitFor(() => {
      const current = recordLine('现病史');
      expect(current).toBe(history);
      expect(current.querySelector('[contenteditable]')).toBeNull();
      expect(current.querySelector('[data-clinical-fact-id="SYN-AI"]')).toBeNull();
      expect(recordText('现病史')).toBe(expected);
    });
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].outpatientRecord.historyOfPresentIllness).toBe(expected);
    expect(host.received[0].fieldValues.现病史文本).toEqual(expected);
  });

  it('keeps a doctor-cleared mapped text field selectable and respects an explicit deselection', async () => {
    await mountResult(templateContext());
    await vi.waitFor(() => expect(field('主诉文本')?.textContent).toContain('咳嗽3天'));
    for (const id of ['主诉文本', '现病史文本']) {
      await editField(id, '');
      expect(field(id).textContent).toContain('未记录');
    }
    container.querySelector<HTMLButtonElement>('.writeback-scope-trigger')!.click();
    await nextTick();
    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>('.writeback-scope-check-row.is-field'));
    const chiefComplaint = rows.find(row => row.textContent?.includes('主诉'))!;
    const history = rows.find(row => row.textContent?.includes('现病史'))!;
    await vi.waitFor(() => {
      expect(chiefComplaint.disabled).toBe(false);
      expect(history.disabled).toBe(false);
    });
    history.click();
    await nextTick();
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].fieldValues).toEqual({ 主诉文本: '' });
    expect(host.received[0].outpatientRecord).toEqual({ schemaVersion: 'outpatient-record.v1', chiefComplaint: '' });
  });

  it('sends only selected record fields during a background diagnosis refresh', async () => {
    let finishDiagnosis!: (value: string) => void;
    host.diagnosis.mockReturnValue(new Promise<string>(resolve => { finishDiagnosis = resolve; }));
    await mountResult(templateContext());
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    container.querySelector<HTMLButtonElement>('[title="基于当前病历重新生成诊断建议"]')!.click();
    await vi.waitFor(() => expect(host.diagnosis).toHaveBeenCalledOnce());
    expect(submit().disabled).toBe(true);
    container.querySelector<HTMLButtonElement>('.writeback-scope-trigger')!.click();
    await nextTick();
    const diagnosis = Array.from(container.querySelectorAll<HTMLButtonElement>('.writeback-scope-check-row'))
      .find(row => row.querySelector('strong')?.textContent === '诊断')!;
    diagnosis.click();
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0].diagList).toBeUndefined();
    expect(host.received[0].fieldValues).toEqual({ 主诉文本: '咳嗽3天', 现病史文本: '受凉后咳嗽3天，无发热。' });
    finishDiagnosis('[]');
    await settle();
    expect(host.received).toHaveLength(1);
    expect(field('主诉文本').textContent).toContain('咳嗽3天');
  });

  it('refreshes diagnosis with the chief complaint and present illness the doctor just edited', async () => {
    await mountResult(templateContext());
    await vi.waitFor(() => expect(field('主诉文本')?.textContent).toContain('咳嗽3天'));
    await editField('主诉文本', '合成新主诉：咽痛四天');
    await editField('现病史文本', '合成新现病史：今晨出现声音嘶哑');
    const refresh = container.querySelector<HTMLButtonElement>('[title="基于当前病历重新生成诊断建议"]')!;
    await vi.waitFor(() => expect(refresh.disabled).toBe(false));
    refresh.click();
    await vi.waitFor(() => expect(host.diagnosis).toHaveBeenCalledTimes(1));
    const [messages] = host.diagnosis.mock.calls[0];
    const input = messages[messages.length - 1].content;
    expect(input).toContain('合成新主诉：咽痛四天');
    expect(input).toContain('合成新现病史：今晨出现声音嘶哑');
    expect(input).not.toContain('受凉后咳嗽3天，无发热');
  });

  it('sends the selected diagnosis when the restored editor has no narrative', async () => {
    await mountResult(templateContext(), ref(true), ref(false), [], {
      chiefComplaint: '', historyOfPresentIllness: '', pastMedicalHistory: '', personalHistory: '',
      menstrualHistory: '', maritalReproductiveHistory: '', familyHistory: '', physicalExam: '', precautions: '',
    }, '男', [], { legacyCache: true });
    await vi.waitFor(() => {
      const calls = host.model.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const input = JSON.parse(calls[calls.length - 1][0][1].content.split('\n')[1]);
      expect(input.recordContext.recordText).toBeUndefined();
      expect(input.recordContext.structuredFacts.diagnoses).toMatchObject([{ code: 'J06.900' }]);
    });
    expect(host.received).toEqual([]);
  });

  it('delivers selected prescription details to the model before writeback', async () => {
    await mountResult(templateContext(), ref(true), ref(false), [
      { type: 'medicine', name: '合成片', selected: true, sourceType: 'explicit', dosage: '1',
        dosageUnit: '片', days: '7', frequency: '每日两次', frequencyKey: 'BID', usage: '餐后', route: '口服',
        totalQty: '14', totalUnit: '片', totalManualEdited: true, spec: '5mg/片', remark: '合成医嘱备注',
        matchedItem: { id: 'SYN-PRIVATE-CATALOG-ID', name: '合成片', storeIds: ['SYN-STORE'] }, matchStatus: 'exact' },
      { type: 'procedure', name: '未选的合成治疗', selected: false },
    ], undefined, '男', [], { legacyCache: true });
    await vi.waitFor(() => {
      const last = host.model.mock.calls[host.model.mock.calls.length - 1];
      const clinicalInput = JSON.parse(last![0][1].content.split('\n')[1]);
      expect(clinicalInput.recordContext.structuredFacts.orders).toMatchObject([{
        name: '合成片', dosage: '1', dosageUnit: '片', days: '7', frequency: '每日两次', route: '口服',
        totalQty: '14', totalUnit: '片', spec: '5mg/片', remark: '合成医嘱备注',
      }]);
      expect(last![0][1].content).not.toContain('SYN-PRIVATE-CATALOG-ID');
      expect(last![0][1].content).not.toContain('未选的合成治疗');
    });
    expect(host.received).toHaveLength(0);
  });

  it('sends doctor edits including unmapped fields with a supplement while an unrelated dictionary is optional', async () => {
    const context = templateContext();
    context.template.targetFieldIds.push('复查部位', '确认标志');
    context.template.templateHtml += '<section data-id="extra" data-article="自定义段" data-name="自定义段">'
      + '<span data-id="复查部位" data-name="复查部位" data-type="text" data-readonly="false"></span>'
      + '<span data-id="确认标志" data-name="确认标志" data-type="select" data-readonly="false"></span></section>';
    const chapters = JSON.parse(context.template.templateDefinition);
    chapters.push({ ID: 'extra', NAME: '自定义段', ARTICLE: '自定义段', eles: [
      { ID: '复查部位', NAME: '复查部位', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
      { ID: '确认标志', NAME: '确认标志', TYPE: 'select', READONLY: false, VALUE: '', TEXT: '',
        BINDINGDATA: [{ VALUE: '1', TEXT: '是' }, { VALUE: '0', TEXT: '否' }] },
    ] });
    context.template.templateDefinition = JSON.stringify(chapters);
    host.model.mockResolvedValue(JSON.stringify({ 主诉文本: '咳嗽3天', 现病史文本: '无发热', 复查部位: '', 确认标志: '' }));
    host.regenerate.mockRejectedValue(new Error('合成请求已捕获'));
    await mountResult(context);
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    expect(recordLine('自定义段')).toBeTruthy();
    await editField('主诉文本', '医生修订为咳嗽四天');
    const group = await openSectionEditor('自定义段');
    changeSectionText(group, '复查部位', '医生核对为左上肢');
    await nextTick();
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    container.querySelector<HTMLButtonElement>('[aria-label="补充说明并重新生成病历"]')!.click();
    await settle();
    const supplement = document.querySelector<HTMLTextAreaElement>('.supplement-textarea')!;
    supplement.value = '合成医生补充';
    supplement.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('.supplement-dialog .primary-button')!.click();
    await vi.waitFor(() => expect(host.regenerate).toHaveBeenCalledTimes(1));
    const request = JSON.parse(host.regenerate.mock.calls[0][0][1].content.split('输入数据如下：\n\n')[1]);
    expect(request.doctorSupplement).toBe('合成医生补充');
    expect(recordLine('自定义段')).toBeTruthy();
    expect(request.templateFields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '主诉文本', source: 'doctor', value: '医生修订为咳嗽四天' }),
      expect.objectContaining({ id: '复查部位', recordField: null, source: 'doctor', value: '医生核对为左上肢' }),
    ]));
    expect(host.received).toHaveLength(0);
  });

  it.each(['parse', 'model'] as const)('retains the clinical document and applies the paired-field writeback gate on %s failure', async (failure) => {
    const context = templateContext();
    if (failure === 'parse') context.template.templateDefinition = '[';
    else host.model.mockRejectedValue(new Error('合成模板模型失败'));
    const closed = await mountResult(context, ref(true), ref(false), [], undefined, '男', [], { legacyCache: true });
    await vi.waitFor(() => expect(container.querySelector('.vcn-left-panel [role="alert"]')).not.toBeNull());
    if (failure === 'parse') expect(recordLabels()).toEqual([]);
    else expect(recordLabels()).toEqual(['主诉：', '现病史：']);
    expect(container.querySelector('.template-document')).toBeNull();
    expect(submit().disabled).toBe(failure === 'parse');
    submit().click();
    await settle();
    expect(closed).not.toHaveBeenCalled();
    if (failure === 'parse') {
      expect(host.model).not.toHaveBeenCalled();
      expect(host.received).toEqual([]);
    } else {
      await vi.waitFor(() => expect(host.received).toHaveLength(1));
      expect(host.received[0]).toMatchObject({
        fieldValues: { 主诉文本: '咳嗽3天', 现病史文本: '受凉后咳嗽3天，无发热。' },
        diagList: [expect.objectContaining({ naDiag: '急性上呼吸道感染' })],
      });
    }
  });

  it.each(['success', 'custom-only', 'diagnosis-failure'] as const)('regenerates the custom chapter and its compound HIS fields in the same supplement response (%s)', async mode => {
    const context = familyTemplateContext();
    context.template.templateHtml = context.template.templateHtml.replace(
      'data-id="family" data-article="家族史" data-name="家族史"', 'data-id="family" data-article="家族史" data-name="随访补记"',
    );
    const definitions = JSON.parse(context.template.templateDefinition);
    definitions.find((section: { ID: string }) => section.ID === 'family').NAME = '随访补记';
    const customOnly = mode === 'custom-only';
    if (customOnly) {
      context.template.templateHtml = context.template.templateHtml.slice(context.template.templateHtml.indexOf('<section data-id="family"'));
      context.template.targetFieldIds = ['家族史分类', '家族史说明'];
    }
    context.template.templateDefinition = JSON.stringify(customOnly ? definitions.filter((chapter: { ID: string }) => chapter.ID === 'family') : definitions);
    const text = '母亲有高血压史。';
    if (mode !== 'diagnosis-failure') {
      host.diagnosis.mockResolvedValue(JSON.stringify([{ id: 'SYN-DX', code: 'J06.900', name: '急性上呼吸道感染', rate: '95%' }]));
    }
    host.regenerate.mockResolvedValue(JSON.stringify({ ...(customOnly ? { chiefComplaint: '', historyOfPresentIllness: '' } : {}), chapterTexts: { family: text }, templateFieldValues: {
      ...(customOnly ? {} : { 主诉文本: '合成补录后新主诉' }), 家族史分类: null, 家族史说明: '高血压史',
    } }));
    await mountResult(context, ref(true), ref(false), [], undefined, '男', [], {
      ...(customOnly ? { record: { chiefComplaint: '', historyOfPresentIllness: '' } } : {}),
      fieldValues: { ...(customOnly ? {} : { 主诉文本: '咳嗽3天', 现病史文本: '受凉后咳嗽3天' }), 家族史分类: '有', 家族史说明: '肿瘤史' },
      chapters: [
        ...(customOnly ? [] : [
          { chapterId: 'article-chief', title: '主诉', fieldIds: ['主诉文本'] },
          { chapterId: 'article-history', title: '现病史', fieldIds: ['现病史文本'] },
        ]),
        { chapterId: 'family', title: '随访补记', fieldIds: ['家族史分类', '家族史说明'] },
      ],
    });
    await vi.waitFor(() => expect(recordText('随访补记')).toBe('有家族肿瘤史。'));
    container.querySelector<HTMLButtonElement>('[aria-label="补充说明并重新生成病历"]')!.click();
    await settle();
    const supplement = document.querySelector<HTMLTextAreaElement>('.supplement-textarea')!;
    supplement.value = '医生核对母亲有高血压史';
    supplement.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.querySelector<HTMLButtonElement>('.supplement-dialog .primary-button')!.click();
    const expectedText = mode === 'diagnosis-failure' ? '有家族肿瘤史。' : '有家族高血压史。';
    await vi.waitFor(() => expect(host.regenerate).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(recordLine('随访补记')?.textContent).toContain(expectedText));
    if (customOnly) expect(host.diagnosis).not.toHaveBeenCalled();
    else {
      await vi.waitFor(() => expect(host.diagnosis).toHaveBeenCalledOnce());
      expect(JSON.stringify(host.diagnosis.mock.calls[0][0])).toContain('合成补录后新主诉');
      expect(recordText('主诉')).toBe(mode === 'diagnosis-failure' ? '咳嗽3天' : '合成补录后新主诉');
    }
    expect(host.model).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(submit().disabled).toBe(false));
    submit().click();
    await vi.waitFor(() => expect(host.received).toHaveLength(1));
    expect(host.received[0]).toMatchObject({
      fieldValues: { 家族史分类: '有', 家族史说明: mode === 'diagnosis-failure' ? '肿瘤史' : '高血压史' },
      familyHistory: expectedText,
      outpatientRecord: { familyHistory: '家族史分类：有；家族史说明：' + (mode === 'diagnosis-failure' ? '肿瘤史' : '高血压史') },
    });
  });
});
