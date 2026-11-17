// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';
import OutpatientEmrPage from './OutpatientEmrPage.vue';
import type { OutpatientEmrReferenceFeedbackPayload } from '../types';

const boundary = vi.hoisted(() => ({
  complete: vi.fn().mockResolvedValue(undefined),
  feedback: null as ((payload: OutpatientEmrReferenceFeedbackPayload) => void) | null,
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: boundary.complete }));
vi.mock('@/services/llm', () => ({
  chatFast: vi.fn().mockResolvedValue(JSON.stringify({ 吸烟史标志: '有', 吸烟史补充: '否认吸烟史' })),
}));
vi.mock('../api/outpatientEmrTemplateSnapshotService', () => ({
  resolveOutpatientEmrTemplateSnapshot: vi.fn().mockResolvedValue({ cacheHit: false }),
  persistOutpatientEmrTemplateSnapshot: vi.fn().mockResolvedValue({ id: 'SYN-SNAPSHOT' }),
}));
vi.mock('@features/consultation-result', () => ({
  useConsultationReferenceFeedbackListener: (options: { onFeedback: typeof boundary.feedback }) => {
    boundary.feedback = options.onFeedback;
  },
}));

let app: App | null = null;
let root: HTMLDivElement | null = null;
afterEach(() => { app?.unmount(); root?.remove(); boundary.complete.mockClear(); boundary.feedback = null; });

it('keeps conflict correction, doctor text, pending, failure retry and exact success in one real page flow', async () => {
  root = document.createElement('div'); document.body.append(root);
  const completed = vi.fn();
  app = createApp(OutpatientEmrPage, {
    request: {
      visitId: 'SYN-VISIT', requestId: 'SYN-REQUEST', templateId: 'SYN-TEMPLATE', templateName: '合成个人史',
      recordContext: { recordText: '吸烟20年，每日10支。' },
      targetFieldIds: ['吸烟史标志', '吸烟史补充'],
      templateHtml: '<section data-id="article-personal" data-article="个人史" data-name="个人史">'
        + '<span data-id="吸烟史标志" data-name="吸烟史标志" data-type="select" data-readonly="false"><span class="tag-value">否认</span></span>'
        + '<span data-id="吸烟史补充" data-name="吸烟史补充" data-type="text" data-readonly="false"><span class="tag-value"></span></span></section>',
      templateDefinition: JSON.stringify([{ ID: 'article-personal', NAME: '个人史', ARTICLE: '个人史', eles: [
        { ID: '吸烟史标志', NAME: '吸烟史标志', TYPE: 'select', READONLY: false, VALUE: '0', TEXT: '否认',
          BINDINGDATA: [{ VALUE: '0', TEXT: '否认' }, { VALUE: '1', TEXT: '有' }] },
        { ID: '吸烟史补充', NAME: '吸烟史补充', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
      ] }]),
    },
    onCompleted: completed,
  });
  app.mount(root);
  const action = () => Array.from(root!.querySelectorAll('button')).find(x => /返回参数|等待 HIS 回执/.test(x.textContent || ''))!;
  await vi.waitFor(() => expect(root!.querySelector('[role="alert"]')?.textContent).toContain('为阳性'));
  expect(action().disabled).toBe(true);
  const detail = root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="吸烟史补充"]')!;
  expect(detail.getAttribute('aria-invalid')).toBe('true');
  detail.textContent = '吸烟20年，每日10支。';
  detail.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.waitFor(() => expect(action().disabled).toBe(false));
  await nextTick();
  expect(detail.getAttribute('aria-invalid')).toBeNull();
  expect(detail.title).toBe('医生已修改');
  action().click();
  await vi.waitFor(() => expect(boundary.complete).toHaveBeenCalledTimes(1));
  const payload = boundary.complete.mock.calls[0][1].result;
  expect(payload.fieldValues['吸烟史补充']).toBe('吸烟20年，每日10支。');
  expect(payload.dictionarySelections['吸烟史标志']).toEqual({ value: '1', text: '有' });
  await vi.waitFor(() => expect(action().textContent).toContain('等待 HIS 回执'));
  boundary.feedback!({ consultationId: 'SYN-VISIT', requestId: 'OLD-REQUEST', status: 'success' });
  expect(completed).not.toHaveBeenCalled();
  boundary.feedback!({ consultationId: 'SYN-VISIT', requestId: 'SYN-REQUEST', status: 'failed', message: '合成保存失败' });
  await nextTick();
  expect(action().disabled).toBe(false);
  action().click();
  await vi.waitFor(() => expect(boundary.complete).toHaveBeenCalledTimes(2));
  boundary.feedback!({ consultationId: 'SYN-VISIT', requestId: 'SYN-REQUEST', status: 'success' });
  boundary.feedback!({ consultationId: 'SYN-VISIT', requestId: 'SYN-REQUEST', status: 'success' });
  expect(completed).toHaveBeenCalledTimes(1);
});
