import type { VoiceRecommendationPlan, VoiceRecommendationType } from '@/prompts';

const TYPES: VoiceRecommendationType[] = ['medicine', 'exam', 'lab_test'];
const MODES = ['diagnostic_first', 'treatment_first', 'parallel', 'explicit_only', 'urgent_referral'];
const CONFIDENCES = ['high', 'medium', 'low'];
const types = (value: unknown): VoiceRecommendationType[] => (
  Array.isArray(value) ? TYPES.filter(type => value.includes(type)) : []
);

export const VOICE_ROUTING_RULES = '【运行诊断与路由门禁】diagnoses每项必须含clinicalRole、diagnosisKind、evidenceScope；current_visit/both必须含currentVisitEvidenceText。'
  + 'history_only/risk_modifier不得输出。有当前证据的初步病因诊断可formal，不要求先排除全部其他疾病；否则本次明确症状最多输出1项symptom_working formal，并使用diagnostic_first，仅推荐exam/lab_test、defer medicine。'
  + '先判断urgent_referral和explicit_only；置信度不得扩大推荐范围；recommendNow/defer/skip互斥且允许为空。'
  + 'explicit_orders只含医生本次明确决定，name非空，type限medicine/examination/labTest/procedure。'
  + 'history_context必须分别包含menstrualHistory和maritalReproductiveHistory；仅女性且14≤周岁年龄<60时可写明确事实，其余患者均为空，且不得推断当前妊娠。';

export function normalizeRecommendationPlan(value: VoiceRecommendationPlan | undefined): VoiceRecommendationPlan {
  const mode = value && MODES.includes(value.mode) ? value.mode : 'parallel';
  const confidence = value?.confidence && CONFIDENCES.includes(value.confidence) ? value.confidence : 'low';
  const defer = types(value?.defer);
  if (mode === 'diagnostic_first' && !defer.includes('medicine')) defer.unshift('medicine');
  const skip = types(value?.skip).filter(type => !defer.includes(type));
  const blocked = mode === 'urgent_referral' || mode === 'explicit_only';
  const recommendNow = blocked ? [] : types(value?.recommendNow)
    .filter(type => !defer.includes(type) && !skip.includes(type));
  return {
    mode, confidence, recommendNow, defer, skip,
    reason: typeof value?.reason === 'string' ? value.reason.trim() : '',
    resumeCondition: value?.resumeCondition === 'report_available' || value?.resumeCondition === 'doctor_request'
      ? value.resumeCondition : mode === 'diagnostic_first' ? 'report_available' : '',
  };
}

/** Only whitelisted enums/counts enter the console; never echo model reasoning or names. */
export function buildVoiceRoutingDecisionSummary(
  raw: VoiceRecommendationPlan | undefined,
  final: VoiceRecommendationPlan,
  diagnoses: ReadonlyArray<{ diagnosisKind?: string; suggestionType?: string }>,
): string {
  const working = diagnoses.filter(item => item.diagnosisKind === 'symptom_working' && item.suggestionType === 'formal').length;
  const disease = diagnoses.filter(item => item.diagnosisKind === 'disease' && item.suggestionType === 'formal').length;
  const differential = diagnoses.filter(item => item.suggestionType === 'differential').length;
  const list = (items: VoiceRecommendationType[] | undefined) => types(items).join(',') || '无';
  const reasons = [
    !raw && '路由缺失不扩展',
    (!raw?.confidence || raw.confidence === 'low') && '低置信不扩展',
    final.mode === 'diagnostic_first' && '先检查暂缓药品',
    working > 0 && '症状性工作诊断限制',
    (final.mode === 'urgent_referral' || final.mode === 'explicit_only') && '关闭自动推荐',
    types(raw?.recommendNow).some(type => !final.recommendNow.includes(type)) && '剔除受限或冲突分支',
  ].filter(Boolean);
  return `模型路由=${raw && MODES.includes(raw.mode) ? raw.mode : '缺失/无效'} confidence=${raw?.confidence && CONFIDENCES.includes(raw.confidence) ? raw.confidence : '缺失/无效'}`
    + ` now=[${list(raw?.recommendNow)}] defer=[${list(raw?.defer)}] skip=[${list(raw?.skip)}]\n`
    + `诊断角色：正式疾病=${disease} 症状性工作诊断=${working} 待鉴别=${differential}\n`
    + `最终路由=${final.mode} now=[${list(final.recommendNow)}] defer=[${list(final.defer)}] skip=[${list(final.skip)}]\n`
    + `规则=${reasons.join('；') || '沿用有效模型分支'}`;
}
