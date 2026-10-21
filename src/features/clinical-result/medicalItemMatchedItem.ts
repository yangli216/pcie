import type { MedicalItem } from '@/services/medicalData';
import type { TreatmentRecommendation } from '@/types/consultation';

export function buildMedicalItemMatchedItem(item: MedicalItem): TreatmentRecommendation['matchedItem'] {
  return {
    id: item.id,
    name: item.name,
    code: item.code,
    idSrv: item.idSrv,
    naSrv: item.naSrv,
    sdSrv: item.sdSrv,
    idDeptExec: item.idDeptExec,
    idPart: item.idPart,
    jsonField: item.jsonField,
    fgCheckOrd: item.fgCheckOrd,
    mutualRecognitionCode: item.mutualRecognitionCode || '',
    raw: item.raw,
  };
}
