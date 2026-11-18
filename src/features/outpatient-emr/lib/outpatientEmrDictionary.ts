import type {
  OutpatientEmrDictionaryItem,
  OutpatientEmrTemplateField,
} from '../types';

const DICTIONARY_FIELD_TYPES = new Set(['select', 'radio', 'checkbox']);

function normalizeDictionaryToken(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';
}

export function isOutpatientEmrDictionaryFieldType(type: string): boolean {
  return DICTIONARY_FIELD_TYPES.has(type.trim().toLowerCase());
}

export function validateOutpatientEmrDictionaryItems(
  items: readonly OutpatientEmrDictionaryItem[],
): string | null {
  if (items.length === 0) return '字典没有可用项';

  const owners = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const text = normalizeDictionaryToken(item.text);
    const value = normalizeDictionaryToken(item.value);
    if (!text) return `第 ${index + 1} 个字典项缺少显示文本`;

    for (const token of new Set([value, text])) {
      const owner = owners.get(token);
      if (owner !== undefined && owner !== index) {
        return `字典项“${token}”无法唯一匹配`;
      }
      owners.set(token, index);
    }
  }
  return null;
}

export function resolveOutpatientEmrDictionaryItem(
  items: readonly OutpatientEmrDictionaryItem[],
  candidate: unknown,
): OutpatientEmrDictionaryItem | null {
  const normalized = normalizeDictionaryToken(candidate);
  if (!normalized) return null;

  const matches = items.filter((item) => (
    normalizeDictionaryToken(item.value) === normalized
    || normalizeDictionaryToken(item.text) === normalized
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function resolveOutpatientEmrFinalDictionaryItem(
  field: Pick<OutpatientEmrTemplateField, 'dictionaryItems'>,
  candidate: unknown,
): OutpatientEmrDictionaryItem | null {
  return resolveOutpatientEmrDictionaryItem(field.dictionaryItems, candidate);
}

export function findInvalidOutpatientEmrDictionaryValue(
  fields: ReadonlyArray<Pick<
    OutpatientEmrTemplateField,
    'id' | 'name' | 'dictionaryItems'
  >>,
  fieldValues: Readonly<Record<string, string>>,
): { fieldId: string; fieldName: string; value: string } | null {
  for (const field of fields) {
    if (field.dictionaryItems.length === 0) continue;
    const value = fieldValues[field.id] || '';
    if (value.trim() && !resolveOutpatientEmrFinalDictionaryItem(field, value)) {
      return {
        fieldId: field.id,
        fieldName: field.name,
        value,
      };
    }
  }
  return null;
}
