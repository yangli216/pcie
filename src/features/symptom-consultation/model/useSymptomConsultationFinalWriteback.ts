import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import {
  buildDiagList,
  buildOrderListItem,
  buildRecordConfirmedPayload,
  type OrderItemResolvers,
} from '../../clinical-result/recordConfirmedPayload';
import { buildTreatmentPlanSummary } from '../../clinical-result/consultationSubmitPayload';

/** 回执最小形态：与 consultation-reference-feedback 事件 payload 对齐。 */
export interface SymptomFinalWritebackFeedbackPayload {
  requestId: string;
  status: string;
}

export interface SymptomFinalWritebackPreflightResult {
  ready: boolean;
  selected: TreatmentRecommendation[];
}

export interface SymptomConsultationFinalWritebackOptions {
  resolveConsultationId: () => string;
  canSubmit: () => boolean;
  getSelectedDiagnosis: () => Diagnosis | null;
  getPatientTetId: () => string;
  getRecord: () => { chiefComplaint: string; historyOfPresentIllness: string };
  getPastMedicalHistory: () => string;
  runPreflight: () => Promise<SymptomFinalWritebackPreflightResult>;
  orderItemResolvers: OrderItemResolvers;
  notify: (message: string, type: 'success' | 'error' | 'info') => void;
  formatError: (error: unknown) => string;
  onBeforeSubmit?: (context: {
    consultationId: string;
    diagnosis: Diagnosis;
    treatments: TreatmentRecommendation[];
  }) => void;
  onSuccess?: (consultationId: string) => void;
  onError?: (error: unknown) => void;
}

export function useSymptomConsultationFinalWriteback(
  options: SymptomConsultationFinalWritebackOptions,
) {
  const busy = ref(false);
  const pendingRequestId = ref('');

  function reset(): void {
    busy.value = false;
    pendingRequestId.value = '';
  }

  async function submit(): Promise<void> {
    if (busy.value) return;
    const diagnosis = options.getSelectedDiagnosis();
    if (!options.canSubmit() || !diagnosis) {
      options.notify(
        diagnosis ? '请先完善主诉和现病史后再提交' : '请先选择一个诊断结果',
        'info',
      );
      return;
    }

    busy.value = true;
    const requestId = `record-confirmed-${Date.now()}`;
    const consultationId = options.resolveConsultationId();
    try {
      const preflight = await options.runPreflight();
      if (!preflight.ready) {
        busy.value = false;
        return;
      }

      const record = options.getRecord();
      const diagList = buildDiagList({
        selectedDiagnoses: [diagnosis],
        primaryDiagnosis: diagnosis,
        patientTetId: options.getPatientTetId(),
      });
      const orderList = preflight.selected.map((item) => (
        buildOrderListItem(item, options.orderItemResolvers)
      ));
      const result = buildRecordConfirmedPayload({
        consultationId,
        requestId,
        ...record,
        pastMedicalHistory: options.getPastMedicalHistory(),
        diagList,
        orderList,
        treatmentPlan: buildTreatmentPlanSummary(preflight.selected),
        extra: {
          referenceType: 'batch',
          action: 'batch',
          referenceStatus: 'pending',
          referenceMessage: '等待 PHIS 完成最终回写并回执。',
        },
      });

      options.onBeforeSubmit?.({ consultationId, diagnosis, treatments: preflight.selected });
      pendingRequestId.value = requestId;
      await invoke('complete_consultation', { result });
      if (pendingRequestId.value === requestId) {
        options.notify('数据已发送至 HIS，等待保存结果。', 'info');
      }
    } catch (error) {
      reset();
      options.onError?.(error);
      options.notify(options.formatError(error), 'error');
    }
  }

  // 白云已移除互认决策弹窗：pending（宿主历史互认中间态）是中间态而非终态，
  // 不得误作成功、不得写成"已由 HIS 保存失败"，也不清算等待态；
  // 保持 busy 与 requestId 关联，等待同 requestId 的真实 success/failed/cancelled，
  // 其间 submit() 的 busy 守卫阻断重复提交；等待期页面原有退出/新接诊 reset 渠道仍可安全结束。
  function finalizeFeedback(payload: SymptomFinalWritebackFeedbackPayload): void {
    if (!pendingRequestId.value || payload.requestId !== pendingRequestId.value) {
      return;
    }
    if (payload.status !== 'success' && payload.status !== 'failed' && payload.status !== 'cancelled') {
      return;
    }
    pendingRequestId.value = '';
    busy.value = false;
    if (payload.status === 'success') options.onSuccess?.(options.resolveConsultationId());
  }

  return {
    busy,
    pendingRequestId,
    submit,
    finalizeFeedback,
    reset,
  };
}

export type SymptomConsultationFinalWriteback = ReturnType<
  typeof useSymptomConsultationFinalWriteback
>;
