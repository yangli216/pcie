import { reactive, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';
import { useClinicalResultWritebackScope, type ClinicalResultWritebackScopeOptions } from './useClinicalResultWritebackScope';

function treatment(type: TreatmentRecommendation['type'], name: string): TreatmentRecommendation {
  return {
    type,
    name,
    reason: '测试',
    selected: true,
  };
}

function createFixture(options: Pick<ClinicalResultWritebackScopeOptions, 'getTemplateChapters' | 'isTemplateScopeReady' | 'getTemplateScopeKey'> = {}) {
  const record = reactive({
    chiefComplaint: '咳嗽3天',
    historyOfPresentIllness: '受凉后咳嗽。',
    pastMedicalHistory: '平素体健。',
    personalHistory: '',
    menstrualHistory: '',
    maritalReproductiveHistory: '',
    familyHistory: '否认家族遗传病史。',
    physicalExam: '双肺呼吸音清。',
    precautions: '注意休息。',
  });
  const diagnosisCount = ref(1);
  const treatments = ref<TreatmentRecommendation[]>([
    treatment('medicine', '药品A'),
    treatment('exam', '检查A'),
    treatment('lab_test', '检验A'),
  ]);
  const notify = vi.fn();
  const scope = useClinicalResultWritebackScope({
    ...options,
    getRecord: () => record,
    getSelectedDiagnosisCount: () => diagnosisCount.value,
    getSelectedTreatments: () => treatments.value.filter((item) => item.selected),
    notify,
  });
  return { record, diagnosisCount, treatments, notify, scope };
}

describe('useClinicalResultWritebackScope', () => {
  it('selects every available field and group by default', () => {
    const { scope } = createFixture();

    expect(scope.writebackScope.value.recordFields).toEqual([
      'chiefComplaint',
      'historyOfPresentIllness',
      'pastMedicalHistory',
      'familyHistory',
      'physicalExam',
      'precautions',
    ]);
    expect(scope.writebackScope.value.includeDiagnosis).toBe(true);
    expect(scope.writebackScope.value.orderTypes).toEqual(['medicine', 'exam', 'lab_test']);
    expect(scope.recordGroupChecked.value).toBe(true);
    expect(scope.partialSelection.value).toBe(false);
  });

  it('supports field-level partial selection and a mixed record parent state', () => {
    const { scope } = createFixture();

    scope.toggleRecordField('pastMedicalHistory');
    scope.toggleDiagnosis();

    expect(scope.recordGroupChecked.value).toBe(false);
    expect(scope.recordGroupIndeterminate.value).toBe(true);
    expect(scope.partialSelection.value).toBe(true);
    expect(scope.writebackScope.value.recordFields).not.toContain('pastMedicalHistory');
    expect(scope.writebackScope.value.includeDiagnosis).toBe(false);
  });

  it('keeps newly generated fields unselected after the doctor customized the scope', () => {
    const { record, scope } = createFixture();

    scope.toggleRecordField('chiefComplaint');
    record.personalHistory = '否认吸烟饮酒史。';
    scope.refreshAvailableContent();

    const personalHistory = scope.recordFieldOptions.value.find((item) => item.key === 'personalHistory');
    expect(personalHistory).toMatchObject({ available: true, selected: false, isNew: true });
    expect(scope.writebackScope.value.recordFields).not.toContain('personalHistory');
  });

  it('selects a newly migrated AI field after restoring an uncustomized legacy scope', () => {
    const { record, scope } = createFixture();

    scope.restore({
      recordFields: [
        'chiefComplaint',
        'historyOfPresentIllness',
        'pastMedicalHistory',
        'familyHistory',
        'physicalExam',
        'precautions',
      ],
      includeDiagnosis: true,
      includeMedicine: true,
      includeClinicalOrders: true,
      customized: false,
    });
    record.personalHistory = '否认吸烟史。';
    scope.refreshAvailableContent();

    expect(scope.writebackScope.value.recordFields).toContain('personalHistory');
  });

  it('exposes menstrual history as a separately selectable record field when it has content', () => {
    const { record, scope } = createFixture();

    record.menstrualHistory = '周期28天，经期5天。';
    scope.refreshAvailableContent();

    expect(scope.recordFieldOptions.value.find((item) => item.key === 'menstrualHistory')).toMatchObject({
      label: '月经史',
      available: true,
      selected: true,
    });
    expect(scope.writebackScope.value.recordFields).toContain('menstrualHistory');
  });

  it('filters treatments by the two selected order groups', () => {
    const { treatments, scope } = createFixture();

    scope.toggleMedicine();
    expect(scope.filterTreatments(treatments.value).map((item) => item.type)).toEqual(['exam', 'lab_test']);

    scope.toggleClinicalOrders();
    expect(scope.filterTreatments(treatments.value)).toEqual([]);
  });

  it('opens the selector and blocks submission when nothing is selected', () => {
    const { scope, notify } = createFixture();

    scope.toggleAll();

    expect(scope.ensureSelection()).toBe(false);
    expect(scope.selectorOpen.value).toBe(true);
    expect(notify).toHaveBeenCalledWith('请至少选择一项需要回写的内容', 'warning');
  });

  it('serializes and restores the doctor selection', () => {
    const { scope } = createFixture();
    scope.toggleRecordField('familyHistory');
    scope.toggleMedicine();
    const snapshot = scope.serialize();

    const restored = createFixture().scope;
    restored.restore(snapshot);

    expect(restored.serialize()).toEqual(snapshot);
    expect(restored.writebackScope.value.recordFields).not.toContain('familyHistory');
    expect(restored.writebackScope.value.orderTypes).toEqual(['exam', 'lab_test']);
  });

  it('remembers temporarily unavailable fields and groups without submitting them while unavailable', () => {
    const first = createFixture();
    first.scope.toggleRecordField('pastMedicalHistory');
    first.record.familyHistory = '';
    first.diagnosisCount.value = 0;
    first.treatments.value = [];
    first.scope.refreshAvailableContent();
    expect(first.scope.writebackScope.value).toMatchObject({ includeDiagnosis: false, orderTypes: [] });
    expect(first.scope.writebackScope.value.recordFields).not.toContain('familyHistory');
    const snapshot = first.scope.serialize();
    expect(snapshot.recordFields).toContain('familyHistory');
    expect(snapshot).not.toHaveProperty('templateChapterIds');

    const next = createFixture();
    next.record.familyHistory = '';
    next.diagnosisCount.value = 0;
    next.treatments.value = [];
    next.scope.restore(snapshot);
    next.record.familyHistory = '已有核对';
    next.diagnosisCount.value = 1;
    next.treatments.value = [treatment('medicine', '药品A')];
    next.scope.refreshAvailableContent();
    expect(next.scope.writebackScope.value.recordFields).toContain('familyHistory');
    expect(next.scope.writebackScope.value.recordFields).not.toContain('pastMedicalHistory');
    expect(next.scope.writebackScope.value).toMatchObject({ includeDiagnosis: true, orderTypes: ['medicine'] });
  });

  it('waits for the exact template metadata before migrating a legacy customized canonical selection', () => {
    type ChapterRows = NonNullable<ReturnType<NonNullable<ClinicalResultWritebackScopeOptions['getTemplateChapters']>>>;
    const chapters = ref<ChapterRows>([]);
    const ready = ref(false);
    const opts = { getTemplateChapters: () => chapters.value, isTemplateScopeReady: () => ready.value, getTemplateScopeKey: () => 'bound-A' };
    const legacy = { recordFields: ['physicalExam'], customized: true };
    const { scope } = createFixture(opts);
    scope.restore(legacy);
    expect(scope.serialize()).toMatchObject({ recordFields: ['physicalExam'], templateScopeKey: 'bound-A' });
    expect(scope.serialize()).not.toHaveProperty('templateChapterIds');
    chapters.value = [
      { key: 'first', label: '复查', available: true, recordFields: [] },
      { key: 'second', label: '复查', available: true, recordFields: [] },
      { key: 'custom', label: '补充', available: true, recordFields: [] },
    ];
    scope.refreshAvailableContent();
    scope.toggleRecordField('custom');
    const partial = scope.serialize();
    expect(partial.recordFields).toEqual(['physicalExam']);
    const restored = createFixture(opts).scope;
    restored.restore(partial);
    chapters.value = chapters.value.map(row => ({ ...row, recordFields: row.key === 'custom' ? [] : ['physicalExam'] }));
    ready.value = true;
    restored.refreshAvailableContent();
    expect(restored.serialize().templateChapterIds).toEqual(['first', 'second', 'custom']);
    expect(restored.writebackScope.value.recordFields).toEqual(['physicalExam']);
    restored.toggleRecordField('first');
    expect(restored.serialize().templateChapterIds).toEqual(['second', 'custom']);
  });

  it('restores source chapter preferences independently and discards data bound to another request', () => {
    const owner = ref<string | null>('bound-A');
    const one = { key: 'a', label: '同名', available: true, recordFields: ['physicalExam' as const] };
    const two = { ...one, key: 'b' };
    const rows = ref([one, two]);
    const opts = { getTemplateScopeKey: () => owner.value, getTemplateChapters: () => owner.value ? rows.value : null };
    const { scope } = createFixture(opts);
    scope.toggleRecordField('a');
    const saved = scope.serialize();
    expect(saved.templateChapterIds).toEqual(['b']);
    rows.value = [];
    scope.restore(saved);
    expect(scope.serialize().templateChapterIds).toEqual(['b']);
    rows.value = [one, { ...two, available: false }];
    scope.refreshAvailableContent();
    expect(scope.writebackScope.value.recordFields).toEqual([]);
    expect(scope.serialize().templateChapterIds).toEqual(['b']);
    rows.value = [one, two];
    scope.refreshAvailableContent();
    expect(scope.recordFieldOptions.value.map(row => row.selected)).toEqual([false, true]);

    owner.value = 'bound-B';
    scope.restore(saved);
    expect(scope.customized.value).toBe(false);
    expect(scope.recordFieldOptions.value.map(row => row.selected)).toEqual([true, true]);
    owner.value = null;
    scope.restore(saved);
    expect(scope.serialize()).not.toHaveProperty('templateChapterIds');
    expect(scope.writebackScope.value.recordFields).toContain('chiefComplaint');
  });
});
