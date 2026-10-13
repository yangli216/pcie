const INTERNAL_PHRASES = /制定依据|待医生(?:核实|审核|核对|评估)|请医生(?:核实|审核|核对)|AI\s*定性分析|适用性待核实|不构成医疗建议|合成展示/i;
const INTERNAL_LABELS = /(?:^|[\s。！？!?;；（(])(?:来源|出处|证据|资料来源|数据来源|证据来源|优先级|资料快照|记录版本)\s*[:：]/;
const INTERNAL_HEADINGS = /(?:^|[\r\n\u2028\u2029])\s*(?:#{1,6}\s*)?(?:待补充资料|医生提醒|模型说明|机构批准提示|生成依据|待核实事项|待审核事项|需医生核实事项|待医生核实事项)\s*(?:[:：]|[\r\n\u2028\u2029]|$)/;

/** Patient instructions are never silently stripped; the physician must review a rejected draft. */
export function assertPatientFacingContent(text: string): void {
  if (typeof text !== 'string' || !text.trim() || INTERNAL_PHRASES.test(text) || INTERNAL_LABELS.test(text) || INTERNAL_HEADINGS.test(text)) {
    throw new Error('处方正文包含内部说明或医生核实提醒，请移至医生提醒区后再确认。');
  }
}

function sentenceCount(text: string): number {
  let count = 0;
  let hasTrailingText = false;
  const chars = Array.from(text);
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const decimalPoint = char === '.' && /\d/.test(chars[index - 1] ?? '') && /\d/.test(chars[index + 1] ?? '');
    if (/[。！？!?]/.test(char) || char === '.' && !decimalPoint) {
      if (hasTrailingText) count += 1;
      hasTrailingText = false;
    } else if (char.trim()) hasTrailingText = true;
  }
  return count + Number(hasTrailingText);
}

/** Generation style only: manual edits retain the normal patient-content and length boundaries. */
export function assertGeneratedExerciseContent(text: string): void {
  assertPatientFacingContent(text);
  const content = text.trim();
  const length = Array.from(content).length;
  const entries = [...content.matchAll(/^[ \t]*(\d+)[.、．)）]\s*/gm)];
  if (length < 250 || length > 450 || entries.length !== 3 || entries[0].index !== 0
    || entries.some((entry, index) => entry[1] !== String(index + 1))) {
    throw new Error('运动建议须按 1 至 3 编号输出 3 条，合计 250 至 450 字，每条最多 2 句。');
  }
  entries.forEach((entry, index) => {
    const start = entry.index! + entry[0].length;
    const end = entries[index + 1]?.index ?? content.length;
    const body = content.slice(start, end).trim();
    if (!body || sentenceCount(body) > 2 || /[\r\n\u2028\u2029]\s*(?:[-*•]|\d+[.、．)）])/.test(body)) {
      throw new Error('运动建议须按 1 至 3 编号输出 3 条，合计 250 至 450 字，每条最多 2 句。');
    }
  });
}
