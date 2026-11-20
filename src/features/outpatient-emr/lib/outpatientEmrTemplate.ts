import { isAdministrativeTemplateSlot } from './outpatientEmrPromptGenerator';
import { sanitizeExternalHtml } from '@shared/lib/safeHtml';
import {
  findConflictingOutpatientEmrRecordFieldMapping,
  isOutpatientEmrRecordField,
  resolveOutpatientEmrFieldMapping,
} from './outpatientEmrFieldMapping';
import {
  isOutpatientEmrDictionaryFieldType,
  resolveOutpatientEmrDictionaryItem,
  resolveOutpatientEmrFinalDictionaryItem,
} from './outpatientEmrDictionary';
import {
  parseOutpatientEmrTemplateDefinition,
  isTemplateObject,
  readOutpatientEmrChapters,
  OutpatientEmrTemplateDefinitionError,
  type OutpatientEmrTemplateDefinition,
  type OutpatientEmrTemplateDefinitionField,
} from './outpatientEmrTemplateDefinition';
import type {
  OutpatientEmrErrorCode,
  OutpatientEmrFieldValueSource,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateInspectionResult,
  OutpatientEmrTemplateParseResult,
  OutpatientEmrTemplateSourceNote,
} from '../types';

export class OutpatientEmrError extends Error {
  constructor(
    public readonly code: OutpatientEmrErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OutpatientEmrError';
  }
}

interface HtmlTemplateArticle {
  element: HTMLElement;
  templateId: string;
  articleId: string;
  name: string;
  recordField?: string;
}

interface HtmlTemplateField {
  id: string;
  name: string;
  type: string;
  articleTemplateId: string;
  articleId: string;
  readonly: boolean;
  aiSuitable?: boolean;
  recordField?: string;
  renderedValue: string;
}

interface HtmlTemplateImport {
  id: string;
  type: string;
  articleTemplateId: string;
  articleId: string;
}

interface HtmlTemplateInspection {
  sanitizedHtml: string;
  articles: HtmlTemplateArticle[];
  fields: HtmlTemplateField[];
  imports: HtmlTemplateImport[];
}

function pairMismatch(message: string): never {
  throw new OutpatientEmrError('TEMPLATE_PAIR_MISMATCH', message);
}

function createTemplateFragment(html: string): HTMLTemplateElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template;
}

function readRequiredExactDataAttribute(
  element: HTMLElement,
  name: string,
  description: string,
): string {
  const value = element.getAttribute(name);
  if (value !== null && value.length > 0 && value === value.trim()) return value;
  throw new OutpatientEmrError(
    'INVALID_TEMPLATE_JSON',
    `${description} ${name} 必须是无首尾空白的非空字符串。`,
  );
}

function readOptionalExactDataAttribute(
  element: HTMLElement,
  name: string,
  description: string,
): string | undefined {
  if (!element.hasAttribute(name)) return undefined;
  return readRequiredExactDataAttribute(element, name, description);
}

function readRequiredBooleanDataAttribute(
  element: HTMLElement,
  name: string,
  description: string,
): boolean {
  if (!element.hasAttribute(name)) {
    throw new OutpatientEmrError(
      'INVALID_TEMPLATE_JSON',
      `${description}必须显式声明 ${name}。`,
    );
  }
  const value = element.getAttribute(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new OutpatientEmrError(
    'INVALID_TEMPLATE_JSON',
    `${description} ${name} 只能精确使用 true 或 false。`,
  );
}

function readOptionalBooleanDataAttribute(
  element: HTMLElement,
  name: string,
  description: string,
): boolean | undefined {
  if (!element.hasAttribute(name)) return undefined;
  return readRequiredBooleanDataAttribute(element, name, description);
}

function resolveFieldValueElement(element: HTMLElement): HTMLElement {
  if (element.matches('.tag-value')) return element;
  return element.querySelector<HTMLElement>('.tag-value') || element;
}

export function readFieldSourceText(element: HTMLElement, visibleClinicalText = false): string {
  const clone = element.cloneNode(true) as HTMLElement;
  if (visibleClinicalText) clone.querySelectorAll('[aria-hidden="true"], .tag-marker, header, footer, nav, button, template').forEach(child => child.remove());
  clone.querySelectorAll('[data-id], [data-article], .placeholder, [hidden]').forEach(child => child.remove());
  clone.querySelectorAll<HTMLElement>('[style]').forEach(child => {
    if (HIDDEN_STYLE_PATTERN.test(child.getAttribute('style') || '')) child.remove();
  });
  return resolveFieldValueElement(clone).textContent || '';
}

function readFieldValue(element: HTMLElement): string {
  return readFieldSourceText(element).replace(/\r\n?/g, '\n').trim();
}

function normalizeTemplateForPreview(template: HTMLTemplateElement): void {
  template.content.querySelectorAll('[contenteditable], [tabindex]').forEach((element) => {
    element.removeAttribute('contenteditable');
    element.removeAttribute('tabindex');
  });
  template.content.querySelectorAll('[data-outpatient-emr-field-id]').forEach((element) => {
    element.removeAttribute('data-outpatient-emr-field-id');
  });
}

function prepareOutpatientEmrTemplatePreview(
  templateHtml: string,
): HTMLTemplateElement {
  if (typeof templateHtml !== 'string' || !templateHtml.trim()) {
    pairMismatch('templateHtml 必须是非空 HTML 字符串。');
  }
  const sanitizedHtml = sanitizeExternalHtml(templateHtml);
  if (!sanitizedHtml) pairMismatch('templateHtml 净化后为空。');

  const template = createTemplateFragment(sanitizedHtml);
  normalizeTemplateForPreview(template);
  template.content.querySelectorAll('img[src]').forEach((element) => element.removeAttribute('src'));
  return template;
}

function findArticleElement(field: HTMLElement): HTMLElement {
  const article = field.closest<HTMLElement>('[data-article]');
  if (!article || article === field) {
    pairMismatch(`HTML 字段 ${field.getAttribute('data-id') || '未知'} 未归属到模板章节。`);
  }
  return article;
}

function inspectHtmlTemplate(templateHtml: string): HtmlTemplateInspection {
  const template = prepareOutpatientEmrTemplatePreview(templateHtml);

  const articles: HtmlTemplateArticle[] = [];
  const articleIds = new Set<string>();
  template.content.querySelectorAll<HTMLElement>('[data-article]').forEach((element) => {
    const templateId = readRequiredExactDataAttribute(element, 'data-id', 'HTML 模板章节');
    const articleId = readRequiredExactDataAttribute(
      element,
      'data-article',
      `HTML 模板章节 ${templateId}`,
    );
    const name = readRequiredExactDataAttribute(
      element,
      'data-name',
      `HTML 模板章节 ${templateId}`,
    );
    if (articleIds.has(templateId)) pairMismatch(`HTML 模板章节 ID 重复：${templateId}`);
    articleIds.add(templateId);
    const recordField = readOptionalExactDataAttribute(
      element,
      'data-record-field',
      `HTML 模板章节 ${templateId}`,
    );
    articles.push({
      element,
      templateId,
      articleId,
      name,
      ...(recordField ? { recordField } : {}),
    });
  });

  const articleByElement = new Map(articles.map((article) => [article.element, article]));
  const fields: HtmlTemplateField[] = [];
  const imports: HtmlTemplateImport[] = [];
  const fieldIds = new Set<string>();

  template.content.querySelectorAll<HTMLElement>('[data-id][data-type]').forEach((element) => {
    const id = readRequiredExactDataAttribute(element, 'data-id', 'HTML 模板字段');
    const type = readRequiredExactDataAttribute(element, 'data-type', `HTML 模板字段 ${id}`);
    if (fieldIds.has(id)) {
      throw new OutpatientEmrError('DUPLICATE_TEMPLATE_FIELD', `HTML 模板字段 ID 重复：${id}`);
    }
    fieldIds.add(id);

    const articleElement = findArticleElement(element);
    const article = articleByElement.get(articleElement);
    if (!article) pairMismatch(`HTML 字段 ${id} 所属章节不是可配对的章节节点。`);

    if (type.toLowerCase() === 'import') {
      imports.push({
        id,
        type,
        articleTemplateId: article.templateId,
        articleId: article.articleId,
      });
      return;
    }

    const name = readRequiredExactDataAttribute(element, 'data-name', `HTML 模板字段 ${id}`);
    const readonly = readRequiredBooleanDataAttribute(
      element,
      'data-readonly',
      `HTML 模板字段 ${id}`,
    );
    const aiSuitable = readOptionalBooleanDataAttribute(
      element,
      'data-ai-suitable',
      `HTML 模板字段 ${id}`,
    );
    const recordField = readOptionalExactDataAttribute(
      element,
      'data-record-field',
      `HTML 模板字段 ${id}`,
    );
    fields.push({
      id,
      name,
      type,
      articleTemplateId: article.templateId,
      articleId: article.articleId,
      readonly,
      ...(aiSuitable === undefined ? {} : { aiSuitable }),
      ...(recordField ? { recordField } : {}),
      renderedValue: readFieldValue(element),
    });
  });

  return { sanitizedHtml: template.innerHTML, articles, fields, imports };
}

function assertOptionalExtensionMatch(
  htmlValue: string | boolean | undefined,
  definitionValue: string | boolean | undefined,
  label: string,
): void {
  if (htmlValue === undefined) return;
  if (definitionValue === undefined || htmlValue !== definitionValue) {
    pairMismatch(`${label} 在 HTML 与结构定义中不一致。`);
  }
}

function validateRecordField(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (!isOutpatientEmrRecordField(value)) {
    throw new OutpatientEmrError(
      'INVALID_RECORD_FIELD_MAPPING',
      `${label}的 RECORD_FIELD 无效：${value}`,
    );
  }
  return value;
}

function assertArticlesMatch(
  html: HtmlTemplateInspection,
  definition: OutpatientEmrTemplateDefinition,
): void {
  const htmlById = new Map(html.articles.map((article) => [article.templateId, article]));
  const definitionById = new Map(
    definition.articles.map((article) => [article.templateId, article]),
  );
  if (htmlById.size !== definitionById.size) {
    pairMismatch(
      `模板章节数量不一致：HTML ${htmlById.size} 个，结构定义 ${definitionById.size} 个。`,
    );
  }
  definition.articles.forEach((article) => {
    const rendered = htmlById.get(article.templateId);
    if (!rendered) pairMismatch(`HTML 缺少结构定义章节 ${article.templateId}。`);
    if (rendered.articleId !== article.articleId) {
      pairMismatch(`模板章节 ${article.templateId} 的 ARTICLE 不一致。`);
    }
    assertOptionalExtensionMatch(
      rendered.recordField,
      article.recordField,
      `模板章节 ${article.templateId} 的 RECORD_FIELD`,
    );
    validateRecordField(article.recordField, `模板章节 ${article.templateId}`);
  });
  html.articles.forEach((article) => {
    if (!definitionById.has(article.templateId)) {
      pairMismatch(`HTML 包含结构定义中不存在的章节 ${article.templateId}。`);
    }
  });
}

function assertImportsMatch(
  html: HtmlTemplateInspection,
  definition: OutpatientEmrTemplateDefinition,
): void {
  const definitionById = new Map(definition.imports.map((item) => [item.id, item]));
  html.imports.forEach((item) => {
    const defined = definitionById.get(item.id);
    if (
      !defined
      || defined.type !== item.type
      || defined.articleTemplateId !== item.articleTemplateId
      || defined.articleId !== item.articleId
    ) {
      pairMismatch(`HTML 动作元素 ${item.id} 未命中同一结构定义。`);
    }
  });
}

function resolveDefinitionBaselineDictionaryItem(
  field: OutpatientEmrTemplateDefinitionField,
) {
  const byValue = field.value
    ? resolveOutpatientEmrDictionaryItem(field.dictionaryItems, field.value)
    : null;
  const byText = field.text
    ? resolveOutpatientEmrDictionaryItem(field.dictionaryItems, field.text)
    : null;
  if (field.value && !byValue) {
    pairMismatch(`结构定义字段 ${field.id} 的当前 VALUE 未命中字典项。`);
  }
  if (field.text && !byText) {
    pairMismatch(`结构定义字段 ${field.id} 的当前 TEXT 未命中字典项。`);
  }
  if (byValue && byText && byValue !== byText) {
    pairMismatch(`结构定义字段 ${field.id} 的当前 VALUE/TEXT 未命中同一个字典项。`);
  }
  return byValue || byText;
}

function buildPairedFields(
  html: HtmlTemplateInspection,
  definition: OutpatientEmrTemplateDefinition,
): OutpatientEmrTemplateField[] {
  const htmlById = new Map(html.fields.map((field) => [field.id, field]));
  const definitionById = new Map(definition.fields.map((field) => [field.id, field]));
  const renderedArticleById = new Map(
    html.articles.map((article) => [article.templateId, article]),
  );
  const definitionArticleById = new Map(
    definition.articles.map((article) => [article.templateId, article]),
  );
  if (htmlById.size !== definitionById.size) {
    pairMismatch(
      `模板可回填字段数量不一致：HTML ${htmlById.size} 个，结构定义 ${definitionById.size} 个。`,
    );
  }

  const fields = definition.fields.map((defined) => {
    const rendered = htmlById.get(defined.id);
    if (!rendered) pairMismatch(`HTML 缺少结构定义字段 ${defined.id}。`);
    if (
      rendered.type !== defined.type
      || rendered.name !== defined.name
      || rendered.readonly !== defined.readonly
      || rendered.articleTemplateId !== defined.articleTemplateId
      || rendered.articleId !== defined.articleId
    ) {
      pairMismatch(`模板字段 ${defined.id} 的类型、名称、只读状态或所属章节不一致。`);
    }
    if (rendered.renderedValue !== defined.text) {
      pairMismatch(`模板字段 ${defined.id} 的 HTML 当前值与结构定义 TEXT 不一致。`);
    }
    assertOptionalExtensionMatch(
      rendered.recordField,
      defined.recordField,
      `模板字段 ${defined.id} 的 RECORD_FIELD`,
    );
    assertOptionalExtensionMatch(
      rendered.aiSuitable,
      defined.aiSuitable,
      `模板字段 ${defined.id} 的 AI_SUITABLE`,
    );

    const fieldRecordField = validateRecordField(defined.recordField, `模板字段 ${defined.id}`);
    const definitionArticle = definitionArticleById.get(defined.articleTemplateId)!;
    const articleRecordField = validateRecordField(
      definitionArticle.recordField,
      `模板章节 ${defined.articleTemplateId}`,
    );
    const renderedArticle = renderedArticleById.get(defined.articleTemplateId)!;
    const mapping = resolveOutpatientEmrFieldMapping({
      fieldId: defined.id,
      fieldName: defined.name,
      articleId: defined.articleId,
      articleName: renderedArticle.name,
      articleDefinitionName: defined.articleDefinitionName,
      ...(fieldRecordField ? { explicitRecordField: fieldRecordField } : {}),
      ...(articleRecordField ? { explicitArticleRecordField: articleRecordField } : {}),
    });
    const baselineDictionaryItem = defined.dictionaryItems.length > 0
      ? resolveDefinitionBaselineDictionaryItem(defined)
      : null;

    return {
      id: defined.id,
      name: defined.name,
      type: defined.type,
      articleTemplateId: defined.articleTemplateId,
      articleId: defined.articleId,
      articleName: renderedArticle.name,
      articleDefinitionName: defined.articleDefinitionName,
      readonly: defined.readonly,
      aiSuitable: !defined.readonly && (defined.aiSuitable ?? false),
      baselineValue: baselineDictionaryItem?.text || defined.text,
      baselineDictionaryValue: baselineDictionaryItem?.value || defined.value,
      dictionaryItems: defined.dictionaryItems.map((item) => ({ ...item })),
      ...mapping,
    };
  });

  html.fields.forEach((field) => {
    if (!definitionById.has(field.id)) {
      pairMismatch(`HTML 包含结构定义中不存在的字段 ${field.id}。`);
    }
  });
  return fields;
}

// Strictly pairs one rendered HTML instance with the JSON definition of the same template.
function inspectOutpatientEmrTemplate(
  templateHtml: string,
  templateDefinition: string,
): OutpatientEmrTemplateInspectionResult {
  let definition: OutpatientEmrTemplateDefinition;
  try {
    definition = parseOutpatientEmrTemplateDefinition(templateDefinition);
  } catch (cause) {
    if (cause instanceof OutpatientEmrTemplateDefinitionError) {
      throw new OutpatientEmrError(cause.code, cause.message);
    }
    throw cause;
  }
  const html = inspectHtmlTemplate(templateHtml);
  assertArticlesMatch(html, definition);
  assertImportsMatch(html, definition);
  return {
    sanitizedHtml: html.sanitizedHtml,
    fields: buildPairedFields(html, definition),
  };
}

const HIDDEN_STYLE_PATTERN = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?:;|$)/iu;

function isHiddenByRenderer(element: Element, root: Node): boolean {
  let current: Element | null = element;
  while (current && current !== root) {
    if (current.hasAttribute('hidden')) return true;
    if (HIDDEN_STYLE_PATTERN.test(current.getAttribute('style') || '')) return true;
    current = current.parentElement;
  }
  return false;
}

type TemplateObject = Record<string, unknown>;

function groupById<T>(items: T[], identifier: (item: T) => unknown): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = identifier(item);
    if (typeof id !== 'string' || !id) continue;
    const group = groups.get(id);
    if (group) group.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

function definitionLeaves(chapters: TemplateObject[]) {
  return chapters.flatMap(chapter => Array.isArray(chapter.eles)
    ? chapter.eles.filter(isTemplateObject).map(leaf => ({ chapter, leaf })) : []);
}

/** On a malformed pair, check each uniquely identified field against its own two source nodes. */
function recoverIndependentFields(templateHtml: string, definitionSource: string): OutpatientEmrTemplateInspectionResult {
  const preview = prepareOutpatientEmrTemplatePreview(templateHtml);
  const chapters = readOutpatientEmrChapters(definitionSource).filter(isTemplateObject);
  const htmlChapters = groupById(Array.from(preview.content.querySelectorAll<HTMLElement>('[data-article]')), el => el.dataset.id);
  const htmlFields = groupById(Array.from(preview.content.querySelectorAll<HTMLElement>('[data-id][data-type]')), el => el.dataset.id);
  const definitionChapters = groupById(chapters, chapter => chapter.ID);
  const definitionFields = groupById(definitionLeaves(chapters), item => item.leaf.ID);
  const fields: OutpatientEmrTemplateField[] = [];

  for (const [id, matches] of definitionFields) {
    const { chapter, leaf } = matches[0];
    const elements = htmlFields.get(id);
    if (matches.length !== 1 || elements?.length !== 1 || typeof chapter.ID !== 'string') continue;
    const owners = htmlChapters.get(chapter.ID);
    if (definitionChapters.get(chapter.ID)?.length !== 1 || owners?.length !== 1
      || elements[0].closest('[data-article]') !== owners[0]) continue;
    const section = owners[0].cloneNode(false) as HTMLElement;
    section.appendChild(elements[0].cloneNode(true));
    try {
      const partial = inspectOutpatientEmrTemplate(section.outerHTML, JSON.stringify([{ ...chapter, eles: [leaf] }]));
      fields.push(...partial.fields);
    } catch (error) {
      if (!(error instanceof OutpatientEmrError)) throw error;
    }
  }
  return { sanitizedHtml: preview.innerHTML, fields };
}

function clinicalScalar(value: unknown): string | number | boolean | null | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
}

function isProtectedDefinitionSlot(chapter: TemplateObject, leaf: TemplateObject): boolean {
  const labels = [chapter.ID, chapter.ARTICLE, chapter.NAME].filter((value): value is string => typeof value === 'string');
  return leaf.READONLY === true || leaf.READONLY === 'true' || leaf.HIDDEN === true || leaf.HIDDEN === 'true'
    || isOutpatientEmrDictionaryFieldType(typeof leaf.TYPE === 'string' ? leaf.TYPE : '')
    || (Array.isArray(leaf.BINDINGDATA) && leaf.BINDINGDATA.length > 0)
    || isAdministrativeTemplateSlot(String(leaf.ID), typeof leaf.NAME === 'string' ? leaf.NAME : '', labels);
}

function getTemplateFieldError(code: OutpatientEmrErrorCode, id: string): OutpatientEmrError {
  return new OutpatientEmrError(code, `模板字段 ${id} 无法作为本次可回填目标。`);
}

function selectPairedTargets(
  inspection: OutpatientEmrTemplateInspectionResult,
  targetFieldIds: string[],
  definitionSource?: string,
  pairingError?: OutpatientEmrError,
): OutpatientEmrTemplateParseResult {
  if (!Array.isArray(targetFieldIds) || !targetFieldIds.length) {
    throw new OutpatientEmrError('NO_SUPPORTED_TEMPLATE_FIELDS', 'HIS 模板渲染器未提供当前有效字段。');
  }
  if (targetFieldIds.some(id => typeof id !== 'string' || !id || id !== id.trim())
    || new Set(targetFieldIds).size !== targetFieldIds.length) {
    throw new OutpatientEmrError('INVALID_TARGET_FIELD_IDS', 'targetFieldIds 必须为无首尾空白且不重复的字段 ID。');
  }
  const fragment = createTemplateFragment(inspection.sanitizedHtml).content;
  const rendered = groupById(Array.from(fragment.querySelectorAll<HTMLElement>('[data-id]:not([data-article])')), el => el.dataset.id);
  const fieldErrors = new Map<string, OutpatientEmrErrorCode>();
  let fields = inspection.fields.filter(field => {
    if (!isOutpatientEmrDictionaryFieldType(field.type) || field.dictionaryItems.length) return true;
    fieldErrors.set(field.id, 'MISSING_DICTIONARY_DEFINITION');
    return false;
  });
  // A partial snapshot must also be valid when another request selects different targets.
  let conflict = findConflictingOutpatientEmrRecordFieldMapping(fields);
  while (conflict) {
    const conflicts = new Set(conflict.fieldIds);
    // The HIS field IDs still identify separate writable slots. Only their standard projection is ambiguous.
    fields = fields.map(field => conflicts.has(field.id)
      ? { ...field, recordField: null, mappingSource: 'unmapped', projectionMode: null }
      : field);
    conflict = findConflictingOutpatientEmrRecordFieldMapping(fields);
  }

  const byId = new Map(fields.map(field => [field.id, field]));
  const selected = new Set<string>();
  const notes: OutpatientEmrTemplateSourceNote[] = [];
  let firstError = pairingError;
  let leaves: ReturnType<typeof definitionLeaves> | undefined;
  for (const id of targetFieldIds) {
    const elements = rendered.get(id);
    const field = byId.get(id);
    const visible = elements?.length === 1 && !isHiddenByRenderer(elements[0], fragment);
    if (visible && field && elements[0].dataset.type === field.type && elements[0].dataset.readonly === 'false' && !field.readonly) {
      selected.add(id);
      continue;
    }
    firstError ??= getTemplateFieldError(fieldErrors.get(id) || 'INVALID_TARGET_FIELD_IDS', id);
    if (elements?.length === 1 && !visible) {
      notes.push({ fieldId: id, reason: 'hidden' });
      continue;
    }
    const note: OutpatientEmrTemplateSourceNote = { fieldId: id, reason: 'unavailable' };
    // Keep the authorized clinical text from both sources even if their metadata disagree.
    // Administrative identities, dictionary presets and hidden slots stay out of model evidence.
    const element = elements?.[0];
    const section = element?.closest<HTMLElement>('[data-article]');
    if (visible && element && section && element.dataset.readonly === 'false'
      && !isOutpatientEmrDictionaryFieldType(element.dataset.type || '')
      && !isAdministrativeTemplateSlot(id, element.dataset.name || '', [section.dataset.id, section.dataset.article, section.dataset.name])) {
      if (definitionSource) leaves ??= definitionLeaves(readOutpatientEmrChapters(definitionSource).filter(isTemplateObject));
      const identified = (leaves || []).filter(item => item.leaf.ID === id);
      if (!identified.some(({ chapter, leaf }) => isProtectedDefinitionSlot(chapter, leaf))) {
        note.htmlText = readFieldSourceText(element);
        note.definitionValues = identified.filter(item => item.chapter.ID === section.dataset.id)
          .map(({ leaf }) => ({
            name: typeof leaf.NAME === 'string' ? leaf.NAME : undefined,
            text: clinicalScalar(leaf.TEXT),
            value: clinicalScalar(leaf.VALUE),
          }));
      }
    }
    notes.push(note);
  }
  if (!selected.size) throw firstError || new OutpatientEmrError('NO_SUPPORTED_TEMPLATE_FIELDS', '当前模板没有可确认的可见字段。');
  return {
    ...inspection, fields,
    targetFields: fields.filter(field => selected.has(field.id)),
    ...(notes.length ? { templateSourceNotes: notes } : {}),
  };
}

export function parseOutpatientEmrTemplate(
  templateHtml: string,
  templateDefinition: string,
  targetFieldIds: string[],
): OutpatientEmrTemplateParseResult {
  let inspection: OutpatientEmrTemplateInspectionResult;
  let pairingError: OutpatientEmrError | undefined;
  try {
    inspection = inspectOutpatientEmrTemplate(templateHtml, templateDefinition);
  } catch (error) {
    if (!(error instanceof OutpatientEmrError)) throw error;
    pairingError = error;
    try {
      inspection = recoverIndependentFields(templateHtml, templateDefinition);
    } catch (cause) {
      if (cause instanceof OutpatientEmrTemplateDefinitionError) throw error;
      throw cause;
    }
  }
  return selectPairedTargets(inspection, targetFieldIds, templateDefinition, pairingError);
}

function cloneOutpatientEmrTemplateField(
  field: OutpatientEmrTemplateField,
): OutpatientEmrTemplateField {
  return {
    ...field,
    dictionaryItems: field.dictionaryItems.map((item) => ({ ...item })),
  };
}

export function restoreOutpatientEmrTemplateFromSnapshot(
  templateHtml: string,
  snapshotFields: OutpatientEmrTemplateField[],
  targetFieldIds: string[],
  templateDefinition?: string,
): OutpatientEmrTemplateParseResult {
  const fields = snapshotFields.map(cloneOutpatientEmrTemplateField);
  const sanitizedHtml = prepareOutpatientEmrTemplatePreview(templateHtml).innerHTML;
  return selectPairedTargets({ sanitizedHtml, fields }, targetFieldIds, templateDefinition);
}

export const OUTPATIENT_EMR_FIELD_SOURCE_LABELS: Readonly<
  Record<OutpatientEmrFieldValueSource, string>
> = {
  template: '模板预置，未经本次病例核对',
  'template-matched': '模板预置，模型判定与本次病例一致，请核对',
  'unmentioned-default': '本次未提及，按默认值填写',
  ai: 'AI 依据本次病例生成',
  structured: '来自已确认的结构化病历',
  his: '来自 HIS 原值',
  doctor: '医生已修改',
  empty: '待填写',
};

export const OUTPATIENT_EMR_FIELD_CONFLICT_LABEL = '与同组标志矛盾，请修改其中一项';

export function applyOutpatientEmrFieldSource(
  element: HTMLElement,
  source: OutpatientEmrFieldValueSource | undefined,
  conflict = false,
): void {
  if (conflict) {
    element.setAttribute('data-outpatient-emr-issue', 'conflict');
    element.setAttribute('aria-invalid', 'true');
  } else {
    element.removeAttribute('data-outpatient-emr-issue');
    element.removeAttribute('aria-invalid');
  }
  if (!source) {
    element.removeAttribute('data-outpatient-emr-source');
    if (conflict) {
      element.setAttribute('title', OUTPATIENT_EMR_FIELD_CONFLICT_LABEL);
    } else {
      element.removeAttribute('title');
    }
    return;
  }
  element.setAttribute('data-outpatient-emr-source', source);
  element.setAttribute(
    'title',
    conflict ? OUTPATIENT_EMR_FIELD_CONFLICT_LABEL : OUTPATIENT_EMR_FIELD_SOURCE_LABELS[source],
  );
}

export function buildEditableOutpatientEmrPreviewHtml(
  sanitizedHtml: string,
  editableFields: OutpatientEmrTemplateField[],
  fieldValues: Record<string, string>,
  editable = true,
  fieldSources: Readonly<Record<string, OutpatientEmrFieldValueSource>> = {},
  conflictFieldIds: ReadonlySet<string> = new Set(),
): string {
  const template = createTemplateFragment(sanitizeExternalHtml(sanitizedHtml));
  normalizeTemplateForPreview(template);
  const editableFieldsById = new Map(editableFields.map((field) => [field.id, field]));

  // The HIS editor draws braces around field values using its own stylesheet.
  template.content.querySelectorAll('.tag-filed > .tag-marker').forEach((marker) => {
    if (marker.textContent === '[') marker.textContent = '{';
    else if (marker.textContent === ']') marker.textContent = '}';
  });
  template.content.querySelectorAll<HTMLElement>('[data-id][data-type]').forEach((element) => {
    const fieldId = element.getAttribute('data-id') || '';
    const field = editableFieldsById.get(fieldId);
    if (!field) return;

    const valueElement = resolveFieldValueElement(element);
    const prompt = valueElement.querySelector('.placeholder')?.textContent?.trim()
      || element.getAttribute('data-default')?.trim();
    if (field.dictionaryItems.length > 0) {
      const dictionaryItem = resolveOutpatientEmrFinalDictionaryItem(
        field,
        fieldValues[fieldId],
      );
      valueElement.textContent = '';
      valueElement.removeAttribute('contenteditable');
      const control = document.createElement('span');
      control.className = 'outpatient-emr-dictionary';
      const select = document.createElement('select');
      select.className = 'outpatient-emr-dictionary-select';
      select.setAttribute('data-outpatient-emr-field-id', fieldId);
      select.setAttribute('aria-label', field.name || fieldId);
      select.disabled = !editable;
      applyOutpatientEmrFieldSource(select, fieldSources[fieldId], conflictFieldIds.has(fieldId));

      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '留空';
      select.dataset.placeholder = prompt || '请选择';
      if (!dictionaryItem) placeholder.defaultSelected = true;
      select.appendChild(placeholder);
      field.dictionaryItems.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.text;
        option.textContent = item.text;
        option.setAttribute('data-dictionary-value', item.value);
        if (dictionaryItem === item) {
          option.selected = true;
          option.setAttribute('selected', '');
        }
        select.appendChild(option);
      });
      const label = document.createElement('span');
      label.className = 'outpatient-emr-dictionary-label';
      label.setAttribute('aria-hidden', 'true');
      label.textContent = dictionaryItem?.text || select.dataset.placeholder;
      label.classList.toggle('placeholder', !dictionaryItem);
      control.append(select, label);
      valueElement.appendChild(control);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(fieldValues, fieldId)) {
      valueElement.textContent = fieldValues[fieldId];
    } else if (valueElement.querySelector('.placeholder')) {
      valueElement.textContent = readFieldValue(element);
    }
    valueElement.setAttribute('data-outpatient-emr-placeholder', prompt || field.name);
    valueElement.setAttribute('data-outpatient-emr-field-id', fieldId);
    applyOutpatientEmrFieldSource(valueElement, fieldSources[fieldId], conflictFieldIds.has(fieldId));
    if (editable) {
      valueElement.setAttribute('contenteditable', 'true');
      valueElement.setAttribute('role', 'textbox');
      valueElement.setAttribute('tabindex', '0');
      valueElement.setAttribute('aria-label', field.name || fieldId);
      valueElement.setAttribute('aria-placeholder', prompt || field.name);
    }
  });

  return template.innerHTML;
}

export function readEditableOutpatientEmrField(
  eventTarget: EventTarget | null,
  previewRoot: HTMLElement,
): { fieldId: string; value: string } | null {
  if (!(eventTarget instanceof Element)) return null;
  const element = eventTarget.closest<HTMLElement>('[data-outpatient-emr-field-id]');
  if (!element || !previewRoot.contains(element)) return null;

  const fieldId = element.getAttribute('data-outpatient-emr-field-id') || '';
  if (!fieldId) return null;
  return {
    fieldId,
    value: element instanceof HTMLSelectElement
      ? element.value
      : (element.textContent || '').replace(/\r\n?/g, '\n'),
  };
}
