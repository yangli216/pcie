import type { Ref } from 'vue';
import type { HisOutpatientFollowUpContext } from '@/services/his/types';
import type { ReportFollowUpAssessment } from '@/types/reportInterpretation';
import type { AppPatient } from '@/types/appState';
import { getPatientContextAnchorId } from '@/utils/patientContext';
import type {
  ClinicalResultGenerationStage,
  ClinicalResultInput,
} from '@features/clinical-result';
import {
  getChronicRefillConditionOptions,
  scopeChronicRefillCandidate,
  type ChronicRefillCandidate,
} from '@features/reception-risk/lib/chronicRefillAssessment';
import { chronicRefillTimingTracker } from '@features/reception-risk/model/chronicRefillTimingTracker';
import type { ChronicRefillRecordGenerationOptions } from '@features/reception-risk/api/chronicRefillRecord';
import type { ChronicRefillSelection } from '@features/reception-risk/lib/chronicRefillMedicationAttribution';
import { hasPatientReportedLabOrExamResults } from '../lib/reportedApplyResults';
import type { ReceptionSessionController } from './useReceptionSessionController';
import type {
  OutpatientVoiceEntryDecision,
  ReceptionOpportunity,
} from '../types';

interface ResolveVoiceEntryOptions {
  hasCachedResult: boolean;
  fetchFollowUpContext: () => Promise<HisOutpatientFollowUpContext | null>;
}

export async function resolveOutpatientVoiceEntry(
  options: ResolveVoiceEntryOptions,
): Promise<OutpatientVoiceEntryDecision> {
  if (options.hasCachedResult) {
    return { type: 'restore-voice-result' };
  }

  const context = await options.fetchFollowUpContext();
  if (context?.followUpEligible) {
    return { type: 'report-follow-up', context };
  }

  return { type: 'voice-capture' };
}

export interface OutpatientScenarioRouterOptions {
  currentPatient: Ref<AppPatient | null>;
  session: ReceptionSessionController;
  hasCachedVoiceResult: (patient?: AppPatient | null) => boolean;
  fetchFollowUpContext?: (patient: AppPatient | null) => Promise<HisOutpatientFollowUpContext | null>;
  applyFollowUpContext: (context: HisOutpatientFollowUpContext) => void;
  generateChronicRefillRecord: (
    patient: AppPatient,
    candidate: ChronicRefillCandidate,
    options?: ChronicRefillRecordGenerationOptions,
  ) => Promise<ClinicalResultInput>;
  beginGeneratedClinicalResult: (input: {
    channel: 'chronic-refill';
    message: string;
    stage: 'preparing-context';
  }) => Promise<string>;
  updateGeneratedClinicalResultProgress: (sessionId: string, progress: {
    message: string;
    stage: ClinicalResultGenerationStage;
  }) => boolean;
  updateGeneratedClinicalResultPartial: (sessionId: string, result: ClinicalResultInput) => boolean;
  completeGeneratedClinicalResult: (sessionId: string, result: ClinicalResultInput) => boolean;
  failGeneratedClinicalResult: (sessionId: string, message: string) => boolean;
  resetVoiceSessionState: () => void;
  openOutpatientFollowUp: () => Promise<void>;
  openReportInterpretation: () => Promise<void>;
  startVoiceInteraction: (options?: { skipCacheRestore?: boolean }) => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  trackError: (name: string, error: unknown) => void;
}

export function useOutpatientScenarioRouter(options: OutpatientScenarioRouterOptions) {
  const {
    currentPatient,
    session,
    hasCachedVoiceResult,
    fetchFollowUpContext,
    applyFollowUpContext,
    generateChronicRefillRecord,
    beginGeneratedClinicalResult,
    updateGeneratedClinicalResultProgress,
    updateGeneratedClinicalResultPartial,
    completeGeneratedClinicalResult,
    failGeneratedClinicalResult,
    resetVoiceSessionState,
    openOutpatientFollowUp,
    openReportInterpretation,
    startVoiceInteraction,
    showToast,
    trackError,
  } = options;

  function isCurrentOpportunity(
    opportunity: ReceptionOpportunity,
    patientAnchorId: string,
  ): boolean {
    return getPatientContextAnchorId(currentPatient.value) === patientAnchorId
      && session.getOpportunity(opportunity.type) === opportunity;
  }

  async function confirmChronicRefill(
    selection: ChronicRefillSelection | string[] = [],
  ): Promise<void> {
    const patient = currentPatient.value;
    const opportunity = session.getOpportunity('chronic-refill');
    if (
      !patient
      || opportunity?.type !== 'chronic-refill'
      || session.executingOpportunity.value
    ) {
      return;
    }

    const patientAnchorId = getPatientContextAnchorId(patient);
    let generationSessionId = '';
    session.setExecutingOpportunity('chronic-refill');
    try {
      const conditionOptions = getChronicRefillConditionOptions(opportunity.candidate);
      const selectedConditionIds = Array.isArray(selection)
        ? selection
        : selection.conditionIds;
      const resolvedConditionIds = selectedConditionIds.length > 0
        ? selectedConditionIds
        : (conditionOptions.length === 1 ? [conditionOptions[0].id] : []);
      const scopedCandidate = scopeChronicRefillCandidate(
        opportunity.candidate,
        resolvedConditionIds,
      );
      if (!scopedCandidate) {
        showToast('请先选择本次需要续方的慢病', 'info');
        return;
      }
      const diagnosisText = scopedCandidate.diagnoses.join('、');
      generationSessionId = await beginGeneratedClinicalResult({
        channel: 'chronic-refill',
        stage: 'preparing-context',
        message: `正在读取${diagnosisText}历史资料与院内药品`,
      });
      const timing = chronicRefillTimingTracker.start(generationSessionId);
      const result = await generateChronicRefillRecord(patient, scopedCandidate, {
        sessionId: generationSessionId,
        timing,
        onProgress: (stage) => {
          if (!isCurrentOpportunity(opportunity, patientAnchorId)) return;
          updateGeneratedClinicalResultProgress(generationSessionId, {
            stage,
            message: stage === 'generating-content'
              ? `正在生成${diagnosisText}病历与核查项`
              : '正在整理诊断与用药方案',
          });
        },
        onPartial: (partialResult) => {
          if (!isCurrentOpportunity(opportunity, patientAnchorId)) return;
          updateGeneratedClinicalResultPartial(generationSessionId, partialResult);
        },
      });
      if (!isCurrentOpportunity(opportunity, patientAnchorId)) {
        return;
      }
      if (!completeGeneratedClinicalResult(generationSessionId, result)) return;
      showToast('复诊配药病历与核查项已生成，请核查后回写', 'success');
    } catch (error) {
      if (!isCurrentOpportunity(opportunity, patientAnchorId)) {
        return;
      }
      trackError('generate_chronic_refill_result_failed', error);
      if (generationSessionId) {
        chronicRefillTimingTracker.get(generationSessionId)?.finish('failed');
        failGeneratedClinicalResult(generationSessionId, '慢病复诊结果生成失败，请收起页面后重试');
      }
      showToast('生成复诊配药结果失败，请稍后重试', 'error');
    } finally {
      if (
        isCurrentOpportunity(opportunity, patientAnchorId)
        && session.executingOpportunity.value === 'chronic-refill'
      ) {
        session.setExecutingOpportunity(null);
      }
    }
  }

  async function confirmFollowUp(assessment?: ReportFollowUpAssessment): Promise<void> {
    const patient = currentPatient.value;
    const opportunity = session.getOpportunity('report-follow-up');
    if (
      !patient
      || opportunity?.type !== 'report-follow-up'
      || session.executingOpportunity.value
    ) {
      return;
    }

    const patientAnchorId = getPatientContextAnchorId(patient);
    session.setExecutingOpportunity('report-follow-up');
    try {
      const context = assessment
        ? { ...opportunity.context, assessment }
        : opportunity.context;
      session.replaceOpportunity('report-follow-up', { type: 'report-follow-up', context });
      applyFollowUpContext(context);
      resetVoiceSessionState();
      await openOutpatientFollowUp();
    } catch (error) {
      trackError('confirm_follow_up_failed', error);
      showToast('进入回诊失败，请稍后重试', 'error');
    } finally {
      if (
        getPatientContextAnchorId(currentPatient.value) === patientAnchorId
        && session.executingOpportunity.value === 'report-follow-up'
      ) {
        session.setExecutingOpportunity(null);
      }
    }
  }

  async function confirmReportAssistant(): Promise<void> {
    const patient = currentPatient.value;
    const reportOpportunity = session.getOpportunity('report-interpretation');
    const followUpOpportunity = session.getOpportunity('report-follow-up');
    if (
      !patient
      || (!reportOpportunity && !followUpOpportunity)
      || session.executingOpportunity.value
    ) {
      return;
    }

    const patientAnchorId = getPatientContextAnchorId(patient);
    session.setExecutingOpportunity('report-interpretation');
    try {
      await openReportInterpretation();
    } catch (error) {
      if (getPatientContextAnchorId(currentPatient.value) !== patientAnchorId) return;
      trackError('confirm_report_assistant_failed', error);
      showToast('进入报告助手失败，请稍后重试', 'error');
    } finally {
      if (
        getPatientContextAnchorId(currentPatient.value) === patientAnchorId
        && session.executingOpportunity.value === 'report-interpretation'
      ) {
        session.setExecutingOpportunity(null);
      }
    }
  }

  async function openVoiceEntry(): Promise<OutpatientVoiceEntryDecision> {
    const patient = currentPatient.value;
    const patientAnchorId = getPatientContextAnchorId(patient);
    const hasCache = hasCachedVoiceResult(patient);

    if (hasCache) {
      await startVoiceInteraction({ skipCacheRestore: false });
      return { type: 'restore-voice-result' };
    }

    const opportunity = session.getOpportunity('report-follow-up');
    if (opportunity?.type === 'report-follow-up') {
      await openReportInterpretation();
      return { type: 'report-follow-up', context: opportunity.context };
    }

    if (fetchFollowUpContext && patient && hasPatientReportedLabOrExamResults(patient)) {
      const context = await fetchFollowUpContext(patient);
      if (
        context?.followUpEligible
        && getPatientContextAnchorId(currentPatient.value) === patientAnchorId
      ) {
        session.replaceOpportunity('report-follow-up', { type: 'report-follow-up', context });
        await openReportInterpretation();
        return { type: 'report-follow-up', context };
      }
    }

    if (getPatientContextAnchorId(currentPatient.value) !== patientAnchorId) {
      return { type: 'voice-capture' };
    }

    await startVoiceInteraction({
      skipCacheRestore: true,
    });
    return { type: 'voice-capture' };
  }

  return {
    confirmChronicRefill,
    confirmFollowUp,
    confirmReportAssistant,
    openVoiceEntry,
  };
}

export type OutpatientScenarioRouter = ReturnType<typeof useOutpatientScenarioRouter>;
