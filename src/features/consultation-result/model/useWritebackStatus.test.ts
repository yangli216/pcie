import { describe, expect, it } from 'vitest';
import { useWritebackStatus } from './useWritebackStatus';

describe('useWritebackStatus', () => {
  it('keeps cancelled feedback as a non-error terminal message', () => {
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');

    status.applyWritebackFeedback({
      requestId: 'request-1',
      status: 'cancelled',
      message: '本次回写已取消',
    });

    expect(status.waitingWritebackFeedback.value).toBe(false);
    expect(status.writebackBannerTone.value).toBe('info');
    expect(status.writebackBannerText.value).toBe('本次回写已取消');
  });

  it('keeps the pending association and shows a neutral waiting message when feedback is pending', () => {
    // 白云已移除互认决策：宿主历史 pending 是中间态，不得清算等待态，也不得写成失败
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');

    const applied = status.applyWritebackFeedback({
      requestId: 'request-1',
      status: 'pending',
      message: '存在可互认的检验检查项目，请医生在智医端决策',
    });

    expect(applied).not.toBeNull();
    expect(status.waitingWritebackFeedback.value).toBe(true);
    expect(status.pendingWritebackRequestId.value).toBe('request-1');
    expect(status.lastWritebackFeedback.value).toBeNull();
    expect(status.writebackBannerTone.value).toBe('info');
    expect(status.writebackBannerText.value).toBe('存在可互认的检验检查项目，请医生在智医端决策');
  });

  it('keeps the default waiting message when pending feedback has no message', () => {
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');

    status.applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });

    expect(status.waitingWritebackFeedback.value).toBe(true);
    expect(status.writebackBannerText.value).toBe('病历已发送至 HIS，等待处理结果回执。');
  });

  it('accepts a late real success for the same requestId after pending and finalizes exactly once', () => {
    // #012 C2：pending 后同 requestId 的真实 success 不得被身份校验拒绝
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');
    status.applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });

    const applied = status.applyWritebackFeedback({
      requestId: 'request-1',
      status: 'success',
      message: 'HIS 已完成保存',
    });

    expect(applied).not.toBeNull();
    expect(status.waitingWritebackFeedback.value).toBe(false);
    expect(status.pendingWritebackRequestId.value).toBe('');
    expect(status.lastWritebackFeedback.value?.status).toBe('success');

    // 相同终态重复不重复收尾
    expect(status.applyWritebackFeedback({ requestId: 'request-1', status: 'success' })).toBeNull();
    expect(status.lastWritebackFeedback.value?.status).toBe('success');
  });

  it('accepts a late real failed for the same requestId after pending', () => {
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');
    status.applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });

    const applied = status.applyWritebackFeedback({
      requestId: 'request-1',
      status: 'failed',
      message: 'HIS 保存失败',
    });

    expect(applied).not.toBeNull();
    expect(status.waitingWritebackFeedback.value).toBe(false);
    expect(status.writebackBannerTone.value).toBe('error');
    expect(status.writebackBannerText.value).toBe('HIS 保存失败');
  });

  it('isolates an old pending request once a new request has started', () => {
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');
    status.applyWritebackFeedback({ requestId: 'request-1', status: 'pending' });

    status.markWritebackPending('request-2');

    expect(status.applyWritebackFeedback({ requestId: 'request-1', status: 'success' })).toBeNull();
    expect(status.waitingWritebackFeedback.value).toBe(true);
    expect(status.pendingWritebackRequestId.value).toBe('request-2');
  });

  it('ignores feedback whose requestId does not match the pending request', () => {
    const status = useWritebackStatus();
    status.markWritebackPending('request-1');

    expect(status.applyWritebackFeedback({ requestId: 'other', status: 'success' })).toBeNull();
    expect(status.waitingWritebackFeedback.value).toBe(true);
  });
});
