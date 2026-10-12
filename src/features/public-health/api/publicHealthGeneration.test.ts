import { describe, expect, it, vi } from 'vitest';
vi.mock('@/services/regionalClient', () => ({ regionalRequestResponse: vi.fn() }));
import { regionalRequestResponse } from '@/services/regionalClient';
import { createPublicHealthSseDecoder, createPublicHealthStreamValidator, generatePublicHealth } from './publicHealthGeneration';
import { identityOf } from '../lib/publicHealthContract';
import { testRequest, testResult, testTime, testUuid } from '../testFixtures';

function streamFrames() {
  const request = testRequest(), result = testResult(request);
  const base = { schemaVersion: 'public-health.v1', ...identityOf(request), generationId: result.generationId, streamId: testUuid(20) };
  return { request, result, frames: [
    { id: `${base.streamId}:1`, event: 'accepted', data: JSON.stringify({ ...base, sequence: 1, mode: 'new', acceptedAt: testTime }) },
    { id: `${base.streamId}:2`, event: 'completed', data: JSON.stringify({ ...base, sequence: 2, result }) },
  ] };
}
describe('signed named public health SSE', () => {
  it('parses split CRLF frames, comments and multiline data without OpenAI fields', () => {
    const frames: unknown[] = []; const decoder = createPublicHealthSseDecoder(frame => frames.push(frame));
    decoder.push(':keepalive\r\nevent: accepted\r\nid: s:1\r\ndata: {\r');
    decoder.push('\ndata: "value":1}\r\n\r\n'); decoder.finish();
    expect(frames).toEqual([{ id: 's:1', event: 'accepted', data: '{\n"value":1}' }]);
  });
  it('requires accepted identity and monotonic sequence, and accepts complete authoritative results only', () => {
    const { request, result, frames } = streamFrames(); const onEvent = vi.fn();
    const validator = createPublicHealthStreamValidator(request, onEvent);
    validator.accept(frames[0]); expect(() => validator.completed()).toThrow('中断');
    expect(() => validator.accept(frames[0])).not.toThrow();
    expect(onEvent).toHaveBeenCalledTimes(1);
    validator.accept(frames[1]); expect(validator.completed()).toEqual(result);
    expect(() => validator.accept(frames[1])).not.toThrow();
    expect(onEvent).toHaveBeenCalledTimes(2);
  });
  it('rejects other patients, old streams, missing terminal and failed knowledge', () => {
    const { request, frames } = streamFrames(); const validator = createPublicHealthStreamValidator(request, () => undefined);
    const wrong = JSON.parse(frames[0].data); wrong.patientId = 'other';
    expect(() => validator.accept({ ...frames[0], data: JSON.stringify(wrong) })).toThrow('身份');
    validator.accept(frames[0]); const failed = JSON.parse(frames[1].data);
    delete failed.result; Object.assign(failed, { errorCode: 'KNOWLEDGE_ASSET_MISSING', message: '知识未就绪', retryable: false, failedAt: testTime });
    expect(() => validator.accept({ ...frames[1], event: 'failed', data: JSON.stringify(failed) })).toThrow('知识未就绪');
  });
  it('rejects sequence gaps and a different stream even when its sequence is older', () => {
    const { request, frames } = streamFrames();
    const validator = createPublicHealthStreamValidator(request, () => undefined);
    validator.accept(frames[0]);
    const gap = JSON.parse(frames[1].data); gap.sequence = 3;
    expect(() => validator.accept({ ...frames[1], id: `${gap.streamId}:3`, data: JSON.stringify(gap) })).toThrow('缺口');
    const old = JSON.parse(frames[0].data); old.streamId = testUuid(90);
    expect(() => validator.accept({ ...frames[0], id: `${old.streamId}:1`, data: JSON.stringify(old) })).toThrow('连接不一致');
  });
  it('uses the signed response gateway and preserves raw body identity', async () => {
    const { request, result, frames } = streamFrames();
    const text = frames.map(frame => `event: ${frame.event}\nid: ${frame.id}\ndata: ${frame.data}\n\n`).join('');
    vi.mocked(regionalRequestResponse).mockResolvedValue({ response: new Response(text, { headers: { 'Content-Type': 'text/event-stream' } }), requestId: testUuid(30) });
    await expect(generatePublicHealth(request, () => undefined, new AbortController().signal)).resolves.toEqual(result);
    expect(regionalRequestResponse).toHaveBeenCalledWith('/v1/public-health/generations', expect.objectContaining({ method: 'POST', body: JSON.stringify(request), headers: { Accept: 'text/event-stream' } }), { timeoutMs: 180_000 });
  });
  it('cancels a blocked reader when local waiting is aborted', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.mocked(regionalRequestResponse).mockResolvedValue({ response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), requestId: testUuid(30) });
    const controller = new AbortController();
    const pending = generatePublicHealth(testRequest(), () => undefined, controller.signal);
    await Promise.resolve(); controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
  it('keeps a response-header transport failure reconnectable with the same request', async () => {
    vi.mocked(regionalRequestResponse).mockRejectedValueOnce(new TypeError('network failed before headers'));
    await expect(generatePublicHealth(testRequest(), () => undefined, new AbortController().signal))
      .rejects.toMatchObject({ code: 'STREAM_INTERRUPTED', terminal: false });
  });
});
