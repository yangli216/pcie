// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import html from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import definition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';
import { parseOutpatientEmrTemplate } from './outpatientEmrTemplate';
import { parseOutpatientEmrNarrative } from './outpatientEmrNarrative';
import { patchVoiceRecordFieldEdit } from './voiceOutpatientEmrFieldEdit';

const template = parseOutpatientEmrTemplate(html, definition, [
  '主诉文本', '持续时间', '时间单位', '痰声标志', '呕吐标志', '收缩压', '舒张压', '体温',
]);
const [chief, history, exam] = parseOutpatientEmrNarrative(template.sanitizedHtml, template.targetFields);
const values = { 主诉文本: '咳嗽两天。', 持续时间: '2', 时间单位: '3', 痰声标志: '1', 呕吐标志: '0', 收缩压: '118', 舒张压: '76', 体温: '37.4' };

describe('reviewing a template leaf in the main voice record', () => {
  it.each([
    ['复诊。血压118/76mmHg。曾有收缩压118。', '复诊。血压122/76mmHg。曾有收缩压118。'],
    ['T:{37.4}℃ Bp:{118}/{76}mmHg。', 'T:{37.4}℃ Bp:{122}/{76}mmHg。'],
    ['初测118/75mmHg，后测118/76mmHg。', '初测118/75mmHg，后测122/76mmHg。'],
  ])('patches just the localized systolic value in %s', (before, after) => {
    expect(patchVoiceRecordFieldEdit(before, exam, values, '收缩压', '122')).toBe(after);
  });

  it('uses dictionary labels and preserves punctuation, annotations and the surrounding voice wording', () => {
    const record = '2天前受凉后出现咳嗽，有痰声，无呕吐；留观。';
    expect(patchVoiceRecordFieldEdit(record, history, values, '时间单位', '4')).toBe(record.replace('2天', '2周'));
    expect(patchVoiceRecordFieldEdit(record, history, values, '呕吐标志', '有')).toBe(record.replace('无呕吐', '有呕吐'));
  });

  it.each([
    ['初测118/76mmHg，复测118/76mmHg。', exam, '收缩压'],
    ['血压1118/76mmHg。', exam, '收缩压'],
    ['血压118/76.5mmHg。', exam, '收缩压'],
    ['脉搏118次/分，血压尚未取得。', exam, '收缩压'],
    ['2天前出现，复诊记为2天前。', history, '时间单位'],
    ['12天前开始。', history, '持续时间'],
    ['没有痰声。', history, '痰声标志'],
    ['体温37x4℃。', exam, '体温'],
  ] as const)('leaves ambiguous, negated or unrelated text alone in %s', (record, chapter, id) => {
    expect(patchVoiceRecordFieldEdit(record, chapter, values, id, '9')).toBe(record);
  });

  it('rejects competing leaf identities with the same anchor and accepts disambiguating template wording', () => {
    const [pressure] = exam.fields.filter(field => field.id === '收缩压');
    const first = { ...pressure, id: 'initial' };
    const second = { ...pressure, id: 'repeat' };
    const section = { ...exam, fields: [first, second], clauses: [first, second].map((field, i) => ({
      parts: [{ kind: 'text' as const, text: i ? '复测' : '初测' }, { kind: 'field' as const, field }, { kind: 'text' as const, text: 'mmHg' }],
      separator: '；',
    })) };
    const same = { initial: '118', repeat: '118' };
    expect(patchVoiceRecordFieldEdit('复测118mmHg。', section, same, 'initial', '120')).toBe('复测118mmHg。');
    expect(patchVoiceRecordFieldEdit('初测118mmHg；复测118mmHg。', section, same, 'repeat', '120')).toBe('初测118mmHg；复测120mmHg。');
    expect(patchVoiceRecordFieldEdit('复测118mmHg。', section, { initial: '118', repeat: '99' }, 'initial', '120')).toBe('复测118mmHg。');
  });

  it('requires the specific measurement label if the second blood pressure value was missing', () => {
    const partial = { 舒张压: '76' };
    const unrelated = '收缩压：76mmHg。';
    expect(patchVoiceRecordFieldEdit(unrelated, exam, partial, '舒张压', '80')).toBe(unrelated);
    expect(patchVoiceRecordFieldEdit('舒张压：76mmHg。', exam, partial, '舒张压', '80')).toBe('舒张压：80mmHg。');
  });

  it('uses the bound source phrase regardless of its standard mapping', () => {
    const record = '医生补充，血压118/76mmHg。';
    expect(patchVoiceRecordFieldEdit(record, { ...exam, recordField: null }, values, '收缩压', '122')).toBe('医生补充，血压122/76mmHg。');
    expect(patchVoiceRecordFieldEdit(record, { ...exam, fallback: true }, values, '收缩压', '122')).toBe(record);
    expect(patchVoiceRecordFieldEdit(record, exam, {}, '收缩压', '122')).toBe(record);
    expect(patchVoiceRecordFieldEdit(record, exam, values, '不存在', '122')).toBe(record);
    expect(patchVoiceRecordFieldEdit(record, exam, values, '体温', '')).toBe(record);
    expect(patchVoiceRecordFieldEdit(values.主诉文本, chief, values, '主诉文本', '咳嗽三天。')).toBe('咳嗽三天。');
  });
});
