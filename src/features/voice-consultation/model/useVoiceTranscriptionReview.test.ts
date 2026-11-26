import { describe, expect, it, vi } from 'vitest';
import { useVoiceTranscriptionReview } from './useVoiceTranscriptionReview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const audio = new Blob([new Int16Array([100, 200, -300])], { type: 'audio/pcm' });
const failedFinish = () => Promise.reject(new Error('synthetic transcription failure'));

describe('stopped voice transcription review', () => {
  it('keeps the draft read-only while transcribing and editable after a failure', async () => {
    const finish = deferred<string>();
    const review = useVoiceTranscriptionReview();
    const pending = review.complete({
      audio, prefix: '已审核前段', draft: '未校正草稿', finish: () => finish.promise,
    });

    expect(review.status.value).toBe('transcribing');
    expect(review.canEdit.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);

    finish.reject(new Error('synthetic offline'));
    await pending;
    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('已审核前段\n未校正草稿');
    expect(review.canEdit.value).toBe(true);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
  });

  it('uses the final text for the current segment and keeps the reviewed prefix', async () => {
    const review = useVoiceTranscriptionReview();
    await review.complete({
      audio, prefix: '前段已人工修订', draft: '当前草稿', finish: async () => ' 当前段完整文字 ',
    });
    expect(review.text.value).toBe('前段已人工修订\n当前段完整文字');
    expect(review.status.value).toBe('ready');
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(true);
    review.text.value = '  ';
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '医生修订文字';
    expect(review.canConfirm.value).toBe(true);
  });

  it.each(['', '  \n\t  '])('retains the prefix and draft when final transcription returns %j', async (result) => {
    const review = useVoiceTranscriptionReview();
    await review.complete({
      audio, prefix: '前段已由医生修订', draft: '待核对的草稿', finish: async () => result,
    });
    expect(review.status.value).toBe('empty');
    expect(review.text.value).toBe('前段已由医生修订\n待核对的草稿');
    expect(review.canEdit.value).toBe(true);
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(true);
  });

  it('allows continuing a silent recording with no draft and requires text to confirm', async () => {
    const review = useVoiceTranscriptionReview();
    await review.complete({ audio, prefix: '', draft: '', finish: async () => '' });
    expect(review.canContinue.value).toBe(true);
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '医生手工补充文字';
    expect(review.canConfirm.value).toBe(true);
  });

  it.each([undefined, null, 123, { text: 'unexpected object' }])('marks malformed result %j as failed', async (result) => {
    const review = useVoiceTranscriptionReview();
    await review.complete({
      audio, prefix: '已审核前段', draft: '未校正草稿', finish: vi.fn().mockResolvedValue(result),
    });
    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('已审核前段\n未校正草稿');
    expect(review.canContinue.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
  });

  it('allows doctor-edited confirmation without saved audio', async () => {
    const finish = vi.fn();
    const review = useVoiceTranscriptionReview();
    await review.complete({ audio: new Blob([]), prefix: '前段已审核文字', draft: '', finish });
    expect(finish).not.toHaveBeenCalled();
    expect(review.status.value).toBe('failed');
    expect(review.errorMessage.value).toBe('录音保存失败');
    expect(review.text.value).toBe('前段已审核文字');
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '前段已审核文字\n本段由医生手动补充';
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(false);
  });

  it('lets the doctor confirm a failed draft only after changing it to different non-empty text', async () => {
    const review = useVoiceTranscriptionReview();
    await review.complete({ audio, prefix: '已审核前段', draft: '未校正草稿', finish: failedFinish });

    review.text.value = '已审核前段\n医生核对后的文字';
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(false);
    review.text.value = '  已审核前段\n未校正草稿  ';
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '   ';
    expect(review.canConfirm.value).toBe(false);
  });

  it.each(['success', 'failure'] as const)('ignores late transcription %s after reset', async (outcome) => {
    const late = deferred<string>();
    const review = useVoiceTranscriptionReview();
    const pending = review.complete({ audio, prefix: '旧前段', draft: '旧草稿', finish: () => late.promise });

    review.reset();
    if (outcome === 'success') late.resolve('旧会话最终结果');
    else late.reject(new Error('old request failed'));
    await pending;

    expect(review.status.value).toBe('idle');
    expect(review.text.value).toBe('');
    expect(review.errorMessage.value).toBe('');
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
  });

  it.each(['success', 'failure'] as const)('ignores an old %s after another recording is completed', async (outcome) => {
    const late = deferred<string>();
    const review = useVoiceTranscriptionReview();
    const oldCompletion = review.complete({ audio, prefix: '旧前段', draft: '旧草稿', finish: () => late.promise });
    await review.complete({ audio, prefix: '新会话已审核', draft: '新草稿', finish: async () => '新完整文字' });
    if (outcome === 'success') late.resolve('旧完整文字');
    else late.reject(new Error('old request failed'));
    await oldCompletion;

    expect(review.status.value).toBe('ready');
    expect(review.text.value).toBe('新会话已审核\n新完整文字');
    expect(review.errorMessage.value).toBe('');
    expect(review.canConfirm.value).toBe(true);
  });
});
