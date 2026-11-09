import { describe, expect, it, vi } from 'vitest';
import { useVoiceTranscriptionReview } from './useVoiceTranscriptionReview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function recording(samples = [100, 200, -300, 400, 500]): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const tag = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index));
  };
  tag(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  tag(8, 'WAVE'); tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  tag(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return new Blob([bytes], { type: 'audio/wav' });
}

const failedFinish = () => Promise.reject(new Error('synthetic transcription failure'));

describe('stopped voice transcription review', () => {
  it('keeps an incomplete draft blocked while the first full transcription is pending or fails', async () => {
    const finish = deferred<string>();
    const retryTranscription = vi.fn();
    const review = useVoiceTranscriptionReview({ retryTranscription });
    const pending = review.complete({
      audio: recording(), prefix: '已审核前段', draft: '未校正草稿', finish: () => finish.promise,
    });

    expect(review.status.value).toBe('transcribing');
    expect(review.isPending.value).toBe(true);
    expect(review.text.value).toBe('已审核前段\n未校正草稿');
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
    expect(review.canRetry.value).toBe(false);
    await review.retry();
    expect(retryTranscription).not.toHaveBeenCalled();

    finish.reject(new Error('synthetic offline'));
    await pending;
    expect(review.status.value).toBe('failed');
    expect(review.errorMessage.value).toContain('整段转写失败');
    expect(review.text.value).toBe('已审核前段\n未校正草稿');
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
    expect(review.canRetry.value).toBe(true);
  });

  it('retries the identical full WAV and replaces the draft without repeating the reviewed prefix', async () => {
    const audio = recording();
    const retryTranscription = vi.fn().mockResolvedValue(' 当前段完整校正文本 ');
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio, prefix: '前段已人工修订', draft: '当前草稿', finish: failedFinish });

    await review.retry();

    expect(retryTranscription).toHaveBeenCalledExactlyOnceWith(audio);
    expect(retryTranscription.mock.calls[0][0]).toBe(audio);
    expect(new Uint8Array(await retryTranscription.mock.calls[0][0].arrayBuffer()))
      .toEqual(new Uint8Array(await audio.arrayBuffer()));
    expect(review.text.value).toBe('前段已人工修订\n当前段完整校正文本');
    expect(review.status.value).toBe('ready');
    expect(review.errorMessage.value).toBe('');
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(true);
    expect(review.canRetry.value).toBe(false);
    await review.retry();
    expect(retryTranscription).toHaveBeenCalledTimes(1);
  });

  it('retains the audio and draft across another failure, so a later retry can recover', async () => {
    const audio = recording();
    const retryTranscription = vi.fn()
      .mockRejectedValueOnce(new Error('still offline'))
      .mockResolvedValueOnce('完整文本');
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio, prefix: '前段', draft: '部分文字', finish: failedFinish });

    await review.retry();
    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('前段\n部分文字');
    expect(review.canRetry.value).toBe(true);
    expect(review.canConfirm.value).toBe(false);
    await review.retry();

    expect(retryTranscription.mock.calls.map(([blob]) => blob)).toEqual([audio, audio]);
    expect(review.text.value).toBe('前段\n完整文本');
    expect(review.canConfirm.value).toBe(true);
  });

  it.each(['', '  \n\t  '])('clears the provisional draft and permits continuation when final transcription returns %j', async (result) => {
    const retryTranscription = vi.fn().mockResolvedValue(result);
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({
      audio: recording(), prefix: '', draft: '可能遗漏尾部的草稿', finish: async () => result,
    });
    expect(review.status.value).toBe('empty');
    expect(review.text.value).toBe('');
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(true);
    expect(review.canRetry.value).toBe(true);
    await review.retry();
    expect(review.status.value).toBe('empty');
    expect(review.canContinue.value).toBe(true);
    expect(review.text.value).toBe('');
    review.text.value = '医生手工补充文字';
    expect(review.canConfirm.value).toBe(true);
  });

  it('preserves a reviewed prefix through a silent continuation without adopting its draft', async () => {
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn() });
    await review.complete({
      audio: recording(), prefix: '前段已由医生修订', draft: '静音段的临时猜测', finish: async () => '',
    });

    expect(review.status.value).toBe('empty');
    expect(review.text.value).toBe('前段已由医生修订');
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(true);
    expect(review.canRetry.value).toBe(true);

    const reviewedPrefix = review.text.value;
    await review.complete({
      audio: recording([800]), prefix: reviewedPrefix, draft: '下一段草稿', finish: async () => '下一段完整文字',
    });
    expect(review.text.value).toBe('前段已由医生修订\n下一段完整文字');
  });

  it('clears a failed draft when a successful retry contains no recognized speech', async () => {
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn().mockResolvedValue('') });
    await review.complete({ audio: recording(), prefix: '已审核前段', draft: '失败前的草稿', finish: failedFinish });
    expect(review.canConfirm.value).toBe(false);

    await review.retry();

    expect(review.status.value).toBe('empty');
    expect(review.text.value).toBe('已审核前段');
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(true);
  });

  it.each([undefined, null, 123, { text: 'unexpected object' }])('keeps malformed result %j blocked rather than treating it as silence', async (result) => {
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn().mockResolvedValue(result) });
    await review.complete({
      audio: recording(), prefix: '已审核前段', draft: '未校正草稿', finish: vi.fn().mockResolvedValue(result),
    });

    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('已审核前段\n未校正草稿');
    expect(review.canContinue.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canRetry.value).toBe(true);
    await review.retry();
    expect(review.status.value).toBe('failed');
    expect(review.canContinue.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
  });

  it('does not offer a retry or confirmation without saved audio', async () => {
    const finish = vi.fn().mockResolvedValue('无音频的文字');
    const retryTranscription = vi.fn();
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio: new Blob([], { type: 'audio/wav' }), prefix: '', draft: '草稿', finish });

    expect(finish).not.toHaveBeenCalled();
    expect(review.status.value).toBe('failed');
    expect(review.errorMessage.value).toContain('录音保存失败');
    expect(review.canRetry.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '医生手动填写';
    expect(review.canEdit.value).toBe(true);
    expect(review.canConfirm.value).toBe(false);
    await review.retry();
    expect(retryTranscription).not.toHaveBeenCalled();
  });

  it('deduplicates rapid retry clicks and keeps confirmation and continuation blocked in flight', async () => {
    const request = deferred<string>();
    const retryTranscription = vi.fn().mockReturnValue(request.promise);
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio: recording(), prefix: '', draft: '草稿', finish: failedFinish });

    const first = review.retry();
    await review.retry();
    expect(retryTranscription).toHaveBeenCalledTimes(1);
    expect(review.isPending.value).toBe(true);
    expect(review.canRetry.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
    request.resolve('完整文本');
    await first;
    expect(review.canConfirm.value).toBe(true);
  });

  it.each(['success', 'failure'] as const)('ignores a late retry %s after reset', async (outcome) => {
    const late = deferred<string>();
    const review = useVoiceTranscriptionReview({ retryTranscription: () => late.promise });
    await review.complete({ audio: recording(), prefix: '旧前段', draft: '旧草稿', finish: failedFinish });
    const pending = review.retry();

    review.reset();
    if (outcome === 'success') late.resolve('旧会话最终结果');
    else late.reject(new Error('old request failed'));
    await pending;

    expect(review.status.value).toBe('idle');
    expect(review.text.value).toBe('');
    expect(review.errorMessage.value).toBe('');
    expect(review.canRetry.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);
  });

  it.each(['success', 'failure'] as const)('ignores an old initial %s after another recording is completed', async (outcome) => {
    const late = deferred<string>();
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn() });
    const oldCompletion = review.complete({ audio: recording(), prefix: '旧前段', draft: '旧草稿', finish: () => late.promise });
    await review.complete({ audio: recording([900]), prefix: '新会话已审核', draft: '新草稿', finish: async () => '新完整文字' });
    if (outcome === 'success') late.resolve('旧完整文字');
    else late.reject(new Error('old request failed'));
    await oldCompletion;

    expect(review.status.value).toBe('ready');
    expect(review.text.value).toBe('新会话已审核\n新完整文字');
    expect(review.errorMessage.value).toBe('');
    expect(review.canConfirm.value).toBe(true);
  });

  it('keeps a new failed recording and its audio when an older retry resolves', async () => {
    const oldRetry = deferred<string>();
    const retryTranscription = vi.fn().mockReturnValueOnce(oldRetry.promise).mockResolvedValueOnce('新段完整文字');
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio: recording(), prefix: '', draft: '旧草稿', finish: failedFinish });
    const pending = review.retry();
    const newAudio = recording([700, 800]);
    await review.complete({ audio: newAudio, prefix: '新前段', draft: '新草稿', finish: failedFinish });
    oldRetry.resolve('旧会话结果');
    await pending;

    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('新前段\n新草稿');
    await review.retry();
    expect(retryTranscription).toHaveBeenLastCalledWith(newAudio);
    expect(review.text.value).toBe('新前段\n新段完整文字');
  });

  it('uses edited final text to determine confirmation eligibility after successful transcription', async () => {
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn() });
    await review.complete({ audio: recording(), prefix: '', draft: '草稿', finish: async () => '完整文字' });
    review.text.value = '  ';
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(true);
    review.text.value = '医生修订文字';
    expect(review.canConfirm.value).toBe(true);
    expect(review.text.value).toBe('医生修订文字');
  });

  it('lets the doctor force-edit a failed draft and confirm only after changing it', async () => {
    const review = useVoiceTranscriptionReview({ retryTranscription: vi.fn() });
    await review.complete({ audio: recording(), prefix: '已审核前段', draft: '未校正草稿', finish: failedFinish });

    expect(review.status.value).toBe('failed');
    expect(review.canEdit.value).toBe(true);
    expect(review.canConfirm.value).toBe(false);
    expect(review.canContinue.value).toBe(false);

    review.text.value = '已审核前段\n医生核对后的文字';
    expect(review.canConfirm.value).toBe(true);
    expect(review.canContinue.value).toBe(false);

    review.text.value = '已审核前段\n未校正草稿';
    expect(review.canConfirm.value).toBe(false);
    review.text.value = '   ';
    expect(review.canConfirm.value).toBe(false);
  });

  it('blocks editing while a retry is in flight and lets a successful retry replace the manual edit', async () => {
    const pending = deferred<string>();
    const review = useVoiceTranscriptionReview({ retryTranscription: () => pending.promise });
    await review.complete({ audio: recording(), prefix: '', draft: '草稿', finish: failedFinish });
    review.text.value = '医生手动修改';
    expect(review.canConfirm.value).toBe(true);

    const retrying = review.retry();
    expect(review.canEdit.value).toBe(false);
    expect(review.canConfirm.value).toBe(false);
    pending.resolve('重试成功的完整转写');
    await retrying;

    expect(review.status.value).toBe('ready');
    expect(review.text.value).toBe('重试成功的完整转写');
    expect(review.canConfirm.value).toBe(true);
  });

  it('keeps a manual edit confirmable when another retry fails', async () => {
    const retryTranscription = vi.fn().mockRejectedValue(new Error('still offline'));
    const review = useVoiceTranscriptionReview({ retryTranscription });
    await review.complete({ audio: recording(), prefix: '', draft: '草稿', finish: failedFinish });
    review.text.value = '第一次手动修改';
    await review.retry();

    expect(review.status.value).toBe('failed');
    expect(review.text.value).toBe('第一次手动修改');
    expect(review.canConfirm.value).toBe(true);
    review.text.value = '草稿';
    expect(review.canConfirm.value).toBe(false);
  });
});
