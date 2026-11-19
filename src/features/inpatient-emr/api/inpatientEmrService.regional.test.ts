// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInpatientEmrPreviewStream } from './inpatientEmrService';
import { PhisHisAdapter } from '@/services/his/PhisHisAdapter';
import type { HisService } from '@/services/hisService';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult, InpatientEmrTemplateField } from '../types';

const boundary = vi.hoisted(() => ({
  post: vi.fn(),
  sse: vi.fn(),
  finishTrace: vi.fn(),
  failTrace: vi.fn(),
  hisAdapter: vi.fn(),
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
vi.mock('@/services/his', () => ({ getHisAdapter: boundary.hisAdapter }));

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
  boundary.hisAdapter.mockReset().mockReturnValue(null);
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
  it('sends both template sources and only the selected visit’s original clinical facts to the model', async () => {
    const visitId = 'SYN-SELECTED';
    const service = {
      getTenantId: () => 'SYN-PRIVATE-TENANT',
      queryPatientVisitHistory: vi.fn().mockResolvedValue([{ idVis: visitId, idPi: 'SYN-PATIENT' }]),
      loadClinicMedicalRecord: vi.fn().mockResolvedValue({
        soapData: {
          presentIllness: '合成病史甲', historyOfPresentIllness: '合成病史乙',
          pastHistory: { value: '嵌套病史原文', idPi: 'SYN-PATIENT', idUser: 'SYN-PRIVATE-NESTED',
            unrelated: { patientId: 'SYN-OTHER', value: '其他患者嵌套原文' } },
          vitlSigns: { temp: '38℃（腋温）', TEMP: 37.6, idOrg: 'SYN-PRIVATE-ORG' },
          idUser: 'SYN-PRIVATE-OPERATOR',
        },
        diagList: [null, { naDiag: '合成诊断名甲', naIcd10: '合成诊断名乙' }, { idPi: 'SYN-OTHER', naDiag: '其他患者诊断' }],
        orderList: '合成医嘱自由原文，首日 0.5 片',
      }),
      queryOutpatientMedicalRecordDocuments: vi.fn().mockResolvedValue([
        { idHospital: 'OTHER-VISIT', idMedrecdoc: 'OTHER-DOC', naMed: '其他就诊文书' },
        { idHospital: visitId, idMedrecdoc: 'SYN-DOC', naMed: '本次就诊文书' },
      ]),
      queryOutpatientMedicalRecordContent: vi.fn().mockResolvedValue({
        idMedrecdoc: 'SYN-DOC', htmlContent: '<p>所选文书原文</p>',
      }),
    };
    const adapter = new PhisHisAdapter(service as unknown as HisService);
    await adapter.fetchOutpatientVisitHistory('SYN-PATIENT');
    boundary.hisAdapter.mockReturnValue(adapter);
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"诊断依据文本":"合成草稿"}'));
    await generateInpatientEmrPreviewStream({
      ...request, outpatientVisitId: visitId,
      htmlContent: '<span data-id="诊断依据文本" data-type="text" data-default="合成预置病史甲"><span class="tag-value">请填写查体，已测左上肢温度37.6℃</span></span>',
    });
    expect(service.loadClinicMedicalRecord).toHaveBeenCalledWith(visitId, 'SYN-PATIENT');
    const prompt = boundary.sse.mock.calls[0][1].messages[1].content as string;
    const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
    expect(tasks[0].templateText).toEqual({ rendered: '请填写查体，已测左上肢温度37.6℃', attributeDefault: '合成预置病史甲' });
    const facts = JSON.parse(prompt.split('【所选门诊就诊原始临床资料】')[1].split('\n')[0]);
    expect(facts).toEqual({ source: 'loadClinicMedicalRecord', fields: {
      soapData: { presentIllness: '合成病史甲', historyOfPresentIllness: '合成病史乙', pastHistory: { value: '嵌套病史原文' },
        vitlSigns: { temp: '38℃（腋温）', TEMP: 37.6 } },
      diagList: [null, { naDiag: '合成诊断名甲', naIcd10: '合成诊断名乙' }],
      orderList: '合成医嘱自由原文，首日 0.5 片',
    } });
    expect(prompt).toContain('所选文书原文');
    expect(prompt).not.toMatch(/SYN-PRIVATE-|其他就诊文书|其他患者嵌套原文|其他患者诊断|OTHER-DOC/);
  });

  it('isolates an explicitly different patient or visit without losing the current admission facts', async () => {
    const visitId = 'SYN-SELECTED';
    boundary.hisAdapter.mockReturnValue({ fetchOutpatientMedicalRecord: vi.fn()
      .mockResolvedValueOnce({ visitId, patientId: 'SYN-OTHER-PATIENT', plainText: '其他患者专属原文' })
      .mockResolvedValueOnce({ visitId: 'SYN-OTHER-VISIT', patientId: 'SYN-PATIENT', plainText: '其他就诊专属原文' }) });
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"诊断依据文本":"本次草稿"}'));
    for (let i = 0; i < 2; i++) await generateInpatientEmrPreviewStream({ ...request, outpatientVisitId: visitId });
    for (const [, payload] of boundary.sse.mock.calls) {
      const prompt = payload.messages[1].content;
      expect(prompt).not.toMatch(/其他患者专属原文|其他就诊专属原文/);
      expect(prompt).toContain(request.doctorSupplement);
    }
    expect(boundary.sse).toHaveBeenCalledTimes(2);
  });

  it('generates each clearly authorized field even when neighboring remote rules are invalid', async () => {
    const fieldIds = ['allowed', 'missing', 'duplicate', 'bad-rule', 'disabled'];
    boundary.post.mockResolvedValue({ fields: [
      { id: 'allowed', aiSuitable: true }, null, { id: 'unexpected', aiSuitable: true },
      { id: 'duplicate', aiSuitable: true }, { id: 'duplicate', aiSuitable: false },
      { id: 'bad-rule', aiSuitable: true, rule: { constraints: [42] } }, { id: 'disabled', aiSuitable: false },
    ] });
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"allowed":"有效草稿","duplicate":"越界正文"}'));
    const result = await generateInpatientEmrPreviewStream({
      ...request, htmlContent: fieldIds.map(id => `<span data-id="${id}" data-name="主诉" data-type="text"></span>`).join(''),
    });
    const prompt = boundary.sse.mock.calls[0][1].messages[1].content as string;
    const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
    expect(tasks.map((field: { id: string }) => field.id)).toEqual(['allowed']);
    expect(prompt).toContain(request.doctorSupplement);
    expect(result.fieldValues).toEqual({ allowed: '有效草稿', missing: '', duplicate: '', 'bad-rule': '', disabled: '' });
    expect(boundary.post).toHaveBeenCalledTimes(1);
  });

  it('retains a good classification alongside malformed, duplicate and unrelated classifier replies', async () => {
    boundary.post.mockImplementation(async (path: string) => path.endsWith('/resolve') ? { fields: [] } : { content: JSON.stringify([
      { id: 'a', aiSuitable: true }, { id: 'b', aiSuitable: 'true' }, { id: 'c', aiSuitable: true },
      { id: 'elsewhere', aiSuitable: true }, { id: 'c', aiSuitable: false }, null,
    ]) });
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"a":"合成正文"}'));
    await generateInpatientEmrPreviewStream({
      ...request, htmlContent: ['a', 'b', 'c'].map(id => `<span data-id="${id}" data-name="扩展栏" data-type="text"></span>`).join(''),
    });
    const prompt = boundary.sse.mock.calls[0][1].messages[1].content as string;
    const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
    expect(tasks.map((field: { id: string }) => field.id)).toEqual(['a']);
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual(['/v1/client/inpatient-emr/templates/resolve', '/v1/ai/chat']);
  });

  it('finishes a successful stream with one returned field and keeps the omitted field blank', async () => {
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => {
      onChunk('{"fieldValues":{"诊断依据文本":"合成');
      onChunk('模型正文"}}');
    });
    const result = await generateInpatientEmrPreviewStream(request);
    assertSingleStreamingRequest();
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
    expect(result.fieldValues).toEqual({
      页眉住院号: 'SYN-HOSPITAL', 诊断依据文本: '合成模型正文', 鉴别诊断文本: '',
    });
    expect(boundary.finishTrace).toHaveBeenCalledTimes(1);
  });

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

  it('bounds both template requests, classifies once on cache failure, and surfaces local rules', async () => {
    boundary.post.mockRejectedValue(Object.assign(new Error('SYN service unavailable'), { status: 503 }));
    boundary.sse.mockImplementation(async (_path, _body, onChunk) => onChunk('{"诊断依据文本":"合成诊断依据","鉴别诊断文本":"合成鉴别依据"}'));
    const progress = vi.fn();
    const result = await generateInpatientEmrPreviewStream({
      ...request,
      htmlContent: request.htmlContent + '<span data-id="syn-extra" data-type="text" data-name="合成自定义字段"></span>',
    }, progress);

    expect(boundary.post.mock.calls.map(([path, , timeout]) => [path, timeout])).toEqual([
      ['/v1/client/inpatient-emr/templates/resolve', 30_000], ['/v1/ai/chat', 30_000],
    ]);
    expect(result.template.fields.find(field => field.id === 'syn-extra')?.aiSuitable).toBe(false);
    expect(result.trace.stages.find(stage => stage.key === 'templateResolve')?.detail).toContain('使用本地模板');
    const details = progress.mock.calls.map(([step]) => step.detail).join(' ');
    expect(details).toContain('正在读取后台字段配置');
    expect(details).toContain('正在分析 1 个待确认字段');
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
    const requestId = '88bbaf2d-d6a0-4d71-8ba9-9807d46fb6a4';
    boundary.sse.mockRejectedValue(Object.assign(new Error('SYN private upstream body'), { status: 503, requestId }));
    const snapshots: InpatientEmrGenerationResult[] = [];
    await expect(generateInpatientEmrPreviewStream(request, undefined, (snapshot) => snapshots.push(snapshot)))
      .rejects.toThrow('生成未完成');

    assertSingleStreamingRequest();
    const last = snapshots[snapshots.length - 1];
    expect(last.evidenceSummary.aiGeneration.status).toBe('failed');
    expect(last.fieldValues.诊断依据文本).toBe('');
    expect(last.fieldValues.鉴别诊断文本).toBe('');
    expect(last.emrContent).toBe('');
    expect(last.evidenceSummary.aiGeneration.detail).toContain('HTTP 503');
    expect(last.evidenceSummary.aiGeneration.detail).toContain(requestId);
    expect(last.evidenceSummary.aiGeneration.detail).toContain('未收到可用字段正文');
    expect(last.evidenceSummary.aiGeneration.detail).not.toContain('private upstream body');
    expect(boundary.failTrace).toHaveBeenCalledTimes(1);
  });
});
