// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import html from '@/test/template-parsing/fixtures/his-internal-medicine-template.html?raw';
import definition from '@/test/template-parsing/fixtures/his-internal-medicine-template.json?raw';
import { parseOutpatientEmrTemplate, restoreOutpatientEmrTemplateFromSnapshot } from './outpatientEmrTemplate';
import { buildOutpatientEmrDocument, outpatientEmrChapterTextField, describeOutpatientEmrNarrative, parseOutpatientEmrNarrative, renderOutpatientEmrNarrative, renderOutpatientEmrNarrativeSections } from './outpatientEmrNarrative';
import type { OutpatientEmrTemplateField } from '../types';

const ids = ['舒张压', '体温', '收缩压', '体格检查-精神', '胃纳', '痰声标志', '呕吐标志', '时间单位', '持续时间', '主诉文本'];

function customField(id: string, name: string, recordField: OutpatientEmrTemplateField['recordField'] = null): OutpatientEmrTemplateField {
  return {
    id, name, type: 'text', articleId: '观察', articleTemplateId: 'custom', articleName: '观察', articleDefinitionName: '观察',
    readonly: false, aiSuitable: true, baselineValue: '', baselineDictionaryValue: '', dictionaryItems: [],
    recordField, mappingSource: recordField ? 'manual-override' : 'unmapped', projectionMode: recordField ? 'direct' : null,
  };
}

const idsOf = (fields: OutpatientEmrTemplateField[]) => fields.map(field => field.id);

describe('outpatient clinical narrative', () => {
  it.each(['fresh', 'cache'] as const)('derives sections, connectors and slot identity from the current HTML on a %s parse', mode => {
    const parsed = parseOutpatientEmrTemplate(html, definition, ids);
    const parsedOrRestored = mode === 'fresh' ? parsed : restoreOutpatientEmrTemplateFromSnapshot(
      html.replace('痰声。', '合成观察。'), parsed.fields, ids, definition,
    );
    const sections = parseOutpatientEmrNarrative(parsedOrRestored.sanitizedHtml, parsedOrRestored.targetFields);
    expect(sections.map(section => section.title)).toEqual(['主诉', '现病史', '体格检查']);
    const [chief, history, exam] = sections;
    expect(chief.directField?.id).toBe('主诉文本');
    expect(history.directField).toBeNull();
    expect(idsOf(history.fields)).toEqual(['持续时间', '时间单位', '痰声标志', '呕吐标志', '胃纳']);
    const values = { 持续时间: '3', 时间单位: '天', 痰声标志: '有', 呕吐标志: '无', 胃纳: '', 体温: '37.2', 收缩压: '120', 舒张压: '80' };
    const rendered = renderOutpatientEmrNarrative(history, values);
    const topic = mode === 'fresh' ? '痰声' : '合成观察';
    expect(rendered.map(part => part.text).join('')).toBe(`患者3天前，有${topic}。无呕吐`);
    expect(rendered.filter(part => part.kind === 'field').map(part => part.field.id)).toEqual(['持续时间', '时间单位', '痰声标志', '呕吐标志']);
    expect(renderOutpatientEmrNarrative(exam, values).map(part => part.text).join('')).toBe('体温：37.2℃；血压：120/80mmHg');
    const grammar = describeOutpatientEmrNarrative([history, exam]);
    expect(grammar[0].clauses).toContainEqual([
      { kind: 'field', id: '痰声标志', name: '痰声标志' }, { kind: 'text', text: topic }, { kind: 'text', text: '。' },
    ]);
    expect(JSON.stringify(grammar)).not.toMatch(/页眉|签名|NS（-）|腹软|呼吸性吸凹|data-id|<span|placeholder/);
  });

  it('keeps the edit target when a value is empty, without inferring a finding from its template words', () => {
    const parsed = parseOutpatientEmrTemplate(html, definition, ids);
    const [, history, exam] = parseOutpatientEmrNarrative(parsed.sanitizedHtml, parsed.targetFields);
    expect(renderOutpatientEmrNarrative(history, {})).toEqual([]);
    expect(renderOutpatientEmrNarrative(exam, { 收缩压: '108' }).map(part => part.text).join('')).toBe('收缩压：108mmHg');
    expect(idsOf(exam.fields)).toContain('舒张压');
    // The suffix unit alone cannot stand in for a missing duration.
    expect(renderOutpatientEmrNarrative(history, { 时间单位: '天' }).map(part => part.text).join('')).toBe('时间单位：天');
  });

  it('preserves a custom section with inline prose, same-name slots, original values as text and no paper or action nodes', () => {
    const fields = [customField('first', '数值'), customField('last', '数值')];
    const source = '<header>姓名：敏感示例</header><section data-id="custom" data-article="观察" data-name="观察">'
      + '<h3>纸张标题</h3><div class="tag-article-title">观察：</div><div>先测'
      + '<span data-id="first" data-type="text">模板旧值</span>次。复测'
      + '<span data-id="last" data-type="text">模板旧值</span>次。'
      + '<button>保存</button><span data-id="action" data-type="import">导入病历</span>'
      + '<span hidden>隐藏文字</span><span style="visibility:hidden">不可见文字</span></div></section><footer>签名</footer>';
    const [section] = parseOutpatientEmrNarrative(source, [...fields].reverse());
    expect(section.title).toBe('观察');
    expect(section.directField).toBeNull();
    expect(idsOf(section.fields)).toEqual(['first', 'last']);
    const parts = renderOutpatientEmrNarrative(section, { first: '<b>3</b>', last: '4' });
    expect(parts.map(part => part.text).join('')).toBe('先测<b>3</b>次。复测4次。');
    expect(parts.filter(part => part.kind === 'field').map(part => part.field.id)).toEqual(['first', 'last']);
    expect(JSON.stringify(describeOutpatientEmrNarrative([section]))).not.toMatch(/姓名|敏感示例|纸张标题|模板旧值|导入病历|隐藏文字|不可见文字|签名/);
    const [single] = parseOutpatientEmrNarrative(source, [fields[0]]);
    expect(single.directField).toBeNull();
    expect(renderOutpatientEmrNarrative(single, { first: '2' }).map(part => part.text).join('')).toBe('先测2次。');
  });

  it('keeps the full attached guidance sentence and does not add template advice for an empty slot', () => {
    const parsed = parseOutpatientEmrTemplate(html, definition, ['注意事项文本']);
    const [section] = parseOutpatientEmrNarrative(parsed.sanitizedHtml, parsed.targetFields);
    expect(section.directField).toBeNull();
    expect(renderOutpatientEmrNarrative(section, { 注意事项文本: '合成指导。' }).map(part => part.text).join(''))
      .toBe('合成指导。本科随诊，告知若病情变化及时上级医院就诊。');
    expect(renderOutpatientEmrNarrative(section, {})).toEqual([]);
  });

  it('keeps leaf dictionary codes and renders their dictionary text in the sentence', () => {
    const parsed = parseOutpatientEmrTemplate(html, definition, ['痰声标志']);
    const [section] = parseOutpatientEmrNarrative(parsed.sanitizedHtml, parsed.targetFields);
    const input = { 痰声标志: '0' };
    expect(renderOutpatientEmrNarrative(section, input).map(part => part.text).join('')).toBe('无痰声。');
    expect(input.痰声标志).toBe('0');
  });

  it('retains a writable administrative field for review without copying the paper header or adding model context', () => {
    const field = { ...customField('页眉姓名', '姓名'), articleId: 'header', articleTemplateId: 'header', articleName: '页眉' };
    const source = '<header data-article="header" data-id="header">医师姓名：<span data-id="页眉姓名" data-type="text">示例姓名</span></header>';
    const [section] = parseOutpatientEmrNarrative(source, [field]);
    expect(section.fallback).toBe(true);
    expect(idsOf(section.fields)).toEqual(['页眉姓名']);
    expect(section.title).toBe('姓名');
    expect(renderOutpatientEmrNarrative(section, { 页眉姓名: '合成名字' }).map(part => part.text).join('')).toBe('合成名字');
    expect(describeOutpatientEmrNarrative([section])).toEqual([]);
  });

  it('preserves the displayed sentence while omitting visit identifiers prefilled in fixed text from the model', () => {
    const field = customField('note', '描述');
    const [section] = parseOutpatientEmrNarrative(
      '<p data-article="观察" data-id="custom">合成人甲（SYN-ID / SYN-VISIT）描述<span data-id="note" data-type="text"></span></p>', [field],
    );
    expect(renderOutpatientEmrNarrative(section, { note: '已记录' }).map(part => part.text).join('')).toContain('合成人甲');
    const grammar = JSON.stringify(describeOutpatientEmrNarrative([section], ['合成人甲', 'SYN-ID', 'SYN-VISIT']));
    expect(grammar).not.toMatch(/合成人甲|SYN-ID|SYN-VISIT/);
    expect(grammar).toContain('描述');
  });

  it('distinguishes an unadorned free-text section from a template with its own final punctuation', () => {
    const field = customField('narrative', '观察');
    const [section] = parseOutpatientEmrNarrative(
      '<section data-article="观察" data-id="custom"><span data-id="narrative" data-type="text"></span>。</section>', [field],
    );
    expect(section.directField).toBeNull();
    expect(renderOutpatientEmrNarrative(section, { narrative: '合成观察' }).map(part => part.text).join('')).toBe('合成观察。');
  });

  it('splits overrides by standard destination and retains unmapped fields under their own chapter identity', () => {
    const fields = [customField('chief', '主诉', 'chiefComplaint'), customField('extra', '病程补述')];
    const source = '<section data-id="custom" data-article="观察"><h3>HIS标题</h3>'
      + '<div><span data-id="extra" data-type="text"></span></div><div><span data-id="chief" data-type="text"></span></div></section>';
    const sections = parseOutpatientEmrNarrative(source, fields);
    expect(sections.map(section => section.recordField)).toEqual([null, 'chiefComplaint']);
    expect(sections[0].key).not.toBe(sections[1].key);
    expect(renderOutpatientEmrNarrativeSections(sections, { extra: '合成补述', chief: '合成主诉' })
      .map(part => part.text).join('')).toBe('合成补述\n合成主诉');
    expect(renderOutpatientEmrNarrativeSections(sections, { chief: '合成主诉' })
      .map(part => part.text).join('')).toBe('合成主诉');
    expect(sections.map(section => section.directField?.id)).toEqual(['extra', 'chief']);
  });
});


describe('the rendered HIS chapter document', () => {
  it('preserves actual chapters and headings for a partial target list, independent of target or JSON order', () => {
    const parsed = parseOutpatientEmrTemplate(html, definition, ['收缩压', '注意事项文本', '就诊时间', '痰声标志']);
    const chapters = buildOutpatientEmrDocument({ ...parsed, fields: [...parsed.fields].reverse() });
    const chapterIds = chapters.map(chapter => chapter.id);
    expect(chapterIds).toEqual(['主诉', '现病史', '既往史', '体格检查', '辅助检查', '门急诊诊断', '处理', '注意事项']);
    expect(chapters.find(chapter => chapter.id === '处理')?.title).toBe('医嘱');
    const exam = chapters.find(chapter => chapter.id === '体格检查')!;
    expect(exam.fields.find(item => item.field.id === '舒张压')?.editable).toBe(false);
    expect(exam.fields.find(item => item.field.id === '收缩压')?.editable).toBe(true);
    expect(renderOutpatientEmrNarrativeSections(exam.sections, { 舒张压: '不在授权范围', 收缩压: '120' })
      .map(part => part.text).join('')).toBe('收缩压：120mmHg');
    expect(chapters.flatMap(chapter => chapter.fields.filter(item => item.editable).map(item => item.field.id)))
      .toEqual(['痰声标志', '收缩压', '注意事项文本']);
    expect(chapters.find(chapter => chapter.id === '主诉')?.sections).toEqual([]);
  });

  it('distinguishes a full-body control from a single narrow text control or a unit-bound slot', () => {
    function chapter(fields: OutpatientEmrTemplateField[], suffix = '') {
      const html = '<section data-id="custom" data-article="观察">' + fields.map(field =>
        `<p><span data-id="${field.id}" data-type="text"></span>${suffix}</p>`).join('') + '</section>';
      return buildOutpatientEmrDocument({ sanitizedHtml: html, fields, targetFields: fields })[0];
    }
    for (const name of ['体重', '发病时间', '症状持续时间', '其他观察补充']) {
      expect(outpatientEmrChapterTextField(chapter([customField('narrow', name)]))).toBeUndefined();
    }
    const full = customField('body', '观察结果文本');
    expect(outpatientEmrChapterTextField(chapter([full, customField('duration', '持续时间')]))?.id).toBe('body');
    expect(outpatientEmrChapterTextField(chapter([full], '次。'))).toBeUndefined();
    expect(outpatientEmrChapterTextField(chapter([full, customField('other', '观察内容')]))).toBeUndefined();
  });

  it('preserves a single source sentence across standard mappings and omits clinical conclusions from read-only slots', () => {
    const first = customField('one', '测量', 'physicalExam');
    const last = customField('two', '测量');
    const readonly = { ...customField('prior', '受限项'), readonly: true, baselineValue: '模板预置阴性' };
    const result = buildOutpatientEmrDocument({
      sanitizedHtml: '<section data-id="custom" data-name="注册名" data-article="观察">'
        + '<span class="tag-article-title" hidden>旧标题</span><span class="tag-article-title"><i style="display:none">隐藏题注</i>源章标题：</span>'
        + '初测<span data-id="one" data-type="text"></span>后复测<span data-id="two" data-type="text"></span>次。'
        + '<span data-id="prior" data-type="text" data-readonly="true">模板预置阴性</span>'
        + '<span hidden>隐藏<span data-id="hidden" data-type="text"></span></span></section>'
        + '<p data-id="named" data-name="空观察章" data-article="观察">固定预置说明。</p>'
        + '<p hidden data-id="off" data-article="隐藏">禁止显示</p>',
      targetFields: [last, first], fields: [readonly, last, customField('hidden', '隐藏'), first],
    });
    expect(result.map(chapter => [chapter.id, chapter.title])).toEqual([['custom', '源章标题'], ['named', '空观察章']]);
    const [chapter] = result;
    expect(chapter.fields.map(item => [item.field.id, item.editable])).toEqual([['one', true], ['two', true], ['prior', false]]);
    expect(chapter.sections).toHaveLength(1);
    expect(chapter.sections[0].recordField).toBeNull();
    expect(renderOutpatientEmrNarrativeSections(chapter.sections, { one: '3', two: '4', prior: '预置阴性' })
      .map(part => part.text).join('')).toBe('初测3后复测4次。');
    expect(renderOutpatientEmrNarrativeSections(chapter.sections, {})).toEqual([]);
    expect(result[1].sections).toEqual([]);
  });

  it('retains both independent direct targets with identical captions and an ambiguous standard destination', () => {
    const chapters = [{ id: 'chapter-2', fieldId: 'field-B' }, { id: 'chapter-1', fieldId: 'field-A' }];
    const template = chapters.map(({ id, fieldId }) => `<section data-id="${id}" data-article="复查记录" data-name="复查记录">
      <span class="tag-article-title">复查记录：</span><span data-id="${fieldId}" data-type="text"
        data-name="记录" data-record-field="historyOfPresentIllness" data-readonly="false"></span></section>`).join('');
    const source = JSON.stringify([...chapters].reverse().map(({ id, fieldId }) => ({
      ID: id, NAME: '复查记录', ARTICLE: '复查记录',
      eles: [{ ID: fieldId, TYPE: 'text', NAME: '记录', RECORD_FIELD: 'historyOfPresentIllness', READONLY: false, VALUE: '', TEXT: '' }],
    })));
    const requested = ['field-A', 'field-B'];
    const parsed = parseOutpatientEmrTemplate(template, source, requested);
    expect(parsed.targetFields.map(field => field.id).sort()).toEqual(requested);
    expect(parsed.targetFields.every(field => field.recordField === null)).toBe(true);
    const restored = restoreOutpatientEmrTemplateFromSnapshot(template, parsed.fields, requested, source);
    for (const pair of [parsed, restored]) {
      const documentChapters = buildOutpatientEmrDocument(pair);
      expect(documentChapters.map(chapter => [chapter.id, chapter.title, chapter.fields[0].field.id]))
        .toEqual([['chapter-2', '复查记录', 'field-B'], ['chapter-1', '复查记录', 'field-A']]);
      expect(documentChapters.every(chapter => chapter.fields[0].editable)).toBe(true);
      expect(documentChapters.map(chapter => renderOutpatientEmrNarrativeSections(chapter.sections,
        { 'field-A': '第二章', 'field-B': '第一章' }).map(part => part.text).join(''))).toEqual(['第一章', '第二章']);
    }
  });
});
