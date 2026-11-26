// @vitest-environment jsdom
// @ts-expect-error Node built-ins are available in Vitest without a direct @types/node dependency.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import sdkSource from '../../sdk/med-hermes-sdk.js?raw';
import html from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import definition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';
import { buildRecordConfirmedPayload } from '@features/clinical-result/recordConfirmedPayload';
import { buildOutpatientEmrDocument, renderVoiceOutpatientEmrChapter } from '@features/outpatient-emr/lib/outpatientEmrNarrative';
import { parseOutpatientEmrTemplate } from '@features/outpatient-emr/lib/outpatientEmrTemplate';
import { buildOutpatientEmrRecordConfirmedPayload, hashOutpatientEmrTemplate } from '@features/outpatient-emr/lib/outpatientEmrWriteback';
import { isPreparedOutpatientEmrWritebackPayload } from '@features/outpatient-emr/lib/voiceOutpatientEmr';
import type { OutpatientEmrRecordConfirmedPayload, OutpatientEmrRecordField, VoiceOutpatientEmrTemplateInput } from '@features/outpatient-emr/types';

const visitId = 'SYN-WIRE-VISIT';
const timestamp = 1780000000000;
const template: VoiceOutpatientEmrTemplateInput = {
  templateHtml: html, templateDefinition: definition, templateId: 'SYN-WIRE-TEMPLATE',
  templateName: '合成内科门诊', requestId: 'SYN-WIRE-REQUEST',
  targetFieldIds: ['主诉文本', '持续时间', '时间单位', '呕吐标志', '肝炎史标志', '结核史标志'],
};

interface TestSdk {
  startVoice(patient?: { idPi: string; idVis?: string; outpatientEmr?: VoiceOutpatientEmrTemplateInput }): Promise<unknown>;
  stop(): Promise<unknown>;
  on(type: string, callback: (data: unknown) => void): void;
  _http: { post(path: string, data: unknown): Promise<unknown> };
  _resumeEventChannelIfNeeded(): void;
  _ensureInteractionChannel(): void;
  _dispatchEnvelope(envelope: unknown): void;
}

async function dispatchToHis(
  source: VoiceOutpatientEmrTemplateInput, payload: OutpatientEmrRecordConfirmedPayload,
  repeatEntry = false,
) {
  const module = { exports: {} };
  runInNewContext(sdkSource, { module, exports: module.exports, console });
  const Sdk = module.exports as new () => TestSdk;
  const sdk = new Sdk();
  sdk._http.post = vi.fn().mockResolvedValue({ status: 'success' });
  sdk._resumeEventChannelIfNeeded = vi.fn();
  sdk._ensureInteractionChannel = vi.fn();
  const patient = { idPi: 'SYN-WIRE-PATIENT', idVis: visitId, outpatientEmr: source };
  await sdk.startVoice(patient);
  expect(sdk._http.post).toHaveBeenCalledWith('/consultation/start-voice', patient);
  if (repeatEntry) {
    await sdk.startVoice({ ...patient, outpatientEmr: { ...source, requestId: 'SYN-REPEATED-ENTRY' } });
    await sdk.startVoice();
    await sdk.startVoice({ idPi: patient.idPi });
  }

  const confirmed = vi.fn();
  const error = vi.fn();
  sdk.on('record-confirmed', confirmed);
  sdk.on('error', error);
  const envelope = JSON.parse(JSON.stringify({
    state: 'ready',
    event: {
      id: [visitId, source.requestId, payload.resultType, timestamp].join(':'),
      type: payload.resultType, consultationId: visitId, requestId: source.requestId,
      timestamp, terminal: false, payload,
    },
  }));
  sdk._dispatchEnvelope(envelope);
  expect(error.mock.calls).toEqual([]);
  expect(confirmed.mock.calls).toEqual([[payload]]);
  if (repeatEntry) {
    await sdk.startVoice(patient);
    sdk._dispatchEnvelope(envelope);
    expect(confirmed.mock.calls).toEqual([[payload]]);
    expect(error.mock.calls).toEqual([]);
  }
  return { sdk, confirmed, error };
}

type ReviewedRecord = Partial<Record<OutpatientEmrRecordField, string>>;

async function buildVoicePayload(
  source: VoiceOutpatientEmrTemplateInput, values: Record<string, string>,
  reviewed: ReviewedRecord, documentDirectText: Record<string, string>,
) {
  const parsed = parseOutpatientEmrTemplate(source.templateHtml, source.templateDefinition, source.targetFieldIds);
  const base = buildRecordConfirmedPayload({
    consultationId: visitId, requestId: source.requestId, timestamp,
    chiefComplaint: reviewed.chiefComplaint ?? '', historyOfPresentIllness: reviewed.historyOfPresentIllness ?? '',
    pastMedicalHistory: reviewed.pastMedicalHistory ?? '', outpatientRecord: reviewed,
    writebackScope: { recordFields: Object.keys(reviewed) as OutpatientEmrRecordField[], includeDiagnosis: false, orderTypes: [] },
    diagList: [], orderList: [], extra: { referenceType: 'batch', action: 'batch', referenceStatus: 'pending' },
  });
  if (!isPreparedOutpatientEmrWritebackPayload(base, visitId, source.requestId)) throw Error('Invalid base voice result');
  return buildOutpatientEmrRecordConfirmedPayload({
    request: { ...source, visitId, recordContext: {} },
    templateHash: await hashOutpatientEmrTemplate(source.templateHtml, source.templateDefinition),
    fields: parsed.targetFields, templateFieldIds: parsed.fields.map(field => field.id),
    fieldValues: values, reviewedRecord: reviewed, voiceRecordValues: reviewed,
    documentDirectText, baseWritebackPayload: base, timestamp,
  });
}

describe('voice template writeback delivered through the distributed HIS SDK', () => {
  it('delivers the original request once after repeated entry changes or omits the template', async () => {
    const source = { ...template, targetFieldIds: ['主诉文本'] };
    const values = { 主诉文本: '重复入口前医生确认的合成病历' };
    const payload = await buildVoicePayload(source, values, { chiefComplaint: values.主诉文本 }, values);
    await dispatchToHis(source, payload, true);
  });

  it.each(['stop', 'cancel', 'new-visit'] as const)('accepts a new binding after %s', async (ending) => {
    const source = { ...template, targetFieldIds: ['主诉文本'] };
    const values = { 主诉文本: '原就诊合成主诉' };
    const payload = await buildVoicePayload(source, values, { chiefComplaint: values.主诉文本 }, values);
    const { sdk, confirmed, error } = await dispatchToHis(source, payload);
    if (ending === 'stop') await sdk.stop();
    if (ending === 'cancel') sdk._dispatchEnvelope({
      event: { id: 'SYN-CANCELLED', consultationId: visitId, type: 'cancelled', payload: { resultType: 'cancelled' } },
    });
    const nextVisit = ending === 'new-visit' ? 'SYN-NEXT-VISIT' : visitId;
    const nextSource = { ...source, requestId: 'SYN-NEXT-REQUEST', templateName: '合成新模板' };
    await sdk.startVoice({ idPi: 'SYN-WIRE-PATIENT', idVis: nextVisit, outpatientEmr: nextSource });
    const nextPayload = await buildVoicePayload(nextSource, values, { chiefComplaint: values.主诉文本 }, values);
    nextPayload.consultationId = nextVisit;
    nextPayload.visitId = nextVisit;
    sdk._dispatchEnvelope({ event: {
      id: 'SYN-NEXT-RESULT', consultationId: nextVisit, type: 'record-confirmed', payload: nextPayload,
    } });
    expect(error.mock.calls).toEqual([]);
    expect(confirmed.mock.calls).toEqual([[payload], [nextPayload]]);
  });

  it('delivers a single direct field with the text confirmed by the doctor', async () => {
    const source = { ...template, targetFieldIds: ['主诉文本'] };
    const values = { 主诉文本: '反复干咳三天。' };
    const payload = await buildVoicePayload(source, values, { chiefComplaint: values.主诉文本 }, values);
    expect(payload.fieldValues).toEqual(values);
    expect(payload.emrFieldValues).toMatchObject(values);
    await dispatchToHis(source, payload);
  });

  it('fills chief complaint and two composite sections while omitting unfilled and unauthorized slots', async () => {
    const values = {
      主诉文本: '咳嗽两天', 持续时间: '2', 时间单位: '3', 肝炎史标志: '0',
      呕吐标志: '', 结核史标志: '', 高血压病史标志: '1',
    };
    const parsed = parseOutpatientEmrTemplate(html, definition, template.targetFieldIds);
    const chapters = buildOutpatientEmrDocument(parsed, false, definition);
    function sectionText(id: string) {
      const section = chapters.find(chapter => chapter.id === id)!;
      return renderVoiceOutpatientEmrChapter(section, values);
    }
    const reviewed = {
      chiefComplaint: sectionText('主诉'), historyOfPresentIllness: sectionText('现病史'), pastMedicalHistory: sectionText('既往史'),
    };
    expect(reviewed.chiefComplaint).toContain(values.主诉文本);
    expect(reviewed.historyOfPresentIllness).toContain('2天');
    expect(reviewed.pastMedicalHistory).toContain('无乙肝');
    const payload = await buildVoicePayload(template, values, reviewed, { 主诉文本: values.主诉文本 });
    expect(payload.fieldValues).toEqual({ 主诉文本: values.主诉文本, 持续时间: '2', 时间单位: '天', 肝炎史标志: '无' });
    expect(payload.emrFieldValues).toMatchObject({ 主诉文本: values.主诉文本, 持续时间: '2', 时间单位: '3', 肝炎史标志: '0' });
    expect(payload.dictionarySelections).toEqual({ 时间单位: { value: '3', text: '天' }, 肝炎史标志: { value: '0', text: '无' } });
    expect(payload.templateMetadata.fields.map(field => field.id).sort()).toEqual(Object.keys(payload.fieldValues).sort());
    expect(payload.writebackScope.recordFields).toEqual(['chiefComplaint', 'historyOfPresentIllness', 'pastMedicalHistory']);
    expect(payload.outpatientRecord).toMatchObject({
      chiefComplaint: values.主诉文本, historyOfPresentIllness: '持续时间：2；时间单位：天', pastMedicalHistory: '肝炎史：无',
    });
    expect(payload.historyOfPresentIllness).toBe(reviewed.historyOfPresentIllness);
    expect(payload.pastMedicalHistory).toBe(reviewed.pastMedicalHistory);
    for (const id of ['呕吐标志', '结核史标志', '高血压病史标志']) expect(payload.emrFieldValues).not.toHaveProperty(id);
    await dispatchToHis(template, payload);
  });

  it('leaves the input hint in the source template when no chief complaint was confirmed', async () => {
    expect(html).toContain('请输入主诉');
    const parsed = parseOutpatientEmrTemplate(html, definition, template.targetFieldIds);
    const chapters = buildOutpatientEmrDocument(parsed, false, definition);
    const chief = chapters.find(chapter => chapter.id === '主诉')!;
    expect(renderVoiceOutpatientEmrChapter(chief, {})).toBe('');
    expect(renderVoiceOutpatientEmrChapter(chief, { 主诉文本: '请输入主诉' })).toBe('');
    const history = chapters.find(chapter => chapter.id === '现病史')!;
    const values = { 持续时间: '2', 主诉文本: '' };
    const historyText = renderVoiceOutpatientEmrChapter(history, values);
    const payload = await buildVoicePayload(template, values, { historyOfPresentIllness: historyText }, {});
    expect(payload.fieldValues).toEqual({ 持续时间: '2' });
    expect(payload.emrFieldValues).not.toHaveProperty('主诉文本');
    expect(JSON.stringify(payload)).not.toContain('请输入主诉');
    await dispatchToHis(template, payload);
  });

  it('delivers distinct HIS field IDs when two source chapters describe the same history', async () => {
    const chapters = [
      { id: 'SYN-INITIAL', title: '首次症状', field: '初诊描述', value: '初诊时干咳。' },
      { id: 'SYN-FOLLOWUP', title: '复诊变化', field: '复诊描述', value: '复诊时已无干咳。' },
    ];
    const source = {
      ...template,
      templateHtml: chapters.map(({ id, title, field }) =>
        `<p data-id="${id}" data-name="${title}" data-article="现病史"><span data-id="${field}" data-name="${field}" data-type="text" data-readonly="false"></span></p>`,
      ).join(''),
      templateDefinition: JSON.stringify(chapters.map(({ id, title, field }) => ({
        ID: id, NAME: title, ARTICLE: '现病史', eles: [{ ID: field, NAME: field, TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' }],
      }))),
      targetFieldIds: chapters.map(chapter => chapter.field),
    };
    const values = Object.fromEntries(chapters.map(chapter => [chapter.field, chapter.value]));
    const reviewed = { historyOfPresentIllness: chapters.map(chapter => chapter.value).join('\n') };
    const payload = await buildVoicePayload(source, values, reviewed, {});
    expect(payload.fieldValues).toEqual(values);
    expect(payload.emrFieldValues).toMatchObject(values);
    expect(payload.templateMetadata.fields.map(field => [field.articleTemplateId, field.id])).toEqual(
      chapters.map(chapter => [chapter.id, chapter.field]),
    );
    await dispatchToHis(source, payload);
  });
});
