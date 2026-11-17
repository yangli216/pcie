// @vitest-environment jsdom
// 字段级 prompt generator：用真实门诊模板对验证“按类别生成、不逐字段手写”。
import { describe, expect, it } from 'vitest';
import { parseOutpatientEmrTemplate } from '@features/outpatient-emr/lib/outpatientEmrTemplate';
import {
  buildOutpatientEmrPromptMessages,
  OUTPATIENT_EMR_PROMPT_VERSION,
  resolveOutpatientEmrFieldPromptProfile,
  resolveOutpatientEmrFieldPromptProfiles,
} from '@features/outpatient-emr/lib/outpatientEmrPromptGenerator';
import type { OutpatientEmrTemplateField } from '@features/outpatient-emr/types';
import templateHtml from './fixtures/real-template.html?raw';
import templateDefinition from './fixtures/real-template.json?raw';

// 分类只依赖字段定义；可见性门禁由解析器单独负责，这里覆盖模板中全部可写字段。
function parseAllWritableFields(): OutpatientEmrTemplateField[] {
  const probe = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本']);
  return probe.fields.filter((field) => !field.readonly);
}

function profileOf(fields: OutpatientEmrTemplateField[], fieldId: string) {
  const profile = resolveOutpatientEmrFieldPromptProfiles(fields)
    .find((item) => item.fieldId === fieldId);
  if (!profile) throw new Error(`缺少字段 ${fieldId}`);
  return profile;
}

describe('outpatient EMR field prompt generator (real template)', () => {
  const fields = parseAllWritableFields();

  it('classifies every writable field into a topic and value shape without per-field rules', () => {
    expect(fields).toHaveLength(75);
    const profiles = resolveOutpatientEmrFieldPromptProfiles(fields);
    expect(profiles).toHaveLength(fields.length);
    // 通用兜底只允许极少数确实无法归类的字段，防止规则退化为“全部 generic”。
    expect(profiles.filter((profile) => profile.topic === 'generic').length).toBeLessThanOrEqual(2);
  });

  it('derives clinical topics from mappings, sections and field semantics', () => {
    expect(profileOf(fields, '主诉文本')).toMatchObject({ topic: 'chief-complaint', shape: 'narrative' });
    expect(profileOf(fields, '现病史文本')).toMatchObject({ topic: 'present-illness' });
    expect(profileOf(fields, '高血压病史标志')).toMatchObject({ topic: 'past-history', shape: 'presence-flag' });
    expect(profileOf(fields, '高血压病史补充')).toMatchObject({ topic: 'past-history', shape: 'flag-detail' });
    expect(profileOf(fields, '过敏史标志')).toMatchObject({ topic: 'allergy-history', shape: 'presence-flag' });
    expect(profileOf(fields, '长期用药史补充')).toMatchObject({ topic: 'medication-history', shape: 'flag-detail' });
    expect(profileOf(fields, '预防接种史')).toMatchObject({ topic: 'past-history', shape: 'dictionary' });
    expect(profileOf(fields, '吸烟史标志')).toMatchObject({ topic: 'personal-history', shape: 'presence-flag' });
    expect(profileOf(fields, '末次月经时间')).toMatchObject({ topic: 'menstrual-history', shape: 'datetime' });
    expect(profileOf(fields, '怀孕标志')).toMatchObject({ topic: 'marital-reproductive-history', shape: 'presence-flag' });
    expect(profileOf(fields, '家族遗传病史标志')).toMatchObject({ topic: 'family-history', shape: 'presence-flag' });
    expect(profileOf(fields, '体温')).toMatchObject({ topic: 'physical-exam', shape: 'measurement' });
    expect(profileOf(fields, '意识')).toMatchObject({ topic: 'physical-exam', shape: 'dictionary' });
    expect(profileOf(fields, '干湿啰音标志')).toMatchObject({ topic: 'physical-exam', shape: 'presence-flag' });
    expect(profileOf(fields, '专科检查文本')).toMatchObject({ topic: 'physical-exam', shape: 'narrative' });
    expect(profileOf(fields, '辅助检查结果文本')).toMatchObject({ topic: 'auxiliary-results' });
    expect(profileOf(fields, '目前诊断')).toMatchObject({ topic: 'diagnosis' });
    expect(profileOf(fields, '医嘱其他补充')).toMatchObject({ topic: 'treatment', shape: 'narrative' });
    expect(profileOf(fields, '注意事项文本')).toMatchObject({ topic: 'precautions' });
  });

  it('keeps HIS-owned header, visit and signature fields out of generation', () => {
    expect(profileOf(fields, '页眉性别').topic).toBe('administrative');
    expect(profileOf(fields, '就诊时间').topic).toBe('administrative');
    expect(profileOf(fields, '医师签名时间').topic).toBe('administrative');
    expect(profileOf(fields, '就诊时间').modifiers).not.toContain('template-draft');
  });

  it.each(['持续时间', '病程时间', '持续时长', '病程时长', '症状持续时间', '发作时长'])(
    'treats text duration %s as narrative rather than calendar time', (name) => {
      const field = {
        ...fields.find((item) => item.id === '现病史文本')!,
        id: 'opaque-duration-field', name, type: 'text',
      };
      expect(resolveOutpatientEmrFieldPromptProfile(field)).toMatchObject({
        topic: 'present-illness', shape: 'narrative',
      });
    },
  );

  it.each([
    { name: '就诊时间', type: 'text' },
    { name: '末次月经日期', type: 'text' },
    { name: '发病时间', type: 'text' },
    { name: '病程记录日期', type: 'text' },
    { name: '持续时间', type: 'date' },
    { name: '病程时间', type: 'datetime' },
    { name: '持续时长', type: 'time' },
  ])('retains calendar/time shape for $name ($type)', ({ name, type }) => {
    const field = {
      ...fields.find((item) => item.id === '现病史文本')!,
      id: 'opaque-calendar-field', name, type,
    };
    expect(resolveOutpatientEmrFieldPromptProfile(field).shape).toBe('datetime');
  });

  it('emits only the category rules used by the requested fields, with a version', () => {
    const subset = fields.filter((field) => ['主诉文本', '吸烟史标志'].includes(field.id));
    const [system] = buildOutpatientEmrPromptMessages({
      request: {
        templateId: 'TPL-REAL',
        templateName: '门急诊病历',
        recordContext: { recordText: '咳嗽3天，吸烟20年。' },
      },
      fields: subset,
    }).map((message) => message.content);

    expect(system).toContain(`规则版本：${OUTPATIENT_EMR_PROMPT_VERSION}`);
    expect(system).toContain('[topic:chief-complaint]');
    expect(system).toContain('[topic:personal-history]');
    expect(system).toContain('[shape:presence-flag]');
    expect(system).not.toContain('[topic:family-history]');
    expect(system).not.toContain('[shape:measurement]');
    expect(system).not.toContain('[template-draft]');
  });

  it('builds the full real-template prompt with every field carrying its rule references', () => {
    const [system, user] = buildOutpatientEmrPromptMessages({
      request: {
        templateId: 'TPL-REAL',
        templateName: '门急诊病历',
        patient: { idPi: 'PI-01', name: '测试患者', sdSexText: '女', ageText: '36岁' },
        recordContext: { recordText: '咳嗽3天。' },
      },
      fields,
    }).map((message) => message.content);
    const payload = JSON.parse(user.slice(user.indexOf('\n') + 1)) as {
      template: { fields: Array<{ id: string; topic: string; shape: string }> };
      patient: Record<string, string>;
    };

    expect(payload.template.fields).toHaveLength(fields.length);
    payload.template.fields.forEach((field) => {
      expect(system).toContain(`[topic:${field.topic}]`);
      expect(system).toContain(`[shape:${field.shape}]`);
    });
    expect(payload.patient).toEqual({ sdSexText: '女', ageText: '36岁' });
    expect(user).not.toContain('测试患者');
    expect(user).not.toContain('PI-01');
  });
});
