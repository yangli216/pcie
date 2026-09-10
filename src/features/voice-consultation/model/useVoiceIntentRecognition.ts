/**
 * 语音意图识别 Composable
 *
 * 处理流程: ASR 转写文本 → LLM 意图识别 → 结构化提取 → 医疗数据匹配
 * 处理模式: 句段批处理（录制停止后一次性处理）
 */

import { ref } from 'vue';
import { chat, chatStream, type ChatMessage } from '@/services/llm';
import { isTestModeEnabled } from '@/services/aliyunSpeech';
import { medicalDataService } from '@/services/medicalData';
import {
  buildOutpatientRecord,
  assessTreatmentCatalogMatch,
  extractExplicitClinicalRecordFacts,
  extractLLMJsonCandidate,
  mergeStructuredNegativeSymptoms,
  normalizeClinicalRecordFactSuggestions,
  normalizeGeneratedClinicalRecordNarrative,
  type ClinicalResultGenerationSection,
  type ClinicalResultInput,
  type ClinicalResultMatchedDiagnosis,
  type ClinicalResultMatchedTreatment,
} from '@features/clinical-result';
import {
  PROMPTS,
  withOverride,
  type VoiceExtractionResult,
  type VoiceRecordDraft,
  type VoiceRecommendationPlan,
  type VoiceRecommendationType,
  type TreatmentHint,
  type DiagnosisHint,
} from '@/prompts';
import { trackError } from '@/services/operationTracker';
import {
  applyVoiceIntentStreamEvent,
  createVoiceIntentStreamAccumulator,
  createVoiceIntentStreamParser,
  sanitizeVoiceExtractionTreatmentSections,
} from './voiceIntentStream';
import { resolveExplicitTreatmentCatalogHints } from './explicitTreatmentCatalogResolver';
import {
  constrainOrdinaryVoiceWorkingDiagnosisPlan,
  guardOrdinaryVoiceDiagnosisHints,
  promoteOrdinaryVoiceSymptomWorkingDiagnosis,
} from '../lib/ordinaryVoiceDiagnosisGuard';

/** Mock 模式下缓存的意图识别结果，避免重复调用 LLM */
let cachedTestModeTranscript = '';
let cachedTestModeResult: VoiceIntentResult | null = null;

export type MatchedTreatment = ClinicalResultMatchedTreatment;
export type MatchedDiagnosis = ClinicalResultMatchedDiagnosis;
export type VoiceIntentResult = ClinicalResultInput;

interface NormalizedVoiceExtractionResult {
  recordDraft: VoiceRecordDraft;
  diagnosisHints: DiagnosisHint[];
  treatmentHints: TreatmentHint[];
  recommendationPlan: VoiceRecommendationPlan;
  recordFactSuggestions: NonNullable<VoiceExtractionResult['recordFactSuggestions']>;
  error: boolean;
  message?: string;
}

export interface VoiceIntentProgress {
  result: VoiceIntentResult;
  readySections: ClinicalResultGenerationSection[];
}

interface VoiceIntentDebugSnapshot {
  transcript: string;
  rawOutput?: string;
  normalizedExtraction?: NormalizedVoiceExtractionResult;
  result?: VoiceIntentResult;
  matchedDiagnoses?: MatchedDiagnosis[];
  matchedTreatments?: MatchedTreatment[];
  excludedTreatments?: Array<{ treatment: MatchedTreatment; reason: 'conditional' | 'historical-self-medication' }>;
  repairUsed?: boolean;
  protocolWarnings?: string[];
  fromCache?: boolean;
  errorMessage?: string;
}

interface TreatmentSegregationResult {
  currentTreatments: MatchedTreatment[];
  deferredPlanNotes: string[];
  historicalMedicationNotes: string[];
  excludedTreatments: Array<{ treatment: MatchedTreatment; reason: 'conditional' | 'historical-self-medication' }>;
}

interface ParsedVoiceExtractionResult {
  payload: VoiceExtractionResult | null;
  issues: string[];
  warnings: string[];
}

let cachedTestModeDebugSnapshot: VoiceIntentDebugSnapshot | null = null;

function publishVoiceIntentDebug(snapshot: VoiceIntentDebugSnapshot): void {
  const debugHost = globalThis as typeof globalThis & {
    __voiceIntentDebug__?: VoiceIntentDebugSnapshot;
  };

  debugHost.__voiceIntentDebug__ = snapshot;

  console.groupCollapsed('[VoiceIntent] Debug snapshot');
  console.log('Transcript:', snapshot.transcript);
  if (snapshot.rawOutput) {
    console.log('Raw LLM output:', snapshot.rawOutput);
  }
  if (snapshot.normalizedExtraction) {
    console.log('Normalized extraction:', snapshot.normalizedExtraction);
  }
  if (snapshot.matchedDiagnoses) {
    console.log('Matched diagnoses:', snapshot.matchedDiagnoses);
  }
  if (snapshot.matchedTreatments) {
    console.log('Matched treatments:', snapshot.matchedTreatments);
  }
  if (snapshot.result) {
    console.log('Voice intent result:', snapshot.result);
  }
  if (snapshot.errorMessage) {
    console.warn('Voice intent error:', snapshot.errorMessage);
  }
  if (snapshot.protocolWarnings?.length) {
    console.warn('Voice intent protocol warnings:', snapshot.protocolWarnings);
  }
  if (snapshot.fromCache) {
    console.info('Snapshot source: test-mode cache');
  }
  console.groupEnd();
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function splitValueAndUnit(value: string, knownUnits: string[]): { value: string; unit: string } {
  const normalized = value.trim();
  if (!normalized) {
    return { value: '', unit: '' };
  }

  const matchedUnit = knownUnits.find((unit) => normalized.endsWith(unit));
  if (!matchedUnit) {
    return { value: normalized, unit: '' };
  }

  return {
    value: normalized.slice(0, -matchedUnit.length).trim(),
    unit: matchedUnit,
  };
}

function getTextList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => getText(item))
    .filter(Boolean);
}

function getHintSourceType(value: unknown): 'explicit' | 'inferred' | 'uncertain' {
  if (value === 'explicit' || value === 'inferred' || value === 'uncertain') {
    return value;
  }

  return 'explicit';
}

function getDiagnosisEvidenceScope(
  value: unknown,
): DiagnosisHint['evidenceScope'] {
  if (value === 'current_visit' || value === 'history_only' || value === 'both') {
    return value;
  }

  return undefined;
}

function getDiagnosisClinicalRole(value: unknown): DiagnosisHint['clinicalRole'] {
  if (value === 'current_diagnosis'
    || value === 'differential_cause'
    || value === 'risk_modifier'
    || value === 'history_only') {
    return value;
  }
  return undefined;
}

function getDiagnosisKind(value: unknown): DiagnosisHint['diagnosisKind'] {
  if (value === 'disease' || value === 'symptom_working') return value;
  return undefined;
}

function composePastMedicalHistory(recordDraft: VoiceRecordDraft): string {
  const pastMedicalHistory = getText(recordDraft.pastMedicalHistory);
  if (!pastMedicalHistory || pastMedicalHistory === '无特殊') {
    return '';
  }
  return /^既往史[:：]/u.test(pastMedicalHistory) ? pastMedicalHistory : `既往史：${pastMedicalHistory}`;
}

function normalizeDiagnosisHints(hints: DiagnosisHint[] | undefined): DiagnosisHint[] {
  if (!Array.isArray(hints)) {
    return [];
  }

  return hints
    .map((hint) => ({
      ...hint,
      name: getText(hint?.name),
      code: getText(hint?.code),
      clinicalRole: getDiagnosisClinicalRole(hint?.clinicalRole),
      diagnosisKind: getDiagnosisKind(hint?.diagnosisKind),
      evidenceText: getText(hint?.evidenceText),
      evidenceScope: getDiagnosisEvidenceScope(hint?.evidenceScope),
      currentVisitEvidenceText: getText(hint?.currentVisitEvidenceText),
      sourceType: getHintSourceType(hint?.sourceType),
      rationale: getText(hint?.rationale),
      confidence: hint?.confidence === 'high' || hint?.confidence === 'medium' || hint?.confidence === 'low'
        ? hint.confidence
        : undefined,
      suggestionType: hint?.suggestionType === 'differential'
        || (hint?.suggestionType !== 'formal' && (hint?.sourceType === 'uncertain' || hint?.confidence === 'low'))
        ? 'differential' as const
        : 'formal' as const,
      missingInformation: getText(hint?.missingInformation),
    }))
    .filter((hint) => hint.name);
}

function normalizeTreatmentHints(hints: TreatmentHint[] | undefined): TreatmentHint[] {
  if (!Array.isArray(hints)) {
    return [];
  }

  return hints
    .map((hint) => {
      const legacyHint = hint as TreatmentHint & { specification?: unknown; count?: unknown };
      const rawType = (hint as unknown as { type?: string })?.type;
      const normalizedType = rawType === 'exam'
        ? 'examination'
        : rawType === 'lab_test'
          ? 'labTest'
          : hint?.type;
      const rawDosage = getText(hint?.dosage);
      const rawDosageUnit = getText(hint?.dosageUnit);
      const dosageParts = rawDosageUnit
        ? { value: rawDosage, unit: rawDosageUnit }
        : splitValueAndUnit(rawDosage, ['mg', 'g', 'ml', 'ug', '片', '粒', '支', '袋']);
      const rawTotalQty = getText(hint?.totalQty || legacyHint.count);
      const rawTotalUnit = getText(hint?.totalUnit);
      const totalParts = rawTotalUnit
        ? { value: rawTotalQty, unit: rawTotalUnit }
        : splitValueAndUnit(rawTotalQty, ['盒', '瓶', '袋', '支', '片', '粒', '次', 'ml', 'mg', 'g']);
      const isMedicine = hint?.type === 'medicine';

      return {
        ...hint,
        type: normalizedType as TreatmentHint['type'],
        name: getText(hint?.name),
        aliases: getTextList((hint as TreatmentHint & { aliases?: unknown }).aliases)
          .map((item) => item.trim())
          .filter(Boolean)
          .filter((item, index, list) => list.indexOf(item) === index)
          .filter((item) => item !== getText(hint?.name)),
        text: getText(hint?.text),
        evidenceText: getText(hint?.evidenceText || hint?.text),
        sourceType: getHintSourceType(hint?.sourceType),
        goal: getText(hint?.goal),
        spec: getText(hint?.spec || legacyHint.specification),
        targetDose: getText(hint?.targetDose),
        targetDoseUnit: getText(hint?.targetDoseUnit),
        dosage: dosageParts.value,
        dosageUnit: dosageParts.unit,
        frequency: getText(hint?.frequency),
        frequencyKey: getText(hint?.frequencyKey),
        usage: getText(hint?.usage),
        usageKey: getText(hint?.usageKey),
        totalQty: isMedicine ? '' : totalParts.value,
        totalUnit: isMedicine ? '' : totalParts.unit,
        count: getText(legacyHint.count),
        days: getText(hint?.days),
      };
    })
    .filter((hint) => hint.name);
}

const RECOMMENDATION_TYPES: VoiceRecommendationType[] = ['medicine', 'exam', 'lab_test'];

function normalizeRecommendationTypes(value: unknown): VoiceRecommendationType[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter(
    (item): item is VoiceRecommendationType => RECOMMENDATION_TYPES.includes(item as VoiceRecommendationType),
  )));
}

function normalizeRecommendationPlan(value: VoiceRecommendationPlan | undefined): VoiceRecommendationPlan {
  const mode = value?.mode;
  const normalizedMode = mode === 'diagnostic_first'
    || mode === 'treatment_first'
    || mode === 'parallel'
    || mode === 'explicit_only'
    || mode === 'urgent_referral'
    ? mode
    : 'parallel';
  const confidence = value?.confidence === 'high' || value?.confidence === 'medium' || value?.confidence === 'low'
    ? value.confidence
    : 'low';
  const requested = normalizeRecommendationTypes(value?.recommendNow);
  const recommendNow = confidence === 'low' && normalizedMode !== 'explicit_only' && normalizedMode !== 'urgent_referral'
    ? [...RECOMMENDATION_TYPES]
    : requested;

  return {
    mode: normalizedMode,
    recommendNow,
    defer: normalizeRecommendationTypes(value?.defer),
    skip: normalizeRecommendationTypes(value?.skip),
    reason: getText(value?.reason),
    resumeCondition: value?.resumeCondition === 'report_available' || value?.resumeCondition === 'doctor_request'
      ? value.resumeCondition
      : '',
    confidence,
  };
}

function mapRecommendationTypeToClinicalType(
  type: VoiceRecommendationType,
): 'medicine' | 'examination' | 'labTest' | 'procedure' {
  if (type === 'exam') return 'examination';
  if (type === 'lab_test') return 'labTest';
  return type;
}

function normalizeSentence(value: string): string {
  return value.trim().replace(/[。；;，,\s]+$/u, '');
}

function getTreatmentEvidenceCorpus(hint: Pick<TreatmentHint, 'name' | 'evidenceText' | 'text' | 'goal'>): string {
  return normalizeSentence([hint.name, hint.evidenceText, hint.text, hint.goal].filter(Boolean).join(' '));
}

function isConditionalTreatmentHint(hint: TreatmentHint): boolean {
  const corpus = getTreatmentEvidenceCorpus(hint);
  return /如果|若|待|查完|结果出来|结果回报|明确后|必要时|再用|再考虑|细菌感染就|病毒感染就|视情况/u.test(corpus);
}

function isHistoricalSelfMedicationHint(hint: TreatmentHint): boolean {
  const corpus = getTreatmentEvidenceCorpus(hint);
  return /吃了|已服用|已经服用|自行服用|自服|服用过|在家服用|院外已用/u.test(corpus);
}

function buildDeferredTreatmentNote(hint: TreatmentHint): string {
  const corpus = getTreatmentEvidenceCorpus(hint);
  if (/血常规|CRP|C反应蛋白|检验结果|化验结果|感染性质|细菌感染/u.test(corpus)) {
    return `待检验结果明确感染性质后，再评估是否使用${hint.name}`;
  }

  return `视后续病情评估结果，再决定是否使用${hint.name}`;
}

function buildHistoricalMedicationNote(hint: TreatmentHint): string {
  return `院外曾自行使用${hint.name}`;
}

function mergeNarrative(base: string, additions: string[]): string {
  const uniqueAdditions = additions
    .map((item) => normalizeSentence(item))
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);

  if (uniqueAdditions.length === 0) {
    return base;
  }

  const normalizedBase = normalizeSentence(base || '');
  const preservedBase = !normalizedBase || normalizedBase === '无特殊' ? '' : normalizedBase;
  const segments = [preservedBase, ...uniqueAdditions].filter(Boolean);
  return segments.join('；');
}

function segregateTreatmentHints(hints: MatchedTreatment[]): TreatmentSegregationResult {
  return hints.reduce<TreatmentSegregationResult>((acc, hint) => {
    if (hint.type !== 'medicine') {
      acc.currentTreatments.push(hint);
      return acc;
    }

    if (isHistoricalSelfMedicationHint(hint)) {
      acc.historicalMedicationNotes.push(buildHistoricalMedicationNote(hint));
      acc.excludedTreatments.push({ treatment: hint, reason: 'historical-self-medication' });
      return acc;
    }

    if (isConditionalTreatmentHint(hint)) {
      acc.deferredPlanNotes.push(buildDeferredTreatmentNote(hint));
      acc.excludedTreatments.push({ treatment: hint, reason: 'conditional' });
      return acc;
    }

    acc.currentTreatments.push(hint);
    return acc;
  }, {
    currentTreatments: [],
    deferredPlanNotes: [],
    historicalMedicationNotes: [],
    excludedTreatments: [],
  });
}

function normalizeVoiceExtraction(parsed: VoiceExtractionResult): NormalizedVoiceExtractionResult {
  const recordDraft: VoiceRecordDraft = {
    chiefComplaint: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.chiefComplaint || parsed.chiefComplaint),
      'chiefComplaint',
    ).text,
    historyOfPresentIllness: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.historyOfPresentIllness || parsed.historyOfPresentIllness),
      'historyOfPresentIllness',
    ).text,
    pastMedicalHistory: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.pastMedicalHistory || parsed.pastMedicalHistory),
      'pastMedicalHistory',
    ).text,
    allergyHistory: getText(parsed.recordDraft?.allergyHistory || parsed.allergyHistory),
    currentMedicationHistory: getText(parsed.recordDraft?.currentMedicationHistory || parsed.currentMedicationHistory),
    personalHistory: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.personalHistory || parsed.personalHistory),
      'personalHistory',
    ).text,
    menstrualHistory: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.menstrualHistory || parsed.menstrualHistory),
      'menstrualHistory',
    ).text,
    familyHistory: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.familyHistory || parsed.familyHistory),
      'familyHistory',
    ).text,
    physicalExam: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.physicalExam || parsed.physicalExam),
      'physicalExam',
    ).text,
    symptoms: getTextList(parsed.recordDraft?.symptoms || parsed.symptoms),
    negativeSymptoms: getTextList(parsed.recordDraft?.negativeSymptoms || parsed.negativeSymptoms),
    treatmentPlan: getText(parsed.recordDraft?.treatmentPlan || parsed.treatmentPlan),
    healthEducation: normalizeGeneratedClinicalRecordNarrative(
      getText(parsed.recordDraft?.healthEducation || parsed.healthEducation),
      'precautions',
    ).text,
  };

  recordDraft.historyOfPresentIllness = mergeStructuredNegativeSymptoms(
    recordDraft.historyOfPresentIllness,
    recordDraft.negativeSymptoms || [],
  ).text;

  const explicitHints = normalizeTreatmentHints(
    parsed.explicitTreatmentHints
      || parsed.treatmentHints?.filter((hint) => hint?.sourceType !== 'inferred' && hint?.sourceType !== 'uncertain'),
  ).map((hint) => ({ ...hint, sourceType: 'explicit' as const }));

  return {
    recordDraft,
    diagnosisHints: normalizeDiagnosisHints(parsed.diagnosisHints),
    treatmentHints: explicitHints,
    recommendationPlan: normalizeRecommendationPlan(parsed.recommendationPlan),
    recordFactSuggestions: Array.isArray(parsed.recordFactSuggestions)
      ? parsed.recordFactSuggestions
      : [],
    error: !!parsed.error,
    message: getText(parsed.message),
  };
}

function validateVoiceExtractionPayload(payload: unknown): string[] {
  const issues: string[] = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['根节点必须是 JSON 对象'];
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.error !== 'boolean') {
    issues.push('字段 error 必须是 boolean');
  }

  if (typeof record.message !== 'undefined' && typeof record.message !== 'string') {
    issues.push('字段 message 必须是 string');
  }

  const recordDraft = record.recordDraft;
  if (typeof recordDraft !== 'undefined') {
    if (!recordDraft || typeof recordDraft !== 'object' || Array.isArray(recordDraft)) {
      issues.push('字段 recordDraft 必须是对象');
    } else {
      const recordDraftObject = recordDraft as Record<string, unknown>;
      if (typeof recordDraftObject.chiefComplaint !== 'undefined' && typeof recordDraftObject.chiefComplaint !== 'string') {
        issues.push('recordDraft.chiefComplaint 必须是 string');
      }
      if (typeof recordDraftObject.historyOfPresentIllness !== 'undefined' && typeof recordDraftObject.historyOfPresentIllness !== 'string') {
        issues.push('recordDraft.historyOfPresentIllness 必须是 string');
      }
      if (typeof recordDraftObject.pastMedicalHistory !== 'undefined' && typeof recordDraftObject.pastMedicalHistory !== 'string') {
        issues.push('recordDraft.pastMedicalHistory 必须是 string');
      }
      if (typeof recordDraftObject.personalHistory !== 'undefined' && typeof recordDraftObject.personalHistory !== 'string') {
        issues.push('recordDraft.personalHistory 必须是 string');
      }
      if (typeof recordDraftObject.menstrualHistory !== 'undefined' && typeof recordDraftObject.menstrualHistory !== 'string') {
        issues.push('recordDraft.menstrualHistory 必须是 string');
      }
      if (typeof recordDraftObject.familyHistory !== 'undefined' && typeof recordDraftObject.familyHistory !== 'string') {
        issues.push('recordDraft.familyHistory 必须是 string');
      }
      if (typeof recordDraftObject.physicalExam !== 'undefined' && typeof recordDraftObject.physicalExam !== 'string') {
        issues.push('recordDraft.physicalExam 必须是 string');
      }
      if (typeof recordDraftObject.symptoms !== 'undefined' && !Array.isArray(recordDraftObject.symptoms)) {
        issues.push('recordDraft.symptoms 必须是数组');
      }
      if (typeof recordDraftObject.negativeSymptoms !== 'undefined' && !Array.isArray(recordDraftObject.negativeSymptoms)) {
        issues.push('recordDraft.negativeSymptoms 必须是数组');
      }
    }
  }

  const hasCompatibleLegacyFields =
    typeof record.chiefComplaint === 'string'
    || typeof record.historyOfPresentIllness === 'string'
    || typeof record.pastMedicalHistory === 'string'
    || Array.isArray(record.diagnosisHints)
    || Array.isArray(record.treatmentHints);

  if (typeof recordDraft === 'undefined' && !hasCompatibleLegacyFields && record.error !== true) {
    issues.push('缺少 recordDraft，也缺少兼容旧结构的病例字段');
  }

  if (typeof record.diagnosisHints !== 'undefined' && !Array.isArray(record.diagnosisHints)) {
    issues.push('字段 diagnosisHints 必须是数组');
  }

  if (Array.isArray(record.diagnosisHints)) {
    record.diagnosisHints.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`diagnosisHints[${index}] 必须是对象`);
        return;
      }

      if (typeof (item as Record<string, unknown>).name !== 'string') {
        issues.push(`diagnosisHints[${index}].name 必须是 string`);
      }

      const diagnosisItem = item as Record<string, unknown>;
      const clinicalRole = diagnosisItem.clinicalRole;
      if (typeof clinicalRole !== 'undefined'
        && clinicalRole !== 'current_diagnosis'
        && clinicalRole !== 'differential_cause'
        && clinicalRole !== 'risk_modifier'
        && clinicalRole !== 'history_only') {
        issues.push(`diagnosisHints[${index}].clinicalRole 必须是 current_diagnosis、differential_cause、risk_modifier 或 history_only`);
      }
      const diagnosisKind = diagnosisItem.diagnosisKind;
      if (typeof diagnosisKind !== 'undefined'
        && diagnosisKind !== 'disease'
        && diagnosisKind !== 'symptom_working') {
        issues.push(`diagnosisHints[${index}].diagnosisKind 必须是 disease 或 symptom_working`);
      }
      const evidenceScope = diagnosisItem.evidenceScope;
      if (typeof evidenceScope !== 'undefined'
        && evidenceScope !== 'current_visit'
        && evidenceScope !== 'history_only'
        && evidenceScope !== 'both') {
        issues.push(`diagnosisHints[${index}].evidenceScope 必须是 current_visit、history_only 或 both`);
      }
      if (typeof diagnosisItem.currentVisitEvidenceText !== 'undefined'
        && typeof diagnosisItem.currentVisitEvidenceText !== 'string') {
        issues.push(`diagnosisHints[${index}].currentVisitEvidenceText 必须是 string`);
      }
    });
  }

  const treatmentHints = record.explicitTreatmentHints ?? record.treatmentHints;
  if (typeof treatmentHints !== 'undefined' && !Array.isArray(treatmentHints)) {
    issues.push('字段 explicitTreatmentHints 必须是数组');
  }

  if (Array.isArray(treatmentHints)) {
    treatmentHints.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push(`explicitTreatmentHints[${index}] 必须是对象`);
        return;
      }

      const treatmentItem = item as Record<string, unknown>;
      if (typeof treatmentItem.type !== 'string') {
        issues.push(`explicitTreatmentHints[${index}].type 必须是 string`);
      }
      if (typeof treatmentItem.name !== 'string') {
        issues.push(`explicitTreatmentHints[${index}].name 必须是 string`);
      }
    });
  }

  if (typeof record.recommendationPlan !== 'undefined'
    && (!record.recommendationPlan || typeof record.recommendationPlan !== 'object' || Array.isArray(record.recommendationPlan))) {
    issues.push('字段 recommendationPlan 必须是对象');
  }

  return issues;
}

function parseVoiceExtractionPayload(rawOutput: string): ParsedVoiceExtractionResult {
  const jsonCandidate = extractLLMJsonCandidate(rawOutput);

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    const sanitized = sanitizeVoiceExtractionTreatmentSections(parsed);
    const issues = validateVoiceExtractionPayload(sanitized.payload);
    return {
      payload: sanitized.payload as VoiceExtractionResult,
      issues,
      warnings: sanitized.warnings,
    };
  } catch (error) {
    const parseMessage = error instanceof Error ? error.message : String(error);
    return {
      payload: null,
      issues: [`JSON 解析失败: ${parseMessage}`],
      warnings: [],
    };
  }
}

async function repairVoiceExtractionPayload(
  transcribedText: string,
  rawOutput: string,
  issues: string[],
  consultationId?: string,
): Promise<{ payload: VoiceExtractionResult; warnings: string[] }> {
  const repairPrompt = withOverride(
    'voiceIntentRepair',
    PROMPTS.consultation.voiceIntentRepair,
  ) as typeof PROMPTS.consultation.voiceIntentRepair;
  const repairedOutput = await chat([
    { role: 'system', content: repairPrompt.system },
    {
      role: 'user',
      content: repairPrompt.buildUserPrompt({
        transcribedText,
        rawOutput,
        issues,
      }),
    },
  ], undefined, undefined, undefined, {
    traceContext: {
      scene: 'voice-intent-repair',
      sourceModule: 'voice_intent',
      operationModule: 'voice_consultation',
      operationAction: 'repair_voice_extraction',
      title: '修复语音结构化结果',
      consultationId,
    },
  });

  const repairedParseResult = parseVoiceExtractionPayload(repairedOutput);
  if (!repairedParseResult.payload || repairedParseResult.issues.length > 0) {
    throw new Error(`语音结构化结果修复失败: ${repairedParseResult.issues.join('；')}`);
  }
  if (repairedParseResult.warnings.length > 0) {
    console.warn('[VoiceIntent] Repaired payload contained isolated explicit orders', {
      warnings: repairedParseResult.warnings,
    });
  }

  return {
    payload: repairedParseResult.payload,
    warnings: repairedParseResult.warnings,
  };
}

async function parseOrRepairVoiceExtraction(
  transcribedText: string,
  rawOutput: string,
  consultationId?: string,
): Promise<{ payload: VoiceExtractionResult; repairUsed: boolean; warnings: string[] }> {
  const firstPass = parseVoiceExtractionPayload(rawOutput);
  if (firstPass.payload && firstPass.issues.length === 0) {
    if (firstPass.warnings.length > 0) {
      console.warn('[VoiceIntent] Payload contained isolated explicit orders', {
        warnings: firstPass.warnings,
      });
    }
    return { payload: firstPass.payload, repairUsed: false, warnings: firstPass.warnings };
  }

  console.warn('[VoiceIntent] Voice extraction payload invalid, attempting repair', {
    issues: firstPass.issues,
  });

  const repaired = await repairVoiceExtractionPayload(
    transcribedText,
    rawOutput,
    firstPass.issues,
    consultationId,
  );

  return { payload: repaired.payload, repairUsed: true, warnings: repaired.warnings };
}

export function useVoiceIntentRecognition() {
  const isProcessing = ref(false);
  const processingError = ref<string | null>(null);
  const result = ref<VoiceIntentResult | null>(null);
  const rawTranscripts = ref<string[]>([]);

  function addTranscript(text: string) {
    if (text.trim()) {
      rawTranscripts.value.push(text.trim());
    }
  }

  function clearTranscripts() {
    rawTranscripts.value = [];
    result.value = null;
    processingError.value = null;
  }

  function getFullTranscript(): string {
    return rawTranscripts.value.join('\n');
  }

  function buildIntentResult(
    normalizedExtraction: NormalizedVoiceExtractionResult,
    generationStatus: 'streaming' | 'complete',
    readySections: ClinicalResultGenerationSection[] = [],
    resolvedTreatments?: MatchedTreatment[],
    patientGender?: string,
    vitalSourceText?: string,
  ): {
    intentResult: VoiceIntentResult;
    matchedDiagnoses: MatchedDiagnosis[];
    matchedTreatments: MatchedTreatment[];
    segregatedTreatments: TreatmentSegregationResult;
  } {
    const matchedDiagnoses = promoteOrdinaryVoiceSymptomWorkingDiagnosis(
      normalizedExtraction.diagnosisHints.map((hint) => matchDiagnosisHint(hint)),
      {
        chiefComplaint: normalizedExtraction.recordDraft.chiefComplaint,
        historyOfPresentIllness: normalizedExtraction.recordDraft.historyOfPresentIllness,
      },
    );
    const matchedTreatments = (
      resolvedTreatments
      || normalizedExtraction.treatmentHints.map((hint) => matchTreatmentHint(hint))
    ).filter((item) => item.type !== 'procedure');
    const segregatedTreatments = segregateTreatmentHints(matchedTreatments);
    const currentMedicationHistory = mergeNarrative(
      normalizedExtraction.recordDraft.currentMedicationHistory || '',
      segregatedTreatments.historicalMedicationNotes,
    );
    const pastMedicalHistory = composePastMedicalHistory({
      ...normalizedExtraction.recordDraft,
      currentMedicationHistory,
    });
    const personalHistory = normalizedExtraction.recordDraft.personalHistory || '';
    const menstrualHistory = normalizedExtraction.recordDraft.menstrualHistory || '';
    const familyHistory = normalizedExtraction.recordDraft.familyHistory || '';
    const plan = constrainOrdinaryVoiceWorkingDiagnosisPlan(
      normalizedExtraction.recommendationPlan,
      matchedDiagnoses,
    );
    const autoFetchTreatments = plan.mode !== 'explicit_only' && plan.mode !== 'urgent_referral';

    const outpatientRecord = buildOutpatientRecord({
      chiefComplaint: normalizedExtraction.recordDraft.chiefComplaint,
      historyOfPresentIllness: normalizedExtraction.recordDraft.historyOfPresentIllness,
      pastMedicalHistory,
      allergyHistory: normalizedExtraction.recordDraft.allergyHistory,
      personalHistory,
      menstrualHistory,
      familyHistory,
      physicalExam: normalizedExtraction.recordDraft.physicalExam,
      vitals: vitalSourceText,
      diagnosisNames: matchedDiagnoses.map((item) => item.name),
      patientGender,
    });
    const factRecord = {
      chiefComplaint: outpatientRecord.chiefComplaint,
      historyOfPresentIllness: outpatientRecord.historyOfPresentIllness,
      pastMedicalHistory: outpatientRecord.pastMedicalHistory,
      personalHistory: outpatientRecord.personalHistory,
      familyHistory: outpatientRecord.familyHistory,
      physicalExam: outpatientRecord.physicalExam,
    };
    const factSuggestions = normalizeClinicalRecordFactSuggestions({
      items: normalizedExtraction.recordFactSuggestions,
    }, extractExplicitClinicalRecordFacts(
      factRecord,
      normalizedExtraction.recordDraft.negativeSymptoms || [],
      normalizedExtraction.recordDraft.symptoms || [],
    ));

    const intentResult: VoiceIntentResult = {
      chiefComplaint: normalizedExtraction.recordDraft.chiefComplaint,
      historyOfPresentIllness: normalizedExtraction.recordDraft.historyOfPresentIllness,
      pastMedicalHistory,
      allergyHistory: normalizedExtraction.recordDraft.allergyHistory || '',
      currentMedicationHistory,
      ...(menstrualHistory ? { menstrualHistory } : {}),
      familyHistory,
      symptoms: normalizedExtraction.recordDraft.symptoms || [],
      negativeSymptoms: normalizedExtraction.recordDraft.negativeSymptoms || [],
      diagnoses: matchedDiagnoses,
      // 流式 explicit_orders 尚未完成院内目录解析，提前展示会在最终解析及
      // M2 推荐返回时造成治疗列表二次加载；病历与诊断仍保持渐进呈现。
      treatments: generationStatus === 'streaming' ? [] : segregatedTreatments.currentTreatments,
      treatmentPlan: mergeNarrative(
        normalizedExtraction.recordDraft.treatmentPlan || '',
        segregatedTreatments.deferredPlanNotes,
      ),
      healthEducation: normalizedExtraction.recordDraft.healthEducation || '',
      outpatientRecord,
      factSuggestions,
      recommendationPolicy: {
        autoFetchTreatments: autoFetchTreatments
          && (generationStatus === 'complete' || readySections.includes('recommendation_plan')),
        allowTreatmentRefresh: plan.mode !== 'urgent_referral',
        allowedTreatmentTypes: plan.recommendNow.map(mapRecommendationTypeToClinicalType),
        plan: {
          mode: plan.mode,
          recommendNow: [...plan.recommendNow],
          defer: [...(plan.defer || [])],
          skip: [...(plan.skip || [])],
          reason: plan.reason || '',
          resumeCondition: plan.resumeCondition || '',
          confidence: plan.confidence || 'low',
        },
      },
      generation: {
        status: generationStatus,
        readySections: [...readySections],
        message: generationStatus === 'streaming' ? '正在整理语音病历' : '',
      },
    };

    return { intentResult, matchedDiagnoses, matchedTreatments, segregatedTreatments };
  }

  async function processTranscript(
    transcribedText?: string,
    options?: {
      memoryContext?: string;
      patientContext?: {
        pastMedicalHistory?: string | null;
        allergyHistory?: string | null;
        currentMedicationHistory?: string | null;
        personalHistory?: string | null;
        menstrualHistory?: string | null;
        familyHistory?: string | null;
        gender?: string | null;
        vitals?: string | null;
      };
      consultationId?: string;
      onProgress?: (progress: VoiceIntentProgress) => void;
    },
  ): Promise<VoiceIntentResult | null> {
    const text = transcribedText || getFullTranscript();
    if (!text.trim()) {
      processingError.value = '未检测到有效语音内容';
      return null;
    }

    const normalizedText = text.trim();

    // Mock 模式下优先使用缓存结果
    if (isTestModeEnabled() && cachedTestModeResult && cachedTestModeTranscript === normalizedText) {
      console.log('[VoiceIntent] Test mode: returning cached result for current transcript');
      isProcessing.value = true;
      // 模拟短暂延迟，让 UI 能展示 loading 效果
      await new Promise(r => setTimeout(r, 600));
      result.value = cachedTestModeResult;
      if (cachedTestModeDebugSnapshot) {
        publishVoiceIntentDebug({
          ...cachedTestModeDebugSnapshot,
          fromCache: true,
        });
      }
      isProcessing.value = false;
      return cachedTestModeResult;
    }

    isProcessing.value = true;
    processingError.value = null;
    let rawOutput = '';

    try {
      // Step 1: LLM 意图识别 + 结构化提取
      const memoryBlock = options?.memoryContext?.trim() || '';

      // 注入患者档案：HIS 已知的既往史/过敏史/长期用药史，避免 LLM 因对话未提及就丢失基础病历信息
      const patientContextLines: string[] = [];
      const patientCtx = options?.patientContext;
      const vitalSourceText = [patientCtx?.vitals, normalizedText].filter(Boolean).join('\n');
      const cleanCtx = (value?: string | null) => {
        const trimmed = (value ?? '').trim();
        if (!trimmed) return '';
        if (/^(无|无特殊|否认|未述及|未提供)$/.test(trimmed)) return '';
        if (/^既往门诊记录[：:]/.test(trimmed)) return '';
        return trimmed;
      };
      const ctxAllergy = cleanCtx(patientCtx?.allergyHistory);
      const ctxPmh = cleanCtx(patientCtx?.pastMedicalHistory);
      const ctxMed = cleanCtx(patientCtx?.currentMedicationHistory);
      const ctxPersonal = cleanCtx(patientCtx?.personalHistory);
      const isFemalePatient = /^(?:F|2|女)/iu.test((patientCtx?.gender || '').trim());
      const ctxMenstrual = isFemalePatient ? cleanCtx(patientCtx?.menstrualHistory) : '';
      const ctxFamily = cleanCtx(patientCtx?.familyHistory);
      if (ctxAllergy || ctxPmh || ctxMed || ctxPersonal || ctxMenstrual || ctxFamily) {
        patientContextLines.push('【患者已有档案信息】');
        if (ctxAllergy) patientContextLines.push(`过敏史：${ctxAllergy}`);
        if (ctxPmh) patientContextLines.push(`既往史：${ctxPmh}`);
        if (ctxMed) patientContextLines.push(`长期用药：${ctxMed}`);
        if (ctxPersonal) patientContextLines.push(`个人史：${ctxPersonal}`);
        if (ctxMenstrual) patientContextLines.push(`月经史：${ctxMenstrual}`);
        if (ctxFamily) patientContextLines.push(`家族史：${ctxFamily}`);
        patientContextLines.push(
          '请在 recordDraft 中保留以上档案信息：若对话未明确撤销或修订，必须原样保留对应字段，不要因为对话未提及就改写为"无特殊"。既往史仅记录慢性病、手术史、外伤史等长期健康信息，不要将门诊就诊流水写入既往史；个人史、女性月经史与家族史必须分别放入对应字段。'
        );
      }
      const patientContextBlock = patientContextLines.length ? `\n${patientContextLines.join('\n')}` : '';
      const normalizeWithKnownHistories = (payload: VoiceExtractionResult): NormalizedVoiceExtractionResult => {
        const normalized = normalizeVoiceExtraction(payload);
        normalized.recordDraft.personalHistory ||= ctxPersonal;
        normalized.recordDraft.menstrualHistory ||= ctxMenstrual;
        normalized.recordDraft.familyHistory ||= ctxFamily;
        normalized.diagnosisHints = guardOrdinaryVoiceDiagnosisHints(
          normalized.diagnosisHints,
          {
            historicalContextText: [
              ctxPmh,
              composePastMedicalHistory(normalized.recordDraft),
              memoryBlock,
              normalizedText,
            ].filter(Boolean).join('\n'),
          },
        );
        return normalized;
      };

      const recognitionPrompt = withOverride(
        'voiceIntentRecognitionStream',
        PROMPTS.consultation.voiceIntentRecognition,
      ) as typeof PROMPTS.consultation.voiceIntentRecognition;
      const baseUserPrompt = recognitionPrompt.buildUserPrompt(text);
      const outputProtocolReminder = `
【本次输出协议】请按 record_core、history_context、record_suggestions、diagnoses、recommendation_plan、explicit_orders、record_extra、done 的顺序逐行输出 NDJSON。record_suggestions 是带 AI 来源标记的候选而非已确认事实；diagnoses 每项必须填写 clinicalRole、diagnosisKind 和 evidenceScope，current_visit/both 还必须填写仅来自本次就诊的 currentVisitEvidenceText。history_only/risk_modifier 不得进入诊断建议，不能解释本次主诉的糖尿病、贫血等历史共病也不得作为待鉴别；没有病因性正式诊断时，可返回至多一项本次明确且可匹配标准库的症状性工作诊断。explicit_orders 只能包含医生明确医嘱，每项 name 必须是非空字符串，type 必须是 medicine、examination、labTest、procedure 之一的字符串，没有明确医嘱时输出空数组；recommendation_plan 必须包含 mode、recommendNow、defer、skip、reason、resumeCondition、confidence。`;
      const userContent = `${baseUserPrompt}${patientContextBlock}${memoryBlock ? `\n${memoryBlock}` : ''}${outputProtocolReminder}`;
      const messages: ChatMessage[] = [
        { role: 'system', content: recognitionPrompt.system },
        { role: 'user', content: userContent },
      ];

      const traceConfig = {
        traceContext: {
          scene: 'voice-intent-recognition',
          sourceModule: 'voice_intent',
          operationModule: 'voice_consultation',
          operationAction: 'extract_voice_record',
          title: '语音记录结构化抽取',
          consultationId: options?.consultationId,
        },
      };
      let streamAccumulator = createVoiceIntentStreamAccumulator();
      let streamParser = createVoiceIntentStreamParser((event) => {
        applyVoiceIntentStreamEvent(streamAccumulator, event);
        if (!options?.onProgress || event.event === 'done') return;
        const partialExtraction = normalizeWithKnownHistories(streamAccumulator.payload);
        const partial = buildIntentResult(
          partialExtraction,
          'streaming',
          streamAccumulator.readySections,
          undefined,
          patientCtx?.gender || undefined,
          vitalSourceText,
        );
        options.onProgress({
          result: partial.intentResult,
          readySections: [...streamAccumulator.readySections],
        });
      });

      try {
        await chatStream(
          messages,
          (chunk) => {
            rawOutput += chunk;
            streamParser.push(chunk);
          },
          undefined,
          { maxRetries: 0, initialDelay: 0, maxDelay: 0, backoffMultiplier: 1 },
          undefined,
          traceConfig,
        );
      } catch (streamError) {
        streamParser.flush();
        const hasUsablePartial = ['record_core', 'diagnoses', 'recommendation_plan']
          .every((section) => streamAccumulator.readySections.includes(section as ClinicalResultGenerationSection));
        if (hasUsablePartial) {
          console.warn('[VoiceIntent] Streaming extraction ended after usable sections; preserving partial result', streamError);
        } else {
          console.warn('[VoiceIntent] Streaming extraction failed before usable sections, falling back once', streamError);
          rawOutput = await chat(
            messages,
            undefined,
            { maxRetries: 0, initialDelay: 0, maxDelay: 0, backoffMultiplier: 1 },
            undefined,
            traceConfig,
          );
          streamAccumulator = createVoiceIntentStreamAccumulator();
          streamParser = createVoiceIntentStreamParser((event) => {
            applyVoiceIntentStreamEvent(streamAccumulator, event);
          });
          streamParser.push(rawOutput);
        }
      }
      streamParser.flush();

      let parsed: VoiceExtractionResult;
      let repairUsed = false;
      let protocolWarnings = [...streamAccumulator.protocolWarnings];
      const hasRequiredStreamSections = ['record_core', 'diagnoses', 'recommendation_plan']
        .every((section) => streamAccumulator.readySections.includes(section as ClinicalResultGenerationSection));
      if (streamAccumulator.eventCount > 0 && hasRequiredStreamSections) {
        parsed = streamAccumulator.payload;
      } else {
        const repaired = await parseOrRepairVoiceExtraction(normalizedText, rawOutput, options?.consultationId);
        parsed = repaired.payload;
        repairUsed = repaired.repairUsed;
        protocolWarnings = repaired.warnings;
      }
      if (protocolWarnings.length > 0) {
        console.warn('[VoiceIntent] Isolated malformed optional sections', { warnings: protocolWarnings });
      }
      const normalizedExtraction = normalizeWithKnownHistories(parsed);

      if (normalizedExtraction.error) {
        processingError.value = normalizedExtraction.message || '无法识别有效的医疗内容';
        return null;
      }

      const resolvedTreatments = await resolveExplicitTreatmentCatalogHints(
        normalizedExtraction.treatmentHints,
        options?.consultationId,
        {
          transcript: normalizedText,
          chiefComplaint: normalizedExtraction.recordDraft.chiefComplaint,
          historyOfPresentIllness: normalizedExtraction.recordDraft.historyOfPresentIllness,
          pastMedicalHistory: normalizedExtraction.recordDraft.pastMedicalHistory,
          physicalExam: normalizedExtraction.recordDraft.physicalExam,
          diagnosisNames: normalizedExtraction.diagnosisHints.map((item) => item.name),
          treatmentPlan: normalizedExtraction.recordDraft.treatmentPlan,
        },
      );
      const built = buildIntentResult(
        normalizedExtraction,
        'complete',
        streamAccumulator.readySections,
        resolvedTreatments,
        patientCtx?.gender || undefined,
        vitalSourceText,
      );
      const {
        intentResult,
        matchedDiagnoses,
        matchedTreatments,
        segregatedTreatments,
      } = built;

      result.value = intentResult;

      const debugSnapshot: VoiceIntentDebugSnapshot = {
        transcript: normalizedText,
        rawOutput,
        normalizedExtraction,
        result: intentResult,
        matchedDiagnoses,
        matchedTreatments,
        excludedTreatments: segregatedTreatments.excludedTreatments,
        repairUsed,
        protocolWarnings,
      };

      publishVoiceIntentDebug(debugSnapshot);

      // Mock 模式下缓存首次 LLM 结果
      if (isTestModeEnabled()) {
        cachedTestModeTranscript = normalizedText;
        cachedTestModeResult = intentResult;
        cachedTestModeDebugSnapshot = debugSnapshot;
        console.log('[VoiceIntent] Test mode: cached LLM result for current transcript');
      }

      return intentResult;
    } catch (err: unknown) {
      trackError('voice_intent_recognition_failed', err);
      const errMessage = err instanceof Error ? err.message : String(err);
      processingError.value = `意图识别失败: ${errMessage}`;
      publishVoiceIntentDebug({
        transcript: normalizedText,
        rawOutput,
        errorMessage: errMessage,
      });
      return null;
    } finally {
      isProcessing.value = false;
    }
  }

  function matchDiagnosisHint(hint: DiagnosisHint): MatchedDiagnosis {
    const matchContext = hint.code ? { icdCode: hint.code } : undefined;
    const assessment = medicalDataService.assessDiagnosisMatch(hint.name, matchContext);
    return {
      ...hint,
      matchedItem: assessment.matchedItem,
      suggestedMatchItem: assessment.suggestedMatchItem,
      catalogMatchStatus: assessment.status,
      catalogMatchReason: assessment.reason,
      catalogAlternatives: assessment.alternatives,
    };
  }

  function matchTreatmentHint(hint: TreatmentHint): MatchedTreatment {
    const type = hint.type === 'examination' ? 'exam' : hint.type === 'labTest' ? 'lab_test' : hint.type;
    const assessment = assessTreatmentCatalogMatch(type, hint.name, hint.aliases, hint.spec);
    return { ...hint, matchedItem: assessment.matchedItem || null };
  }

  return {
    isProcessing,
    processingError,
    result,
    rawTranscripts,
    addTranscript,
    clearTranscripts,
    getFullTranscript,
    processTranscript,
  };
}
