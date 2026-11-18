// @vitest-environment jsdom
// Supplied HIS template response, decoded at the source boundary. All patient,
// institution and signature values in this fixture are empty placeholders.
import { describe, expect, it, vi } from 'vitest';
import { analyzeOutpatientEmrFields } from '@features/outpatient-emr/api/outpatientEmrService';
import { buildOutpatientEmrInitialDraft, resolveOutpatientEmrModelDraft } from '@features/outpatient-emr/lib/outpatientEmrDraftSource';
import {
  parseOutpatientEmrTemplate,
  restoreOutpatientEmrTemplateFromSnapshot,
} from '@features/outpatient-emr/lib/outpatientEmrTemplate';
import { resolveOutpatientEmrFieldPromptProfiles } from '@features/outpatient-emr/lib/outpatientEmrPromptGenerator';
import { buildOutpatientEmrRecordConfirmedPayload } from '@features/outpatient-emr/lib/outpatientEmrWriteback';
import type { OutpatientEmrAnalysisRequest } from '@features/outpatient-emr/types';
import html from './fixtures/his-internal-medicine-template.html?raw';
import definition from './fixtures/his-internal-medicine-template.json?raw';

const targetFieldIds = ['主诉文本', '持续时间', '呕吐标志', '腹泻标志', '胃纳', '时间单位', '夜寐', '体温', '注意事项文本'];

function parseTemplate() {
  return parseOutpatientEmrTemplate(html, definition, targetFieldIds);
}

describe('supplied HIS internal medicine template pair', () => {
  it('pairs every field while retaining the actual HIS chapter structure', () => {
    const result = parseTemplate();
    expect(result.fields).toHaveLength(66);
    expect(new Set(result.fields.map((field) => field.articleTemplateId)).size).toBe(11);
    expect(result.fields.filter((field) => field.readonly)).toHaveLength(8);
    expect(result.targetFields.map((field) => field.id)).toEqual(targetFieldIds);
    // This template has a structured present-illness section, not one narrative field.
    expect(result.fields.find((field) => field.id === '现病史文本')).toBeUndefined();
    expect(result.fields.find((field) => field.id === '持续时间')).toMatchObject({
      recordField: 'historyOfPresentIllness',
      projectionMode: 'section-compose',
    });
  });

  it('does not treat placeholders or dictionary seen flags as current clinical facts', () => {
    const result = parseTemplate();
    expect(result.fields.every((field) => field.baselineValue === '')).toBe(true);
    expect(result.targetFields.every((field) => buildOutpatientEmrInitialDraft(field).value === '')).toBe(true);
    const durationUnit = result.fields.find((field) => field.id === '时间单位')!;
    expect(durationUnit.dictionaryItems).toEqual([
      { value: '1', text: '分钟' }, { value: '2', text: '小时' },
      { value: '3', text: '天' }, { value: '4', text: '周' },
      { value: '5', text: '个月' }, { value: '6', text: '年' },
      { value: '7', text: '秒' },
    ]);
    expect(durationUnit.baselineDictionaryValue).toBe('');
  });

  it.each(['肝炎史补充', '疟疾史补充', '高血压病史补充', '输血史补充', '页眉姓名', '医嘱'])(
    'rejects hidden or readonly target %s on both fresh parse and snapshot restoration', (id) => {
      const fields = parseTemplate().fields;
      expect(() => parseOutpatientEmrTemplate(html, definition, [id])).toThrow();
      expect(() => restoreOutpatientEmrTemplateFromSnapshot(html, fields, [id])).toThrow();
    },
  );

  it('classifies the supplied leaves by their section and value shape', () => {
    const profiles = resolveOutpatientEmrFieldPromptProfiles(parseTemplate().fields);
    expect(profiles.find((profile) => profile.fieldId === '持续时间')).toMatchObject({
      topic: 'present-illness', shape: 'narrative',
    });
    expect(profiles.find((profile) => profile.fieldId === '腹泻标志')).toMatchObject({
      topic: 'present-illness', shape: 'presence-flag',
    });
    expect(profiles.find((profile) => profile.fieldId === '体温')).toMatchObject({
      topic: 'physical-exam', shape: 'measurement',
    });
    expect(profiles.find((profile) => profile.fieldId === '医嘱其他补充')).toMatchObject({
      topic: 'treatment', shape: 'narrative',
    });
    expect(profiles.find((profile) => profile.fieldId === '医师签名时间')).toMatchObject({ topic: 'administrative' });
  });

  it('generates and binds the actual template fields with a Fake model', async () => {
    const template = parseTemplate();
    const request: OutpatientEmrAnalysisRequest = {
      visitId: 'SIM-HIS-VISIT', templateId: 'SIM-HIS-TEMPLATE', templateName: '门诊内科',
      templateHtml: html, templateDefinition: definition, targetFieldIds,
      requestId: 'SIM-HIS-REQUEST',
      patient: { idPi: 'SIM-HIS-PATIENT', name: '合成患者', ageText: '40岁', sdSexText: '女' },
      recordContext: { recordText: '腹泻1天，无呕吐，体温37.2℃。' },
    };
    const chatFast = vi.fn(async () => JSON.stringify({
      主诉文本: '腹泻1天', 持续时间: '1', 呕吐标志: '0', 腹泻标志: '1',
      胃纳: null, 夜寐: null, 时间单位: '3', 体温: '37.2', 注意事项文本: '注意饮食卫生，症状加重及时复诊。',
    }));
    const values = await analyzeOutpatientEmrFields(
      { request, fields: template.targetFields }, { chatFast: chatFast as never },
    );
    expect(values).toMatchObject({ 呕吐标志: '无', 腹泻标志: '有', 时间单位: '天', 体温: '37.2' });
    const messages = (chatFast.mock.calls as unknown as Array<[unknown]>)[0][0];
    expect(JSON.stringify(messages)).not.toContain('SIM-HIS-PATIENT');
    expect(JSON.stringify(messages)).not.toContain('SIM-HIS-VISIT');
    expect(JSON.stringify(messages)).not.toContain('合成患者');
    const fieldValues = Object.fromEntries(template.targetFields.map(field => {
      const draft = resolveOutpatientEmrModelDraft(field, values[field.id]);
      if (field.id === '胃纳' || field.id === '夜寐') expect(draft.source).toBe('unmentioned-default');
      return [field.id, draft.value];
    }));
    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request, templateHash: 'a'.repeat(64), fields: template.targetFields,
      fieldValues, timestamp: 1_800_000_000_000,
    });
    expect(payload.templateMetadata.templateId).toBe('SIM-HIS-TEMPLATE');
    expect(payload.fieldValues['主诉文本']).toBe('腹泻1天');
    expect(payload.emrFieldValues['呕吐标志']).toBe('0');
    expect(payload.emrFieldValues['腹泻标志']).toBe('1');
    expect(payload.emrFieldValues['时间单位']).toBe('3');
    expect(payload.dictionarySelections['胃纳']).toEqual({ value: '2', text: '如常' });
    expect(payload.dictionarySelections['夜寐']).toEqual({ value: '0', text: '安' });
    expect(payload.outpatientRecord?.historyOfPresentIllness).toContain('持续时间：1');
    expect(payload.outpatientRecord?.historyOfPresentIllness).toContain('时间单位：天');
    expect(Object.keys(payload.fieldValues)).toEqual(targetFieldIds);
  });
});
