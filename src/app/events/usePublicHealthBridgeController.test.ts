// @vitest-environment jsdom
import { createApp } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePublicHealthController } from '@features/public-health/model/usePublicHealthController';
import { buildConfirmation, SECTION_IDS } from '@features/public-health/lib/publicHealthContract';
import { testFeedback, testRequest, testResult, testTime, testUuid, testValues } from '@features/public-health/testFixtures';
import type { PublicHealthTaskSnapshot } from '@features/public-health/api/publicHealthBridge';
import type { PublicHealthFeedbackEvent, PublicHealthLaunch } from '@features/public-health/types';

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
  createController: vi.fn(),
  getActive: vi.fn(),
}));
vi.mock('@shared/composables/useTauriEventListener', () => ({
  useTauriEventListener: vi.fn((options) => {
    mocks.listeners.set(options.eventName, options.handler);
    return { startListener: vi.fn(async () => undefined) };
  }),
}));
vi.mock('@features/public-health', () => ({
  createPublicHealthController: mocks.createController,
  publicHealthBridge: { getActive: mocks.getActive },
}));
vi.mock('@/services/regionalClient', () => ({ regionalRequestResponse: vi.fn() }));

import { usePublicHealthBridgeController } from './usePublicHealthBridgeController';

const cleanups: (() => void)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.clear();
  mocks.createController.mockImplementation(() => usePublicHealthController({
    generate: vi.fn(async request => testResult(request)),
    prepare: vi.fn(async () => undefined), confirm: vi.fn(async () => undefined), close: vi.fn(async () => undefined),
  }));
});
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); });

function pendingSnapshot(request = testRequest()): PublicHealthTaskSnapshot {
  return {
    bridgeSessionId: testUuid(50), request, originRequestId: request.originRequestId, phase: 'awaiting-writeback',
    pendingWriteback: buildConfirmation(request, testResult(request), testValues(request), SECTION_IDS[request.capability], testUuid(60), testTime),
    lastFeedback: null,
  };
}
function emitFeedback(event: PublicHealthFeedbackEvent) {
  mocks.listeners.get('public-health-writeback-feedback')!({ payload: event });
}
function emitLaunch(event: PublicHealthLaunch) {
  mocks.listeners.get('start-public-health-assist')!({ payload: event });
}
async function mountWaiting() {
  let resolve!: (snapshot: PublicHealthTaskSnapshot | null) => void;
  const snapshotPromise = new Promise<PublicHealthTaskSnapshot | null>(r => { resolve = r; });
  mocks.getActive.mockReturnValue(snapshotPromise);
  const open = vi.fn(async () => undefined), notify = vi.fn();
  let controller!: ReturnType<typeof usePublicHealthBridgeController>;
  const app = createApp({ setup() { controller = usePublicHealthBridgeController({ open, notify }); return () => null; } });
  app.mount(document.createElement('div'));
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; app.unmount(); } };
  cleanups.push(unmount);
  await vi.waitFor(() => expect(mocks.getActive).toHaveBeenCalledOnce());
  async function finish(snapshot: PublicHealthTaskSnapshot | null) {
    resolve(snapshot);
    await snapshotPromise;
    await Promise.resolve();
  }
  return { controller, open, notify, finish, unmount };
}

describe('public health Bridge startup recovery', () => {
  it.each(['success', 'failed'] as const)('applies a matching %s receipt that arrives before the pending snapshot', async status => {
    const { controller, open, finish } = await mountWaiting();
    const snapshot = pendingSnapshot();
    const receipt = { bridgeSessionId: snapshot.bridgeSessionId, feedback: testFeedback(snapshot.pendingWriteback!, status) };
    emitFeedback(receipt);
    expect(controller.state.value).toBe('idle');
    await finish(snapshot);
    expect(controller.state.value).toBe(status === 'success' ? 'saved' : 'writeback-failed');
    expect(controller.feedback.value).toEqual(receipt.feedback);
    expect(open).toHaveBeenCalledOnce();
  });

  it.each(['bridgeSessionId', 'patientId', 'businessRecordId', 'recordVersion', 'originRequestId', 'requestId', 'generationId', 'writebackRequestId'] as const)(
    'rejects a buffered receipt with a different %s', async field => {
      const { controller, finish } = await mountWaiting();
      const snapshot = pendingSnapshot();
      const receipt = { bridgeSessionId: snapshot.bridgeSessionId, feedback: testFeedback(snapshot.pendingWriteback!) };
      const foreign = structuredClone(receipt);
      if (field === 'bridgeSessionId') foreign.bridgeSessionId = testUuid(99);
      else foreign.feedback[field] = testUuid(99);
      emitFeedback(foreign);
      await finish(snapshot);
      expect(controller.state.value).toBe('awaiting-writeback');
      expect(controller.feedback.value).toBeNull();
      emitFeedback(receipt);
      expect(controller.state.value).toBe('saved');
    },
  );

  it('does not restore the old snapshot or replay its receipt after a new launch', async () => {
    const { controller, open, finish } = await mountWaiting();
    const snapshot = pendingSnapshot();
    emitFeedback({ bridgeSessionId: snapshot.bridgeSessionId, feedback: testFeedback(snapshot.pendingWriteback!) });
    const next: PublicHealthLaunch = { bridgeSessionId: testUuid(51), request: {
      ...testRequest(), patientId: 'another-synthetic-patient', requestId: testUuid(70), originRequestId: testUuid(70),
    } };
    mocks.listeners.get('start-public-health-assist')!({ payload: next });
    await finish(snapshot);
    expect(controller.request.value).toEqual(next.request);
    expect(controller.state.value).toBe('ready');
    expect(controller.feedback.value).toBeNull();
    expect(open).toHaveBeenCalledOnce();
  });

  it('discards buffered and late receipts when unmounted before recovery finishes', async () => {
    const { controller, open, notify, finish, unmount } = await mountWaiting();
    const snapshot = pendingSnapshot();
    const receipt = { bridgeSessionId: snapshot.bridgeSessionId, feedback: testFeedback(snapshot.pendingWriteback!) };
    emitFeedback(receipt);
    const receive = vi.spyOn(controller, 'receiveFeedback');
    unmount();
    emitFeedback(receipt);
    await finish(snapshot);
    expect(receive).not.toHaveBeenCalled();
    expect(controller.state.value).toBe('idle');
    expect(open).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps at most the latest 16 startup receipts and releases them after recovery', async () => {
    const { controller, finish } = await mountWaiting();
    const snapshot = pendingSnapshot();
    const receive = vi.spyOn(controller, 'receiveFeedback');
    const receipts = Array.from({ length: 17 }, (_, index) => ({
      bridgeSessionId: testUuid(100 + index), feedback: testFeedback(snapshot.pendingWriteback!),
    }));
    receipts.forEach(emitFeedback);
    receive.mockClear();
    await finish(snapshot);
    expect(receive.mock.calls.map(([event]) => event)).toEqual(receipts.slice(1));
    expect(controller.state.value).toBe('awaiting-writeback');
    receive.mockClear();
    emitFeedback({ bridgeSessionId: snapshot.bridgeSessionId, feedback: testFeedback(snapshot.pendingWriteback!) });
    expect(receive).toHaveBeenCalledOnce();
    expect(controller.state.value).toBe('saved');
  });

  it.each(['awaiting-writeback', 'saved'] as const)('restores A as %s after switching to B and reopening the original A assist', async phase => {
    const { controller, open, finish } = await mountWaiting();
    const initialA = testRequest();
    const a = pendingSnapshot({ ...initialA, requestId: testUuid(71), facts: { ...initialA.facts, historySummary: '合成已补充资料' } });
    await finish(a);
    const b: PublicHealthLaunch = { bridgeSessionId: testUuid(51), request: {
      ...testRequest(), patientId: 'synthetic-B', requestId: testUuid(72), originRequestId: testUuid(72),
    } };
    mocks.getActive.mockResolvedValue(null);
    emitLaunch(b);
    await vi.waitFor(() => expect(controller.request.value?.patientId).toBe('synthetic-B'));
    if (phase === 'saved') { a.phase = 'saved'; a.lastFeedback = testFeedback(a.pendingWriteback!); }
    mocks.getActive.mockResolvedValue(a);
    emitLaunch({ bridgeSessionId: a.bridgeSessionId, request: initialA });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(3));
    expect(controller.state.value).toBe(phase);
    expect(controller.request.value?.requestId).toBe(testUuid(71));
    expect(controller.request.value?.facts.historySummary).toBe('合成已补充资料');
    expect(controller.frozen.value).toEqual(a.pendingWriteback);
    expect(controller.canGenerate.value).toBe(false);
  });

  it('keeps an in-memory edited draft when the same assist is opened again', async () => {
    const { controller, open, finish } = await mountWaiting();
    const snapshot = pendingSnapshot();
    await finish({ ...snapshot, phase: 'ready', pendingWriteback: null });
    await controller.generate();
    controller.editSection('check_plan', '合成医生编辑内容');
    const requestsBefore = mocks.getActive.mock.calls.length;
    emitLaunch({ bridgeSessionId: snapshot.bridgeSessionId, request: snapshot.request });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
    expect(mocks.getActive).toHaveBeenCalledTimes(requestsBefore);
    expect(controller.values.value.check_plan).toBe('合成医生编辑内容');
    expect(controller.state.value).toBe('reviewable');
  });

  it.each(['patientId', 'scene', 'businessRecordId', 'capability', 'recordVersion', 'writebackTargets'] as const)(
    'rejects a cross-task snapshot with conflicting %s despite matching session and origin', async field => {
      const { controller, open, notify, finish } = await mountWaiting();
      await finish(null);
      const incoming = { bridgeSessionId: testUuid(50), request: testRequest() };
      const snapshot = pendingSnapshot();
      if (field === 'writebackTargets') snapshot.request.writebackTargets[0].targetFieldId = 'different-target';
      else Object.assign(snapshot.request, { [field]: 'different-business-identity' });
      mocks.getActive.mockResolvedValue(snapshot);
      emitLaunch(incoming);
      await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
      expect(controller.request.value).toBeNull();
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('keeps the new recovery buffer when an older launch query finishes late', async () => {
    const { controller, open, finish } = await mountWaiting();
    await finish(null);
    const a = pendingSnapshot();
    const b = pendingSnapshot({ ...testRequest(), patientId: 'synthetic-B', requestId: testUuid(80), originRequestId: testUuid(80) });
    b.bridgeSessionId = testUuid(81);
    let resolveA!: (snapshot: PublicHealthTaskSnapshot) => void;
    let resolveB!: (snapshot: PublicHealthTaskSnapshot) => void;
    const queryA = new Promise<PublicHealthTaskSnapshot>(resolve => { resolveA = resolve; });
    const queryB = new Promise<PublicHealthTaskSnapshot>(resolve => { resolveB = resolve; });
    mocks.getActive.mockReturnValueOnce(queryA).mockReturnValueOnce(queryB);
    emitLaunch(a); emitLaunch(b);
    emitFeedback({ bridgeSessionId: b.bridgeSessionId, feedback: testFeedback(b.pendingWriteback!) });
    resolveA(a); await queryA; await Promise.resolve(); await Promise.resolve();
    expect(controller.request.value).toBeNull();
    resolveB(b);
    await vi.waitFor(() => expect(controller.state.value).toBe('saved'));
    expect(controller.request.value?.patientId).toBe('synthetic-B');
    expect(open).toHaveBeenCalledOnce();
  });
});
