import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  bootstrap: null as null | {
    llm: { model: string; audioModel?: string };
    speech?: { provider: string; model?: string; transcriptionMode?: 'batch' | 'segmented'; segmentDurationMs?: number };
  },
}));

vi.mock('./regionalClient', () => ({
  getCachedBootstrap: () => state.bootstrap,
}));

import { getSpeechConfig, supportsRealtimeSpeech } from './speechConfig';

describe('speech config', () => {
  beforeEach(() => {
    state.bootstrap = null;
  });

  it('normalizes FunASR bootstrap config and enables regional streaming', () => {
    state.bootstrap = {
      llm: { model: 'managed-model', audioModel: 'whisper-1' },
      speech: { provider: 'funasr-websocket', model: 'hospital-funasr' },
    };

    const config = getSpeechConfig();

    expect(config.provider).toBe('funasr-websocket');
    expect(config.model).toBe('hospital-funasr');
    expect(config.sampleRate).toBe(16000);
    expect(config.format).toBe('pcm');
    expect(supportsRealtimeSpeech(config.provider)).toBe(true);
  });

  it('uses the FunASR display default when the server omits a model', () => {
    state.bootstrap = {
      llm: { model: 'managed-model' },
      speech: { provider: 'funasr' },
    };

    expect(getSpeechConfig()).toEqual({
      provider: 'funasr-websocket',
      model: 'funasr-2pass',
      sampleRate: 16000,
      format: 'pcm',
      transcriptionMode: 'batch',
      segmentDurationMs: 4000,
    });
  });

  it('keeps OpenAI-compatible transcription in batch mode', () => {
    state.bootstrap = {
      llm: { model: 'managed-model', audioModel: 'whisper-1' },
      speech: { provider: 'openai-compatible' },
    };

    const config = getSpeechConfig();

    expect(config.model).toBe('whisper-1');
    expect(supportsRealtimeSpeech(config.provider)).toBe(false);
    expect(config.transcriptionMode).toBe('batch');
  });

  it('accepts segmented configuration only for the compatible provider and bounds the duration', () => {
    state.bootstrap = { llm: { model: 'model', audioModel: 'SenseVoiceSmall' },
      speech: { provider: 'openai-compatible', transcriptionMode: 'segmented', segmentDurationMs: 3000 } };
    expect(getSpeechConfig()).toMatchObject({ transcriptionMode: 'segmented', segmentDurationMs: 3000 });
    for (const invalid of [1999, 15001, 3000.5, NaN]) {
      state.bootstrap.speech!.segmentDurationMs = invalid;
      expect(getSpeechConfig().segmentDurationMs).toBe(4000);
    }
    state.bootstrap.speech!.provider = 'funasr-websocket';
    expect(getSpeechConfig().transcriptionMode).toBe('batch');
  });
});
