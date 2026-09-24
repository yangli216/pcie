import type { TreatmentRecommendation } from '@/types/consultation';
import type { AppPatient } from '@/types/appState';
import { getPatientContextAllergyHistory, getPatientContextCurrentMedicationHistory } from '@/utils/patientContext';
import type { RawClinicalResultTreatmentRecommendationInput } from './clinicalResultAiMapping';
import type { ClinicalResultTreatmentPromptAsset } from './clinicalResultAiRequest';

export interface CurrentInformationMedicationAssessment {
  summary: string;
  disposition: 'medication_options' | 'urgent_referral';
  deferred: Array<{ name: string; reason: string }>;
}

export interface CurrentInformationMedicationResult extends CurrentInformationMedicationAssessment {
  recommendations: RawClinicalResultTreatmentRecommendationInput[];
}

export interface CurrentInformationMedicationTimingInput {
  startedAt: number;
  completedAt: number;
  assessmentStartedAt?: number;
  finalizationStartedAt?: number;
  candidateCount: number;
  readyCount: number;
  deferredCount: number;
}

function elapsed(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round(completedAt - startedAt));
}

export function buildCurrentInformationMedicationTimingLog(
  input: CurrentInformationMedicationTimingInput,
): { durationMs: number; details: Record<string, number | undefined> } {
  const durationMs = elapsed(input.startedAt, input.completedAt);
  const assessmentStartedAt = input.assessmentStartedAt && input.assessmentStartedAt >= input.startedAt
    ? input.assessmentStartedAt : undefined;
  const finalizationStartedAt = input.finalizationStartedAt && assessmentStartedAt
    && input.finalizationStartedAt >= assessmentStartedAt
    ? input.finalizationStartedAt : undefined;
  return {
    durationMs,
    details: {
      preparationMs: assessmentStartedAt
        ? elapsed(input.startedAt, assessmentStartedAt) : durationMs,
      aiAssessmentMs: assessmentStartedAt
        ? elapsed(assessmentStartedAt, finalizationStartedAt || input.completedAt) : undefined,
      finalizationMs: finalizationStartedAt
        ? elapsed(finalizationStartedAt, input.completedAt) : undefined,
      totalMs: durationMs,
      candidateCount: Math.max(0, Math.round(input.candidateCount)),
      readyCount: Math.max(0, Math.round(input.readyCount)),
      deferredCount: Math.max(0, Math.round(input.deferredCount)),
    },
  };
}

export function buildCurrentInformationMedicationHistory(
  patient: AppPatient | null | undefined,
  encounter: { allergyHistory?: string; currentMedicationHistory?: string } | null | undefined,
) {
  return {
    allergyHistory: {
      patientRecord: getPatientContextAllergyHistory(patient),
      currentEncounter: encounter?.allergyHistory || '',
    },
    currentMedicationHistory: {
      patientRecord: getPatientContextCurrentMedicationHistory(patient),
      currentEncounter: encounter?.currentMedicationHistory || '',
    },
  };
}

export function buildCurrentInformationMedicationPrompt(
  base: ClinicalResultTreatmentPromptAsset,
  symptomaticOnly: boolean,
): ClinicalResultTreatmentPromptAsset {
  return {
    system: `${base.system}

【医生主动基于现有信息评估用药】
本次仅评估药品，不生成检查医嘱，不要求重做诊断。医生主动请求不表示患者拒绝检查，也不表示未检查项目正常。
只使用当前已选正式诊断和本次输入的真实病史、过敏史、当前用药、查体及已提供的检查结果；模板占位符、待查项目和待鉴别疾病不能作为已确认检查结果或确诊病因。
patientRecord 为 HIS 病史，currentEncounter 为本次问诊；两者须综合核对，“未记录”等占位符不能否定另一来源的明确事实。来源冲突且未明确纠正时，不得自动认定无过敏或已停药，受影响药品应暂缓并说明待核实内容。
${symptomaticOnly ? '当前为症状性工作诊断，只允许 purpose=symptomatic 的对症方案；病因治疗一律暂缓，不得以推测的细菌感染等病因推荐抗菌药。' : '可以推荐现有信息已支持的病因治疗或对症方案，不得因缺少其他检查而暂停所有药品。'}
逐药核对过敏、禁忌、合并症、相互作用及年龄/体重适用剂量，不能套用成人剂量。适应证、安全性或剂量仍依赖缺失的关键检验/检查或其他信息时 eligibility=requires_evidence，并列出 missingEvidence，不提供该药的剂量等处方字段。其他已有充分依据的药品可 eligibility=supported。
若需紧急处置/转诊，disposition=urgent_referral，medicines=[]，summary 明确说明。否则 disposition=medication_options。允许零药品，不为满足数量凑药。
本次输出下述 JSON 对象，取代普通用药请求的数组格式；不输出 Markdown：
{"summary":"简洁说明本次可推荐范围或无药原因","disposition":"medication_options|urgent_referral","medicines":[{"type":"medicine","name":"规范药名","purpose":"symptomatic|etiologic","eligibility":"supported|requires_evidence","basis":"引用本次已提供的具体诊疗依据，不能编造结果","missingEvidence":[],"reason":"推荐理由或暂缓原因","spec":"制剂规格","targetDose":"一次剂量数值","targetDoseUnit":"剂量单位","frequency":"标准频次","frequencyKey":"","usage":"用法","usageKey":"","days":"疗程天数"}]}
supported 必须有具体 basis、reason 且 missingEvidence 为空；requires_evidence 必须明确缺少的依据。不给出 totalQty/totalUnit，不设置选中状态。`,
    buildUserPrompt: (params) => `${base.buildUserPrompt(params)}\n\n本次为医生主动请求的现有信息用药评估。请按 system 中的对象格式返回 summary、disposition、medicines；不得使用普通数组响应。`,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Fail closed before inventory/catalog mapping; deferred entries never become orders. */
export function parseCurrentInformationMedicationResult(
  value: unknown,
  symptomaticOnly: boolean,
): CurrentInformationMedicationResult {
  const root = record(value);
  if (!root || !text(root.summary) || !Array.isArray(root.medicines)
    || !['medication_options', 'urgent_referral'].includes(text(root.disposition))) {
    throw new Error('用药评估结果格式不完整');
  }
  const result: CurrentInformationMedicationResult = {
    summary: text(root.summary),
    disposition: root.disposition as CurrentInformationMedicationResult['disposition'],
    recommendations: [],
    deferred: [],
  };
  if (result.disposition === 'urgent_referral') return result;

  for (const raw of root.medicines) {
    const item = record(raw);
    const name = text(item?.name);
    const purpose = text(item?.purpose);
    const eligibility = text(item?.eligibility);
    if (!item || !name
      || !['symptomatic', 'etiologic'].includes(purpose)
      || !['supported', 'requires_evidence'].includes(eligibility)) continue;

    const missingEvidenceWasOmitted = item.missingEvidence === undefined;
    const missingEvidenceIsValid = missingEvidenceWasOmitted
      || (Array.isArray(item.missingEvidence)
        && item.missingEvidence.every((entry) => Boolean(text(entry))));
    const missing = Array.isArray(item.missingEvidence)
      ? item.missingEvidence.map(text).filter(Boolean)
      : [];
    const reason = text(item.reason);
    const basis = text(item.basis);
    if (item.eligibility === 'requires_evidence' || missing.length > 0
      || !missingEvidenceIsValid || !reason || !basis
      || (symptomaticOnly && purpose !== 'symptomatic')) {
      result.deferred.push({
        name,
        reason: [reason, ...missing,
          !missingEvidenceIsValid ? '缺失证据字段格式不完整' : '',
          !basis ? '缺少当前病例用药依据' : '',
          symptomaticOnly && purpose !== 'symptomatic' ? '症状性工作诊断尚不支持病因治疗' : '',
        ].filter(Boolean).join('；') || '用药依据不完整，暂不推荐',
      });
      continue;
    }
    // Keep only clinical fields: model selection, matching IDs and package totals are not trusted.
    const fields = Object.fromEntries([
      'name', 'spec', 'targetDose', 'targetDoseUnit', 'frequency', 'frequencyKey', 'usage', 'usageKey', 'days',
    ].map((key) => [key, text(item[key])]));
    result.recommendations.push({
      ...fields,
      type: 'medicine',
      name,
      reason: `${reason}；依据：${basis}`,
    });
  }
  return result;
}

/** Preserve every existing order/edit/selection; append only new, unselected medicine identities. */
export function mergeCurrentInformationMedicines(
  current: TreatmentRecommendation[],
  incoming: TreatmentRecommendation[],
): TreatmentRecommendation[] {
  const medicines = current.filter((item) => item.type === 'medicine');
  const ids = new Set(medicines.map((item) => item.matchedItem?.id).filter(Boolean));
  const names = new Set(medicines.map((item) => item.name.replace(/\s/gu, '')));
  return [...current, ...incoming.filter((item) => {
    const name = item.name.replace(/\s/gu, '');
    const id = item.matchedItem?.id;
    if (item.type !== 'medicine' || (id && ids.has(id)) || names.has(name)) return false;
    if (id) ids.add(id);
    names.add(name);
    return true;
  }).map((item) => ({ ...item, selected: false }))];
}

export async function prepareCurrentInformationMedicines(
  items: TreatmentRecommendation[],
  dependencies: {
    finalize: (items: TreatmentRecommendation[]) => Promise<Array<{ item: TreatmentRecommendation; ready: boolean }>>;
    checkInventory: (item: TreatmentRecommendation) => Promise<boolean>;
    isCurrent: () => boolean;
    onSummary?: (summary: {
      candidateCount: number;
      finalizedCount: number;
      inventoryReadyCount: number;
    }) => void;
  },
): Promise<boolean> {
  const finalized = await dependencies.finalize(items);
  if (!dependencies.isCurrent()) return false;
  // The shared finalizer checks inventory only for selected medicines. This action
  // intentionally leaves them unselected, so validate ready candidates explicitly.
  const readyItems = finalized.filter((result) => result.ready);
  const inventoryResults = await Promise.all(readyItems
    .map((result) => dependencies.checkInventory(result.item)));
  items.forEach((item) => { item.selected = false; });
  dependencies.onSummary?.({
    candidateCount: items.length,
    finalizedCount: readyItems.length,
    inventoryReadyCount: inventoryResults.filter(Boolean).length,
  });
  return dependencies.isCurrent();
}
