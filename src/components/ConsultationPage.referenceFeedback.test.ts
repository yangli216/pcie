// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ConsultationPage from './ConsultationPage.vue';

const bridge = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: any }>,
  listeners: new Map<string, Set<(event: any) => void>>(),
}));
vi.mock('@tauri-apps/api/core', async original => ({
  ...await original<any>(),
  invoke: async (command: string, args: any) => { bridge.calls.push({ command, args }); },
}));
vi.mock('@tauri-apps/api/event', async original => ({
  ...await original<any>(),
  listen: async (name: string, callback: (event: any) => void) => {
    const callbacks = bridge.listeners.get(name) || new Set();
    bridge.listeners.set(name, callbacks);
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  },
  emit: async () => {}, emitTo: async () => {},
}));
vi.mock('@/services/templateService', async original => ({ ...await original<any>(), syncRemoteTemplates: async () => {} }));
vi.mock('@/services/llm', async original => ({
  ...await original<any>(),
  chat: async () => { throw new Error('Synthetic recommendations supplied; AI is offline'); },
  chatFast: async () => { throw new Error('Synthetic recommendations supplied; AI is offline'); },
}));
vi.mock('@tauri-apps/plugin-http', async original => ({
  ...await original<any>(), fetch: async () => { throw new Error('Synthetic test: HTTP is offline'); },
}));
vi.mock('@tauri-apps/plugin-store', async original => {
  const store = { get: async () => null, set: async () => {}, save: async () => {}, delete: async () => true, keys: async () => [] };
  return { ...await original<any>(), load: async () => store,
    Store: class { static load = async () => store; static get = async () => null; },
    LazyStore: class { get = store.get; set = store.set; save = store.save; delete = store.delete; } };
});

let app: App | undefined;
let container: HTMLDivElement;
let observe: (() => unknown) | undefined;
async function settle() { await nextTick(); await new Promise(resolve => setTimeout(resolve, 6)); await nextTick(); }
const packets = () => bridge.calls.filter(call => call.command === 'complete_consultation').map(call => call.args.result);
const copy = (value: unknown) => JSON.parse(JSON.stringify(value));

beforeEach(() => {
  bridge.calls.length = 0;
  bridge.listeners.clear();
  localStorage.clear(); sessionStorage.clear();
  vi.stubGlobal('fetch', async () => { throw new Error('Synthetic test: browser fetch is offline'); });
  if (!HTMLElement.prototype.scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value() {} });
});
afterEach(async () => {
  app?.unmount(); app = undefined; container?.remove();
  observe = undefined; await settle(); vi.unstubAllGlobals();
});

async function mountPage(view: 'record' | 'final_report' | 'consultation') {
  container = document.createElement('div'); document.body.appendChild(container);
  const toast = vi.fn(), close = vi.fn();
  // A host patient anchor without visitId is a supported path, not a fabricated fallback ID.
  const patient = { id: 'QA-R3-P', idPi: 'QA-R3-P', patientId: 'QA-R3-P', visitId: '', idTet: '', naPi: '合成就诊' };
  const wrapper = defineComponent({ setup: () => () => h(ConsultationPage as any, { initialPatientData: patient, active: true, onClose: close }) });
  app = createApp(wrapper); app.use(createPinia()); app.provide('showToast', toast); app.mount(container);
  await settle();
  // Seed completed synthetic recommendations only. The templates, submit/preflight and listeners run unchanged.
  const state = (app as any)._instance.subTree.component.setupState;
  const diagnosis = { id: 'QA-R3-DX', name: '合成诊断', code: 'QA-R3', rate: '高' };
  state.generatedRecord = { chiefComplaint: '合成主诉', historyOfPresentIllness: '合成现病史', familyHistory: '' };
  state.aiDiagnoses = [diagnosis]; state.selectedDiagnosis = diagnosis;
  state.examRecommendations = ['exam'].map(type => {
    const raw = { idCli: 'QA-R3-XR', naCli: '合成胸片', idDeptExec: 'QA-R3-RAD', fgCheckOrd: '1', sdSrv: '31',
      idPart: 'QA-R3-CHEST', jsonField: '{}', mutualRecognitionCode: 'QA-R3-LEGACY-CODE', __detailLoaded: true };
    return { type, name: raw.naCli, reason: '合成回归', sourceType: 'explicit', selected: true, rejected: false,
      execDept: raw.idDeptExec, bodySiteId: raw.idPart, totalQty: '1',
      matchedItem: { id: raw.idCli, name: raw.naCli, naSrv: raw.naCli, ...raw, raw } };
  });
  state.currentView = view; await settle(); toast.mockClear();
  observe = () => ({ view: state.currentView, busy: state.finalWriteback.busy.value,
    pendingRequestId: state.finalWriteback.pendingRequestId.value, recent: state.lastReferenceFeedback,
    statuses: state.referenceStatusMap, notices: toast.mock.calls, closes: close.mock.calls.length,
    outbound: packets().map(wire => ({ requestId: wire.requestId, consultationId: wire.consultationId,
      resultType: wire.resultType, referenceType: wire.referenceType, orderList: wire.orderList })) });
  return { state, toast, close, patient,
    button: () => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button =>
      view === 'final_report' ? button.textContent?.trim() === '完成问诊' : button.classList.contains('footer-submit-btn'))!,
  };
}

async function feedback(wire: any, status: string, extra: Record<string, unknown> = {}) {
  const callbacks = bridge.listeners.get('consultation-reference-feedback');
  expect(callbacks?.size).toBeGreaterThan(0);
  const payload = { requestId: wire.requestId, consultationId: wire.consultationId, referenceType: 'batch', action: 'batch', status, ...extra };
  for (const callback of callbacks!) callback({ payload });
  await settle();
  console.info('F1_FEEDBACK_TRACE', JSON.stringify({ payload, after: observe?.() }));
}
const pendingItems = { recognizableItems: [{ idSrv: 'QA-R3-XR', naSrv: '合成胸片', mutualRecognitionCode: 'QA-R3-LEGACY-CODE' }] };

it('does not replay the editor failure after the visible Return button with an empty visitId', async () => {
  const page = await mountPage('record');
  page.button().click(); await settle();
  expect(packets()).toHaveLength(1);
  const wire = packets()[0]; expect(wire.consultationId).toBe(page.patient.patientId);
  expect(wire.orderList[0].mutualRecognitionCode).toBe('');
  await feedback(wire, 'pending', pendingItems);
  await feedback(wire, 'failed', { message: '本次宿主真实失败' });
  expect(page.toast.mock.calls.filter(call => call[0] === '本次宿主真实失败')).toHaveLength(1);
  const back = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent?.trim() === '返回')!;
  expect(back.disabled).toBe(false); back.click(); await settle();
  expect(page.state.currentView).toBe('consultation');
  expect(container.querySelector('.medical-record-page')).toBeNull();
  const recent = copy(page.state.lastReferenceFeedback), statuses = copy(page.state.referenceStatusMap);
  await feedback(wire, 'failed', { message: '本次宿主真实失败' });
  expect(page.toast.mock.calls.filter(call => call[0] === '本次宿主真实失败')).toHaveLength(1);
  expect(page.state.lastReferenceFeedback).toEqual(recent);
  expect(page.state.referenceStatusMap).toEqual(statuses);
  expect(packets()).toHaveLength(1);
});

it('keeps B pending and its recent feedback when old, mismatched or other-consultation final messages arrive', async () => {
  const page = await mountPage('final_report');
  page.button().click(); await settle(); const first = packets()[0];
  await feedback(first, 'failed', { message: 'A 失败' });
  page.button().click(); await settle(); const current = packets()[1];
  expect(current.requestId).not.toBe(first.requestId);
  await feedback(current, 'pending', { ...pendingItems, message: '正在处理 B' });
  const recent = copy(page.state.lastReferenceFeedback), statuses = copy(page.state.referenceStatusMap);
  page.toast.mockClear();
  await feedback(first, 'pending', { message: '旧 A 等待' });
  await feedback(first, 'success', { message: '旧 A 成功' });
  await feedback({ ...current, requestId: 'record-confirmed-9999999999999' }, 'success', { message: '错配 ID' });
  await feedback({ ...current, consultationId: 'QA-R3-OTHER' }, 'failed', { message: '其他就诊' });
  expect(page.toast.mock.calls).toEqual([]);
  expect(page.state.lastReferenceFeedback).toEqual(recent);
  expect(page.state.referenceStatusMap).toEqual(statuses);
  expect(page.state.finalWriteback.busy.value).toBe(true);
  expect(page.state.finalWriteback.pendingRequestId.value).toBe(current.requestId);
  expect(page.close).not.toHaveBeenCalled(); expect(packets()).toHaveLength(2);
  await feedback(current, 'failed', { message: 'B 真实失败' });
  expect(page.toast.mock.calls).toContainEqual(['B 真实失败', 'error']);
  expect(page.state.finalWriteback.busy.value).toBe(false);
});

for (const status of ['success', 'failed', 'cancelled'] as const) {
  it(`handles a matching ${status} only once after pending, preserving the real submit guard`, async () => {
    const page = await mountPage('final_report');
    page.button().click(); await settle(); const wire = packets()[0];
    await feedback(wire, 'pending', { ...pendingItems, message: '宿主仍在处理' });
    expect(page.toast.mock.calls).toContainEqual(['宿主仍在处理', 'info']);
    expect(page.button().disabled).toBe(true);
    await page.state.submitToHIS(); await settle();
    expect(packets()).toHaveLength(1);
    expect(page.state.finalWriteback.pendingRequestId.value).toBe(wire.requestId);
    page.toast.mockClear();
    await feedback(wire, status, { message: `匹配终态 ${status}` });
    await feedback(wire, status, { message: `匹配终态 ${status}` });
    expect(page.toast.mock.calls.filter(call => call[0] === `匹配终态 ${status}`)).toEqual([
      [`匹配终态 ${status}`, status === 'success' ? 'success' : status === 'failed' ? 'error' : 'info'],
    ]);
    expect(page.close).toHaveBeenCalledTimes(status === 'success' ? 1 : 0);
    expect(page.state.finalWriteback.busy.value).toBe(false);
    expect(page.state.finalWriteback.pendingRequestId.value).toBe('');
    expect(packets()).toHaveLength(1);
  });
}

it('keeps ordinary single and historical batch reference notices, recent status and host failures', async () => {
  const page = await mountPage('consultation');
  for (const [action, status] of [['medication', 'success'], ['batch', 'failed'], ['batch', 'pending'], ['lab_test', 'cancelled']] as const) {
    const message = `普通 ${action} ${status}`, requestId = `ref-${action}-${status}`;
    await feedback({ requestId, consultationId: page.patient.patientId }, status, {
      action, referenceType: action, message, items: [{ type: 'medication', name: '合成药品', code: 'QA-R3-MED' }],
    });
    expect(page.toast.mock.calls.filter(call => call[0] === message)).toEqual([
      [message, status === 'success' ? 'success' : status === 'failed' ? 'error' : 'info'],
    ]);
    expect(page.state.lastReferenceFeedback).toMatchObject({ requestId, action, status });
  }
  expect(page.state.finalWriteback.busy.value).toBe(false);
  expect(page.close).not.toHaveBeenCalled(); expect(packets()).toHaveLength(0);
});
