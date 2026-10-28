// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  speechProvider: 'aliyun-dashscope',
  transcriptionMode: 'batch',
  transcribeAudio: vi.fn(),
  buildRegionalSpeechUploadPayload: vi.fn(async () => ({
    audio: 'encoded-audio',
    mimeType: 'audio/pcm',
    format: 'pcm',
    fileName: 'voice-test.pcm',
    scene: 'voice-consultation',
  })),
  createRegionalWebSocketUrl: vi.fn(async () => 'wss://pcie.example/v1/ai/speech/realtime/ws'),
  regionalPost: vi.fn(async () => ({ text: '完整批量文本' })),
}));

vi.mock('./regionalClient', () => ({
  buildRegionalSpeechUploadPayload: mocks.buildRegionalSpeechUploadPayload,
  createRegionalWebSocketUrl: mocks.createRegionalWebSocketUrl,
  regionalPost: mocks.regionalPost,
}));

vi.mock('./speechConfig', () => ({
  getSpeechConfig: () => ({
    provider: mocks.speechProvider,
    model: 'qwen-audio-3.0-asr-flash-streaming',
    sampleRate: 16000,
    format: 'pcm',
    transcriptionMode: mocks.transcriptionMode,
    segmentDurationMs: 2000,
  }),
  supportsRealtimeSpeech: (provider: string) => provider !== 'openai-compatible',
}));

vi.mock('./llm', () => ({
  transcribeAudio: mocks.transcribeAudio,
}));

vi.mock('./aiTrace', () => ({
  beginAiTrace: () => ({ traceId: 'trace-1', sessionId: 'session-1' }),
  failAiTrace: vi.fn(),
  finishAiTrace: vi.fn(),
}));

import {
  calculateRealtimeReconnectDelay,
  RealtimeSpeechService,
} from './aliyunSpeech';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = 'blob';
  readyState = FakeWebSocket.CONNECTING;
  sent: Array<string | ArrayBufferLike | Blob | ArrayBufferView> = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException('WebSocket is not open');
    }
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    const handler = this.onclose;
    handler?.(new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(payload: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(payload) }));
  }

  remoteClose(code = 1011): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, wasClean: false }));
  }
}

async function startStreamingService(
  onText = vi.fn(),
  reconnectRandom: () => number = () => 0.5,
) {
  const service = new RealtimeSpeechService(reconnectRandom);
  const starting = service.start(onText);
  await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  FakeWebSocket.instances[0].open();
  await starting;
  return { onText, service };
}

describe('RealtimeSpeechService recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    localStorage.removeItem('SPEECH_TEST_MODE');
    mocks.speechProvider = 'aliyun-dashscope';
    mocks.transcriptionMode = 'batch';
    mocks.transcribeAudio.mockReset();
    mocks.buildRegionalSpeechUploadPayload.mockClear();
    mocks.createRegionalWebSocketUrl.mockClear();
    mocks.createRegionalWebSocketUrl.mockImplementation(async () => (
      `wss://pcie.example/v1/ai/speech/realtime/ws?nonce=${mocks.createRegionalWebSocketUrl.mock.calls.length}`
    ));
    mocks.regionalPost.mockClear();
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('calculates non-zero full-jitter delays within the 1/2/4/8/15 second caps', () => {
    const caps = [1000, 2000, 4000, 8000, 15000];

    caps.forEach((cap, attempt) => {
      expect(calculateRealtimeReconnectDelay(attempt, () => 0)).toBe(1);
      expect(calculateRealtimeReconnectDelay(attempt, () => 0.5)).toBe(cap / 2);
      expect(calculateRealtimeReconnectDelay(attempt, () => 1)).toBe(cap);
    });
    expect(calculateRealtimeReconnectDelay(99, () => 1)).toBe(15000);
  });

  it('re-signs after jittered retries and flushes PCM when streaming recovers', async () => {
    const { service } = await startStreamingService();
    const firstSocket = FakeWebSocket.instances[0];

    service.sendAudio(new Int16Array([1, 2]));
    expect(firstSocket.sent).toHaveLength(1);

    firstSocket.remoteClose();
    service.sendAudio(new Int16Array([3, 4]));

    await vi.advanceTimersByTimeAsync(499);
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(2);

    const secondSocket = FakeWebSocket.instances[1];
    expect(secondSocket.sent).toHaveLength(0);

    secondSocket.remoteClose();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);

    const thirdSocket = FakeWebSocket.instances[2];
    thirdSocket.open();
    expect(thirdSocket.sent).toHaveLength(1);
    expect(thirdSocket.sent[0]).toBeInstanceOf(ArrayBuffer);
    expect(mocks.createRegionalWebSocketUrl).toHaveBeenCalledTimes(3);
    expect(new Set(FakeWebSocket.instances.map(socket => socket.url)).size).toBe(3);

    service.close();
  });

  it('cancels a pending reconnect when the recording session closes', async () => {
    const { service } = await startStreamingService();
    FakeWebSocket.instances[0].remoteClose();
    expect(vi.getTimerCount()).toBe(1);

    service.close();
    await vi.runAllTimersAsync();

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(mocks.createRegionalWebSocketUrl).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a cancelled reconnect revive inside a newly started session', async () => {
    const { service } = await startStreamingService();
    FakeWebSocket.instances[0].remoteClose();
    expect(vi.getTimerCount()).toBe(1);

    service.close();
    const restarted = service.start();
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    FakeWebSocket.instances[1].open();
    await restarted;
    await vi.runAllTimersAsync();

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(mocks.createRegionalWebSocketUrl).toHaveBeenCalledTimes(2);
    service.close();
  });

  it('uses the complete buffered recording when a streaming interruption occurred', async () => {
    const onText = vi.fn();
    const { service } = await startStreamingService(onText);
    const firstSocket = FakeWebSocket.instances[0];
    firstSocket.receive({ type: 'text', text: '前半段', isSentenceEnd: true });
    service.sendAudio(new Int16Array([1, 2]));

    firstSocket.remoteClose();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeWebSocket.instances).toHaveLength(2);
    const secondSocket = FakeWebSocket.instances[1];
    service.sendAudio(new Int16Array([3, 4]));
    secondSocket.open();
    secondSocket.receive({ type: 'text', text: '后半段', isSentenceEnd: true });

    const finishing = service.finish();
    expect(secondSocket.sent).toContain(JSON.stringify({ type: 'finish' }));
    secondSocket.receive({ type: 'final', text: '后半段' });

    await expect(finishing).resolves.toBe('完整批量文本');
    expect(mocks.regionalPost).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenLastCalledWith('完整批量文本', true);
  });

  it('uses the same HTTP model for drafts and replaces them with a full-recording final response', async () => {
    mocks.speechProvider = 'openai-compatible';
    mocks.transcriptionMode = 'segmented';
    mocks.transcribeAudio.mockResolvedValueOnce('分段草稿').mockResolvedValueOnce('完整校正文本');
    const service = new RealtimeSpeechService();
    const onText = vi.fn();
    await service.start(onText);
    service.sendAudio(new Int16Array(32000));
    await vi.waitFor(() => expect(onText).toHaveBeenCalledWith('分段草稿', false));
    service.sendAudio(new Int16Array(16000));
    await expect(service.finish()).resolves.toBe('完整校正文本');
    expect(onText).toHaveBeenLastCalledWith('完整校正文本', true);
    expect(mocks.transcribeAudio.mock.calls[0][0].size).toBe(64000);
    expect(mocks.transcribeAudio.mock.calls[0][2].maxRetries).toBe(0);
    expect(mocks.transcribeAudio.mock.calls[1][0].size).toBe(96000);
    expect(mocks.createRegionalWebSocketUrl).not.toHaveBeenCalled();
  });

  it('does not run preview requests for an old batch-only configuration', async () => {
    mocks.speechProvider = 'openai-compatible';
    mocks.transcribeAudio.mockResolvedValue('整段文本');
    const service = new RealtimeSpeechService();
    await service.start();
    service.sendAudio(new Int16Array(64000));
    await Promise.resolve();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    await expect(service.finish()).resolves.toBe('整段文本');
  });

  it('avoids extra preview calls when the caller only consumes final text', async () => {
    mocks.speechProvider = 'openai-compatible';
    mocks.transcriptionMode = 'segmented';
    mocks.transcribeAudio.mockResolvedValue('最终文本');
    const service = new RealtimeSpeechService();
    await service.start();
    service.sendAudio(new Int16Array(64000));
    await Promise.resolve();
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    await expect(service.finish()).resolves.toBe('最终文本');
    expect(mocks.transcribeAudio).toHaveBeenCalledTimes(1);
  });

  it('does not let a late final HTTP response notify or close a newly started session', async () => {
    mocks.speechProvider = 'openai-compatible';
    mocks.transcriptionMode = 'segmented';
    let resolveOld!: (text: string) => void;
    mocks.transcribeAudio.mockReturnValueOnce(new Promise<string>(resolve => { resolveOld = resolve; }))
      .mockResolvedValueOnce('新会话草稿');
    const service = new RealtimeSpeechService();
    const oldCallback = vi.fn();
    await service.start(oldCallback);
    service.sendAudio(new Int16Array(100));
    const oldFinish = service.finish();
    const nextCallback = vi.fn();
    await service.start(nextCallback);
    resolveOld('旧会话最终结果');
    await oldFinish;
    expect(oldCallback).not.toHaveBeenCalled();
    expect(nextCallback).not.toHaveBeenCalled();
    service.sendAudio(new Int16Array(32000));
    await vi.waitFor(() => expect(nextCallback).toHaveBeenCalledWith('新会话草稿', false));
    service.close();
  });
});
