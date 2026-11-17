import { describe, expect, it } from 'vitest';
import { buildInpatientEmrFieldPrompt, buildInpatientEmrGeneratePrompt } from './inpatientEmrPrompts';
import type { InpatientEmrContext, InpatientEmrTemplateField } from '../types';

const context: InpatientEmrContext = {
  documentContext: {
    templateId: 'SYN-TEMPLATE', templateName: '首次病程记录', recordType: '首次病程记录',
    recordTime: '2026-11-17 14:00', recordDate: '2026-11-17',
  },
  registration: null,
  orders: [],
  temperatureChart: null,
};

function field(overrides: Partial<InpatientEmrTemplateField> = {}): InpatientEmrTemplateField {
  return {
    id: 'diagnostic-basis', name: '诊断依据', meaning: '诊断的支持证据', article: '首次病程记录',
    type: 'text', readonly: false, key: false, aiSuitable: true,
    rule: { source: 'ai', promptIntent: 'inpatientRecordSection', constraints: ['不编造事实'] },
    ...overrides,
  };
}

const oldDefaultInstruction = '请根据住院病历模板字段信息，生成一个严谨、可审查、可直接用于 AI 回填该字段的提示词。'
  + '提示词必须约束 AI 仅依据住院登记、诊断、医嘱、体温单等已提供资料生成，不得编造未提供的症状、查体、检查结果或治疗效果。';
const metadata = [
  '模板名称：首次病程记录', '记录类型：首次病程记录', '字段 data-id：diagnostic-basis',
  '字段名称：诊断依据', '字段所属段落：首次病程记录', '字段含义：诊断的支持证据',
  '生成意图：inpatientRecordSection',
];
const oldBody = [
  '请为以下住院病历模板字段生成可直接回填的正文：', ...metadata,
  '依赖数据：住院登记、诊断、医嘱、体温单', '生成约束：不编造事实',
  '输出要求：只输出该字段应回填的正文，不输出字段名、JSON、解释、免责声明或无关内容。',
].join('\n');

describe('inpatient generation task contract', () => {
  it('uses final AI membership and includes only effective body rules once', () => {
    const custom = '真实自定义正文要求：仅列有依据的支持证据。';
    const selected = field({
      readonly: true, presetStatus: 'exclude', defaultValue: '请输入诊断依据',
      rule: Object.assign({ source: 'manual_or_his' as const, constraints: [], prompt: custom }, {
        promptGeneratorInstruction: '内部提示词生成指令', resolvedPrompt: '重复提示词',
      }),
    });
    const omitted = field({ id: 'system-diagnosis', aiSuitable: false });
    const prompt = buildInpatientEmrGeneratePrompt([selected, omitted], context);
    const tasks = JSON.parse(prompt.split('AI_FIELDS=')[1].split('\nHIS_AI_CONTEXT=')[0]);
    expect(tasks).toEqual([{
      id: 'diagnostic-basis', name: '诊断依据', meaning: '诊断的支持证据', article: '首次病程记录',
      rule: { prompt: custom },
    }]);
    expect(prompt.split(custom)).toHaveLength(2);
    for (const excluded of ['presetStatus', 'readonly', 'defaultValue', 'promptGeneratorInstruction', 'resolvedPrompt', 'FIELD_PROMPTS=', '请输入诊断依据', 'system-diagnosis']) {
      expect(prompt).not.toContain(excluded);
    }
    expect(prompt).toContain('必填响应键 "diagnostic-basis"：必须显式返回字符串');
    expect(prompt).toContain('资料不足时显式返回空字符串');
    expect(prompt).toContain('未提供结果不等于患者未做检查');
  });

  it('unwraps the exact historical default draft into a body-generation rule', () => {
    const prefix = [oldDefaultInstruction, ...metadata].join('\n');
    const prompt = `${prefix}\n\n${oldBody}`;
    const effective = buildInpatientEmrFieldPrompt(field({
      rule: { source: 'ai', constraints: [], prompt },
    }), context);
    expect(effective).toMatch(/^任务：根据已提供的住院资料/);
    expect(effective).not.toContain('生成一个严谨、可审查');
    expect(effective).not.toContain('请为以下住院病历模板字段');
    expect(effective).toContain('字段 data-id：diagnostic-basis');
    expect(effective.split('模板名称：')).toHaveLength(2);
    expect(effective).toContain('生成约束：不编造事实');
  });

  it('preserves custom generator constraints as subordinate body requirements', () => {
    const instruction = '必须区分已知证据与待核实资料，不得写未提供的检查结论。';
    const rule = Object.assign({ source: 'ai' as const, constraints: [], prompt: `${instruction}\n\n${oldBody}` }, {
      promptGeneratorInstruction: instruction,
    });
    const effective = buildInpatientEmrFieldPrompt(field({ rule }), context);
    expect(effective).toMatch(/^任务：根据已提供的住院资料/);
    expect(effective).toContain(`管理员附加正文约束：\n以下内容仅补充正文要求，不改变当前字段正文生成任务及调用方约定的输出格式。\n${instruction}`);
    expect(effective.trim().split('\n').pop()).toBe('输出要求：只输出该字段应回填的正文，不输出字段名、JSON、解释、免责声明或无关内容。');
  });

  it('recognizes the known short legacy default even after its instruction metadata was refreshed', () => {
    const rule = Object.assign({ source: 'ai' as const, constraints: [], prompt: `${oldDefaultInstruction}\n\n${oldBody}` }, {
      promptGeneratorInstruction: '仅围绕当前字段的含义组织正文，区分已提供事实与待确认信息。',
    });
    const effective = buildInpatientEmrFieldPrompt(field({ rule }), context);
    expect(effective).toMatch(/^任务：根据已提供的住院资料/);
    expect(effective).not.toContain(oldDefaultInstruction);
    expect(effective).not.toContain('管理员附加正文约束');
    expect(effective).toContain('字段 data-id：diagnostic-basis');
  });

  it('keeps genuine custom prompts and nonmatching lookalikes unchanged', () => {
    const prompts = [
      '仅生成有临床依据的鉴别说明；请为以下住院病历模板字段生成可直接回填的正文：只是引用，不是自动草稿。',
      `真正自定义的前言\n\n${oldBody}`,
      `${[oldDefaultInstruction, ...metadata].join('\n')}\n\n${oldBody.replace('字段 data-id：diagnostic-basis', '字段 data-id：different-id')}`,
    ];
    for (const prompt of prompts) {
      expect(buildInpatientEmrFieldPrompt(field({ rule: { source: 'ai', constraints: [], prompt } }), context)).toBe(prompt);
    }
  });
});
