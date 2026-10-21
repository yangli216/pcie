import { buildMedicalItemMatchedItem } from './medicalItemMatchedItem';
export { buildMedicalItemMatchedItem } from './medicalItemMatchedItem';
import type { Diagnosis, TreatmentRecommendation } from '../../types/consultation';
import {
  medicalDataService,
  type MedicalItem,
  type MedicineItem,
} from '../../services/medicalData';
import { resolveRememberedCatalogTarget } from './manualMatchCache';

export type TreatmentMatchLabelStyle = 'compact' | 'detailed';

export function getClinicalDiagnosisIdentity(
  diagnosis: Pick<Diagnosis, 'code' | 'name'> | null | undefined,
): string {
  if (!diagnosis) return '';
  return `${diagnosis.code || ''}:${diagnosis.name || ''}`;
}

export function getTreatmentEditorKey(rec: TreatmentRecommendation): string {
  return `editor:${rec.type}:${rec.matchedItem?.id || rec.name}`;
}

export function getTreatmentEditorFieldKey(rec: TreatmentRecommendation, field: string): string {
  return `${getTreatmentEditorKey(rec)}:${field}`;
}

export function getReasonTooltipKey(kind: 'diagnosis' | 'treatment', primary: string, secondary = ''): string {
  return `${kind}:${primary}:${secondary}`;
}

export function buildDiagnosisFeedbackSnapshot(
  diag: Diagnosis,
  options: {
    selected: boolean;
    primary?: boolean;
  }
): Record<string, unknown> {
  return {
    id: diag.id || '',
    code: diag.code || '',
    name: diag.name || '',
    rationale: diag.rationale || '',
    selected: options.selected,
    primary: options.primary ?? options.selected,
  };
}

export function buildTreatmentFeedbackSnapshot(rec: TreatmentRecommendation): Record<string, unknown> {
  return {
    type: rec.type,
    name: rec.name,
    originalName: rec.originalName || '',
    reason: rec.reason || '',
    selected: !!rec.selected,
    matchedItem: rec.matchedItem || null,
    matchStatus: rec.matchStatus || 'unmatched',
    dosage: rec.dosage || '',
    dosageUnit: rec.dosageUnit || '',
    frequency: rec.frequency || '',
    route: rec.route || '',
    totalQty: rec.totalQty || '',
    totalUnit: rec.totalUnit || '',
    pharmacy: rec.pharmacy || '',
    execDept: rec.execDept || '',
    insuranceType: rec.insuranceType || '',
    bodySite: rec.bodySite || '',
    bodySiteId: rec.bodySiteId || '',
  };
}

export function hasProbableMatch(rec: TreatmentRecommendation): boolean {
  return rec.matchStatus === 'probable' && !!rec.suggestedMatchItem;
}

export function getSuggestedMatchName(rec: TreatmentRecommendation): string {
  return (rec.suggestedMatchItem?.name || '').trim();
}

export function getTreatmentSpec(rec: TreatmentRecommendation): string {
  return rec.type === 'medicine' ? rec.spec || rec.matchedItem?.spec || '' : '';
}

export function getMedicineManufacturer(rec: TreatmentRecommendation): string {
  return rec.type === 'medicine'
    ? String(rec.matchedItem?.manufacturer || '').trim()
    : '';
}

export function getTreatmentOriginalName(rec: TreatmentRecommendation): string {
  if (
    rec.sourceType !== 'explicit'
    && rec.matchStatus !== 'manual'
    && rec.matchStatus !== 'confirmed'
  ) {
    return '';
  }

  const originalName = (rec.originalName || '').trim();
  if (!originalName || originalName === rec.name) {
    return '';
  }

  return originalName;
}

export function getTreatmentMatchLabel(
  rec: TreatmentRecommendation,
  style: TreatmentMatchLabelStyle = 'compact'
): string {
  if (style === 'detailed') {
    if (rec.matchStatus === 'manual') return '已手动匹配';
    if (rec.matchStatus === 'confirmed') return '已确认匹配';
    if (rec.matchStatus === 'exact') return '匹配成功';
    if (rec.matchStatus === 'probable') return '待确认';
    if (!rec.matchedItem) return '';
    return '匹配成功';
  }

  if (rec.matchStatus === 'manual') return '已匹配';
  if (rec.matchStatus === 'confirmed') return '已匹配';
  if (rec.matchStatus === 'exact') return '已匹配';
  if (rec.matchStatus === 'probable') return '待确认';
  if (rec.matchedItem) return '已匹配';
  return '未匹配';
}

export function buildMedicineMatchedItem(item: MedicineItem): TreatmentRecommendation['matchedItem'] {
  return {
    id: item.id,
    name: item.name,
    spec: item.spec,
    storeIds: Array.isArray(item.storeIds)
      ? Array.from(new Set(item.storeIds.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)))
      : [],
    idSrv: item.idSrv,
    naSrv: item.naSrv,
    sdSrv: item.sdSrv,
    idDeptExec: item.idDeptExec,
    fgCheckOrd: item.fgCheckOrd,
    fgSkintest: item.fgSkintest,
    raw: item.raw,
  };
}


export function assessTreatmentCatalogMatch(
  type: TreatmentRecommendation['type'],
  name: string,
  aliases?: string[],
  spec?: string,
): Pick<TreatmentRecommendation, 'matchedItem' | 'suggestedMatchItem' | 'matchStatus'> {
  const remembered = resolveRememberedCatalogTarget(type, name);
  if (remembered) {
    return {
      matchedItem: type === 'medicine' && 'spec' in remembered
        ? buildMedicineMatchedItem(remembered)
        : buildMedicalItemMatchedItem(remembered as MedicalItem),
      suggestedMatchItem: undefined,
      matchStatus: 'confirmed',
    };
  }

  switch (type) {
    case 'medicine': {
      const result = medicalDataService.assessMedicineMatch(name, aliases, spec);
      return {
        matchedItem: result.status === 'exact' && result.candidate ? buildMedicineMatchedItem(result.candidate) : undefined,
        suggestedMatchItem: result.status === 'probable' && result.candidate ? buildMedicineMatchedItem(result.candidate) : undefined,
        matchStatus: result.status,
      };
    }
    case 'exam': {
      const result = medicalDataService.assessExamItemMatch(name, aliases);
      return {
        matchedItem: result.status === 'exact' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        suggestedMatchItem: result.status === 'probable' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        matchStatus: result.status,
      };
    }
    case 'lab_test': {
      const result = medicalDataService.assessLabTestItemMatch(name, aliases);
      return {
        matchedItem: result.status === 'exact' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        suggestedMatchItem: result.status === 'probable' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        matchStatus: result.status,
      };
    }
    case 'procedure': {
      const result = medicalDataService.assessProcedureItemMatch(name, aliases);
      return {
        matchedItem: result.status === 'exact' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        suggestedMatchItem: result.status === 'probable' && result.candidate ? buildMedicalItemMatchedItem(result.candidate) : undefined,
        matchStatus: result.status,
      };
    }
    default:
      return {
        matchedItem: undefined,
        suggestedMatchItem: undefined,
        matchStatus: 'unmatched',
      };
  }
}
