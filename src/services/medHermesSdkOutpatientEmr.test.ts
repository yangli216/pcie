// @ts-expect-error Node built-ins are provided by Vitest but @types/node is not a direct project dependency.
import { readFileSync } from 'node:fs';
// @ts-expect-error Node built-ins are provided by Vitest but @types/node is not a direct project dependency.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const sdkSource = readFileSync(new URL('../../sdk/med-hermes-sdk.js', import.meta.url), 'utf8');
let envelopeCounter = 0;

interface OutpatientRequest {
  visitId: string;
  templateId: string;
  templateName: string;
  templateHtml: string;
  templateDefinition: string;
  targetFieldIds: string[];
  recordContext: Record<string, unknown>;
  patient?: {
    idPi?: string;
    name?: string;
    sdSexText?: string;
    ageText?: string;
  };
  requestId: string;
}

interface SdkEnvelope {
  state: string;
  event: {
    id: string;
    type: string | null;
    consultationId: string;
    requestId: string | undefined;
    timestamp: number;
    terminal: boolean;
    payload: Record<string, unknown>;
  };
}

type BridgeResult = Record<string, unknown>;
type HttpPost = (path: string, payload: OutpatientRequest) => Promise<BridgeResult>;

interface MedHermesInstance {
  analyzeOutpatientEmr(request: OutpatientRequest): Promise<BridgeResult>;
  on(event: string, listener: (payload: unknown) => void): MedHermesInstance;
  destroy(): void;
  _pendingOutpatientEmrRequests: unknown[];
  _http: { post: HttpPost };
  _launcher: { launch: (path?: string, params?: unknown) => void };
  _callWithFallback(
    httpCall: () => Promise<BridgeResult>,
    protocolPath?: string,
    params?: unknown,
  ): Promise<BridgeResult>;
  _dispatchEnvelope(envelope: SdkEnvelope): void;
  _handshake(): Promise<BridgeResult>;
  _ensureInteractionChannel(force?: boolean): void;
  _resumeEventChannelIfNeeded(): void;
}

type MedHermesConstructor = new (options?: Record<string, unknown>) => MedHermesInstance;

function loadSdk(): MedHermesConstructor {
  const moduleState: { exports: unknown } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleState,
    exports: moduleState.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    console: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(sdkSource, sandbox);
  return moduleState.exports as MedHermesConstructor;
}

function createRequest(overrides: Partial<OutpatientRequest> = {}): OutpatientRequest {
  return {
    visitId: 'visit-1',
    templateId: 'template-1',
    templateName: '门诊模板',
    templateHtml: '<section data-id="article-history" data-article="病史" data-name="病史"></section>',
    templateDefinition: '[{"ID":"article-history","NAME":"病史","ARTICLE":"病史","eles":[]}]',
    targetFieldIds: ['history'],
    recordContext: { recordText: '咳嗽三天' },
    requestId: 'outpatient-emr-request-1',
    ...overrides,
  };
}

function createConfirmedEnvelope(
  request: OutpatientRequest,
  templateId = request.templateId,
): SdkEnvelope {
  envelopeCounter += 1;
  const timestamp = Date.now() + envelopeCounter;
  const payload = {
    consultationId: request.visitId,
    visitId: request.visitId,
    timestamp,
    resultType: 'record-confirmed',
    requestId: request.requestId,
    referenceType: 'batch',
    action: 'batch',
    referenceStatus: 'pending',
    referenceMessage: '等待 HIS 完成门诊模板参数回填并回执',
    emrType: 'outpatient-emr',
    templateMetadata: {
      schemaVersion: 'outpatient-emr-template-pair.v1',
      templateId,
      templateName: request.templateName,
      templateHash: 'a'.repeat(64),
      fields: [{
        id: request.targetFieldIds[0],
        name: '病历字段',
        type: 'text',
        articleTemplateId: 'article-history',
        articleId: '病史',
        articleName: '病史',
        articleDefinitionName: '病史',
        dictionaryItems: [],
        recordField: null,
        mappingSource: 'unmapped',
        projectionMode: null,
      }],
    },
    fieldValues: { [request.targetFieldIds[0]]: '医生确认值' },
    dictionarySelections: {},
    writebackScope: {
      recordFields: [],
      includeDiagnosis: false,
      orderTypes: [],
    },
    orderList: [],
  };
  return {
    state: 'ready',
    event: {
      id: `${request.visitId}:${request.requestId}:record-confirmed:${envelopeCounter}`,
      type: 'record-confirmed',
      consultationId: request.visitId,
      requestId: request.requestId,
      timestamp,
      terminal: false,
      payload,
    },
  };
}

function createCancelledEnvelope(
  request: OutpatientRequest,
): SdkEnvelope {
  envelopeCounter += 1;
  const payload: Record<string, unknown> = {
    consultationId: request.visitId,
    visitId: request.visitId,
    timestamp: Date.now() + envelopeCounter,
    requestId: request.requestId,
    emrType: 'outpatient-emr',
    resultType: 'cancelled',
    status: 'cancelled',
  };
  return {
    state: 'cancelled',
    event: {
      id: `${request.visitId}:${request.requestId}:cancelled:${envelopeCounter}`,
      type: 'cancelled',
      consultationId: request.visitId,
      requestId: request.requestId,
      timestamp: Date.now() + envelopeCounter,
      terminal: true,
      payload,
    },
  };
}

function stubAcceptedBridge(sdk: MedHermesInstance) {
  const post = vi.fn<HttpPost>().mockResolvedValue({ status: 'success' });
  sdk._resumeEventChannelIfNeeded = vi.fn();
  sdk._callWithFallback = (httpCall) => httpCall();
  sdk._http.post = post;
  return post;
}

describe('MedHermes outpatient EMR SDK flow', () => {
  it('dispatches a complete voice-combined outpatient result instead of applying template-only scope rules', () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const request = createRequest();
    const envelope = createConfirmedEnvelope(request);
    const payload = envelope.event.payload;
    payload.referenceMessage = '等待 HIS 完成动态模板及已选诊疗内容回写并回执';
    payload.diagList = [{ naDiag: '急性上呼吸道感染', cdIcd10: 'J06.900' }];
    payload.orderList = [{ naSrv: '复方氨酚烷胺胶囊', sdSrv: '11', amount: 1 }];
    payload.writebackScope = {
      recordFields: [],
      includeDiagnosis: true,
      orderTypes: ['medicine'],
    };
    const received: unknown[] = [];
    const errors: unknown[] = [];
    sdk.on('record-confirmed', value => received.push(value));
    sdk.on('error', value => errors.push(value));

    sdk._dispatchEnvelope(envelope);

    expect(received).toEqual([payload]);
    expect(errors).toEqual([]);
  });

  it('rejects an unknown top-level request field before calling the bridge', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const invalidRequest = {
      ...createRequest(),
      unsupportedField: 'unexpected',
    };

    await expect(sdk.analyzeOutpatientEmr(invalidRequest))
      .rejects.toThrow('请求包含未支持字段');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects unsupported outpatient patient fields before calling the bridge', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const invalidRequest = {
      ...createRequest(),
      patient: { unsupportedPatientField: 'patient-1' },
    } as unknown as OutpatientRequest;

    await expect(sdk.analyzeOutpatientEmr(invalidRequest))
      .rejects.toThrow('patient 只接受 idPi、name、sdSexText、ageText');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects outpatient patient values that would require trimming', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);

    await expect(sdk.analyzeOutpatientEmr(createRequest({
      patient: { name: ' 张三' },
    }))).rejects.toThrow('patient 字段必须是无首尾空白的字符串');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    [[]],
    [['   ']],
    [undefined as unknown as string[]],
  ])('rejects a missing or empty renderer target list before calling the bridge', async (targetFieldIds) => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);

    await expect(sdk.analyzeOutpatientEmr(createRequest({ targetFieldIds })))
      .rejects.toThrow('唯一 targetFieldIds');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    [[' history ', 'history']],
    [['history', 'history']],
  ])('rejects renderer target ids that would require correction', async (targetFieldIds) => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const request = createRequest({ targetFieldIds });

    await expect(sdk.analyzeOutpatientEmr(request)).rejects.toThrow('唯一 targetFieldIds');
    expect(post).not.toHaveBeenCalled();
  });

  it.each([
    ['undefined', { nested: undefined }],
    ['NaN', { temperature: Number.NaN }],
    ['Infinity', { temperature: Number.POSITIVE_INFINITY }],
    ['Date', { recordedAt: new Date('2026-08-27T00:00:00Z') }],
  ])('rejects recordContext containing non-JSON %s without silently rewriting it', async (_label, recordContext) => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);

    await expect(sdk.analyzeOutpatientEmr(createRequest({ recordContext })))
      .rejects.toThrow('严格 JSON 值');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects circular recordContext instead of silently normalizing it', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const recordContext: Record<string, unknown> = { recordText: '咳嗽三天' };
    recordContext.self = recordContext;

    await expect(sdk.analyzeOutpatientEmr(createRequest({ recordContext })))
      .rejects.toThrow('严格 JSON 值');
    expect(post).not.toHaveBeenCalled();
  });

  it('requires HIS to provide requestId instead of generating one', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const request = { ...createRequest() } as Partial<OutpatientRequest>;
    delete request.requestId;

    await expect(sdk.analyzeOutpatientEmr(request as OutpatientRequest))
      .rejects.toThrow('requestId');
    expect(post).not.toHaveBeenCalled();
  });

  it('reuses an identical active request and requires the complete payload identity to resolve', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const request = createRequest();

    const first = sdk.analyzeOutpatientEmr(request);
    const retry = sdk.analyzeOutpatientEmr(request);

    expect(retry).toBe(first);
    expect(post).toHaveBeenCalledTimes(1);

    sdk._dispatchEnvelope(createConfirmedEnvelope(request, 'different-template'));
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    const expected = createConfirmedEnvelope(request);
    sdk._dispatchEnvelope(expected);
    await expect(first).resolves.toEqual(expected.event.payload);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it('does not complete from envelope or top-level identity fallbacks', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);

    const missingVisitId = createConfirmedEnvelope(request);
    delete missingVisitId.event.payload.visitId;
    sdk._dispatchEnvelope(missingVisitId);

    const missingRequestId = createConfirmedEnvelope(request);
    delete missingRequestId.event.payload.requestId;
    sdk._dispatchEnvelope(missingRequestId);

    const topLevelTemplateIdOnly = createConfirmedEnvelope(request);
    delete topLevelTemplateIdOnly.event.payload.templateMetadata;
    topLevelTemplateIdOnly.event.payload.templateId = request.templateId;
    sdk._dispatchEnvelope(topLevelTemplateIdOnly);

    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    const expected = createConfirmedEnvelope(request);
    sdk._dispatchEnvelope(expected);
    await expect(pending).resolves.toEqual(expected.event.payload);
  });

  it('rejects an identity-matched result with an incomplete formal payload', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);
    const rejected = expect(pending).rejects.toThrow('INVALID_OUTPATIENT_EMR_RESULT');
    const received: unknown[] = [];
    sdk.on('record-confirmed', (payload) => received.push(payload));

    const incomplete = createConfirmedEnvelope(request);
    delete incomplete.event.payload.fieldValues;
    sdk._dispatchEnvelope(incomplete);

    await rejected;
    expect(received).toEqual([]);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it('accepts a mapped projection only when metadata, scope and outpatientRecord agree', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);
    const expected = createConfirmedEnvelope(request);
    const metadata = expected.event.payload.templateMetadata as {
      fields: Array<Record<string, unknown>>;
    };
    metadata.fields[0].recordField = 'personalHistory';
    metadata.fields[0].mappingSource = 'canonical-id';
    metadata.fields[0].projectionMode = 'direct';
    expected.event.payload.writebackScope = {
      recordFields: ['personalHistory'],
      includeDiagnosis: false,
      orderTypes: [],
    };
    expected.event.payload.outpatientRecord = {
      schemaVersion: 'outpatient-record.v1',
      personalHistory: '医生确认值',
    };

    sdk._dispatchEnvelope(expected);
    await expect(pending).resolves.toEqual(expected.event.payload);
  });

  it('accepts a manual-override mapping onto the marital reproductive history projection', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);
    const expected = createConfirmedEnvelope(request);
    const metadata = expected.event.payload.templateMetadata as {
      fields: Array<Record<string, unknown>>;
    };
    metadata.fields[0].recordField = 'maritalReproductiveHistory';
    metadata.fields[0].mappingSource = 'manual-override';
    metadata.fields[0].projectionMode = 'direct';
    expected.event.payload.writebackScope = {
      recordFields: ['maritalReproductiveHistory'],
      includeDiagnosis: false,
      orderTypes: [],
    };
    expected.event.payload.outpatientRecord = {
      schemaVersion: 'outpatient-record.v1',
      maritalReproductiveHistory: '医生确认值',
    };

    sdk._dispatchEnvelope(expected);
    await expect(pending).resolves.toEqual(expected.event.payload);
  });

  it('rejects an identity-matched result with an inconsistent fixed-field projection', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);
    const rejected = expect(pending).rejects.toThrow('INVALID_OUTPATIENT_EMR_RESULT');
    const inconsistent = createConfirmedEnvelope(request);
    const metadata = inconsistent.event.payload.templateMetadata as {
      fields: Array<Record<string, unknown>>;
    };
    metadata.fields[0].recordField = 'personalHistory';
    metadata.fields[0].mappingSource = 'canonical-id';
    metadata.fields[0].projectionMode = 'direct';
    inconsistent.event.payload.writebackScope = {
      recordFields: ['personalHistory'],
      includeDiagnosis: false,
      orderTypes: [],
    };
    inconsistent.event.payload.outpatientRecord = {
      schemaVersion: 'outpatient-record.v1',
      personalHistory: '与字段参数不一致',
    };

    sdk._dispatchEnvelope(inconsistent);
    await rejected;
  });

  it('rejects the previous task when a different outpatient request replaces it', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const previousRequest = createRequest();
    const nextRequest = createRequest({
      visitId: 'visit-2',
      requestId: 'outpatient-emr-request-2',
    });

    const previous = sdk.analyzeOutpatientEmr(previousRequest);
    const previousRejected = expect(previous).rejects.toThrow('已被新的门诊模板分析请求替换');
    const next = sdk.analyzeOutpatientEmr(nextRequest);
    const nextRejected = expect(next).rejects.toThrow('门诊模板分析已取消');

    await previousRejected;
    expect(post).toHaveBeenCalledTimes(2);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    sdk._dispatchEnvelope(createCancelledEnvelope(nextRequest));
    await nextRejected;
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it.each([
    ['visit/template', { visitId: 'visit-2', templateId: 'template-2' }],
    ['template name', { templateName: '门诊复诊模板' }],
    ['rendered template', { templateHtml: '<section data-id="changed"></section>' }],
    ['template definition', { templateDefinition: '[]' }],
    ['target selection', { targetFieldIds: ['familyHistory'] }],
    ['patient facts', { patient: { idPi: 'patient-2' } }],
    ['record context', { recordContext: { recordText: '发热一天' } }],
  ])('rejects a reused requestId with changed %s without disturbing the original pending request', async (_label, overrides) => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    const post = stubAcceptedBridge(sdk);
    const originalRequest = createRequest();
    const original = sdk.analyzeOutpatientEmr(originalRequest);
    const conflictingRequest = createRequest(overrides);

    await expect(sdk.analyzeOutpatientEmr(conflictingRequest)).rejects.toThrow('REQUEST_ID_CONFLICT');
    expect(post).toHaveBeenCalledTimes(1);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    const expected = createConfirmedEnvelope(originalRequest);
    sdk._dispatchEnvelope(expected);
    await expect(original).resolves.toEqual(expected.event.payload);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it('ignores incomplete cancellation payloads and cancellation for another request', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    stubAcceptedBridge(sdk);
    const request = createRequest();
    const pending = sdk.analyzeOutpatientEmr(request);
    const rejected = expect(pending).rejects.toThrow('门诊模板分析已取消');

    sdk._dispatchEnvelope(createCancelledEnvelope(
      createRequest({ requestId: 'another-request' }),
    ));
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    const incomplete = createCancelledEnvelope(request);
    delete incomplete.event.payload.resultType;
    sdk._dispatchEnvelope(incomplete);
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(1);

    sdk._dispatchEnvelope(createCancelledEnvelope(request));
    await rejected;
    expect(sdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it('clears outpatient pending requests after HTTP failure and destroy', async () => {
    const MedHermes = loadSdk();
    const failedSdk = new MedHermes();
    failedSdk._callWithFallback = () => Promise.reject(new Error('bridge failed'));
    await expect(failedSdk.analyzeOutpatientEmr(createRequest())).rejects.toThrow('bridge failed');
    expect(failedSdk._pendingOutpatientEmrRequests).toHaveLength(0);

    const destroyedSdk = new MedHermes();
    stubAcceptedBridge(destroyedSdk);
    const pending = destroyedSdk.analyzeOutpatientEmr(createRequest());
    const rejected = expect(pending).rejects.toThrow('MedHermes SDK 已销毁');
    destroyedSdk.destroy();
    await rejected;
    expect(destroyedSdk._pendingOutpatientEmrRequests).toHaveLength(0);
  });

  it('uses a parameterless launch URL while retaining clinical data only in HTTP retries', async () => {
    const MedHermes = loadSdk();
    const sdk = new MedHermes({ launchRetryMs: 0 });
    const launchUrls: string[] = [];
    const post = vi.fn<HttpPost>()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValue({ status: 'success' });
    sdk._handshake = () => Promise.resolve({ status: 'success' });
    sdk._ensureInteractionChannel = vi.fn();
    sdk._resumeEventChannelIfNeeded = vi.fn();
    sdk._launcher.launch = (path, params) => {
      let url = `med-hermes://${path || 'launch'}`;
      if (params) url += `?data=${encodeURIComponent(JSON.stringify(params))}`;
      launchUrls.push(url);
    };
    sdk._http.post = post;

    const request = createRequest({
      requestId: 'outpatient-emr-request-launch-1',
      templateHtml: '<div>HTML-CONTENT-SENTINEL</div>',
      templateDefinition: '[{"NAME":"DEFINITION-CONTENT-SENTINEL"}]',
      recordContext: { recordText: 'RECORD-CONTEXT-SENTINEL' },
    });
    const pending = sdk.analyzeOutpatientEmr(request);
    const cancelled = expect(pending).rejects.toThrow('门诊模板分析已取消');

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(launchUrls).toEqual(['med-hermes://launch']);
    expect(launchUrls[0]).not.toContain('HTML-CONTENT-SENTINEL');
    expect(launchUrls[0]).not.toContain('DEFINITION-CONTENT-SENTINEL');
    expect(launchUrls[0]).not.toContain('RECORD-CONTEXT-SENTINEL');

    const retriedPayload = post.mock.calls[1][1];
    expect(retriedPayload.templateHtml).toBe('<div>HTML-CONTENT-SENTINEL</div>');
    expect(retriedPayload.templateDefinition).toBe('[{"NAME":"DEFINITION-CONTENT-SENTINEL"}]');
    expect(retriedPayload.recordContext.recordText).toBe('RECORD-CONTEXT-SENTINEL');
    expect(retriedPayload.requestId).toBe('outpatient-emr-request-launch-1');

    sdk._dispatchEnvelope(createCancelledEnvelope(retriedPayload));
    await cancelled;
  });
});
