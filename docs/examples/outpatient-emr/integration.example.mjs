// 浏览器 ES module；仅提供 hash 与独立模板结果校验，不连接模型或保存病历。
// 当前患者/病历/编辑器版本的事务校验、持久化和回执队列由 HIS 实现。

async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto，请提供等价 SHA-256 实现');
  }
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(digest), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('');
}

export async function calculateTemplateHash(templateHtml, templateDefinition) {
  const [htmlHash, definitionHash] = await Promise.all([
    sha256Hex(templateHtml), sha256Hex(templateDefinition)
  ]);
  return sha256Hex(`outpatient-emr-template-pair.v1:${htmlHash}:${definitionHash}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSameIds(actualIds, expectedIds, description) {
  const expected = new Set(expectedIds);
  assert(
    expected.size === expectedIds.length
      && actualIds.length === expected.size
      && new Set(actualIds).size === actualIds.length
      && actualIds.every((id) => expected.has(id)),
    `${description}与本次目标范围不一致`
  );
}

// request 是发送时持久保存的原始请求，不应从当前页面重新拼装。
// expectedHash 应由 calculateTemplateHash(request.templateHtml, request.templateDefinition) 得到。
// 此函数校验独立 analyzeOutpatientEmr 结果，不适用于 startVoice 的合并批次。
export function assertStandaloneResult(request, expectedHash, result) {
  assert(isObject(result), '回参必须是对象');
  assert(
    result.resultType === 'record-confirmed' && result.emrType === 'outpatient-emr'
      && result.requestId === request.requestId
      && result.visitId === request.visitId
      && result.consultationId === request.visitId,
    '确认结果身份不匹配'
  );
  assert(
    result.referenceType === 'batch' && result.action === 'batch'
      && result.referenceStatus === 'pending'
      && Number.isFinite(result.timestamp),
    '确认结果状态不完整'
  );
  const metadata = result.templateMetadata;
  assert(
    isObject(metadata)
      && metadata.schemaVersion === 'outpatient-emr-template-pair.v1'
      && metadata.templateId === request.templateId
      && metadata.templateName === request.templateName
      && /^[0-9a-f]{64}$/.test(expectedHash)
      && metadata.templateHash === expectedHash
      && Array.isArray(metadata.fields),
    '模板身份或 hash 不匹配'
  );
  assert(
    isObject(result.fieldValues) && isObject(result.dictionarySelections)
      && isObject(result.emrFieldValues),
    '缺少字段值、字典选择或绑定值'
  );
  assertSameIds(Object.keys(result.fieldValues), request.targetFieldIds, '显示字段');
  assertSameIds(Object.keys(result.emrFieldValues), request.targetFieldIds, '绑定字段');
  assertSameIds(
    metadata.fields.map((field) => field?.id), request.targetFieldIds, '字段元数据'
  );
  const dictionaryIds = [];
  for (const field of metadata.fields) {
    const display = result.fieldValues[field.id];
    const binding = result.emrFieldValues[field.id];
    assert(typeof display === 'string' && typeof binding === 'string', '字段值必须是字符串');
    assert(Array.isArray(field.dictionaryItems), '字段缺少字典元数据');
    if (field.dictionaryItems.length > 0) {
      dictionaryIds.push(field.id);
      const selected = result.dictionarySelections[field.id];
      const matches = isObject(selected) ? field.dictionaryItems.filter((item) => (
        item.value === selected.value && item.text === selected.text
      )) : [];
      assert(
        matches.length === 1 && typeof selected.value === 'string'
          && typeof selected.text === 'string'
          && selected.text === display && selected.value === binding,
        `字典编码与显示值不一致：${field.id}`
      );
    } else {
      assert(binding === display, `文本绑定值不一致：${field.id}`);
    }
  }
  assertSameIds(Object.keys(result.dictionarySelections), dictionaryIds, '字典字段');
  const scope = result.writebackScope;
  assert(
    isObject(scope) && Array.isArray(scope.recordFields)
      && scope.includeDiagnosis === false
      && Array.isArray(scope.orderTypes) && scope.orderTypes.length === 0
      && Array.isArray(result.orderList) && result.orderList.length === 0
      && result.diagList === undefined,
    '独立模板分析不能携带诊断或医嘱'
  );
}
