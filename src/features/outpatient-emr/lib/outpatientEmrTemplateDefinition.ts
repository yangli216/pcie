import { validateOutpatientEmrDictionaryItems } from './outpatientEmrDictionary';
import type {
  OutpatientEmrDictionaryItem,
  OutpatientEmrErrorCode,
} from '../types';

type UnknownRecord = Record<string, unknown>;

export interface OutpatientEmrTemplateDefinitionArticle {
  templateId: string;
  articleId: string;
  name: string;
  recordField?: string;
}

export interface OutpatientEmrTemplateDefinitionField {
  id: string;
  name: string;
  type: string;
  readonly: boolean;
  aiSuitable?: boolean;
  recordField?: string;
  articleTemplateId: string;
  articleId: string;
  articleDefinitionName: string;
  value: string;
  text: string;
  dictionaryItems: OutpatientEmrDictionaryItem[];
}

export interface OutpatientEmrTemplateDefinitionImport {
  id: string;
  type: string;
  articleTemplateId: string;
  articleId: string;
}

export interface OutpatientEmrTemplateDefinition {
  articles: OutpatientEmrTemplateDefinitionArticle[];
  fields: OutpatientEmrTemplateDefinitionField[];
  imports: OutpatientEmrTemplateDefinitionImport[];
}

export class OutpatientEmrTemplateDefinitionError extends Error {
  constructor(
    message: string,
    public readonly code: Extract<
      OutpatientEmrErrorCode,
      'INVALID_TEMPLATE_JSON' | 'INVALID_DICTIONARY_DEFINITION'
    > = 'INVALID_TEMPLATE_JSON',
  ) {
    super(message);
    this.name = 'OutpatientEmrTemplateDefinitionError';
  }
}

export function isTemplateObject(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function readRequiredExactString(
  record: UnknownRecord,
  key: string,
  location: string,
): string {
  const value = record[key];
  if (typeof value === 'string' && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new OutpatientEmrTemplateDefinitionError(
    `${location}的 ${key} 必须是无首尾空白的非空字符串。`,
  );
}

function readOptionalExactString(
  record: UnknownRecord,
  key: string,
  location: string,
): string | undefined {
  return hasOwn(record, key)
    ? readRequiredExactString(record, key, location)
    : undefined;
}

function readRequiredBoolean(
  record: UnknownRecord,
  key: string,
  location: string,
): boolean {
  if (typeof record[key] === 'boolean') return record[key];
  throw new OutpatientEmrTemplateDefinitionError(`${location}的 ${key} 必须是布尔值。`);
}

function readOptionalBoolean(
  record: UnknownRecord,
  key: string,
  location: string,
): boolean | undefined {
  return hasOwn(record, key)
    ? readRequiredBoolean(record, key, location)
    : undefined;
}

function readCurrentText(
  record: UnknownRecord,
  key: 'VALUE' | 'TEXT',
  location: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new OutpatientEmrTemplateDefinitionError(
      `${location}的 ${key} 必须是字符串或数字。`,
    );
  }
  return String(value).replace(/\r\n?/g, '\n').trim();
}

function readDictionaryToken(
  record: UnknownRecord,
  key: 'VALUE' | 'TEXT',
  location: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new OutpatientEmrTemplateDefinitionError(
      `${location}的 ${key} 必须是字符串或数字。`,
      'INVALID_DICTIONARY_DEFINITION',
    );
  }
  const raw = String(value);
  const normalized = raw.trim();
  if (raw !== normalized) {
    throw new OutpatientEmrTemplateDefinitionError(
      `${location}的 ${key} 不能包含首尾空白。`,
      'INVALID_DICTIONARY_DEFINITION',
    );
  }
  return normalized;
}

function readDictionaryItems(
  field: UnknownRecord,
  location: string,
): OutpatientEmrDictionaryItem[] {
  if (!hasOwn(field, 'BINDINGDATA')) return [];
  if (!Array.isArray(field.BINDINGDATA)) {
    throw new OutpatientEmrTemplateDefinitionError(
      `${location}的 BINDINGDATA 必须是数组。`,
      'INVALID_DICTIONARY_DEFINITION',
    );
  }

  const items: OutpatientEmrDictionaryItem[] = [];
  field.BINDINGDATA.forEach((value, index) => {
    const itemLocation = `${location}的第 ${index + 1} 个字典项`;
    if (!isTemplateObject(value)) {
      throw new OutpatientEmrTemplateDefinitionError(
        `${itemLocation}必须是对象。`,
        'INVALID_DICTIONARY_DEFINITION',
      );
    }
    if (!hasOwn(value, 'VALUE') || !hasOwn(value, 'TEXT')) {
      throw new OutpatientEmrTemplateDefinitionError(
        `${itemLocation}必须同时声明 VALUE 和 TEXT。`,
        'INVALID_DICTIONARY_DEFINITION',
      );
    }
    if (
      typeof value.VALUE === 'string'
      && typeof value.TEXT === 'string'
      && value.VALUE.trim() === ''
      && value.TEXT.trim() === ''
    ) {
      return;
    }
    const dictionaryValue = readDictionaryToken(value, 'VALUE', itemLocation);
    const text = readDictionaryToken(value, 'TEXT', itemLocation);
    if (!text) {
      throw new OutpatientEmrTemplateDefinitionError(
        `${itemLocation}缺少非空 TEXT。`,
        'INVALID_DICTIONARY_DEFINITION',
      );
    }
    items.push({ value: dictionaryValue, text });
  });

  if (items.length > 0) {
    const validationError = validateOutpatientEmrDictionaryItems(items);
    if (validationError) {
      throw new OutpatientEmrTemplateDefinitionError(
        `${location}的字典定义无效：${validationError}`,
        'INVALID_DICTIONARY_DEFINITION',
      );
    }
  }
  return items;
}

export function readOutpatientEmrChapters(source: string): unknown[] {
  if (typeof source !== 'string' || !source.trim()) {
    throw new OutpatientEmrTemplateDefinitionError('templateDefinition 必须是非空 JSON 字符串。');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new OutpatientEmrTemplateDefinitionError('结构化模板 JSON 格式不正确。');
  }
  if (!Array.isArray(parsed)) {
    throw new OutpatientEmrTemplateDefinitionError('结构化模板 JSON 顶层必须是章节数组。');
  }

  return parsed;
}

export function parseOutpatientEmrTemplateDefinition(
  source: string,
): OutpatientEmrTemplateDefinition {
  const parsed = readOutpatientEmrChapters(source);
  const articles: OutpatientEmrTemplateDefinitionArticle[] = [];
  const fields: OutpatientEmrTemplateDefinitionField[] = [];
  const imports: OutpatientEmrTemplateDefinitionImport[] = [];
  const articleIds = new Set<string>();
  const fieldIds = new Set<string>();

  parsed.forEach((articleValue, articleIndex) => {
    const location = `结构化模板第 ${articleIndex + 1} 个章节`;
    if (!isTemplateObject(articleValue)) {
      throw new OutpatientEmrTemplateDefinitionError(`${location}必须是对象。`);
    }
    const templateId = readRequiredExactString(articleValue, 'ID', location);
    const name = articleValue.NAME;
    if (typeof name !== 'string' || !name.trim()) {
      throw new OutpatientEmrTemplateDefinitionError(`${location}的 NAME 必须是非空章节名称。`);
    }
    const articleId = readRequiredExactString(articleValue, 'ARTICLE', location);
    const eles = articleValue.eles;
    if (!Array.isArray(eles)) {
      throw new OutpatientEmrTemplateDefinitionError(`${location}的 eles 必须是数组。`);
    }
    if (articleIds.has(templateId)) {
      throw new OutpatientEmrTemplateDefinitionError(`结构化模板章节 ID 重复：${templateId}`);
    }
    articleIds.add(templateId);
    const recordField = readOptionalExactString(articleValue, 'RECORD_FIELD', location);
    articles.push({ templateId, articleId, name, ...(recordField ? { recordField } : {}) });

    eles.forEach((fieldValue, fieldIndex) => {
      const fieldLocation = `${location}“${name}”的第 ${fieldIndex + 1} 个字段`;
      if (!isTemplateObject(fieldValue)) {
        throw new OutpatientEmrTemplateDefinitionError(`${fieldLocation}必须是对象。`);
      }
      const id = readRequiredExactString(fieldValue, 'ID', fieldLocation);
      const fieldName = readRequiredExactString(fieldValue, 'NAME', fieldLocation);
      const type = readRequiredExactString(fieldValue, 'TYPE', fieldLocation);
      if (fieldIds.has(id)) {
        throw new OutpatientEmrTemplateDefinitionError(`结构化模板字段 ID 重复：${id}`);
      }
      fieldIds.add(id);

      if (type.toLowerCase() === 'import') {
        imports.push({ id, type, articleTemplateId: templateId, articleId });
        return;
      }

      const readonly = readRequiredBoolean(fieldValue, 'READONLY', fieldLocation);
      const aiSuitable = readOptionalBoolean(fieldValue, 'AI_SUITABLE', fieldLocation);
      const fieldRecordField = readOptionalExactString(fieldValue, 'RECORD_FIELD', fieldLocation);
      fields.push({
        id,
        name: fieldName,
        type,
        readonly,
        ...(aiSuitable === undefined ? {} : { aiSuitable }),
        ...(fieldRecordField ? { recordField: fieldRecordField } : {}),
        articleTemplateId: templateId,
        articleId,
        articleDefinitionName: name,
        value: readCurrentText(fieldValue, 'VALUE', fieldLocation),
        text: readCurrentText(fieldValue, 'TEXT', fieldLocation),
        dictionaryItems: readDictionaryItems(fieldValue, fieldLocation),
      });
    });
  });

  return { articles, fields, imports };
}
