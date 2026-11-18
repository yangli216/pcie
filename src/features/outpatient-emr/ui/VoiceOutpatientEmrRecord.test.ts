// @vitest-environment jsdom
import { createApp, h, nextTick, ref, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpatientEmrTemplateField } from '../types';
import VoiceOutpatientEmrRecord from './VoiceOutpatientEmrRecord.vue';

const history: OutpatientEmrTemplateField = {
  id: 'his-history', name: '现病史文本', type: 'text',
  articleTemplateId: 'history', articleId: 'present', articleName: '现病史', articleDefinitionName: '现病史',
  readonly: false, aiSuitable: true, baselineValue: '', baselineDictionaryValue: '', dictionaryItems: [],
  recordField: 'historyOfPresentIllness', mappingSource: 'definition-record-field', projectionMode: 'direct',
};

let app: App;
let root: HTMLDivElement;

function mount(render: () => ReturnType<typeof h>): void {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ setup: () => render });
  app.mount(root);
}

afterEach(() => {
  app?.unmount();
  root?.remove();
});

describe('VoiceOutpatientEmrRecord', () => {
  it('edits and clears a mapped text value in the clinical document using its original HIS field ID', async () => {
    const value = ref('咳嗽三天。');
    const update = vi.fn((_fieldId: string, next: string) => { value.value = next; });
    mount(() => h(VoiceOutpatientEmrRecord, {
      field: history, title: '现病史', value: value.value, source: 'ai', onUpdateField: update,
    }));
    const line = root.querySelector<HTMLElement>('.clinical-record-line')!;
    expect(line.textContent).toContain('现病史：咳嗽三天。');
    line.click();
    await nextTick();
    const editor = root.querySelector<HTMLElement>('[role="textbox"][contenteditable="plaintext-only"]')!;
    for (const text of ['医生修订，含纯文本 <b>标记</b>', '']) {
      editor.innerText = text;
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      expect(update).toHaveBeenLastCalledWith('his-history', text);
    }
    editor.dispatchEvent(new FocusEvent('blur'));
    await nextTick();
    expect(root.textContent).toContain('未记录（点击补充）');
  });

  it('shows matched facts and lets the doctor remove a highlighted AI suggestion from the same field', async () => {
    const update = vi.fn();
    const dismiss = vi.fn();
    mount(() => h(VoiceOutpatientEmrRecord, {
      field: history, title: '现病史', value: '咳嗽。否认胸痛。', onUpdateField: update, onDismissFactSuggestion: dismiss,
      factHighlights: [{
        id: 'cough', field: 'historyOfPresentIllness', text: '咳嗽', source: 'structured-answer', polarity: 'positive',
      }],
      factSuggestions: [{
        id: 'negative-chest-pain', field: 'historyOfPresentIllness', question: '是否胸痛？',
        negativeRecordText: '否认胸痛', rationale: '合成核查依据', priority: 'critical', status: 'pending',
      }],
    }));
    expect(root.querySelector('.is-positive')?.textContent).toContain('咳嗽');
    const suggestion = root.querySelector<HTMLButtonElement>('button.is-suggestion.is-critical')!;
    expect(suggestion.textContent).toContain('否认胸痛');
    suggestion.click();
    await nextTick();
    const remove = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find(button => button.textContent === '移除')!;
    remove.click();
    expect(update).toHaveBeenCalledWith('his-history', '咳嗽。');
    expect(dismiss).toHaveBeenCalledWith('negative-chest-pain');
  });

  it('offers the HIS dictionary choices and emits their display text for binding', async () => {
    const update = vi.fn();
    const editable = ref(true);
    const field = { ...history, type: 'select', dictionaryItems: [{ value: '1', text: '有' }, { value: '0', text: '无' }] };
    mount(() => h(VoiceOutpatientEmrRecord, {
      field, title: '手术史', value: '无', editable: editable.value, conflict: true, onUpdateField: update,
    }));
    const select = root.querySelector('select')!;
    expect(select.closest('[aria-invalid="true"]')).not.toBeNull();
    expect(select.selectedOptions[0].textContent).toBe('无');
    const positive = Array.from(select.options).find(option => option.textContent === '有')!;
    select.value = positive.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(update).toHaveBeenCalledWith('his-history', '有');
    editable.value = false;
    await nextTick();
    expect(select.disabled).toBe(true);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('identifies an unmentioned appetite default and allows the doctor to clear it', () => {
    const update = vi.fn();
    const field = { ...history, id: '胃纳', type: 'select', dictionaryItems: [
      { value: '0', text: '减少' }, { value: '1', text: '欠佳' }, { value: '2', text: '如常' },
    ] };
    mount(() => h(VoiceOutpatientEmrRecord, {
      field, title: '胃纳', value: '如常', source: 'unmentioned-default', onUpdateField: update,
    }));
    expect(root.querySelector<HTMLElement>('[data-outpatient-emr-field-id="胃纳"]')?.title).toContain('未提及');
    const select = root.querySelector('select')!;
    expect(select.value).toBe('如常');
    expect(Array.from(select.options).find(option => option.value === '')?.disabled).toBe(false);
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(update).toHaveBeenCalledWith('胃纳', '');
  });

  it('keeps the displayed field read-only while awaiting HIS feedback', async () => {
    const update = vi.fn();
    const editable = ref(true);
    mount(() => h(VoiceOutpatientEmrRecord, {
      field: history, title: '现病史', value: '已发送正文', editable: editable.value, onUpdateField: update,
    }));
    root.querySelector<HTMLElement>('.clinical-record-line')!.click();
    await nextTick();
    expect(root.querySelector('[contenteditable="plaintext-only"]')).not.toBeNull();
    editable.value = false;
    await nextTick();
    expect(root.textContent).toContain('已发送正文');
    root.querySelector<HTMLElement>('.clinical-record-line')!.click();
    await nextTick();
    expect(root.querySelector('[contenteditable="plaintext-only"]')).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});
