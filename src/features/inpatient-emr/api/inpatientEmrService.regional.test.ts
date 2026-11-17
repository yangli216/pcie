// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInpatientEmrPreviewStream } from './inpatientEmrService';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult, InpatientEmrTemplateField } from '../types';

const boundary = vi.hoisted(() => ({
  post: vi.fn(),
  sse: vi.fn(),
  finishTrace: vi.fn(),
  failTrace: vi.fn(),
}));

// Keep the production service, prompts, final/partial parsers, llm.ts payload
// builder and retry policy. Replace only network and observational boundaries.
vi.mock('@/services/regionalClient', () => ({
  regionalPost: boundary.post,
  createRegionalSSE: boundary.sse,
  getCachedBootstrap: () => ({ llm: { model: 'SYN-MANAGED', fastModel: 'SYN-FAST' } }),
  buildRegionalSpeechUploadPayload: vi.fn(),
}));
vi.mock('@/services/aiTrace', () => ({
  beginAiTrace: () => ({ traceId: 'SYN-AI-TRACE', sessionId: 'SYN-AI-SESSION' }),
  updateAiTraceRequestPayload: vi.fn(),
  finishAiTrace: boundary.finishTrace,
  failAiTrace: boundary.failTrace,
}));
vi.mock('@/services/feedbackContext', () => ({ getFeedbackActor: () => ({}) }));
vi.mock('@/services/llm/config', () => ({
  getLLMConfig: () => ({ model: 'SYN-MANAGED', fastModel: 'SYN-FAST' }),
  getReviewerLLMConfig: () => ({ configProfile: 'reviewer' }),
}));
vi.mock('@/services/his', () => ({ getHisAdapter: () => null }));

const aiIds = ['诊断依据文本', '鉴别诊断文本'];
const request: InpatientEmrGenerationRequest = {
  admissionId: 'SYN-REGIONAL-ADMISSION',
  requestId: 'SYN-REGIONAL-REQUEST',
  templateId: 'SYN-REGIONAL-TEMPLATE',
  templateName: '首次病程记录',
  recordTime: '2026-11-17 09:30',
  doctorSupplement: '合成病例本次病史与查体资料',
  hisContext: { patient: { patientId: 'SYN-PATIENT', name: '合成患者', inpatientNo: 'SYN-HOSPITAL' } },
  htmlContent: '<section>'
    + '<span data-id="页眉住院号" data-name="住院号" data-type="text" data-readonly="true"><span class="tag-value">当前模板系统值</span></span>'
    + aiIds.map((id) => `<span data-id="${id}" data-name="${id}" data-type="text"><span class="tag-value">请输入${id}</span></span>`).join('')
    + '</section>',
};

beforeEach(() => {
  boundary.post.mockReset().mockImplementation(async (path: string, payload: { fields: InpatientEmrTemplateField[] }) => {
    if (path !== '/v1/client/inpatient-emr/templates/resolve') throw new Error(`Unexpected synthetic network request: ${path}`);
    return {
      cacheHit: true,
      fields: payload.fields.map((field) => ({
        ...field,
        aiSuitable: aiIds.includes(field.id),
        presetStatus: 'exclude',
        defaultValue: 'SYN-STALE-CACHE-DEFAULT',
        rule: { source: 'manual_or_his', prompt: `仅依据合成资料生成${field.name}`, constraints: [], dependencies: [] },
      })),
    };
  });
  boundary.sse.mockReset();
  boundary.finishTrace.mockClear();
  boundary.failTrace.mockClear();
});

function assertSingleStreamingRequest() {
  expect(boundary.sse).toHaveBeenCalledTimes(1);
  expect(boundary.sse).toHaveBeenCalledWith('/v1/ai/chat', expect.objectContaining({
    stream: true,
    configProfile: 'fast',
    scene: 'inpatient-emr-generate',
    sourceModule: 'inpatient-emr',
    operationAction: 'generate_record_stream',
    enableSearch: false,
    traceId: 'SYN-AI-TRACE',
    sessionId: 'SYN-AI-SESSION',
  }), expect.any(Function));
  expect(boundary.post.mock.calls.map(([path]) => path)).toEqual(['/v1/client/inpatient-emr/templates/resolve']);
  const templateRequest = boundary.post.mock.calls[0][1];
  expect(templateRequest).not.toHaveProperty('unknownFieldIds');
  expect(JSON.stringify(templateRequest.fields)).not.toMatch(/presetStatus|unknownFieldIds/);
  const messages = boundary.sse.mock.calls[0][1].messages as Array<{ role: string; content: string }>;
  expect(messages.map((message) => message.role)).toEqual(['system', 'user']);
  const prompt = messages[1].content;
  for (const id of aiIds) expect(prompt).toContain(`"id": "${id}"`);
  expect(prompt).not.toContain('"id": "页眉住院号"');
  for (const internal of ['presetStatus', 'defaultValue', 'SYN-STALE-CACHE-DEFAULT', 'promptGeneratorInstruction', 'FIELD_PROMPTS=', '输出 JSON 数组']) {
    expect(prompt).not.toContain(internal);
  }
}

describe('inpatient production service → real LLM client → regional network boundary', () => {
  it('sends one managed streaming request and fills every configured AI field from the accepted final response', async () => {
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => {
      onChunk('{"诊断依据文本":"合成诊断依据",');
      onChunk('"鉴别诊断文本":"合成鉴别方向与依据"}');
    });
    const result = await generateInpatientEmrPreviewStream(request);

    assertSingleStreamingRequest();
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
    expect(result.fieldValues).toEqual({
      页眉住院号: 'SYN-HOSPITAL', 诊断依据文本: '合成诊断依据', 鉴别诊断文本: '合成鉴别方向与依据',
    });
    expect(result.htmlContent).not.toContain('请输入');
    expect(result.trace.stages.find((stage) => stage.key === 'aiGenerate')?.status).toBe('success');
    expect(result.template).not.toHaveProperty('unknownFieldIds');
    expect(JSON.stringify(result.template.fields)).not.toContain('presetStatus');
    expect(boundary.finishTrace).toHaveBeenCalledTimes(1);
    expect(boundary.failTrace).not.toHaveBeenCalled();
  });

  it('keeps an explicit backend opt-out despite the local clinical suggestion and stale AI source', async () => {
    boundary.post.mockImplementation(async (_path, payload) => ({
      cacheHit: true,
      fields: payload.fields.map((field: InpatientEmrTemplateField) => ({
        ...field, aiSuitable: field.id === '鉴别诊断文本', presetStatus: 'ai',
        rule: { source: 'ai', constraints: [] },
      })),
    }));
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"鉴别诊断文本":"合成鉴别依据"}'));
    const result = await generateInpatientEmrPreviewStream(request);
    expect(boundary.post.mock.calls[0][1].fields.find((field: InpatientEmrTemplateField) => field.id === '诊断依据文本').aiSuitable).toBe(true);
    expect(result.template.fields.find((field) => field.id === '诊断依据文本')).toMatchObject({ aiSuitable: false, rule: { source: 'manual_or_his' } });
    const prompt = boundary.sse.mock.calls[0][1].messages[1].content as string;
    const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
    expect(tasks.map((field: { id: string }) => field.id)).toEqual(['鉴别诊断文本']);
    expect(boundary.post).toHaveBeenCalledTimes(1);
    expect(boundary.sse).toHaveBeenCalledTimes(1);
  });

  it('uses an administrator opt-in for a locally undecided field without sending its local suggestion state', async () => {
    boundary.post.mockImplementation(async (_path, payload) => ({
      cacheHit: true,
      fields: payload.fields.map((field: InpatientEmrTemplateField) => ({
        ...field, aiSuitable: true, presetStatus: 'unknown',
        rule: { source: 'manual_or_his', constraints: [] },
      })),
    }));
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"syn-unknown":"合成自定义正文"}'));
    const result = await generateInpatientEmrPreviewStream({
      ...request, htmlContent: '<span data-id="syn-unknown" data-name="合成自定义字段" data-type="text">请输入</span>',
    });
    const payload = boundary.post.mock.calls[0][1];
    expect(payload.fields[0].aiSuitable).toBe(false);
    expect(payload).not.toHaveProperty('unknownFieldIds');
    expect(JSON.stringify(payload.fields)).not.toContain('presetStatus');
    expect(result.template.fields[0]).toMatchObject({ aiSuitable: true, rule: { source: 'ai' } });
    expect(result.template.fields[0]).not.toHaveProperty('presetStatus');
    expect(result.fieldValues['syn-unknown']).toBe('合成自定义正文');
    expect(boundary.post).toHaveBeenCalledTimes(1);
    expect(boundary.sse).toHaveBeenCalledTimes(1);
  });

  it('retains decoded partial text after a retryable interruption without another stream or a non-streaming fallback', async () => {
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => {
      onChunk('{"诊断依据文本":"\\u5408\\u6210依据\\n已收到');
      throw Object.assign(new Error('SYN server error'), { status: 503 });
    });
    const snapshots: InpatientEmrGenerationResult[] = [];
    const progress = vi.fn();
    await expect(generateInpatientEmrPreviewStream(request, progress, (snapshot) => snapshots.push(snapshot)))
      .rejects.toThrow('生成未完成');

    assertSingleStreamingRequest();
    const last = snapshots[snapshots.length - 1];
    expect(last.evidenceSummary.aiGeneration.status).toBe('failed');
    expect(last.fieldValues.诊断依据文本).toBe('合成依据\n已收到');
    expect(last.fieldValues.鉴别诊断文本).toBe('');
    expect(last.fieldValues.页眉住院号).toBe('SYN-HOSPITAL');
    expect(last.htmlContent).not.toContain('请输入');
    expect(last.trace.stages.find((stage) => stage.key === 'aiGenerate')?.status).toBe('error');
    expect(progress.mock.calls.some(([value]) => value.key === 'generate' && value.status === 'done')).toBe(false);
    expect(boundary.failTrace).toHaveBeenCalledTimes(1);
    expect(boundary.finishTrace).not.toHaveBeenCalled();
  });

  it('keeps a pre-output retryable failure to one request and leaves AI fields blank', async () => {
    boundary.sse.mockRejectedValue(Object.assign(new Error('SYN overloaded'), { status: 503 }));
    const snapshots: InpatientEmrGenerationResult[] = [];
    await expect(generateInpatientEmrPreviewStream(request, undefined, (snapshot) => snapshots.push(snapshot)))
      .rejects.toThrow('生成未完成');

    assertSingleStreamingRequest();
    const last = snapshots[snapshots.length - 1];
    expect(last.evidenceSummary.aiGeneration.status).toBe('failed');
    expect(last.fieldValues.诊断依据文本).toBe('');
    expect(last.fieldValues.鉴别诊断文本).toBe('');
    expect(last.emrContent).toBe('');
    expect(boundary.failTrace).toHaveBeenCalledTimes(1);
  });
});
