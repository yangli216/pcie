import { regionalPost } from '@services/regionalClient';
import { medicalDataService } from '@/services/medicalData';
import { getHisAdapter } from '@/services/his';
import type { AppPatient } from '@/types/appState';
import { getPatientContextId, getPatientContextVisitId } from '@/utils/patientContext';
import type { ChronicRefillCandidate } from '../lib/chronicRefillAssessment';
import { buildChronicExaminationReminders, type ChronicExaminationRecommendation } from '../lib/chronicExaminationReminders';

interface RecommendationResponse {
  patientId: string;
  visitId: string;
  source: 'getUserInfo';
  recommendations: ChronicExaminationRecommendation[];
  regionalHistory: { status: 'not_connected'; records: [] };
}

export async function loadChronicExaminationRecommendations(patient: AppPatient, candidate: ChronicRefillCandidate) {
  const patientId = getPatientContextId(patient);
  const visitId = getPatientContextVisitId(patient);
  const idCard = patient.demographics?.idCard || patient.idCard || '';
  const hasIdentity = Boolean(patientId && visitId && idCard);
  const adapter = getHisAdapter();
  const getScopeKey = () => {
    const current = getHisAdapter();
    return current ? JSON.stringify([current.vendor, current.getContextScope(), current.getDefaultExecDeptId()]) : '';
  };
  const scopeKey = getScopeKey();
  const [response, catalog] = await Promise.allSettled([
    hasIdentity ? regionalPost<RecommendationResponse>('/v1/client/chronic-disease/examination-recommendations/query', {
      patientId, visitId, idCard,
    }) : Promise.reject(new Error('missing identity')),
    medicalDataService.fetchAvailableExamLabItems(),
  ]);
  const sameContext = patientId === getPatientContextId(patient) && visitId === getPatientContextVisitId(patient)
    && adapter === getHisAdapter() && scopeKey === getScopeKey();
  const value = sameContext && response.status === 'fulfilled' ? response.value : null;
  // Payload identity is checked even though the generation controller also guards its session.
  const valid = value?.patientId === patientId && value.visitId === visitId && value.source === 'getUserInfo'
    && value.regionalHistory?.status === 'not_connected' && Array.isArray(value.recommendations)
    && value.recommendations.every((item) => item && typeof item.name === 'string' && item.name.trim()
      && typeof item.description === 'string' && Array.isArray(item.subItems)
      && item.subItems.every((name) => typeof name === 'string'));
  return buildChronicExaminationReminders({
    recommendations: valid ? value.recommendations : [],
    catalog: sameContext && catalog.status === 'fulfilled' ? catalog.value : [],
    visits: candidate.prescriptionHistoryVisits || candidate.chronicVisits,
    currentVisitId: visitId,
    sourceStatus: !hasIdentity ? 'missing_identity' : valid ? 'ready' : 'unavailable',
    catalogStatus: sameContext && catalog.status === 'fulfilled' ? 'ready' : 'unavailable',
    historyStatus: candidate.historyRetrievalStatus,
  });
}
