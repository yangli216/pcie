import type { Diagnosis } from '@/types/consultation';
import { mapClinicalResultAiDiagnoses } from '@features/clinical-result';
import type { DiagnosisCatalogAssessment } from '@services/diagnosisCatalogMatch';

export interface DiagnosisCatalogMatch {
  id: string;
  code: string;
  name: string;
}

export interface TcmSyndromeCatalogMatch {
  code: string;
  name: string;
}

export interface TcmTreatmentCatalogMatch {
  code: string;
  name: string;
}

export interface BuildDiagnosisRecommendationsInput {
  rawDiagnoses: Diagnosis[];
  mode: 'western' | 'tcm';
  assessDiagnosis: (
    queryName: string,
    context?: { icdCode?: string },
  ) => DiagnosisCatalogAssessment<DiagnosisCatalogMatch>;
  matchTCMDiagnosis: (query: string) => DiagnosisCatalogMatch | null;
  matchTCMSyndrome: (query: string) => TcmSyndromeCatalogMatch | null;
  matchTCMTreatment: (query: string) => TcmTreatmentCatalogMatch | null;
}

function parseRatePercent(rate: string | undefined): number {
  return parseFloat((rate || '').replace('%', '')) || 0;
}

function buildWesternDiagnosis(
  diagnosis: Diagnosis,
  assessDiagnosis: BuildDiagnosisRecommendationsInput['assessDiagnosis'],
): Diagnosis {
  return mapClinicalResultAiDiagnoses({
    rawDiagnoses: [diagnosis],
    assessDiagnosis,
    clearUnmatchedId: true,
  })[0];
}

function buildTCMDiagnosis(
  diagnosis: Diagnosis,
  index: number,
  input: BuildDiagnosisRecommendationsInput,
): Diagnosis {
  const matched =
    input.matchTCMDiagnosis(diagnosis.code)
    || input.matchTCMDiagnosis(diagnosis.name);

  const result: Diagnosis = {
    ...diagnosis,
    isTCM: true,
  };

  if (matched) {
    result.id = matched.id;
    result.code = matched.code;
    result.name = matched.name;
    result.originalName = diagnosis.name;
  } else {
    result.id = undefined;
    result.code = diagnosis.code || `TCM${String(index + 1).padStart(3, '0')}`;
  }

  if (diagnosis.syndrome) {
    const syndromeMatch = input.matchTCMSyndrome(diagnosis.syndrome);
    if (syndromeMatch) {
      result.syndrome = syndromeMatch.name;
      result.syndromeCode = syndromeMatch.code;
      result.syndromeMatched = true;
    } else {
      result.syndrome = diagnosis.syndrome;
      result.syndromeMatched = false;
    }
  }

  if (diagnosis.treatment) {
    const treatmentMatch = input.matchTCMTreatment(diagnosis.treatment);
    if (treatmentMatch) {
      result.treatment = treatmentMatch.name;
      result.treatmentCode = treatmentMatch.code;
      result.treatmentMatched = true;
    } else {
      result.treatment = diagnosis.treatment;
      result.treatmentMatched = false;
    }
  }

  return result;
}

export function buildDiagnosisRecommendationsFromRaw(
  input: BuildDiagnosisRecommendationsInput,
): Diagnosis[] {
  const diagnoses = input.rawDiagnoses.map((diagnosis, index) => (
    input.mode === 'tcm'
      ? buildTCMDiagnosis(diagnosis, index, input)
      : buildWesternDiagnosis(diagnosis, input.assessDiagnosis)
  ));

  return diagnoses.sort((a, b) => parseRatePercent(b.rate) - parseRatePercent(a.rate));
}
