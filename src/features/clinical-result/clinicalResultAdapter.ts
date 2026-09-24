import { toRaw } from 'vue';
import type { AppPatient } from '@/types/appState';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type {
  ClinicalResultDiagnosis,
  ClinicalResultInput,
  ClinicalResultMatchedTreatment,
  ClinicalResultTreatment,
} from './clinicalResultContract';
import {
  getPatientContextAllergyHistory,
  getPatientContextAgeText,
  getPatientContextGenderText,
  getPatientContextMenstrualHistory,
  getPatientContextMaritalReproductiveHistory,
  getPatientContextPastMedicalHistory,
} from '@/utils/patientContext';
import { getDiagnosisKey, getStandardDiagnosisId } from './recordConfirmedPayload';
import { buildOutpatientRecord } from './outpatientRecord';
import { isFemaleHistoryEligible } from './lib/femaleHistoryEligibility';

export interface ClinicalResultRecordInput {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  currentMedicationHistory?: string;
  familyHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  maritalReproductiveHistory?: string;
  physicalExam?: string;
  precautions?: string;
  vitals?: string;
}

export interface SymptomClinicalResultInput {
  patient?: AppPatient;
  record: {
    chiefComplaint: string;
    historyOfPresentIllness: string;
    tcmFourExaminations?: string;
    pastMedicalHistory?: string;
    allergyHistory?: string;
    currentMedicationHistory?: string;
    familyHistory?: string;
    personalHistory?: string;
    menstrualHistory?: string;
    maritalReproductiveHistory?: string;
    physicalExam?: string;
    precautions?: string;
    vitals?: string;
  };
  diagnoses: Diagnosis[];
  selectedDiagnosis?: Diagnosis | null;
  treatments: TreatmentRecommendation[];
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(toRaw(value))) as T;
  } catch {
    return value;
  }
}

function mergeHistoryOfPresentIllness(history: string, tcmFourExaminations?: string): string {
  const normalizedHistory = (history || '').trim();
  const normalizedTcm = (tcmFourExaminations || '').trim();
  if (!normalizedTcm) {
    return normalizedHistory;
  }
  return normalizedHistory
    ? `${normalizedHistory}\n\n中医四诊：${normalizedTcm}`
    : `中医四诊：${normalizedTcm}`;
}

function mapDiagnosisToClinicalInput(diag: Diagnosis): ClinicalResultDiagnosis {
  const copied = cloneValue(diag);
  const standardId = getStandardDiagnosisId(copied);
  return {
    ...copied,
    matchedItem: standardId
      ? {
          id: standardId,
          code: copied.code || '',
          name: copied.name,
        }
      : undefined,
  };
}

function mapTreatmentType(type: TreatmentRecommendation['type']): ClinicalResultMatchedTreatment['type'] {
  if (type === 'exam') return 'examination';
  if (type === 'lab_test') return 'labTest';
  if (type === 'acupuncture') return 'procedure';
  return type;
}

function mapTreatmentToClinicalInput(item: TreatmentRecommendation): ClinicalResultTreatment {
  const copied = cloneValue(item);
  return {
    ...copied,
    type: mapTreatmentType(copied.type),
    name: copied.name,
    text: copied.reason || copied.evidenceText || '',
    evidenceText: copied.evidenceText || copied.reason || '',
    usage: copied.route || copied.usage || '',
    usageKey: copied.routeKey || '',
    sourceType: copied.sourceType || 'explicit',
    matchStatus: copied.matchStatus || (copied.matchedItem ? 'exact' : copied.suggestedMatchItem ? 'probable' : 'unmatched'),
    matchedItem: copied.matchedItem ? cloneValue(copied.matchedItem) : undefined,
    suggestedMatchItem: copied.suggestedMatchItem ? cloneValue(copied.suggestedMatchItem) : undefined,
  };
}

export function buildSymptomClinicalResultInput(input: SymptomClinicalResultInput): ClinicalResultInput {
  const seen = new Set<string>();
  const diagnoses: ClinicalResultDiagnosis[] = [];
  for (const diag of [input.selectedDiagnosis, ...input.diagnoses]) {
    const key = getDiagnosisKey(diag);
    if (!diag || !key || seen.has(key)) continue;
    seen.add(key);
    diagnoses.push(mapDiagnosisToClinicalInput(diag));
  }

  const record = input.record;
  const chiefComplaint = record.chiefComplaint || '';
  const historyOfPresentIllness = mergeHistoryOfPresentIllness(
    record.historyOfPresentIllness || '',
    record.tcmFourExaminations,
  );
  const pastMedicalHistory =
    record.pastMedicalHistory
    || getPatientContextPastMedicalHistory(input.patient)
    || '';
  const allergyHistory =
    record.allergyHistory
    || getPatientContextAllergyHistory(input.patient)
    || '';
  const familyHistory = record.familyHistory || '';
  const patientGender = getPatientContextGenderText(input.patient);
  const includeFemaleHistory = isFemaleHistoryEligible({
    gender: patientGender,
    ageText: getPatientContextAgeText(input.patient),
    ageYears: input.patient?.ageYears ?? input.patient?.demographics?.ageYears,
  });
  const menstrualHistory = includeFemaleHistory
    ? record.menstrualHistory || getPatientContextMenstrualHistory(input.patient) || ''
    : '';
  const maritalReproductiveHistory = includeFemaleHistory
    ? record.maritalReproductiveHistory || getPatientContextMaritalReproductiveHistory(input.patient) || ''
    : '';
  return {
    chiefComplaint,
    historyOfPresentIllness,
    pastMedicalHistory,
    allergyHistory,
    currentMedicationHistory: record.currentMedicationHistory || '',
    ...(menstrualHistory ? { menstrualHistory } : {}),
    ...(maritalReproductiveHistory ? { maritalReproductiveHistory } : {}),
    familyHistory,
    symptoms: [],
    negativeSymptoms: [],
    diagnoses,
    treatments: input.treatments.map(mapTreatmentToClinicalInput),
    treatmentPlan: '',
    healthEducation: '',
    outpatientRecord: buildOutpatientRecord({
      chiefComplaint,
      historyOfPresentIllness,
      pastMedicalHistory,
      allergyHistory,
      personalHistory: record.personalHistory,
      menstrualHistory,
      maritalReproductiveHistory,
      familyHistory,
      physicalExam: record.physicalExam,
      precautions: record.precautions,
      vitals: record.vitals,
      diagnosisNames: diagnoses.map((item) => item.name),
      patientGender,
    }),
  };
}

export function cloneClinicalResultInput(result: ClinicalResultInput): ClinicalResultInput {
  return {
    ...result,
    diagnoses: result.diagnoses.map((item) => cloneValue(item) as ClinicalResultDiagnosis),
    treatments: result.treatments.map((item) => cloneValue(item) as ClinicalResultTreatment),
    factSuggestions: result.factSuggestions?.map((item) => cloneValue(item) as typeof item),
  };
}
