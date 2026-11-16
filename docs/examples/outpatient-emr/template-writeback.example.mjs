// 语音合并 / 独立模板分析共用的动态目标绑定规划示例。
// mode 为 voice 时 request 是 startVoice 的完整参数；standalone 时为 analyze 请求。
// rendererFields 由 HIS 归一化为：
// { id, type, visible, readonly, aiWritable, dictionaryItems: [{value, text}] }[]。
// expectedHash 用 calculateTemplateHash 对发起时两份原文计算；当前模板 hash / 编辑器版本
// 还须由 HIS 在事务内核对。本模块不操作 DOM、不保存病历、不发回执，
// 不替代 writebackScope 内标准病历、诊断、医嘱的既有 HIS 事务适配。
import { assertStandaloneResult } from './integration.example.mjs';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameIds(actual, expected, label) {
  const ids = new Set(expected);
  requireValue(
    ids.size === expected.length && actual.length === expected.length
      && new Set(actual).size === actual.length && actual.every((id) => ids.has(id)),
    `${label}与上传目标不一致`
  );
}

export function buildTemplateWritebackPlan({ mode, request, expectedHash, result, rendererFields }) {
  requireValue(mode === 'voice' || mode === 'standalone', '必须显式指定任务入口');
  const template = mode === 'voice' ? request.outpatientEmr : request;
  const visitId = mode === 'voice' ? request.idVis : request.visitId;
  requireValue(
    isObject(template) && typeof visitId === 'string' && visitId.length > 0
      && Array.isArray(template.targetFieldIds) && template.targetFieldIds.length > 0
      && template.targetFieldIds.every((id) => typeof id === 'string' && id === id.trim() && id.length > 0),
    '缺少原始模板任务'
  );
  requireValue(
    isObject(result) && result.resultType === 'record-confirmed'
      && result.emrType === 'outpatient-emr' && result.referenceType === 'batch'
      && result.action === 'batch' && result.referenceStatus === 'pending'
      && Number.isFinite(result.timestamp) && result.visitId === visitId
      && result.consultationId === visitId && result.requestId === template.requestId,
    '最终结果身份或状态不匹配'
  );
  const metadata = result.templateMetadata;
  requireValue(
    isObject(metadata) && metadata.schemaVersion === 'outpatient-emr-template-pair.v1'
      && metadata.templateId === template.templateId && metadata.templateName === template.templateName
      && /^[0-9a-f]{64}$/.test(expectedHash) && metadata.templateHash === expectedHash
      && Array.isArray(metadata.fields) && metadata.fields.every(isObject),
    '模板身份或 hash 不匹配'
  );
  requireValue(
    isObject(result.fieldValues) && isObject(result.emrFieldValues)
      && isObject(result.dictionarySelections)
      && Object.values(result.emrFieldValues).every((value) => typeof value === 'string'),
    '缺少开放字段表或绑定值类型错误'
  );
  sameIds(Object.keys(result.fieldValues), template.targetFieldIds, '显示字段');
  sameIds(metadata.fields.map((field) => field.id), template.targetFieldIds, '字段元数据');
  if (mode === 'standalone') assertStandaloneResult(request, expectedHash, result);

  requireValue(Array.isArray(rendererFields), '缺少当前编辑器字段表');
  const currentById = new Map();
  for (const field of rendererFields) {
    requireValue(
      isObject(field) && typeof field.id === 'string' && field.id.length > 0
        && field.id === field.id.trim() && !currentById.has(field.id),
      '编辑器字段 ID 缺失或重复'
    );
    currentById.set(field.id, field);
  }
  const metadataById = new Map(metadata.fields.map((field) => [field.id, field]));
  const dictionaryIds = [];
  const plan = template.targetFieldIds.map((id) => {
    const current = currentById.get(id);
    const field = metadataById.get(id);
    requireValue(
      current && current.visible === true && current.readonly === false && current.aiWritable === true,
      `当前字段不存在、不可写或未获 AI 填写授权：${id}`
    );
    requireValue(current.type === field.type, `字段类型变化：${id}`);
    requireValue(
      Array.isArray(current.dictionaryItems) && Array.isArray(field.dictionaryItems),
      `字段缺少字典描述：${id}`
    );
    const text = result.fieldValues[id];
    const value = result.emrFieldValues[id];
    requireValue(typeof text === 'string' && typeof value === 'string', `缺少最终字段值：${id}`);
    const isDictionary = field.dictionaryItems.length > 0;
    if (isDictionary) {
      dictionaryIds.push(id);
      const selected = result.dictionarySelections[id];
      const matches = (items) => items.filter((item) => (
        isObject(item) && item.value === value && item.text === text
      )).length === 1;
      requireValue(
        isObject(selected) && selected.value === value && selected.text === text
          && matches(field.dictionaryItems) && matches(current.dictionaryItems),
        `字典编码/文字未唯一命中当前合法项：${id}`
      );
    } else {
      requireValue(
        current.dictionaryItems.length === 0 && value === text
          && !['select', 'radio', 'checkbox'].includes(String(field.type).toLowerCase()),
        `文本或字典字段定义不一致：${id}`
      );
    }
    return { id, type: field.type, isDictionary, value, text };
  });
  sameIds(Object.keys(result.dictionarySelections), dictionaryIds, '字典选择');
  return plan; // 计划全部成功后，才由 HIS 在事务内执行写入并核对实际值。
}
