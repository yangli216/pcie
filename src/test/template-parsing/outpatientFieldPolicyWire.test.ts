// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeOutpatientEmrFields } from '@features/outpatient-emr/api/outpatientEmrService';
import { buildOutpatientEmrDocument, renderVoiceOutpatientEmrChapter } from '@features/outpatient-emr/lib/outpatientEmrNarrative';
import { useOutpatientEmrAnalysis } from '@features/outpatient-emr/model/useOutpatientEmrAnalysis';
import type { OutpatientEmrAnalysisRequest } from '@features/outpatient-emr/types';
import { deliverToOutpatientSdk } from './outpatientSdkHarness';
import { syntheticReceipt } from './outpatientFieldPolicyFixture';
// Serialized by OutpatientEmrTemplateSnapshotServiceTest, including the effective policy after admin edits.
import wire from './fixtures/outpatient-field-policy-wire.json';

const boundary = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.post }));
const resolvePath = '/v1/client/outpatient-emr/templates/snapshots/resolve';
const registerPath = '/v1/client/outpatient-emr/templates/snapshots';

function visit(): OutpatientEmrAnalysisRequest {
  const { templateHtml, templateDefinition, templateId, templateName } = wire.request;
  return { templateId, templateName, templateHtml, templateDefinition, targetFieldIds: ['symptom', 'duration', 'manualRemark'],
    visitId: 'SYN-VISIT', requestId: 'SYN-CHIEF-REQUEST', recordContext: { recordText: '本次主诉咳嗽3天' } };
}

function setup() {
  const model = vi.fn().mockResolvedValue(JSON.stringify({ symptom: '咳嗽', duration: '3', manualRemark: '模型越权返回' }));
  const completed = vi.fn().mockResolvedValue(undefined);
  const analysis = useOutpatientEmrAnalysis({
    analyzeFields: input => analyzeOutpatientEmrFields(input, { chatFast: model }),
    completeConsultation: completed,
  });
  return { model, analysis, completed };
}

beforeEach(() => { boundary.post.mockReset(); });

describe('saved outpatient field rules on the device wire', () => {
  it.each([
    { label: '全文', fields: [{ id: 'chiefComplaint', name: '主诉', value: '咳嗽3天' }] },
    { label: '双文本', fields: [{ id: 'symptom', name: '症状名称', value: '咳嗽' }, { id: 'duration', name: '持续时间', value: '3天' }] },
  ])('renders the same source in the $label template and delivers the individual values to the SDK', async ({ label, fields }) => {
    const request = { ...visit(), templateId: 'SYN-' + label, targetFieldIds: fields.map(f => f.id),
      templateHtml: '<section data-id="chief" data-article="主诉" data-name="主诉"><p>' + fields.map(f =>
        '<span data-id="' + f.id + '" data-type="text" data-name="' + f.name + '" data-readonly="false"></span>').join('') + '</p></section>',
      templateDefinition: JSON.stringify([{ ID: 'chief', NAME: '主诉', ARTICLE: '主诉', eles: fields.map(f =>
        ({ ID: f.id, NAME: f.name, TYPE: 'text', READONLY: false, TEXT: '', VALUE: '' })) }]) };
    const values = Object.fromEntries(fields.map(f => [f.id, f.value]));
    const model = vi.fn().mockResolvedValue(JSON.stringify(values));
    const analysis = useOutpatientEmrAnalysis({
      resolveTemplateSnapshot: async input => ({ ...input, schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
        cacheHit: false, parseResult: null, receivedAt: null, id: null, fieldPolicy: null }),
      persistTemplateSnapshot: async input => syntheticReceipt(input),
      analyzeFields: input => analyzeOutpatientEmrFields(input, { chatFast: model }),
    });
    await expect(analysis.start(request)).resolves.toBe(true);
    expect(model.mock.calls[0][0][1].content).toContain('本次主诉咳嗽3天');
    expect(analysis.fieldValues.value).toEqual(values);
    expect(renderVoiceOutpatientEmrChapter(buildOutpatientEmrDocument(analysis.template.value!)[0], values)).toBe('咳嗽3天');
    const result = analysis.buildConfirmedPayload()!;
    await expect(deliverToOutpatientSdk(request, result)).resolves.toMatchObject({ fieldValues: values });
  });

  it.each([true, false])('uses the effective rules, renders the fixed unit and completes one SDK writeback (hit=%s)', async hit => {
    boundary.post.mockImplementation((path, request) => {
      expect(request.templateHash).toBe(wire.configured.templateHash);
      if (path === resolvePath) return hit ? wire.configured : wire.miss;
      expect(path).toBe(registerPath);
      expect(request).not.toHaveProperty('fieldPolicy');
      return wire.deduplicated;
    });
    const { model, analysis, completed } = setup();
    const request = visit();
    const ok = await analysis.start(request);
    expect(analysis.analysisErrorMessage.value).toBe('');
    expect(ok).toBe(true);
    expect(analysis.template.value?.fieldPolicy?.revision).toBe(2);
    expect(boundary.post.mock.calls.map(([path]) => path)).toEqual(hit ? [resolvePath] : [resolvePath, registerPath]);
    if (!hit) expect(boundary.post.mock.calls[1][1].parseResult.fields).toEqual(wire.request.parseResult.fields);
    const [system, data] = model.mock.calls[0][0];
    expect(system.content.split('持续时间由相邻栏填写。')).toHaveLength(2);
    expect(system.content).not.toContain('HIS已登记');
    const sent = JSON.parse(data.content.slice(data.content.indexOf('\n') + 1));
    expect(sent.template.fields.map((f: { id: string }) => f.id)).toEqual(['symptom', 'duration']);
    expect(data.content).toContain('HIS已登记');
    expect(analysis.fieldValues.value).toEqual({ symptom: '咳嗽', duration: '3', manualRemark: 'HIS已登记' });
    expect(analysis.resultSummary.value).toBe('AI 已填 2/2 个字段');
    const chapter = buildOutpatientEmrDocument(analysis.template.value!)[0];
    expect(renderVoiceOutpatientEmrChapter(chapter, analysis.fieldValues.value)).toBe('咳嗽3天');
    const result = analysis.buildConfirmedPayload()!;
    expect(result.outpatientRecord?.chiefComplaint).toBe('症状名称：咳嗽；持续时间：3');
    await expect(analysis.writeBack()).resolves.toBe(true);
    expect(completed).toHaveBeenCalledOnce();
    await expect(deliverToOutpatientSdk(request, result)).resolves.toEqual(result);
  });

  it('accepts a previous server rule-library version and still transmits its saved field rules', async () => {
    const previous = { ...wire.configured, fieldPolicy: { ...wire.configured.fieldPolicy, ruleSetVersion: 'outpatient-emr-field-prompt.v5' } };
    boundary.post.mockResolvedValue(previous);
    const { model, analysis } = setup();
    await expect(analysis.start(visit())).resolves.toBe(true);
    expect(model.mock.calls[0][0][0].content).toContain('持续时间由相邻栏填写。');
    expect(analysis.fieldValues.value.duration).toBe('3');
  });

  it('re-reads the revision on retry and keeps the doctor edit when the version is disabled', async () => {
    boundary.post.mockResolvedValueOnce(wire.configured).mockResolvedValueOnce(wire.disabled);
    const { model, analysis } = setup();
    await expect(analysis.start(visit())).resolves.toBe(true);
    analysis.updateFieldValue('symptom', '医生核对的咳嗽');
    await expect(analysis.retry()).resolves.toBe(true);
    expect(model).toHaveBeenCalledOnce();
    expect(analysis.resultSummary.value).toBe('本次无 AI 生成字段');
    expect(analysis.fieldValues.value).toEqual({ symptom: '医生核对的咳嗽', duration: '', manualRemark: 'HIS已登记' });
  });

  it('isolates a duplicate policy field, preserves the other targets and counts only the received text', async () => {
    const response = JSON.parse(JSON.stringify(wire.configured));
    response.fieldPolicy.fields.push(response.fieldPolicy.fields[1]);
    boundary.post.mockResolvedValue(response);
    const { analysis } = setup();
    await expect(analysis.start(visit())).resolves.toBe(true);
    expect(analysis.targetFields.value.map(f => f.id)).toEqual(['symptom', 'duration', 'manualRemark']);
    expect(analysis.fieldValues.value.duration).toBe('');
    expect(analysis.generatedCount.value).toBe(1);
    expect(analysis.aiTargetCount.value).toBe(1);
    expect(analysis.resultSummary.value).toContain('1 个字段规则待核对');
  });

  it('shows pending and partial results without counting the HIS value', async () => {
    boundary.post.mockResolvedValue(wire.configured);
    const { model, analysis } = setup();
    model.mockResolvedValueOnce('{}').mockResolvedValueOnce('{"symptom":"咳嗽"}');
    await expect(analysis.start(visit())).resolves.toBe(true);
    expect(analysis.resultSummary.value).toContain('待补充');
    await expect(analysis.retry()).resolves.toBe(true);
    expect(analysis.resultSummary.value).toBe('AI 已填 1/2 个字段');
    expect(analysis.fieldValues.value.manualRemark).toBe('HIS已登记');
  });
});
