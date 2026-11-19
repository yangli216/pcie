// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateInpatientEmrPreviewStream, parsePartialJson } from './inpatientEmrService';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult, InpatientEmrTemplateField } from '../types';

const boundary = vi.hoisted(() => ({ stream: vi.fn(), classify: vi.fn(), resolve: vi.fn() }));
vi.mock('@/services/llm', () => ({
  chatStream: boundary.stream, chatFast: boundary.classify,
  DEFAULT_RETRY_CONFIG: { maxRetries: 3, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
}));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.resolve }));
vi.mock('@/services/his', () => ({ getHisAdapter: () => null }));

const aiIds = ['主诉', '现病史', '既往史', '诊断依据文本', '鉴别诊断文本', '诊疗计划', '病情分析', '治疗经过', '入院情况', '辅助检查', '体格检查', '病程记录文本', '治疗结果'];
const request: InpatientEmrGenerationRequest = {
  admissionId: 'SYN-ADMISSION', templateId: 'SYN-FIRST-PROGRESS', templateName: '首次病程记录',
  recordTime: '2026-11-17 10:00', doctorSupplement: '本轮合成病史和查体资料',
  hisContext: { patient: { patientId: 'SYN-PATIENT', name: '合成患者', inpatientNo: 'SYN-HOSPITAL' } },
  htmlContent: '<section><span data-id="住院号" data-name="住院号" data-type="text" data-readonly="true"><span class="tag-value">当前HIS值</span></span>'
    + aiIds.map((id) => `<span data-id="${id}" data-name="${id}" data-type="text"><span class="tag-value">请输入${id}</span></span>`).join('') + '</section>',
};
const values = Object.fromEntries(aiIds.map((id) => [id, `合成${id}正文`]));

function configureRemote(transform?: (fields: InpatientEmrTemplateField[]) => unknown) {
  boundary.resolve.mockImplementation(async (_path, payload) => {
    const fields = (payload.fields as InpatientEmrTemplateField[]).map((field) => ({
      ...field,
      aiSuitable: aiIds.includes(field.id),
      // Reproduce the real cache/local-classifier conflict without patient data.
      presetStatus: 'exclude',
      defaultValue: '过期缓存占位', readonly: false,
      rule: { source: 'manual_or_his', prompt: `只生成合成${field.id}正文`, constraints: [], dependencies: [] },
    }));
    return { cacheHit: true, fields: transform ? transform(fields as InpatientEmrTemplateField[]) : fields };
  });
}

beforeEach(() => {
  boundary.stream.mockReset();
  boundary.classify.mockReset().mockResolvedValue('[]');
  boundary.resolve.mockReset();
  configureRemote();
});

describe('template → final field policy → prompt → stream → accepted preview', () => {
  it('generates all 13 configured fields despite stale exclusions and preserves current HTML/HIS facts', async () => {
    boundary.stream.mockImplementation(async (_messages, onChunk) => onChunk(JSON.stringify(values)));
    const result = await generateInpatientEmrPreviewStream(request);
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
    expect(result.fieldValues).toMatchObject(values);
    expect(result.fieldValues.住院号).toBe('当前HIS值');
    expect(result.template.fields.find((field) => field.id === '住院号')).toMatchObject({ readonly: true, defaultValue: '当前HIS值' });
    expect(result.template.fields.find((field) => field.id === '诊断依据文本')).toMatchObject({ aiSuitable: true, rule: { source: 'ai' } });
    expect(result.template.fields.every((field) => !Object.prototype.hasOwnProperty.call(field, 'presetStatus'))).toBe(true);
    const prompt = boundary.stream.mock.calls[0][0][1].content as string;
    expect(prompt).toContain('"id": "诊断依据文本"');
    expect(prompt).toContain('"id": "鉴别诊断文本"');
    expect(prompt).toContain('请输入诊断依据');
    for (const internal of ['presetStatus', 'defaultValue', 'promptGeneratorInstruction', 'FIELD_PROMPTS=', '输出 JSON 数组']) expect(prompt).not.toContain(internal);
    expect(boundary.stream.mock.calls[0][3]).toMatchObject({ maxRetries: 0 });
    expect(boundary.stream).toHaveBeenCalledTimes(1);
    expect(boundary.classify).not.toHaveBeenCalled();
  });

  it('finishes a partial field reply and keeps all recognized model text', async () => {
    const partial = { ...values };
    delete partial.诊断依据文本;
    delete partial.鉴别诊断文本;
    boundary.stream.mockImplementation(async (_messages, onChunk) => onChunk(JSON.stringify(partial)));
    const progress = vi.fn();
    const result = await generateInpatientEmrPreviewStream(request, progress);
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
    expect(result.fieldValues).toMatchObject({ ...partial, 诊断依据文本: '', 鉴别诊断文本: '' });
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'generate', status: 'done' }));
    expect(result.trace.stages.find((stage) => stage.key === 'aiGenerate')).toMatchObject({ status: 'success', meta: { generatedFieldCount: 11 } });
    expect(boundary.stream).toHaveBeenCalledTimes(1);
  });

  it.each([
    { response: '{"主诉":"","现病史":""}', chief: '', history: '' },
    { response: '{"主诉":"主诉","现病史":"待补充","unknown":"忽略"}', chief: '主诉', history: '待补充' },
    { response: '说明：{"fieldValues":{"主诉":"合成主诉","现病史":"合成病史', chief: '合成主诉', history: '合成病史' },
    { response: '{"主诉":"旧主诉","现病史":42,"主诉":"修订主诉"}', chief: '修订主诉', history: '42' },
    { response: '{"error":{"主诉":"诊断信息"}}', chief: '', history: '' },
  ])('uses the successful model reply for the current fields: $response', async ({ response, chief, history }) => {
    const admission: InpatientEmrGenerationRequest = {
      ...request, templateId: 'SYN-ADMISSION-RECORD', templateName: '入院记录',
      htmlContent: '<section><span data-id="主诉" data-name="主诉" data-type="text"></span>'
        + '<span data-id="现病史" data-name="现病史" data-type="text"></span></section>',
    };
    boundary.stream.mockImplementationOnce(async (_messages, onChunk) => onChunk(response));
    const progress = vi.fn();
    const result = await generateInpatientEmrPreviewStream(admission, progress);
    expect(result.fieldValues).toEqual({ 主诉: chief, 现病史: history });
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
    expect(progress).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'generate', status: 'done' }));
    expect(boundary.stream).toHaveBeenCalledTimes(1);
  });

  it('preserves decoded interrupted text without replaying the model or creating a local clinical draft', async () => {
    boundary.stream.mockImplementation(async (_messages, onChunk) => {
      onChunk('{"诊断依据文本":"\\u5408\\u6210依据\\n已收到');
      throw new Error('SYN network interrupted');
    });
    const snapshots: InpatientEmrGenerationResult[] = [];
    await expect(generateInpatientEmrPreviewStream(request, undefined, (value) => snapshots.push(value))).rejects.toThrow('生成未完成');
    expect(snapshots[snapshots.length - 1]!.fieldValues.诊断依据文本).toBe('合成依据\n已收到');
    expect(snapshots[snapshots.length - 1]!.fieldValues.病程记录文本).toBe('');
    expect(snapshots[snapshots.length - 1]!.evidenceSummary.aiGeneration.status).toBe('failed');
    expect(boundary.stream).toHaveBeenCalledTimes(1);
    expect(boundary.classify).not.toHaveBeenCalled();
  });

  it('propagates a consumer error without invoking the callback again or retrying generation', async () => {
    boundary.stream.mockImplementation(async (_messages, onChunk) => onChunk('{"主诉":"合成主诉"'));
    let calls = 0;
    const failure = new Error('SYN consumer error');
    await expect(generateInpatientEmrPreviewStream(request, undefined, () => { if (++calls === 2) throw failure; })).rejects.toBe(failure);
    expect(calls).toBe(2);
    expect(boundary.stream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['string boolean', (fields: InpatientEmrTemplateField[]) => fields.map((field) => ({ ...field, aiSuitable: 'false' }))],
    ['nonarray', () => ({ fields: [] })],
  ])('does not generate when the remote config grants no unambiguous permission (%s)', async (_name, transform) => {
    configureRemote(transform);
    await expect(generateInpatientEmrPreviewStream(request)).rejects.toThrow(/模板|字段/);
    expect(boundary.stream).not.toHaveBeenCalled();
    expect(boundary.classify).not.toHaveBeenCalled();
  });

  it.each([false, true])('retains local parsing for empty/unavailable cache (unavailable=%s)', async (unavailable) => {
    if (unavailable) boundary.resolve.mockRejectedValue(new Error('SYN unavailable'));
    else boundary.resolve.mockResolvedValue({ fields: [] });
    boundary.stream.mockImplementation(async (messages, onChunk) => {
      const prompt = messages[1].content as string;
      const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]) as Array<{ id: string }>;
      onChunk(JSON.stringify(Object.fromEntries(tasks.map(({ id }) => [id, `合成${id}正文`]))));
    });
    const result = await generateInpatientEmrPreviewStream(request);
    expect(result.fieldValues.诊断依据文本).toBe('合成诊断依据文本正文');
    expect(result.fieldValues.鉴别诊断文本).toBe('合成鉴别诊断文本正文');
    expect(result.evidenceSummary.aiGeneration.status).toBe('used');
  });

  it('does not convert classifier string false into AI authorization', async () => {
    boundary.resolve.mockResolvedValue({ fields: [] });
    boundary.classify.mockResolvedValue('[{"id":"customNarrative","aiSuitable":"false","source":"ai"}]');
    await expect(generateInpatientEmrPreviewStream({ ...request, htmlContent: '<span data-id="customNarrative" data-name="合成未知字段" data-type="text">请输入</span>' })).rejects.toThrow('没有开启 AI');
    expect(boundary.classify).toHaveBeenCalledTimes(1);
    expect(boundary.stream).not.toHaveBeenCalled();
  });

  it('uses and consumes only undecided local suggestions when the remote cache is unavailable', async () => {
    boundary.resolve.mockRejectedValue(new Error('SYN unavailable'));
    boundary.classify.mockResolvedValue('[{"id":"syn-custom","aiSuitable":true,"meaning":"合成正文","source":"ai"}]');
    boundary.stream.mockImplementation(async (_messages, onChunk) => onChunk('{"syn-chief":"合成主诉","syn-custom":"合成自定义正文"}'));
    const result = await generateInpatientEmrPreviewStream({
      ...request,
      htmlContent: '<span data-id="patientId" data-name="患者姓名" data-type="text">原值</span>'
        + '<span data-id="syn-signature" data-name="医师签名" data-type="text">原值</span>'
        + '<span data-id="syn-chief" data-name="主诉" data-type="text">请输入</span>'
        + '<span data-id="syn-custom" data-name="自定义临床字段" data-type="text">请输入</span>',
    });
    const classificationPrompt = boundary.classify.mock.calls[0][0][1].content as string;
    expect(classificationPrompt).toContain('"id": "syn-custom"');
    for (const id of ['patientId', 'syn-signature', 'syn-chief']) expect(classificationPrompt).not.toContain(`"id": "${id}"`);
    expect(boundary.classify).toHaveBeenCalledTimes(1);
    expect(result.template).not.toHaveProperty('unknownFieldIds');
    expect(JSON.stringify(result.template.fields)).not.toMatch(/presetStatus|unknownFieldIds/);
    expect(result.fieldValues['syn-custom']).toBe('合成自定义正文');
  });
});

describe('stream preview string boundaries', () => {
  it('decodes escaped keys, quotes, backslashes and unicode without consuming incomplete escapes', () => {
    expect(parsePartialJson('{"\\u0062asis":"\\u5408\\u6210\\n\\\"引号\\\"\\\\路径\\u53', ['basis']))
      .toEqual({ basis: '合成\n"引号"\\路径' });
  });
  it('ignores unrelated nested fields and uses the latest recognized field in the response', () => {
    expect(parsePartialJson('{"wrapper":{"basis":"嵌套值"},"basis":"第一稿","basis":"第二稿"}', ['basis']))
      .toEqual({ basis: '第二稿' });
    expect(parsePartialJson('说明 {"basis":"合成依据"}', ['basis'])).toEqual({ basis: '合成依据' });
  });
});
