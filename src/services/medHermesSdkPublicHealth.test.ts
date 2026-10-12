// @ts-expect-error Vitest supplies Node built-ins; @types/node is not a direct dependency.
import { readFileSync } from 'node:fs';
// @ts-expect-error Vitest supplies Node built-ins; @types/node is not a direct dependency.
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(new URL('../../sdk/med-hermes-sdk.js', import.meta.url), 'utf8');
const originId = '00000000-0000-4000-8000-000000000001';
const sessionId = '30000000-0000-4000-8000-000000000001';
class Socket {
  static all: Socket[] = [];
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  constructor(readonly url: string) { Socket.all.push(this); }
  send(value: string) { this.sent.push(value); }
  close() { this.onclose?.(); }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
type SDK = {
  initPublicHealth(): Promise<unknown>;
  assistPublicHealth(request: unknown): Promise<unknown>;
  sendPublicHealthFeedback(feedback: unknown): Promise<unknown>;
  on(event: string, callback: (value: unknown) => void): SDK;
  destroy(): void;
};
let instances: SDK[] = [];
function setup() {
  const fetch = vi.fn((url: string) => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(url.endsWith('/handshake') ? {
    status: 'ready', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId,
    publicHealthBridgeToken: 'synthetic-session-token', expiresAt: new Date(Date.now() + 1800000).toISOString(),
  } : { status: 'accepted' })) }));
  const mod: { exports: unknown } = { exports: {} };
  runInNewContext(source, { module: mod, exports: mod.exports, fetch, WebSocket: Socket, AbortController, Date, setTimeout, clearTimeout,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } });
  const Ctor = mod.exports as new (options: unknown) => SDK;
  const sdk = new Ctor({ publicHealth: { pairingKey: 'synthetic-deployment-pairing-key', sdkInstanceId: '40000000-0000-4000-8000-000000000001' } });
  instances.push(sdk); return { sdk, fetch };
}
async function connect(sdk: SDK) {
  const pending = sdk.initPublicHealth();
  await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
  Socket.all[0].onopen?.();
  Socket.all[0].receive({ type: 'public-health-subscribed', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId });
  await pending;
}
function request() {
  return { schemaVersion: 'public-health.v1', requestId: originId, originRequestId: originId,
    capability: 'health_prescription', scene: 'hypertension_followup', patientId: 'synthetic-person', businessRecordId: 'synthetic-record',
    recordVersion: 'v1', snapshotAt: '2026-09-29T10:00:00+08:00', patient: { name: '合成居民', sex: 'female', ageYears: 65 },
    facts: { observations: [], conditions: [], medicationClasses: [], lifestyle: {} },
    writebackTargets: [{ targetFieldId: 'guidance', label: '合成字段', sourceSections: ['check_plan', 'medication_guidance', 'lifestyle_guidance'], valueType: 'string', mode: 'replace' }] };
}
function envelope() {
  const { patient: _patient, facts: _facts, writebackTargets: _targets, ...identity } = request();
  return { state: 'ready', traceId: 'synthetic-trace', event: { id: '50000000-0000-4000-8000-000000000001',
    type: 'public-health-result-confirmed', bridgeSessionId: sessionId, timestamp: 1,
    payload: { ...identity, requestId: '00000000-0000-4000-8000-000000000002', generationId: '10000000-0000-4000-8000-000000000001',
      writebackRequestId: '20000000-0000-4000-8000-000000000001', confirmedAt: '2026-09-29T10:01:00+08:00',
      items: [{ targetFieldId: 'guidance', sourceSections: ['check_plan', 'medication_guidance', 'lifestyle_guidance'], value: '合成展示' }] } } };
}
beforeEach(() => { vi.useFakeTimers(); Socket.all = []; instances = []; });
afterEach(() => { for (const sdk of instances) sdk.destroy(); vi.useRealTimers(); });
describe('public-health SDK isolated instance transport', () => {
  it('handshakes and authenticates without the outpatient init or any URL credentials', async () => {
    const { sdk, fetch } = setup(); await connect(sdk);
    expect(fetch).toHaveBeenCalledTimes(1);
    const call = fetch.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(call[0]).toMatch(/\/api\/public-health\/handshake$/);
    expect(call[1].headers['X-PCIE-Pairing-Key']).toBe('synthetic-deployment-pairing-key');
    expect(JSON.parse(call[1].body)).not.toHaveProperty('emrAccessToken');
    expect(Socket.all[0].url).toBe('ws://127.0.0.1:8081/api/consultation/events/ws?channel=public-health');
    expect(Socket.all[0].url).not.toContain('token');
    expect(JSON.parse(Socket.all[0].sent[0])).toMatchObject({ type: 'public-health-subscribe', publicHealthBridgeToken: 'synthetic-session-token' });
  });
  it('accepts a derived generation by stable origin while keeping outpatient events untouched', async () => {
    const { sdk, fetch } = setup(); const clinical = vi.fn(); const publicHealth = vi.fn();
    sdk.on('record-confirmed', clinical).on('public-health-result-confirmed', publicHealth);
    await connect(sdk); await sdk.assistPublicHealth(request());
    Socket.all[0].receive(envelope()); Socket.all[0].receive(envelope());
    expect(publicHealth).toHaveBeenCalledTimes(1); expect(clinical).not.toHaveBeenCalled();
    const call = fetch.mock.calls[1] as unknown as [string, { headers: Record<string, string> }];
    expect(call[1].headers['X-PCIE-Bridge-Token']).toBe('synthetic-session-token');
  });
  it('redelivers the same frozen save intent under a new transport event id', async () => {
    const { sdk } = setup(); const handler = vi.fn(); sdk.on('public-health-result-confirmed', handler);
    await connect(sdk); await sdk.assistPublicHealth(request());
    const first = envelope(); Socket.all[0].receive(first);
    const retry = envelope(); retry.event.id = '50000000-0000-4000-8000-000000000002';
    Socket.all[0].receive(retry); Socket.all[0].receive(retry);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0][0]).toEqual(handler.mock.calls[1][0]);
    expect(handler.mock.calls[1][0]).toEqual(first.event.payload);
  });
  it('rejects another session, patient, and partial combined-field result before delivery', async () => {
    const { sdk } = setup(); const handler = vi.fn(); sdk.on('public-health-result-confirmed', handler);
    await connect(sdk); await sdk.assistPublicHealth(request());
    const another = envelope(); another.event.bridgeSessionId = '30000000-0000-4000-8000-000000000002'; Socket.all[0].receive(another);
    const wrongPatient = envelope(); wrongPatient.event.payload.patientId = 'different-person'; Socket.all[0].receive(wrongPatient);
    const partial = envelope(); partial.event.payload.items[0].sourceSections = ['check_plan']; Socket.all[0].receive(partial);
    expect(handler).not.toHaveBeenCalled();
    Socket.all[0].receive(envelope()); expect(handler).toHaveBeenCalledTimes(1);
  });
  it('only sends terminal feedback that belongs to a received writeback intent', async () => {
    const { sdk, fetch } = setup(); await connect(sdk); await sdk.assistPublicHealth(request());
    const event = envelope(); Socket.all[0].receive(event);
    const { items: _items, confirmedAt: _confirmed, ...identity } = event.event.payload;
    const feedback = { ...identity, status: 'success', savedRecordVersion: 'v2', feedbackAt: '2026-09-29T10:02:00+08:00' };
    await expect(sdk.sendPublicHealthFeedback({ ...feedback, patientId: 'different-person' })).rejects.toMatchObject({ code: 'TASK_CONTEXT_MISMATCH' });
    await expect(sdk.sendPublicHealthFeedback({ ...feedback, status: 'pending' })).rejects.toMatchObject({ code: 'TASK_CONTEXT_MISMATCH' });
    await sdk.sendPublicHealthFeedback(feedback);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[2][0]).toMatch(/writeback-feedback$/);
  });
  it('renews with original instance credential and replays only its own after cursor', async () => {
    const { sdk, fetch } = setup(); await connect(sdk); await sdk.assistPublicHealth(request()); Socket.all[0].receive(envelope());
    Socket.all[0].close(); await vi.advanceTimersByTimeAsync(1000);
    expect(Socket.all).toHaveLength(2); Socket.all[1].onopen?.();
    const control = JSON.parse(Socket.all[1].sent[0]); expect(control.after).toBe(envelope().event.id);
    const call = fetch.mock.calls[2] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(JSON.parse(call[1].body).resumeSessionId).toBe(sessionId);
    expect(call[1].headers['X-PCIE-Bridge-Token']).toBe('synthetic-session-token');
    Socket.all[1].receive({ type: 'public-health-subscribed', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId }); await Promise.resolve();
    expect(fetch.mock.calls.filter((c: unknown[]) => String(c[0]).endsWith('/assist'))).toHaveLength(1);
  });
  it('does not deliver anything before authenticated subscription acknowledgement', async () => {
    const { sdk } = setup(); const handler = vi.fn(); sdk.on('public-health-result-confirmed', handler);
    const pending = sdk.initPublicHealth(); await vi.waitFor(() => expect(Socket.all).toHaveLength(1));
    Socket.all[0].onopen?.(); Socket.all[0].receive(envelope()); expect(handler).not.toHaveBeenCalled();
    Socket.all[0].receive({ type: 'public-health-subscribed', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId }); await pending;
  });
  it('renews a recovered expired token once before creating the replacement socket', async () => {
    const { sdk, fetch } = setup(); await connect(sdk);
    fetch.mockImplementationOnce(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({
      status: 'ready', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId,
      publicHealthBridgeToken: 'recovered-expired-token', expiresAt: new Date(Date.now() - 1).toISOString(),
    })) }));
    Socket.all[0].close(); await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(3); expect(Socket.all).toHaveLength(2);
    const call = fetch.mock.calls[2] as unknown as [string, { headers: Record<string, string>; body: string }];
    expect(call[1].headers['X-PCIE-Bridge-Token']).toBe('recovered-expired-token');
    expect(JSON.parse(call[1].body).resumeSessionId).toBe(sessionId);
    Socket.all[1].onopen?.();
    expect(JSON.parse(Socket.all[1].sent[0]).publicHealthBridgeToken).toBe('synthetic-session-token');
    Socket.all[1].receive({ type: 'public-health-subscribed', schemaVersion: 'public-health.v1', bridgeSessionId: sessionId });
  });
  it('stops automatic reconnect after a rejected cursor without replaying assist', async () => {
    const { sdk, fetch } = setup(); const pending = sdk.initPublicHealth();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'EVENT_CURSOR_INVALID' });
    await vi.waitFor(() => expect(Socket.all).toHaveLength(1)); Socket.all[0].onopen?.();
    Socket.all[0].receive({ type: 'public-health-error', errorCode: 'EVENT_CURSOR_INVALID', message: '合成拒绝' });
    Socket.all[0].close(); await rejected; await vi.advanceTimersByTimeAsync(60000);
    expect(Socket.all).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
  });

});
