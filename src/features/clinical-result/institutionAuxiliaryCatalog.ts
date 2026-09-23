import { medicalDataService, type MedicalItem } from '@/services/medicalData';
import {
  getMedicalCatalogRestrictionReason,
  isRestrictedMedicalCatalogItem,
} from '@/services/medicalCatalogPolicy';
import type { TreatmentRecommendation } from '@/types/consultation';
import { buildMedicalItemMatchedItem } from './recommendationHelpers';

export interface AuxiliaryCatalogEntry {
  ref: string;
  type: 'exam' | 'lab_test';
  item: MedicalItem;
}

export interface InstitutionAuxiliaryCatalogContext {
  entries: AuxiliaryCatalogEntry[];
  promptContext: string;
  counts: { exam: number; labTest: number };
}

export interface AuxiliaryCatalogRecommendationItem {
  catalogRef?: string;
  goal?: string;
  goalGroup?: string;
  goalGroupPurpose?: string;
  necessity?: 'core' | 'supplementary';
  reason?: string;
}

export interface AuxiliaryCatalogRecommendationResponse {
  exams?: AuxiliaryCatalogRecommendationItem[];
  labTests?: AuxiliaryCatalogRecommendationItem[];
  unavailableNeeds?: string[];
}

export interface InstitutionAuxiliaryCatalogOptions {
  includeRestricted?: boolean;
}

function isCombinationItem(item: MedicalItem): boolean {
  const jsonField = (item.jsonField || '').trim();
  if (/fgCombination[^a-z0-9]*(?:true|1)/iu.test(jsonField)) return true;
  const rawFlag = item.raw?.fgCombination;
  if (rawFlag === true || rawFlag === 1 || rawFlag === '1') return true;
  const rawLabel = item.raw?.fgCombinationText;
  return /组合|套餐|成套/u.test(`${item.name} ${typeof rawLabel === 'string' ? rawLabel : ''}`);
}

function formatEntry(entry: AuxiliaryCatalogEntry): string {
  const restriction = getMedicalCatalogRestrictionReason(entry.item);
  const qualifiers: string[] = [];
  if (isCombinationItem(entry.item)) qualifiers.push('组合');
  if (restriction) qualifiers.push(`受限：${restriction}`);
  return [entry.ref, entry.item.name, ...qualifiers].join('|');
}

function prioritizeGeneralItems(items: MedicalItem[]): MedicalItem[] {
  return [...items].sort((left, right) => (
    Number(isRestrictedMedicalCatalogItem(left)) - Number(isRestrictedMedicalCatalogItem(right))
  ));
}

export function buildInstitutionAuxiliaryCatalogContext(
  items: MedicalItem[] = medicalDataService.getAllItems(),
  requestedTypes: Array<'exam' | 'lab_test'> = ['exam', 'lab_test'],
  options: InstitutionAuxiliaryCatalogOptions = {},
): InstitutionAuxiliaryCatalogContext {
  const eligibleItems = options.includeRestricted
    ? items
    : items.filter((item) => !isRestrictedMedicalCatalogItem(item));
  const exams = requestedTypes.includes('exam')
    ? prioritizeGeneralItems(eligibleItems.filter((item) => item.category === '检查'))
    : [];
  const labTests = requestedTypes.includes('lab_test')
    ? prioritizeGeneralItems(eligibleItems.filter((item) => item.category === '检验'))
    : [];
  const entries: AuxiliaryCatalogEntry[] = [
    ...exams.map((item, index) => ({
      ref: `E${String(index + 1).padStart(3, '0')}`,
      type: 'exam' as const,
      item,
    })),
    ...labTests.map((item, index) => ({
      ref: `L${String(index + 1).padStart(3, '0')}`,
      type: 'lab_test' as const,
      item,
    })),
  ];

  const examLines = entries.filter((entry) => entry.type === 'exam').map(formatEntry);
  const labLines = entries.filter((entry) => entry.type === 'lab_test').map(formatEntry);
  return {
    entries,
    counts: { exam: examLines.length, labTest: labLines.length },
    promptContext: [
      '格式：ref|项目名称[|组合][|受限：适用条件]；未标记即通用单项',
      '【检查目录】',
      examLines.length ? examLines.join('\n') : '无',
      '【检验目录】',
      labLines.length ? labLines.join('\n') : '无',
    ].join('\n'),
  };
}

export function mapAuxiliaryCatalogRecommendations(
  response: AuxiliaryCatalogRecommendationResponse,
  context: InstitutionAuxiliaryCatalogContext,
  requestedTypes: Array<'exam' | 'lab_test'>,
  normalize: (rec: Partial<TreatmentRecommendation>) => TreatmentRecommendation,
): TreatmentRecommendation[] {
  const byRef = new Map(context.entries.map((entry) => [entry.ref, entry]));
  const seen = new Set<string>();

  const mapItems = (
    items: AuxiliaryCatalogRecommendationItem[] | undefined,
    expectedType: 'exam' | 'lab_test',
  ): TreatmentRecommendation[] => {
    if (!requestedTypes.includes(expectedType) || !Array.isArray(items)) return [];
    return items.flatMap((recommendation) => {
      const ref = (recommendation.catalogRef || '').trim();
      const entry = byRef.get(ref);
      if (!entry || entry.type !== expectedType || seen.has(entry.item.id)) return [];
      const goal = (recommendation.goal || '').trim();
      const goalGroup = (recommendation.goalGroup || '').trim();
      const goalGroupPurpose = (recommendation.goalGroupPurpose || '').trim();
      const reason = (recommendation.reason || '').trim();
      const necessity = recommendation.necessity;
      if (
        !goal
        || !goalGroup
        || !goalGroupPurpose
        || !reason
        || (necessity !== 'core' && necessity !== 'supplementary')
      ) {
        return [];
      }
      seen.add(entry.item.id);
      return [normalize({
        type: expectedType,
        name: entry.item.name,
        originalName: entry.item.name,
        goal,
        goalGroup,
        goalGroupPurpose,
        necessity,
        reason,
        sourceType: 'inferred',
        matchedItem: buildMedicalItemMatchedItem(entry.item),
        matchStatus: 'exact',
        selected: false,
      })];
    });
  };

  return [
    ...mapItems(response.exams, 'exam'),
    ...mapItems(response.labTests, 'lab_test'),
  ];
}
