import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  regionalPost: vi.fn(),
  regionalGet: vi.fn(),
  createRegionalSSE: vi.fn(),
}));

vi.mock('./regionalClient', () => ({
  getCachedBootstrap: () => ({ llm: { model: 'managed-model', audioModel: 'managed-audio' } }),
  regionalPost: mocks.regionalPost,
  regionalGet: mocks.regionalGet,
  createRegionalSSE: mocks.createRegionalSSE,
  buildRegionalSpeechUploadPayload: vi.fn(async () => ({ audio: 'encoded', mimeType: 'audio/webm' })),
}));

vi.mock('./aiTrace', () => ({
  beginAiTrace: () => ({ traceId: 'trace-1', sessionId: 'session-1' }),
  failAiTrace: vi.fn(),
  finishAiTrace: vi.fn(),
  updateAiTraceRequestPayload: vi.fn(),
}));

import { chat, chatStream, transcribeAudio } from './llm';

describe('server-managed LLM routing', () => {
  beforeEach(() => {
    mocks.regionalPost.mockReset();
    mocks.createRegionalSSE.mockReset();
  });

  it('routes non-stream chat through the signed server endpoint', async () => {
    mocks.regionalPost.mockResolvedValue({ content: 'ok' });
    await expect(chat([{ role: 'user', content: 'hello' }])).resolves.toBe('ok');
    expect(mocks.regionalPost).toHaveBeenCalledWith('/v1/ai/chat', expect.objectContaining({ stream: false }));
  });

  it('routes streaming chat through the signed SSE endpoint', async () => {
    mocks.createRegionalSSE.mockImplementation(async (_path, _body, onChunk) => onChunk('chunk'));
    const chunks: string[] = [];
    await chatStream([{ role: 'user', content: 'hello' }], chunk => chunks.push(chunk));
    expect(mocks.createRegionalSSE).toHaveBeenCalledWith('/v1/ai/chat', expect.objectContaining({ stream: true }), expect.any(Function));
    expect(chunks).toEqual(['chunk']);
  });

  it('preserves explicit zero temperature for voice streaming and fallback without changing default calls', async () => {
    mocks.createRegionalSSE.mockResolvedValue(undefined);
    mocks.regionalPost.mockResolvedValue({ content: 'ok' });
    const messages = [{ role: 'user' as const, content: 'sample' }];
    await chatStream(messages, vi.fn(), undefined, undefined, undefined, { temperature: 0 });
    await chat(messages, undefined, undefined, undefined, { temperature: 0 });
    expect(mocks.createRegionalSSE.mock.calls[0][1].temperature).toBe(0);
    expect(mocks.regionalPost.mock.calls[0][1].temperature).toBe(0);
    await chatStream(messages, vi.fn());
    await chat(messages);
    expect(mocks.createRegionalSSE.mock.calls[1][1]).not.toHaveProperty('temperature');
    expect(mocks.regionalPost.mock.calls[1][1]).not.toHaveProperty('temperature');
  });

  it('forwards the business action and title for server-side latency logs', async () => {
    mocks.regionalPost.mockResolvedValue({ content: 'ok' });

    await chat([{ role: 'user', content: 'hello' }], undefined, undefined, undefined, {
      traceContext: {
        scene: 'current-information-medication',
        sourceModule: 'voice_treatment_recommendation',
        operationAction: 'assess_medication_with_current_information',
        title: '医生主动基于现有信息评估用药',
      },
    });

    expect(mocks.regionalPost).toHaveBeenCalledWith(
      '/v1/ai/chat',
      expect.objectContaining({
        operationAction: 'assess_medication_with_current_information',
        operationTitle: '医生主动基于现有信息评估用药',
      }),
    );
  });

  it('enables web search only for the assistant streaming scene', async () => {
    mocks.createRegionalSSE.mockResolvedValue(undefined);

    await chatStream([{ role: 'user', content: 'latest guidance' }], vi.fn(), undefined, undefined, undefined, {
      enableWebSearch: true,
      traceContext: {
        scene: 'chat-stream',
        sourceModule: 'chat_panel',
      },
    });

    expect(mocks.createRegionalSSE).toHaveBeenCalledWith(
      '/v1/ai/chat',
      expect.objectContaining({ enableSearch: true, stream: true }),
      expect.any(Function),
    );
  });

  it('rejects web search intent outside the assistant streaming scene', async () => {
    mocks.createRegionalSSE.mockResolvedValue(undefined);

    await chatStream([{ role: 'user', content: 'clinical task' }], vi.fn(), undefined, undefined, undefined, {
      enableWebSearch: true,
      traceContext: {
        scene: 'voice-intent-recognition',
        sourceModule: 'voice_consultation',
      },
    });

    expect(mocks.createRegionalSSE).toHaveBeenCalledWith(
      '/v1/ai/chat',
      expect.objectContaining({ enableSearch: false, stream: true }),
      expect.any(Function),
    );
  });

  it('keeps web search disabled by default', async () => {
    mocks.createRegionalSSE.mockResolvedValue(undefined);

    await chatStream([{ role: 'user', content: 'hello' }], vi.fn(), undefined, undefined, undefined, {
      traceContext: {
        scene: 'chat-stream',
        sourceModule: 'chat_panel',
      },
    });

    expect(mocks.createRegionalSSE).toHaveBeenCalledWith(
      '/v1/ai/chat',
      expect.objectContaining({ enableSearch: false, stream: true }),
      expect.any(Function),
    );
  });

  it('routes transcription through the signed server endpoint', async () => {
    mocks.regionalPost.mockResolvedValue({ text: 'transcript' });
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    await expect(transcribeAudio(blob)).resolves.toBe('transcript');
    expect(mocks.regionalPost).toHaveBeenCalledWith('/v1/ai/speech/transcribe', expect.objectContaining({ audio: 'encoded' }));
  });
});
