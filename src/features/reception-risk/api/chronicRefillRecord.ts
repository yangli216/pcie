import { chatStream } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import type { AppPatient } from '@/types/appState';
import {
  getPatientContextAgeText,
  getPatientContextAllergyHistory,
  getPatientContextGenderText,
  getPatientContextName,
  getPatientContextPastMedicalHistory,
} from '@/utils/patientContext';
import {
  loadAvailableMedicineInventoryContext,
  formatAvailableMedicineInventoryPrompt,
  normalizeGeneratedClinicalRecordNarrative,
  parseLLMJson,
  type ClinicalResultGenerationStage,
  type ClinicalResultDiagnosis,
  type ClinicalResultInput,
} from '@features/clinical-result';
import type { ChronicRefillCandidate } from '../lib/chronicRefillAssessment';
import {
  normalizeChronicRefillConfirmationPlan,
  type ChronicRefillConfirmationPlan,
  type RawChronicRefillConfirmationPlan,
} from '../lib/chronicRefillConfirmation';
import {
  buildChronicRefillInventoryTreatments,
  type ChronicRefillMedicineInput,
  type ChronicRefillMedicineRecommendation,
} from '../lib/chronicRefillInventory';
import {
  applyChronicRefillRecordStreamEvent,
  createChronicRefillRecordStreamAccumulator,
  createChronicRefillRecordStreamParser,
} from '../lib/chronicRefillRecordStream';

export interface ChronicRefillRecordGenerationOptions {
  onProgress?: (stage: Extract<
    ClinicalResultGenerationStage,
    'generating-content' | 'finalizing-result'
  >) => void;
  onPartial?: (result: ClinicalResultInput) => void;
}

interface ChronicRefillDraft {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  currentMedicationHistory?: string;
  treatmentPlan?: string;
  healthEducation?: string;
  recommendedMedicines?: ChronicRefillMedicineInput[];
  reviewPlan?: RawChronicRefillConfirmationPlan;
}

interface NormalizedChronicRefillDraft {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  currentMedicationHistory: string;
  treatmentPlan: string;
  healthEducation: string;
  recommendedMedicines: ChronicRefillMedicineInput[];
  reviewPlan: ChronicRefillConfirmationPlan;
}

function buildHistoryEvidence(candidate: ChronicRefillCandidate): string {
  return candidate.chronicVisits.map((visit, index) => {
    const date = new Date(visit.visitTime);
    const dateText = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    return [
      `第${index + 1}次：${dateText}`,
      `诊断：${(visit.diagnoses || []).join('、') || '未记录'}`,
      `用药：${(visit.medications || []).join('、') || '未记录'}`,
      `主诉：${visit.chiefComplaint || '未记录'}`,
      `现病史：${visit.presentIllness || '未记录'}`,
    ].join('；');
  }).join('\n');
}

function buildMedicationSummary(medications: string[]): string {
  return medications.length > 0 ? medications.join('、') : '当前有效库存中未匹配到历史续方药品';
}

function isPatientFactHistory(value: string, candidate: ChronicRefillCandidate): boolean {
  if (value.length < 30 || /未提供新发不适信息/u.test(value)) return false;
  const compactValue = value.replace(/\s+/gu, '');
  const containsHistoricalMedicine = candidate.medications
    .map(standardizeMedicineName)
    .filter(Boolean)
    .some((name) => compactValue.includes(name.replace(/\s+/gu, '')));
  if (containsHistoricalMedicine) return false;
  return !/(?:当前(?:有效)?库存|库存内|可续方药品|可参考药品|推荐药品|推荐使用|建议使用|后续治疗方案为|待(?:医生)?核实|(?:近期|既往|长期|曾经|目前)?(?:用药|服药|开具|处方)|口服|每次\s*\d|每(?:日|天)\s*\d+\s*次|\d+\s*天|共\s*\d+\s*(?:盒|瓶|片|粒|支|袋)|规律(?:服药|用药)|按时服药|依从性良好|病情(?:控制)?平稳|控制(?:良好|平稳)|无明显(?:相关)?不适|未见(?:明显)?不良反应|监测(?:结果|指标)?(?:正常|平稳))/u.test(value);
}

function normalizeChronicRefillHealthEducation(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
  if (!text) return fallback;
  if (/(?:注意休息|1\s*周内复诊|一\s*周内复诊|上级医院进一步(?:检查|治疗|诊治))/u.test(text)) {
    return fallback;
  }
  return text;
}

function normalizeMedicineRecommendation(value: unknown): ChronicRefillMedicineInput | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) return null;

  const result: ChronicRefillMedicineRecommendation = { name };
  const textFields: Array<keyof Omit<ChronicRefillMedicineRecommendation, 'name'>> = [
    'spec',
    'targetDose',
    'targetDoseUnit',
    'frequency',
    'frequencyKey',
    'route',
    'routeKey',
    'usage',
    'days',
    'reason',
  ];
  textFields.forEach((field) => {
    const fieldValue = source[field];
    const normalized = typeof fieldValue === 'string'
      ? fieldValue.trim()
      : (typeof fieldValue === 'number' && Number.isFinite(fieldValue) ? String(fieldValue) : '');
    if (normalized) {
      result[field] = normalized;
    }
  });
  if (!result.targetDose) {
    const legacyDosage = source.dosage;
    result.targetDose = typeof legacyDosage === 'string'
      ? legacyDosage.trim()
      : (typeof legacyDosage === 'number' && Number.isFinite(legacyDosage) ? String(legacyDosage) : '');
  }
  if (!result.targetDoseUnit) {
    const legacyDosageUnit = source.dosageUnit;
    result.targetDoseUnit = typeof legacyDosageUnit === 'string' ? legacyDosageUnit.trim() : '';
  }
  return result;
}

function standardizeMedicineName(value: string): string {
  return medicalDataService.matchMedicine(value)?.name
    || value
      .replace(/^[\s☆★*·•]+/u, '')
      .replace(/[（(][^）)]*[）)]/gu, '')
      .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
      .trim();
}

function buildHistoricalMedicationNames(candidate: ChronicRefillCandidate): string[] {
  return Array.from(new Set(
    candidate.medications
      .map(standardizeMedicineName)
      .filter(Boolean),
  ));
}

function fallbackDraft(
  patient: AppPatient,
  candidate: ChronicRefillCandidate,
  availableMedications: string[],
): NormalizedChronicRefillDraft {
  const diagnosisText = candidate.diagnoses.join('、');
  const historicalMedicationNames = buildHistoricalMedicationNames(candidate);
  const medicationText = availableMedications.length > 0
    ? availableMedications.join('、')
    : (candidate.medications.length > 0 ? '当前库存未匹配到可直接续方的历史药品' : '暂无可直接沿用的历史药品');
  return {
    chiefComplaint: `${diagnosisText}复诊配药`,
    historyOfPresentIllness: `患者既往确诊${diagnosisText}。今复诊配药。`,
    pastMedicalHistory: getPatientContextPastMedicalHistory(patient) || `既往有${diagnosisText}病史。`,
    currentMedicationHistory: historicalMedicationNames.length > 0
      ? historicalMedicationNames.join('、')
      : '历史用药方案待医生核实',
    treatmentPlan: candidate.medications.length > 0 && availableMedications.length > 0
      ? `医生核实病情控制、依从性及禁忌证后，可从当前有效库存中的历史处方药品续方：${medicationText}。`
      : `未取得可直接沿用的历史用药方案，请结合${diagnosisText}、当前病情及有效库存由医生确认后续治疗。`,
    healthEducation: '按医嘱规律服药并记录家庭监测结果；出现症状变化或指标异常时及时复诊。',
    recommendedMedicines: candidate.medications,
    reviewPlan: normalizeChronicRefillConfirmationPlan(null, candidate),
  };
}

function normalizeDraft(
  value: ChronicRefillDraft,
  patient: AppPatient,
  candidate: ChronicRefillCandidate,
  availableMedications: string[],
): NormalizedChronicRefillDraft {
  const fallback = fallbackDraft(patient, candidate, availableMedications);
  const chiefComplaint = normalizeGeneratedClinicalRecordNarrative(
    value.chiefComplaint,
    'chiefComplaint',
  ).text;
  const historyOfPresentIllness = normalizeGeneratedClinicalRecordNarrative(
    value.historyOfPresentIllness,
    'historyOfPresentIllness',
  ).text;
  const pastMedicalHistory = normalizeGeneratedClinicalRecordNarrative(
    value.pastMedicalHistory,
    'pastMedicalHistory',
  ).text;
  const healthEducation = normalizeGeneratedClinicalRecordNarrative(
    value.healthEducation,
    'precautions',
  ).text;
  const recommendedMedicines = Array.isArray(value.recommendedMedicines)
    ? value.recommendedMedicines
      .map(normalizeMedicineRecommendation)
      .filter((item): item is ChronicRefillMedicineInput => Boolean(item))
    : [];
  return {
    chiefComplaint: chiefComplaint.length >= 6
      && /复诊|续方|配药/u.test(chiefComplaint)
      && candidate.diagnoses.every((diagnosis) => chiefComplaint.includes(diagnosis))
      ? chiefComplaint
      : fallback.chiefComplaint,
    historyOfPresentIllness: isPatientFactHistory(historyOfPresentIllness, candidate)
      ? historyOfPresentIllness
      : fallback.historyOfPresentIllness,
    pastMedicalHistory: pastMedicalHistory || fallback.pastMedicalHistory,
    currentMedicationHistory: fallback.currentMedicationHistory,
    treatmentPlan: fallback.treatmentPlan,
    healthEducation: normalizeChronicRefillHealthEducation(
      healthEducation,
      fallback.healthEducation,
    ),
    recommendedMedicines: recommendedMedicines.length > 0
      ? recommendedMedicines
      : fallback.recommendedMedicines,
    reviewPlan: normalizeChronicRefillConfirmationPlan(value.reviewPlan, candidate),
  };
}

function matchDiagnosis(
  diagnosis: string,
  candidate: ChronicRefillCandidate,
): ClinicalResultDiagnosis {
  const matched = medicalDataService.matchDiagnosis(diagnosis);
  return {
    name: diagnosis,
    code: matched?.code || '',
    evidenceText: candidate.diagnosisEvidenceText,
    rationale: '',
    sourceType: 'explicit',
    confidence: 'high',
    matchedItem: matched
      ? { id: matched.id, code: matched.code, name: matched.name }
      : null,
  };
}

function buildChronicRefillClinicalResult(
  patient: AppPatient,
  candidate: ChronicRefillCandidate,
  draft: NormalizedChronicRefillDraft,
  treatments: ClinicalResultInput['treatments'],
  generation?: ClinicalResultInput['generation'],
): ClinicalResultInput {
  return {
    chiefComplaint: draft.chiefComplaint,
    historyOfPresentIllness: draft.historyOfPresentIllness,
    pastMedicalHistory: draft.pastMedicalHistory,
    allergyHistory: getPatientContextAllergyHistory(patient) || '未记录',
    currentMedicationHistory: draft.currentMedicationHistory,
    familyHistory: '',
    symptoms: [],
    negativeSymptoms: [],
    diagnoses: candidate.diagnoses.map((diagnosis) => matchDiagnosis(diagnosis, candidate)),
    treatments,
    treatmentPlan: draft.treatmentPlan,
    healthEducation: draft.healthEducation,
    recommendationPolicy: {
      autoFetchTreatments: false,
      allowTreatmentRefresh: false,
      allowedTreatmentTypes: ['medicine'],
    },
    chronicRefillReview: draft.reviewPlan,
    generation,
    channel: 'chronic-refill',
  };
}

export async function generateChronicRefillRecord(
  patient: AppPatient,
  candidate: ChronicRefillCandidate,
  options?: ChronicRefillRecordGenerationOptions,
): Promise<ClinicalResultInput> {
  let draft = fallbackDraft(patient, candidate, []);
  options?.onPartial?.(buildChronicRefillClinicalResult(patient, candidate, draft, [], {
    status: 'streaming',
    readySections: ['record_core', 'history_context', 'diagnoses', 'review_plan'],
    stage: 'preparing-context',
    message: '已整理历史病历，正在读取院内药品',
  }));

  const inventoryContext = await loadAvailableMedicineInventoryContext().catch((error) => {
    console.warn('[ChronicRefill] Failed to load available inventory, no refill medicine will be preselected', error);
    return {
      items: [],
      promptContext: '',
      pharmacyCount: 0,
      staleStoreCount: 0,
    };
  });
  const initialTreatments = buildChronicRefillInventoryTreatments(
    candidate.medications,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedicationOrders: candidate.medicationOrders,
      prescriptionHistoryVisits: candidate.prescriptionHistoryVisits || candidate.chronicVisits,
    },
  );
  const availableMedicationNames = initialTreatments
    .filter((item) => item.matchStatus === 'exact')
    .map((item) => item.name);
  draft = fallbackDraft(patient, candidate, availableMedicationNames);
  options?.onProgress?.('generating-content');
  options?.onPartial?.(buildChronicRefillClinicalResult(patient, candidate, draft, [], {
    status: 'streaming',
    readySections: ['record_core', 'history_context', 'diagnoses', 'review_plan'],
    message: '病历基础内容已就绪，正在生成复诊核查与用药方案',
  }));

  const exactInventoryIds = new Set(
    initialTreatments
      .map((item) => item.matchedItem?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const inventoryPromptContext = candidate.medications.length > 0
    ? formatAvailableMedicineInventoryPrompt(
      inventoryContext.items.filter((item) => exactInventoryIds.has(item.productId)),
    )
    : inventoryContext.promptContext;
  const rawDraft: ChronicRefillDraft = { ...draft };
  const streamAccumulator = createChronicRefillRecordStreamAccumulator(rawDraft);
  let rawOutput = '';
  let receivedRecommendedMedicines = false;

  const emitStreamPartial = (): void => {
    draft = normalizeDraft(
      streamAccumulator.draft,
      patient,
      candidate,
      availableMedicationNames,
    );
    receivedRecommendedMedicines = streamAccumulator.readySections.includes('recommended_medicines');
    const partialTreatments = receivedRecommendedMedicines
      ? buildChronicRefillInventoryTreatments(
        draft.recommendedMedicines,
        inventoryContext.items,
        standardizeMedicineName,
        {
          historicalMedications: candidate.medications,
          historicalMedicationOrders: candidate.medicationOrders,
          prescriptionHistoryVisits: candidate.prescriptionHistoryVisits || candidate.chronicVisits,
        },
      )
      : [];
    options?.onPartial?.(buildChronicRefillClinicalResult(
      patient,
      candidate,
      draft,
      partialTreatments,
      {
        status: 'streaming',
        readySections: [...streamAccumulator.readySections],
        message: receivedRecommendedMedicines
          ? '用药候选已就绪，正在完成结果校验'
          : '病历内容正在逐步生成',
      },
    ));
  };
  const streamParser = createChronicRefillRecordStreamParser((event) => {
    applyChronicRefillRecordStreamEvent(streamAccumulator, event);
    if (event.event !== 'done') emitStreamPartial();
  });

  try {
    await chatStream([
      {
        role: 'system',
        content: [
          '你是基层门诊慢性病复诊配药病历助手。',
          '慢病范围已由医生确认；主诉、现病史、诊断和推荐用药只能围绕已选慢病，不得加入患者其他慢病。',
          '根据患者近90天就诊中的慢病就诊记录和配药信息生成本次可编辑病历草稿，不得编造当前症状、生命体征、检查结果或病情稳定程度。历史处方仅用于当前用药史、用药推荐与复诊核查。',
          '主诉应写明具体慢病和“复诊配药”目的。',
          '本次尚未完成当前用药、依从性、控制情况、不适和不良反应核查；historyOfPresentIllness只能写医生已确认的慢病诊断和本次复诊配药目的，不得提前写规律服药、控制平稳、无不适或监测结果。',
          'historyOfPresentIllness禁止写入任何历史药名、规格、剂量、频次、用法、疗程、总量，也禁止写入年龄、性别、当前库存、可续方药品、可参考药品、推荐药品、待医生核实或后续治疗方案；历史规范药名只能写入currentMedicationHistory，完整处方信息只能用于recommendedMedicines和reviewPlan。',
          '正式病历字段不得写“待医生补充完善、建议询问、信息不足、未提供相关信息”等工作流提示；也不得写“对话中未提及、问诊中未说明、资料中未记录”等信息来源或缺失状态。没有有效临床事实时保持字段为空。currentMedicationHistory 的历史用药待核实占位是唯一例外。',
          '禁止使用“未提供新发不适信息”等近义表达作为主诉或现病史主体，也不得把未提及自动改写为“无不适”或“病情稳定”。',
          '药品按“库存同品 → 库存等效药 → 规范通用名兜底”选择；无库存通用名仅供医生参考。',
          '若未获取到可确认的历史用药，仍需根据具体慢病诊断、患者信息和当前有效库存推荐合理的候选药品，不得返回空方案。',
          '未获取到历史用药时，currentMedicationHistory只能写“历史用药方案待医生核实”等待核实表述，不得把本次推荐药品伪装成既往用药。',
          'recommendedMedicines 必须返回结构化药品对象，不生成检查、检验或处置。',
          '每个药品必须结合候选慢病、历史用药和库存规格给出合理的目标临床一次剂量、频次和用法；不得把包装规格直接当成一次剂量，也不得把所有药品统一写成一次1剂量单位。',
          '目标剂量只写targetDose/targetDoseUnit，例如500mg写为targetDose="500"、targetDoseUnit="mg"；dosage/dosageUnit必须留空，由程序结合PHIS药品详情换算。frequencyKey优先使用QD/BID/TID/QID，routeKey口服优先使用PO。',
          'days、totalQty、totalUnit必须留空；用药天数只允许程序沿用可靠关联的历史处方，包装总量由程序根据最终一次剂量、频次、天数和库存包装规格计算并校验库存。',
          'reason只说明诊断、历史用药和适应证等临床推荐依据，不得复述或计算单次剂量、频次、疗程、总量和包装数量。',
          '同一次返回reviewPlan，动态生成3到5个最少且必要的复诊核查项，覆盖当前实际用药、依从性、病情或监测控制、疾病相关不适和药物不良反应。',
          'reviewPlan每项提供2到4个互斥选项、recommendedValue、confidence、evidence、basis和priority；推荐只用于界面提示，不代表医生已确认。',
          '每个选项提供recordText；未知/未评估/未询问选项recordText必须为空。会影响续方安全的选项（用药调整或停用、控制波动或欠佳、存在相关不适或不良反应）必须设置treatmentReviewRequired=true。',
          'priority只允许critical或general；当前用药、控制情况、相关不适和不良反应默认属于critical。',
          'healthEducation必须针对患者的具体慢性病诊断和病情，给出具体的规律用药注意事项、自我指标监测、饮食调养和复诊条件等个性化健康处方，严禁写入通用的“注意休息”、“1周内复诊”或“必要时上级医院进一步治疗”。',
          '必须逐行输出 NDJSON；每行只包含一个完整 JSON 对象，不要输出数组外壳、markdown、代码块或解释。',
          '严格按 record_core、review_plan、recommended_medicines、record_extra、done 的顺序输出。',
          '格式为 {"event":"事件名","data":对应数据}。record_core.data包含chiefComplaint、historyOfPresentIllness、pastMedicalHistory、currentMedicationHistory；review_plan.data为完整reviewPlan；recommended_medicines.data为药品数组；record_extra.data包含healthEducation；done.data可为空对象。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `患者：${getPatientContextName(patient)}，${getPatientContextGenderText(patient)}，${getPatientContextAgeText(patient)}`,
          `过敏史：${getPatientContextAllergyHistory(patient) || '未记录'}`,
          `医生已确认的本次慢病：${candidate.diagnoses.join('、')}`,
          `慢病分类（仅用于场景识别）：${candidate.diagnosisGroups.join('、')}`,
          `历史慢病配药：${candidate.medicationEvidenceText}`,
          `当前库存内可续方药品：${buildMedicationSummary(availableMedicationNames)}`,
          inventoryPromptContext,
          '近90天内的慢病就诊依据：',
          buildHistoryEvidence(candidate),
          [
            '请生成字段：chiefComplaint、historyOfPresentIllness、pastMedicalHistory、currentMedicationHistory、treatmentPlan、healthEducation、recommendedMedicines、reviewPlan。',
            'recommendedMedicines格式：',
            '[{"name":"库存中的完整药品名称","spec":"库存规格","targetDose":"目标临床一次剂量数值","targetDoseUnit":"mg/g/ml","frequency":"频次文本","frequencyKey":"频次编码","route":"用法文本","routeKey":"用法编码","days":"","reason":"推荐依据"}]',
            'reviewPlan格式：',
            '{"summary":"核查提示","items":[{"id":"stable-id","question":"核查问题","description":"简短说明","options":[{"value":"值","label":"选项","recordText":"确认后写入的事实","treatmentReviewRequired":false}],"recommendedValue":"值","confidence":"high|medium|low","evidence":"current-explicit|historical-consistent|model-inference|unknown","basis":"推荐依据","priority":"critical|general"}]}',
          ].join('\n'),
        ].join('\n'),
      },
    ], (chunk) => {
      rawOutput += chunk;
      streamParser.push(chunk);
    }, undefined, undefined, undefined, {
      configProfile: 'fast',
      traceContext: {
        scene: 'reception-chronic-refill-record',
        sourceModule: 'reception_risk',
        operationModule: 'reception',
        operationAction: 'generate_chronic_refill_record',
        title: '接诊生成复诊配药病历',
      },
    });
    streamParser.flush();
    if (streamAccumulator.eventCount === 0 && rawOutput.trim()) {
      draft = normalizeDraft(
        parseLLMJson<ChronicRefillDraft>(rawOutput),
        patient,
        candidate,
        availableMedicationNames,
      );
      receivedRecommendedMedicines = true;
    } else {
      draft = normalizeDraft(
        streamAccumulator.draft,
        patient,
        candidate,
        availableMedicationNames,
      );
    }
  } catch (error) {
    streamParser.flush();
    console.warn('[ChronicRefill] Streaming draft stopped, retaining available partial result', error);
    draft = normalizeDraft(
      streamAccumulator.draft,
      patient,
      candidate,
      availableMedicationNames,
    );
  }
  options?.onProgress?.('finalizing-result');
  const treatments = buildChronicRefillInventoryTreatments(
    draft.recommendedMedicines,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedications: candidate.medications,
      historicalMedicationOrders: candidate.medicationOrders,
      prescriptionHistoryVisits: candidate.prescriptionHistoryVisits || candidate.chronicVisits,
    },
  );

  return buildChronicRefillClinicalResult(patient, candidate, draft, treatments);
}
