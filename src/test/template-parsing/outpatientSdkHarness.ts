// @ts-expect-error Node built-ins are provided by Vitest; @types/node is not a direct dependency.
import { runInNewContext } from 'node:vm';
import { vi } from 'vitest';
import type { OutpatientEmrAnalysisRequest, OutpatientEmrRecordConfirmedPayload } from '@features/outpatient-emr/types';
import sdkSource from '../../../sdk/med-hermes-sdk.js?raw';

type MedHermesConstructor = new () => {
  analyzeOutpatientEmr(request: OutpatientEmrAnalysisRequest): Promise<Record<string, unknown>>;
  _http: { post: (...args: unknown[]) => Promise<unknown> };
  _callWithFallback: (httpCall: () => Promise<unknown>) => Promise<unknown>;
  _resumeEventChannelIfNeeded: () => void;
  _dispatchEnvelope(envelope: unknown): void;
};

function loadSdk(): MedHermesConstructor {
  const moduleState: { exports: unknown } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleState,
    exports: moduleState.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(sdkSource, sandbox);
  return moduleState.exports as MedHermesConstructor;
}

export function deliverToOutpatientSdk(request: OutpatientEmrAnalysisRequest, result: OutpatientEmrRecordConfirmedPayload) {
  const MedHermes = loadSdk();
  const sdk = new MedHermes();
  sdk._resumeEventChannelIfNeeded = vi.fn();
  sdk._callWithFallback = (httpCall) => httpCall();
  sdk._http.post = vi.fn().mockResolvedValue({ status: 'success' });
  const pending = sdk.analyzeOutpatientEmr(request);
  sdk._dispatchEnvelope({
    state: 'ready',
    event: {
    id: `${request.visitId}:${request.requestId}:record-confirmed:1`,
    type: 'record-confirmed',
    consultationId: request.visitId,
    requestId: request.requestId,
    timestamp: result.timestamp,
    terminal: false,
    payload: result,
    },
  });
  return pending;
}
