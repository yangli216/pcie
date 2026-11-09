import type { WritebackFeedbackPayload } from './useWritebackStatus';

export type WritebackFeedbackNotify = (message: string, type?: string) => void;

export interface WritebackFeedbackControllerOptions {
  applyFeedback: (payload: WritebackFeedbackPayload) => WritebackFeedbackPayload | null;
  notify?: WritebackFeedbackNotify;
  onSuccess?: (payload: WritebackFeedbackPayload) => void;
  onFailed?: (payload: WritebackFeedbackPayload) => void;
  onCancelled?: (payload: WritebackFeedbackPayload) => void;
  successMessage?: string;
  failedMessage?: string;
  pendingMessage?: string;
}

export function useWritebackFeedbackController(options: WritebackFeedbackControllerOptions) {
  function applyWritebackFeedback(payload: WritebackFeedbackPayload): WritebackFeedbackPayload | null {
    const safePayload = options.applyFeedback(payload);
    if (!safePayload) {
      return null;
    }

    if (safePayload.status === 'pending') {
      // 白云已移除互认决策：宿主历史 pending 是中间态，不是终态，
      // 只发中立"尚未完成"提示，不调 onSuccess/onFailed/onCancelled，
      // 保持等待态直到同 requestId 的真实终态到达。
      options.notify?.(
        safePayload.message || options.pendingMessage || 'HIS 正在处理本次回写，请等待结果回执。',
        'info',
      );
      return safePayload;
    }

    if (safePayload.status === 'success') {
      options.onSuccess?.(safePayload);
      options.notify?.(safePayload.message || options.successMessage || 'HIS 已完成回写。', 'success');
      return safePayload;
    }

    if (safePayload.status === 'cancelled') {
      options.onCancelled?.(safePayload);
      options.notify?.(safePayload.message || '本次回写已取消，当前内容仍保留。', 'info');
      return safePayload;
    }

    options.onFailed?.(safePayload);
    options.notify?.(safePayload.message || options.failedMessage || 'HIS 回写失败，请根据提示修改后重试。', 'error');
    return safePayload;
  }

  return {
    applyWritebackFeedback,
  };
}

export type WritebackFeedbackController = ReturnType<typeof useWritebackFeedbackController>;
