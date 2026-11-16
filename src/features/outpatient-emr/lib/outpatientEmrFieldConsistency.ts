import type { OutpatientEmrTemplateField } from '../types';
import { resolveOutpatientEmrFinalDictionaryItem } from './outpatientEmrDictionary';
import { findOutpatientEmrPresenceFlagSibling } from './outpatientEmrPromptGenerator';

export interface OutpatientEmrFieldConflict {
  flagFieldId: string;
  flagFieldName: string;
  detailFieldId: string;
  detailFieldName: string;
  message: string;
}

const POSITIVE_FLAG_TEXTS = new Set(['有', '是', '患有', '阳性', '可闻及', '触及', '存在']);
const NEGATIVE_FLAG_TEXTS = new Set(['否认', '无', '否', '阴性', '未闻及', '未触及', '不存在']);
const NEGATED_DETAIL_PATTERN = /^(?:否认|无|未|没有|否|阴性|不存在)/u;
const UNKNOWN_DETAIL_PATTERN = /^(?:不详|不清|未知)/u;

function compact(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, '');
}

function resolveFlagPolarity(
  field: OutpatientEmrTemplateField,
  value: string,
): 'positive' | 'negative' | null {
  const item = resolveOutpatientEmrFinalDictionaryItem(field, value);
  if (!item) return null;
  const text = compact(item.text);
  if (POSITIVE_FLAG_TEXTS.has(text) || text.startsWith('触及')) return 'positive';
  if (NEGATIVE_FLAG_TEXTS.has(text)) return 'negative';
  return null;
}

/**
 * Finds presence flags whose paired detail text says the opposite, e.g. 吸烟史标志=有 with
 * 吸烟史补充=“否认吸烟史”, or 高血压病史标志=否认 with a positive supplement. Pairs are
 * found by the same section and stem rule the prompt generator uses for flag-detail fields.
 */
export function findOutpatientEmrFieldConflicts(
  fields: readonly OutpatientEmrTemplateField[],
  fieldValues: Readonly<Record<string, string>>,
): OutpatientEmrFieldConflict[] {
  const conflicts: OutpatientEmrFieldConflict[] = [];
  fields.forEach((detailField) => {
    const flagField = findOutpatientEmrPresenceFlagSibling(detailField, fields);
    if (!flagField) return;
    const polarity = resolveFlagPolarity(flagField, fieldValues[flagField.id] || '');
    const detail = compact(fieldValues[detailField.id] || '').replace(/^[：:，,]+/u, '');
    if (!polarity || !detail || UNKNOWN_DETAIL_PATTERN.test(detail)) return;
    const detailNegated = NEGATED_DETAIL_PATTERN.test(detail);
    if (polarity === 'positive' && detailNegated) {
      conflicts.push({
        flagFieldId: flagField.id,
        flagFieldName: flagField.name,
        detailFieldId: detailField.id,
        detailFieldName: detailField.name,
        message: `“${flagField.name}”为阳性，但“${detailField.name}”写的是否认/无，请修改其中一项。`,
      });
    } else if (polarity === 'negative' && !detailNegated) {
      conflicts.push({
        flagFieldId: flagField.id,
        flagFieldName: flagField.name,
        detailFieldId: detailField.id,
        detailFieldName: detailField.name,
        message: `“${flagField.name}”为否认/无，但“${detailField.name}”写有阳性内容，请修改其中一项。`,
      });
    }
  });
  return conflicts;
}
