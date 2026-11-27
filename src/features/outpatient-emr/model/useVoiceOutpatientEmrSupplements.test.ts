import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { ClinicalRecordFactSuggestion } from '@features/clinical-result';
import type { OutpatientEmrFieldValueSource, OutpatientEmrTemplateField } from '../types';
import { useVoiceOutpatientEmrSupplements } from './useVoiceOutpatientEmrSupplements';

const field = (id: string, recordField: OutpatientEmrTemplateField['recordField'], extra = {}): OutpatientEmrTemplateField => ({
  id, name: id, type: 'text', articleTemplateId: 'exam', articleId: 'exam', articleName: '体格检查',
  articleDefinitionName: '体格检查', readonly: false, aiSuitable: true, baselineValue: '', baselineDictionaryValue: '',
  dictionaryItems: [], recordField, mappingSource: 'deterministic-alias', projectionMode: 'section-compose', ...extra,
});
const candidate: ClinicalRecordFactSuggestion = { id: 'syn-exam', field: 'physicalExam', question: '合成核查项',
  negativeRecordText: '腹软，无反跳痛。', rationale: '合成回归', priority: 'critical', status: 'pending' };

function setup() {
  const scope = effectScope();
  const owner = ref<object | null>({});
  const ready = ref(true);
  const chapters = ref([
    { key: 'exam', fields: [field('体温', 'physicalExam', { aiSuitable: false, visible: false }), field('其他体格检查', 'physicalExam')] },
    { key: 'notes', fields: [field('注意事项文本', 'precautions', { projectionMode: 'direct' })] },
  ]);
  const values = ref<Record<string, string>>({ 体温: '37.2', 其他体格检查: '', 注意事项文本: '' });
  const sources = ref<Record<string, OutpatientEmrFieldValueSource>>({});
  const source = ref({ suggestions: [candidate], precautions: '合成复诊安排。' });
  const edited = new Set<string>();
  let writes = 0;
  scope.run(() => useVoiceOutpatientEmrSupplements({
    owner: () => owner.value, ready: () => ready.value, chapters: () => chapters.value,
    values: () => values.value, sources: () => sources.value, source: () => source.value,
    isEdited: id => edited.has(id), apply: (_fields, patch) => { writes++; values.value = { ...values.value, ...patch }; },
  }));
  return { scope, owner, ready, chapters, values, sources, source, edited, writes: () => writes };
}

describe('voice template supplement binding', () => {
  it('binds candidates and scoped education once, independently of hidden sibling fields', async () => {
    const s = setup(); await nextTick();
    expect(s.values.value).toEqual({ 体温: '37.2', 其他体格检查: '腹软，无反跳痛。', 注意事项文本: '合成复诊安排。' });
    const writes = s.writes();
    s.chapters.value[0].fields[1].visible = false;
    s.source.value = { ...s.source.value, suggestions: [{ ...candidate }] }; await nextTick();
    expect(s.writes()).toBe(writes);
    expect(s.values.value.其他体格检查).toBe('腹软，无反跳痛。'); s.scope.stop();
  });

  it('preserves doctor edits/clears and does not write during feedback or streaming', async () => {
    const s = setup(); await nextTick();
    s.sources.value = { 其他体格检查: 'doctor', 注意事项文本: 'doctor' };
    s.edited.add('其他体格检查'); s.edited.add('注意事项文本');
    s.values.value = { ...s.values.value, 其他体格检查: '', 注意事项文本: '医生约定复诊。' };
    s.source.value = { suggestions: [candidate], precautions: '后到的系统宣教。' }; await nextTick();
    expect(s.values.value.其他体格检查).toBe('');
    expect(s.values.value.注意事项文本).toBe('医生约定复诊。');
    s.ready.value = false; s.edited.clear(); s.sources.value = {};
    s.values.value = { ...s.values.value, 注意事项文本: '' }; await nextTick();
    expect(s.values.value.注意事项文本).toBe(''); s.scope.stop();
  });

  it('replaces only its own education after diagnosis scope changes and clears ownership on a new request', async () => {
    const s = setup(); await nextTick();
    s.source.value = { ...s.source.value, precautions: '另一诊断的宣教。' }; await nextTick();
    expect(s.values.value.注意事项文本).toBe('另一诊断的宣教。');
    s.source.value = { ...s.source.value, precautions: '' }; await nextTick();
    expect(s.values.value.注意事项文本).toBe('');
    s.ready.value = false; s.owner.value = {}; s.values.value.注意事项文本 = '新请求已有正文。'; await nextTick();
    s.ready.value = true; s.source.value = { suggestions: [], precautions: '旧来源不能盖新正文。' }; await nextTick();
    expect(s.values.value.注意事项文本).toBe('新请求已有正文。'); s.scope.stop();
  });

  it('does not guess between same-semantic chapters or project a full paragraph into a detail/dictionary/manual slot', async () => {
    const s = setup(); s.ready.value = false; await nextTick();
    s.values.value = {};
    s.chapters.value = [
      { key: 'a', fields: [field('其他体格检查', 'physicalExam')] },
      { key: 'b', fields: [field('体格检查文本', 'physicalExam')] },
      { key: 'notes', fields: [field('注意事项文本', 'precautions', { aiSuitable: false })] },
    ];
    s.ready.value = true; await nextTick(); expect(s.values.value).toEqual({});
    s.source.value = { ...s.source.value, suggestions: [{ ...candidate, chapterId: 'b' }] }; await nextTick();
    expect(s.values.value).toEqual({ 体格检查文本: '腹软，无反跳痛。' });
    s.ready.value = false; await nextTick(); s.values.value = {};
    s.chapters.value = [{ key: 'b', fields: [field('压痛部位', 'physicalExam')] }];
    s.ready.value = true; await nextTick(); expect(s.values.value).toEqual({}); s.scope.stop();
  });

  it('binds a prefixed history body while retaining known history and dismissed candidate decisions', async () => {
    const s = setup(); s.ready.value = false; await nextTick();
    s.chapters.value = [{ key: 'past', fields: [field('请输入既往史', 'pastMedicalHistory')] }];
    s.values.value = { 请输入既往史: '有哮喘史。' };
    s.source.value = { precautions: '', suggestions: [
      { ...candidate, id: 'past-open', field: 'pastMedicalHistory', negativeRecordText: '无外伤史。' },
      { ...candidate, id: 'past-dismissed', field: 'pastMedicalHistory', negativeRecordText: '无输血史。', status: 'dismissed' },
    ] };
    s.ready.value = true; await nextTick();
    expect(s.values.value.请输入既往史).toBe('有哮喘史。无外伤史。');
    s.scope.stop();
  });
});
