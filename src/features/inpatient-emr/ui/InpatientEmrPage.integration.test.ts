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
  hisAdapter: vi.fn(),
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
vi.mock('@/services/his', () => ({ getHisAdapter: boundary.hisAdapter }));
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
  return root!.querySelector<HTMLElement>(`.record-pane .html-preview [data-inpatient-emr-field-id="${id}"]`)!;
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
  boundary.hisAdapter.mockReset().mockReturnValue(null);
  boundary.events.clear();
  boundary.sessions.length = 0;
});

it.each([
  ['omitted', '{"病程记录文本":"已有合成正文"}'],
  ['empty', '{"病程记录文本":"已有合成正文","病情分析":""}'],
])('opens a normal admission draft with an %s field for editing and optional regeneration', async (_kind, response) => {
  const visitId = 'SYN-REF';
  const fetchRecord = vi.fn().mockResolvedValue({ visitId, plainText: '合成参考正文' });
  boundary.hisAdapter.mockReturnValue({
    fetchOutpatientVisitHistory: vi.fn().mockResolvedValue([]),
    fetchOutpatientMedicalRecord: fetchRecord,
  });
  boundary.stream.mockImplementationOnce(async (_messages, onChunk) => {
    onChunk(response);
  }).mockImplementationOnce(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"合成复核正文","病情分析":"合成复核分析"}');
  });
  mountPage({ ...request(), templateName: '入院记录', outpatientVisitId: visitId, doctorSupplement: undefined });

  const summary = () => root!.querySelector('.generation-summary')!;
  await vi.waitFor(() => expect(summary().textContent).toContain('病历草稿已生成，请核对'));
  expect(summary().textContent).toContain('已填写 1/2');
  expect(root!.querySelector('[role="alert"], .regenerate-dialog')).toBeNull();
  expect(previewField('病程记录文本').textContent).toBe('已有合成正文');
  const empty = previewField('病情分析');
  expect(empty.getAttribute('contenteditable')).toBe('true');
  empty.textContent = '合成手工分析';
  empty.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  expect(summary().textContent).toContain('已填写 2/2');
  const cleared = previewField('病程记录文本');
  cleared.textContent = '';
  cleared.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();

  root!.querySelector<HTMLButtonElement>('[title="补充要点并重新生成"]')!.click();
  await nextTick();
  expect(root!.querySelector('.selected-reference')?.textContent).toContain(visitId);
  const supplement = root!.querySelector<HTMLTextAreaElement>('.regenerate-dialog textarea')!;
  supplement.value = '复核后的合成补充';
  supplement.dispatchEvent(new Event('input', { bubbles: true }));
  root!.querySelector<HTMLButtonElement>('.regenerate-footer .is-primary')!.click();
  await vi.waitFor(() => expect(previewField('病情分析')?.textContent).toBe('合成复核分析'));
  expect(fetchRecord.mock.calls).toEqual([[visitId], [visitId]]);
  expect(JSON.stringify(boundary.stream.mock.calls[1][0])).toContain('复核后的合成补充');
  const tasks = JSON.parse(boundary.stream.mock.calls[1][0][1].content.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
  expect(tasks).toContainEqual(expect.objectContaining({ id: '病情分析', doctorEdit: '合成手工分析' }));
  expect(tasks).toContainEqual(expect.objectContaining({ id: '病程记录文本', doctorEdit: '' }));
  expect(root!.querySelector('.regenerate-dialog')).toBeNull();
  root!.querySelector<HTMLButtonElement>('[title="补充要点并重新生成"]')!.click();
  await nextTick();
  root!.querySelector<HTMLButtonElement>('.selected-reference button')!.click();
  await nextTick();
  expect(root!.querySelector('.selected-reference')).toBeNull();
});

it('keeps a selected reference outside the history filter until the doctor changes or removes it', async () => {
  const incoming = 'SYN-ENTRY-VISIT';
  const replacement = 'SYN-LIST-VISIT';
  const visits = vi.fn().mockResolvedValue([{ visitId: replacement, visitDate: '2026-11-17', deptName: '合成门诊' }]);
  const fetchRecord = vi.fn(async (visitId: string) => ({ visitId, plainText: '合成就诊事实' }));
  boundary.hisAdapter.mockReturnValue({ fetchOutpatientVisitHistory: visits, fetchOutpatientMedicalRecord: fetchRecord });
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"合成病历","病情分析":"合成分析"}');
  });
  const { currentRequest } = mountPage({
    ...request(), templateName: '入院记录', doctorSupplement: undefined, outpatientVisitId: incoming,
  });
  await vi.waitFor(() => expect(root!.querySelector('.generation-summary')?.textContent).toContain('病历草稿已生成'));
  expect(root!.querySelector('.regenerate-dialog')).toBeNull();

  const openDialog = async () => {
    root!.querySelector<HTMLButtonElement>('[title="补充要点并重新生成"]')!.click();
    await nextTick();
  };
  const confirm = () => root!.querySelector<HTMLButtonElement>('.regenerate-footer .is-primary')!.click();
  await openDialog();
  expect(root!.querySelector('.selected-reference')?.textContent).toContain(incoming);
  root!.querySelectorAll<HTMLButtonElement>('.range-option-btn')[1].click();
  await nextTick();
  await vi.waitFor(() => expect(root!.querySelector('.select-btn')).not.toBeNull());
  expect(visits).toHaveBeenLastCalledWith('SYN-PATIENT', expect.objectContaining({ requireDiagnosisAndRecord: true, limit: -1 }));
  expect(root!.querySelector('.selected-reference')?.textContent).toContain(incoming);
  root!.querySelector<HTMLButtonElement>('.select-btn')!.click();
  await nextTick();
  expect(root!.querySelector('.selected-reference')).toBeNull();
  expect(root!.querySelector('.select-btn')?.getAttribute('aria-pressed')).toBe('true');
  confirm();
  await vi.waitFor(() => expect(fetchRecord).toHaveBeenCalledWith(replacement));
  await vi.waitFor(() => expect(writebackButton().disabled).toBe(false));

  await openDialog();
  root!.querySelector<HTMLButtonElement>('.select-btn')!.click();
  await nextTick();
  expect(root!.querySelector('.select-btn')?.getAttribute('aria-pressed')).toBe('false');
  confirm();
  await vi.waitFor(() => expect(boundary.stream).toHaveBeenCalledTimes(3));
  expect(fetchRecord.mock.calls).toEqual([[incoming], [replacement]]);
  await vi.waitFor(() => expect(writebackButton().disabled).toBe(false));
  previewField('病情分析').textContent = '首位患者独有医生修改';
  previewField('病情分析').dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  await openDialog();
  root!.querySelector<HTMLButtonElement>('.select-btn')!.click();
  await nextTick();
  expect(root!.querySelector('.visit-ref-card.is-selected')).not.toBeNull();
  visits.mockResolvedValue([]);
  boundary.stream.mockImplementationOnce(async (_messages, onChunk) => onChunk('{}'));
  const next = { ...request('SYN-NEXT'), templateName: '入院记录', doctorSupplement: undefined,
    hisContext: { patient: { patientId: 'SYN-NEXT-PATIENT' } } };
  currentRequest.value = next;
  await nextTick();
  await vi.waitFor(() => expect(root!.querySelector('.generation-summary')?.textContent).toContain('已填写 0/2'));
  expect(root!.querySelector('.regenerate-dialog, [role="alert"]')).toBeNull();
  expect(root!.querySelector('.selected-reference, .visit-ref-card.is-selected')).toBeNull();
  expect(root!.querySelector('.generation-summary')?.textContent).toContain('病历草稿已生成，请核对');
  expect(previewField('病情分析').getAttribute('contenteditable')).toBe('true');
  expect(boundary.stream).toHaveBeenCalledTimes(4);
  expect(JSON.stringify(boundary.stream.mock.calls[3][0])).not.toContain('首位患者独有医生修改');
});

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
  vi.restoreAllMocks();
});

it('keeps failed partial drafts editable and preserves the existing doctor writeback and exact HIS receipt flow', async () => {
  const templateLookup = deferred();
  boundary.resolve.mockImplementationOnce(async () => {
    await templateLookup.promise;
    return { cacheHit: false, fields: [] };
  });
  const gate = deferred();
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"已有合成病程草稿",');
    await gate.promise;
    throw new Error('合成流中断');
  });
  const { completed } = mountPage();

  await vi.waitFor(() => expect(boundary.resolve).toHaveBeenCalled());
  expect(previewField('住院号').textContent).toBe('系统值');
  expect(previewField('病程记录文本').getAttribute('contenteditable')).toBe('false');
  expect(writebackButton().disabled).toBe(true);
  templateLookup.resolve();
  await vi.waitFor(() => expect(boundary.stream, root!.textContent || '').toHaveBeenCalledTimes(1));
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('已有合成病程草稿'));
  expect(previewField('病程记录文本').getAttribute('contenteditable')).toBe('false');
  expect(writebackButton().disabled).toBe(true);
  expect(previewField('病情分析').textContent).toBe('');
  gate.resolve();

  const sidebar = root!.querySelector('.generation-sidebar')!;
  await vi.waitFor(() => expect(sidebar.querySelector('[role="alert"]')).not.toBeNull());
  expect(sidebar.querySelector('.process-heading strong')?.textContent?.replace(/\s/g, '')).toBe('4/5');
  expect(sidebar.querySelector('.process-item.is-error')?.textContent).toContain('AI 生成');
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

it('keeps the new patient draft when an admission stream finishes after the patient changes', async () => {
  const oldStream = deferred();
  boundary.stream.mockImplementationOnce(async (_messages, onChunk) => {
    await oldStream.promise;
    onChunk('{"病程记录文本":"旧患者迟到正文"}');
  }).mockImplementationOnce(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"新患者合成病程","病情分析":"新患者合成分析"}');
  });
  const oldRequest = { ...request('SYN-OLD'), templateId: 'SYN-OLD-TEMPLATE', templateName: '入院记录', doctorSupplement: undefined };
  const { currentRequest } = mountPage(oldRequest);
  await vi.waitFor(() => expect(boundary.stream).toHaveBeenCalledTimes(1));
  currentRequest.value = request('SYN-NEW');
  await vi.waitFor(() => expect(previewField('病程记录文本')?.textContent).toBe('新患者合成病程'));
  oldStream.resolve();
  await vi.waitFor(() => expect(boundary.sessions[0].record.mock.calls.some(([type]) => type === 'superseded')).toBe(true));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await nextTick();
  expect(root!.querySelector('[aria-label="补充病历要点"]')).toBeNull();
  expect(previewField('病程记录文本').textContent).toBe('新患者合成病程');
  expect(boundary.stream).toHaveBeenCalledTimes(2);
});

it('shows generation evidence alongside the original template and preserves doctor edits through HIS retry', async () => {
  boundary.stream.mockImplementation(async (_messages, onChunk) => {
    onChunk('{"病程记录文本":"合成病程原稿","病情分析":"合成分析原稿"}');
  });
  const { currentRequest } = mountPage();
  await vi.waitFor(() => expect(writebackButton()?.disabled).toBe(false));
  const sidebar = root!.querySelector('.generation-sidebar')!;
  expect(sidebar.querySelector('.generation-summary')?.textContent).toContain('已填写 2/2');
  const evidence = Array.from(sidebar.querySelectorAll('.evidence-line'))
    .find((line) => line.textContent?.includes('本次合成查房资料'));
  expect(evidence).toBeDefined();
  expect(evidence!.closest('details:not([open]), [hidden]')).toBeNull();
  expect(root!.querySelector('.record-pane [data-id="病程记录文本"] .tag-value')).toBe(previewField('病程记录文本'));
  expect(Array.from(root!.querySelectorAll('button')).some((button) => button.textContent?.includes('病历阅读'))).toBe(false);
  const field = previewField('病程记录文本');
  field.textContent = '医生修改的第一段\n医生修改的第二段';
  field.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  expect(previewField('病程记录文本')).toBe(field);
  expect(field.getAttribute('data-field-state')).toBe('edited');
  expect(previewField('病程记录文本').textContent).toBe('医生修改的第一段\n医生修改的第二段');
  expect(previewField('住院号').getAttribute('contenteditable')).toBe('false');
  const analysis = previewField('病情分析');
  analysis.textContent = '医生在原模板中修改的分析';
  analysis.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  expect(previewField('病情分析').textContent).toBe('医生在原模板中修改的分析');

  writebackButton().click();
  await vi.waitFor(() => expect(completeCalls()).toHaveLength(1));
  await vi.waitFor(() => expect(writebackButton().textContent).toContain('等待 HIS 回执'));
  expect(root!.querySelector('.generation-summary')?.textContent).toContain('当前病历为只读');
  const first = completeCalls()[0][1].result;
  expect(first.fieldValues).toEqual({
    病程记录文本: '医生修改的第一段\n医生修改的第二段', 病情分析: '医生在原模板中修改的分析',
  });
  currentRequest.value = {
    ...request(), requestId: 'SYN-OTHER-REQUEST', templateName: '其他文书', htmlContent: '<p>其他模板正文</p>',
  };
  await nextTick();
  expect(root!.querySelector('.workspace-subtitle')?.textContent).toContain('日常病程记录');
  expect(previewField('病程记录文本')).toBe(field);
  expect(root!.querySelector('.record-pane')?.textContent).not.toContain('其他模板正文');
  const collapse = root!.querySelector<HTMLButtonElement>('button[title="收起，保留当前病历"]')!;
  expect(collapse.disabled).toBe(false);
  feedback({ consultationId: first.consultationId, requestId: first.requestId, status: 'failed', message: '合成回填失败' });
  await nextTick();
  expect(writebackButton().textContent).toContain('重新回写');
  expect(previewField('病情分析').getAttribute('contenteditable')).toBe('true');
  expect(previewField('病程记录文本').textContent).toBe('医生修改的第一段\n医生修改的第二段');
  writebackButton().click();
  await vi.waitFor(() => expect(completeCalls()).toHaveLength(2));
  const second = completeCalls()[1][1].result;
  expect(second.requestId).not.toBe(first.requestId);
  expect(second.fieldValues).toEqual(first.fieldValues);
  feedback({ consultationId: second.consultationId, requestId: second.requestId, status: 'success' });
  await nextTick();
  expect(writebackButton().textContent).toContain('回写已完成');
  expect(writebackButton().disabled).toBe(true);
  expect(previewField('病情分析').getAttribute('contenteditable')).toBe('false');
});
