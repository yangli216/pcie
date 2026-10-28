import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  regionalPost: vi.fn(),
  beginAiTrace: vi.fn(() => ({ traceId: 'speech-trace', sessionId: 'speech-session' })),
  updateAiTraceRequestPayload: vi.fn(),
  finishAiTrace: vi.fn(),
  failAiTrace: vi.fn(),
}));

vi.mock('./regionalClient', async () => ({
  getCachedBootstrap: () => ({ llm: { audioModel: 'SenseVoiceSmall' } }),
  regionalPost: mocks.regionalPost,
  createRegionalSSE: vi.fn(),
  buildRegionalSpeechUploadPayload: (await import('./regional/speechUpload')).buildRegionalSpeechUploadPayload,
}));

vi.mock('./aiTrace', () => ({
  beginAiTrace: mocks.beginAiTrace,
  updateAiTraceRequestPayload: mocks.updateAiTraceRequestPayload,
  finishAiTrace: mocks.finishAiTrace,
  failAiTrace: mocks.failAiTrace,
}));

import { DEFAULT_RETRY_CONFIG, transcribeAudio } from './llm';

const noRetry = { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 };

function pcmWav(): Uint8Array {
  const bytes = new Uint8Array(48);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF'); view.setUint32(4, 40, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, 4, true);
  view.setInt16(44, -123, true); view.setInt16(46, 456, true);
  return bytes;
}

describe('speech upload format preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.regionalPost.mockReset();
  });

  it('retries the complete WAV as WAV without stripping or duplicating its header', async () => {
    const bytes = pcmWav();
    const blob = new Blob([bytes], { type: 'audio/wav' });
    mocks.regionalPost.mockResolvedValue({ text: '完整转写' });

    await expect(transcribeAudio(blob, undefined, noRetry)).resolves.toBe('完整转写');

    expect(mocks.regionalPost).toHaveBeenCalledTimes(1);
    const [endpoint, payload] = mocks.regionalPost.mock.calls[0];
    expect(endpoint).toBe('/v1/ai/speech/transcribe');
    expect(payload).toMatchObject({
      mimeType: 'audio/wav',
      fileName: expect.stringMatching(/^chat-input-\d+\.wav$/),
      traceId: 'speech-trace',
      sessionId: 'speech-session',
    });
    expect(payload.format).toBeUndefined();
    expect(Uint8Array.from(atob(payload.audio), character => character.charCodeAt(0))).toEqual(bytes);
    expect(mocks.updateAiTraceRequestPayload).toHaveBeenCalledWith('speech-trace',
      expect.objectContaining({ fileName: payload.fileName, mimeType: 'audio/wav', audioSize: 48 }),
      expect.stringContaining(payload.fileName));
    expect(mocks.finishAiTrace).toHaveBeenCalledWith('speech-trace',
      expect.objectContaining({ success: true, responsePayload: { text: '完整转写' } }));
  });

  it.each([
    ['audio/webm', 'webm', 'audio/webm'],
    ['audio/pcm', 'pcm', 'audio/pcm'],
    ['', 'webm', 'audio/webm'],
  ])('preserves existing %s uploads and derives the matching extension', async (mimeType, extension, uploadMimeType) => {
    const bytes = new Uint8Array([0, 255, 17, 128]);
    mocks.regionalPost.mockResolvedValue({ text: '转写' });
    await transcribeAudio(new Blob([bytes], { type: mimeType }), undefined, noRetry);

    const payload = mocks.regionalPost.mock.calls[0][1];
    expect(payload.mimeType).toBe(uploadMimeType);
    expect(payload.fileName).toMatch(new RegExp(`^chat-input-\\d+\\.${extension}$`));
    expect(Uint8Array.from(atob(payload.audio), character => character.charCodeAt(0))).toEqual(bytes);
  });

  it('honors an explicit zero retry count and records a failed trace', async () => {
    const failure = new Error('service unavailable');
    mocks.regionalPost.mockRejectedValue(failure);
    const onRetry = vi.fn();
    await expect(transcribeAudio(new Blob([pcmWav()], { type: 'audio/wav' }), undefined, noRetry, onRetry))
      .rejects.toBe(failure);

    expect(mocks.regionalPost).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
    expect(mocks.failAiTrace).toHaveBeenCalledWith('speech-trace', 'service unavailable');
    expect(mocks.finishAiTrace).not.toHaveBeenCalled();
  });
});
