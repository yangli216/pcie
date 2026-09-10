import type { HisPatientHistory, HisPatientInfo } from '../services/his/types';
import type { Patient } from '../types/consultation';
import type { AppPatient, PatientContext } from '../types/appState';
import { formatPatientAgeText } from '@entities/patient/lib/patientAge';

type PatientSourceRecord = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function pickFirstText(source: PatientSourceRecord | null | undefined, keys: string[]): string {
  if (!source) {
    return '';
  }

  for (const key of keys) {
    const value = text(source[key]);
    if (value) {
      return value;
    }
  }

  return '';
}

function toRecord(value: unknown): PatientSourceRecord | null {
  return value && typeof value === 'object' ? value as PatientSourceRecord : null;
}

export function normalizePatientGenderCode(raw: unknown): 'M' | 'F' | 'O' | string | undefined {
  const value = text(raw);
  if (!value) {
    return undefined;
  }

  if (value === '1' || /^M$/i.test(value) || /^male$/i.test(value) || value.startsWith('男')) {
    return 'M';
  }

  if (value === '2' || /^F$/i.test(value) || /^female$/i.test(value) || value.startsWith('女')) {
    return 'F';
  }

  if (/^O$/i.test(value) || /^other$/i.test(value) || value === '未知') {
    return 'O';
  }

  return value;
}

export function normalizePatientGenderText(raw: unknown): string {
  const code = normalizePatientGenderCode(raw);
  if (code === 'M') return '男性';
  if (code === 'F') return '女性';
  if (code === 'O') return '未知';
  return text(raw);
}

function parseAgeYears(ageText: string, fallbackAge?: number): number | undefined {
  const match = ageText.match(/(\d+(?:\.\d+)?)\s*岁/u);
  if (match) {
    const parsed = Number.parseFloat(match[1]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (/(?:月|天|日)/u.test(ageText)) {
    return undefined;
  }

  return typeof fallbackAge === 'number' && Number.isFinite(fallbackAge)
    ? fallbackAge
    : undefined;
}

function buildAgeText(source: PatientSourceRecord | null, hisInfo?: HisPatientInfo | null): string {
  const hisAgeText = formatPatientAgeText(
    hisInfo?.ageText,
    hisInfo?.raw?.ageUnit,
  );
  if (hisAgeText) {
    return hisAgeText;
  }

  const sourceAgeText = pickFirstText(source, ['ageText']);
  if (sourceAgeText) {
    return formatPatientAgeText(sourceAgeText, pickFirstText(source, ['ageUnit']));
  }

  if (typeof hisInfo?.age === 'number' && Number.isFinite(hisInfo.age)) {
    return formatPatientAgeText(hisInfo.age, '岁');
  }

  const ageNum = pickFirstText(source, ['ageNum']);
  if (ageNum) {
    return formatPatientAgeText(ageNum, pickFirstText(source, ['ageUnit']));
  }

  const age = pickFirstText(source, ['age']);
  if (!age) {
    return '';
  }

  return formatPatientAgeText(age);
}

export function getPatientContextId(patient: AppPatient | null | undefined): string {
  return patient?.patientId || patient?.identity?.patientId || patient?.idPi || patient?.id || '';
}

export function getPatientContextVisitId(patient: AppPatient | null | undefined): string {
  return patient?.visitId || patient?.identity?.visitId || patient?.idVis || '';
}

export function getPatientContextName(patient: AppPatient | null | undefined): string {
  return patient?.patientName || patient?.demographics?.patientName || patient?.naPi || patient?.name || '';
}

export function getPatientContextGenderCode(patient: AppPatient | null | undefined): string {
  return normalizePatientGenderCode(
    patient?.genderCode
      || patient?.demographics?.genderCode
      || patient?.gender
      || patient?.sdSex
      || patient?.sdSexText
      || patient?.genderText
      || patient?.demographics?.genderText,
  ) || '';
}

export function getPatientContextGenderText(patient: AppPatient | null | undefined): string {
  return patient?.genderText || patient?.demographics?.genderText || patient?.sdSexText || normalizePatientGenderText(patient?.gender) || '';
}

export function getPatientContextAgeText(patient: AppPatient | null | undefined): string {
  if (patient?.ageText) {
    return patient.ageText;
  }

  if (patient?.demographics?.ageText) {
    return patient.demographics.ageText;
  }

  if (typeof patient?.age === 'number' && Number.isFinite(patient.age)) {
    return `${patient.age}岁`;
  }

  return text(patient?.age);
}

export function getPatientContextAnchorId(patient: AppPatient | null | undefined): string {
  return getPatientContextVisitId(patient) || getPatientContextId(patient);
}

export function getPatientContextPastMedicalHistory(patient: AppPatient | null | undefined): string {
  return patient?.pastMedicalHistory || patient?.clinical?.pastMedicalHistory || '';
}

export function getPatientContextAllergyHistory(patient: AppPatient | null | undefined): string {
  return patient?.allergyHistory || patient?.clinical?.allergyHistory || '';
}

export function getPatientContextCurrentMedicationHistory(patient: AppPatient | null | undefined): string {
  return patient?.currentMedicationHistory || patient?.clinical?.currentMedicationHistory || '';
}

export function getPatientContextPersonalHistory(patient: AppPatient | null | undefined): string {
  return patient?.personalHistory || patient?.clinical?.personalHistory || '';
}

export function extractMenstrualHistoryFromRecordText(value: unknown): string {
  const recordText = text(value).replace(/\r\n?/gu, '\n');
  if (!recordText) return '';

  const matched = recordText.match(
    /(?:^|[\n。；])\s*月经史\s*[：:]\s*([\s\S]*?)(?=(?:[\n。；]\s*(?:婚育史|个人史|家族史|既往史|体格检查|查体|注意事项|诊断)\s*[：:])|$)/u,
  );
  return matched?.[1]?.trim().replace(/[。；]+$/u, '') || '';
}

export function getPatientContextMenstrualHistory(patient: AppPatient | null | undefined): string {
  return patient?.menstrualHistory
    || patient?.clinical?.menstrualHistory
    || extractMenstrualHistoryFromRecordText(
      patient?.currentOutpatientRecordText || patient?.clinical?.currentOutpatientRecordText,
    );
}

export function getPatientContextFamilyHistory(patient: AppPatient | null | undefined): string {
  return patient?.familyHistory || patient?.clinical?.familyHistory || '';
}

export function getPatientContextHistory(patient: AppPatient | null | undefined): HisPatientHistory | null {
  return patient?.hisHistory || patient?.clinical?.hisHistory || patient?.patientHistory || null;
}

interface BuildPatientContextInput {
  existing?: AppPatient | null;
  payload?: Record<string, unknown> | null;
  hisInfo?: HisPatientInfo | null;
  hisHistory?: HisPatientHistory | null;
  overrides?: Partial<PatientContext>;
  source?: string;
  receptionEnsured?: boolean;
}

export function buildPatientContext(input: BuildPatientContextInput): AppPatient | null {
  const existing = input.existing || null;
  const payload = toRecord(input.payload);
  const incomingPatientId = input.hisInfo?.patientId
    || pickFirstText(payload, ['patientId', 'idPi', 'id']);
  const incomingVisitId = pickFirstText(payload, ['visitId', 'idVis']);
  const existingPatientId = getPatientContextId(existing);
  const existingVisitId = getPatientContextVisitId(existing);
  const canInheritExistingPatient = !incomingPatientId
    || !existingPatientId
    || incomingPatientId === existingPatientId;
  const canInheritExistingEncounter = canInheritExistingPatient
    && (!incomingVisitId || !existingVisitId || incomingVisitId === existingVisitId);
  const patientFallback = canInheritExistingPatient ? existing : null;
  const encounterFallback = canInheritExistingEncounter ? existing : null;
  const rawFallback = canInheritExistingEncounter ? existing?.raw : undefined;

  const patientId = incomingPatientId || getPatientContextId(patientFallback);

  if (!patientId) {
    return existing;
  }

  const visitId = incomingVisitId || getPatientContextVisitId(encounterFallback);
  const mpiId = pickFirstText(payload, ['idMpi']) || text(patientFallback?.identity?.mpiId || patientFallback?.idMpi);
  const tetId = pickFirstText(payload, ['idTet']) || text(patientFallback?.identity?.tetId || patientFallback?.idTet);
  const patientName = input.hisInfo?.name
    || pickFirstText(payload, ['patientName', 'naPi', 'name'])
    || getPatientContextName(patientFallback);

  const genderCode = input.hisInfo?.gender
    || normalizePatientGenderCode(pickFirstText(payload, ['gender', 'sdSexText', 'sdSex']))
    || normalizePatientGenderCode(patientFallback?.genderCode || patientFallback?.gender || patientFallback?.sdSexText);
  const genderText = normalizePatientGenderText(
    pickFirstText(payload, ['sdSexText', 'gender', 'sdSex']) || input.hisInfo?.gender || patientFallback?.genderText || patientFallback?.sdSexText,
  );
  const ageText = buildAgeText(payload, input.hisInfo) || getPatientContextAgeText(patientFallback);
  const ageYears = parseAgeYears(ageText, input.hisInfo?.age);
  const idCard = pickFirstText(payload, ['idCard', 'idNo']) || input.hisInfo?.idNo || text(patientFallback?.idCard);
  const mobilePhone = pickFirstText(payload, ['mobilePhone', 'phone']) || input.hisInfo?.mobilePhone || text(patientFallback?.mobilePhone);
  const insuranceType = pickFirstText(payload, ['insuranceType']) || input.hisInfo?.insuranceType || text(patientFallback?.insuranceType);

  const hisHistory = input.hisHistory ?? getPatientContextHistory(patientFallback);
  const pastMedicalHistory = pickFirstText(payload, ['pastMedicalHistory', 'past_medical_history', 'pastMedicalHistoryText'])
    || getPatientContextPastMedicalHistory(patientFallback);
  const allergyHistory = pickFirstText(payload, ['allergyHistory', 'allergy_history', 'allergyHistoryText'])
    || getPatientContextAllergyHistory(patientFallback);
  const currentMedicationHistory = pickFirstText(payload, ['currentMedicationHistory'])
    || text(encounterFallback?.currentMedicationHistory || encounterFallback?.clinical?.currentMedicationHistory);
  const currentOutpatientRecordText = pickFirstText(payload, ['currentOutpatientRecordText'])
    || text(encounterFallback?.currentOutpatientRecordText || encounterFallback?.clinical?.currentOutpatientRecordText);
  const personalHistory = pickFirstText(payload, ['personalHistory', 'personal_history', 'personalHistoryText'])
    || getPatientContextPersonalHistory(patientFallback);
  const menstrualHistory = pickFirstText(payload, ['menstrualHistory', 'menstrual_history', 'menstrualHistoryText'])
    || extractMenstrualHistoryFromRecordText(currentOutpatientRecordText)
    || getPatientContextMenstrualHistory(patientFallback);
  const familyHistory = pickFirstText(payload, ['familyHistory', 'family_history', 'familyHistoryText'])
    || getPatientContextFamilyHistory(patientFallback);
  const chiefComplaint = pickFirstText(payload, ['chiefComplaint'])
    || text(encounterFallback?.chiefComplaint || encounterFallback?.clinical?.chiefComplaint);
  const historyOfPresentIllness = pickFirstText(payload, ['historyOfPresentIllness'])
    || text(encounterFallback?.historyOfPresentIllness || encounterFallback?.clinical?.historyOfPresentIllness);
  const diagnosis = pickFirstText(payload, ['diagnosis'])
    || text(encounterFallback?.diagnosis || encounterFallback?.clinical?.diagnosis);
  const currentOutpatientRecordTitle = pickFirstText(payload, ['currentOutpatientRecordTitle'])
    || text(encounterFallback?.currentOutpatientRecordTitle || encounterFallback?.clinical?.currentOutpatientRecordTitle);
  const currentOutpatientRecordTime = pickFirstText(payload, ['currentOutpatientRecordTime'])
    || text(encounterFallback?.currentOutpatientRecordTime || encounterFallback?.clinical?.currentOutpatientRecordTime);
  const currentVitalSigns = encounterFallback?.currentVitalSigns || encounterFallback?.clinical?.currentVitalSigns;
  const receptionEnsured = input.receptionEnsured
    ?? patientFallback?.receptionEnsured
    ?? patientFallback?._receptionEnsured
    ?? false;
  const signed = input.hisInfo?.signed ?? patientFallback?.signed;

  const baseContext: PatientContext = {
    identity: {
      patientId,
      visitId: visitId || undefined,
      mpiId: mpiId || undefined,
      tetId: tetId || undefined,
    },
    demographics: {
      patientName: patientName || '未知患者',
      genderCode,
      genderText: genderText || undefined,
      ageText: ageText || undefined,
      ageYears,
      idCard: idCard || undefined,
      mobilePhone: mobilePhone || undefined,
      insuranceType: insuranceType || undefined,
    },
    clinical: {
      chiefComplaint: chiefComplaint || undefined,
      historyOfPresentIllness: historyOfPresentIllness || undefined,
      pastMedicalHistory: pastMedicalHistory || undefined,
      allergyHistory: allergyHistory || undefined,
      currentMedicationHistory: currentMedicationHistory || undefined,
      personalHistory: personalHistory || undefined,
      menstrualHistory: menstrualHistory || undefined,
      familyHistory: familyHistory || undefined,
      diagnosis: diagnosis || undefined,
      hisHistory,
      currentOutpatientRecordText: currentOutpatientRecordText || undefined,
      currentOutpatientRecordTitle: currentOutpatientRecordTitle || undefined,
      currentOutpatientRecordTime: currentOutpatientRecordTime || undefined,
      currentVitalSigns,
    },
    receptionEnsured,
    signed,
    source: input.source || patientFallback?.source,
    raw: {
      ...(rawFallback || {}),
      ...(payload || {}),
      ...(input.hisInfo?.raw || {}),
    },

    patientId,
    visitId: visitId || undefined,
    patientName: patientName || '未知患者',
    genderCode,
    genderText: genderText || undefined,
    ageText: ageText || undefined,
    ageYears,
    idCard: idCard || undefined,
    mobilePhone: mobilePhone || undefined,
    insuranceType: insuranceType || undefined,
    chiefComplaint: chiefComplaint || undefined,
    historyOfPresentIllness: historyOfPresentIllness || undefined,
    pastMedicalHistory: pastMedicalHistory || undefined,
    allergyHistory: allergyHistory || undefined,
    currentMedicationHistory: currentMedicationHistory || undefined,
    personalHistory: personalHistory || undefined,
    menstrualHistory: menstrualHistory || undefined,
    familyHistory: familyHistory || undefined,
    diagnosis: diagnosis || undefined,
    hisHistory,
    currentOutpatientRecordText: currentOutpatientRecordText || undefined,
    currentOutpatientRecordTitle: currentOutpatientRecordTitle || undefined,
    currentOutpatientRecordTime: currentOutpatientRecordTime || undefined,
    currentVitalSigns,

    id: text(patientFallback?.id) || patientId,
    idTet: tetId || undefined,
    idPi: patientId,
    idMpi: mpiId || undefined,
    idVis: visitId || undefined,
    piOi: text(patientFallback?.piOi),
    name: patientName || '未知患者',
    naPi: patientName || '未知患者',
    gender: genderCode,
    sdSexText: genderText || undefined,
    age: ageYears ?? (ageText || undefined),
    patientHistory: hisHistory,
    _receptionEnsured: receptionEnsured,
  };

  const overrides = input.overrides || {};
  const context: PatientContext = {
    ...baseContext,
    ...overrides,
    clinical: {
      ...baseContext.clinical,
      ...(overrides.clinical || {}),
    },
  };

  return context;
}

export function toConsultationPatient(context: AppPatient | null | undefined): Patient {
  const ageText = getPatientContextAgeText(context);
  const ageYears = typeof context?.ageYears === 'number' ? context.ageYears : undefined;

  return {
    idTet: context?.idTet,
    idPi: getPatientContextId(context) || undefined,
    idMpi: context?.idMpi,
    naPi: getPatientContextName(context),
    sdSex: getPatientContextGenderCode(context),
    idCard: context?.idCard,
    mobilePhone: context?.mobilePhone,
    ageNum: ageYears,
    ageUnit: ageYears != null ? '岁' : undefined,
    ageText: ageText || undefined,
    sdSexText: getPatientContextGenderText(context) || undefined,
    allergyHistory: getPatientContextAllergyHistory(context) || undefined,
    chiefComplaint: context?.chiefComplaint || context?.clinical?.chiefComplaint,
    historyOfPresentIllness: context?.historyOfPresentIllness || context?.clinical?.historyOfPresentIllness,
    pastMedicalHistory: context?.pastMedicalHistory || context?.clinical?.pastMedicalHistory,
    currentMedicationHistory: context?.currentMedicationHistory || context?.clinical?.currentMedicationHistory,
    diagnosis: context?.diagnosis || context?.clinical?.diagnosis,
  };
}
