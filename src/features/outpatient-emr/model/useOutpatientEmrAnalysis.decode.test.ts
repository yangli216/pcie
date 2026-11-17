// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeOutpatientEmrFields } from '../api/outpatientEmrService';
import { hashOutpatientEmrTemplate } from '../lib/outpatientEmrWriteback';
import { parseOutpatientEmrTemplate } from '../lib/outpatientEmrTemplate';
import type { OutpatientEmrAnalysisRequest } from '../types';
import { useOutpatientEmrAnalysis } from './useOutpatientEmrAnalysis';

const boundary = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.post }));

const DECODE = '/v1/client/outpatient-emr/templates/decode';
const RESOLVE = '/v1/client/outpatient-emr/templates/snapshots/resolve';
const SNAPSHOT = '/v1/client/outpatient-emr/templates/snapshots';
const html = '\n<section data-id="article-chief" data-article="主诉" data-name="合成主诉">'
  + '<span data-id="chiefComplaint" data-type="text" data-name="合成主诉" data-readonly="false"></span></section>\n';
const definition = JSON.stringify([{ ID: 'article-chief', NAME: '合成主诉', ARTICLE: '主诉', eles: [
  { ID: 'chiefComplaint', NAME: '合成主诉', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
] }]);

function encode(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value)));
}

function encodedRequest(overrides: Partial<OutpatientEmrAnalysisRequest> = {}): OutpatientEmrAnalysisRequest {
  return {
    visitId: 'SYN-VISIT', templateId: 'SYN-TEMPLATE', templateName: '合成门诊模板', requestId: 'SYN-REQUEST',
    templateHtml: `data:text/html;charset=utf-8;base64,${encode(html)}`,
    templateDefinition: `data:application/json;charset=utf-8;base64,${encode(definition)}`,
    targetFieldIds: ['chiefComplaint'], patient: { idPi: 'SYN-PATIENT', name: '合成患者', sdSexText: '男性', ageText: '40岁' },
    recordContext: { recordText: '咳嗽三天。' }, ...overrides,
  };
}

function decodedResponse(templateHtml = html) {
  return { schemaVersion: 'outpatient-emr-template-decoded.v1', templateHtml, templateDefinition: definition };
}

function resolveResponse(body: Record<string, unknown>, cacheHit = false) {
  return {
    schemaVersion: 'outpatient-emr-template-pair-resolution.v1', cacheHit,
    templateId: body.templateId, templateHash: body.templateHash,
    id: cacheHit ? 'SYN-SNAPSHOT' : null, receivedAt: cacheHit ? 1 : null,
    parseResult: cacheHit ? {
      schemaVersion: 'outpatient-emr-template-pair.v1',
      fields: parseOutpatientEmrTemplate(html, definition, ['chiefComplaint']).fields,
    } : null,
  };
}

function fakeHttp(path: string, body: Record<string, unknown>): unknown {
  if (path === DECODE) return decodedResponse();
  if (path === RESOLVE) return resolveResponse(body);
  if (path === SNAPSHOT) return { id: 'SYN-SNAPSHOT', templateHash: body.templateHash, deduplicated: false, receivedAt: 1 };
  throw new Error(`Unexpected synthetic route ${path}`);
}

function setup() {
  const model = vi.fn().mockResolvedValue(JSON.stringify({ chiefComplaint: '咳嗽三天。' }));
  const complete = vi.fn().mockResolvedValue(undefined);
  const analysis = useOutpatientEmrAnalysis({
    analyzeFields: input => analyzeOutpatientEmrFields(input, { chatFast: model }),
    completeConsultation: complete,
  });
  return { analysis, model, complete };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => { boundary.post.mockReset().mockImplementation(fakeHttp); });
afterEach(() => vi.unstubAllGlobals());

describe('server-decoded outpatient template analysis', () => {
  it('uses server originals for real parsing, hashing and model prompts while keeping wire sources encoded', async () => {
    const raw = encodedRequest();
    const expectedHash = await hashOutpatientEmrTemplate(html, definition);
    const encodedHash = await hashOutpatientEmrTemplate(raw.templateHtml, raw.templateDefinition);
    const { analysis, model, complete } = setup();
    vi.stubGlobal('atob', () => { throw new Error('Base64 decoding belongs to PCIE Server'); });
    await expect(analysis.start(raw)).resolves.toBe(true);
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual([DECODE, RESOLVE, SNAPSHOT]);
    expect(boundary.post.mock.calls[0][1]).toEqual({
      schemaVersion: 'outpatient-emr-template-decode.v1', templateHtml: raw.templateHtml, templateDefinition: raw.templateDefinition,
    });
    expect(boundary.post.mock.calls[1][1].templateHash).toBe(expectedHash);
    expect(boundary.post.mock.calls[2][1]).toMatchObject({
      templateHtml: raw.templateHtml, templateDefinition: raw.templateDefinition, templateHash: expectedHash,
      parseResult: { fields: [{ id: 'chiefComplaint', name: '合成主诉' }] },
    });
    expect(analysis.templateHash.value).toBe(expectedHash);
    expect(analysis.templateHash.value).not.toBe(encodedHash);
    expect(analysis.request.value).toBe(raw);
    expect(analysis.request.value?.templateHtml).toBe(raw.templateHtml);
    expect(analysis.template.value?.sanitizedHtml).toContain('data-id="chiefComplaint"');
    expect(analysis.fieldValues.value).toEqual({ chiefComplaint: '咳嗽三天。' });
    const messages = JSON.stringify(model.mock.calls[0][0]);
    expect(messages).toContain('合成主诉');
    expect(messages).toContain('咳嗽三天');
    expect(messages).not.toContain(raw.templateHtml);
    expect(messages).not.toContain('SYN-PATIENT');
    expect(messages).not.toContain('合成患者');
    const confirmed = analysis.buildConfirmedPayload();
    expect(confirmed).toMatchObject({
      requestId: raw.requestId, resultType: 'record-confirmed',
      templateMetadata: { templateHash: expectedHash },
      fieldValues: { chiefComplaint: '咳嗽三天。' },
      emrFieldValues: { chiefComplaint: '咳嗽三天。' },
    });
    await expect(analysis.writeBack()).resolves.toBe(true);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][0]).toMatchObject({
      requestId: raw.requestId, resultType: 'record-confirmed',
      templateMetadata: { templateHash: expectedHash }, fieldValues: confirmed?.fieldValues,
    });
    expect(complete.mock.calls[0][0]).not.toHaveProperty('templateHtml');
    expect(complete.mock.calls[0][0]).not.toHaveProperty('templateDefinition');
    expect(analysis.request.value?.templateHtml).toBe(raw.templateHtml);
    console.info(JSON.stringify({
      evidence: 'synthetic-outpatient-template-server-decode',
      request: { requestId: raw.requestId, encodedSourceLengths: [raw.templateHtml.length, raw.templateDefinition.length] },
      response: { schemaVersion: 'outpatient-emr-template-decoded.v1', decodedSourceLengths: [html.length, definition.length] },
      snapshotSourcesRemainEncoded: boundary.post.mock.calls[2][1].templateHtml === raw.templateHtml,
      templateHash: expectedHash,
      final: { count: complete.mock.calls.length, resultType: confirmed?.resultType, fieldValues: confirmed?.fieldValues },
    }));
    await expect(analysis.start({ ...raw })).resolves.toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
    expect(boundary.post).toHaveBeenCalledTimes(3);
    await expect(analysis.start({ ...raw, templateHtml: html, templateDefinition: definition })).resolves.toBe(false);
    expect(analysis.analysisErrorCode.value).toBe('REQUEST_ID_CONFLICT');
  });

  it('adds no decoding request for an already plain template pair', async () => {
    const plain = encodedRequest({ templateHtml: html, templateDefinition: definition });
    const { analysis } = setup();
    await expect(analysis.start(plain)).resolves.toBe(true);
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual([RESOLVE, SNAPSHOT]);
    expect(boundary.post.mock.calls[1][1]).toMatchObject({ templateHtml: html, templateDefinition: definition });
  });

  it('restores a historical snapshot with decoded HTML without reparsing or registering it', async () => {
    boundary.post.mockImplementation((path: string, body: Record<string, unknown>) => (
      path === RESOLVE ? resolveResponse(body, true) : fakeHttp(path, body)
    ));
    const parse = vi.fn(() => { throw new Error('cache hit must not reparse'); });
    const model = vi.fn().mockResolvedValue({ chiefComplaint: '历史字段的本次病历' });
    const analysis = useOutpatientEmrAnalysis({ analyzeFields: model, parseTemplate: parse });
    await expect(analysis.start(encodedRequest())).resolves.toBe(true);
    expect(parse).not.toHaveBeenCalled();
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual([DECODE, RESOLVE]);
    expect(model.mock.calls[0][0].request.templateHtml).toBe(html);
    expect(model.mock.calls[0][0].request.templateDefinition).toBe(definition);
    expect(analysis.template.value?.sanitizedHtml).toContain('data-id="chiefComplaint"');
  });

  it.each(['remote failure', 'encoded response', 'bare Base64 response'] as const)('stops before hashing, snapshots and AI after %s', async (failure) => {
    boundary.post.mockImplementation(() => {
      if (failure === 'remote failure') throw new Error('合成服务端解码失败');
      if (failure === 'bare Base64 response') return { ...decodedResponse(), templateHtml: encode(html) };
      return { ...decodedResponse(), templateHtml: encodedRequest().templateHtml };
    });
    const hash = vi.fn();
    const model = vi.fn();
    const analysis = useOutpatientEmrAnalysis({ analyzeFields: model, hashTemplate: hash });
    await expect(analysis.start(encodedRequest())).resolves.toBe(false);
    expect(analysis.analysisStatus.value).toBe('error');
    expect(analysis.canSubmit.value).toBe(false);
    expect(analysis.templateHash.value).toBe('');
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual([DECODE]);
    expect(hash).not.toHaveBeenCalled();
    expect(model).not.toHaveBeenCalled();
  });

  it('ignores an older decode response after a new request is ready', async () => {
    const oldDecode = deferred<unknown>();
    let decodeCount = 0;
    const newHtml = `${html}<!--new template bytes-->`;
    boundary.post.mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path === DECODE) return decodeCount++ === 0 ? oldDecode.promise : decodedResponse(newHtml);
      return fakeHttp(path, body);
    });
    const { analysis, model } = setup();
    const oldRun = analysis.start(encodedRequest());
    await vi.waitFor(() => expect(boundary.post).toHaveBeenCalledTimes(1));
    const newRequest = encodedRequest({ requestId: 'SYN-NEW-REQUEST', templateHtml: `data:text/html;charset=utf-8;base64,${encode(newHtml)}` });
    await expect(analysis.start(newRequest)).resolves.toBe(true);
    await expect(oldRun).resolves.toBe(false);
    const expectedHash = await hashOutpatientEmrTemplate(newHtml, definition);
    oldDecode.resolve(decodedResponse());
    await Promise.resolve();
    expect(analysis.request.value?.requestId).toBe('SYN-NEW-REQUEST');
    expect(analysis.templateHash.value).toBe(expectedHash);
    expect(analysis.analysisStatus.value).toBe('ready');
    expect(model).toHaveBeenCalledTimes(1);
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual([DECODE, DECODE, RESOLVE, SNAPSHOT]);
  });

  it('cancels a pending decode without producing snapshots, model output or a hash', async () => {
    const pending = deferred<unknown>();
    boundary.post.mockReturnValue(pending.promise);
    const { analysis, model } = setup();
    const running = analysis.start(encodedRequest());
    await vi.waitFor(() => expect(boundary.post).toHaveBeenCalledTimes(1));
    analysis.reset();
    await expect(running).resolves.toBe(false);
    pending.resolve(decodedResponse());
    await Promise.resolve();
    expect(analysis.request.value).toBeNull();
    expect(analysis.templateHash.value).toBe('');
    expect(analysis.analysisStatus.value).toBe('idle');
    expect(model).not.toHaveBeenCalled();
    expect(boundary.post).toHaveBeenCalledTimes(1);
  });

  it('does not let an old hash overwrite the current request after decoding succeeded', async () => {
    const oldHash = deferred<string>();
    const hash = vi.fn().mockReturnValueOnce(oldHash.promise).mockResolvedValueOnce('b'.repeat(64));
    const model = vi.fn().mockResolvedValue({ chiefComplaint: '本次主诉' });
    const analysis = useOutpatientEmrAnalysis({ analyzeFields: model, hashTemplate: hash });
    const oldRun = analysis.start(encodedRequest());
    await vi.waitFor(() => expect(hash).toHaveBeenCalledTimes(1));
    await expect(analysis.start(encodedRequest({ requestId: 'SYN-NEW-REQUEST' }))).resolves.toBe(true);
    oldHash.resolve('a'.repeat(64));
    await expect(oldRun).resolves.toBe(false);
    expect(analysis.templateHash.value).toBe('b'.repeat(64));
    expect(model).toHaveBeenCalledTimes(1);
  });
});
