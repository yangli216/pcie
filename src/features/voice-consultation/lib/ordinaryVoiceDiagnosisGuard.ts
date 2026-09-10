import type { DiagnosisHint, VoiceRecommendationPlan } from '@/prompts';

export interface OrdinaryVoiceDiagnosisGuardContext {
  /** 可包含 HIS 既往史、患者记忆和当次对话，用于识别旧 Prompt 中的历史诊断污染。 */
  historicalContextText?: string;
}

export interface OrdinaryVoiceWorkingDiagnosisContext {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
}

type MatchedDiagnosisHint = DiagnosisHint & {
  matchedItem?: { id: string; code: string; name: string } | null;
};

const HISTORY_ONLY_MISSING_INFORMATION = '该诊断缺少本次就诊证据，需结合当前主诉、现病史或查体重新确认';
const HISTORY_MARKER = /既往|病史|长期|慢病|基础病|多年|常年|曾诊断|既往诊断|历史记录|规律服药/u;
const CURRENT_VISIT_MARKER = /本次|此次|当前|今因|主诉|现病史|新发|复发|发作|加重|测得|复诊|续方|配药|随访|控制不佳/u;
const NEGATIVE_EVIDENCE_MARKER = /^(?:否认|无|未见|没有|未诉|不伴|基本没有|未发现)/u;
const CONTRADICTORY_EVIDENCE_MARKER = /(?:有|存在).{0,12}(?:也?没有|基本没有|不明显)|(?:没有|否认).{0,12}(?:但)?(?:有|存在)/u;
const SYMPTOM_SIGN_CODE = /^R\d{2}(?:\.|$)/iu;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s{}【】()（）,，。；;：:\-_/]/gu, '');
}

function buildDiagnosisSearchTerms(name: string): string[] {
  const normalized = normalizeSearchText(name);
  if (!normalized) return [];

  const terms = new Set<string>([normalized]);
  const withoutDiseaseSuffix = normalized.replace(/(?:疾病|病)$/u, '');
  if (withoutDiseaseSuffix.length >= 2) terms.add(withoutDiseaseSuffix);

  const withoutQualifier = withoutDiseaseSuffix.replace(
    /^(?:原发性|继发性|妊娠期|慢性|急性|1型|2型|i型|ii型)/u,
    '',
  );
  if (withoutQualifier.length >= 2) terms.add(withoutQualifier);

  return Array.from(terms).filter((term) => term.length >= 2);
}

function mentionsDiagnosis(text: string, diagnosisName: string): boolean {
  const normalizedText = normalizeSearchText(text);
  return buildDiagnosisSearchTerms(diagnosisName).some((term) => normalizedText.includes(term));
}

function isLegacyHistoryOnlyDiagnosis(
  diagnosis: DiagnosisHint,
  historicalContextText: string,
): boolean {
  if (!historicalContextText || !mentionsDiagnosis(historicalContextText, diagnosis.name)) {
    return false;
  }

  const directEvidence = [diagnosis.currentVisitEvidenceText, diagnosis.evidenceText]
    .map(normalizeText)
    .filter(Boolean)
    .join('；');
  const evidence = directEvidence || normalizeText(diagnosis.rationale);
  if (!evidence) return false;

  const evidenceClauses = evidence
    .split(/[。；;\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return evidenceClauses.length > 0 && evidenceClauses.every((clause) => (
    HISTORY_MARKER.test(clause) && !CURRENT_VISIT_MARKER.test(clause)
  ));
}

function shouldExcludeDiagnosis(
  diagnosis: DiagnosisHint,
  context: OrdinaryVoiceDiagnosisGuardContext,
): boolean {
  if (diagnosis.clinicalRole === 'history_only' || diagnosis.clinicalRole === 'risk_modifier') {
    return true;
  }
  if (diagnosis.evidenceScope === 'history_only') return true;

  const currentVisitEvidence = normalizeText(diagnosis.currentVisitEvidenceText);
  const historicalContextText = normalizeText(context.historicalContextText);
  if ((diagnosis.evidenceScope === 'current_visit' || diagnosis.evidenceScope === 'both')
    && currentVisitEvidence
    && isLegacyHistoryOnlyDiagnosis({
      ...diagnosis,
      evidenceText: currentVisitEvidence,
      currentVisitEvidenceText: '',
      rationale: '',
    }, historicalContextText)) {
    return true;
  }

  return diagnosis.evidenceScope === undefined
    && isLegacyHistoryOnlyDiagnosis(diagnosis, historicalContextText);
}

function shouldDowngradeDiagnosis(diagnosis: DiagnosisHint): boolean {
  if (diagnosis.clinicalRole === 'differential_cause') return true;
  if (diagnosis.evidenceScope === 'current_visit' || diagnosis.evidenceScope === 'both') {
    return !normalizeText(diagnosis.currentVisitEvidenceText);
  }
  return false;
}

/**
 * 普通语音诊断的历史/风险作用域门禁。
 *
 * 纯历史疾病与风险修饰项直接退出诊断建议区；证据不足但仍可能解释当前主诉的项目
 * 才降级为待鉴别。调用方必须显式限定 voice 渠道。
 */
export function guardOrdinaryVoiceDiagnosisHints<T extends DiagnosisHint>(
  diagnoses: readonly T[],
  context: OrdinaryVoiceDiagnosisGuardContext = {},
): T[] {
  const guarded: T[] = [];

  for (const diagnosis of diagnoses) {
    if (shouldExcludeDiagnosis(diagnosis, context)) continue;
    if (!shouldDowngradeDiagnosis(diagnosis)) {
      guarded.push(diagnosis);
      continue;
    }

    guarded.push({
      ...diagnosis,
      confidence: diagnosis.clinicalRole === 'differential_cause'
        ? diagnosis.confidence
        : 'low',
      suggestionType: 'differential',
      missingInformation: normalizeText(diagnosis.missingInformation) || HISTORY_ONLY_MISSING_INFORMATION,
    });
  }

  return guarded;
}

function getMatchedCode(diagnosis: MatchedDiagnosisHint): string {
  return normalizeText(diagnosis.matchedItem?.code || diagnosis.code);
}

function isSymptomOrSignDiagnosis(diagnosis: MatchedDiagnosisHint): boolean {
  return diagnosis.diagnosisKind === 'symptom_working' || SYMPTOM_SIGN_CODE.test(getMatchedCode(diagnosis));
}

function hasAffirmedCurrentVisitEvidence(diagnosis: DiagnosisHint): boolean {
  const evidence = normalizeText(diagnosis.currentVisitEvidenceText);
  if (!evidence || CONTRADICTORY_EVIDENCE_MARKER.test(evidence)) return false;

  const clauses = evidence
    .split(/[，,。；;\n]/u)
    .map((item) => item.trim())
    .filter(Boolean);
  return clauses.some((clause) => !NEGATIVE_EVIDENCE_MARKER.test(clause));
}

function hasCurrentComplaintGrounding(
  diagnosis: MatchedDiagnosisHint,
  context: OrdinaryVoiceWorkingDiagnosisContext,
): boolean {
  const currentRecordText = normalizeText([
    context.chiefComplaint,
    context.historyOfPresentIllness,
  ].filter(Boolean).join('；'));
  if (!currentRecordText) return true;
  if (mentionsDiagnosis(currentRecordText, diagnosis.name)
    || mentionsDiagnosis(currentRecordText, diagnosis.matchedItem?.name || '')) {
    return true;
  }

  const evidence = normalizeSearchText(normalizeText(diagnosis.currentVisitEvidenceText));
  const currentRecord = normalizeSearchText(currentRecordText);
  const genericBigrams = new Set(['本次', '患者', '出现', '症状', '伴有', '目前', '反复']);
  const evidenceBigrams = Array.from({ length: Math.max(0, evidence.length - 1) }, (_, index) => (
    evidence.slice(index, index + 2)
  )).filter((item) => !genericBigrams.has(item));
  return new Set(evidenceBigrams.filter((item) => currentRecord.includes(item))).size >= 2;
}

function isEligibleWorkingDiagnosis(
  diagnosis: MatchedDiagnosisHint,
  context: OrdinaryVoiceWorkingDiagnosisContext,
): boolean {
  return Boolean(
    diagnosis.matchedItem
    && SYMPTOM_SIGN_CODE.test(getMatchedCode(diagnosis))
    && (diagnosis.confidence === 'high' || diagnosis.confidence === 'medium')
    && (diagnosis.evidenceScope === 'current_visit' || diagnosis.evidenceScope === 'both')
    && diagnosis.clinicalRole !== 'differential_cause'
    && diagnosis.clinicalRole !== 'history_only'
    && diagnosis.clinicalRole !== 'risk_modifier'
    && diagnosis.sourceType !== 'uncertain'
    && hasAffirmedCurrentVisitEvidence(diagnosis)
    && hasCurrentComplaintGrounding(diagnosis, context)
  );
}

function isMatchedFormalDisease(diagnosis: MatchedDiagnosisHint): boolean {
  return Boolean(
    diagnosis.matchedItem
    && diagnosis.suggestionType !== 'differential'
    && diagnosis.confidence !== 'low'
    && !isSymptomOrSignDiagnosis(diagnosis)
    && diagnosis.clinicalRole !== 'differential_cause'
  );
}

/**
 * 没有可成立的病因性正式诊断时，最多把一个已匹配 R 类标准编码的本次肯定症状
 * 提升为症状性工作诊断。未匹配、低置信、否定/矛盾或仅历史证据均不会被提升。
 */
export function promoteOrdinaryVoiceSymptomWorkingDiagnosis<T extends MatchedDiagnosisHint>(
  diagnoses: readonly T[],
  context: OrdinaryVoiceWorkingDiagnosisContext = {},
): T[] {
  if (diagnoses.some(isMatchedFormalDisease)) {
    return diagnoses.filter((diagnosis) => !isSymptomOrSignDiagnosis(diagnosis));
  }

  const candidateIndexes = diagnoses
    .map((diagnosis, index) => ({ diagnosis, index }))
    .filter(({ diagnosis }) => isEligibleWorkingDiagnosis(diagnosis, context))
    .sort((left, right) => {
      const rank = (item: MatchedDiagnosisHint) => item.confidence === 'high' ? 2 : 1;
      return rank(right.diagnosis) - rank(left.diagnosis) || left.index - right.index;
    });
  const promotedIndex = candidateIndexes[0]?.index ?? -1;

  return diagnoses.flatMap((diagnosis, index) => {
    if (!isSymptomOrSignDiagnosis(diagnosis)) return [diagnosis];
    if (index === promotedIndex) {
      return [{
        ...diagnosis,
        clinicalRole: 'current_diagnosis',
        diagnosisKind: 'symptom_working',
        suggestionType: 'formal',
        missingInformation: '',
      }];
    }
    return [];
  });
}

/** 症状性工作诊断仅开放 AI 检查/检验分支；明确医嘱由独立链路保留。 */
export function constrainOrdinaryVoiceWorkingDiagnosisPlan(
  plan: VoiceRecommendationPlan,
  diagnoses: readonly MatchedDiagnosisHint[],
): VoiceRecommendationPlan {
  const hasWorkingDiagnosis = diagnoses.some((diagnosis) => (
    diagnosis.diagnosisKind === 'symptom_working' && diagnosis.suggestionType === 'formal'
  ));
  if (!hasWorkingDiagnosis || plan.mode === 'urgent_referral' || plan.mode === 'explicit_only') {
    return plan;
  }

  const allowedNow = plan.recommendNow.filter((type) => type === 'exam' || type === 'lab_test');
  const recommendNow = allowedNow.length > 0 ? allowedNow : ['exam', 'lab_test'] as const;
  const defer = Array.from(new Set([
    ...(plan.defer || []).filter((type) => type !== 'exam' && type !== 'lab_test'),
    'medicine' as const,
  ]));
  const skip = (plan.skip || []).filter((type) => type !== 'exam' && type !== 'lab_test');

  return {
    ...plan,
    mode: 'diagnostic_first',
    recommendNow: [...recommendNow],
    defer,
    skip,
    reason: normalizeText(plan.reason) || '当前仅形成症状性工作诊断，优先完善检查检验以明确病因',
    resumeCondition: plan.resumeCondition || 'report_available',
  };
}
