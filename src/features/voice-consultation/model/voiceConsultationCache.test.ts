// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import {
  getVoiceConsultationEditorSnapshot,
  persistVoiceConsultationCacheEntry,
  updateVoiceConsultationCache,
  type VoiceConsultationCacheEntry,
} from './voiceConsultationCache';

const patient: AppPatient = {
  identity: { patientId: 'patient-1', visitId: 'visit-1' },
  demographics: { patientName: 'test' }, clinical: {},
  patientId: 'patient-1', patientName: 'test', visitId: 'visit-1',
};
const base: VoiceConsultationCacheEntry = {
  consultationId: 'visit-1', transcribedText: 'test', savedAt: 0,
  intentResult: {
    chiefComplaint: '', historyOfPresentIllness: '', pastMedicalHistory: '',
    allergyHistory: '', currentMedicationHistory: '', familyHistory: '', symptoms: [], negativeSymptoms: [],
    diagnoses: [], treatments: [], treatmentPlan: '', healthEducation: '',
  },
};

describe('voice editor snapshot cache scope', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22, 10));
    persistVoiceConsultationCacheEntry({ ...base, savedAt: Date.now() });
  });
  afterEach(() => vi.useRealTimers());

  it('persists the round and completed empty treatment result with edited record fields', () => {
    updateVoiceConsultationCache(patient, {
      consultationRoundId: 'round-1', chiefComplaint: 'edited',
      treatments: [], treatmentDiagnosisKey: 'diagnosis-1',
    });
    expect(getVoiceConsultationEditorSnapshot(patient)).toMatchObject({
      consultationRoundId: 'round-1', chiefComplaint: 'edited',
      treatments: [], treatmentDiagnosisKey: 'diagnosis-1',
    });
  });

  it('does not restore another visit or patient', () => {
    updateVoiceConsultationCache(patient, { consultationRoundId: 'round-1', treatments: [] });
    expect(getVoiceConsultationEditorSnapshot({ ...patient, visitId: 'visit-2' })).toBeNull();
    expect(getVoiceConsultationEditorSnapshot({
      ...patient, patientId: 'patient-2', visitId: 'visit-3',
      identity: { patientId: 'patient-2', visitId: 'visit-3' },
    })).toBeNull();
  });

  it('expires the editor snapshot across local calendar days', () => {
    updateVoiceConsultationCache(patient, { consultationRoundId: 'round-1', treatments: [] });
    vi.setSystemTime(new Date(2026, 8, 23, 0, 1));
    expect(getVoiceConsultationEditorSnapshot(patient)).toBeNull();
  });
});
