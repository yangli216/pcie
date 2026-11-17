// @vitest-environment jsdom
// 病历模板解析评估用例（住院病历）：TC-19 ~ TC-20
// 覆盖住院模板字段提取/去重/章节归属、AI 适用性判定、字段规则与回填/预览渲染。
import { describe, expect, it } from 'vitest';
import {
  buildEditableInpatientEmrPreviewHtml,
  fillInpatientEmrTemplateHtml,
  isAdmissionTemplate,
  parseInpatientEmrTemplate,
} from '@features/inpatient-emr/lib/inpatientEmrTemplate';

const html = `
  <section data-article="日常病程记录">
    <p data-id="页眉姓名" data-type="text" data-name="页眉姓名">
      <span class="tag-value">张三</span>
    </p>
    <p data-id="病程记录文本" data-type="text" data-name="病程记录文本">
      <span class="tag-value">原值</span>
    </p>
    <p data-id="病程记录文本" data-type="text" data-name="重复字段">
      <span class="tag-value">重复</span>
    </p>
    <p data-id="医师签名" data-type="text" data-name="医师签名" data-readonly="true">
      <span class="tag-value">李医生</span>
    </p>
  </section>
`;

describe('住院病历模板解析评估（parseInpatientEmrTemplate）', () => {
  it('TC-19 字段提取、去重、章节归属与 AI 适用性判定', () => {
    const parsed = parseInpatientEmrTemplate(html);

    // 重复 data-id 只保留第一个
    expect(parsed.fields.map((field) => field.id)).toEqual([
      '页眉姓名',
      '病程记录文本',
      '医师签名',
    ]);
    expect(parsed.cacheKey).toMatch(/^tpl_/);

    const header = parsed.fields[0];
    expect(header).toMatchObject({
      article: '日常病程记录',
      aiSuitable: false,
      rule: { source: 'his_or_system' },
    });

    const body = parsed.fields[1];
    expect(body).toMatchObject({
      article: '日常病程记录',
      aiSuitable: true,
      defaultValue: '原值',
    });
    expect(body.rule.source).toBe('ai');
    expect(body.rule.promptIntent).toBe('inpatientRecordSection');

    const signature = parsed.fields[2];
    expect(signature).toMatchObject({ readonly: true, aiSuitable: false });
    expect(signature.rule.source).toBe('doctor_signature');
    expect(parsed.fields.every((field) => !Object.prototype.hasOwnProperty.call(field, 'presetStatus'))).toBe(true);

    expect(isAdmissionTemplate('入院记录')).toBe(true);
    expect(isAdmissionTemplate('日常病程记录')).toBe(false);
  });

  it('TC-20 回填与可编辑预览：AI 字段可编辑、其余只读，写入值按文本转义', () => {
    const parsed = parseInpatientEmrTemplate(html);
    const values = {
      病程记录文本: '<img src=x onerror=alert(1)>查房后病情平稳',
      医师签名: '王医生',
    };

    const filled = fillInpatientEmrTemplateHtml(html, values);
    expect(filled).toContain('查房后病情平稳');
    expect(filled).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(filled).not.toContain('<img');

    const preview = buildEditableInpatientEmrPreviewHtml(html, values, parsed.fields);
    // AI 字段标记为可编辑并带无障碍属性
    expect(preview).toContain('data-inpatient-emr-field-id="病程记录文本"');
    expect(preview).toContain('contenteditable="true"');
    expect(preview).toContain('aria-label="病程记录文本 AI 生成内容"');
    // 非 AI 字段强制只读
    expect(preview).toContain('data-inpatient-emr-field-id="页眉姓名"');
    expect(preview).toContain('inpatient-emr-field--readonly');

    const readonlyPreview = buildEditableInpatientEmrPreviewHtml(
      html,
      values,
      parsed.fields,
      false,
    );
    expect(readonlyPreview).not.toContain('contenteditable="true"');
    expect(readonlyPreview).toContain('inpatient-emr-field--generating');
  });
});
