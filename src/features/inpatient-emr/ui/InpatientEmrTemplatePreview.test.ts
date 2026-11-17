// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InpatientEmrTemplateField } from '../types';
import InpatientEmrTemplatePreview from './InpatientEmrTemplatePreview.vue';

let app: App<Element> | null = null;
let root: HTMLDivElement | null = null;

const fields: InpatientEmrTemplateField[] = [
  { id: 'hpi', name: '现病史', type: 'text', readonly: false, key: false, meaning: '本次病史', aiSuitable: true, rule: { source: 'ai', constraints: [] } },
  { id: 'assessment', name: '病情分析', type: 'text', readonly: false, key: false, meaning: '病情分析', aiSuitable: true, rule: { source: 'ai', constraints: [] } },
  { id: 'hospitalNo', name: '住院号', type: 'text', readonly: true, key: true, meaning: 'HIS 住院号', aiSuitable: false, rule: { source: 'his_or_system', constraints: [] } },
];
const templateHtml = '<section contenteditable="true">'
  + '<span data-id="hospitalNo" data-type="text"><span class="tag-value">SYN-HOSPITAL</span></span>'
  + '<div data-id="hpi" data-type="text"><span class="tag-value">模板病史</span></div>'
  + '<div data-id="assessment" data-type="text"><span class="tag-value">模板分析</span></div>'
  + '</section>';

function mountPreview(overrides: Partial<{
  htmlContent: string;
  fields: InpatientEmrTemplateField[];
  fieldValues: Record<string, string>;
  initialFieldValues: Record<string, string>;
  editable: boolean;
  isGenerating: boolean;
}> = {}) {
  const state = reactive({
    htmlContent: templateHtml,
    fields,
    fieldValues: { hpi: '合成病史', assessment: '合成分析', hospitalNo: 'SYN-HOSPITAL' } as Record<string, string>,
    initialFieldValues: { hpi: '合成病史', assessment: '合成分析' } as Record<string, string>,
    editable: true,
    isGenerating: false,
    ...overrides,
  });
  const onUpdateField = vi.fn((id: string, value: string) => { state.fieldValues[id] = value; });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ setup: () => () => h(InpatientEmrTemplatePreview, { ...state, onUpdateField }) });
  app.mount(root);
  return { state, onUpdateField };
}

function field(id: string): HTMLElement {
  const element = root!.querySelector<HTMLElement>(`.html-preview [data-inpatient-emr-field-id="${id}"]`);
  if (!element) throw new Error(`missing field ${id}`);
  return element;
}

async function switchView(label: string): Promise<void> {
  const button = Array.from(root!.querySelectorAll('button')).find((item) => item.textContent === label);
  if (!button) throw new Error(`missing view ${label}`);
  button.click();
  await nextTick();
}

function selectContents(element: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

function paste(element: HTMLElement, text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { getData: (type: string) => type === 'text/plain' ? text : '<img src=x onerror=alert(1)>' },
  });
  element.dispatchEvent(event);
  return event;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
});

describe('InpatientEmrTemplatePreview', () => {
  it('defaults to readable named AI fields and shares edits with the original template', async () => {
    const { state, onUpdateField } = mountPreview();
    expect(root!.querySelector('button[aria-pressed="true"]')?.textContent).toBe('病历阅读');
    expect(root!.querySelector('.reading-field-title')?.textContent).toBe('现病史');
    expect(root!.querySelector('[data-inpatient-emr-field-id="hospitalNo"]')).toBeNull();
    const readingField = field('hpi');
    readingField.textContent = '医生补充的合成病史';
    readingField.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await nextTick();
    expect(onUpdateField).toHaveBeenCalledWith('hpi', '医生补充的合成病史');
    expect(root!.querySelector('[data-field-badge="hpi"]')?.textContent).toBe('已编辑');

    await switchView('原始模板');
    expect(field('hpi').textContent).toBe('医生补充的合成病史');
    expect(field('hospitalNo').textContent).toBe('SYN-HOSPITAL');
    expect(field('hospitalNo').getAttribute('contenteditable')).toBe('false');
    field('hpi').textContent = '原模板继续修改';
    field('hpi').dispatchEvent(new InputEvent('input', { bubbles: true }));
    await nextTick();
    await switchView('病历阅读');
    expect(field('hpi').textContent).toBe('原模板继续修改');
    expect(state.fieldValues.hpi).toBe('原模板继续修改');
  });

  it('preserves the editor node and cursor while values, provenance and editability update', async () => {
    const { state } = mountPreview();
    const editor = field('hpi');
    editor.focus();
    const range = document.createRange();
    range.setStart(editor.firstChild!, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    state.fieldValues.assessment = '更新其他字段';
    await nextTick();
    expect(field('hpi')).toBe(editor);
    expect(window.getSelection()?.anchorNode).toBe(editor.firstChild);
    expect(window.getSelection()?.anchorOffset).toBe(2);
    expect(document.activeElement).toBe(editor);

    state.editable = false;
    await nextTick();
    expect(field('hpi')).toBe(editor);
    expect(editor.getAttribute('contenteditable')).toBe('false');
    expect(editor.getAttribute('aria-readonly')).toBe('true');
    state.editable = true;
    state.fieldValues.hpi = '更新当前字段';
    await nextTick();
    expect(field('hpi')).toBe(editor);
    expect(editor.textContent).toBe('更新当前字段');
    expect(editor.getAttribute('contenteditable')).toBe('true');
  });

  it('does not call streaming values doctor edits before an initial value exists and shows empty placeholders', async () => {
    const { state } = mountPreview({ initialFieldValues: {}, fieldValues: { hpi: '', assessment: '部分流式草稿' } });
    expect(field('hpi').textContent).toBe('');
    expect(field('hpi').getAttribute('data-placeholder')).toContain('点击补充');
    expect(root!.querySelector('[data-field-badge="assessment"]')?.textContent).toBe('AI 草稿');
    state.fieldValues.assessment = '完整流式草稿';
    await nextTick();
    expect(root!.querySelector('[data-field-badge="assessment"]')?.textContent).toBe('AI 草稿');
    state.initialFieldValues.assessment = '完整流式草稿';
    state.fieldValues.assessment = '医生修改';
    await nextTick();
    expect(root!.querySelector('[data-field-badge="assessment"]')?.textContent).toBe('已编辑');
    state.fieldValues.assessment = '完整流式草稿';
    await nextTick();
    expect(root!.querySelector('[data-field-badge="assessment"]')?.textContent).toBe('AI 草稿');
  });

  it('blocks edits during generation or readonly status, including synthetic input and paste', async () => {
    const { state, onUpdateField } = mountPreview({ isGenerating: true });
    expect(root!.querySelector('[role="status"]')?.textContent).toContain('正在生成');
    const editor = field('hpi');
    expect(editor.getAttribute('contenteditable')).toBe('false');
    editor.textContent = '不应保存';
    editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(editor.textContent).toBe('合成病史');
    expect(onUpdateField).not.toHaveBeenCalled();
    state.isGenerating = false;
    state.editable = false;
    await nextTick();
    expect(root!.querySelector('[role="status"]')?.textContent).toContain('只读');
    selectContents(editor);
    expect(paste(editor, '不可写入').defaultPrevented).toBe(true);
    expect(editor.textContent).toBe('合成病史');
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('pastes only plain multiline text into the selected field and keeps its editor', async () => {
    const { onUpdateField } = mountPreview();
    const editor = field('hpi');
    selectContents(editor);
    const event = paste(editor, '第一行\n<b>纯文字</b>');
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(field('hpi')).toBe(editor);
    expect(editor.textContent).toBe('第一行\n<b>纯文字</b>');
    expect(editor.querySelector('b, img')).toBeNull();
    expect(onUpdateField).toHaveBeenCalledWith('hpi', '第一行\n<b>纯文字</b>');
    await switchView('原始模板');
    expect(field('hpi').textContent).toBe('第一行\n<b>纯文字</b>');
  });

  it('rejects cross-field paste and beforeinput selections without changing either field', () => {
    const { onUpdateField } = mountPreview();
    const first = field('hpi');
    const second = field('assessment');
    const range = document.createRange();
    range.setStart(first.firstChild!, 1);
    range.setEnd(second.firstChild!, 1);
    window.getSelection()!.addRange(range);
    const event = paste(first, '跨字段覆盖');
    expect(event.defaultPrevented).toBe(true);
    const beforeInput = new InputEvent('beforeinput', { bubbles: true, cancelable: true, data: '覆盖' });
    first.dispatchEvent(beforeInput);
    expect(beforeInput.defaultPrevented).toBe(true);
    expect(first.textContent).toBe('合成病史');
    expect(second.textContent).toBe('合成分析');
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('sanitizes the original template and never inherits external editability or emits non-AI changes', async () => {
    const { onUpdateField } = mountPreview({
      htmlContent: `<script>alert(1)</script>${templateHtml}<div onclick="alert(1)" contenteditable="true">外部文字</div>`,
      fieldValues: { hpi: '<img src=x onerror=alert(1)>', assessment: '', hospitalNo: 'SYN-HOSPITAL' },
    });
    expect(field('hpi').querySelector('img')).toBeNull();
    await switchView('原始模板');
    expect(root!.querySelector('script, [onclick], img')).toBeNull();
    const preview = root!.querySelector('.html-preview')!;
    expect(preview.querySelector('section')?.getAttribute('contenteditable')).not.toBe('true');
    expect(Array.from(preview.querySelectorAll('[contenteditable="true"]'))).toEqual([field('hpi'), field('assessment')]);
    const readonly = field('hospitalNo');
    readonly.textContent = '不可改住院号';
    readonly.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(readonly.textContent).toBe('SYN-HOSPITAL');
    expect(onUpdateField).not.toHaveBeenCalled();
  });

  it('shows an empty reading state while retaining the full original template', async () => {
    mountPreview({ fields: [fields[2]], fieldValues: { hospitalNo: 'SYN-HOSPITAL' } });
    expect(root!.querySelector('.reading-empty')?.textContent).toContain('没有 AI 生成字段');
    await switchView('原始模板');
    expect(field('hospitalNo').textContent).toBe('SYN-HOSPITAL');
    expect(field('hpi').getAttribute('contenteditable')).toBe('false');
  });
});
