// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildOutpatientEmrInitialDraft } from './outpatientEmrDraftSource';
import {
  buildEditableOutpatientEmrPreviewHtml,
  OutpatientEmrError,
  parseOutpatientEmrTemplate,
  restoreOutpatientEmrTemplateFromSnapshot,
} from './outpatientEmrTemplate';

const html = `
  <section data-id="article-history" data-article="既往史" data-name="既往史">
    <span
      data-id="肝炎史标志"
      data-name="肝炎史标志"
      data-type="select"
      data-readonly="false"
    ><span class="tag-value">否认</span></span>
    <span
      data-id="肝炎史补充"
      data-name="肝炎史补充"
      data-type="text"
      data-readonly="false"
      contenteditable="true"
    ><span class="tag-value"><span class="placeholder">请输入</span></span></span>
    <span data-id="action-visible" data-type="import">导入</span>
  </section>
  <section data-id="article-diagnosis" data-article="门急诊诊断" data-name="诊断">
    <span
      data-id="初步诊断内容"
      data-name="初步诊断内容"
      data-type="text"
      data-readonly="false"
    ><span class="tag-value">上呼吸道感染</span></span>
  </section>
`;

const definition = JSON.stringify([
  {
    ID: 'article-history',
    NAME: '既往史',
    ARTICLE: '既往史',
    eles: [
      {
        ID: '肝炎史标志',
        NAME: '肝炎史标志',
        TYPE: 'select',
        READONLY: false,
        VALUE: '0',
        TEXT: '否认',
        BINDINGDATA: [
          { VALUE: '', TEXT: ' ' },
          { VALUE: '0', TEXT: '否认' },
          { VALUE: '1', TEXT: '有' },
        ],
      },
      {
        ID: '肝炎史补充',
        NAME: '肝炎史补充',
        TYPE: 'text',
        READONLY: false,
        VALUE: '',
        TEXT: '',
      },
      {
        ID: 'action-visible',
        NAME: 'action-visible',
        TYPE: 'import',
      },
      {
        ID: 'action-definition-only',
        NAME: 'action-definition-only',
        TYPE: 'import',
      },
    ],
  },
  {
    ID: 'article-diagnosis',
    NAME: '初步诊断',
    ARTICLE: '门急诊诊断',
    eles: [
      {
        ID: '初步诊断内容',
        NAME: '初步诊断内容',
        TYPE: 'text',
        READONLY: false,
        VALUE: '',
        TEXT: '上呼吸道感染',
      },
    ],
  },
]);

function expectOutpatientError(action: () => unknown, code: string): void {
  expect(action).toThrowError(OutpatientEmrError);
  try {
    action();
  } catch (error) {
    expect((error as OutpatientEmrError).code).toBe(code);
  }
}

function changeDefinition(
  update: (value: Array<Record<string, unknown>>) => void,
): string {
  const value = JSON.parse(definition) as Array<Record<string, unknown>>;
  update(value);
  return JSON.stringify(value);
}

describe('parseOutpatientEmrTemplate template pair', () => {
  it('joins rendered layout and structured definitions by stable ids', () => {
    const result = parseOutpatientEmrTemplate(
      html,
      definition,
      ['肝炎史标志', '肝炎史补充', '初步诊断内容'],
    );

    expect(result.sanitizedHtml).toContain('data-id="article-history"');
    expect(result.sanitizedHtml).not.toContain('contenteditable');
    expect(result.fields).toHaveLength(3);
    expect(result.fields[0]).toEqual(expect.objectContaining({
      id: '肝炎史标志',
      articleTemplateId: 'article-history',
      articleId: '既往史',
      articleName: '既往史',
      articleDefinitionName: '既往史',
      baselineValue: '否认',
      baselineDictionaryValue: '0',
      dictionaryItems: [
        { value: '0', text: '否认' },
        { value: '1', text: '有' },
      ],
      recordField: 'pastMedicalHistory',
      projectionMode: 'section-compose',
    }));
    expect(result.fields[2]).toEqual(expect.objectContaining({
      articleName: '诊断',
      articleDefinitionName: '初步诊断',
    }));
    expect(Object.fromEntries(result.targetFields.map((field) => [field.id, buildOutpatientEmrInitialDraft(field).value]))).toEqual({
      肝炎史标志: '',
      肝炎史补充: '',
      初步诊断内容: '上呼吸道感染',
    });
  });

  it('restores target fields from a historical field snapshot without a definition parse', () => {
    const parsed = parseOutpatientEmrTemplate(
      html,
      definition,
      ['肝炎史标志', '肝炎史补充', '初步诊断内容'],
    );

    const restored = restoreOutpatientEmrTemplateFromSnapshot(
      html,
      parsed.fields,
      ['肝炎史补充', '肝炎史标志'],
    );

    expect(restored.sanitizedHtml).toBe(parsed.sanitizedHtml);
    expect(restored.fields).toEqual(parsed.fields);
    expect(restored.fields).not.toBe(parsed.fields);
    expect(restored.targetFields.map((field) => field.id)).toEqual([
      '肝炎史标志',
      '肝炎史补充',
    ]);
    expectOutpatientError(() => restoreOutpatientEmrTemplateFromSnapshot(
      html,
      parsed.fields,
      ['unknown'],
    ), 'INVALID_TARGET_FIELD_IDS');
  });

  it('isolates unmatched import actions from the paired clinical targets', () => {
    expect(() => parseOutpatientEmrTemplate(
      html.replace('<span data-id="action-visible" data-type="import">导入</span>', ''),
      definition,
      ['肝炎史补充'],
    )).not.toThrow();

    const result = parseOutpatientEmrTemplate(html.replace('action-visible', 'unknown-action'), definition, ['肝炎史补充']);
    expect(result.targetFields.map(field => field.id)).toEqual(['肝炎史补充']);
  });

  it.each([
    ['missing HTML field', html.replace(/<span\s+data-id="肝炎史补充"[\s\S]*?<\/span><\/span>/, '')],
    ['field name mismatch', html.replace('data-name="肝炎史补充"', 'data-name="其他名称"')],
  ])('rejects an unpairable sole target: %s', (_label, changedHtml) => {
    expectOutpatientError(() => parseOutpatientEmrTemplate(changedHtml, definition, ['肝炎史补充']), 'TEMPLATE_PAIR_MISMATCH');
  });

  it.each([
    ['extra HTML field', html.replace(
      '</section>',
      '<span data-id="extra" data-name="extra" data-type="text" data-readonly="false"></span></section>',
    )],
    ['field type mismatch', html.replace('data-type="select"', 'data-type="radio"')],
    ['field readonly mismatch', html.replace('data-readonly="false"', 'data-readonly="true"')],
    ['field value mismatch', html.replace('上呼吸道感染', '肺炎')],
    ['article id mismatch', html.replace('data-article="门急诊诊断"', 'data-article="诊断"')],
  ])('retains a paired target alongside an independent %s', (_label, changedHtml) => {
    const result = parseOutpatientEmrTemplate(changedHtml, definition, ['肝炎史补充']);
    expect(result.targetFields.map(field => field.id)).toEqual(['肝炎史补充']);
  });

  it('rejects dictionary VALUE/TEXT that do not resolve to one defined item', () => {
    const changed = changeDefinition((articles) => {
      const field = (articles[0].eles as Array<Record<string, unknown>>)[0];
      field.TEXT = '未知';
    });
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(html, changed, ['肝炎史标志']),
      'TEMPLATE_PAIR_MISMATCH',
    );
  });

  it('requires non-import HTML identity attributes instead of filling defaults', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(
        html.replace(' data-name="肝炎史补充"', ''),
        definition,
        ['肝炎史补充'],
      ),
      'INVALID_TEMPLATE_JSON',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(
        html.replace(' data-readonly="false"', ''),
        definition,
        ['肝炎史标志'],
      ),
      'INVALID_TEMPLATE_JSON',
    );
  });

  it('rejects a single-source or wrapped JSON contract', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate('', definition, ['肝炎史补充']),
      'TEMPLATE_PAIR_MISMATCH',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(html, JSON.stringify({ articles: [] }), ['肝炎史补充']),
      'INVALID_TEMPLATE_JSON',
    );
  });

  it('treats targetFieldIds as the exact renderer-authoritative writable set', () => {
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(html, definition, []),
      'NO_SUPPORTED_TEMPLATE_FIELDS',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(html, definition, ['肝炎史补充', '肝炎史补充']),
      'INVALID_TARGET_FIELD_IDS',
    );
    expectOutpatientError(
      () => parseOutpatientEmrTemplate(html, definition, ['unknown']),
      'INVALID_TARGET_FIELD_IDS',
    );
  });

  it('uses JSON mapping extensions and rejects HTML-only mapping fallbacks', () => {
    const mappedDefinition = changeDefinition((articles) => {
      const field = (articles[0].eles as Array<Record<string, unknown>>)[1];
      field.RECORD_FIELD = 'personalHistory';
    });
    const mappedHtml = html.replace(
      'data-id="肝炎史补充"',
      'data-id="肝炎史补充" data-record-field="personalHistory"',
    );
    expect(parseOutpatientEmrTemplate(
      mappedHtml,
      mappedDefinition,
      ['肝炎史补充'],
    ).targetFields[0]).toEqual(expect.objectContaining({
      recordField: 'personalHistory',
      mappingSource: 'definition-record-field',
      projectionMode: 'direct',
    }));

    expectOutpatientError(
      () => parseOutpatientEmrTemplate(mappedHtml, definition, ['肝炎史补充']),
      'TEMPLATE_PAIR_MISMATCH',
    );
  });

  it('builds edits on the real sanitized HTML layout', () => {
    const parsed = parseOutpatientEmrTemplate(
      html,
      definition,
      ['肝炎史标志', '肝炎史补充'],
    );
    const preview = buildEditableOutpatientEmrPreviewHtml(
      parsed.sanitizedHtml,
      parsed.targetFields,
      { 肝炎史标志: '', 肝炎史补充: '医生补充' },
    );
    expect(preview).toContain('outpatient-emr-dictionary-select');
    expect(preview).toContain('医生补充');
    expect(preview).toContain('data-id="article-diagnosis"');
  });

  it('marks each preview field with its draft source for doctor review', () => {
    const parsed = parseOutpatientEmrTemplate(
      html,
      definition,
      ['肝炎史标志', '肝炎史补充'],
    );
    const container = document.createElement('div');
    container.innerHTML = buildEditableOutpatientEmrPreviewHtml(
      parsed.sanitizedHtml,
      parsed.targetFields,
      { 肝炎史标志: '', 肝炎史补充: '模板补充' },
      true,
      { 肝炎史标志: 'empty', 肝炎史补充: 'template' },
    );

    const detail = container.querySelector('[data-outpatient-emr-field-id="肝炎史补充"]');
    expect(detail?.getAttribute('data-outpatient-emr-source')).toBe('template');
    expect(detail?.getAttribute('title')).toBe('模板预置，未经本次病例核对');
    const flag = container.querySelector('select[data-outpatient-emr-field-id="肝炎史标志"]');
    expect(flag?.getAttribute('data-outpatient-emr-source')).toBe('empty');
  });

  it('marks conflicting flag/detail fields over their source label', () => {
    const parsed = parseOutpatientEmrTemplate(
      html,
      definition,
      ['肝炎史标志', '肝炎史补充'],
    );
    const container = document.createElement('div');
    container.innerHTML = buildEditableOutpatientEmrPreviewHtml(
      parsed.sanitizedHtml,
      parsed.targetFields,
      { 肝炎史标志: '有', 肝炎史补充: '否认肝炎史' },
      true,
      { 肝炎史标志: 'ai', 肝炎史补充: 'template-matched' },
      new Set(['肝炎史标志', '肝炎史补充']),
    );

    const detail = container.querySelector('[data-outpatient-emr-field-id="肝炎史补充"]');
    expect(detail?.getAttribute('data-outpatient-emr-issue')).toBe('conflict');
    expect(detail?.getAttribute('data-outpatient-emr-source')).toBe('template-matched');
    expect(detail?.getAttribute('title')).toContain('矛盾');
  });
});
