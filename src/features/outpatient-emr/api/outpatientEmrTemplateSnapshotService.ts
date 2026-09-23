import { regionalPost } from '@/services/regionalClient';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrFieldMappingSource,
  OutpatientEmrProjectionMode,
  OutpatientEmrRecordField,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
} from '../types';

type UnknownRecord = Record<string, unknown>;

const RESOLVE_SCHEMA = 'outpatient-emr-template-pair-resolve.v1' as const;
const RESOLUTION_SCHEMA = 'outpatient-emr-template-pair-resolution.v1' as const;
const PARSE_SCHEMA = 'outpatient-emr-template-pair.v1' as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_FIELDS = new Set<OutpatientEmrRecordField>([
  'chiefComplaint',
  'historyOfPresentIllness',
  'pastMedicalHistory',
  'personalHistory',
  'menstrualHistory',
  'maritalReproductiveHistory',
  'familyHistory',
  'physicalExam',
  'precautions',
]);
const MAPPING_SOURCES = new Set<OutpatientEmrFieldMappingSource>([
  'definition-record-field',
  'definition-article-record-field',
  'canonical-id',
  'deterministic-alias',
  'deterministic-article',
  'unmapped',
]);
const PROJECTION_MODES = new Set<OutpatientEmrProjectionMode>(['direct', 'section-compose']);
const FIELD_KEYS = [
  'id',
  'name',
  'type',
  'articleTemplateId',
  'articleId',
  'articleName',
  'articleDefinitionName',
  'readonly',
  'aiSuitable',
  'baselineValue',
  'baselineDictionaryValue',
  'dictionaryItems',
  'recordField',
  'mappingSource',
  'projectionMode',
] as const;

export interface OutpatientEmrTemplateParseSnapshot {
  schemaVersion: 'outpatient-emr-template-pair.v1';
  fields: OutpatientEmrTemplateField[];
}

export interface OutpatientEmrTemplateSnapshotRequest {
  schemaVersion: 'outpatient-emr-template-pair-snapshot.v1';
  templateId: string;
  templateName: string;
  templateHash: string;
  templateHtml: string;
  templateDefinition: string;
  parseResult: OutpatientEmrTemplateParseSnapshot;
}

export interface OutpatientEmrTemplateSnapshotReceipt {
  id: string;
  templateHash: string;
  deduplicated: boolean;
  receivedAt: number;
}

export interface OutpatientEmrTemplateSnapshotResolveRequest {
  schemaVersion: typeof RESOLVE_SCHEMA;
  templateId: string;
  templateHash: string;
}

export interface OutpatientEmrTemplateSnapshotResolution {
  schemaVersion: typeof RESOLUTION_SCHEMA;
  cacheHit: boolean;
  id: string | null;
  templateId: string;
  templateHash: string;
  parseResult: OutpatientEmrTemplateParseSnapshot | null;
  receivedAt: number | null;
}

export interface ResolveOutpatientEmrTemplateSnapshotInput {
  templateId: string;
  templateHash: string;
}

export interface PersistOutpatientEmrTemplateSnapshotInput {
  request: OutpatientEmrAnalysisRequest;
  template: OutpatientEmrTemplateParseResult;
  templateHash: string;
}

function cloneField(field: OutpatientEmrTemplateField): OutpatientEmrTemplateField {
  return {
    id: field.id,
    name: field.name,
    type: field.type,
    articleTemplateId: field.articleTemplateId,
    articleId: field.articleId,
    articleName: field.articleName,
    articleDefinitionName: field.articleDefinitionName,
    readonly: field.readonly,
    aiSuitable: field.aiSuitable,
    baselineValue: field.baselineValue,
    baselineDictionaryValue: field.baselineDictionaryValue,
    dictionaryItems: field.dictionaryItems.map((item) => ({
      value: item.value,
      text: item.text,
    })),
    recordField: field.recordField,
    mappingSource: field.mappingSource,
    projectionMode: field.projectionMode,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireExactObject(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): UnknownRecord {
  if (!isRecord(value)) throw new Error(`${path} 必须是对象。`);
  const actualKeys = Object.keys(value);
  const missingKeys = expectedKeys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unknownKeys = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (missingKeys.length > 0 || unknownKeys.length > 0) {
    throw new Error(
      `${path} 字段不符合当前协议：缺少 [${missingKeys.join(', ')}]，未知 [${unknownKeys.join(', ')}]。`,
    );
  }
  return value;
}

function requireString(
  record: UnknownRecord,
  key: string,
  path: string,
  allowEmpty = false,
): string {
  const value = record[key];
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value !== value.trim()
  ) {
    throw new Error(`${path}.${key} 必须是无首尾空白的${allowEmpty ? '' : '非空'}字符串。`);
  }
  return value;
}

function requireBoolean(record: UnknownRecord, key: string, path: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') throw new Error(`${path}.${key} 必须是布尔值。`);
  return value;
}

function requireTimestamp(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${path} 必须是非负安全整数时间戳。`);
  }
  return value;
}

function parseDictionaryItems(value: unknown, path: string) {
  if (!Array.isArray(value)) throw new Error(`${path} 必须是数组。`);
  const tokens = new Set<string>();
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = requireExactObject(item, ['value', 'text'], itemPath);
    const dictionaryValue = requireString(record, 'value', itemPath, true);
    const text = requireString(record, 'text', itemPath);
    new Set([dictionaryValue, text]).forEach((token) => {
      if (tokens.has(token)) throw new Error(`${path} 存在重复匹配项 ${token}。`);
      tokens.add(token);
    });
    return { value: dictionaryValue, text };
  });
}

function parseSnapshotField(value: unknown, index: number): OutpatientEmrTemplateField {
  const path = `parseResult.fields[${index}]`;
  const record = requireExactObject(value, FIELD_KEYS, path);
  const mappingSource = requireString(record, 'mappingSource', path);
  if (!MAPPING_SOURCES.has(mappingSource as OutpatientEmrFieldMappingSource)) {
    throw new Error(`${path}.mappingSource 不受支持。`);
  }
  const recordFieldValue = record.recordField;
  const projectionModeValue = record.projectionMode;
  const recordField = recordFieldValue === null
    ? null
    : requireString(record, 'recordField', path);
  const projectionMode = projectionModeValue === null
    ? null
    : requireString(record, 'projectionMode', path);
  if (recordField === null) {
    if (mappingSource !== 'unmapped' || projectionMode !== null) {
      throw new Error(`${path} 未映射字段的映射状态不一致。`);
    }
  } else {
    if (!RECORD_FIELDS.has(recordField as OutpatientEmrRecordField)) {
      throw new Error(`${path}.recordField 不受支持。`);
    }
    if (
      mappingSource === 'unmapped'
      || projectionMode === null
      || !PROJECTION_MODES.has(projectionMode as OutpatientEmrProjectionMode)
    ) {
      throw new Error(`${path} 已映射字段的映射状态不一致。`);
    }
  }
  return {
    id: requireString(record, 'id', path),
    name: requireString(record, 'name', path),
    type: requireString(record, 'type', path),
    articleTemplateId: requireString(record, 'articleTemplateId', path),
    articleId: requireString(record, 'articleId', path),
    articleName: requireString(record, 'articleName', path),
    articleDefinitionName: requireString(record, 'articleDefinitionName', path),
    readonly: requireBoolean(record, 'readonly', path),
    aiSuitable: requireBoolean(record, 'aiSuitable', path),
    baselineValue: requireString(record, 'baselineValue', path, true),
    baselineDictionaryValue: requireString(record, 'baselineDictionaryValue', path, true),
    dictionaryItems: parseDictionaryItems(record.dictionaryItems, `${path}.dictionaryItems`),
    recordField: recordField as OutpatientEmrRecordField | null,
    mappingSource: mappingSource as OutpatientEmrFieldMappingSource,
    projectionMode: projectionMode as OutpatientEmrProjectionMode | null,
  };
}

function parseSnapshot(value: unknown): OutpatientEmrTemplateParseSnapshot {
  const record = requireExactObject(value, ['schemaVersion', 'fields'], 'parseResult');
  if (record.schemaVersion !== PARSE_SCHEMA) {
    throw new Error(`parseResult.schemaVersion 只支持 ${PARSE_SCHEMA}。`);
  }
  if (!Array.isArray(record.fields) || record.fields.length === 0) {
    throw new Error('parseResult.fields 必须是非空数组。');
  }
  const fields = record.fields.map(parseSnapshotField);
  if (new Set(fields.map((field) => field.id)).size !== fields.length) {
    throw new Error('parseResult.fields 存在重复字段 ID。');
  }
  return { schemaVersion: PARSE_SCHEMA, fields };
}

function parseResolution(
  value: unknown,
  expected: ResolveOutpatientEmrTemplateSnapshotInput,
): OutpatientEmrTemplateSnapshotResolution {
  const record = requireExactObject(value, [
    'schemaVersion',
    'cacheHit',
    'id',
    'templateId',
    'templateHash',
    'parseResult',
    'receivedAt',
  ], '模板历史解析响应');
  if (record.schemaVersion !== RESOLUTION_SCHEMA) {
    throw new Error(`模板历史解析响应 schemaVersion 只支持 ${RESOLUTION_SCHEMA}。`);
  }
  const cacheHit = requireBoolean(record, 'cacheHit', '模板历史解析响应');
  const templateId = requireString(record, 'templateId', '模板历史解析响应');
  const templateHash = requireString(record, 'templateHash', '模板历史解析响应');
  if (!SHA256_PATTERN.test(templateHash)) {
    throw new Error('模板历史解析响应 templateHash 不是 64 位小写 SHA-256。');
  }
  if (templateId !== expected.templateId || templateHash !== expected.templateHash) {
    throw new Error('模板历史解析响应身份与当前模板不一致。');
  }
  if (!cacheHit) {
    if (record.id !== null || record.parseResult !== null || record.receivedAt !== null) {
      throw new Error('模板历史解析未命中响应必须显式返回空详情。');
    }
    return {
      schemaVersion: RESOLUTION_SCHEMA,
      cacheHit: false,
      id: null,
      templateId,
      templateHash,
      parseResult: null,
      receivedAt: null,
    };
  }
  const id = requireString(record, 'id', '模板历史解析响应');
  const parseResult = parseSnapshot(record.parseResult);
  const receivedAt = requireTimestamp(record.receivedAt, '模板历史解析响应.receivedAt');
  return {
    schemaVersion: RESOLUTION_SCHEMA,
    cacheHit: true,
    id,
    templateId,
    templateHash,
    parseResult,
    receivedAt,
  };
}

function parseReceipt(value: unknown, expectedHash: string): OutpatientEmrTemplateSnapshotReceipt {
  const record = requireExactObject(
    value,
    ['id', 'templateHash', 'deduplicated', 'receivedAt'],
    '模板解析登记响应',
  );
  const templateHash = requireString(record, 'templateHash', '模板解析登记响应');
  if (templateHash !== expectedHash) throw new Error('模板解析登记响应 hash 与当前模板不一致。');
  return {
    id: requireString(record, 'id', '模板解析登记响应'),
    templateHash,
    deduplicated: requireBoolean(record, 'deduplicated', '模板解析登记响应'),
    receivedAt: requireTimestamp(record.receivedAt, '模板解析登记响应.receivedAt'),
  };
}

export function buildOutpatientEmrTemplateSnapshotRequest(
  input: PersistOutpatientEmrTemplateSnapshotInput,
): OutpatientEmrTemplateSnapshotRequest {
  return {
    schemaVersion: 'outpatient-emr-template-pair-snapshot.v1',
    templateId: input.request.templateId,
    templateName: input.request.templateName,
    templateHash: input.templateHash,
    templateHtml: input.request.templateHtml,
    templateDefinition: input.request.templateDefinition,
    parseResult: {
      schemaVersion: 'outpatient-emr-template-pair.v1',
      fields: input.template.fields.map(cloneField),
    },
  };
}

export function buildOutpatientEmrTemplateSnapshotResolveRequest(
  input: ResolveOutpatientEmrTemplateSnapshotInput,
): OutpatientEmrTemplateSnapshotResolveRequest {
  return {
    schemaVersion: RESOLVE_SCHEMA,
    templateId: input.templateId,
    templateHash: input.templateHash,
  };
}

export async function resolveOutpatientEmrTemplateSnapshot(
  input: ResolveOutpatientEmrTemplateSnapshotInput,
): Promise<OutpatientEmrTemplateSnapshotResolution> {
  const response = await regionalPost<unknown>(
    '/v1/client/outpatient-emr/templates/snapshots/resolve',
    buildOutpatientEmrTemplateSnapshotResolveRequest(input),
  );
  return parseResolution(response, input);
}

export async function persistOutpatientEmrTemplateSnapshot(
  input: PersistOutpatientEmrTemplateSnapshotInput,
): Promise<OutpatientEmrTemplateSnapshotReceipt> {
  const response = await regionalPost<unknown>(
    '/v1/client/outpatient-emr/templates/snapshots',
    buildOutpatientEmrTemplateSnapshotRequest(input),
  );
  return parseReceipt(response, input.templateHash);
}
