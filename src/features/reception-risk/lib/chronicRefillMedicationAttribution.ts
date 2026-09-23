import type { HisHistoricalMedication, HisVisitRecord } from '@/services/his/types';

export type ChronicRefillMedicationAttributionConfidence = 'high' | 'medium' | 'low';

export interface ChronicRefillMedicationAttributionCondition {
  id: string;
  diagnosis: string;
  diagnosisGroup: string;
}

export interface ChronicRefillMedicationAttributionItem {
  id: string;
  visitId?: string;
  visitTime: number;
  medication: HisHistoricalMedication;
  source: 'structured' | 'text';
  candidateConditionIds: string[];
  suggestedConditionId?: string;
  confidence?: ChronicRefillMedicationAttributionConfidence;
  reason?: string;
}

export interface ChronicRefillSelection {
  conditionIds: string[];
}

interface RawMedicationAttributionAssignment {
  itemId?: unknown;
  conditionId?: unknown;
  confidence?: unknown;
  reason?: unknown;
}

function normalizeMedicineName(value: string): string {
  return value
    .replace(/^[\s☆★*·•]+/u, '')
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
    .replace(/[\s,，、;；:：\-_/]/gu, '')
    .toLowerCase();
}

function sanitizeKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/gu, '_').slice(0, 80);
}

function medicationIdentity(medication: HisHistoricalMedication): string {
  return medication.orderId?.trim()
    || medication.productId?.trim()
    || normalizeMedicineName(medication.name)
    || 'medicine';
}

/**
 * 为同次多慢病、处方无法按诊断直接归属的药品生成稳定候选。
 * 结构化处方优先；只有结构化处方缺失时才使用文本药品兜底。
 */
export function buildChronicRefillMedicationAttributionItems(
  visit: HisVisitRecord,
  conditions: ChronicRefillMedicationAttributionCondition[],
): ChronicRefillMedicationAttributionItem[] {
  if (conditions.length < 2) return [];

  const structuredMedications = (visit.medicationOrders || [])
    .filter((medication) => Boolean(medication.name?.trim()));
  const source: 'structured' | 'text' = structuredMedications.length > 0 ? 'structured' : 'text';
  const medications = structuredMedications.length > 0
    ? structuredMedications
    : (visit.medications || [])
      .map((name) => name?.trim())
      .filter((name): name is string => Boolean(name))
      .map((name) => ({ name }));
  const visitKey = sanitizeKeyPart(visit.visitId?.trim() || String(visit.visitTime));
  const occurrenceByIdentity = new Map<string, number>();

  return medications.map((medication) => {
    const identity = sanitizeKeyPart(medicationIdentity(medication));
    const occurrence = occurrenceByIdentity.get(identity) || 0;
    occurrenceByIdentity.set(identity, occurrence + 1);
    return {
      id: `${visitKey}::${identity}::${occurrence}`,
      visitId: visit.visitId,
      visitTime: visit.visitTime,
      medication,
      source,
      candidateConditionIds: conditions.map((condition) => condition.id),
    };
  });
}

/**
 * 只接受模型对既有 item id 与候选 condition id 的归类，不允许模型新增药品或诊断。
 */
export function normalizeChronicRefillMedicationAttributions(
  items: ChronicRefillMedicationAttributionItem[],
  value: unknown,
): ChronicRefillMedicationAttributionItem[] {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const assignments = Array.isArray(source.assignments)
    ? source.assignments.filter((item): item is RawMedicationAttributionAssignment => (
      Boolean(item) && typeof item === 'object'
    ))
    : [];
  const assignmentById = new Map<string, RawMedicationAttributionAssignment>();
  assignments.forEach((assignment) => {
    const itemId = typeof assignment.itemId === 'string' ? assignment.itemId.trim() : '';
    if (itemId && !assignmentById.has(itemId)) assignmentById.set(itemId, assignment);
  });

  return items.map((item) => {
    const {
      suggestedConditionId: _suggestedConditionId,
      confidence: _confidence,
      reason: _reason,
      ...base
    } = item;
    const assignment = assignmentById.get(item.id);
    const conditionId = typeof assignment?.conditionId === 'string'
      ? assignment.conditionId.trim()
      : '';
    if (!conditionId || !item.candidateConditionIds.includes(conditionId)) return base;

    const confidence = assignment?.confidence === 'high'
      || assignment?.confidence === 'medium'
      || assignment?.confidence === 'low'
      ? assignment.confidence
      : 'low';
    const reason = typeof assignment?.reason === 'string'
      ? assignment.reason.replace(/\s+/gu, ' ').trim().slice(0, 30)
      : '';
    return {
      ...base,
      suggestedConditionId: conditionId,
      confidence,
      ...(reason ? { reason } : {}),
    };
  });
}

function isSameVisit(
  item: ChronicRefillMedicationAttributionItem,
  visit: HisVisitRecord,
): boolean {
  if (item.visitId && visit.visitId) return item.visitId === visit.visitId;
  return item.visitTime === visit.visitTime;
}

export function getAutoIncludedChronicRefillMedicationAttributions(
  items: ChronicRefillMedicationAttributionItem[],
  selectedConditionIds: ReadonlySet<string>,
): ChronicRefillMedicationAttributionItem[] {
  return items.filter((item) => (
    Boolean(item.suggestedConditionId)
    && selectedConditionIds.has(item.suggestedConditionId!)
    && (item.confidence === 'high' || item.confidence === 'medium')
  ));
}

/**
 * 诊断范围由医生确认后，只恢复 AI 高/中置信归入当前所选慢病的历史药品。
 */
export function selectAttributedChronicRefillVisitMedications(
  visit: HisVisitRecord,
  items: ChronicRefillMedicationAttributionItem[],
  selectedConditionIds: Set<string>,
): Pick<HisVisitRecord, 'medications' | 'medicationOrders'> {
  const attributed = getAutoIncludedChronicRefillMedicationAttributions(
    items,
    selectedConditionIds,
  ).filter((item) => isSameVisit(item, visit));
  if (attributed.length === 0) {
    return { medications: undefined, medicationOrders: undefined };
  }

  const originalTexts = visit.medications || [];
  const medications = Array.from(new Set(attributed.map((item) => {
    const normalizedName = normalizeMedicineName(item.medication.name);
    return originalTexts.find((text) => normalizeMedicineName(text) === normalizedName)
      || item.medication.name;
  })));
  const medicationOrders = attributed
    .filter((item) => item.source === 'structured')
    .map((item) => item.medication);

  return {
    medications,
    medicationOrders: medicationOrders.length > 0 ? medicationOrders : undefined,
  };
}

export function buildChronicRefillCandidateKey(
  diagnosisGroups: string[],
  visits: HisVisitRecord[],
): string {
  const visitKeys = visits.map((visit) => visit.visitId?.trim() || String(visit.visitTime));
  return `${diagnosisGroups.join('|')}::${visitKeys.join('|')}`;
}
