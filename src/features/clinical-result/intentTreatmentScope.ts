import type { ClinicalResultInput, ClinicalResultTreatment } from './clinicalResultContract';

type IntentTreatmentScopeResult = Pick<
  ClinicalResultInput,
  'channel' | 'treatments' | 'recommendationPolicy'
>;

/** 旧版慢病结果中由萧山健康处方推荐生成的检查/检验候选。 */
function isLegacyXiaoshanHealthPrescriptionTreatment(item: ClinicalResultTreatment): boolean {
  if (item.sourceType === 'explicit') return false;
  if (item.type !== 'examination' && item.type !== 'labTest') return false;
  return item.goalGroup?.trim() === '健康处方推荐'
    || item.text?.trim().startsWith('健康处方推荐') === true
    || item.evidenceText?.trim().startsWith('来源：getUserInfo') === true;
}

/** 结果页仅纳入当前渠道允许的治疗项，医生明确医嘱始终保留。 */
export function getAllowedIntentTreatments(
  result: IntentTreatmentScopeResult,
): ClinicalResultTreatment[] {
  const allowed = result.recommendationPolicy?.allowedTreatmentTypes;
  return result.treatments.filter((item) => {
    if (result.channel === 'chronic-refill' && isLegacyXiaoshanHealthPrescriptionTreatment(item)) {
      return false;
    }
    if (item.sourceType === 'explicit') return true;
    return !allowed || allowed.includes(item.type);
  });
}
