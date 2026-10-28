import { describe, expect, it, vi } from 'vitest';
import { mergeSpeechSegments, SegmentedSpeechTranscriber } from './segmentedSpeechTranscriber';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('segmented transcription', () => {
  it('merges overlapping Chinese / English text but keeps distinct repetitions and empty results', () => {
    expect(mergeSpeechSegments('患者头痛，', '头痛三天。')).toBe('患者头痛三天。');
    expect(mergeSpeechSegments('Hello world', 'world again')).toBe('Hello world again');
    expect(mergeSpeechSegments('好', '好')).toBe('好好');
    expect(mergeSpeechSegments('已有结果', '  ')).toBe('已有结果');
  });

  it('emits drafts before stop and carries a 500ms overlap into the next request', async () => {
    const transcribe = vi.fn().mockResolvedValueOnce('患者头痛').mockResolvedValueOnce('头痛三天。');
    const onText = vi.fn();
    const service = new SegmentedSpeechTranscriber({ sampleRate: 10, segmentDurationMs: 2000, transcribe, onText });
    service.push(new Int16Array(19)); await flush();
    expect(transcribe).not.toHaveBeenCalled();
    service.push(new Int16Array(1)); await flush();
    expect(onText).toHaveBeenLastCalledWith('患者头痛');
    service.push(new Int16Array(20)); await flush();
    expect(transcribe.mock.calls[1][0].size).toBe(50); // 20 new samples + 5 overlap, 16 bit.
    expect(onText).toHaveBeenLastCalledWith('患者头痛三天。');
  });

  it('serializes slow requests and retains only a bounded recent preview window', async () => {
    const pending = deferred<string>();
    const transcribe = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue('后续文本');
    const onText = vi.fn();
    const service = new SegmentedSpeechTranscriber({ sampleRate: 10, segmentDurationMs: 2000, transcribe, onText });
    service.push(new Int16Array(20)); await flush();
    for (let i = 0; i < 20; i++) service.push(new Int16Array(20));
    await flush(); expect(transcribe).toHaveBeenCalledTimes(1);
    pending.resolve('首段文本'); await flush();
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(transcribe.mock.calls[1][0].size).toBe(80); // Two segments maximum; old overlap discarded after a gap.
  });

  it('recovers after failed or empty drafts and discards late callbacks after close', async () => {
    const late = deferred<string>();
    const transcribe = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('').mockReturnValueOnce(late.promise);
    const onText = vi.fn(); const onError = vi.fn();
    const service = new SegmentedSpeechTranscriber({ sampleRate: 10, segmentDurationMs: 2000, transcribe, onText, onError });
    service.push(new Int16Array(20)); await flush(); expect(onError).toHaveBeenCalledTimes(1);
    service.push(new Int16Array(20)); await flush(); expect(onText).not.toHaveBeenCalled();
    service.push(new Int16Array(20)); await flush(); service.close(); late.resolve('旧患者内容'); await flush();
    service.push(new Int16Array(100)); await flush(); expect(onText).not.toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledTimes(3);
  });
});
