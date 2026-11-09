// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { buildPatientContext } from '@/utils/patientContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VoiceConsultationNew from './VoiceConsultationNew.vue';
import { buildOutpatientRecord } from '@features/clinical-result/outpatientRecord';
import {
  DEFAULT_PERSONAL_HISTORY_TEMPLATE,
  stripHistoryRecordTemplateMarkers,
} from '@features/clinical-result/historyRecordTemplates';
import type { ClinicalResultInput } from '@features/clinical-result/clinicalResultContract';

const host = vi.hoisted(() => ({
  received: [] as Array<Record<string, any>>,
  listeners: new Map<string, Set<(event: any) => void>>(),
}));

// Only native I/O and external services are replaced. The page, editors,
// selection/preflight, history projection and final payload builder are real.
vi.mock('@tauri-apps/api/core', async original => ({
  ...await original<any>(),
  invoke: async (command: string, args: any) => {
    if (command === 'complete_consultation') {
      host.received.push(JSON.parse(JSON.stringify(args.result)));
    }
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
  chat: async () => { throw new Error('F01 synthetic test: model offline'); },
  chatFast: async () => { throw new Error('F01 synthetic test: model offline'); },
}));
vi.mock('@tauri-apps/plugin-http', async original => ({
  ...await original<any>(),
  fetch: async () => { throw new Error('F01 synthetic test: HTTP offline'); },
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
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('F01 synthetic test: browser HTTP offline'); });
  // jsdom does not implement layout-dependent innerText; production uses it to
  // read the real contenteditable. No clinical state or event handler is patched.
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

function personalLine(): HTMLElement {
  const line = container.querySelector<HTMLElement>('.clinical-record-line[aria-label^="个人史，"]');
  expect(line, 'production personal-history document line').not.toBeNull();
  return line!;
}

function displayedHistory(): string {
  const copy = personalLine().cloneNode(true) as HTMLElement;
  copy.querySelectorAll('label, .clinical-record-annotation-sign, .clinical-record-placeholder').forEach(node => node.remove());
  // Trim only the annotation button shell. Plain-text spaces, including the
  // doctor's slash-separated values, must remain intact in the comparison.
  copy.querySelectorAll('.clinical-record-annotation').forEach(button => {
    button.textContent = button.textContent?.trim() || '';
  });
  return stripHistoryRecordTemplateMarkers(copy.textContent?.trim() || '');
}

async function editHistory(text: string): Promise<void> {
  personalLine().click();
  await settle();
  const editor = container.querySelector<HTMLElement>('[role="textbox"][aria-label="个人史"]');
  expect(editor).not.toBeNull();
  editor!.textContent = text;
  editor!.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  editor!.blur();
  await settle();
  expect(container.querySelector('[role="textbox"][aria-label="个人史"]')).toBeNull();
}

interface HistoryCase {
  name: string;
  generated?: string;
  edited?: string;
  flags: [string | undefined, string | undefined];
  omit?: boolean;
}

const negative = '不吸烟，不饮酒；口味偏咸，运动较少';
const corrected = '不吸烟，不饮酒。平时口味偏咸，运动较少。';
const positive = '吸烟20年，每日10支；饮酒10年，每周2次。平时口味偏咸，运动较少。';
const cases: HistoryCase[] = [
  { name: 'original double negation and doctor detail edit', generated: negative, edited: corrected, flags: ['0', '0'] },
  { name: 'doctor changes model positive to negative', generated: positive, edited: corrected, flags: ['0', '0'] },
  { name: 'doctor changes model negative to positive', generated: negative, edited: positive, flags: ['1', '1'] },
  { name: 'negative smoking and positive drinking', generated: '不吸烟，饮酒10年。口味偏咸。', flags: ['0', '1'] },
  { name: 'positive smoking and negative drinking', generated: '吸烟20年，不饮酒。运动较少。', flags: ['1', '0'] },
  { name: 'real positive control retains dose and lifestyle detail', generated: positive, flags: ['1', '1'] },
  { name: 'shared negation of coordinated habits', generated: '否认吸烟、饮酒史；口味偏咸，运动较少。', flags: ['0', '0'] },
  { name: 'unknown habits do not become patient facts', generated: '吸烟史不详，饮酒史未询问。平时口味偏咸。', flags: [undefined, undefined] },
  { name: 'unmentioned habits do not become patient facts', generated: '平时口味偏咸，运动较少。', flags: [undefined, undefined] },
  { name: 'doctor clears field without restoring template', generated: positive, edited: '', flags: [undefined, undefined] },
  { name: 'untouched fixed template keeps customer defaults', flags: ['0', '0'] },
  { name: 'doctor reverses a positive fixed slot',
    generated: DEFAULT_PERSONAL_HISTORY_TEMPLATE.replace('{否认}吸烟史', '{有}吸烟史'),
    edited: stripHistoryRecordTemplateMarkers(DEFAULT_PERSONAL_HISTORY_TEMPLATE), flags: ['0', '0'] },
  { name: 'unselected history omits both text and flags', generated: positive, omit: true, flags: [undefined, undefined] },
  { name: 'R2 N02 patient denial with father smoking', generated: negative, edited: '本人从不吸烟，父亲吸烟。', flags: ['0', undefined] },
  { name: 'R2 N03 passive smoking exposure only', generated: negative, edited: '长期被动吸烟。', flags: [undefined, undefined] },
  { name: 'R2 N04 slash-separated named slots', generated: negative, edited: '吸烟史：无 / 饮酒史：不详', flags: ['0', undefined] },
  { name: 'R2 N06 father smoking only', generated: negative, edited: '父亲吸烟。', flags: [undefined, undefined] },
  { name: 'R2 father first then explicit patient denial', generated: negative, edited: '父亲吸烟，本人从不吸烟。', flags: ['0', undefined] },
  { name: 'R2 patient positive with father denial', generated: negative, edited: '本人每日吸烟5支，父亲从不吸烟。', flags: ['1', undefined] },
  { name: 'R2 drinking actor swap preserves patient denial', generated: negative, edited: '父亲饮酒，本人从不饮酒。', flags: [undefined, '0'] },
  { name: 'R2 drinking patient positive with father denial', generated: negative, edited: '本人偶尔饮酒，父亲不饮酒。', flags: [undefined, '1'] },
  { name: 'R2 adjacent father then patient statements', generated: negative, edited: '父亲吸烟而本人不吸烟，患者偶尔饮酒。', flags: ['0', '1'] },
  { name: 'R2 adjacent patient then father statements', generated: negative, edited: '本人不吸烟而父亲吸烟，患者每周饮酒一次。', flags: ['0', '1'] },
  { name: 'R2 passive exposure with explicit active smoking', generated: negative, edited: '长期被动吸烟，本人仍每日吸烟5支。', flags: ['1', undefined] },
  { name: 'R2 explicit denial with passive exposure', generated: negative, edited: '本人从不吸烟，长期被动吸烟。', flags: ['0', undefined] },
  { name: 'R2 fullwidth slash and reversed slot order', generated: negative, edited: '饮酒史：无 ／ 吸烟史：有', flags: ['1', '0'] },
  { name: 'R2 reporter explicitly describes the patient', generated: negative, edited: '父亲说患者不吸烟，家属诉本人偶尔饮酒。', flags: ['0', '1'] },
  { name: 'R2 uncertainty is not an active drinking fact', generated: negative, edited: '本人是否吸烟不详，可能饮酒。', flags: [undefined, undefined] },
];

describe('ordinary voice personal-history display, doctor edit and Fake HIS writeback', () => {
  it.each(cases)('$name', async testCase => {
    // Same production draft builder used by ordinary voice extraction. Model
    // content is synthetic; the generated → page → submit transformations run.
    const generatedRecord = buildOutpatientRecord({
      chiefComplaint: '头晕2周',
      historyOfPresentIllness: '间断头晕2周，无胸痛。',
      personalHistory: testCase.generated,
      pastMedicalHistory: '既往高血压病史5年。',
      familyHistory: '否认家族重大遗传病史。',
    });
    const intent: ClinicalResultInput = {
      ...generatedRecord, allergyHistory: '', currentMedicationHistory: '',
      symptoms: ['头晕'], negativeSymptoms: ['胸痛'],
      diagnoses: [{ name: '高血压', code: 'I10', matchedItem: { id: 'F01-DX-I10', name: '高血压', code: 'I10' } }],
      treatments: [], treatmentPlan: '', healthEducation: '', outpatientRecord: generatedRecord,
      recommendationPolicy: { autoFetchTreatments: false, allowTreatmentRefresh: false },
      generation: { status: 'complete', readySections: ['record_core', 'history_context', 'diagnoses', 'record_suggestions', 'record_extra'] },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    const closed = vi.fn();
    const patient = buildPatientContext({ payload: {
      patientId: 'F01-SYNTHETIC-P', visitId: 'F01-SYNTHETIC-V', patientName: '合成患者', gender: '男', ageText: '55岁',
    } })!;
    const wrapper = defineComponent({ setup: () => () => h(VoiceConsultationNew, {
      initialPatientData: patient, intentResult: intent, intentSource: 'llm',
      channel: 'voice', consultationRoundId: `F01-${testCase.name}`, onClose: closed,
    }) });
    app = createApp(wrapper);
    app.use(createPinia());
    app.provide('showToast', vi.fn());
    app.mount(container);
    await settle();
    const initialDisplay = displayedHistory();
    if (testCase.edited !== undefined) await editHistory(testCase.edited);
    const afterBlur = displayedHistory();
    if (testCase.omit) {
      container.querySelector<HTMLButtonElement>('.writeback-scope-trigger')!.click();
      await settle();
      const choice = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]'))
        .find(button => button.textContent?.trim() === '个人史');
      expect(choice?.getAttribute('aria-checked')).toBe('true');
      choice!.click();
      await settle();
    }
    const submit = container.querySelector<HTMLButtonElement>('.footer-submit-btn')!;
    expect(submit.disabled, 'normal writeback gates ready').toBe(false);
    submit.click();
    await settle();
    expect(host.received).toHaveLength(1);
    const payload = host.received[0];
    const finalEmr = JSON.parse(JSON.stringify({
      outpatientRecord: payload.outpatientRecord,
      fields: payload.emrFieldValues,
    }));
    // Host acknowledges only after consuming the exact outbound packet.
    for (const callback of host.listeners.get('consultation-reference-feedback') || []) {
      callback({ payload: { requestId: payload.requestId, consultationId: payload.consultationId,
        referenceType: 'batch', action: 'batch', status: 'success', message: 'F01 合成 HIS 已保存' } });
    }
    await settle();
    console.info('F01_UI_TRACE', JSON.stringify({
      case: testCase.name, generatedRaw: testCase.generated ?? null,
      generatedDraft: generatedRecord.personalHistory, initialDisplay,
      doctorEdited: testCase.edited ?? null, afterBlur,
      recordConfirmed: payload, fakeHisFinalEmr: finalEmr, closeCount: closed.mock.calls.length,
      realModelCalls: 0, realHisCalls: 0,
    }));

    const expectedGenerated = stripHistoryRecordTemplateMarkers(testCase.generated ?? DEFAULT_PERSONAL_HISTORY_TEMPLATE);
    const expectedFinal = stripHistoryRecordTemplateMarkers(testCase.edited ?? expectedGenerated);
    expect.soft(initialDisplay).toBe(expectedGenerated);
    expect.soft(afterBlur).toBe(expectedFinal);
    if (testCase.omit || expectedFinal === '') {
      expect.soft(payload.outpatientRecord).not.toHaveProperty('personalHistory');
      expect.soft(payload.emrFieldValues).not.toHaveProperty('个人史文本');
    } else {
      expect.soft(payload.outpatientRecord.personalHistory).toBe(expectedFinal);
      expect.soft(finalEmr.fields['个人史文本']).toBe(expectedFinal);
    }
    expect.soft(finalEmr.fields['吸烟史标志']).toBe(testCase.flags[0]);
    expect.soft(finalEmr.fields['饮酒史标志']).toBe(testCase.flags[1]);
    const habitChanges = payload.recordTemplateChanges?.items.filter((item: any) =>
      item.slotKey === 'smokingHistory' || item.slotKey === 'drinkingHistory') || [];
    if (testCase.flags.every(value => value !== '1')) expect.soft(habitChanges).toEqual([]);
    expect.soft(closed).toHaveBeenCalledTimes(1);
    expect.soft(payload.resultType).toBe('record-confirmed');
    expect.soft(payload.orderList).toEqual([]);
  });
});
