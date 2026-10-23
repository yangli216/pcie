import { getCachedBootstrap } from './regionalClient';

export type SpeechProvider = 'aliyun-dashscope' | 'openai-compatible' | 'funasr-websocket';

export interface SpeechConfig {
  provider: SpeechProvider;
  model: string;
  sampleRate: number;
  format: string;
  transcriptionMode: 'batch' | 'segmented';
  segmentDurationMs: number;
}

export const DEFAULT_SPEECH_CONFIG: SpeechConfig = {
  provider: 'aliyun-dashscope',
  model: 'paraformer-realtime-v2',
  sampleRate: 16000,
  format: 'pcm',
  transcriptionMode: 'batch',
  segmentDurationMs: 4000,
};

function normalizeSpeechProvider(raw?: string | null): SpeechProvider {
  if (raw === 'openai-compatible') return 'openai-compatible';
  if (raw === 'funasr-websocket' || raw === 'funasr') return 'funasr-websocket';
  return 'aliyun-dashscope';
}

export function supportsRealtimeSpeech(provider: SpeechProvider): boolean {
  return provider === 'aliyun-dashscope' || provider === 'funasr-websocket';
}

export function getSpeechConfig(): SpeechConfig {
  const bootstrap = getCachedBootstrap();
  const provider = normalizeSpeechProvider(bootstrap?.speech?.provider);
  const duration = bootstrap?.speech?.segmentDurationMs;
  return {
    provider,
    model: bootstrap?.speech?.model
      || (provider === 'openai-compatible'
        ? bootstrap?.llm?.audioModel || 'whisper-1'
        : provider === 'funasr-websocket'
          ? 'funasr-2pass'
          : DEFAULT_SPEECH_CONFIG.model),
    sampleRate: DEFAULT_SPEECH_CONFIG.sampleRate,
    format: DEFAULT_SPEECH_CONFIG.format,
    transcriptionMode: provider === 'openai-compatible' && bootstrap?.speech?.transcriptionMode === 'segmented'
      ? 'segmented' : 'batch',
    segmentDurationMs: typeof duration === 'number' && Number.isInteger(duration) && duration >= 2000 && duration <= 15000
      ? duration : DEFAULT_SPEECH_CONFIG.segmentDurationMs,
  };
}
