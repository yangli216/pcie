// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpatientEmrAnalysisStatus, OutpatientEmrTemplateParseResult } from '../types';
import { parseOutpatientEmrTemplate } from '../lib/outpatientEmrTemplate';
import VoiceOutpatientEmrRecord from './VoiceOutpatientEmrRecord.vue';

let app: App | null = null;
let root: HTMLDivElement | null = null;
afterEach(() => { app?.unmount(); root?.remove(); app = null; root = null; });

function parsedTemplate(): OutpatientEmrTemplateParseResult {
  return parseOutpatientEmrTemplate(
    '<script>alert("ignored")</script><section data-id="chief" data-article="主诉" data-name="主诉">'
      + '<span data-id="chiefComplaint" data-name="主诉" data-type="text" data-readonly="false"></span></section>',
    JSON.stringify([{ ID: 'chief', NAME: '主诉', ARTICLE: '主诉', eles: [
      { ID: 'chiefComplaint', NAME: '主诉', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
    ] }]),
    ['chiefComplaint'],
  );
}

describe('VoiceOutpatientEmrRecord', () => {
  it('renders the actual sanitized template and forwards plain edits without a fixed record fallback', async () => {
    const template = parsedTemplate();
    const onUpdateField = vi.fn();
    root = document.createElement('div'); document.body.append(root);
    app = createApp(VoiceOutpatientEmrRecord, {
      templateName: '合成门诊模板', template, fields: template.targetFields,
      values: { chiefComplaint: '咳嗽三天。' }, sources: { chiefComplaint: 'ai' },
      status: 'ready', onUpdateField,
    });
    app.mount(root);
    await nextTick();
    expect(root.textContent).toContain('当前门诊模板：合成门诊模板');
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelectorAll('[data-outpatient-emr-field-id]')).toHaveLength(1);
    const field = root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="chiefComplaint"]')!;
    expect(field.textContent).toBe('咳嗽三天。');
    field.textContent = '医生修订后的主诉';
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(onUpdateField).toHaveBeenCalledWith('chiefComplaint', '医生修订后的主诉');
    expect(root.textContent).not.toContain('既往史');
  });

  it('presents generation errors, retry and conflict messages inside the same record area', async () => {
    const state = reactive({
      status: 'analyzing' as OutpatientEmrAnalysisStatus,
      template: null as OutpatientEmrTemplateParseResult | null,
      errorMessage: '', validationMessage: '', canRetry: false,
    });
    const onRetry = vi.fn();
    root = document.createElement('div'); document.body.append(root);
    app = createApp({ setup: () => () => h(VoiceOutpatientEmrRecord, {
      templateName: '合成门诊模板', fields: [], values: {}, sources: {}, ...state, onRetry,
    }) });
    app.mount(root);
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelector('[role="status"]')?.textContent).toContain('正在按当前门诊模板生成');
    state.status = 'error'; state.errorMessage = '合成模板配对失败'; state.canRetry = true;
    await nextTick();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('合成模板配对失败');
    root.querySelector<HTMLButtonElement>('button')!.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(root.querySelector('.template-document')).toBeNull();
    state.status = 'ready'; state.template = parsedTemplate(); state.validationMessage = '字典字段待选择';
    await nextTick();
    expect(root.querySelector('[role="alert"]')?.textContent).toBe('字典字段待选择');
  });

  it('keeps pending HIS writeback content read-only', async () => {
    const template = parsedTemplate();
    root = document.createElement('div'); document.body.append(root);
    const onUpdateField = vi.fn();
    app = createApp(VoiceOutpatientEmrRecord, {
      templateName: '合成模板', template, fields: template.targetFields,
      values: { chiefComplaint: '已发送正文' }, sources: {}, status: 'ready', editable: false, onUpdateField,
    });
    app.mount(root);
    await nextTick();
    const field = root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="chiefComplaint"]')!;
    expect(field.getAttribute('contenteditable')).not.toBe('true');
    field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(onUpdateField).not.toHaveBeenCalled();
  });
});
