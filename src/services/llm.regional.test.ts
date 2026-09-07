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
