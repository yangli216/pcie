import { regionalPost } from '@/services/regionalClient';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientFieldPolicy,
  OutpatientFieldRule,
  OutpatientEmrFieldMappingSource,
  OutpatientEmrProjectionMode,
  OutpatientEmrRecordField,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
} from '../types';

type UnknownRecord = Record<string, unknown>;

const RESOLVE_SCHEMA = 'outpatient-emr-template-pair-resolve.v2' as const;
const RESOLUTION_SCHEMA = 'outpatient-emr-template-pair-resolution.v2' as const;
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
  'manual-override',
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
  schemaVersion: 'outpatient-emr-template-pair-snapshot.v2';
  supportsFieldVisibility: true;
  templateId: string;
  templateName: string;
  templateHash: string;
  templateHtml: string;
  templateDefinition: string;
  parseResult: OutpatientEmrTemplateParseSnapshot;
}

export interface OutpatientEmrTemplateSnapshotReceipt {
  schemaVersion: 'outpatient-emr-template-pair-receipt.v2';
  templateId: string;
  parseResult: OutpatientEmrTemplateParseSnapshot;
  fieldPolicy: OutpatientFieldPolicy;
  id: string;
  templateHash: string;
  deduplicated: boolean;
  receivedAt: number;
}

export interface OutpatientEmrTemplateSnapshotResolveRequest {
  schemaVersion: typeof RESOLVE_SCHEMA;
  supportsFieldVisibility: true;
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
  fieldPolicy: OutpatientFieldPolicy | null;
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
  // The registered snapshot is the immutable automatic parse; manual mappings are
  // server-side overlays and must never be written back into it.
  if (field.mappingSource === 'manual-override') {
    throw new Error(`模板字段 ${field.id} 的人工映射不能登记为自动解析快照。`);
  }
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
  if (typeof record.articleDefinitionName !== 'string' || !record.articleDefinitionName.trim()) {
    throw new Error(`${path}.articleDefinitionName 必须是非空章节名称。`);
  }
  return {
    id: requireString(record, 'id', path),
    name: requireString(record, 'name', path),
    type: requireString(record, 'type', path),
    articleTemplateId: requireString(record, 'articleTemplateId', path),
    articleId: requireString(record, 'articleId', path),
    articleName: requireString(record, 'articleName', path),
    articleDefinitionName: record.articleDefinitionName,
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
  const byId = new Map<string, OutpatientEmrTemplateField>();
  const seen = new Set<string>();
  let firstIssue: Error | undefined;
  record.fields.forEach((item: unknown, index: number) => {
    const id = item && typeof item === 'object' && 'id' in item ? item.id : undefined;
    if (typeof id === 'string') {
      if (seen.has(id)) {
        byId.delete(id);
        firstIssue ??= new Error('parseResult.fields 存在重复字段 ID。');
        return;
      }
      seen.add(id);
    }
    try {
      const field = parseSnapshotField(item, index);
      byId.set(field.id, field);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      firstIssue ??= error;
    }
  });
  const fields = Array.from(byId.values());
  if (!fields.length) throw firstIssue || new Error('parseResult.fields 没有可识别的字段。');
  return { schemaVersion: PARSE_SCHEMA, fields };
}

function parsePolicy(value: unknown): OutpatientFieldPolicy {
  const hasVisibility = isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'fieldVisibility');
  const policy = requireExactObject(value, ['schemaVersion','templateState','revision','ruleSetVersion','fields',
    ...(hasVisibility ? ['fieldVisibility'] : [])], 'fieldPolicy');
  if (hasVisibility && (!isRecord(policy.fieldVisibility) || Object.values(policy.fieldVisibility).some(item => typeof item !== 'boolean'))) {
    throw new Error('门诊模板字段展示配置不兼容。');
  }
  const state = policy.templateState;
  if (policy.schemaVersion !== 'outpatient-emr-field-policy.v1' || (state !== 'enabled' && state !== 'disabled' && state !== 'deleted')
    || typeof policy.ruleSetVersion !== 'string' || !/^outpatient-emr-field-prompt\.v[1-9]\d*$/.test(policy.ruleSetVersion)
    || !Array.isArray(policy.fields) || policy.fields.length > 2000 || (state !== 'enabled' && policy.fields.length > 0)) {
    throw new Error('门诊模板字段规则协议不兼容。');
  }
  const fields = new Map<string, OutpatientFieldRule>();
  const seenIds = new Set<string>();
  for (const item of policy.fields) {
    if (!isRecord(item) || typeof item.fieldId !== 'string') continue;
    const id = item.fieldId;
    if (seenIds.has(id)) { fields.delete(id); continue; }
    seenIds.add(id);
    if (!id || id.length > 512 || id.trim() !== id || Object.keys(item).length !== 7
      || typeof item.meaning !== 'string' || !item.meaning.trim() || typeof item.aiSuitable !== 'boolean'
      || typeof item.generationSource !== 'string' || !['default','protected','manual-override'].includes(item.generationSource)) continue;
    const valid = item.aiSuitable
      ? item.generationSource !== 'protected' && (item.promptSource === 'default' || item.promptSource === 'custom')
        && typeof item.resolvedPrompt === 'string' && !!item.resolvedPrompt.trim()
        && (item.unmentionedDefault === null || (typeof item.unmentionedDefault === 'string' && !!item.unmentionedDefault.trim()))
      : item.promptSource === 'not_ai' && item.resolvedPrompt === null && item.unmentionedDefault === null;
    if (valid) fields.set(id, item as unknown as OutpatientFieldRule);
  }
  return { schemaVersion: 'outpatient-emr-field-policy.v1', templateState: state,
    revision: requireTimestamp(policy.revision, 'fieldPolicy.revision'), ruleSetVersion: policy.ruleSetVersion, fields: [...fields.values()],
    ...(hasVisibility ? { fieldVisibility: policy.fieldVisibility as Record<string, boolean> } : {}) };
}

function parseResolution(
  value: unknown,
  expected: ResolveOutpatientEmrTemplateSnapshotInput,
): OutpatientEmrTemplateSnapshotResolution {
  if (isRecord(value) && value.schemaVersion === 'outpatient-emr-template-pair-resolution.v1') {
    throw new Error('模板历史解析响应的 schemaVersion 为 v1，请先升级 PCIE Server 以读取字段书写规则。');
  }
  const record = requireExactObject(value, [
    'schemaVersion',
    'cacheHit',
    'fieldPolicy',
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
    if (record.fieldPolicy !== null || record.id !== null || record.parseResult !== null || record.receivedAt !== null) {
      throw new Error('模板历史解析未命中响应必须显式返回空详情。');
    }
    return {
      schemaVersion: RESOLUTION_SCHEMA,
      cacheHit: false,
      id: null,
      templateId,
      templateHash,
      parseResult: null,
      fieldPolicy: null,
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
    fieldPolicy: parsePolicy(record.fieldPolicy),
    receivedAt,
  };
}

function parseReceipt(value: unknown, expectedHash: string, expectedId: string): OutpatientEmrTemplateSnapshotReceipt {
  if (isRecord(value) && value.schemaVersion === 'outpatient-emr-template-pair-receipt.v1') {
    throw new Error('模板登记回执的 schemaVersion 为 v1，请先升级 PCIE Server 以读取字段书写规则。');
  }
  const record = requireExactObject(
    value,
    ['schemaVersion', 'id', 'templateId', 'templateHash', 'deduplicated', 'receivedAt', 'parseResult', 'fieldPolicy'],
    '模板解析登记响应',
  );
  const templateHash = requireString(record, 'templateHash', '模板解析登记响应');
  if (record.schemaVersion !== 'outpatient-emr-template-pair-receipt.v2' || record.templateId !== expectedId)
    throw new Error('模板解析登记响应版本或模板 ID 不一致，请核对服务端版本。');
  if (templateHash !== expectedHash) throw new Error('模板解析登记响应 hash 与当前模板不一致。');
  return {
    schemaVersion: 'outpatient-emr-template-pair-receipt.v2',
    templateId: expectedId,
    parseResult: parseSnapshot(record.parseResult),
    fieldPolicy: parsePolicy(record.fieldPolicy),
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
    schemaVersion: 'outpatient-emr-template-pair-snapshot.v2',
    supportsFieldVisibility: true,
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
    supportsFieldVisibility: true,
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
  return parseReceipt(response, input.templateHash, input.request.templateId);
}
