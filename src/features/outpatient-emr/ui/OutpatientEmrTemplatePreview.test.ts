// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';
import OutpatientEmrTemplatePreview from './OutpatientEmrTemplatePreview.vue';
import { parseOutpatientEmrTemplate } from '../lib/outpatientEmrTemplate';
import hisHtml from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import hisDefinition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';

let app: App<Element> | null = null;
let root: HTMLDivElement | null = null;

const fields: OutpatientEmrTemplateField[] = [{
  id: 'personalHistory',
  name: '个人史',
  type: 'text',
  articleTemplateId: 'article-personal-history',
  articleId: '个人史',
  articleName: '个人史',
  articleDefinitionName: '个人史',
  readonly: false,
  aiSuitable: true,
  baselineValue: '基线',
  baselineDictionaryValue: '',
  dictionaryItems: [],
  recordField: 'personalHistory',
  mappingSource: 'canonical-id',
  projectionMode: 'direct',
}];

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
});

describe('OutpatientEmrTemplatePreview', () => {
  it('hides configured target and non-target fields without clearing values or emitting edits', async () => {
    const state = reactive({
      visibilityFields: [{ ...fields[0], visible: false }, { ...fields[0], id: 'hisOnly', visible: false, readonly: true }],
      fieldValues: { personalHistory: '保留的正文', hisOnly: '保留的 HIS 原值' },
    });
    const onUpdateField = vi.fn();
    root = document.createElement('div');
    document.body.append(root);
    app = createApp({ setup: () => () => h(OutpatientEmrTemplatePreview, {
      sanitizedHtml: '<p><span data-id="personalHistory" data-type="text">原模板值</span><span data-id="hisOnly" data-type="text">HIS值</span><b>保留固定文字</b></p>',
      fields, ...state, onUpdateField,
    }) });
    app.mount(root);
    expect(root.querySelector('[data-id="personalHistory"]')).toBeNull();
    expect(root.querySelector('[data-id="hisOnly"]')).toBeNull();
    expect(root.textContent).toContain('保留固定文字');
    state.visibilityFields[0].visible = true;
    await nextTick(); await nextTick();
    expect(root.querySelector('[data-outpatient-emr-field-id="personalHistory"]')?.textContent).toBe('保留的正文');
    expect(state.fieldValues.hisOnly).toBe('保留的 HIS 原值');
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('keeps HIS placeholders in the document and restores them when a field is cleared', async () => {
    const template = parseOutpatientEmrTemplate(hisHtml, hisDefinition, ['主诉文本', '痰声标志']);
    const fieldValues = reactive<Record<string, string>>({ 主诉文本: '', 痰声标志: '无' });
    const fieldSources = reactive<Record<string, OutpatientEmrFieldValueSource>>({ 痰声标志: 'unmentioned-default' });
    const onUpdateField = vi.fn((id: string, value: string) => {
      fieldValues[id] = value;
      fieldSources[id] = 'doctor';
    });
    root = document.createElement('div');
    document.body.append(root);
    app = createApp({ setup: () => () => h(OutpatientEmrTemplatePreview, {
      sanitizedHtml: template.sanitizedHtml, fields: template.targetFields, fieldValues, fieldSources, onUpdateField,
    }) });
    app.mount(root);
    await nextTick();

    const editor = root.querySelector<HTMLElement>('[role="textbox"][aria-label="主诉文本"]')!;
    const selector = root.querySelector<HTMLSelectElement>('select[aria-label="痰声标志"]')!;
    const label = selector.nextElementSibling!;
    expect(editor.getAttribute('aria-placeholder')).toBe('请输入主诉');
    expect(editor.textContent).toBe('');
    expect(editor.closest('.tag-filed')?.textContent).toBe('{}');
    expect(root.querySelector('header.tag-article')?.textContent).toContain('门(急)诊病历');
    expect(root.querySelector('header [tabindex]')).toBeNull();
    expect(label.textContent).toBe('无');
    expect(selector.title).toContain('本次未提及');
    expect(selector.options[0]?.text).toBe('留空');
    expect(selector.options[0]?.disabled).toBe(false);

    selector.value = '有';
    selector.dispatchEvent(new Event('input', { bubbles: true }));
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdateField).toHaveBeenCalledTimes(1);
    expect(onUpdateField).toHaveBeenCalledWith('痰声标志', '有');
    expect(label.textContent).toBe('有');
    selector.value = '';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onUpdateField).toHaveBeenLastCalledWith('痰声标志', '');
    await nextTick();
    await nextTick();
    expect(label.textContent).toBe('有无');
    expect(label.classList.contains('placeholder')).toBe(true);
    expect(selector.title).toBe('医生已修改');
    fieldValues.主诉文本 = '合成记录';
    await nextTick();
    await nextTick();
    expect(editor.textContent).toBe('合成记录');
    editor.innerHTML = '<br>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    await nextTick();
    expect(fieldValues.主诉文本).toBe('');
    expect(editor.childNodes).toHaveLength(0);
    expect(editor.getAttribute('data-outpatient-emr-placeholder')).toBe('请输入主诉');
  });

  it('updates provenance and clears a resolved conflict without replacing the doctor editor', async () => {
    const state = reactive({
      fieldValues: { personalHistory: '模板草稿' },
      fieldSources: { personalHistory: 'template' } as Record<string, OutpatientEmrFieldValueSource>,
      conflictFieldIds: new Set<string>(),
    });
    root = document.createElement('div');
    document.body.append(root);
    app = createApp({
      setup: () => () => h(OutpatientEmrTemplatePreview, {
        sanitizedHtml: '<span data-id="personalHistory" data-type="text">模板草稿</span>',
        fields,
        ...state,
      }),
    });
    app.mount(root);
    await nextTick();
    const editor = root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="personalHistory"]');
    expect(editor?.title).toContain('未经本次病例核对');

    state.conflictFieldIds = new Set(['personalHistory']);
    await nextTick();
    await nextTick();
    expect(editor?.getAttribute('aria-invalid')).toBe('true');
    expect(editor?.title).toContain('与同组标志矛盾');

    state.fieldValues.personalHistory = '医生确认的正文';
    state.fieldSources.personalHistory = 'doctor';
    state.conflictFieldIds = new Set();
    await nextTick();
    await nextTick();
    expect(root.querySelector('[data-outpatient-emr-field-id="personalHistory"]')).toBe(editor);
    expect(editor?.textContent).toBe('医生确认的正文');
    expect(editor?.title).toBe('医生已修改');
    expect(editor?.hasAttribute('aria-invalid')).toBe(false);
    expect(editor?.hasAttribute('data-outpatient-emr-issue')).toBe(false);

    state.fieldSources = {};
    await nextTick();
    await nextTick();
    expect(editor?.hasAttribute('title')).toBe(false);
    expect(editor?.hasAttribute('data-outpatient-emr-source')).toBe(false);
  });

  it('renders sanitized text values and emits only plain doctor edits', async () => {
    const onUpdateField = vi.fn();
    root = document.createElement('div');
    document.body.append(root);
    app = createApp(OutpatientEmrTemplatePreview, {
      sanitizedHtml: `
        <script>alert(1)</script>
        <div data-id="personalHistory" data-type="text" data-ai-suitable="true">基线</div>
      `,
      fields,
      fieldValues: { personalHistory: '<b>医生值</b>' },
      editable: true,
      onUpdateField,
    });
    app.mount(root);
    await nextTick();

    expect(root.querySelector('script')).toBeNull();
    const editor = root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="personalHistory"]');
    expect(editor?.textContent).toBe('<b>医生值</b>');
    expect(editor?.querySelector('b')).toBeNull();
    expect(editor?.getAttribute('contenteditable')).toBe('true');

    if (!editor) throw new Error('missing editor');
    editor.textContent = '医生手工修改';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await nextTick();
    expect(onUpdateField).toHaveBeenCalledWith('personalHistory', '医生手工修改');
  });

  it('renders an unresolved dictionary as a constrained selector and lets the doctor select the template default', async () => {
    const onUpdateField = vi.fn();
    root = document.createElement('div');
    document.body.append(root);
    app = createApp(OutpatientEmrTemplatePreview, {
      sanitizedHtml: '<span data-id="肝炎史标志" data-type="select"><span class="tag-value">否认</span></span>',
      fields: [{
        ...fields[0],
        id: '肝炎史标志',
        name: '肝炎史标志',
        type: 'select',
        baselineValue: '否认',
        baselineDictionaryValue: '0',
        dictionaryItems: [
          { value: '0', text: '否认' },
          { value: '1', text: '有' },
        ],
      }],
      fieldValues: { 肝炎史标志: '' },
      editable: true,
      onUpdateField,
    });
    app.mount(root);
    await nextTick();

    const selector = root.querySelector<HTMLSelectElement>(
      '[data-outpatient-emr-field-id="肝炎史标志"]',
    );
    expect(selector?.value).toBe('');
    expect(Array.from(selector?.options || []).map((option) => option.text)).toEqual([
      '留空',
      '否认',
      '有',
    ]);

    if (!selector) throw new Error('missing dictionary selector');
    selector.value = '否认';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(onUpdateField).toHaveBeenCalledWith('肝炎史标志', '否认');
  });
});
