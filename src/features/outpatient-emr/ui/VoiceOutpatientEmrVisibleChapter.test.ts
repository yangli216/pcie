// @vitest-environment jsdom
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutpatientEmrTemplateField } from '../types';
import VoiceOutpatientEmrVisibleChapter from './VoiceOutpatientEmrVisibleChapter.vue';

let app: App | undefined;
let root: HTMLDivElement | undefined;
const field: OutpatientEmrTemplateField = {
  id: 'shown', name: '展示字段', type: 'select', articleId: 'history', articleTemplateId: 'history',
  articleName: '合成病史', articleDefinitionName: '合成病史', readonly: false, aiSuitable: true,
  baselineValue: '', baselineDictionaryValue: '', dictionaryItems: [{ text: '有', value: '1' }, { text: '无', value: '0' }],
  recordField: null, mappingSource: 'unmapped', projectionMode: null,
};

afterEach(() => { app?.unmount(); root?.remove(); });

describe('voice chapter display configuration', () => {
  it('uses the chapter title for a prefixed paragraph control while retaining its original writeback key', async () => {
    const history = { ...field, id: '请输入既往史', name: '请输入既往史', type: 'text',
      articleId: 'history', articleName: '既往史', articleDefinitionName: '既往史',
      dictionaryItems: [], recordField: 'pastMedicalHistory' as const, projectionMode: 'section-compose' as const };
    root = document.createElement('div'); document.body.append(root);
    app = createApp({ setup: () => () => h(VoiceOutpatientEmrVisibleChapter, {
      title: '既往史', fields: [history, { ...field, id: 'hidden', visible: false }], targetFieldIds: [history.id],
      values: { [history.id]: '类似发病史未详。' }, sources: { [history.id]: 'ai' }, conflicts: new Set<string>(), editable: true,
    }) });
    app.mount(root); await nextTick();
    expect(root.textContent).toContain('既往史：');
    expect(root.textContent).not.toContain('请输入既往史：');
    expect(root.querySelector('[data-outpatient-emr-field-id="请输入既往史"]')?.textContent).toContain('类似发病史未详。');
  });

  it('edits only a visible authorized slot and preserves hidden and non-target values', async () => {
    const fields = reactive([
      { ...field, id: 'hidden', name: '不展示字段', visible: false },
      { ...field },
      { ...field, id: 'reference', name: '只读参考' },
    ]);
    const values = reactive({ hidden: '有', shown: '无', reference: '有' } as Record<string, string>);
    const update = vi.fn((id: string, value: string) => { values[id] = value; });
    root = document.createElement('div'); document.body.append(root);
    app = createApp({ setup: () => () => h(VoiceOutpatientEmrVisibleChapter, {
      title: '合成病史', fields, targetFieldIds: ['hidden', 'shown'], values, sources: {}, conflicts: new Set<string>(),
      editable: true, onUpdateField: update,
    }) });
    app.mount(root);
    expect(root.textContent).not.toContain('不展示字段');
    const editor = root.querySelector<HTMLSelectElement>('select[aria-label="展示字段"]')!;
    expect(editor.disabled).toBe(false);
    expect(root.querySelector<HTMLSelectElement>('select[aria-label="只读参考"]')?.disabled).toBe(true);
    editor.value = '有'; editor.dispatchEvent(new Event('change', { bubbles: true }));
    expect(update).toHaveBeenCalledExactlyOnceWith('shown', '有');
    expect(values).toEqual({ hidden: '有', shown: '有', reference: '有' });
    fields[0].visible = true;
    await nextTick();
    expect(root.querySelector<HTMLSelectElement>('select[aria-label="不展示字段"]')?.value).toBe('有');
  });

  it('does not render an empty chapter when all its fields are hidden', () => {
    root = document.createElement('div'); document.body.append(root);
    app = createApp({ setup: () => () => h(VoiceOutpatientEmrVisibleChapter, {
      title: '合成病史', fields: [{ ...field, visible: false }], targetFieldIds: ['shown'],
      values: { shown: '有' }, sources: {}, conflicts: new Set<string>(), editable: true,
    }) });
    app.mount(root);
    expect(root.querySelector('section, select, textarea, [contenteditable]')).toBeNull();
    expect(root.textContent).toBe('');
  });
});
