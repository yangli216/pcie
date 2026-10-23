import type { MedicalItem } from '@/services/medicalData';
import { isRestrictedMedicalCatalogItem } from '@/services/medicalCatalogPolicy';
import type { ChronicExaminationReminders } from '@features/clinical-result/clinicalResultContract';

type ReminderItem = ChronicExaminationReminders['items'][number];
type Rule = { key: string; category: '检验' | '检查'; names: readonly string[] };
const rules: readonly Rule[] = [
  { key: 'glycated-haemoglobin', category: '检验', names: ['糖化血红蛋白', '糖化血红蛋白测定'] },
  { key: 'homocysteine', category: '检验', names: ['同型半胱氨酸', '血同型半胱氨酸测定'] },
  { key: 'routine-ecg', category: '检查', names: ['心电图', '常规心电图', '常规心电图检查', '常规心电图检查费'] },
];

export function normalizeChronicExaminationName(value: string): string {
  return value.trim().replace(/\s+/gu, '').replace(/（/gu, '(').replace(/）/gu, ')').toLowerCase();
}
function ruleFor(name: string): Rule | undefined {
  const key = normalizeChronicExaminationName(name);
  return rules.find(rule => rule.names.some(value => normalizeChronicExaminationName(value) === key));
}
export function chronicExaminationConceptKey(name: string): string {
  const rule = ruleFor(name);
  return rule ? `concept:${rule.key}` : `name:${normalizeChronicExaminationName(name)}`;
}
export function sameChronicExaminationConcept(left: string, right: string): boolean {
  return chronicExaminationConceptKey(left) === chronicExaminationConceptKey(right);
}
export function chronicExaminationCategory(name: string): '检验' | '检查' | undefined {
  return ruleFor(name)?.category;
}

function combinationIssue(item: MedicalItem, requireSingle: boolean): boolean {
  if (typeof item.raw?.fgCombinationText === 'string'
    && /^(组合|组合项|组套|套餐|成套|LIS_GROUP)$/iu.test(item.raw.fgCombinationText.trim())) return true;
  const flags: unknown[] = [];
  if (item.raw?.fgCombination !== undefined) flags.push(item.raw.fgCombination);
  for (const json of [item.jsonField, item.raw?.jsonField]) {
    if (json === undefined || json === '') continue;
    if (typeof json !== 'string') return true;
    try {
      const value = JSON.parse(json);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
      if (value.fgCombination !== undefined) flags.push(value.fgCombination);
    } catch { return true; }
  }
  // 1 = clinical combination, 2 = LIS group. Unknown flags fail closed too.
  if (flags.some(flag => flag !== '0' && flag !== 0 && flag !== false)) return true;
  return requireSingle && flags.length === 0;
}
function unresolvedPart(item: MedicalItem): boolean {
  const part = item.idPart?.trim() || '';
  const rawPart = typeof item.raw?.idPart === 'string' ? item.raw.idPart.trim() : '';
  if (rawPart && rawPart !== part) return true;
  const required = item.raw?.fgPart;
  return required !== undefined && required !== false && required !== 0 && required !== '0' && !part;
}

/** Fixed full-name relationships; all candidates participate before any safety filtering. */
export function matchChronicExaminationCatalog(
  recommendation: { name: string; subItems: string[] }, catalog: MedicalItem[],
): { item?: MedicalItem; status: ReminderItem['matchStatus']; issue?: ReminderItem['matchIssue'] } {
  const rule = ruleFor(recommendation.name);
  const names = new Set((rule?.names || [recommendation.name]).map(normalizeChronicExaminationName));
  const candidates = catalog.filter(item => (
    (rule ? item.category === rule.category : item.category === '检验' || item.category === '检查')
    && !isRestrictedMedicalCatalogItem(item)
    && (names.has(normalizeChronicExaminationName(item.name))
      // A decorated name sharing a known base service must not silently disappear
      // from uniqueness checks (e.g. another body part / expanded ECG service).
      || (rule?.category === '检查' && names.has(normalizeChronicExaminationName(item.naSrv || ''))))
  ));
  if (candidates.length === 0) return { status: 'unmatched' };
  if (candidates.length > 1) return { status: 'ambiguous', issue: 'multiple_items' };
  const item = candidates[0];
  if ((rule && recommendation.subItems.some(name => !sameChronicExaminationConcept(name, recommendation.name)))
    || combinationIssue(item, rule?.category === '检验')) {
    return { status: 'ambiguous', issue: 'unverified_group' };
  }
  if (!names.has(normalizeChronicExaminationName(item.name)) || unresolvedPart(item)) {
    return { status: 'ambiguous', issue: 'unverified_part' };
  }
  return { item, status: 'matched' };
}
