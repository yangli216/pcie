import { describe, expect, it } from 'vitest';
import {
  buildClinicalResultRegenerationRequest,
  normalizeClinicalResultRegenerationOutput,
  type ClinicalResultRegenerationRecord,
} from './clinicalResultRegeneration';

const currentRecord: ClinicalResultRegenerationRecord = {
  chiefComplaint: '咳嗽3天',
  historyOfPresentIllness: '3天前出现咳嗽，无发热。',
  pastMedicalHistory: '否认高血压病史。',
  personalHistory: '无特殊。',
  menstrualHistory: '周期28天，经期5天。',
  maritalReproductiveHistory: '已婚已育；未孕。',
  familyHistory: '无特殊。',
  physicalExam: '咽部稍红。',
  precautions: '病情加重及时复诊。',
};

describe('clinical result regeneration', () => {
  it('builds a traceable rewrite request from the current record and doctor supplement', () => {
    const spec = buildClinicalResultRegenerationRequest({
      channel: 'symptom',
      patient: { name: '患者甲', gender: '女', age: '38岁' },
      currentRecord,
      doctorSupplement: '  患者补充昨晚发热，最高38.6℃。  ',
      consultationId: 'consultation-1',
    });

    expect(spec.messages[0]?.content).toContain('医生补充信息的事实优先级高于当前草稿');
    expect(spec.messages[1]?.content).toContain('患者补充昨晚发热，最高38.6℃。');
    expect(spec.messages[1]?.content).toContain('咳嗽3天');
    expect(spec.messages[0]?.content).toContain('不得编造');
    expect(spec.messages[1]?.content).toContain('月经史仅适用于女性且14≤周岁年龄<60的患者');
    expect(spec.config.traceContext).toMatchObject({
      scene: 'clinical-result-regeneration',
      sourceModule: 'symptom_consultation_result',
      operationAction: 'regenerate_with_supplement',
      consultationId: 'consultation-1',
    });
  });

  it('rejects an empty doctor supplement before sending a request', () => {
    expect(() => buildClinicalResultRegenerationRequest({
      channel: 'voice',
      patient: {},
      currentRecord,
      doctorSupplement: '   ',
    })).toThrow('请先填写或录入补充信息');
  });

  it('keeps an unmentioned template default distinguishable from patient evidence during a rewrite', () => {
    const templateFields = [{ id: '胃纳', value: '如常', source: 'unmentioned-default' }];
    const { messages } = buildClinicalResultRegenerationRequest({
      channel: 'voice', patient: {}, currentRecord, templateFields, doctorSupplement: '患者补充近两日食量减少。',
    });
    expect(messages[0].content).toContain('source=unmentioned-default');
    expect(messages[1].content).toContain('"source": "unmentioned-default"');
    expect(messages[1].content).toContain('患者补充近两日食量减少。');
  });

  it('keeps unaffected fallback fields when the model omits optional fields', () => {
    const normalized = normalizeClinicalResultRegenerationOutput({
      chiefComplaint: '咳嗽伴发热3天',
      historyOfPresentIllness: '3天前出现咳嗽，昨晚发热，最高38.6℃。',
      physicalExam: '咽部充血。',
    }, currentRecord);

    expect(normalized).toEqual({
      ...currentRecord,
      chiefComplaint: '咳嗽伴发热3天',
      historyOfPresentIllness: '3天前出现咳嗽，昨晚发热，最高38.6℃。',
      physicalExam: '咽部充血。',
    });
  });

  it('cleans workflow prompts and repeated sentences from regenerated fields', () => {
    const normalized = normalizeClinicalResultRegenerationOutput({
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者咳嗽3天，其他情况待医生补充完善。否认发热。否认发热。',
      pastMedicalHistory: '待医生核实。',
    }, currentRecord);

    expect(normalized.historyOfPresentIllness).toBe('患者咳嗽3天。否认发热。');
    expect(normalized.pastMedicalHistory).toBe(currentRecord.pastMedicalHistory);
  });

  const templateChapters = [
    { chapterId: 'c1', title: '合成观察', text: '原观察', recordField: 'physicalExam' as const,
      fieldIds: ['f1', 'f2', 'read-only'], editableFieldIds: ['f1', 'f2'], narrative: [{ title: '合成观察句式' }] },
    { chapterId: 'c2', title: '合成观察', text: '另一观察', recordField: null, fieldIds: ['f3'], editableFieldIds: ['f3'] },
  ];

  it('sends the exact chapter identities, current narrative and dictionary with the supplement', () => {
    const { messages } = buildClinicalResultRegenerationRequest({
      channel: 'voice', patient: { name: '合成姓名', age: '30岁' }, currentRecord, templateChapters,
      templateFields: [{ id: 'f1', value: '', source: 'doctor', dictionaryItems: [{ value: 'Y', text: '有' }] }],
      doctorSupplement: '补充观察信息',
    });
    const input = JSON.parse(messages[1].content.split('输入数据如下：\n\n')[1]);
    expect(input.templateChapters).toEqual(templateChapters);
    expect(input.templateFields[0].dictionaryItems[0]).toEqual({ value: 'Y', text: '有' });
    expect(input.patient).toEqual({ age: '30岁' });
    expect(messages[0].content).toContain('chapterTexts');
    expect(messages[0].content).toContain('templateFieldValues');
  });

  it('updates only changed source chapters and their writable leaves, preserving explicit clears', () => {
    const output = normalizeClinicalResultRegenerationOutput({
      chapterTexts: { c1: '新观察', c2: '另一观察', forged: '外来章' },
      templateFieldValues: { f1: 'Y', f2: null, f3: '非改写章', 'read-only': '不可采纳', other: '不可采纳' },
    }, currentRecord, templateChapters);
    expect(output.chapterTexts).toEqual({ c1: '新观察' });
    expect(output.templateFieldValues).toEqual({ f1: 'Y', f2: null });
    expect(normalizeClinicalResultRegenerationOutput({ chapterTexts: { c2: '' } }, currentRecord, templateChapters).chapterTexts)
      .toEqual({ c2: '' });
    expect(normalizeClinicalResultRegenerationOutput({
      chapterTexts: { c2: '自定义段也能生成' },
    }, { ...currentRecord, chiefComplaint: '', historyOfPresentIllness: '' }, templateChapters).chapterTexts)
      .toEqual({ c2: '自定义段也能生成' });
  });

  it('accepts an older response only for an expressly returned standard field with one corresponding chapter', () => {
    expect(normalizeClinicalResultRegenerationOutput({ physicalExam: '新查体' }, currentRecord, templateChapters).chapterTexts)
      .toEqual({ c1: '新查体' });
    const sameMapping = templateChapters.map(chapter => ({ ...chapter, recordField: 'physicalExam' as const }));
    expect(() => normalizeClinicalResultRegenerationOutput({ physicalExam: '歧义章' }, currentRecord, sameMapping))
      .toThrow('缺少当前模板的章节正文');
    expect(() => normalizeClinicalResultRegenerationOutput({ chapterTexts: { forged: '外部章' }, physicalExam: '兼容文本' }, currentRecord, templateChapters))
      .toThrow('缺少当前模板的章节正文');
    expect(() => normalizeClinicalResultRegenerationOutput({ historyOfPresentIllness: '没有对应源章' }, currentRecord, templateChapters))
      .toThrow('缺少当前模板的章节正文');
  });

  it('rejects malformed output instead of replacing the working result', () => {
    expect(() => normalizeClinicalResultRegenerationOutput([], currentRecord))
      .toThrow('重新生成的病例不是有效 JSON 对象');
  });
});
