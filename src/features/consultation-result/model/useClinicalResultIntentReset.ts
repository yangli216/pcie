import type { Ref } from 'vue';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import { completeGeneratedPrecautions } from '../../clinical-result/precautionsFollowUp';
import {
  buildOutpatientRecord,
  type OutpatientRecord,
} from '../../clinical-result/outpatientRecord';

export interface ClinicalResultIntentRecordInput {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  familyHistory?: string;
  physicalExam?: string;
  precautions?: string;
  healthEducation?: string;
  vitals?: string;
  outpatientRecord?: Partial<OutpatientRecord>;
  diagnoses?: Array<Pick<Diagnosis, 'name'>>;
}

export interface ClinicalResultIntentResetRecordSnapshot {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  personalHistory: string;
  menstrualHistory: string;
  familyHistory: string;
  physicalExam: string;
  precautions: string;
}

export interface ClinicalResultIntentResetOptions {
  suppressDiagnosisTreatmentRefetch: Ref<boolean>;
  lastTreatmentDiagnosisKey: Ref<string>;
  chiefComplaint: Ref<string>;
  historyOfPresentIllness: Ref<string>;
  pastMedicalHistory: Ref<string>;
  personalHistory: Ref<string>;
  menstrualHistory: Ref<string>;
  familyHistory: Ref<string>;
  physicalExam: Ref<string>;
  precautions: Ref<string>;
  diagnoses: Ref<Diagnosis[]>;
  treatments: Ref<TreatmentRecommendation[]>;
  resetTreatmentEditorState: () => void;
  closeRelatedDropdown: () => void;
  closeManualMatch: () => void;
  closeRecommendationFeedback: () => void;
  closeSessionFeedback: () => void;
  resetWritebackState: () => void;
  resetDiagnosisSelection: () => void;
  resetFirstUserLogSnapshot: () => void;
  setInitialRecordSnapshot: (snapshot: ClinicalResultIntentResetRecordSnapshot) => void;
}

export function buildClinicalResultIntentRecordSnapshot(
  input: ClinicalResultIntentRecordInput,
  chronicFollowUp = false,
): ClinicalResultIntentResetRecordSnapshot {
  const outpatientRecord = buildOutpatientRecord({
    chronicFollowUp,
    chiefComplaint: input.outpatientRecord?.chiefComplaint || input.chiefComplaint || '',
    historyOfPresentIllness: input.outpatientRecord?.historyOfPresentIllness || input.historyOfPresentIllness || '',
    pastMedicalHistory: input.outpatientRecord?.pastMedicalHistory || input.pastMedicalHistory,
    allergyHistory: input.allergyHistory,
    personalHistory: input.outpatientRecord?.personalHistory || input.personalHistory,
    menstrualHistory: input.outpatientRecord?.menstrualHistory || input.menstrualHistory,
    familyHistory: input.outpatientRecord?.familyHistory || input.familyHistory,
    physicalExam: input.outpatientRecord?.physicalExam || input.physicalExam,
    precautions: input.outpatientRecord?.precautions || input.precautions || input.healthEducation,
    vitals: input.vitals,
    diagnosisNames: (input.diagnoses || []).map((item) => item.name).filter(Boolean),
  });

  return {
    ...outpatientRecord,
    precautions: completeGeneratedPrecautions(
      outpatientRecord.precautions,
      (input.diagnoses || []).map((item) => item.name),
      chronicFollowUp,
    ),
    menstrualHistory: outpatientRecord.menstrualHistory || '',
  };
}

export function useClinicalResultIntentReset(options: ClinicalResultIntentResetOptions) {
  function resetForIntent(input: ClinicalResultIntentRecordInput, chronicFollowUp = false): void {
    options.suppressDiagnosisTreatmentRefetch.value = true;

    options.resetTreatmentEditorState();
    options.lastTreatmentDiagnosisKey.value = '';
    options.closeRelatedDropdown();
    options.closeManualMatch();
    options.closeRecommendationFeedback();
    options.closeSessionFeedback();
    options.resetWritebackState();
    options.diagnoses.value = [];
    options.resetDiagnosisSelection();
    options.treatments.value = [];
    options.resetFirstUserLogSnapshot();

    const snapshot = buildClinicalResultIntentRecordSnapshot(input, chronicFollowUp);
    options.setInitialRecordSnapshot(snapshot);
    options.chiefComplaint.value = snapshot.chiefComplaint;
    options.historyOfPresentIllness.value = snapshot.historyOfPresentIllness;
    options.pastMedicalHistory.value = snapshot.pastMedicalHistory;
    options.personalHistory.value = snapshot.personalHistory;
    options.menstrualHistory.value = snapshot.menstrualHistory;
    options.familyHistory.value = snapshot.familyHistory;
    options.physicalExam.value = snapshot.physicalExam;
    options.precautions.value = snapshot.precautions;
  }

  return {
    resetForIntent,
  };
}

export type ClinicalResultIntentReset = ReturnType<typeof useClinicalResultIntentReset>;
