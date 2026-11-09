import { computed, ref } from 'vue';

export type WritebackLifecycleStatus = 'pending' | 'success' | 'failed' | 'cancelled';
export type WritebackReferenceType =
  | 'diagnosis'
  | 'medication'
  | 'examination'
  | 'lab_test'
  | 'procedure'
  | 'batch';

export interface WritebackFeedbackPayload {
  consultationId?: string;
  requestId: string;
  referenceType?: WritebackReferenceType;
  action?: WritebackReferenceType;
  status: WritebackLifecycleStatus;
  message?: string;
  items?: unknown[];
  recognizableItems?: unknown[];
  timestamp?: number;
}

interface Options {
  isSubmitting?: () => boolean;
  pendingMessage?: string;
  failedMessage?: string;
}

export function useWritebackStatus(options: Options = {}) {
  const waitingWritebackFeedback = ref(false);
  const pendingWritebackRequestId = ref('');
  const pendingWritebackMessage = ref('');
  const lastWritebackFeedback = ref<WritebackFeedbackPayload | null>(null);

  const isWritebackBusy = computed(() => Boolean(options.isSubmitting?.()) || waitingWritebackFeedback.value);
  const submitButtonText = computed(() => {
    if (options.isSubmitting?.()) return '提交中...';
    if (waitingWritebackFeedback.value) return '等待 HIS 回执...';
    return '一键回写';
  });
  const writebackBannerTone = computed<'info' | 'error'>(() => {
    if (waitingWritebackFeedback.value) return 'info';
    if (lastWritebackFeedback.value?.status === 'failed') return 'error';
    // 白云已移除互认决策：宿主历史 pending 中间态按未完成清算，不误作成功
    if (lastWritebackFeedback.value?.status === 'pending') return 'error';
    return 'info';
  });
  const writebackBannerText = computed(() => {
    if (waitingWritebackFeedback.value) {
      return pendingWritebackMessage.value || options.pendingMessage || '病历已发送至 HIS，等待处理结果回执。';
    }
    if (lastWritebackFeedback.value?.status === 'failed') {
      return lastWritebackFeedback.value.message || options.failedMessage || 'HIS 回写失败，请根据提示修改后重试。';
    }
    if (lastWritebackFeedback.value?.status === 'pending') {
      return lastWritebackFeedback.value.message || 'HIS 返回未完成状态，本次回写未完成，请根据提示修改后重试。';
    }
    if (lastWritebackFeedback.value?.status === 'cancelled') {
      return lastWritebackFeedback.value.message || '本次回写已取消，当前内容仍保留。';
    }
    return '';
  });

  function clearLastFeedback(): void {
    lastWritebackFeedback.value = null;
  }

  function resetWritebackState(): void {
    waitingWritebackFeedback.value = false;
    pendingWritebackRequestId.value = '';
    pendingWritebackMessage.value = '';
    lastWritebackFeedback.value = null;
  }

  function markWritebackPending(requestId: string, message?: string): void {
    pendingWritebackRequestId.value = requestId;
    pendingWritebackMessage.value = message || options.pendingMessage || '病历已发送至 HIS，等待处理结果回执。';
    waitingWritebackFeedback.value = true;
  }

  function applyWritebackFeedback(payload: WritebackFeedbackPayload): WritebackFeedbackPayload | null {
    if (!pendingWritebackRequestId.value) {
      console.warn('[useWritebackStatus] Ignore writeback feedback because there is no pending request', {
        requestId: payload.requestId,
        status: payload.status,
      });
      return null;
    }

    if (payload.requestId !== pendingWritebackRequestId.value) {
      console.warn('[useWritebackStatus] Ignore writeback feedback because requestId does not match pending request', {
        expectedRequestId: pendingWritebackRequestId.value,
        actualRequestId: payload.requestId,
        status: payload.status,
      });
      return null;
    }

    const safePayload: WritebackFeedbackPayload = {
      ...payload,
      action: payload.referenceType || payload.action || 'batch',
      referenceType: payload.referenceType || payload.action || 'batch',
      timestamp: payload.timestamp || Date.now(),
    };
    // 白云已移除互认决策：宿主历史 pending 是中间态，不得误作成功也不得写成失败；
    // 保持等待态与 requestId 关联，透传宿主 message 作中立提示，等待同 requestId 真实终态。
    if (safePayload.status === 'pending') {
      if (payload.message) {
        pendingWritebackMessage.value = payload.message;
      }
      return safePayload;
    }
    lastWritebackFeedback.value = safePayload;
    waitingWritebackFeedback.value = false;
    pendingWritebackRequestId.value = '';
    pendingWritebackMessage.value = '';
    return safePayload;
  }

  return {
    waitingWritebackFeedback,
    pendingWritebackRequestId,
    pendingWritebackMessage,
    lastWritebackFeedback,
    isWritebackBusy,
    submitButtonText,
    writebackBannerTone,
    writebackBannerText,
    clearLastFeedback,
    resetWritebackState,
    markWritebackPending,
    applyWritebackFeedback,
  };
}

export type WritebackStatus = ReturnType<typeof useWritebackStatus>;
