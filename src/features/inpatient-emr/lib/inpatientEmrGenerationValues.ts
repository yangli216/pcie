import type { InpatientEmrTemplateField } from '../types';
import { isInpatientEmrPlaceholderValue } from './inpatientEmrTemplate';

export class InpatientEmrGenerationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InpatientEmrGenerationValidationError';
  }
}

export function usableInpatientEmrGeneratedText(
  field: InpatientEmrTemplateField,
  value: unknown,
): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (!text || isInpatientEmrPlaceholderValue(text)) return '';
  // A copied template label (e.g. “体温”) is not a generated clinical value.
  if (text === field.name.trim() || text === field.id.trim()) return '';
  return text;
}

function rejectDuplicateKeys(json: string): void {
  const keys = new Set<string>();
  let depth = 0;
  let start = -1;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (start >= 0) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        let next = index + 1;
        while (/\s/u.test(json[next] || '') && next < json.length) next += 1;
        if (depth === 1 && json[next] === ':') {
          const key = JSON.parse(json.slice(start, index + 1)) as string;
          if (keys.has(key)) throw new InpatientEmrGenerationValidationError('AI 结果包含重复字段，生成未完成，请重新生成或核对当前草稿。');
          keys.add(key);
        }
        start = -1;
      }
    } else if (character === '"') start = index;
    else if (character === '{' || character === '[') depth += 1;
    else if (character === '}' || character === ']') depth -= 1;
  }
}

/** Partial JSON is for preview only. Final acceptance requires the entire response. */
export function parseCompleteInpatientEmrValues(
  response: string,
  fields: InpatientEmrTemplateField[],
): Record<string, string> {
  let json = response.replace(/^\uFEFF/u, '').trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/iu.exec(json);
  if (fenced) json = fenced[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new InpatientEmrGenerationValidationError('AI 未返回完整的字段 JSON，已保留收到的草稿，请重新生成或核对补充。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InpatientEmrGenerationValidationError('AI 结果必须是单个字段对象，当前生成未完成。');
  }
  rejectDuplicateKeys(json);
  const source = parsed as Record<string, unknown>;
  const aiFields = fields.filter((field) => field.aiSuitable);
  const expectedIds = new Set(aiFields.map((field) => field.id));
  if (Object.keys(source).some((id) => !expectedIds.has(id))) {
    throw new InpatientEmrGenerationValidationError('AI 返回了模板范围外的字段，当前生成未完成，请核对字段配置后重新生成。');
  }
  const missing: string[] = [];
  const invalid: string[] = [];
  const empty: string[] = [];
  const values = aiFields.map((field): [string, string] => {
    const label = field.name || field.id;
    if (!Object.prototype.hasOwnProperty.call(source, field.id)) missing.push(label);
    else if (typeof source[field.id] !== 'string') invalid.push(label);
    const text = usableInpatientEmrGeneratedText(field, source[field.id]);
    if (Object.prototype.hasOwnProperty.call(source, field.id) && typeof source[field.id] === 'string' && !text) empty.push(label);
    return [field.id, text];
  });
  const describe = (labels: string[]) => `${labels.slice(0, 8).join('、')}${labels.length > 8 ? `等 ${labels.length} 项` : ''}`;
  const issues = [
    missing.length ? `缺少字段：${describe(missing)}` : '',
    invalid.length ? `字段值不是文本：${describe(invalid)}` : '',
    empty.length ? `以下字段缺少可用内容：${describe(empty)}` : '',
  ].filter(Boolean);
  if (issues.length) {
    throw new InpatientEmrGenerationValidationError(`AI 未完整生成。${issues.join('；')}。请补充资料重新生成，或在预览中核对填写。`);
  }
  return Object.fromEntries(values);
}
