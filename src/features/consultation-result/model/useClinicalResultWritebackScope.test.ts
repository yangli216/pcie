import { reactive, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';
import { useClinicalResultWritebackScope } from './useClinicalResultWritebackScope';

function treatment(type: TreatmentRecommendation['type'], name: string): TreatmentRecommendation {
  return {
    type,
    name,
    reason: '测试',
    selected: true,
  };
}

function createFixture() {
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
});
