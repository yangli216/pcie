// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import {
  getVoiceConsultationEditorSnapshot,
  getVoiceConsultationCacheKey, getVoiceConsultationCacheScope,
  persistVoiceConsultationCacheEntry,
  updateVoiceConsultationCache,
  type VoiceConsultationCacheEntry,
} from './voiceConsultationCache';

const patient: AppPatient = {
  identity: { patientId: 'patient-1', visitId: 'visit-1' },
  demographics: { patientName: 'test' }, clinical: {},
  patientId: 'patient-1', patientName: 'test', visitId: 'visit-1',
};
const his = vi.hoisted(() => ({ orgCode: '合成机构', tenantId: '合成租户' }));
vi.mock('@/services/his', () => ({ getHisAdapter: () => ({ getContextScope: () => his }) }));
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
    his.orgCode = '合成机构';
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 22, 10));
    persistVoiceConsultationCacheEntry({ ...base, ownerScope: getVoiceConsultationCacheScope(patient), savedAt: Date.now() });
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

  it('isolates a reused visit across patients and institutions and can still restore the original owner', () => {
    updateVoiceConsultationCache(patient, { chiefComplaint: '合成医生修订' });
    expect(getVoiceConsultationEditorSnapshot({ ...patient, patientId: '另一患者' })).toBeNull();
    his.orgCode = '另一机构';
    expect(getVoiceConsultationEditorSnapshot(patient)).toBeNull();
    his.orgCode = '合成机构';
    expect(getVoiceConsultationEditorSnapshot(patient)?.chiefComplaint).toBe('合成医生修订');
  });

  it('restores an older storage key only with verifiable ownership, leaving unidentified records in storage', () => {
    localStorage.clear();
    const key = getVoiceConsultationCacheKey('visit-1');
    const record = { ...base, savedAt: Date.now(), editorSnapshot: { chiefComplaint: '旧草稿' } };
    localStorage.setItem(key, JSON.stringify(record));
    expect(getVoiceConsultationEditorSnapshot(patient)).toBeNull();
    expect(localStorage.getItem(key)).toBeTruthy();
    localStorage.setItem(key, JSON.stringify({ ...record, ownerScope: getVoiceConsultationCacheScope(patient) }));
    expect(getVoiceConsultationEditorSnapshot(patient)?.chiefComplaint).toBe('旧草稿');
  });

  it('expires the editor snapshot across local calendar days', () => {
    updateVoiceConsultationCache(patient, { consultationRoundId: 'round-1', treatments: [] });
    vi.setSystemTime(new Date(2026, 8, 23, 0, 1));
    expect(getVoiceConsultationEditorSnapshot(patient)).toBeNull();
  });
});
