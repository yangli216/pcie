// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  buildEditableInpatientEmrPreviewHtml,
  buildDefaultFieldValues,
  fillInpatientEmrTemplateHtml,
  parseInpatientEmrTemplate,
} from './inpatientEmrTemplate';
import type { InpatientEmrContext } from '../types';

const MALICIOUS_TEMPLATE = `
  <section onclick="alert(1)">
    <p data-id="chiefComplaint" data-type="text" data-name="主诉" style="color: #334155; position: fixed">
      <span class="tag-value">原值</span>
    </p>
    <script>alert(1)</script>
  </section>
`;

describe('inpatient EMR HTML boundary', () => {
  it('prefers the rendered text from the current template over its design-time entry hint', () => {
    const parsed = parseInpatientEmrTemplate('<p data-id="cc" data-type="text" data-name="主诉" data-default="请输入主诉"><span class="tag-value">合成本次主诉</span></p>');
    expect(parsed.fields[0]).toMatchObject({
      defaultValue: '合成本次主诉',
      templateText: { rendered: '合成本次主诉', attributeDefault: '请输入主诉' },
    });
  });

  it('uses clinical semantics consistently without single-character or abbreviation substring matches', () => {
    const labels = ['临床诊断依据文本', '临床表现文本', '入院原因正文', '查房医师意见', '诊断依据编码', '诊断依据录入时间', '鉴别诊断医师签名', '病程记录操作人员', '首次病程记录医师', '诊断依据签署人', '首次病程记录名称', '首次病程记录标题', 'diagnostic_basis_created_at'];
    const parsed = parseInpatientEmrTemplate(labels.map((name, index) => `<span data-id="syn-${index}" data-name="${name}" data-type="text">原值</span>`).join(''));
    expect(parsed.fields.filter((field) => field.aiSuitable).map((field) => field.name)).toEqual(labels.slice(0, 4));
    expect(parsed.fields[0].meaning).toContain('支持证据');
    expect(parsed.fields[1].meaning).not.toContain('床号');
    expect(parsed.fields[3].meaning).toContain('临床正文');
    expect(parsed.fields.every((field) => !Object.prototype.hasOwnProperty.call(field, 'presetStatus'))).toBe(true);
    expect(parsed.unknownFieldIds).toEqual([]);
  });

  it('does not use default clinical text as field classification evidence', () => {
    const parsed = parseInpatientEmrTemplate('<span data-id="syn-chief" data-name="主诉" data-type="text">长期卧床，住址已变更。</span>');
    expect(parsed.fields[0]).toMatchObject({ aiSuitable: true, rule: { source: 'ai' } });
    expect(parsed.fields[0].meaning).toContain('临床正文');
    expect(parsed.fields[0].meaning).not.toContain('床号');
  });

  it('keeps undecided IDs outside field objects and does not classify opaque IDs or short codes as clinical facts', () => {
    const parsed = parseInpatientEmrTemplate([
      '<span data-id="4f3bcf61" data-name="字段A" data-type="text">原值</span>',
      '<span data-id="cf" data-type="text">原值</span>',
      '<span data-id="syn-exposure" data-name="职业暴露史" data-type="text">原值</span>',
      '<span data-id="patientId" data-type="text">原值</span>',
      '<span data-id="idPi" data-type="text">原值</span>',
      '<span data-id="admissionId" data-type="text">原值</span>',
    ].join(''));
    expect(parsed.unknownFieldIds).toEqual(['4f3bcf61', 'cf', 'syn-exposure']);
    expect(parsed.fields.every((field) => !field.aiSuitable)).toBe(true);
    expect(parsed.fields.slice(0, 3).every((field) => field.rule.source === 'manual_or_his')).toBe(true);
    expect(parsed.fields.slice(3).every((field) => field.rule.source === 'his_or_system')).toBe(true);
    expect(JSON.stringify(parsed.fields)).not.toMatch(/presetStatus|unknownFieldIds/);
  });

  it('keeps the first field identity when a duplicate has a different semantic suggestion', () => {
    const parsed = parseInpatientEmrTemplate('<span data-id="same" data-name="主诉" data-type="text">原值</span><span data-id="same" data-name="未知" data-type="text">原值</span>');
    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0].aiSuitable).toBe(true);
    expect(parsed.unknownFieldIds).toEqual([]);
  });

  it('recognizes diagnostic narrative semantics while keeping objective diagnosis fields excluded', () => {
    const parsed = parseInpatientEmrTemplate(`
      <span data-id="syn-1" data-type="text" data-name="诊断依据">请输入诊断依据</span>
      <span data-id="syn-2" data-type="text" data-name="鉴别诊断">请输入鉴别诊断</span>
      <span data-id="syn-3" data-type="text" data-name="入院诊断">原诊断</span>
      <span data-id="syn-4" data-type="text" data-name="诊断编码">原编码</span>
      <span data-id="syn-5" data-type="text" data-name="诊断依据录入时间">时间</span>
    `);
    expect(parsed.fields.filter((field) => field.aiSuitable).map((field) => field.id)).toEqual(['syn-1', 'syn-2']);
    expect(parsed.fields[0].meaning).toContain('支持证据');
    expect(parsed.fields[1].meaning).toContain('待确认信息');
    expect(parsed.fields[0].rule.source).toBe('ai');
    expect(parsed.fields[1].rule.source).toBe('ai');
  });

  it('starts AI values empty without replacing non-AI template values with generated-looking defaults', () => {
    const context: InpatientEmrContext = {
      documentContext: { templateId: 'SYN', templateName: '首次病程记录', recordType: '首次病程记录', recordTime: '2026-11-17 14:00', recordDate: '2026-11-17' },
      registration: null, orders: [], temperatureChart: null,
    };
    const parsed = parseInpatientEmrTemplate(`
      <span data-id="diagnostic-basis" data-type="text" data-name="诊断依据">请输入诊断依据</span>
      <span data-id="病程记录文本" data-type="text">模板原病程</span>
      <span data-id="入院诊断" data-type="text">HIS原诊断</span>
    `);
    expect(buildDefaultFieldValues(parsed.fields, context)).toEqual({
      'diagnostic-basis': '', 病程记录文本: '', 入院诊断: 'HIS原诊断',
    });
    parsed.fields[1].aiSuitable = false;
    expect(buildDefaultFieldValues(parsed.fields, context).病程记录文本).toBe('模板原病程');
  });

  it.each(['请输入诊断依据', '（待补充）', '请填写查体，已测左上肢温度37.6℃', '请补充维生素D。'])('preserves the original rendered field text: %s', (value) => {
    const parsed = parseInpatientEmrTemplate(`<span data-id="病史" data-type="text">${value}</span>`);
    expect(parsed.fields[0].templateText?.rendered).toBe(value);
  });

  it('sanitizes before parsing and preserves template field contracts', () => {
    const parsed = parseInpatientEmrTemplate(MALICIOUS_TEMPLATE);

    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0]).toMatchObject({ id: 'chiefComplaint', name: '主诉' });
  });

  it('sanitizes editable preview HTML and writes field values as text', () => {
    const parsed = parseInpatientEmrTemplate(MALICIOUS_TEMPLATE);
    const preview = buildEditableInpatientEmrPreviewHtml(
      MALICIOUS_TEMPLATE,
      { chiefComplaint: '<img src=x onerror=alert(1)>头晕' },
      parsed.fields.map((field) => ({ ...field, aiSuitable: true })),
    );

    expect(preview).toContain('data-inpatient-emr-field-id="chiefComplaint"');
    expect(preview).toContain('contenteditable="true"');
    expect(preview).toContain('&lt;img src=x onerror=alert(1)&gt;头晕');
    expect(preview).not.toMatch(/<script|onclick=|position\s*:/i);

    const filled = fillInpatientEmrTemplateHtml(
      MALICIOUS_TEMPLATE,
      { chiefComplaint: '<script>alert(1)</script>头晕' },
    );
    expect(filled).toContain('&lt;script&gt;alert(1)&lt;/script&gt;头晕');
    expect(filled).not.toContain('<script>');
  });
});
