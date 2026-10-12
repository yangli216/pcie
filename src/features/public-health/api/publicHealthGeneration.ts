import { regionalRequestResponse } from '@/services/regionalClient';
import { assertMetrics, assertRequest, assertResult, assertSection, isUuid, sameIdentity } from '../lib/publicHealthContract';
import type { PublicHealthRequest, PublicHealthResult, PublicHealthStreamEvent } from '../types';

export class PublicHealthGenerationError extends Error {
  constructor(message: string, public readonly code: string, public readonly terminal: boolean) { super(message); }
}
export interface PublicHealthSseFrame { id: string; event: string; data: string }

/** Standard SSE framing, including CRLF and multiline data. No OpenAI choices/[DONE] assumptions. */
export function createPublicHealthSseDecoder(onFrame: (frame: PublicHealthSseFrame) => void) {
  let buffer = '';
  let event = '', id = '', data: string[] = [];
  const line = (value: string) => {
    if (value === '') {
      if (data.length) onFrame({ id, event, data: data.join('\n') });
      event = ''; id = ''; data = [];
      return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const key = colon < 0 ? value : value.slice(0, colon);
    let field = colon < 0 ? '' : value.slice(colon + 1);
    if (field.startsWith(' ')) field = field.slice(1);
    if (key === 'event') event = field;
    if (key === 'id') id = field;
    if (key === 'data') data.push(field);
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      if (buffer.length + data.join('\n').length > 1_000_000) throw new PublicHealthGenerationError('公卫响应超过长度限制。', 'INVALID_STREAM', true);
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        line(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
      }
    },
    finish() {
      if (buffer.trim() || data.length) throw new PublicHealthGenerationError('公卫响应未完整结束，请重新连接。', 'STREAM_INTERRUPTED', false);
    },
  };
}

export function createPublicHealthStreamValidator(request: PublicHealthRequest, onEvent: (event: PublicHealthStreamEvent) => void) {
  let streamId = '', generationId = '', sequence = 0, terminal = false;
  let result: PublicHealthResult | null = null;
  return {
    accept(frame: PublicHealthSseFrame) {
      let data: PublicHealthStreamEvent['data'];
      try { data = JSON.parse(frame.data); } catch { throw new PublicHealthGenerationError('公卫流式响应格式错误。', 'INVALID_STREAM', true); }
      if (!data || data.schemaVersion !== 'public-health.v1' || !sameIdentity(data, request)
        || !isUuid(data.streamId) || !isUuid(data.generationId) || !Number.isInteger(data.sequence)
        || data.sequence < 1 || frame.id !== `${data.streamId}:${data.sequence}`) {
        throw new PublicHealthGenerationError('公卫响应身份或顺序不匹配，已停止应用。', 'TASK_CONTEXT_MISMATCH', true);
      }
      if (sequence === 0) {
        if (data.sequence !== 1 || frame.event !== 'accepted' || !('mode' in data) || !['new', 'replayed'].includes(data.mode)) {
          throw new PublicHealthGenerationError('公卫响应缺少受理确认。', 'INVALID_STREAM', true);
        }
        streamId = data.streamId; generationId = data.generationId;
      } else if (data.streamId !== streamId || data.generationId !== generationId) {
        throw new PublicHealthGenerationError('公卫响应连接不一致。', 'INVALID_STREAM', true);
      }
      // Same-stream redelivery is idempotent; a gap or a changed stream is not.
      if (data.sequence <= sequence) return;
      if (terminal) throw new PublicHealthGenerationError('服务端在终态后继续发送结果。', 'INVALID_STREAM', true);
      if (data.sequence !== sequence + 1 || (sequence > 0 && frame.event === 'accepted')) {
        throw new PublicHealthGenerationError('公卫响应顺序存在缺口，已停止应用。', 'INVALID_STREAM', true);
      }
      sequence = data.sequence;
      const event = { event: frame.event, data } as PublicHealthStreamEvent;
      try { switch (event.event) {
        case 'accepted': break;
        case 'progress':
          if (typeof event.data.message !== 'string') throw new Error('公卫进度格式错误。');
          break;
        case 'section':
          assertSection(event.data.section, request.capability);
          if (event.data.provisional !== true) throw new Error('公卫临时章节缺少标记。');
          break;
        case 'metrics':
          if (request.capability !== 'weight_management') throw new Error('当前能力不支持减重指标。');
          assertMetrics(event.data.metrics);
          break;
        case 'completed':
          assertResult(event.data.result, request);
          if (event.data.result.generationId !== generationId) throw new Error('公卫结果生成标识不一致。');
          result = event.data.result; terminal = true;
          break;
        case 'failed':
          terminal = true;
          throw new PublicHealthGenerationError(event.data.message || '公卫生成失败。', event.data.errorCode || 'GENERATION_FAILED', true);
        default: throw new PublicHealthGenerationError('未知的公卫流式事件。', 'INVALID_STREAM', true);
      } } catch (error) {
        if (error instanceof PublicHealthGenerationError) throw error;
        throw new PublicHealthGenerationError(error instanceof Error ? error.message : '公卫响应不符合契约。', 'INVALID_STREAM', true);
      }
      onEvent(event);
    },
    completed() {
      if (!result) throw new PublicHealthGenerationError('公卫连接中断，尚无完整结果。可重新连接当前生成。', 'STREAM_INTERRUPTED', false);
      return result;
    },
    get isComplete() { return Boolean(result); },
  };
}

export async function generatePublicHealth(
  request: PublicHealthRequest,
  onEvent: (event: PublicHealthStreamEvent) => void,
  signal: AbortSignal,
): Promise<PublicHealthResult> {
  assertRequest(request);
  let response: Response;
  try {
    ({ response } = await regionalRequestResponse('/v1/public-health/generations', {
      method: 'POST', headers: { Accept: 'text/event-stream' }, body: JSON.stringify(request), signal,
    }, { timeoutMs: 180_000 }));
  } catch (error) {
    if (signal.aborted) throw new DOMException('Stopped waiting', 'AbortError');
    const detail = error as { code?: string; status?: number };
    if (detail?.code === 'GENERATION_IN_PROGRESS') {
      throw new PublicHealthGenerationError('本次生成仍在服务端处理中。可稍后重新连接同一次生成。', 'GENERATION_IN_PROGRESS', false);
    }
    if (!detail?.code && !detail?.status) {
      // The server may already have accepted this request before headers were lost.
      throw new PublicHealthGenerationError('公卫连接未能确认，可重新连接同一次生成。', 'STREAM_INTERRUPTED', false);
    }
    throw error;
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new PublicHealthGenerationError('公卫服务未返回流式响应。', 'INVALID_STREAM', true);
  }
  const validator = createPublicHealthStreamValidator(request, onEvent);
  const parser = createPublicHealthSseDecoder(frame => validator.accept(frame));
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancelReader, { once: true });
  if (signal.aborted) cancelReader();
  try {
    while (!signal.aborted) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try { read = await reader.read(); }
      catch { throw new PublicHealthGenerationError('公卫连接中断，可重新连接当前生成。', 'STREAM_INTERRUPTED', false); }
      if (signal.aborted) throw new DOMException('Stopped waiting', 'AbortError');
      const { value, done } = read;
      if (done) { parser.push(decoder.decode()); parser.finish(); break; }
      parser.push(decoder.decode(value, { stream: true }));
      if (validator.isComplete) return validator.completed();
    }
    if (signal.aborted) throw new DOMException('Stopped waiting', 'AbortError');
    return validator.completed();
  } finally {
    signal.removeEventListener('abort', cancelReader);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
