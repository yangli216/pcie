import { computed, ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { AppPatient } from '@/types/appState';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import { getPatientContextAnchorId } from '@/utils/patientContext';
import { trackFinalRecommendationPreferences } from '@/services/recommendationPreferenceTracker';
import type { ExecDeptOption, UsageOption } from '@/utils/medicalDictionaryHelpers';
import { getHisAdapter } from '@/services/his';
import {
  buildRecordConfirmedPayload,
  buildTreatmentPlanSummary,
} from '@features/clinical-result';
import {
  useClinicalResultWritebackPayload,
  useClinicalResultWritebackPreflight,
  useConsultationReferenceFeedbackListener,
  useWritebackFeedbackController,
  useWritebackStatus,
  type ClinicalResultWritebackPharmacyOption,
  type WritebackFeedbackPayload,
} from '@features/consultation-result';
import type { TreatmentPlanRecordContext } from './useTreatmentPlanRecommendations';

export type TreatmentPlanNotifyType = 'success' | 'error' | 'info';
export type TreatmentPlanNotify = (message: string, type?: TreatmentPlanNotifyType) => void;

export interface TreatmentPlanWritebackOptions {
  patient: Ref<AppPatient | null>;
  diagnosis: Ref<Diagnosis | null>;
  treatments: Ref<TreatmentRecommendation[]>;
  recordContext: Readonly<Ref<TreatmentPlanRecordContext>>;
  execDeptOptions: Ref<ExecDeptOption[]>;
  normalizeTreatment: (rec: Partial<TreatmentRecommendation>) => TreatmentRecommendation;
  findFrequencyOptionByValue: (value?: string) => UsageOption | undefined;
  findRouteOptionByValue: (value?: string) => UsageOption | undefined;
  getDefaultPharmacyOption: (rec: TreatmentRecommendation) => ClinicalResultWritebackPharmacyOption | undefined;
  findMatchedPharmacyOption: (
    rec: TreatmentRecommendation,
    value: string,
  ) => ClinicalResultWritebackPharmacyOption | undefined;
  ensureMedicineSelectable: (rec: TreatmentRecommendation, showWarning?: boolean) => Promise<boolean>;
  checkMedicineInventoryEnough: (rec: TreatmentRecommendation, showWarning?: boolean) => Promise<boolean>;
  hydrateMedicalItemDetail: (rec: TreatmentRecommendation) => Promise<unknown>;
  hasRequiredPharmacy: (rec: TreatmentRecommendation) => boolean;
  hasRequiredExecDept: (rec: TreatmentRecommendation) => boolean;
  hasRequiredBodySite: (rec: TreatmentRecommendation) => boolean;
  onWritebackSuccess?: (payload: WritebackFeedbackPayload) => void;
  notify?: TreatmentPlanNotify;
}

function toNotifyType(type?: string): TreatmentPlanNotifyType {
  if (type === 'success' || type === 'error' || type === 'info') {
    return type;
  }
  return 'info';
}

export function useTreatmentPlanWriteback(options: TreatmentPlanWritebackOptions) {
  const submitting = ref(false);
  const selectedDiagnoses = computed<Diagnosis[]>(() => (
    options.diagnosis.value ? [options.diagnosis.value] : []
  ));

  function notify(message: string, type?: string): void {
    options.notify?.(message, toNotifyType(type));
  }

  function resolveConsultationId(): string {
    return getPatientContextAnchorId(options.patient.value) || '';
  }

  const writebackStatus = useWritebackStatus({
    isSubmitting: () => submitting.value,
    pendingMessage: '诊疗方案已发送至 HIS，等待处理结果回执。',
    failedMessage: '诊疗方案回写失败，请根据提示修改后重试。',
  });

  const {
    clearLastFeedback,
    markWritebackPending,
    resetWritebackState,
    applyWritebackFeedback: applyWritebackFeedbackStatus,
  } = writebackStatus;

  const { buildDiagList, buildOrderList, orderItemResolvers } = useClinicalResultWritebackPayload({
    selectedDiagnoses: selectedDiagnoses as unknown as Ref<Diagnosis[]>,
    primaryDiagnosis: options.diagnosis,
    patientTetId: computed(() => options.patient.value?.idTet || '') as unknown as Ref<string>,
    execDeptOptions: options.execDeptOptions,
    normalizeTreatment: options.normalizeTreatment,
    findFrequencyOptionByValue: options.findFrequencyOptionByValue,
    findRouteOptionByValue: options.findRouteOptionByValue,
    getDefaultPharmacyOption: options.getDefaultPharmacyOption,
    findMatchedPharmacyOption: options.findMatchedPharmacyOption,
    getDefaultExecDeptId: () => getHisAdapter()?.getDefaultExecDeptId() || '',
  });

  const { run: runWritebackPreflight } = useClinicalResultWritebackPreflight({
    selectedDiagnoses,
    treatments: options.treatments,
    ensureMedicineSelectable: options.ensureMedicineSelectable,
    checkMedicineInventoryEnough: options.checkMedicineInventoryEnough,
    hydrateMedicalItemDetail: options.hydrateMedicalItemDetail,
    hasRequiredPharmacy: options.hasRequiredPharmacy,
    hasRequiredExecDept: options.hasRequiredExecDept,
    hasRequiredBodySite: options.hasRequiredBodySite,
    openPharmacySelector: () => {},
    openExecDeptSelector: () => {},
    openBodySiteSelector: () => {},
    requiredFieldOptions: {
      resolvers: orderItemResolvers,
      normalize: (item) => options.normalizeTreatment(item),
    },
    notify,
  });

  const writebackFeedbackController = useWritebackFeedbackController({
    applyFeedback: applyWritebackFeedbackStatus,
    notify,
    onSuccess: (payload) => {
      options.onWritebackSuccess?.(payload);
    },
    successMessage: '诊疗方案已完成回写。',
    failedMessage: '诊疗方案回写失败，请根据提示修改后重试。',
  });

  useConsultationReferenceFeedbackListener<WritebackFeedbackPayload>({
    resolveConsultationId,
    logContext: 'TreatmentPlanPage',
    onFeedback: (payload) => {
      // 白云已移除互认决策弹窗：宿主历史 pending 中间态由原回写状态机按未完成清算
      writebackFeedbackController.applyWritebackFeedback(payload);
    },
  });

  async function submit(): Promise<boolean> {
    // 白云已移除互认决策：pending 等待期是同一真实保存状态，handler 层阻断重复提交，
    // 避免再次 submit 得到新 requestId 引出重复开立；新请求只在真实终态/会话切换后允许。
    if (writebackStatus.isWritebackBusy.value) {
      notify('HIS 正在处理本次回写，请等待结果回执。', 'info');
      return false;
    }

    if (!resolveConsultationId()) {
      notify('缺少当前患者标识，暂不能回写诊疗方案。');
      return false;
    }

    if (!options.treatments.value.some((item) => item.selected)) {
      notify('请至少勾选一项诊疗方案后再回写。');
      return false;
    }

    submitting.value = true;
    clearLastFeedback();

    try {
      const preflight = await runWritebackPreflight();
      if (!preflight.ready) {
        return false;
      }

      const requestId = `record-confirmed-${Date.now()}`;
      const selected = preflight.selected;
      const chiefComplaint = options.recordContext.value.chiefComplaint
        || (options.recordContext.value.isFollowUp ? '门诊复诊，查看检验检查报告结果' : '');
      const historyOfPresentIllness = options.recordContext.value.historyOfPresentIllness
        || (options.recordContext.value.isFollowUp
          ? '患者本次门诊复诊，结合本次门诊病历及已出具的检验检查报告结果评估后续治疗方案。'
          : '');
      const result = buildRecordConfirmedPayload({
        consultationId: resolveConsultationId(),
        requestId,
        chiefComplaint,
        historyOfPresentIllness,
        pastMedicalHistory: options.recordContext.value.pastMedicalHistory,
        diagList: buildDiagList(),
        orderList: buildOrderList(selected),
        treatmentPlan: buildTreatmentPlanSummary(selected),
        extra: {
          referenceType: 'batch',
          action: 'batch',
          referenceStatus: 'pending',
          referenceMessage: '等待 HIS 完成诊疗方案回写并回执。',
          sourceModule: 'treatment_plan',
        },
      });

      trackFinalRecommendationPreferences({
        diagnoses: selectedDiagnoses.value,
        primaryDiagnosis: options.diagnosis.value,
        treatments: selected,
        context: {
          consultationId: resolveConsultationId(),
          sourceModule: 'treatment_plan',
          scene: 'treatment-plan-writeback',
        },
      });
      markWritebackPending(requestId, '诊疗方案已发送至 HIS，等待处理结果回执。');
      await invoke('complete_consultation', { result });
      notify('诊疗方案已发送至 HIS，等待处理结果回执。');
      return true;
    } catch (error) {
      console.error('[TreatmentPlan] Failed to submit treatment plan', error);
      resetWritebackState();
      notify('诊疗方案提交失败，请稍后重试。', 'error');
      return false;
    } finally {
      submitting.value = false;
    }
  }

  return {
    submitting,
    submit,
    writebackStatus,
  };
}

export type TreatmentPlanWriteback = ReturnType<typeof useTreatmentPlanWriteback>;
