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

  it.each([
    ['plain', false], ['plain', true], ['encoded', false], ['encoded', true],
  ] as const)('sends valid fields and attributed partial evidence on %s input with cache hit %s', async (transport, hit) => {
    const leaf = (ID: string, NAME: string, TEXT: string, extra: Record<string, unknown> = {}) =>
      ({ ID, NAME, TYPE: 'text', READONLY: false, VALUE: '', TEXT, ...extra });
    const leaves = [
      leaf('lastVisit', '上次就诊时间', '上月初'),
      leaf('drift', '病程补充', '结构定义：七天', { VALUE: 543.21 }),
      leaf('hidden', '隐藏事实', '合成隐藏值'),
      leaf('restricted', '患者姓名', '合成行政姓名'),
      leaf('readOnly', '只读记录', '合成只读值', { READONLY: true }),
      leaf('badDict', '测量分类', '合成预设值', { TYPE: 'select' }),
      leaf('object', '症状描述', '结构可见文字', { VALUE: { idPi: '合成嵌套患者身份' } }),
    ];
    const fieldHtml = (id: string, name: string, value: string, attrs = '', type = 'text') =>
      `<span data-id="${id}" data-type="${type}" data-name="${name}" data-readonly="false" ${attrs}>${value}</span>`;
    const mixedHtml = '<section data-id="history" data-article="既往史" data-name="既往史">'
      + fieldHtml('lastVisit', '上次就诊时间', '上月初')
      + fieldHtml('drift', '病程补充', '页面：五天<span data-id="nested">合成他项身份</span>')
      + fieldHtml('hidden', '隐藏事实', '合成隐藏值', 'hidden')
      + fieldHtml('restricted', '病程文字', '合成行政姓名')
      + fieldHtml('readOnly', '只读记录', '合成只读值')
      + fieldHtml('badDict', '测量分类', '合成预设值', '', 'select')
      + fieldHtml('object', '症状描述', '页面可见文字')
      + '</section><section data-id="partial" data-article="其他" data-name="其他">'
      + fieldHtml('partialLeaf', '补充', '章节页面记录') + '</section>';
    const mixedDefinition = JSON.stringify([
      { ID: 'history', NAME: ' 既往史 ', ARTICLE: '既往史', eles: leaves },
      { ID: 'partial', NAME: '其他', eles: [leaf('partialLeaf', '补充', '章节结构记录')] },
    ]);
    const ids = [...leaves.map(item => item.ID), 'partialLeaf', 'unknown'];
    const parsed = parseOutpatientEmrTemplate(mixedHtml, mixedDefinition, ids);
    boundary.post.mockImplementation((path: string, body: Record<string, unknown>) => {
      if (path === DECODE) return { ...decodedResponse(mixedHtml), templateDefinition: mixedDefinition };
      if (path === RESOLVE && hit) return {
        ...resolveResponse(body, true),
        parseResult: { schemaVersion: 'outpatient-emr-template-pair.v1', fields: parsed.fields },
      };
      return fakeHttp(path, body);
    });
    const { analysis, model, complete } = setup();
    model.mockResolvedValueOnce('{"lastVisit":"上月初"}');
    const source = transport === 'plain'
      ? { templateHtml: mixedHtml, templateDefinition: mixedDefinition }
      : { templateHtml: `data:text/html;charset=utf-8;base64,${encode(mixedHtml)}`,
          templateDefinition: `data:application/json;charset=utf-8;base64,${encode(mixedDefinition)}` };
    await expect(analysis.start(encodedRequest({
      ...source, targetFieldIds: ids, recordContext: { recordText: '合成病例原话' },
    }))).resolves.toBe(true);
    expect(boundary.post.mock.calls.some(([path]) => path === SNAPSHOT)).toBe(!hit);
    expect(model).toHaveBeenCalledTimes(1);
    analysis.updateFieldValue('lastVisit', '');
    model.mockClear().mockResolvedValueOnce('{"lastVisit":"上月初"}');
    await expect(analysis.retry()).resolves.toBe(true);
    expect(model).toHaveBeenCalledTimes(1);
    const [system, user] = model.mock.calls[0][0];
    const received = JSON.parse(user.content.slice(user.content.indexOf('\n') + 1));
    expect(system.content).toContain('doctorTemplateEdits');
    expect(received.recordContext).toEqual({
      recordText: '合成病例原话',
      doctorTemplateEdits: [{
        id: 'lastVisit', name: '上次就诊时间', recordField: 'pastMedicalHistory', articleName: '既往史', value: '', source: 'doctor',
      }],
    });
    expect(received.template.fields).toEqual([expect.objectContaining({
      id: 'lastVisit', topic: 'past-history', templateDraft: '上月初', articleDefinitionName: ' 既往史 ',
    })]);
    expect(received.templateSourceNotes).toEqual(expect.arrayContaining([
      { fieldId: 'hidden', reason: 'hidden' },
      { fieldId: 'drift', reason: 'unavailable', htmlText: '页面：五天', definitionValues: [{ name: '病程补充', text: '结构定义：七天', value: 543.21 }] },
      { fieldId: 'partialLeaf', reason: 'unavailable', htmlText: '章节页面记录', definitionValues: [{ name: '补充', text: '章节结构记录', value: '' }] },
      { fieldId: 'object', reason: 'unavailable', htmlText: '页面可见文字', definitionValues: [{ name: '症状描述', text: '结构可见文字' }] },
      ...['restricted', 'badDict', 'readOnly', 'unknown'].map(fieldId => ({ fieldId, reason: 'unavailable' })),
    ]));
    for (const excluded of ['合成行政姓名', '合成嵌套患者身份', '合成隐藏值', '合成他项身份', '合成预设值', '合成只读值', 'SYN-PATIENT']) {
      expect(user.content).not.toContain(excluded);
    }
    expect(complete).not.toHaveBeenCalled();
    expect(analysis.fieldValues.value).toEqual({ lastVisit: '' });
    await expect(analysis.writeBack()).resolves.toBe(true);
    expect(complete.mock.calls[0][0].fieldValues).toEqual({ lastVisit: '' });
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
