// @vitest-environment jsdom
import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import InpatientEmrPage from './InpatientEmrPage.vue';
import type { InpatientEmrGenerationRequest } from '../types';

const boundary = vi.hoisted(() => ({
  invoke: vi.fn(),
  stream: vi.fn(),
  chatFast: vi.fn(),
  resolve: vi.fn(),
  events: new Map<string, (event: { payload: unknown }) => void>(),
  sessions: [] as Array<{ terminal: boolean; record: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: boundary.invoke }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => void) => {
    boundary.events.set(name, handler);
    return () => boundary.events.delete(name);
  }),
}));
vi.mock('@/services/llm', async () => ({
  chatStream: boundary.stream,
  chatFast: boundary.chatFast,
  DEFAULT_RETRY_CONFIG: (await import('@/services/llm/types')).DEFAULT_RETRY_CONFIG,
}));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.resolve }));
vi.mock('@/services/his', () => ({ getHisAdapter: () => null }));
vi.mock('@shared/ui/Icon.vue', () => ({ default: { render: () => null } }));
vi.mock('@features/consultation-result', async () => (
  await import('../../consultation-result/model/useConsultationReferenceFeedbackListener')
));
vi.mock('../api/inpatientEmrLogOutbox', () => ({
  inpatientLogUpload: { error: '', pending: 0, uploading: false, unrecorded: 0 },
  retryInpatientLogs: vi.fn(),
  reportInpatientLogFailure: vi.fn(),
}));
vi.mock('../api/inpatientEmrLog', () => ({
  createInpatientLogSession: vi.fn(async () => {
    const session = {
      generationId: `SYN-ROUND-${boundary.sessions.length}`,
      terminal: false,
      record: vi.fn(async (type: string) => {
        if (['abandoned', 'superseded', 'writeback_success'].includes(type)) session.terminal = true;
      }),
    };
    boundary.sessions.push(session);
    return session;
  }),
}));

let app: App | null = null;
let root: HTMLDivElement | null = null;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function request(admissionId = 'SYN-ADMISSION'): InpatientEmrGenerationRequest {
  return {
    admissionId,
    templateId: 'SYN-TEMPLATE',
    templateName: '日常病程记录',
    requestId: `SYN-REQUEST-${admissionId}`,
    recordTime: '2026-11-17 09:30',
    doctorSupplement: '本次合成查房资料',
    hisContext: { patient: { patientId: 'SYN-PATIENT', name: '合成患者', inpatientNo: 'SYN-HOSPITAL' } },
    htmlContent: '<section>'
      + '<span data-id="住院号" data-name="住院号" data-type="text"><span class="tag-value">系统值</span></span>'
      + '<span data-id="病程记录文本" data-name="病程记录文本" data-type="text"><span class="tag-value">请输入</span></span>'
      + '<span data-id="病情分析" data-name="病情分析" data-type="text"><span class="tag-value">请输入</span></span>'
      + '</section>',
  };
}

function mountPage(initialRequest = request()) {
  const currentRequest = ref<InpatientEmrGenerationRequest | null>(initialRequest);
  const completed = vi.fn();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    setup: () => () => h(InpatientEmrPage, { request: currentRequest.value, onCompleted: completed }),
  });
  app.mount(root);
  return { currentRequest, completed };
}

function previewField(id: string): HTMLElement {
  return root!.querySelector<HTMLElement>(`.html-preview [data-inpatient-emr-field-id="${id}"]`)!;
}

function writebackButton(): HTMLButtonElement {
  return root!.querySelector<HTMLButtonElement>('button[title="一键回写"]')!;
}

function completeCalls() {
  return boundary.invoke.mock.calls.filter(([command]) => command === 'complete_consultation');
}

function feedback(payload: Record<string, unknown>) {
  boundary.events.get('consultation-reference-feedback')!({ payload });
}

beforeEach(() => {
  boundary.invoke.mockReset().mockResolvedValue(undefined);
  boundary.stream.mockReset();
  boundary.chatFast.mockReset();
  boundary.resolve.mockReset().mockResolvedValue({ cacheHit: false, fields: [] });
  boundary.events.clear();
  boundary.sessions.length = 0;
});

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
  vi.restoreAllMocks();
});

it('keeps failed partial drafts editable and preserves the existing doctor writeback and exact HIS receipt flow', async () => {
  const gate = deferred();
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"已有合成病程草稿",');
    await gate.promise;
    throw new Error('合成流中断');
  });
  const { completed } = mountPage();

  await vi.waitFor(() => expect(boundary.stream, root!.textContent || '').toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('已有合成病程草稿'));
  expect(previewField('病程记录文本').getAttribute('contenteditable')).toBe('false');
  expect(writebackButton().disabled).toBe(true);
  expect(previewField('病情分析').textContent).toBe('');
  gate.resolve();

  await vi.waitFor(() => expect(root!.querySelector('[role="alert"]')).not.toBeNull());
  expect(root!.querySelector('.process-heading strong')?.textContent?.replace(/\s/g, '')).toBe('4/5');
  expect(root!.querySelector('.process-item.is-error')?.textContent).toContain('AI 生成');
  expect(previewField('病程记录文本').textContent).toBe('已有合成病程草稿');
  expect(previewField('病程记录文本').getAttribute('contenteditable')).toBe('true');
  expect(previewField('住院号').getAttribute('contenteditable')).toBe('false');
  expect(writebackButton().disabled).toBe(false);
  expect(boundary.sessions[0].record.mock.calls.some(([type]) => type === 'generation_failed')).toBe(true);
  expect(boundary.sessions[0].record.mock.calls.some(([type]) => type === 'generated' || type === 'fallback')).toBe(false);

  for (const [id, text] of [['病程记录文本', '医生核对后的合成病程'], ['病情分析', '医生补充的合成分析']]) {
    const field = previewField(id);
    field.textContent = text;
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  writebackButton().click();
  await vi.waitFor(() => expect(completeCalls()).toHaveLength(1));
  const payload = completeCalls()[0][1].result;
  expect(payload).toMatchObject({
    consultationId: 'SYN-ADMISSION', admissionId: 'SYN-ADMISSION', requestId: 'SYN-REQUEST-SYN-ADMISSION',
    emrType: 'inpatient-emr', referenceStatus: 'pending',
    fieldValues: { 病程记录文本: '医生核对后的合成病程', 病情分析: '医生补充的合成分析' },
  });
  expect(payload.fieldValues).not.toHaveProperty('住院号');
  await vi.waitFor(() => expect(root!.querySelector('.writeback-status')?.textContent).toContain('等待回填结果回执'));
  expect(writebackButton().disabled).toBe(true);
  expect(previewField('病程记录文本').getAttribute('contenteditable')).toBe('false');

  feedback({ consultationId: 'OTHER', requestId: payload.requestId, status: 'success' });
  feedback({ consultationId: payload.consultationId, requestId: 'OLD', status: 'success' });
  feedback({ consultationId: payload.consultationId, requestId: payload.requestId, status: 'pending' });
  expect(completed).not.toHaveBeenCalled();
  feedback({ consultationId: payload.consultationId, requestId: payload.requestId, status: 'success' });
  feedback({ consultationId: payload.consultationId, requestId: payload.requestId, status: 'success' });
  expect(completed).toHaveBeenCalledTimes(1);
  await nextTick();
  expect(root!.querySelector('.writeback-status')?.textContent).toContain('HIS 已完成病历回填');
  expect(boundary.stream).toHaveBeenCalledTimes(1);
  expect(boundary.chatFast).not.toHaveBeenCalled();
});

it('renders every partial snapshot even when chunks share the same timestamp', async () => {
  const first = deferred();
  const second = deferred();
  const final = deferred();
  const publishWithSameTimestamp = (onChunk: (chunk: string) => void, chunk: string) => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_794_876_000_000);
    try { onChunk(chunk); } finally { now.mockRestore(); }
  };
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    publishWithSameTimestamp(onChunk, '{"病程记录文本":"第一段合成草稿');
    await first.promise;
    publishWithSameTimestamp(onChunk, '，第二段合成草稿');
    await second.promise;
    publishWithSameTimestamp(onChunk, '","病情分析":"合成分析"}');
    await final.promise;
  });
  mountPage();
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('第一段合成草稿'));
  first.resolve();
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('第一段合成草稿，第二段合成草稿'));
  second.resolve();
  await vi.waitFor(() => expect(previewField('病情分析')?.textContent).toBe('合成分析'));
  final.resolve();
  await vi.waitFor(() => expect(writebackButton().disabled).toBe(false));
  expect(root!.querySelector('.process-heading strong')?.textContent?.replace(/\s/g, '')).toBe('5/5');
  expect(root!.querySelector('[role="alert"]')).toBeNull();
});

it('does not let an old admission request completion open a supplement dialog for a new patient', async () => {
  const oldResolve = deferred();
  boundary.resolve.mockImplementation(async (_path, payload) => {
    if (payload.templateId === 'SYN-OLD-TEMPLATE') await oldResolve.promise;
    return { cacheHit: false, fields: [] };
  });
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"新患者合成病程","病情分析":"新患者合成分析"}');
  });
  const oldRequest = { ...request('SYN-OLD'), templateId: 'SYN-OLD-TEMPLATE', templateName: '入院记录', doctorSupplement: undefined };
  const { currentRequest } = mountPage(oldRequest);
  await vi.waitFor(() => expect(boundary.resolve).toHaveBeenCalledTimes(1));
  currentRequest.value = request('SYN-NEW');
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('新患者合成病程'));
  oldResolve.resolve();
  await vi.waitFor(() => expect(boundary.sessions[0].record.mock.calls.some(([type]) => type === 'superseded')).toBe(true));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await nextTick();
  expect(root!.querySelector('[aria-label="补充病历要点"]')).toBeNull();
  expect(previewField('病程记录文本').textContent).toBe('新患者合成病程');
  expect(boundary.stream).toHaveBeenCalledTimes(1);
});
