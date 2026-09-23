import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import { useClinicalResultIntentReset } from './useClinicalResultIntentReset';

describe('useClinicalResultIntentReset', () => {
  it('maps healthEducation into outpatient precautions when no explicit record value exists', () => {
    const precautions = ref('');
    const menstrualHistory = ref('');
    const setInitialRecordSnapshot = vi.fn();
    const controller = useClinicalResultIntentReset({
      suppressDiagnosisTreatmentRefetch: ref(false),
      lastTreatmentDiagnosisKey: ref(''),
      chiefComplaint: ref(''),
      historyOfPresentIllness: ref(''),
      pastMedicalHistory: ref(''),
      personalHistory: ref(''),
      menstrualHistory,
      maritalReproductiveHistory: ref(''),
      familyHistory: ref(''),
      physicalExam: ref(''),
      precautions,
      diagnoses: ref<Diagnosis[]>([]),
      treatments: ref<TreatmentRecommendation[]>([]),
      resetTreatmentEditorState: vi.fn(),
      closeRelatedDropdown: vi.fn(),
      closeManualMatch: vi.fn(),
      closeRecommendationFeedback: vi.fn(),
      closeSessionFeedback: vi.fn(),
      resetWritebackState: vi.fn(),
      resetDiagnosisSelection: vi.fn(),
      resetFirstUserLogSnapshot: vi.fn(),
      setInitialRecordSnapshot,
    });

    controller.resetForIntent({
      chiefComplaint: '糖尿病复诊配药',
      historyOfPresentIllness: '患者既往确诊糖尿病，今复诊配药。',
      healthEducation: '按医嘱规律服药并监测血糖；出现低血糖不适时及时复诊。',
      menstrualHistory: '周期28天，经期5天。',
      diagnoses: [{ name: '糖尿病' }],
    });

    expect(precautions.value).toBe('建议1个月内复诊，复查相关指标。按医嘱规律服药并监测血糖；出现低血糖不适时及时复诊。');
    expect(menstrualHistory.value).toBe('周期28天，经期5天。');
    expect(setInitialRecordSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      precautions: '建议1个月内复诊，复查相关指标。按医嘱规律服药并监测血糖；出现低血糖不适时及时复诊。',
    }));
  });
});
