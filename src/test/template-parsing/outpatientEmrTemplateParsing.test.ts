// @vitest-environment jsdom
// 病历模板解析评估用例（门诊病历）：TC-01 ~ TC-18
// 夹具为真实门诊病历模板对（HIS 导出的渲染 HTML + 结构化 JSON 定义），
// 覆盖严格配对、字典基线、标准字段映射、目标字段校验与异常分支。
import { describe, expect, it } from 'vitest';
import { buildOutpatientEmrInitialDraft } from '@features/outpatient-emr/lib/outpatientEmrDraftSource';
import {
  OutpatientEmrError,
  parseOutpatientEmrTemplate,
  restoreOutpatientEmrTemplateFromSnapshot,
} from '@features/outpatient-emr/lib/outpatientEmrTemplate';
import { parseOutpatientEmrTemplateDefinition } from '@features/outpatient-emr/lib/outpatientEmrTemplateDefinition';
import templateHtml from './fixtures/real-template.html?raw';
import templateDefinition from './fixtures/real-template.json?raw';

interface RawEle extends Record<string, unknown> {
  ID: string;
}

interface RawArticle extends Record<string, unknown> {
  ID: string;
  eles: RawEle[];
}

function parseRawDefinition(): RawArticle[] {
  return JSON.parse(templateDefinition) as RawArticle[];
}

function findEle(articles: RawArticle[], fieldId: string): RawEle {
  for (const article of articles) {
    const ele = article.eles.find((item) => item.ID === fieldId);
    if (ele) return ele;
  }
  throw new Error(`夹具中不存在字段 ${fieldId}`);
}

function expectOutpatientError(action: () => unknown, code: string): void {
  expect(action).toThrowError(OutpatientEmrError);
  try {
    action();
  } catch (error) {
    expect((error as OutpatientEmrError).code).toBe(code);
  }
}

const WRITABLE_SAMPLE_TARGETS = [
  '主诉文本',
  '现病史文本',
  '注意事项文本',
  '意识',
  '体温',
  '就诊时间',
];

describe('门诊病历模板解析评估（真实模板对：16 章节 / 83 元素 / 3 个 import 动作）', () => {
  it('TC-01 真实模板对成功配对：字段规模、章节覆盖与可写性统计', () => {
    const result = parseOutpatientEmrTemplate(
      templateHtml,
      templateDefinition,
      WRITABLE_SAMPLE_TARGETS,
    );

    // 86 个结构元素中 3 个 import 动作不计入可回填字段，剩余 83 个字段全部配对
    expect(result.fields).toHaveLength(83);
    expect(result.fields.map((field) => field.id)).not.toContain('0333');
    expect(new Set(result.fields.map((field) => field.articleTemplateId)).size).toBe(16);
    expect(result.fields.filter((field) => field.readonly)).toHaveLength(8);
    expect(result.fields.every((field) => field.id.trim().length > 0)).toBe(true);

    // 目标字段按模板 DOM 顺序返回，而不是请求顺序
    expect(result.targetFields.map((field) => field.id)).toEqual([
      '就诊时间',
      '主诉文本',
      '现病史文本',
      '体温',
      '意识',
      '注意事项文本',
    ]);

    const drafts = Object.fromEntries(result.targetFields.map((field) => [field.id, buildOutpatientEmrInitialDraft(field).value]));
    // 字典字段草稿值必须为空（等待选择），文本字段取基线值
    expect(drafts['意识']).toBe('');
    expect(drafts['主诉文本']).toBe('');
    expect(drafts['就诊时间']).toBe('2025-03-18 10:52');
  });

  it('TC-02 渲染结果被净化：contenteditable / 脚本被剥离，字段契约保留', () => {
    const result = parseOutpatientEmrTemplate(
      templateHtml,
      templateDefinition,
      ['主诉文本'],
    );
    expect(result.sanitizedHtml).toContain('data-id="主诉"');
    expect(result.sanitizedHtml).not.toContain('contenteditable');
    expect(result.sanitizedHtml).not.toContain('<script');
    expect(result.sanitizedHtml).not.toMatch(/on(click|error|load|mouse\w+)=/i);
  });

  it('TC-03 字典字段基线：VALUE/TEXT 命中同一字典项，且全部字典字段均有字典项', () => {
    const result = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['意识']);

    const dictionaryFields = result.fields.filter((field) => field.dictionaryItems.length > 0);
    expect(dictionaryFields.length).toBe(41);
    expect(result.fields.filter((field) => field.type === 'select').length)
      .toBe(dictionaryFields.length);

    const consciousness = result.fields.find((field) => field.id === '意识');
    expect(consciousness).toMatchObject({
      baselineValue: '清楚',
      baselineDictionaryValue: '1',
      readonly: false,
      aiSuitable: false,
    });
    // 空白占位字典项（TEXT 为单个空格）会被过滤
    expect(consciousness?.dictionaryItems.map((item) => item.text)).toEqual([
      '清楚',
      '不清',
      '嗜睡',
      '昏睡',
      '昏迷',
      '模糊',
      '谵妄',
      '朦胧',
      '漫游性自动症',
      '最低意识状态',
      '去大脑皮质状态',
      '植物状态',
      '浅昏迷',
      '中度昏迷',
      '深昏迷',
      '梦游症',
      '神游症',
    ]);
  });

  it('TC-04 确定性别名映射：主诉/现病史字段经名称别名落到标准记录字段', () => {
    const result = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本']);
    expect(result.fields.find((field) => field.id === '主诉文本')).toMatchObject({
      recordField: 'chiefComplaint',
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    });

    const hpi = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['现病史文本']);
    expect(hpi.fields.find((field) => field.id === '现病史文本')).toMatchObject({
      recordField: 'historyOfPresentIllness',
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    });
  });

  it('TC-05 章节定义名映射：注意事项章节按名称“注意事项及宣教”命中 precautions', () => {
    const result = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['注意事项文本']);
    const field = result.fields.find((item) => item.id === '注意事项文本');
    expect(field).toMatchObject({
      recordField: 'precautions',
      mappingSource: 'deterministic-alias',
      projectionMode: 'direct',
    });
    // 无标准映射的字段保持未映射状态
    const unmapped = result.fields.filter(
      (item) => item.mappingSource === 'unmapped' && item.recordField === null,
    );
    expect(unmapped.length).toBeGreaterThan(0);
    expect(unmapped.every((item) => item.projectionMode === null)).toBe(true);
  });

  it('TC-06 import 动作元素：计入定义导入项但不作为可回填字段或目标', () => {
    // 结构定义解析时 3 个 import 动作进入导入项列表并绑定所属章节
    const definition = parseOutpatientEmrTemplateDefinition(templateDefinition);
    expect(definition.imports.map((item) => item.id).sort()).toEqual([
      '0313',
      '0333',
      '0334',
    ]);
    expect(definition.imports.every((item) => item.type.toLowerCase() === 'import')).toBe(true);
    expect(definition.fields).toHaveLength(83);

    const result = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本']);
    // import 动作不进入可回填字段列表
    expect(result.fields.map((field) => field.id)).not.toContain('0333');
    // 且不可作为回填目标
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['0333']),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('TC-07 只读字段：页眉/签名/医嘱只读字段保留基线且不进入 AI 可写集合', () => {
    const result = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本']);
    const readonlyIds = result.fields
      .filter((field) => field.readonly)
      .map((field) => field.id)
      .sort();
    expect(readonlyIds).toEqual([
      '医嘱',
      '医师签名',
      '页眉医疗机构',
      '页眉姓名',
      '页眉病历标题',
      '页眉就诊科室',
      '页眉病历号',
      '页眉年龄',
    ].sort());
    expect(result.fields.every((field) => !(field.readonly && field.aiSuitable))).toBe(true);

    const title = result.fields.find((field) => field.id === '页眉病历标题');
    expect(title).toMatchObject({ baselineValue: '门(急)诊病历', readonly: true });
  });

  it('TC-19 隐藏目标独立排除，可见目标照常分析', () => {
    // 真实模板在“高血压病史标志=否认”时以内联 display:none 隐藏补充字段。
    const mixed = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本', '高血压病史补充']);
    expect(mixed.targetFields.map(field => field.id)).toEqual(['主诉文本']);
    expect(mixed.templateSourceNotes).toEqual([{ fieldId: '高血压病史补充', reason: 'hidden' }]);
    const probe = parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['主诉文本']);
    expectOutpatientError(
      () => restoreOutpatientEmrTemplateFromSnapshot(templateHtml, probe.fields, ['高血压病史补充']),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('TC-08 目标字段为空时报 NO_SUPPORTED_TEMPLATE_FIELDS', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, templateDefinition, []),
      'NO_SUPPORTED_TEMPLATE_FIELDS',
    );
  });

  it('TC-09 目标字段 ID 重复时报 INVALID_TARGET_FIELD_IDS', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(
        templateHtml,
        templateDefinition,
        ['主诉文本', '主诉文本'],
      ),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('TC-10 目标字段包含只读字段（医嘱/页眉姓名）时报 INVALID_TARGET_FIELD_IDS', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['医嘱']),
      'INVALID_TARGET_FIELD_IDS',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, templateDefinition, ['页眉姓名']),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('TC-11 目标字段包含模板中不存在的字段时报 INVALID_TARGET_FIELD_IDS', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(
        templateHtml,
        templateDefinition,
        ['模板中不存在的字段'],
      ),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('TC-12 字典目标字段被移除字典项时报 MISSING_DICTIONARY_DEFINITION', () => {
    const articles = parseRawDefinition();
    delete findEle(articles, '意识').BINDINGDATA;
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, JSON.stringify(articles), ['意识']),
      'MISSING_DICTIONARY_DEFINITION',
    );
  });

  it('TC-13 其他章节缺失仍可配对主诉', () => {
    const articles = parseRawDefinition();
    articles.pop();
    const result = parseOutpatientEmrTemplate(templateHtml, JSON.stringify(articles), ['主诉文本']);
    expect(result.targetFields.map(field => field.id)).toEqual(['主诉文本']);
  });

  it('TC-14 字段 TEXT 与 HTML 渲染值漂移时报 TEMPLATE_PAIR_MISMATCH', () => {
    const articles = parseRawDefinition();
    // HTML 中“主诉文本”当前渲染为空，把结构定义 TEXT 改掉即形成漂移
    findEle(articles, '主诉文本').TEXT = '与页面不同的主诉';
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, JSON.stringify(articles), ['主诉文本']),
      'TEMPLATE_PAIR_MISMATCH',
    );
  });

  it('TC-15 RECORD_FIELD 不在标准字段白名单时报 INVALID_RECORD_FIELD_MAPPING', () => {
    const articles = parseRawDefinition();
    findEle(articles, '主诉文本').RECORD_FIELD = 'notAStandardField';
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, JSON.stringify(articles), ['主诉文本']),
      'INVALID_RECORD_FIELD_MAPPING',
    );
  });

  it.each([['主诉文本'], ['主诉文本', '现病史文本']])('TC-16 映射冲突仍保留明确目标 %s，仅省略冲突的标准投影', (...ids) => {
    const articles = parseRawDefinition();
    findEle(articles, '主诉文本').RECORD_FIELD = 'chiefComplaint';
    findEle(articles, '现病史文本').RECORD_FIELD = 'chiefComplaint';
    const result = parseOutpatientEmrTemplate(templateHtml, JSON.stringify(articles), ids);
    const restored = restoreOutpatientEmrTemplateFromSnapshot(templateHtml, result.fields, ids);
    for (const view of [result, restored]) {
      expect(view.targetFields.map(field => field.id)).toEqual(ids);
      expect(view.targetFields.every(field => field.recordField === null && field.projectionMode === null)).toBe(true);
    }
  });

  it('TC-17 结构定义非法 JSON / 顶层非数组时报 INVALID_TEMPLATE_JSON', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, '{这不是JSON', ['主诉文本']),
      'INVALID_TEMPLATE_JSON',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(templateHtml, '{"ID":"header"}', ['主诉文本']),
      'INVALID_TEMPLATE_JSON',
    );
  });

  it('TC-18 章节或字段 ID 重复仅影响身份存在歧义的字段', () => {
    const duplicatedArticle = parseRawDefinition();
    duplicatedArticle.push(JSON.parse(JSON.stringify(duplicatedArticle[0])) as RawArticle);
    const result = parseOutpatientEmrTemplate(templateHtml, JSON.stringify(duplicatedArticle), ['主诉文本']);
    expect(result.targetFields.map(field => field.id)).toEqual(['主诉文本']);
    expect(result.fields.some(field => field.articleTemplateId === duplicatedArticle[0].ID)).toBe(false);

    const duplicatedField = parseRawDefinition();
    const chief = duplicatedField.find((article) => article.ID === '主诉');
    chief?.eles.push(JSON.parse(JSON.stringify(chief.eles[0])) as RawEle);
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(
        templateHtml,
        JSON.stringify(duplicatedField),
        ['主诉文本'],
      ),
      'INVALID_TEMPLATE_JSON',
    );
  });
});
