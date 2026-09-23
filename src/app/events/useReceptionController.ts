/**
 * App 级接诊状态机 controller。
 *
 * 负责 HIS 患者补全、接诊并发保护、风险胶囊状态和患者切换清理。
 * Tauri 事件注册、SDK handshake、具体问诊 / 语音结果页导航仍留在调用方。
 *
 * @module app/events/useReceptionController
 */

import type { Ref } from 'vue';
import { getWindowSizeForView } from '@/constants/windowSizes';
import { analyzePatientRisks } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import { trackApiCall, trackError } from '@/services/operationTracker';
import { getHisAdapter } from '@/services/his';
import type {
  HisOutpatientFollowUpContext,
  HisOutpatientMedicalRecord,
  HisVisitVitalSigns,
} from '@/services/his/types';
import type { AppPatient } from '@/types/appState';
import type { PatientMemoryBrief } from '@entities/patient-memory';
import {
  buildPatientContext,
  getPatientContextAnchorId,
  getPatientContextHistory,
  getPatientContextId,
  getPatientContextVisitId,
} from '@/utils/patientContext';
import {
  assessChronicRefillCandidate,
  buildChronicRefillHistoryQuery,
  normalizeRiskPresentationItems,
  type RiskItem,
} from '@features/reception-risk';
import {
  applyReceptionClinicalHistorySummaries,
  buildReceptionPatientDraft,
  getRecentReportedVisits,
  hasPatientReportedLabOrExamResults,
  hasReportedApplyResult,
  resolveIncomingPatientTracking,
  type ReceptionSessionController,
} from '@features/reception';
import { createReceptionFlowGuard } from './receptionFlowGuard';

export interface PatientRisksPayload {
  idPi?: string;
  idVis?: string;
  patientId?: string;
  visitId?: string;
  naPi?: string;
  name?: string;
  sdSexText?: string;
  gender?: string;
  ageText?: string;
  age?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  diagnosis?: string;
  allergyHistory?: string;
  risks?: RiskItem[];
  [key: string]: unknown;
}

export interface StartConsultationPayload {
  idPi?: string;
  idVis?: string;
  patientId?: string;
  visitId?: string;
  naPi?: string;
  name?: string;
  ageText?: string;
  sdSexText?: string;
  [key: string]: unknown;
}

export interface SessionAssistPayload extends StartConsultationPayload {
  action?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  diagnosis?: string;
  vitals?: string;
  allergyHistory?: string;
}

export interface ReceptionControllerOptions {
  currentPatient: Ref<AppPatient | null>;
  receptionSession: ReceptionSessionController;
  showToast: (msg: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  workMode: {
    openReceptionCapsule: (size: { width: number; height: number }) => Promise<void>;
    resizeReceptionCapsule: (size: { width: number; height: number }) => Promise<void>;
  };
  resetVoiceSessionState: () => void;
  clearVoiceConsultationCache: (patient?: AppPatient | null) => void;
  clearMinimizedConsultationSessions: () => void;
  fetchFollowUpContext?: (patient: AppPatient | null) => Promise<HisOutpatientFollowUpContext | null>;
  syncPatientMemory?: (patient: AppPatient | null) => Promise<PatientMemoryBrief | null>;
}

function buildCurrentOutpatientRecordText(record: HisOutpatientMedicalRecord | null): string {
  if (!record || record.contentPending) {
    return '';
  }
  if (record.plainText?.trim()) {
    return record.plainText.trim();
  }
  return [
    record.chiefComplaint ? `主诉：${record.chiefComplaint}` : '',
    record.historyOfPresentIllness ? `现病史：${record.historyOfPresentIllness}` : '',
    record.pastHistory ? `既往史：${record.pastHistory}` : '',
    record.physicalExamination ? `体格检查：${record.physicalExamination}` : '',
    record.auxiliaryExamination ? `辅助检查：${record.auxiliaryExamination}` : '',
    record.diagnosis ? `初步诊断：${record.diagnosis}` : '',
    record.treatmentPlan ? `治疗意见：${record.treatmentPlan}` : '',
  ].filter(Boolean).join('\n');
}

async function hydratePatientContextFromHis(
  currentPatient: AppPatient | null,
  payload: StartConsultationPayload | SessionAssistPayload | PatientRisksPayload | null | undefined,
  source: string,
): Promise<AppPatient | null> {
  console.log('[ReceptionController] hydratePatientContextFromHis entering:', {
    source,
    hasCurrentPatient: Boolean(currentPatient),
    payload: payload ? {
      keys: Object.keys(payload),
      idPi: payload.idPi,
      idVis: payload.idVis,
      patientId: payload.patientId,
      visitId: payload.visitId,
    } : null,
  });
  const nextDraft = buildPatientContext({
    existing: currentPatient,
    payload: payload as Record<string, unknown> | null | undefined,
    source,
    receptionEnsured: true,
  });
  const patientId = getPatientContextId(nextDraft);
  const nextVisitId = getPatientContextVisitId(nextDraft);
  console.log('[ReceptionController] parsed context ids:', {
    patientId,
    nextVisitId,
    existingHistory: Boolean(getPatientContextHistory(nextDraft)),
  });
  if (!patientId) {
    return nextDraft;
  }

  const existingHistory = getPatientContextHistory(nextDraft);
  const samePatientLoaded = currentPatient
    && getPatientContextId(currentPatient) === patientId
    && getPatientContextVisitId(currentPatient) === nextVisitId
    && (currentPatient.receptionEnsured || currentPatient._receptionEnsured)
    && existingHistory;
  if (samePatientLoaded) {
    return nextDraft;
  }

  const adapter = getHisAdapter();
  if (!adapter) {
    return nextDraft;
  }

  const hisInfo = await adapter.fetchPatientInfo(patientId);
  const chronicRefillHistoryQuery = buildChronicRefillHistoryQuery();
  const hisHistory = await adapter.fetchPatientHistory(patientId, {
    currentVisitId: nextVisitId,
    ...chronicRefillHistoryQuery,
  });

  // 拉取本次申请单状态；applyList.items.sdApply=3 表示检验/检查已出报告。
  let hasReportedResults = false;
  let currentOutpatientRecordText = '';
  let currentOutpatientRecordTitle = '';
  let currentOutpatientRecordTime = '';
  let currentVitalSigns: HisVisitVitalSigns | undefined;
  let resolvedDiagnosis = '';

  let resolvedVisitId = nextVisitId;
  const rawHistory = hisHistory as any;
  if (!resolvedVisitId && rawHistory?.raw?.visitItems && Array.isArray(rawHistory.raw.visitItems) && rawHistory.raw.visitItems.length > 0) {
    resolvedVisitId = String(rawHistory.raw.visitItems[0].idVis || '').trim();
    console.log('[ReceptionController] nextVisitId is empty, falling back to latest visitId from history:', resolvedVisitId);
  }

  if (resolvedVisitId) {
    try {
      console.log('[ReceptionController] resolvedVisitId is present, loading record:', resolvedVisitId);
      const record = await adapter.fetchOutpatientMedicalRecord(resolvedVisitId);
      console.log('[ReceptionController] loaded record:', record ? {
        visitId: record.visitId,
        hasRaw: Boolean(record.raw),
        rawKeys: record.raw ? Object.keys(record.raw) : [],
        plainTextLength: record.plainText?.length || 0,
      } : null);
      const detail = (record?.raw as any)?.detail;
      console.log('[ReceptionController] extracted detail object:', detail ? {
        keys: Object.keys(detail),
        applyListLength: Array.isArray(detail.applyList) ? detail.applyList.length : 'not an array',
        orderListLength: Array.isArray(detail.orderList) ? detail.orderList.length : 'not an array',
      } : null);
      
      const hasReportedApply = hasReportedApplyResult(detail);
      hasReportedResults = hasReportedApply;
      console.log('[ReceptionController] hasReportedResults evaluation:', {
        hasReportedApply,
        finalResult: hasReportedResults,
      });

      if (detail && Array.isArray(detail.diagList)) {
        resolvedDiagnosis = detail.diagList
          .map((d: any) => (d.naDiag || d.naIcd10 || '').trim())
          .filter(Boolean)
          .join('，');
      }
      if (!resolvedDiagnosis && record?.diagnosis) {
        resolvedDiagnosis = record.diagnosis;
      }
      console.log('[ReceptionController] resolvedDiagnosis from history record/detail:', resolvedDiagnosis);

      currentOutpatientRecordText = buildCurrentOutpatientRecordText(record);
      currentOutpatientRecordTitle = (record?.documentTitle || record?.documents?.[0]?.title || '').trim();
      currentOutpatientRecordTime = (
        record?.documents?.[0]?.titleTime
        || record?.documents?.[0]?.createdAt
        || record?.documents?.[0]?.insertedAt
        || ''
      ).trim();
      currentVitalSigns = record?.vitalSigns;
    } catch (error) {
      console.warn('[ReceptionController] Failed to check outpatient reported apply results:', error);
    }
  }

  let hydrated = buildPatientContext({
    existing: nextDraft,
    payload: payload as Record<string, unknown> | null | undefined,
    hisInfo,
    hisHistory,
    source,
    receptionEnsured: true,
  });

  if (hydrated) {
    if (!hydrated.visitId && resolvedVisitId) {
      hydrated.visitId = resolvedVisitId;
      hydrated.idVis = resolvedVisitId;
      if (hydrated.identity) {
        hydrated.identity.visitId = resolvedVisitId;
      }
    }
    hydrated.hasReportedLabOrExamResults = hasReportedResults;
    hydrated.currentOutpatientRecordText = currentOutpatientRecordText || undefined;
    hydrated.currentOutpatientRecordTitle = currentOutpatientRecordTitle || undefined;
    hydrated.currentOutpatientRecordTime = currentOutpatientRecordTime || undefined;
    hydrated.currentVitalSigns = currentVitalSigns;
    if (resolvedDiagnosis) {
      hydrated.diagnosis = resolvedDiagnosis;
    }
    hydrated.clinical = {
      ...hydrated.clinical,
      currentOutpatientRecordText: currentOutpatientRecordText || undefined,
      currentOutpatientRecordTitle: currentOutpatientRecordTitle || undefined,
      currentOutpatientRecordTime: currentOutpatientRecordTime || undefined,
      currentVitalSigns,
      diagnosis: resolvedDiagnosis || hydrated.clinical?.diagnosis || undefined,
    };
  }
  hydrated = applyReceptionClinicalHistorySummaries(hydrated, hisHistory);

  return hydrated;
}

export function useReceptionController(options: ReceptionControllerOptions) {
  const {
    currentPatient,
    receptionSession,
    showToast,
    workMode,
    resetVoiceSessionState,
    clearVoiceConsultationCache,
    clearMinimizedConsultationSessions,
  } = options;

  let activeReceptionPromise: Promise<boolean> | null = null;
  let activeReceptionPatientId: string | null = null;
  const receptionFlowGuard = createReceptionFlowGuard();

  function beginReceptionFlow(): number {
    const flowVersion = receptionFlowGuard.begin();
    receptionSession.startHydrating();
    return flowVersion;
  }

  function isReceptionFlowCurrent(flowVersion: number): boolean {
    return receptionFlowGuard.isCurrent(flowVersion);
  }

  function invalidateReceptionFlow(): void {
    receptionFlowGuard.begin();
    receptionSession.reset();
    activeReceptionPromise = null;
    activeReceptionPatientId = null;
    medicalDataService.clearAvailableExamLabItems();
  }

  async function prepareAvailableExamLabCatalog(
    flowVersion: number,
    payload: StartConsultationPayload | PatientRisksPayload,
  ): Promise<void> {
    const receptionDraft = buildReceptionPatientDraft(payload as Record<string, unknown>);
    const receptionKey = getPatientContextAnchorId(receptionDraft) || getPatientContextId(receptionDraft);
    try {
      await medicalDataService.beginAvailableExamLabReception(receptionKey);
    } catch (error) {
      if (!isReceptionFlowCurrent(flowVersion)) {
        return;
      }
      console.warn('[ReceptionController] Available exam/lab catalog unavailable for current reception', error);
      showToast('当前检验检查目录获取失败，相关项目暂不可匹配或回写', 'error', 5000);
    }
  }

  function clearVoiceStateWhenPatientSwitches(
    previousPatient: AppPatient | null,
    nextPatient: AppPatient | null
  ): void {
    const previousAnchorId = getPatientContextAnchorId(previousPatient);
    const nextAnchorId = getPatientContextAnchorId(nextPatient);
    if (!previousAnchorId || !nextAnchorId || previousAnchorId === nextAnchorId) {
      return;
    }

    clearVoiceConsultationCache(previousPatient);
    resetVoiceSessionState();
    // 恢复入口要和患者上下文绑定：切换到其他患者后旧患者现场失效。
    clearMinimizedConsultationSessions();
    console.info('[ReceptionController] Cleared voice cache after patient switch', {
      previousAnchorId,
      nextAnchorId,
    });
  }

  async function syncChronicRefillState(
    flowVersion: number,
    patient: AppPatient | null,
  ): Promise<void> {
    if (!isReceptionFlowCurrent(flowVersion)) {
      return;
    }

    const hasFollowUpReport = Boolean(receptionSession.outpatientFollowUpContext.value?.followUpEligible)
      || hasPatientReportedLabOrExamResults(patient);

    const candidate = assessChronicRefillCandidate(
      getPatientContextHistory(patient),
      {
        chiefComplaint: patient?.chiefComplaint || patient?.clinical?.chiefComplaint,
        historyOfPresentIllness: patient?.historyOfPresentIllness
          || patient?.clinical?.historyOfPresentIllness,
        diagnosis: patient?.diagnosis || patient?.clinical?.diagnosis,
      },
      hasFollowUpReport,
    );
    receptionSession.replaceOpportunity(
      'chronic-refill',
      candidate ? { type: 'chronic-refill', candidate } : null,
    );
  }

  async function syncPatientMemoryState(
    flowVersion: number,
    patient: AppPatient | null,
  ): Promise<void> {
    if (!options.syncPatientMemory || !patient || !isReceptionFlowCurrent(flowVersion)) {
      return;
    }
    receptionSession.startPatientMemorySync();
    try {
      const brief = await options.syncPatientMemory(patient);
      if (!isReceptionFlowCurrent(flowVersion)) {
        return;
      }
      receptionSession.setPatientMemoryBrief(brief);
    } catch (error) {
      if (!isReceptionFlowCurrent(flowVersion)) {
        return;
      }
      console.warn('[ReceptionController] Patient memory sync failed; reception continues', error);
      trackError('patient_memory_sync_failed', error);
      receptionSession.failPatientMemorySync();
    }
  }

  async function syncFollowUpState(
    flowVersion: number,
    patient: AppPatient | null,
  ): Promise<void> {
    console.log('[ReceptionController] syncFollowUpState triggered:', {
      flowVersion,
      currentFlow: receptionFlowGuard.current(),
      isCurrent: isReceptionFlowCurrent(flowVersion),
      hasPatient: Boolean(patient),
      hasReportedLabOrExamResults: patient ? hasPatientReportedLabOrExamResults(patient) : false,
      fetchFollowUpContextAvailable: Boolean(options.fetchFollowUpContext),
    });
    if (!isReceptionFlowCurrent(flowVersion) || !patient) {
      return;
    }

    if (!hasPatientReportedLabOrExamResults(patient)) {
      console.log('[ReceptionController] Patient has no reported lab/exam results, skipping follow up opportunity');
      receptionSession.replaceOpportunity('report-follow-up', null);
      return;
    }

    if (!options.fetchFollowUpContext) {
      console.log('[ReceptionController] options.fetchFollowUpContext callback is missing');
      return;
    }

    try {
      console.log('[ReceptionController] invoking fetchFollowUpContext callback...');
      const context = await options.fetchFollowUpContext(patient);
      if (!isReceptionFlowCurrent(flowVersion)) {
        console.log('[ReceptionController] flow version changed, aborting syncFollowUpState opportunity replace');
        return;
      }
      console.log('[ReceptionController] fetchFollowUpContext result:', context ? {
        followUpEligible: context.followUpEligible,
        labReportsLength: context.labReports?.length,
        examReportsLength: context.examReports?.length,
      } : null);
      receptionSession.replaceOpportunity(
        'report-follow-up',
        context?.followUpEligible ? { type: 'report-follow-up', context } : null,
      );
    } catch (error) {
      console.error('[ReceptionController] Failed to sync follow up state:', error);
      receptionSession.replaceOpportunity('report-follow-up', null);
    }
  }

  function syncReportInterpretationState(
    flowVersion: number,
    patient: AppPatient | null,
  ): void {
    if (!isReceptionFlowCurrent(flowVersion)) {
      return;
    }
    const visits = getRecentReportedVisits(getPatientContextHistory(patient));
    receptionSession.replaceOpportunity(
      'report-interpretation',
      visits.length > 0 ? { type: 'report-interpretation', visits } : null,
    );
  }

  async function resolveRiskItems(
    patient: AppPatient | null,
    flowVersion: number,
    suppliedRisks?: RiskItem[],
  ): Promise<RiskItem[] | null> {
    if (suppliedRisks?.length) {
      return normalizeRiskPresentationItems(suppliedRisks);
    }

    try {
      const risks = await analyzePatientRisks(patient);
      if (!isReceptionFlowCurrent(flowVersion)) {
        return null;
      }
      return normalizeRiskPresentationItems(risks || []);
    } catch (error) {
      if (!isReceptionFlowCurrent(flowVersion)) {
        return null;
      }
      console.error('[ReceptionController] Risk analysis failed', error);
      trackError('risk_analysis_failed', error);
      showToast('风险评估失败，患者已正常接诊', 'error');
      return [];
    }
  }

  async function openReceptionCapsule(): Promise<void> {
    const receptionSize = getWindowSizeForView('reception-capsule');
    await workMode.openReceptionCapsule(receptionSize);
  }

  async function executeReceptionFlow(payload: StartConsultationPayload, quietMode = false): Promise<boolean> {
    const patientId = getPatientContextId(buildReceptionPatientDraft(payload as Record<string, unknown> | null | undefined));
    if (!patientId) {
      showToast('接诊失败：未提供患者ID', 'error');
      return false;
    }

    if (activeReceptionPromise) {
      if (activeReceptionPatientId === patientId) {
        console.log('[ReceptionController] Waiting for existing reception flow for patient:', patientId);
        return activeReceptionPromise;
      } else {
        showToast('系统正在接诊其他患者，请稍候再试', 'error');
        return false;
      }
    }

    const flowVersion = beginReceptionFlow();
    activeReceptionPatientId = patientId;

    const receptionPromise = (async () => {
      trackApiCall('his_receive_patient', true, undefined, { patientId, auto: quietMode });
      try {
        const [nextPatient] = await Promise.all([
          hydratePatientContextFromHis(currentPatient.value, payload, quietMode ? 'reception-auto' : 'receive-patient'),
          prepareAvailableExamLabCatalog(flowVersion, payload),
        ]);
        if (!isReceptionFlowCurrent(flowVersion)) {
          console.info('[ReceptionController] Ignore stale reception result after flow invalidation:', patientId);
          return false;
        }
        if (!nextPatient) {
          showToast('接诊失败：患者上下文初始化失败', 'error');
          return false;
        }
        clearVoiceStateWhenPatientSwitches(currentPatient.value, nextPatient);
        currentPatient.value = nextPatient;
        void syncPatientMemoryState(flowVersion, currentPatient.value);

        await openReceptionCapsule();
        if (!isReceptionFlowCurrent(flowVersion)) {
          console.info('[ReceptionController] Ignore stale reception UI update:', patientId);
          return false;
        }

        receptionSession.startAssessing();

        try {
          const risks = await resolveRiskItems(currentPatient.value, flowVersion);
          if (risks === null || !isReceptionFlowCurrent(flowVersion)) {
            console.info('[ReceptionController] Ignore stale risk analysis result after flow invalidation:', patientId);
            return false;
          }
          console.log('LLM Risk Analysis Result after reception:', risks);
          receptionSession.setRisks(risks);
        } finally {
          if (isReceptionFlowCurrent(flowVersion) && receptionSession.status.value === 'assessing') {
            await syncFollowUpState(flowVersion, currentPatient.value);
            syncReportInterpretationState(flowVersion, currentPatient.value);
            await syncChronicRefillState(flowVersion, currentPatient.value);
            receptionSession.finishAssessment();

            const hasFollowUp = Boolean(receptionSession.outpatientFollowUpContext.value);
            const hasChronicRefill = Boolean(receptionSession.chronicRefillCandidate.value);
            const hasReportInterpretation = receptionSession.reportInterpretationVisits.value.length > 0;
            const receptionSize = getWindowSizeForView('reception-capsule', {
              expanded: receptionSession.risks.value.length > 0,
              riskCount: receptionSession.risks.value.length,
              hasChronicRefill,
              hasFollowUp,
              hasReportInterpretation,
            });
            try {
              await workMode.resizeReceptionCapsule(receptionSize);
            } catch (error) {
              console.warn('[ReceptionController] Failed to resize reception capsule after opportunity assessment', error);
            }
          }
        }

        return true;
      } catch (e) {
        if (!isReceptionFlowCurrent(flowVersion)) {
          console.info('[ReceptionController] Ignore stale reception error after flow invalidation:', patientId, e);
          return false;
        }
        console.error('Patient reception failed:', e);
        trackError('receive_patient_failed', e);
        showToast('接诊处理异常', 'error');
        receptionSession.fail();
        return false;
      }
    })();
    activeReceptionPromise = receptionPromise;

    try {
      return await receptionPromise;
    } finally {
      if (activeReceptionPromise === receptionPromise) {
        activeReceptionPromise = null;
        activeReceptionPatientId = null;
      }
    }
  }

  async function ensureReceptionContext(
    payload: StartConsultationPayload | SessionAssistPayload | null | undefined
  ): Promise<boolean> {
    const incomingId = getPatientContextId(buildReceptionPatientDraft(payload as Record<string, unknown> | null | undefined));
    const currentId = getPatientContextId(currentPatient.value);
    const currentReceptionEnsured = Boolean(currentPatient.value?.receptionEnsured || currentPatient.value?._receptionEnsured);

    if (currentPatient.value && currentId && currentReceptionEnsured) {
      if (incomingId && incomingId !== currentId) {
        showToast('当前已接诊其他患者，请先结束当前就诊', 'error');
        return false;
      }
      return true;
    }

    if (!incomingId) {
      showToast('请先接诊患者', 'error');
      return false;
    }

    console.log('[ReceptionController] Auto-triggering patient reception from context check');
    return await executeReceptionFlow(payload as StartConsultationPayload, true);
  }

  function mergeCurrentPatient(
    payload: StartConsultationPayload | SessionAssistPayload | null | undefined,
    overrides?: Partial<AppPatient>,
  ): void {
    currentPatient.value = buildPatientContext({
      existing: currentPatient.value,
      payload: payload as Record<string, unknown> | null | undefined,
      source: currentPatient.value?.source || 'event-payload',
      receptionEnsured: currentPatient.value?.receptionEnsured ?? currentPatient.value?._receptionEnsured,
      overrides,
    });
  }

  async function showPatientRisks(data: PatientRisksPayload): Promise<void> {
    const tracking = resolveIncomingPatientTracking(data as Record<string, unknown> | null | undefined);
    if (activeReceptionPromise) {
      if (tracking.patientId && activeReceptionPatientId && tracking.patientId !== activeReceptionPatientId) {
        showToast('系统正在接诊其他患者，请稍候再试', 'error');
        return;
      }
      const waitingFlowVersion = receptionFlowGuard.current();
      await activeReceptionPromise;
      if (!receptionFlowGuard.isCurrent(waitingFlowVersion)) {
        console.info('[ReceptionController] Ignore patient risk event after reception invalidation:', tracking.patientId);
        return;
      }
    }

    const flowVersion = beginReceptionFlow();
    trackApiCall('his_patient_risks', true, undefined, {
      patientId: tracking.patientId,
      patientName: tracking.patientName,
      riskCount: data.risks?.length,
    });

    try {
      const [nextPatient] = await Promise.all([
        hydratePatientContextFromHis(currentPatient.value, data, 'show-patient-risks'),
        prepareAvailableExamLabCatalog(flowVersion, data),
      ]);
      if (!isReceptionFlowCurrent(flowVersion)) {
        console.info('[ReceptionController] Ignore stale patient risk context:', tracking.patientId);
        return;
      }
      clearVoiceStateWhenPatientSwitches(currentPatient.value, nextPatient);
      currentPatient.value = nextPatient;
      void syncPatientMemoryState(flowVersion, currentPatient.value);
      receptionSession.startAssessing();

      const receptionSize = getWindowSizeForView('reception-capsule', {
        expanded: !!data.risks?.length,
        riskCount: data.risks?.length ?? 0,
      });
      await workMode.openReceptionCapsule(receptionSize);
      if (!isReceptionFlowCurrent(flowVersion)) {
        return;
      }

      const risks = await resolveRiskItems(currentPatient.value, flowVersion, data.risks);
      if (risks === null || !isReceptionFlowCurrent(flowVersion)) {
        return;
      }
      console.log('LLM Risk Analysis Result:', risks);
      receptionSession.setRisks(risks);
    } catch (error) {
      if (!isReceptionFlowCurrent(flowVersion)) {
        console.info('[ReceptionController] Ignore stale patient risk error:', tracking.patientId, error);
        return;
      }
      console.error('[ReceptionController] Failed to load patient risk context', error);
      trackError('receive_patient_failed', error);
      showToast('风险信息加载失败', 'error');
      receptionSession.fail();
    } finally {
      if (isReceptionFlowCurrent(flowVersion) && receptionSession.status.value === 'assessing') {
        await syncFollowUpState(flowVersion, currentPatient.value);
        syncReportInterpretationState(flowVersion, currentPatient.value);
        await syncChronicRefillState(flowVersion, currentPatient.value);
        receptionSession.finishAssessment();
        const receptionSize = getWindowSizeForView('reception-capsule', {
          expanded: receptionSession.risks.value.length > 0,
          riskCount: receptionSession.risks.value.length,
          hasChronicRefill: Boolean(receptionSession.chronicRefillCandidate.value),
          hasFollowUp: Boolean(receptionSession.outpatientFollowUpContext.value),
          hasReportInterpretation: receptionSession.reportInterpretationVisits.value.length > 0,
        });
        void workMode.resizeReceptionCapsule(receptionSize);
      }
    }
  }

  return {
    executeReceptionFlow,
    ensureReceptionContext,
    invalidateReceptionFlow,
    mergeCurrentPatient,
    showPatientRisks,
  };
}
