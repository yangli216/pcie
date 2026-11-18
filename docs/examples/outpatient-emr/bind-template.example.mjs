// 独立模板分析的通用绑定规划器，无患者、疾病或具体业务字段分支。
// 在 HIS 的保存事务内调用；它不操作 DOM、不保存病历、不发送回执。
import { assertStandaloneResult } from './integration.example.mjs';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function buildTemplateBindingPlan({ request, expectedHash, result, rendererFields }) {
  assertStandaloneResult(request, expectedHash, result);
  requireValue(Array.isArray(rendererFields), '当前编辑器字段表必须是数组');

  const currentById = new Map();
  const confirmed = result.templateMetadata.fields.map(field => field.id);
  for (const field of rendererFields.filter(field => confirmed.includes(field?.id))) {
    requireValue(
      field && typeof field.id === 'string' && field.id.length > 0
        && field.id === field.id.trim(),
      '当前编辑器字段缺少稳定 ID'
    );
    requireValue(!currentById.has(field.id), `当前编辑器字段 ID 重复：${field.id}`);
    currentById.set(field.id, field);
  }
  const metadataById = new Map(result.templateMetadata.fields.map((field) => [field.id, field]));

  // 完整生成计划后调用方才开始写入，避免发现后续字段错误时已经写入前面字段。
  return confirmed.map((id) => {
    const current = currentById.get(id);
    const metadata = metadataById.get(id);
    requireValue(current, `当前编辑器找不到目标字段：${id}`);
    requireValue(current.visible === true && current.readonly === false, `目标字段不可写：${id}`);
    requireValue(current.type === metadata.type, `目标字段类型不一致：${id}`);
    requireValue(Array.isArray(current.dictionaryItems), `当前字段缺少字典描述：${id}`);

    const isDictionary = metadata.dictionaryItems.length > 0;
    const value = result.emrFieldValues[id];
    const text = result.fieldValues[id];
    if (isDictionary) {
      const matching = current.dictionaryItems.filter((item) => (
        item && item.value === value && item.text === text
      ));
      requireValue(matching.length === 1, `绑定值未唯一命中当前模板字典：${id}`);
    } else {
      requireValue(
        current.dictionaryItems.length === 0
          && !['select', 'radio', 'checkbox'].includes(String(current.type).toLowerCase()),
        `目标字段字典定义不一致：${id}`
      );
    }
    return { id, type: current.type, isDictionary, value, text };
  });
}
