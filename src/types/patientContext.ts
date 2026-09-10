import type { HisPatientHistory, HisVisitVitalSigns } from '../services/his/types';

export interface PatientContextIdentity {
  patientId: string;
  visitId?: string;
  mpiId?: string;
  tetId?: string;
}

export interface PatientContextDemographics {
  patientName: string;
  genderCode?: 'M' | 'F' | 'O' | string;
  genderText?: string;
  ageText?: string;
  ageYears?: number;
  idCard?: string;
  mobilePhone?: string;
  insuranceType?: string;
}

export interface PatientContextClinical {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  currentMedicationHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  familyHistory?: string;
  diagnosis?: string;
  hisHistory?: HisPatientHistory | null;
  currentOutpatientRecordText?: string;
  currentOutpatientRecordTitle?: string;
  currentOutpatientRecordTime?: string;
  currentVitalSigns?: HisVisitVitalSigns;
}

export interface PatientContext {
  identity: PatientContextIdentity;
  demographics: PatientContextDemographics;
  clinical: PatientContextClinical;
  receptionEnsured?: boolean;
  /** HIS 明确返回的当前签约状态；未返回时保持 undefined。 */
  signed?: boolean;
  source?: string;
  raw?: Record<string, unknown>;

  // Transitional flat fields for existing modules.
  patientId: string;
  visitId?: string;
  patientName: string;
  genderCode?: 'M' | 'F' | 'O' | string;
  genderText?: string;
  ageText?: string;
  ageYears?: number;
  idCard?: string;
  mobilePhone?: string;
  insuranceType?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  currentMedicationHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  familyHistory?: string;
  diagnosis?: string;
  hisHistory?: HisPatientHistory | null;
  currentOutpatientRecordText?: string;
  currentOutpatientRecordTitle?: string;
  currentOutpatientRecordTime?: string;
  currentVitalSigns?: HisVisitVitalSigns;

  // Legacy aliases to keep current call sites compiling during migration.
  id?: string;
  idTet?: string;
  idPi?: string;
  idMpi?: string;
  idVis?: string;
  piOi?: string;
  name?: string;
  naPi?: string;
  gender?: 'M' | 'F' | 'O' | string;
  sdSexText?: string;
  age?: number | string;
  patientHistory?: HisPatientHistory | null;
  _receptionEnsured?: boolean;
  [key: string]: unknown;
}
