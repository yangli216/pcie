import { describe, expect, it } from 'vitest';
import {
  collectHistoryRecordTemplateChanges,
  collectHistoryRecordTemplateSlotValues,
  DEFAULT_PERSONAL_HISTORY_TEMPLATE,
  getDefaultHistoryRecordTemplate,
  resolveHistoryRecordTemplate,
} from './historyRecordTemplates';
import { buildRecordConfirmedPayload } from './recordConfirmedPayload';

function habitValues(personalHistory: string) {
  return Object.fromEntries(collectHistoryRecordTemplateSlotValues({ personalHistory })
    .filter(item => item.slotKey === 'smokingHistory' || item.slotKey === 'drinkingHistory')
    .map(item => [item.slotKey, item.value]));
}

describe('personal history local habit polarity and final confirmed text', () => {
  it.each([
    ['不吸烟，不饮酒。平时口味偏咸，运动较少。', '否认', '否认'],
    ['从未吸烟；未饮酒。', '否认', '否认'],
    ['没有吸烟史，无饮酒史。', '否认', '否认'],
    ['未有吸烟史；否认有饮酒史。', '否认', '否认'],
    ['吸烟史：否认；饮酒史：无。', '否认', '否认'],
    ['否认吸烟、饮酒史。', '否认', '否认'],
    ['否认吸烟但有饮酒史10年。', '否认', '有'],
    ['有吸烟史，但否认饮酒。', '有', '否认'],
    ['不常吸烟；偶尔饮酒。', '有', '有'],
    ['既往吸烟20年，已戒烟5年；饮酒10年。', '有', '有'],
    ['烟龄20年；酒龄10年。', '有', '有'],
  ])('projects each explicit habit independently: %s', (text, smokingHistory, drinkingHistory) => {
    expect(habitValues(text)).toEqual({ smokingHistory, drinkingHistory });
    expect(resolveHistoryRecordTemplate('personalHistory', text, text)).toBe(text);
  });

  it.each([
    '吸烟史不详，饮酒史未询问。',
    '吸烟史不明，饮酒史未问。',
    '吸烟、饮酒史不详。',
    '未询问是否吸烟；有无饮酒史待核实。',
    '不是不吸烟；不能排除饮酒史。',
    '吸烟史；饮酒史。',
    '口味偏咸，运动较少。',
    '',
  ])('does not invent flags from missing, uncertain or ambiguous text: %s', text => {
    expect(habitValues(text)).toEqual({});
  });

  it('does not let a smoking qualifier erase a definite drinking history', () => {
    expect(habitValues('吸烟史不详，饮酒10年。')).toEqual({ drinkingHistory: '有' });
    expect(habitValues('不吸烟，饮酒情况不详。')).toEqual({ smokingHistory: '否认' });
  });

  it.each([
    ['本人从不吸烟，父亲吸烟。', { smokingHistory: '否认' }],
    ['父亲吸烟，本人从不吸烟。', { smokingHistory: '否认' }],
    ['本人每日吸烟5支，父亲从不吸烟。', { smokingHistory: '有' }],
    ['父亲吸烟。', {}],
    ['父亲本人吸烟。', {}],
    ['父亲不吸烟，饮酒10年。', {}],
    ['父亲饮酒，本人不饮酒。', { drinkingHistory: '否认' }],
    ['本人偶尔饮酒，母亲不饮酒。', { drinkingHistory: '有' }],
    ['父亲吸烟而本人不吸烟，患者偶尔饮酒。', { smokingHistory: '否认', drinkingHistory: '有' }],
    ['本人不吸烟而父亲吸烟，患者不饮酒。', { smokingHistory: '否认', drinkingHistory: '否认' }],
    ['父亲说患者不吸烟，家属诉本人偶尔饮酒。', { smokingHistory: '否认', drinkingHistory: '有' }],
    ['本人和父亲均吸烟，母亲不饮酒。', { smokingHistory: '有' }],
    ['父亲与患者均不饮酒。', { drinkingHistory: '否认' }],
    ['长期被动吸烟。', {}],
    ['本人不吸烟，长期被动吸烟。', { smokingHistory: '否认' }],
    ['长期被动吸烟，本人仍每日吸烟5支。', { smokingHistory: '有' }],
    ['吸烟史：无 / 饮酒史：不详', { smokingHistory: '否认' }],
    ['饮酒史：无 ／ 吸烟史：有', { smokingHistory: '有', drinkingHistory: '否认' }],
    ['饮酒史：有 / 吸烟史：无', { smokingHistory: '否认', drinkingHistory: '有' }],
    ['本人可能吸烟；饮酒史待确认。', {}],
    ['未询问本人吸烟和饮酒。', {}],
    ['家属不清楚患者吸烟。', {}],
    ['父亲饮酒史不详而患者从不吸烟。', { smokingHistory: '否认' }],
  ] as const)('R2 projects patient statements without changing free text: %s', (text, expected) => {
    expect(habitValues(text)).toEqual(expected);
    expect(resolveHistoryRecordTemplate('personalHistory', text, text)).toBe(text);
  });

  it('keeps defaults and existing positive fixed-slot changes', () => {
    expect(resolveHistoryRecordTemplate('personalHistory', '')).toBe(DEFAULT_PERSONAL_HISTORY_TEMPLATE);
    expect(habitValues(DEFAULT_PERSONAL_HISTORY_TEMPLATE)).toEqual({ smokingHistory: '否认', drinkingHistory: '否认' });
    const positive = resolveHistoryRecordTemplate('personalHistory', '有吸烟史。');
    expect(positive).toBe(DEFAULT_PERSONAL_HISTORY_TEMPLATE.replace('{否认}吸烟史', '{有}吸烟史'));
    expect(collectHistoryRecordTemplateChanges({ personalHistory: positive })?.items).toEqual([
      expect.objectContaining({ slotKey: 'smokingHistory', toValue: '有' }),
    ]);
    const edited = positive.replace('{有}吸烟史', '没有吸烟史');
    expect(collectHistoryRecordTemplateChanges({ personalHistory: edited })).toBeUndefined();
    expect(habitValues(edited)).toEqual({ smokingHistory: '否认', drinkingHistory: '否认' });
  });

  it('preserves unrelated customer history templates and their projections', () => {
    const pastMedicalHistory = resolveHistoryRecordTemplate('pastMedicalHistory', '有高血压病史。');
    const familyHistory = resolveHistoryRecordTemplate('familyHistory', '有家族肿瘤病史。');
    expect(pastMedicalHistory).toBe(getDefaultHistoryRecordTemplate('pastMedicalHistory').replace('{否认}高血压病史', '{有}高血压病史'));
    expect(familyHistory).toBe(getDefaultHistoryRecordTemplate('familyHistory').replace('{否认}家族肿瘤病史', '{有}家族肿瘤病史'));
    expect(collectHistoryRecordTemplateChanges({ pastMedicalHistory, familyHistory })?.items.map(item => item.slotKey))
      .toEqual(['hypertensionHistory', 'familyTumorHistory']);
  });

  it.each(['', '  不吸烟，不饮酒。\n平时口味偏咸，运动较少。  '])('preserves explicit final draft text without normalization or old-value fallback: %j', personalHistory => {
    const payload = buildRecordConfirmedPayload({
      consultationId: 'F01-final-draft', chiefComplaint: '头晕2周', historyOfPresentIllness: '间断头晕。', pastMedicalHistory: '',
      personalHistory: '旧值：吸烟20年，饮酒10年。',
      outpatientRecord: { personalHistory }, diagList: [], orderList: [],
      writebackScope: { recordFields: ['personalHistory'], includeDiagnosis: false, orderTypes: [] },
    });
    expect(payload.outpatientRecord).toEqual({ schemaVersion: 'outpatient-record.v1', personalHistory });
    expect((payload.emrFieldValues as Record<string, string>)['个人史文本']).toBe(personalHistory);
    expect((payload.emrFieldValues as Record<string, string>)['吸烟史标志']).toBe(personalHistory ? '0' : undefined);
    expect((payload.emrFieldValues as Record<string, string>)['饮酒史标志']).toBe(personalHistory ? '0' : undefined);
    expect(payload.recordTemplateChanges).toBeUndefined();
  });
});
