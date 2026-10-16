import {
  getChronicRefillConditionOptions,
  isReportFollowUpIntent,
  type ChronicRefillCandidate,
} from '@features/reception-risk/lib/chronicRefillAssessment';

export type VoiceChronicRefillRouteDecision =
  | {
      type: 'continue-ordinary-voice';
      reason: 'no-candidate' | 'not-refill-purpose' | 'report-follow-up' | 'clinical-change';
    }
  | {
      type: 'confirm-chronic-refill';
      reason: 'explicit-scope' | 'single-candidate';
      conditionIds: string[];
    }
  | {
      type: 'select-chronic-refill-scope';
      reason: 'multiple-candidates-without-explicit-scope';
    };

const REFILL_PURPOSE_PATTERN = /(?:复诊配药|续方|续药|配药|开药|取药|拿药|继续用药|继续服药)/u;
const REPORT_RESULT_PATTERN = /(?:报告|检查结果|检验结果|化验结果|影像结果|看结果|查看结果|解读结果)/u;
const CLINICAL_CHANGE_PATTERNS = [
  /(?:新发|突发|突然出现|近期出现|症状加重|病情加重|明显加重|恶化)/u,
  /(?:控制不佳|控制不好|控制不理想|控制不稳定|病情不稳定)/u,
  /(?:血压|血糖).{0,6}(?:明显升高|异常升高|很高|降不下来)/u,
];
const URGENT_TERMS = [
  '胸痛',
  '呼吸困难',
  '晕厥',
  '意识障碍',
  '偏瘫',
  '言语不清',
  '尿潴留',
  '排不出尿',
  '肉眼血尿',
  '高热',
];
const CLAUSE_BOUNDARY_PATTERN = /[，,；;。.!！？?]/u;
const NEGATION_PATTERN = /(?:无|未见|否认|没有|不伴|未出现)/u;

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, '').toLowerCase();
}

function hasAffirmedTerm(text: string, term: string): boolean {
  let fromIndex = 0;
  while (fromIndex < text.length) {
    const index = text.indexOf(term, fromIndex);
    if (index < 0) return false;
    const before = text.slice(0, index);
    let clauseStart = 0;
    for (let cursor = before.length - 1; cursor >= 0; cursor -= 1) {
      if (CLAUSE_BOUNDARY_PATTERN.test(before[cursor])) {
        clauseStart = cursor + 1;
        break;
      }
    }
    if (!NEGATION_PATTERN.test(before.slice(clauseStart))) return true;
    fromIndex = index + term.length;
  }
  return false;
}

function hasClinicalChange(text: string): boolean {
  return CLINICAL_CHANGE_PATTERNS.some((pattern) => pattern.test(text))
    || URGENT_TERMS.some((term) => hasAffirmedTerm(text, term));
}

function isConditionMentioned(
  text: string,
  condition: ReturnType<typeof getChronicRefillConditionOptions>[number],
): boolean {
  const names = Array.from(new Set([
    normalizeText(condition.diagnosis),
    normalizeText(condition.diagnosisGroup),
  ].filter(Boolean)));
  return names.some((name) => hasAffirmedTerm(text, name));
}

/**
 * 只做语音转写到门诊场景的确定性判定，不启动模型、不修改会话状态。
 * 慢病候选来自当前接诊机会，转写不能新增历史中不存在的续方诊断。
 */
export function resolveVoiceChronicRefillRoute(
  transcript: string,
  candidate: ChronicRefillCandidate | null | undefined,
): VoiceChronicRefillRouteDecision {
  if (!candidate) {
    return { type: 'continue-ordinary-voice', reason: 'no-candidate' };
  }

  const normalizedText = normalizeText(transcript);
  if (!REFILL_PURPOSE_PATTERN.test(normalizedText)) {
    return { type: 'continue-ordinary-voice', reason: 'not-refill-purpose' };
  }

  if (
    REPORT_RESULT_PATTERN.test(normalizedText)
    && isReportFollowUpIntent({ chiefComplaint: transcript })
  ) {
    return { type: 'continue-ordinary-voice', reason: 'report-follow-up' };
  }

  if (hasClinicalChange(normalizedText)) {
    return { type: 'continue-ordinary-voice', reason: 'clinical-change' };
  }

  const conditions = getChronicRefillConditionOptions(candidate);
  const explicitConditionIds = conditions
    .filter((condition) => isConditionMentioned(normalizedText, condition))
    .map((condition) => condition.id);
  if (explicitConditionIds.length > 0) {
    return {
      type: 'confirm-chronic-refill',
      reason: 'explicit-scope',
      conditionIds: explicitConditionIds,
    };
  }

  if (conditions.length === 1) {
    return {
      type: 'confirm-chronic-refill',
      reason: 'single-candidate',
      conditionIds: [conditions[0].id],
    };
  }

  return {
    type: 'select-chronic-refill-scope',
    reason: 'multiple-candidates-without-explicit-scope',
  };
}
