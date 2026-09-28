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

export interface PreparedCurrentInformationMedicines {
  readyItems: TreatmentRecommendation[];
  unavailable: Array<{ name: string; reason: string }>;
  candidateCount: number;
  finalizedCount: number;
  inventoryReadyCount: number;
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

function buildCurrentInformationMedicationPatientContext(params: Parameters<ClinicalResultTreatmentPromptAsset['buildUserPrompt']>[0]): string {
  return `【患者信息】
${params.patientName}，${params.gender}，${params.age}

【已选正式诊断】
${params.diagnosisName}（ICD-10：${params.diagnosisCode || '未提供'}）

【主诉】
${params.chiefComplaint || '未提供'}

【当前临床信息】
${params.clinicalContext || '未提供'}`;
}

function buildCurrentInformationMedicationSafetyRules(symptomaticOnly: boolean): string {
  return `本次仅评估药品，不生成检查医嘱，不要求重做诊断。医生主动请求不表示患者拒绝检查，也不表示未检查项目正常。
只使用当前已选正式诊断和本次输入的真实病史、过敏史、当前用药、查体及已提供的检查结果；模板占位符、待查项目和待鉴别疾病不能作为已确认检查结果或确诊病因。
patientRecord 为 HIS 病史，currentEncounter 为本次问诊；两者须综合核对，“未记录”等占位符不能否定另一来源的明确事实。来源冲突且未明确纠正时，不得自动认定无过敏或已停药，受影响药品应暂缓并说明待核实内容。
${symptomaticOnly ? '当前为症状性工作诊断，只允许 purpose=symptomatic 的对症方案；病因治疗一律暂缓，不得以推测的细菌感染等病因推荐抗菌药。' : '可以推荐现有信息已支持的病因治疗或对症方案，不得因缺少其他检查而暂停所有药品。'}
逐药核对过敏、禁忌、合并症、相互作用及年龄和体重适用性，不能套用成人剂量。适应证或安全性仍依赖缺失的关键依据时 eligibility=requires_evidence，并列出 missingEvidence。其他已有充分依据的药品可 eligibility=supported。
若需紧急处置或转诊，disposition=urgent_referral，medicines=[]。否则 disposition=medication_options。允许零药品，不为满足数量凑药。`;
}

export function buildCurrentInformationMedicationPrompt(
  symptomaticOnly: boolean,
): ClinicalResultTreatmentPromptAsset {
  return {
    system: `你是基层临床处方建议助手。请基于当前病例和院内完整有效库存，一次完成用药评估与处方候选生成。

${buildCurrentInformationMedicationSafetyRules(symptomaticOnly)}
只能选择 user 消息中“院内完整有效库存”里的药品，药品名称和规格必须与目录完全一致；不得添加目录外药品，不得自行猜测或替换临床等效药。
逐药核对剂量安全性。剂量仍依赖缺失的体重、肾功能、肝功能或其他关键依据时，必须 eligibility=requires_evidence，且不得输出剂量等处方字段。
summary 不得列举具体药名。所有 supported 药品必须逐项进入 medicines，不得只在 summary 中描述。
只返回下述 JSON 对象，不输出 Markdown，不返回 JSON 数组：
{"summary":"简洁评估结论或无药原因","disposition":"medication_options|urgent_referral","medicines":[{"type":"medicine","name":"库存目录中的完整药品名称","purpose":"symptomatic|etiologic","eligibility":"supported|requires_evidence","basis":"当前病例中的具体依据","missingEvidence":[],"reason":"推荐或暂缓原因","spec":"库存目录中的完整制剂规格","targetDose":"一次剂量数值","targetDoseUnit":"剂量单位","frequency":"标准频次","frequencyKey":"","usage":"用法","usageKey":"","days":"疗程天数"}]}
supported 必须有具体 basis、reason 且 missingEvidence 为空。dosage、dosageUnit、totalQty、totalUnit 留空，不设置选中状态。`,
    buildUserPrompt: (params) => `${buildCurrentInformationMedicationPatientContext(params)}

${params.availableMedicineInventory || '【院内完整有效库存】\n- 当前未取得可用库存'}

本入口以 system 中的严格目录规则为准：仅可返回上述目录中真实存在的完整药品名称和规格，不得返回目录外通用名作为无库存参考。
请仅从上述完整库存中选择适合当前病例的药品，并一次返回评估结论和结构化处方候选。`,
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
    const aliases = Array.isArray(item.aliases)
      ? item.aliases.map(text).filter(Boolean).slice(0, 3)
      : [];
    result.recommendations.push({
      ...fields,
      type: 'medicine',
      name,
      aliases,
      purpose,
      basis,
      intentReason: reason,
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

export function buildFinalCurrentInformationMedicationAssessment(
  assessment: CurrentInformationMedicationAssessment,
  prepared: PreparedCurrentInformationMedicines,
): CurrentInformationMedicationAssessment {
  if (assessment.disposition === 'urgent_referral') {
    return {
      summary: '当前信息提示应优先进一步处置，暂不提供可选药品。',
      disposition: assessment.disposition,
      deferred: [],
    };
  }
  const deferred = [...assessment.deferred, ...prepared.unavailable];
  const count = prepared.readyItems.length;
  return {
    summary: count > 0
      ? `已结合当前病情、处方字段和院内库存生成 ${count} 项可选药品，请核对后勾选。`
      : deferred.length > 0
        ? `当前信息下暂无可直接开立的药品，${deferred.length} 项候选已暂缓。`
        : '当前信息下暂无有充分依据且可直接开立的药品。',
    disposition: assessment.disposition,
    deferred,
  };
}

export async function prepareCurrentInformationMedicines(
  items: TreatmentRecommendation[],
  dependencies: {
    finalize: (items: TreatmentRecommendation[]) => Promise<Array<{
      item: TreatmentRecommendation;
      ready: boolean;
      issues?: string[];
    }>>;
    checkInventory: (item: TreatmentRecommendation) => Promise<boolean>;
    isCurrent: () => boolean;
    onSummary?: (summary: {
      candidateCount: number;
      finalizedCount: number;
      inventoryReadyCount: number;
    }) => void;
  },
): Promise<PreparedCurrentInformationMedicines | null> {
  const finalized = await dependencies.finalize(items);
  if (!dependencies.isCurrent()) return null;
  // The shared finalizer checks inventory only for selected medicines. This action
  // intentionally leaves them unselected, so validate ready candidates explicitly.
  const readyItems = finalized.filter((result) => result.ready);
  const inventoryResults = await Promise.all(readyItems
    .map((result) => dependencies.checkInventory(result.item)));
  items.forEach((item) => { item.selected = false; });
  const summary = {
    candidateCount: items.length,
    finalizedCount: readyItems.length,
    inventoryReadyCount: inventoryResults.filter(Boolean).length,
  };
  dependencies.onSummary?.(summary);
  if (!dependencies.isCurrent()) return null;

  const inventoryByItem = new Map(readyItems.map((result, index) => [
    result.item,
    inventoryResults[index],
  ]));
  return {
    readyItems: readyItems
      .filter((result) => inventoryByItem.get(result.item) === true)
      .map((result) => result.item),
    unavailable: finalized.flatMap((result) => {
      if (result.ready && inventoryByItem.get(result.item) === true) return [];
      return [{
        name: result.item.name,
        reason: result.ready
          ? '当前药房库存不足或暂无法完成库存核验'
          : result.issues?.filter(Boolean).join('；') || '药品目录或处方字段不完整，暂不可开立',
      }];
    }),
    ...summary,
  };
}
