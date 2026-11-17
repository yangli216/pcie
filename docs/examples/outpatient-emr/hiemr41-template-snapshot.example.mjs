// 白云当前 HI-EMR 4.1.0 的模板采集示例，依据已部署组件源码核对。
// emrComponent 是 HIS EMRView.vue.$refs.EMR，不从任意 DOM 猜测 Vue 实例。
// allowedAiFieldIds 必须由 HIS 的统一字段策略显式提供，仅包含当前模板允许 AI 写入的 ID。
// 本函数同步序列化编辑器；不调用 PCIE、HIS 保存、签名或诊毕。

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function exactString(value) {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function visibleInRenderer(element) {
  if (!element.isConnected) return false;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden || current.getAttribute('aria-hidden') === 'true') return false;
    const view = current.ownerDocument.defaultView;
    requireValue(view && typeof view.getComputedStyle === 'function', '无法检查当前编辑器显隐');
    const style = view.getComputedStyle(current);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
      return false;
    }
  }
  // 若编辑器位于同源 iframe，还要检查 iframe 本身的显隐。
  const frame = element.ownerDocument.defaultView.frameElement;
  return frame ? visibleInRenderer(frame) : true;
}

export function captureHiEmr41Template({ emrComponent, allowedAiFieldIds }) {
  requireValue(
    Array.isArray(allowedAiFieldIds) && allowedAiFieldIds.length > 0
      && allowedAiFieldIds.every(exactString)
      && new Set(allowedAiFieldIds).size === allowedAiFieldIds.length,
    '请提供 HIS 当前模板允许 AI 填写的字段 ID 列表，不能默认全选'
  );
  const outpatient = emrComponent?.$refs?.OUTPATIENT;
  const recordVm = outpatient?.$refs?.record;
  requireValue(
    recordVm && typeof recordVm.getCurrentEditor === 'function'
      && typeof recordVm.getXmlContent === 'function'
      && typeof recordVm.getHtmlContent === 'function',
    '门诊 record 编辑器未就绪，或 HI-EMR 版本与采集适配器不匹配'
  );
  const record = recordVm.record;
  requireValue(record && exactString(record.idTep), '当前病历没有有效模板 ID');
  const currentRecord = outpatient.recordContent;
  requireValue(
    currentRecord && currentRecord.idMedrecdoc === record.idMedrecdoc
      && currentRecord.idTep === record.idTep,
    '门诊容器与编辑器仍在切换病历，请等待本次模板加载完成'
  );
  const editor = recordVm.getCurrentEditor();
  requireValue(editor?.document?.body, '当前 UEditor 尚未完成初始化');

  // getXmlContent 内部触发 beforesavedata，将当前控件同步到 vmodel，返回 JSON 字符串。
  // 先取 JSON，再取同一编辑器 HTML；不能读取加载时缓存的 record.xmlContent/htmlContent。
  const templateDefinition = recordVm.getXmlContent();
  const templateHtml = recordVm.getHtmlContent();
  requireValue(
    typeof templateDefinition === 'string' && templateDefinition.trim()
      && typeof templateHtml === 'string' && templateHtml.trim(),
    '编辑器没有导出完整模板对'
  );
  for (const text of [templateDefinition, templateHtml]) {
    requireValue(new TextEncoder().encode(text).byteLength <= 1024 * 1024, '模板原文超过 1 MiB');
  }
  const sections = JSON.parse(templateDefinition);
  requireValue(Array.isArray(sections), 'getXmlContent 返回内容必须为章节 JSON 数组');
  const definitions = new Map();
  for (const article of sections) {
    requireValue(article && Array.isArray(article.eles), '章节缺少 eles 数组');
    for (const field of article.eles) {
      requireValue(field && exactString(field.ID), '模板字段缺少稳定 ID');
      requireValue(!definitions.has(field.ID), `模板字段 ID 重复：${field.ID}`);
      definitions.set(field.ID, field);
    }
  }
  const renderedById = new Map();
  for (const field of editor.document.querySelectorAll('[data-id][data-type]')) {
    const id = field.getAttribute('data-id');
    requireValue(exactString(id) && !renderedById.has(id), `渲染字段 ID 缺失或重复：${id}`);
    renderedById.set(id, field);
  }
  const targetFieldIds = [];
  for (const id of allowedAiFieldIds) {
    const definition = definitions.get(id);
    requireValue(definition, `AI 字段策略包含当前模板不存在的 ID：${id}`);
    if (definition.TYPE === 'import' || definition.READONLY === true) continue;
    const element = renderedById.get(id);
    requireValue(element, `当前渲染器缺少目标字段：${id}`);
    requireValue(element.getAttribute('data-type') === definition.TYPE, `字段类型不一致：${id}`);
    const readonly = element.getAttribute('data-readonly');
    requireValue(readonly === 'true' || readonly === 'false', `字段缺少明确只读属性：${id}`);
    if (readonly === 'true' || !visibleInRenderer(element)) continue;
    targetFieldIds.push(id);
  }
  requireValue(targetFieldIds.length > 0, '当前没有可见、可写且允许 AI 填写的字段');
  return {
    templateId: record.idTep,
    templateName: record.naTep || record.naMed || record.idTep,
    templateHtml,
    templateDefinition,
    targetFieldIds
  };
}
