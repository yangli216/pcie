import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type { ClinicalResultRecommendationType } from '@features/clinical-result';
import {
  useTreatmentSections,
  type TreatmentSectionGenerationStatus,
} from './useTreatmentSections';

function treatment(type: TreatmentRecommendation['type'], name: string): TreatmentRecommendation {
  return { type, name, reason: 'test' };
}

describe('useTreatmentSections', () => {
  it('keeps fixed treatment order while representing the joint exam/lab task once', () => {
    const treatments = ref<TreatmentRecommendation[]>([
      treatment('exam', '头颅 CT'),
    ]);
    const generationStates = ref<Record<
      ClinicalResultRecommendationType,
      TreatmentSectionGenerationStatus
    >>({
      medicine: 'loading',
      exam: 'ready',
      lab_test: 'loading',
      procedure: 'skipped',
    });
    const controller = useTreatmentSections({
      treatments,
      selectedDiagnosis: ref<Diagnosis | null>({ code: 'R42', name: '头晕', rate: '高', rationale: '' }),
      isRefreshNeeded: ref(false),
      getLastTreatmentDiagnosisKey: () => '',
      generationStates,
      showGenerationPlaceholders: ref(true),
    });

    expect(controller.treatmentPresentationRows.value.map((row) => row.type)).toEqual([
      'medicine', 'lab_test', 'exam',
    ]);
    expect(controller.treatmentPresentationRows.value.map((row) => row.presentationKey)).toEqual([
      'medicine', 'auxiliary-generation', 'exam',
    ]);
    expect(controller.treatmentPresentationRows.value.map((row) => row.placeholder)).toEqual([
      'loading', 'loading', null,
    ]);
    expect(controller.treatmentPresentationRows.value[1].title).toBe('检验项目');

    treatments.value.push(treatment('medicine', '倍他司汀片'));
    generationStates.value.medicine = 'ready';
    expect(controller.treatmentPresentationRows.value.map((row) => row.type)).toEqual([
      'medicine', 'lab_test', 'exam',
    ]);
    expect(controller.treatmentPresentationRows.value[0].items[0].name).toBe('倍他司汀片');
  });

  it('shows one joint auxiliary placeholder while explicit items are already visible', () => {
    const treatments = ref<TreatmentRecommendation[]>([
      { ...treatment('lab_test', '血常规'), sourceType: 'explicit' },
    ]);
    const generationStates = ref<Record<
      ClinicalResultRecommendationType,
      TreatmentSectionGenerationStatus
    >>({
      medicine: 'ready',
      exam: 'loading',
      lab_test: 'loading',
      procedure: 'skipped',
    });
    const controller = useTreatmentSections({
      treatments,
      selectedDiagnosis: ref<Diagnosis | null>({ code: 'J06.9', name: '急性上呼吸道感染', rate: '高', rationale: '' }),
      isRefreshNeeded: ref(false),
      getLastTreatmentDiagnosisKey: () => '',
      generationStates,
      showGenerationPlaceholders: ref(true),
    });

    expect(controller.treatmentPresentationRows.value.map((row) => row.presentationKey)).toEqual([
      'auxiliary-generation', 'lab_test',
    ]);
    expect(controller.treatmentPresentationRows.value[0]).toMatchObject({
      title: '检查与检验',
      placeholder: 'loading',
    });
    expect(controller.treatmentPresentationRows.value.filter((row) => row.placeholder)).toHaveLength(1);

    treatments.value = [
      treatment('exam', '胸部 CT'),
      treatment('lab_test', '血常规'),
    ];
    generationStates.value.exam = 'ready';
    generationStates.value.lab_test = 'ready';
    expect(controller.treatmentPresentationRows.value.map((row) => row.presentationKey)).toEqual([
      'exam', 'lab_test',
    ]);
    expect(controller.treatmentPresentationRows.value.every((row) => row.placeholder === null)).toBe(true);
  });

  it('does not add generation placeholders to channels that did not opt in', () => {
    const controller = useTreatmentSections({
      treatments: ref<TreatmentRecommendation[]>([]),
      selectedDiagnosis: ref<Diagnosis | null>(null),
      isRefreshNeeded: ref(false),
      getLastTreatmentDiagnosisKey: () => '',
      generationStates: ref({
        medicine: 'loading',
        exam: 'loading',
        lab_test: 'loading',
        procedure: 'loading',
      }),
      showGenerationPlaceholders: ref(false),
    });

    expect(controller.treatmentPresentationRows.value).toEqual([]);
  });

  it('keeps failed branches visible with a retryable error instead of an empty state', () => {
    const controller = useTreatmentSections({
      treatments: ref<TreatmentRecommendation[]>([]),
      selectedDiagnosis: ref<Diagnosis | null>({ code: 'J06.9', name: '急性上呼吸道感染', rate: '高', rationale: '' }),
      isRefreshNeeded: ref(false),
      getLastTreatmentDiagnosisKey: () => '',
      generationStates: ref({
        medicine: 'error', exam: 'error', lab_test: 'error', procedure: 'skipped',
      }),
      showGenerationPlaceholders: ref(true),
    });

    expect(controller.treatmentPresentationRows.value).toHaveLength(2);
    expect(controller.treatmentPresentationRows.value[0]).toMatchObject({
      type: 'medicine', placeholder: 'error',
    });
    expect(controller.treatmentPresentationRows.value[1]).toMatchObject({
      presentationKey: 'auxiliary-generation', placeholder: 'error',
    });
  });
});
