import type { AvailableMedicineInventoryCatalogItem } from '@features/clinical-result';
import type { HisHistoricalMedication } from '@/services/his/types';
import type { ChronicRefillCandidate } from './chronicRefillAssessment';

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function cleanMedicineName(value: string): string {
  return cleanText(value)
    .replace(/^[\s☆★*·•⊙]+/u, '')
    .replace(/[（(](?:[^）)]*\d[^）)]*|[^）)]*(?:片|粒|支|盒|瓶|袋)[^）)]*)[）)]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function medicineKey(value: string): string {
  return cleanMedicineName(value)
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
    .replace(/[\s,，、;；:：\-_/]/gu, '')
    .toLowerCase();
}

function dateText(value: number): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function formatStructuredRegimen(medication: HisHistoricalMedication): string {
  const dose = [cleanText(medication.dose), cleanText(medication.doseUnit)].filter(Boolean).join('');
  return [
    dose ? `每次${dose}` : '',
    cleanText(medication.frequency),
    cleanText(medication.route),
    cleanText(medication.days) ? `${cleanText(medication.days)}天` : '',
  ].filter(Boolean).join(' ');
}

function formatTextRegimen(value: string): string {
  const text = cleanText(value).replace(/^[\s☆★*·•⊙]+/u, '');
  const name = cleanMedicineName(value);
  return (name && text.startsWith(name) ? text.slice(name.length) : text)
    .replace(/^[\s:：,，、-]+/u, '')
    .trim()
    .slice(0, 120);
}

interface MedicationHistorySummary {
  name: string;
  visitCount: number;
  latestVisitTime: number;
  latestRegimen: string;
  regimens: Set<string>;
}

/**
 * 完整逐次历史保留在候选中供周期核查；模型只读取按药品聚合的最近方案摘要。
 */
export function buildCompactChronicRefillHistoryEvidence(
  candidate: ChronicRefillCandidate,
): string {
  const summaries = new Map<string, MedicationHistorySummary>();

  candidate.chronicVisits.forEach((visit) => {
    const visitMedications = (visit.medicationOrders || []).length > 0
      ? (visit.medicationOrders || []).map((medication) => ({
        name: medication.name,
        regimen: formatStructuredRegimen(medication),
      }))
      : (visit.medications || []).map((medication) => ({
        name: medication,
        regimen: formatTextRegimen(medication),
      }));
    const seenInVisit = new Set<string>();

    visitMedications.forEach(({ name, regimen }) => {
      const key = medicineKey(name);
      if (!key || seenInVisit.has(key)) return;
      seenInVisit.add(key);
      const current = summaries.get(key);
      const displayName = cleanMedicineName(name);
      if (!current) {
        summaries.set(key, {
          name: displayName,
          visitCount: 1,
          latestVisitTime: visit.visitTime,
          latestRegimen: regimen,
          regimens: new Set(regimen ? [regimen] : []),
        });
        return;
      }
      current.visitCount += 1;
      if (regimen) current.regimens.add(regimen);
      if (visit.visitTime > current.latestVisitTime) {
        current.latestVisitTime = visit.visitTime;
        current.latestRegimen = regimen;
        current.name = displayName;
      }
    });
  });

  if (summaries.size === 0) {
    candidate.medicationOrders?.forEach((medication) => {
      const key = medicineKey(medication.name);
      if (!key || summaries.has(key)) return;
      const regimen = formatStructuredRegimen(medication);
      summaries.set(key, {
        name: cleanMedicineName(medication.name),
        visitCount: 1,
        latestVisitTime: 0,
        latestRegimen: regimen,
        regimens: new Set(regimen ? [regimen] : []),
      });
    });
  }

  const rows = [...summaries.values()]
    .sort((left, right) => right.latestVisitTime - left.latestVisitTime)
    .map((item, index) => [
      `H${index + 1}|${item.name}`,
      item.latestVisitTime ? `最近${dateText(item.latestVisitTime)}` : '',
      `出现${item.visitCount}次`,
      item.latestRegimen ? `最近方案:${item.latestRegimen}` : '',
      item.regimens.size > 1 ? `另有${item.regimens.size - 1}种历史方案` : '',
    ].filter(Boolean).join('|'));

  return rows.length > 0 ? rows.join('\n') : '无可靠历史处方';
}

interface MedicationScopeGroup {
  ref: string;
  itemIds: string[];
  candidateConditionIds: string[];
  name: string;
  spec: string;
}

export interface ChronicRefillMedicationScopePromptContext {
  prompt: string;
  itemCount: number;
  groupCount: number;
  decode: (value: unknown) => unknown;
}

function readCompactAssignment(value: unknown): [string, string, 'high' | 'medium'] | null {
  if (!Array.isArray(value)) return null;
  const medicationRef = cleanText(value[0]);
  const conditionRef = cleanText(value[1]);
  const confidenceValue = cleanText(value[2]).toLowerCase();
  const confidence = confidenceValue === 'h' || confidenceValue === 'high'
    ? 'high'
    : (confidenceValue === 'm' || confidenceValue === 'medium' ? 'medium' : null);
  return medicationRef && conditionRef && confidence
    ? [medicationRef, conditionRef, confidence]
    : null;
}

/**
 * 短引用只在当前请求内有效；decode 后仍交给既有稳定 ID 白名单归一。
 */
export function buildChronicRefillMedicationScopePromptContext(
  candidate: ChronicRefillCandidate,
): ChronicRefillMedicationScopePromptContext {
  const items = candidate.medicationAttributions || [];
  if (items.length === 0) {
    return { prompt: '', itemCount: 0, groupCount: 0, decode: () => ({ assignments: [] }) };
  }

  const conditionIds = Array.from(new Set(items.flatMap((item) => item.candidateConditionIds)));
  const conditionRefById = new Map(conditionIds.map((id, index) => [id, `C${index + 1}`]));
  const conditionIdByRef = new Map([...conditionRefById].map(([id, ref]) => [ref, id]));
  const conditionNameById = new Map((candidate.conditions || []).map((item) => [item.id, item.diagnosis]));
  const groupsByKey = new Map<string, MedicationScopeGroup>();

  items.forEach((item) => {
    const candidateIds = [...item.candidateConditionIds].sort();
    const key = [medicineKey(item.medication.name), cleanText(item.medication.spec), candidateIds.join('|')].join('::');
    const existing = groupsByKey.get(key);
    if (existing) {
      existing.itemIds.push(item.id);
      return;
    }
    groupsByKey.set(key, {
      ref: `M${groupsByKey.size + 1}`,
      itemIds: [item.id],
      candidateConditionIds: candidateIds,
      name: cleanMedicineName(item.medication.name),
      spec: cleanText(item.medication.spec),
    });
  });

  const groups = [...groupsByKey.values()];
  const groupByRef = new Map(groups.map((group) => [group.ref, group]));
  const selectedRefs = candidate.diagnosisGroups
    .map((id) => conditionRefById.get(id))
    .filter((ref): ref is string => Boolean(ref));
  const prompt = JSON.stringify({
    selected: selectedRefs,
    conditions: conditionIds.map((id) => [conditionRefById.get(id), conditionNameById.get(id) || id]),
    medicines: groups.map((group) => [
      group.ref,
      group.name,
      group.spec,
      group.candidateConditionIds.map((id) => conditionRefById.get(id)).filter(Boolean),
    ]),
  });

  return {
    prompt,
    itemCount: items.length,
    groupCount: groups.length,
    decode(value: unknown): unknown {
      const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      if (Array.isArray(source.assignments)) return value;
      const accepted = Array.isArray(source.accepted) ? source.accepted : [];
      const seenGroups = new Set<string>();
      const assignments: Array<Record<string, string>> = [];
      accepted.forEach((entry) => {
        const decoded = readCompactAssignment(entry);
        if (!decoded) return;
        const [medicationRef, conditionRef, confidence] = decoded;
        if (seenGroups.has(medicationRef)) return;
        const group = groupByRef.get(medicationRef);
        const conditionId = conditionIdByRef.get(conditionRef);
        if (!group || !conditionId || !group.candidateConditionIds.includes(conditionId)) return;
        seenGroups.add(medicationRef);
        group.itemIds.forEach((itemId) => assignments.push({ itemId, conditionId, confidence }));
      });
      return { assignments };
    },
  };
}

export interface ChronicRefillInventoryPromptContext {
  prompt: string;
  byRef: ReadonlyMap<string, AvailableMedicineInventoryCatalogItem>;
}

export function buildChronicRefillInventoryPromptContext(
  items: AvailableMedicineInventoryCatalogItem[],
): ChronicRefillInventoryPromptContext {
  const byRef = new Map<string, AvailableMedicineInventoryCatalogItem>();
  const lines = items.map((item, index) => {
    const ref = `S${index + 1}`;
    byRef.set(ref, item);
    return [ref, cleanMedicineName(item.productName), cleanText(item.spec)].filter(Boolean).join('|');
  });
  return {
    byRef,
    prompt: [
      '【库存候选】',
      ...(lines.length > 0 ? lines : ['无']),
      '库存命中只返回ref；无合适库存时才返回规范通用名name。',
    ].join('\n'),
  };
}
