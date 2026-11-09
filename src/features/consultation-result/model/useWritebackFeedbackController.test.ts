import { describe, expect, it, vi } from 'vitest';
import { useWritebackFeedbackController } from './useWritebackFeedbackController';
import { useWritebackStatus } from './useWritebackStatus';

describe('useWritebackFeedbackController', () => {
  it('passes success feedback through with identity semantics', () => {
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const notify = vi.fn();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: (payload) => payload,
      notify,
      onSuccess,
      onFailed,
    });

    const result = applyWritebackFeedback({
      requestId: 'request-1',
      status: 'success',
      message: 'PHIS 已完成保存',
    });

    expect(result).not.toBeNull();
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onFailed).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('PHIS 已完成保存', 'success');
  });

  it('notifies a neutral waiting message on pending without treating it as success or failed', () => {
    // 白云已移除互认决策：宿主历史 pending 是中间态，不调终态回调、不写成失败
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const onCancelled = vi.fn();
    const notify = vi.fn();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: (payload) => payload,
      notify,
      onSuccess,
      onFailed,
      onCancelled,
    });

    const result = applyWritebackFeedback({
      requestId: 'request-1',
      status: 'pending',
      message: '存在可互认的检验检查项目，请医生在智医端决策',
    });

    expect(result).not.toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onCancelled).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('存在可互认的检验检查项目，请医生在智医端决策', 'info');
  });

  it('falls back to a neutral waiting message when pending feedback has no message', () => {
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const notify = vi.fn();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: (payload) => payload,
      notify,
      onSuccess,
      onFailed,
    });

    applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('HIS 正在处理本次回写，请等待结果回执。', 'info');
  });

  it('keeps the request associated through pending and finalizes on the late real success exactly once (C2)', () => {
    // 真实处理器链：useWritebackStatus + useWritebackFeedbackController，不 mock 核心
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const notify = vi.fn();
    const status = useWritebackStatus();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: status.applyWritebackFeedback,
      notify,
      onSuccess,
      onFailed,
      successMessage: 'HIS 已完成回写。',
    });

    status.markWritebackPending('request-1');
    applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });
    expect(status.waitingWritebackFeedback.value).toBe(true);
    expect(onSuccess).not.toHaveBeenCalled();

    applyWritebackFeedback({ requestId: 'request-1', status: 'success' });
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(status.waitingWritebackFeedback.value).toBe(false);

    // 相同终态重复不重复收尾
    applyWritebackFeedback({ requestId: 'request-1', status: 'success' });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('does not swallow a real failed feedback', () => {
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const notify = vi.fn();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: (payload) => payload,
      notify,
      onSuccess,
      onFailed,
      failedMessage: 'HIS 回写失败，请根据提示修改后重试。',
    });

    applyWritebackFeedback({ requestId: 'request-1', status: 'failed' });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('HIS 回写失败，请根据提示修改后重试。', 'error');
  });

  it('propagates a rejected applyFeedback (requestId mismatch) without touching the page state', () => {
    const onSuccess = vi.fn();
    const onFailed = vi.fn();
    const notify = vi.fn();
    const { applyWritebackFeedback } = useWritebackFeedbackController({
      applyFeedback: () => null,
      notify,
      onSuccess,
      onFailed,
    });

    expect(applyWritebackFeedback({ requestId: 'other', status: 'success' })).toBeNull();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
