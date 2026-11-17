import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutpatientEmrAnalysisRequest } from '../types';
import { normalizeOutpatientEmrTemplateSource } from './outpatientEmrTemplateDecodeService';

const boundary = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.post }));

const html = '\n<section>合成模板原文</section>\n';
const definition = '\n[{"ID":"合成章节","eles":[]}]\n';
const encodedHtml = 'data:text/html;charset=utf-8;base64,PHNlY3Rpb24+PC9zZWN0aW9uPg==';
const encodedDefinition = 'data:application/json;charset=utf-8;base64,W10=';
const response = { schemaVersion: 'outpatient-emr-template-decoded.v1', templateHtml: html, templateDefinition: definition };

function request(overrides: Partial<OutpatientEmrAnalysisRequest> = {}): OutpatientEmrAnalysisRequest {
  return {
    visitId: 'SYN-VISIT', requestId: 'SYN-REQUEST', templateId: 'SYN-TEMPLATE', templateName: '合成模板',
    templateHtml: encodedHtml, templateDefinition: encodedDefinition, targetFieldIds: ['SYN-FIELD'],
    patient: { name: '合成患者', idPi: 'SYN-PATIENT' }, recordContext: { recordText: '合成临床事实' },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => { boundary.post.mockReset(); });
afterEach(() => vi.unstubAllGlobals());

describe('normalizeOutpatientEmrTemplateSource', () => {
  it('keeps a decoded plain pair byte-for-byte and adds no network request', async () => {
    const plain = request({ templateHtml: html, templateDefinition: definition });
    await expect(normalizeOutpatientEmrTemplateSource(plain)).resolves.toBe(plain);
    const embedded = request({ templateHtml: '<img src="data:image/png;base64,YQ==">', templateDefinition: definition });
    await expect(normalizeOutpatientEmrTemplateSource(embedded)).resolves.toBe(embedded);
    expect(boundary.post).not.toHaveBeenCalled();
  });

  it('forwards only encoded template sources to the signed endpoint and preserves server originals', async () => {
    boundary.post.mockResolvedValue(response);
    vi.stubGlobal('atob', () => { throw new Error('the client must not decode Base64'); });
    const raw = request();
    const normalized = await normalizeOutpatientEmrTemplateSource(raw);
    expect(boundary.post).toHaveBeenCalledExactlyOnceWith('/v1/client/outpatient-emr/templates/decode', {
      schemaVersion: 'outpatient-emr-template-decode.v1',
      templateHtml: encodedHtml, templateDefinition: encodedDefinition,
    });
    expect(normalized).toEqual({ ...raw, templateHtml: html, templateDefinition: definition });
    expect(raw.templateHtml).toBe(encodedHtml);
    expect(raw.templateDefinition).toBe(encodedDefinition);
  });

  it.each([
    [html, encodedDefinition],
    [encodedHtml, definition],
    ['data:text/plain;charset=utf-8;base64,YQ==', encodedDefinition],
    ['data:text/html;base64,YQ==', encodedDefinition],
    [` ${encodedHtml}`, encodedDefinition],
    [encodedHtml.toUpperCase(), encodedDefinition],
    [encodedHtml, 'data:application/json;charset=utf-8;base64,'],
  ])('rejects mixed or non-contract data URIs before calling the server', async (templateHtml, templateDefinition) => {
    await expect(normalizeOutpatientEmrTemplateSource(request({ templateHtml, templateDefinition })))
      .rejects.toMatchObject({ code: 'TEMPLATE_PAIR_MISMATCH' });
    expect(boundary.post).not.toHaveBeenCalled();
  });

  it.each([
    null,
    [],
    { ...response, schemaVersion: 'wrong' },
    { ...response, templateHtml: '' },
    { ...response, templateDefinition: '  ' },
    { ...response, templateDefinition: 1 },
    { ...response, unexpected: 'metadata' },
    { ...response, templateHtml: encodedHtml },
    { ...response, templateDefinition: ` ${encodedDefinition}` },
    { ...response, templateHtml: 'PHNlY3Rpb24+PC9zZWN0aW9uPg==' },
    { ...response, templateDefinition: 'W10=' },
    { ...response, templateHtml: '<!--not an HTML template-->' },
  ])('rejects malformed or recursively encoded server responses', async (value) => {
    boundary.post.mockResolvedValue(value);
    await expect(normalizeOutpatientEmrTemplateSource(request())).rejects.toMatchObject({ code: 'INVALID_TEMPLATE_JSON' });
    expect(boundary.post).toHaveBeenCalledTimes(1);
  });

  it('propagates server decoding failures without a local fallback', async () => {
    const error = new Error('合成服务端拒绝非法Base64');
    boundary.post.mockRejectedValue(error);
    await expect(normalizeOutpatientEmrTemplateSource(request())).rejects.toBe(error);
    expect(boundary.post).toHaveBeenCalledTimes(1);
  });

  it('stops waiting after cancellation and ignores a later decode response', async () => {
    const remote = deferred<unknown>();
    boundary.post.mockReturnValue(remote.promise);
    const cancellation = new AbortController();
    const result = normalizeOutpatientEmrTemplateSource(request(), cancellation.signal);
    cancellation.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    remote.resolve(response);
    await Promise.resolve();
    expect(boundary.post).toHaveBeenCalledTimes(1);
  });

  it('does not send an already cancelled request', async () => {
    const cancellation = new AbortController(); cancellation.abort();
    await expect(normalizeOutpatientEmrTemplateSource(request(), cancellation.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(boundary.post).not.toHaveBeenCalled();
  });
});
