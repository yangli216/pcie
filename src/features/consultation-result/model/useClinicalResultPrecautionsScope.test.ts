import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useClinicalResultPrecautionsScope } from './useClinicalResultPrecautionsScope';
import { completeGeneratedPrecautions } from '../../clinical-result/precautionsFollowUp';
import { buildDiagnosisScopedPrecautions } from '../../clinical-result/outpatientRecord';

describe('useClinicalResultPrecautionsScope', () => {
  it('updates default review timing with selection and preserves a doctor removal', () => {
    const precautions = ref('记录家庭血压。');
    const scope = useClinicalResultPrecautionsScope({
      precautions,
      completeGeneratedPrecautions,
      buildScopedPrecautions: (diagnosisNames) => buildDiagnosisScopedPrecautions({
        chiefComplaint: '', historyOfPresentIllness: '', diagnosisNames,
      }),
    });
    scope.captureGeneratedPrecautions(['高血压']);
    expect(precautions.value).toContain('建议1个月内复诊');
    scope.syncToSelectedDiagnoses(['急性上呼吸道感染']);
    expect(precautions.value).toContain('建议3天内复诊');
    scope.syncToSelectedDiagnoses(['高血压']);
    expect(precautions.value).toBe('建议1个月内复诊，复查相关指标。记录家庭血压。');
    // 同次流的后到健康指导仍须收敛到当前已选诊断，不能被当成手工改稿。
    scope.captureGeneratedPrecautions(['高血压', '急性胃肠炎'], '监测血压，注意饮食卫生。');
    scope.syncToSelectedDiagnoses(['高血压']);
    expect(precautions.value).toContain('建议1个月内复诊');
    expect(precautions.value).not.toContain('建议3天内复诊');
    precautions.value = '记录家庭血压。';
    expect(scope.syncToSelectedDiagnoses(['糖尿病']).preservedManualEdit).toBe(true);
    expect(precautions.value).toBe('记录家庭血压。');
  });
  it('rebuilds generated precautions from selected formal diagnoses only', () => {
    const precautions = ref('膀胱炎健康教育');
    const setSystemBaseline = vi.fn();
    const scope = useClinicalResultPrecautionsScope({
      precautions,
      buildScopedPrecautions: (names) => `scoped:${names.join(',')}`,
      setSystemBaseline,
    });

    scope.captureGeneratedPrecautions(['输尿管结石', '膀胱炎']);
    const result = scope.syncToSelectedDiagnoses(['输尿管结石']);

    expect(result.updated).toBe(true);
    expect(result.preservedManualEdit).toBe(false);
    expect(precautions.value).toBe('scoped:输尿管结石');
    expect(setSystemBaseline).toHaveBeenLastCalledWith('scoped:输尿管结石');
  });

  it('restores the generated source when all source diagnoses are selected', () => {
    const precautions = ref('高血压与糖尿病联合教育');
    const scope = useClinicalResultPrecautionsScope({
      precautions,
      buildScopedPrecautions: (names) => `scoped:${names.join(',')}`,
    });

    scope.captureGeneratedPrecautions(['高血压', '糖尿病']);
    scope.syncToSelectedDiagnoses(['高血压']);
    scope.syncToSelectedDiagnoses(['糖尿病', '高血压']);

    expect(precautions.value).toBe('高血压与糖尿病联合教育');
  });

  it('preserves a doctor edit when diagnosis selection changes', () => {
    const precautions = ref('系统文案');
    const scope = useClinicalResultPrecautionsScope({
      precautions,
      buildScopedPrecautions: (names) => `scoped:${names.join(',')}`,
    });

    scope.captureGeneratedPrecautions(['急性上呼吸道感染']);
    precautions.value = '医生手工修改后的注意事项';
    const result = scope.syncToSelectedDiagnoses(['急性胃肠炎']);

    expect(result.updated).toBe(false);
    expect(result.preservedManualEdit).toBe(true);
    expect(precautions.value).toBe('医生手工修改后的注意事项');
  });
});
