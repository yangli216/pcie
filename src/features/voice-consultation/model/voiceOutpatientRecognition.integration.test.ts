// @vitest-environment jsdom
import { syntheticFieldPolicy, syntheticReceipt } from '@/test/template-parsing/outpatientFieldPolicyFixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatFast, chatStream } from '@/services/llm';
import * as snapshots from '@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService';
import {
  buildVoiceOutpatientEmrDraftAndDocument, getPreparedVoiceOutpatientTemplate, hashVoiceOutpatientRecognitionTemplate, matchesVoiceOutpatientRecognitionTemplate,
  prepareVoiceOutpatientRecognitionTemplate,
} from '@features/outpatient-emr/lib/voiceOutpatientEmrRecognition';
import { loadVoiceOutpatientEmrTemplateSource } from '@features/outpatient-emr/model/useVoiceOutpatientEmrTemplateSource';
import * as regional from '@/services/regionalClient';
import type { VoiceOutpatientEmrStartContext } from '@features/outpatient-emr/types';
import templateHtml from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import templateDefinition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';
import policyWire from '@/test/template-parsing/fixtures/outpatient-field-policy-wire.json';
import { useVoiceIntentRecognition, type VoiceIntentProgress } from './useVoiceIntentRecognition';

vi.mock('@/services/llm', () => ({ chat: vi.fn(), chatStream: vi.fn(), chatFast: vi.fn() }));
vi.mock('@/services/aliyunSpeech', () => ({ isTestModeEnabled: () => false }));
vi.mock('./explicitTreatmentCatalogResolver', () => ({ resolveExplicitTreatmentCatalogHints: vi.fn(async () => []) }));
vi.mock('@/services/medicalData', () => ({
  medicalDataService: { ensureDiagnosisCatalogReady: vi.fn(), getAllDiagnoses: () => [], assessDiagnosisMatch: vi.fn() },
}));

function session(): VoiceOutpatientEmrStartContext {
  return {
    visitId: 'SYN-VISIT-1',
    template: {
      templateId: 'SYN-HIS-TPL', requestId: 'SYN-REQUEST-1', templateName: '合成儿科',
      templateHtml: 'data:text/html;charset=utf-8;base64,ZmFrZQ==',
      templateDefinition: 'data:application/json;charset=utf-8;base64,ZmFrZQ==',
      targetFieldIds: ['痰声标志', '收缩压', '舒张压', '就诊时间', '页眉姓名', 'unknown-id'],
    },
  };
}

beforeEach(() => {
  vi.spyOn(regional, 'regionalPost').mockResolvedValue({
    schemaVersion: 'outpatient-emr-template-decoded.v1', templateHtml, templateDefinition,
  });
  vi.spyOn(snapshots, 'resolveOutpatientEmrTemplateSnapshot').mockImplementation(async input => ({
    ...input, schemaVersion: 'outpatient-emr-template-pair-resolution.v2', id: null, cacheHit: false, fieldPolicy: null,
    parseResult: null, receivedAt: null,
  }));
  vi.spyOn(snapshots, 'persistOutpatientEmrTemplateSnapshot').mockImplementation(async input => ({
    ...syntheticReceipt(input),
  }));
});

describe('first-pass voice recognition with a bound outpatient template', () => {
  it('uses the saved rule in the ordinary voice stream and keeps the registration note as reference only', async () => {
    vi.mocked(snapshots.resolveOutpatientEmrTemplateSnapshot).mockRestore();
    vi.mocked(regional.regionalPost).mockResolvedValue(policyWire.configured);
    const { templateHtml, templateDefinition, templateId, templateName } = policyWire.request;
    const context = { visitId: 'SYN-VOICE', template: { templateHtml, templateDefinition, templateId, templateName,
      requestId: 'SYN-VOICE-CHIEF', targetFieldIds: ['symptom', 'duration', 'manualRemark'] } };
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    expect(template?.identity.policyRevision).toBe(2);
    vi.mocked(chatStream).mockImplementation(async (messages, onChunk) => {
      expect(messages[0].content.split('持续时间由相邻栏填写。')).toHaveLength(2);
      expect(messages[1].content).toContain('HIS已登记');
      for (const event of [
        { event: 'record_core', data: { chiefComplaint: '咳嗽3天' } },
        { event: 'template_chapter', data: { chapterId: 'chief', fieldValues: { symptom: '咳嗽', duration: '3' } } },
        { event: 'template_chapter', data: { chapterId: 'notes', fieldValues: { manualRemark: '越权的模型值' } } },
        { event: 'diagnoses', data: [] }, { event: 'recommendation_plan', data: { mode: 'explicit_only', recommendNow: [] } },
        { event: 'done', data: {} },
      ]) onChunk(JSON.stringify(event) + '\n');
    });
    const result = await useVoiceIntentRecognition().processTranscript('本次主诉咳嗽3天', { outpatientTemplate: template });
    expect(result?.voiceTemplateDraft?.fieldValues).toEqual({ symptom: '咳嗽', duration: '3' });
    expect(result?.voiceTemplateDocument?.chapters.find(chapter => chapter.chapterId === 'chief')?.text).toBe('咳嗽3天');
    expect(chatStream).toHaveBeenCalledOnce();
    expect(chatFast).not.toHaveBeenCalled();
  });

  it.each([true, false])('uses the first ordinary stream for the full note and optional field values (reported=%s)', async reported => {
    const context = session();
    const templateWithPatient = templateHtml.replace('姓名：<span', 'SYN-PATIENT-NAME 姓名：<span');
    expect(templateWithPatient).toContain('SYN-PATIENT-NAME');
    vi.mocked(regional.regionalPost).mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-decoded.v1', templateHtml: templateWithPatient, templateDefinition,
    });
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, [context.visitId, 'SYN-PATIENT-NAME'], () => true);
    expect(template).toBeDefined();
    await loadVoiceOutpatientEmrTemplateSource(context);
    expect(regional.regionalPost).toHaveBeenCalledTimes(1);
    expect(snapshots.resolveOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshots.persistOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(1);
    const progress: VoiceIntentProgress[] = [];
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      const events = [
        { event: 'record_core', data: { chiefComplaint: '咳嗽2天', historyOfPresentIllness: '受凉后出现咳嗽，夜间加重。' } },
        { event: 'history_context', data: { familyHistory: '家族史已核对' } },
        { event: 'diagnoses', data: [] },
        { event: 'recommendation_plan', data: { mode: 'explicit_only', recommendNow: [], defer: [], skip: [] } },
        { event: 'record_suggestions', data: [{ field: 'historyOfPresentIllness', question: '是否胸痛？',
          negativeRecordText: '无胸痛', rationale: '合成核查依据', priority: 'critical' }] },
        { event: 'record_extra', data: { physicalExam: '咽红', ...(reported
          ? { templateFieldValues: { 痰声标志: '1', 收缩压: '120', 就诊时间: '擅自推算的时间', 页眉姓名: '擅自生成的姓名', 'unknown-id': '不可采纳', unexpected: '不可采纳' } } : {}) } },
        { event: 'done', data: { error: false } },
      ];
      for (const event of events) onChunk(JSON.stringify(event) + '\n');
    });
    const result = await useVoiceIntentRecognition().processTranscript('合成转写：受凉后咳嗽2天，夜间加重', {
      outpatientTemplate: template, onProgress: partial => progress.push(partial),
    });
    expect(chatStream).toHaveBeenCalledTimes(1);
    const [systemPrompt, userPrompt] = vi.mocked(chatStream).mock.calls[0][0].map(message => message.content);
    expect(template!.fields.map(field => field.id)).not.toContain('就诊时间');
    expect(systemPrompt).toContain('[shape:measurement] 测量值字段');
    expect(systemPrompt).toContain('outpatient-emr-field-prompt.v5');
    expect(systemPrompt).not.toContain('只能返回一个 JSON 对象');
    expect(userPrompt).not.toContain('SYN-PATIENT-NAME');
    expect(userPrompt).toContain('合成转写');
    expect(userPrompt).toContain('痰声');
    expect(userPrompt).toContain('血压：');
    expect(userPrompt).toContain('mmHg');
    expect(userPrompt).toContain('dictionaryItems');
    expect(userPrompt).not.toMatch(/<span|data-article|SYN-VISIT-1|SYN-REQUEST-1/);
    expect(chatFast).not.toHaveBeenCalled();
    expect(chat).not.toHaveBeenCalled();
    expect(result?.outpatientRecord?.historyOfPresentIllness).toContain('夜间加重');
    expect(result?.factSuggestions).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'historyOfPresentIllness' })]));
    expect(result?.voiceTemplateDraft).toEqual({
      ...template!.identity, targetFieldIds: context.template.targetFieldIds,
      fieldValues: reported ? { 痰声标志: '有', 收缩压: '120' } : {},
    });
    expect(progress.find(part => part.readySections.includes('record_core'))?.result.voiceTemplateDraft).toBeUndefined();
    expect(progress.find(part => part.readySections.includes('record_extra'))?.result.voiceTemplateDraft).toEqual(result?.voiceTemplateDraft);
    expect(matchesVoiceOutpatientRecognitionTemplate(result?.voiceTemplateDraft, context, 'different-hash')).toBe(false);
  });

  it('binds each chapter event to its own writable controls in the original stream, including without record_extra', async () => {
    const context = session();
    context.template.targetFieldIds.push('持续时间', '主诉文本');
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    const progress: VoiceIntentProgress[] = [];
    vi.mocked(chatStream).mockImplementation(async (messages, onChunk) => {
      expect(messages[0].content).toContain('"fieldValues":{"本章可写字段的原始ID"');
      const events = [
        { event: 'template_chapter', data: { chapterId: '现病史', fieldValues: { 痰声标志: '1', 持续时间: '持续时间', 收缩压: '异章值' } } },
        { event: 'template_chapter', data: { chapterId: '主诉', text: '旧模型另写的主诉。', fieldValues: { 主诉文本: '请输入主诉' } } },
        { event: 'template_chapter', data: { chapterId: '体格检查', text: '与模板填值相矛盾的自由段落。',
          fieldValues: { 收缩压: '120', 舒张压: '73', 就诊时间: '异章值', 未授权槽: '丢弃' } } },
        { event: 'template_chapter', data: { chapterId: '未知章', text: '其他资料。', fieldValues: { 痰声标志: '0' } } },
        { event: 'record_core', data: { chiefComplaint: '合成咳嗽' } }, { event: 'diagnoses', data: [] },
        { event: 'recommendation_plan', data: { mode: 'explicit_only', recommendNow: [] } }, { event: 'done', data: {} },
      ];
      for (const event of events) onChunk(JSON.stringify(event) + '\n');
    });
    const result = await useVoiceIntentRecognition().processTranscript('合成咳嗽有痰声，血压120/73mmHg', { outpatientTemplate: template, onProgress: snapshot => progress.push(snapshot) });
    expect(result?.voiceTemplateDraft?.fieldValues).toEqual({ 痰声标志: '有', 收缩压: '120', 舒张压: '73' });
    const chapterText = (document: typeof result, id: string) => document?.voiceTemplateDocument?.chapters.find(chapter => chapter.chapterId === id)?.text;
    expect(chapterText(progress[0].result, '现病史')).toContain('有痰声');
    expect(chapterText(progress[0].result, '体格检查')).toBe('');
    expect(chapterText(progress[2].result, '体格检查')).toBe('血压：120/73mmHg');
    expect(chapterText(result, '体格检查')).toBe(chapterText(progress[2].result, '体格检查'));
    expect(chapterText(result, '主诉')).toBe('');
    expect(JSON.stringify(result?.voiceTemplateDocument)).not.toContain('矛盾的自由段落');
    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    expect(chatFast).not.toHaveBeenCalled();
  });

  it('preserves explicitly empty or unmentioned leaves and drops placeholder-only legacy prose', async () => {
    const context = session();
    context.template.targetFieldIds = ['主诉文本', '持续时间', '时间单位'];
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    for (const [fieldValues, oldChief, expected] of [
      [{}, '请输入主诉', {}],
      [{}, '{主诉文本}', {}],
      [{}, '主诉文本', {}],
      [{}, '合成症状持续两日。', { 主诉文本: '合成症状持续两日。' }],
      [{ 主诉文本: null }, '旧整段正文。', { 主诉文本: null }],
      [{ 主诉文本: '' }, '旧整段正文。', { 主诉文本: '' }],
    ] as const) {
      const result = buildVoiceOutpatientEmrDraftAndDocument(template!, fieldValues, undefined,
        { 主诉: oldChief, 现病史: '旧复合章节正文。' });
      expect(result.voiceTemplateDraft.fieldValues).toEqual(expected);
      expect(result.voiceTemplateDocument.chapters.find(chapter => chapter.chapterId === '主诉')?.text)
        .toBe('主诉文本' in expected ? expected.主诉文本 || '' : '');
      expect(result.voiceTemplateDocument.chapters.find(chapter => chapter.chapterId === '现病史')?.text).toBe('');
    }
  });

  it('keeps source chapter order and scoped candidates, migrating legacy prose only to the unique full-text control', async () => {
    const context = session();
    const chapters = [
      { id: 'a', title: '家族史', field: '家族肿瘤' },
      { id: 'custom', title: '随访观察', field: '随访观察详情' },
      { id: 'b', title: '家族史', field: '家族遗传病' },
      { id: 'legacy', title: '随访安排', field: '复诊安排' },
    ];
    context.template.targetFieldIds = chapters.map(item => item.field);
    context.template.templateHtml = chapters.map(item =>
      `<section data-id="${item.id}" data-article="${item.title}" data-name="${item.title}"><span data-id="${item.field}" data-name="${item.field}" data-readonly="false" data-type="text"></span></section>`).join('');
    context.template.templateDefinition = JSON.stringify(chapters.map(item => ({
      ID: item.id, NAME: item.title, ARTICLE: item.title,
      eles: [{ ID: item.field, NAME: item.field, TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' }],
    })));
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    expect(template!.promptData.chapters.map(chapter => chapter.chapterId)).toEqual(['a', 'custom', 'b', 'legacy']);
    const progress: VoiceIntentProgress[] = [];
    const candidate = { field: 'familyHistory', question: '是否有家族肿瘤史？', negativeRecordText: '否认家族肿瘤史。', priority: 'general' };
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const data of [
        { event: 'template_chapter', data: { chapterId: 'custom', text: '计划三天后复核。' } },
        { event: 'template_chapter', data: { chapterId: 'b', text: '父亲病史待补。' } },
        { event: 'template_chapter', data: { chapterId: 'a', text: '' } },
        { event: 'template_chapter', data: { chapterId: 'outside', text: '额外章节' } },
        { event: 'record_core', data: { chiefComplaint: '用于诊疗的标准摘要' } },
        { event: 'diagnoses', data: [] },
        { event: 'recommendation_plan', data: { mode: 'explicit_only', recommendNow: [] } },
        { event: 'record_suggestions', data: ['a', 'b', 'outside'].map(chapterId => ({ ...candidate, chapterId })) },
        { event: 'record_extra', data: { templateFieldValues: { 家族肿瘤: '孤立字段', 复诊安排: '一周后复诊' } } },
        { event: 'done', data: {} },
      ]) onChunk(JSON.stringify(data) + '\n');
    });
    const result = await useVoiceIntentRecognition().processTranscript('合成语音', {
      outpatientTemplate: template, onProgress: partial => progress.push(partial),
    });
    const initial = progress[0].result.voiceTemplateDocument!;
    expect(initial.chapters.map(chapter => [chapter.chapterId, chapter.title, chapter.text])).toEqual([
      ['a', '家族史', ''], ['custom', '随访观察', '计划三天后复核。'], ['b', '家族史', ''], ['legacy', '随访安排', ''],
    ]);
    const complete = result!.voiceTemplateDocument!;
    expect(complete.chapters.map(chapter => chapter.chapterId)).toEqual(['a', 'custom', 'b', 'legacy']);
    expect(complete.chapters.map(chapter => chapter.text).slice(0, 3)).toEqual(['家族肿瘤：孤立字段', '计划三天后复核。', '']);
    expect(complete.chapters[3].text).toContain('一周后复诊');
    expect(result!.factSuggestions?.filter(item => item.chapterId).map(item => item.chapterId)).toEqual(['a', 'b']);
    expect(progress[progress.length - 1].result.voiceTemplateDocument).toEqual(complete);
    expect(result!.voiceTemplateDraft?.fieldValues).toEqual({ 家族肿瘤: '孤立字段', 复诊安排: '一周后复诊', 随访观察详情: '计划三天后复核。' });
  });

  it('sends read-only and non-target clinical source values and units as reference evidence without enabling their output', async () => {
    const context = session();
    context.template.targetFieldIds = ['followup'];
    const definitions = [
      { id: 'readonly', name: '峰流速', readonly: true, html: '215', text: 215, value: 215 },
      { id: 'observation', name: '既有观察', readonly: false, html: 'SYN-NAME 夜间咳嗽', text: 'SYN-NAME 夜间咳嗽', value: '已记录' },
      { id: 'disputed', name: '原始评分', readonly: false, html: '7', text: '6', value: 6 },
      { id: 'header', name: '患者姓名', readonly: true, html: 'PRIVATE-HEADER', text: 'PRIVATE-HEADER', value: 'PRIVATE-HEADER' },
      { id: 'hidden', name: '隐匿资料', readonly: true, html: 'PRIVATE-HIDDEN', text: 'PRIVATE-HIDDEN', value: 'PRIVATE-HIDDEN' },
      { id: 'followup', name: '随访记录', readonly: false, html: '', text: '', value: '' },
    ];
    context.template.templateHtml = '<section data-id="custom" data-article="随访观察" data-name="随访观察">'
      + definitions.map(item => `<p><span ${item.id === 'hidden' ? 'hidden' : ''} data-id="${item.id}" data-name="${item.name}" data-type="text" data-readonly="${item.readonly}"><span class="tag-value">${item.html}</span></span>${item.id === 'readonly' ? ' L/min' : ''}。</p>`).join('')
      + '</section>';
    context.template.templateDefinition = JSON.stringify([{ ID: 'custom', NAME: '随访观察', ARTICLE: '随访观察',
      eles: definitions.map(item => ({ ID: item.id, NAME: item.name, TYPE: 'text', READONLY: item.readonly, HIDDEN: item.id === 'hidden',
        VALUE: item.value, TEXT: item.text })) }]);
    const template = await prepareVoiceOutpatientRecognitionTemplate(context, ['SYN-NAME'], () => true);
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      for (const event of [
        { event: 'template_chapter', data: { chapterId: 'custom', text: '峰流速215 L/min。' } },
        { event: 'record_core', data: {} }, { event: 'diagnoses', data: [] },
        { event: 'recommendation_plan', data: { mode: 'explicit_only', recommendNow: [] } },
        { event: 'record_extra', data: { templateFieldValues: { readonly: '300', observation: '覆盖', disputed: '4', followup: '已核对。' } } },
      ]) onChunk(JSON.stringify(event) + '\n');
    });
    const result = await useVoiceIntentRecognition().processTranscript('医生核对本次随访', { outpatientTemplate: template });
    const userPrompt = vi.mocked(chatStream).mock.calls[0][0][1].content;
    expect(userPrompt).toContain('已隐去');
    expect(userPrompt).not.toMatch(/PRIVATE-HEADER|PRIVATE-HIDDEN|SYN-NAME/);
    const chapter = template!.promptData.chapters[0];
    expect(JSON.stringify(chapter.narrative)).toContain('L/min');
    expect(chapter.referenceSlots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'readonly', readonly: true, htmlText: '215', definitionValues: [{ text: 215, value: 215 }] }),
      expect.objectContaining({ id: 'observation', htmlText: '〔已隐去〕 夜间咳嗽', definitionValues: [{ text: '〔已隐去〕 夜间咳嗽', value: '已记录' }] }),
      expect.objectContaining({ id: 'disputed', htmlText: '7', definitionValues: [{ text: '6', value: 6 }] }),
    ]));
    expect(userPrompt).toContain(JSON.stringify(chapter.referenceSlots));
    expect(result!.voiceTemplateDraft?.fieldValues).toEqual({ followup: '已核对。' });
    expect(result!.voiceTemplateDocument?.chapters[0].editableFieldIds).toEqual(['followup']);
  });

  it('reuses only the original bound input and returns template data independent of the clinical result', async () => {
    const context = session();
    const request = { ...context.template, visitId: context.visitId, recordContext: {} };
    const first = await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true);
    const cached = getPreparedVoiceOutpatientTemplate(context, request);
    expect(Object.keys(cached!).sort()).toEqual(['source', 'template', 'templateHash']);
    expect(cached?.source).toEqual({ templateHtml, templateDefinition });
    expect(cached?.template.targetFields.filter(field => field.aiSuitable).map(field => field.id)).toEqual(first?.fields.map(field => field.id));
    expect(await hashVoiceOutpatientRecognitionTemplate(context)).toBe(first?.identity.templateHash);
    expect((await prepareVoiceOutpatientRecognitionTemplate(context, [], () => true))?.identity).toEqual(first?.identity);
    expect(regional.regionalPost).toHaveBeenCalledTimes(1);
    expect(snapshots.resolveOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(2);
    expect(snapshots.persistOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(2);

    expect(getPreparedVoiceOutpatientTemplate(session(), request)).toBeUndefined();
    for (const changed of [
      { visitId: 'other' }, { requestId: 'other' }, { templateId: 'other' },
      { targetFieldIds: [...request.targetFieldIds].reverse() },
      { templateHtml: templateHtml }, { templateDefinition: templateDefinition },
    ]) {
      expect(getPreparedVoiceOutpatientTemplate(context, { ...request, ...changed })).toBeUndefined();
    }
    context.template.templateHtml += 'changed';
    expect(getPreparedVoiceOutpatientTemplate(context)).toBeUndefined();
  });

  it('keeps approved historical mappings and never re-registers a hit', async () => {
    const first = session();
    await prepareVoiceOutpatientRecognitionTemplate(first, [], () => true);
    const all = getPreparedVoiceOutpatientTemplate(first)!.template.fields;
    vi.mocked(snapshots.resolveOutpatientEmrTemplateSnapshot).mockImplementationOnce(async input => ({
      ...input, schemaVersion: 'outpatient-emr-template-pair-resolution.v2', cacheHit: true, fieldPolicy: syntheticFieldPolicy(all), id: 'existing',
      receivedAt: 1, parseResult: { schemaVersion: 'outpatient-emr-template-pair.v1', fields: all.map(field => (
        field.id === '收缩压' ? { ...field, mappingSource: 'manual-override', recordField: 'physicalExam' } : field
      )) },
    }));
    const next = session();
    const hit = await prepareVoiceOutpatientRecognitionTemplate(next, [], () => true);
    expect(hit?.fields.find(field => field.id === '收缩压')?.mappingSource).toBe('manual-override');
    expect(getPreparedVoiceOutpatientTemplate(next)?.template.targetFields.filter(field => field.aiSuitable)).toEqual(hit?.fields);
    expect(snapshots.resolveOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(2);
    expect(snapshots.persistOutpatientEmrTemplateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('abandons template preparation before snapshot registration when the visit changes', async () => {
    let current = true;
    vi.mocked(snapshots.resolveOutpatientEmrTemplateSnapshot).mockImplementationOnce(async input => {
      current = false;
      return { ...input, schemaVersion: 'outpatient-emr-template-pair-resolution.v2', cacheHit: false, fieldPolicy: null, id: null,
        parseResult: null, receivedAt: null };
    });
    expect(await prepareVoiceOutpatientRecognitionTemplate(session(), [], () => current)).toBeUndefined();
    expect(snapshots.persistOutpatientEmrTemplateSnapshot).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
  });
});
