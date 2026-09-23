import { chatStream } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import type { AppPatient } from '@/types/appState';
import {
  getPatientContextAgeText,
  getPatientContextAllergyHistory,
  getPatientContextGenderText,
  getPatientContextMenstrualHistory,
  getPatientContextMaritalReproductiveHistory,
  getPatientContextPastMedicalHistory,
} from '@/utils/patientContext';
import {
  loadAvailableMedicineInventoryContext,
  buildOutpatientRecord,
  completePhysicalExamSuggestions,
  normalizeClinicalRecordFactSuggestions,
  type ClinicalRecordFactSuggestionResponse,
  type ClinicalRecordFactSuggestion,
  type AvailableMedicineInventoryCatalogItem,
  normalizeGeneratedClinicalRecordNarrative,
  resolveHistoryRecordTemplate,
  parseLLMJson,
  type ClinicalResultGenerationStage,
  type ClinicalResultDiagnosis,
  type ClinicalResultInput,
} from '@features/clinical-result';
import {
  applyChronicRefillMedicationScope,
  type ChronicRefillCandidate,
} from '../lib/chronicRefillAssessment';
import {
  normalizeChronicRefillConfirmationPlan,
  type ChronicRefillConfirmationPlan,
  type RawChronicRefillConfirmationPlan,
} from '../lib/chronicRefillConfirmation';
import { normalizeChronicRefillHistoryOfPresentIllness } from '@features/clinical-result/lib/chronicRefillReviewRecordText';
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
import {
  buildChronicRefillInventoryPromptContext,
  buildChronicRefillMedicationScopePromptContext,
  buildCompactChronicRefillHistoryEvidence,
} from '../lib/chronicRefillPromptContext';
import {
  chronicRefillTimingTracker,
  type ChronicRefillTimingSession,
} from '../model/chronicRefillTimingTracker';

export interface ChronicRefillRecordGenerationOptions {
  onProgress?: (stage: Extract<
    ClinicalResultGenerationStage,
    'generating-content' | 'finalizing-result'
  >) => void;
  onPartial?: (result: ClinicalResultInput) => void;
  sessionId?: string;
  timing?: ChronicRefillTimingSession;
}

interface ChronicRefillDraft {
  physicalExamSuggestions?: ClinicalRecordFactSuggestionResponse['items'];
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  currentMedicationHistory?: string;
  treatmentPlan?: string;
  healthEducation?: string;
  recommendedMedicines?: ChronicRefillMedicineInput[];
  reviewPlan?: RawChronicRefillConfirmationPlan;
  medicationScope?: unknown;
}

interface NormalizedChronicRefillDraft {
  physicalExamSuggestions: ClinicalRecordFactSuggestion[];
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  currentMedicationHistory: string;
  treatmentPlan: string;
  healthEducation: string;
  recommendedMedicines: ChronicRefillMedicineInput[];
  reviewPlan: ChronicRefillConfirmationPlan;
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
  return Array.from(text).slice(0, 160).join('').replace(/[，,；;：:\s]+$/u, '');
}

function normalizeMedicineRecommendation(
  value: unknown,
  inventoryByRef: ReadonlyMap<string, AvailableMedicineInventoryCatalogItem>,
): ChronicRefillMedicineInput | null {
  if (typeof value === 'string') {
    return value.trim() || null;
  }
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const inventoryRef = typeof source.ref === 'string' ? source.ref.trim() : '';
  const referencedInventory = inventoryRef ? inventoryByRef.get(inventoryRef) : undefined;
  const name = referencedInventory?.productName
    || (typeof source.name === 'string' ? source.name.trim() : '');
  if (!name) return null;

  const result: ChronicRefillMedicineRecommendation = {
    name,
    ...(referencedInventory?.spec ? { spec: referencedInventory.spec } : {}),
  };
  const textFields: Array<keyof Omit<ChronicRefillMedicineRecommendation, 'name'>> = [
    ...(referencedInventory ? [] : ['spec'] as const),
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

function isMedicationRecommendationInScope(
  recommendation: ChronicRefillMedicineInput,
  candidate: ChronicRefillCandidate,
): boolean {
  const name = typeof recommendation === 'string' ? recommendation : recommendation.name;
  const normalizedName = standardizeMedicineName(name).replace(/\s+/gu, '');
  if (!normalizedName) return false;
  const isAmbiguousHistoricalMedication = (candidate.medicationAttributions || []).some((item) => (
    standardizeMedicineName(item.medication.name).replace(/\s+/gu, '') === normalizedName
  ));
  if (!isAmbiguousHistoricalMedication) return true;
  return candidate.medications.some((item) => (
    standardizeMedicineName(item).replace(/\s+/gu, '') === normalizedName
  ));
}

function buildInventoryCandidateContext(candidate: ChronicRefillCandidate): {
  medications: string[];
  medicationOrders: NonNullable<ChronicRefillCandidate['medicationOrders']>;
} {
  return {
    medications: Array.from(new Set([
      ...candidate.medications,
      ...(candidate.medicationAttributions || []).map((item) => item.medication.name),
    ].filter(Boolean))),
    medicationOrders: [
      ...(candidate.medicationOrders || []),
      ...(candidate.medicationAttributions || [])
        .filter((item) => item.source === 'structured')
        .map((item) => item.medication),
    ],
  };
}

function buildChronicPastMedicalHistory(patient: AppPatient, candidate: ChronicRefillCandidate): string {
  const diagnoses = Array.from(new Set(
    (candidate.historicalDiagnoses || candidate.diagnoses).map((name) => name.trim()).filter(Boolean),
  ));
  const patientHistory = getPatientContextPastMedicalHistory(patient);
  const confirmedHistory = diagnoses.length > 0 ? `既往确诊${diagnoses.join('、')}。` : '';
  const history = resolveHistoryRecordTemplate(
    'pastMedicalHistory',
    [patientHistory, confirmedHistory, getPatientContextAllergyHistory(patient)].filter(Boolean).join('；'),
    patientHistory,
  );
  // 固定模板的宽泛槽位不能代替具体诊断名（如 2 型糖尿病、甲减）。
  const additionalDiagnoses = diagnoses.filter((name) => !history.includes(name));
  return additionalDiagnoses.length > 0
    ? `${history}既往确诊${additionalDiagnoses.join('、')}。`
    : history;
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
    physicalExamSuggestions: [],
    chiefComplaint: `${diagnosisText}复诊配药`,
    historyOfPresentIllness: `患者既往确诊${diagnosisText}。今复诊配药。`,
    pastMedicalHistory: buildChronicPastMedicalHistory(patient, candidate),
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
  inventoryByRef: ReadonlyMap<string, AvailableMedicineInventoryCatalogItem>,
): NormalizedChronicRefillDraft {
  const fallback = fallbackDraft(patient, candidate, availableMedications);
  const chiefComplaint = normalizeGeneratedClinicalRecordNarrative(
    value.chiefComplaint,
    'chiefComplaint',
  ).text;
  const historyOfPresentIllness = normalizeChronicRefillHistoryOfPresentIllness(
    normalizeGeneratedClinicalRecordNarrative(
      value.historyOfPresentIllness,
      'historyOfPresentIllness',
    ).text,
  );
  const healthEducation = normalizeGeneratedClinicalRecordNarrative(
    value.healthEducation,
    'precautions',
  ).text;
  const recommendedMedicines = Array.isArray(value.recommendedMedicines)
    ? value.recommendedMedicines
      .map((item) => normalizeMedicineRecommendation(item, inventoryByRef))
      .filter((item): item is ChronicRefillMedicineInput => Boolean(item))
      .filter((item) => isMedicationRecommendationInScope(item, candidate))
    : [];
  return {
    physicalExamSuggestions: normalizeClinicalRecordFactSuggestions({ items: value.physicalExamSuggestions })
      .filter((item) => item.field === 'physicalExam')
      .slice(0, 2),
    chiefComplaint: chiefComplaint.length >= 6
      && /复诊|续方|配药/u.test(chiefComplaint)
      && candidate.diagnoses.every((diagnosis) => chiefComplaint.includes(diagnosis))
      ? chiefComplaint
      : fallback.chiefComplaint,
    historyOfPresentIllness: isPatientFactHistory(historyOfPresentIllness, candidate)
      ? historyOfPresentIllness
      : fallback.historyOfPresentIllness,
    pastMedicalHistory: fallback.pastMedicalHistory,
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
  const outpatientRecord = buildOutpatientRecord({
    chiefComplaint: draft.chiefComplaint, historyOfPresentIllness: draft.historyOfPresentIllness,
    pastMedicalHistory: draft.pastMedicalHistory, precautions: draft.healthEducation,
    diagnosisNames: candidate.diagnoses, chronicFollowUp: true,
    patientGender: getPatientContextGenderText(patient),
    menstrualHistory: getPatientContextMenstrualHistory(patient),
    maritalReproductiveHistory: getPatientContextMaritalReproductiveHistory(patient),
  });
  const factSuggestions = completePhysicalExamSuggestions(outpatientRecord, candidate.diagnoses, draft.physicalExamSuggestions);
  return {
    outpatientRecord,
    factSuggestions,
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
  const timing = options?.timing || chronicRefillTimingTracker.get(options?.sessionId);
  const baseCandidate = candidate;
  let resolvedCandidate = baseCandidate;
  let draft = fallbackDraft(patient, resolvedCandidate, []);
  options?.onPartial?.(buildChronicRefillClinicalResult(patient, resolvedCandidate, draft, [], {
    status: 'streaming',
    readySections: ['record_core', 'history_context', 'diagnoses', 'review_plan'],
    stage: 'preparing-context',
    message: '已整理历史病历，正在读取院内药品',
  }));

  const endInventory = timing?.span('inventory_context_loading');
  const inventoryContext = await loadAvailableMedicineInventoryContext().catch((error) => {
    console.warn('[ChronicRefill] Failed to load available inventory, no refill medicine will be preselected', error);
    return {
      items: [],
      promptContext: '',
      pharmacyCount: 0,
      staleStoreCount: 0,
    };
  });
  endInventory?.(inventoryContext.items.length);

  const endInitialTreatments = timing?.span('initial_inventory_matching');
  const initialTreatments = buildChronicRefillInventoryTreatments(
    baseCandidate.medications,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedicationOrders: baseCandidate.medicationOrders,
      prescriptionHistoryVisits: baseCandidate.prescriptionHistoryVisits || baseCandidate.chronicVisits,
    },
  );
  const availableMedicationNames = initialTreatments
    .filter((item) => item.matchStatus === 'exact')
    .map((item) => item.name);
  endInitialTreatments?.(availableMedicationNames.length);

  draft = fallbackDraft(patient, resolvedCandidate, availableMedicationNames);
  options?.onProgress?.('generating-content');
  options?.onPartial?.(buildChronicRefillClinicalResult(patient, resolvedCandidate, draft, [], {
    status: 'streaming',
    readySections: ['record_core', 'history_context', 'diagnoses', 'review_plan'],
    message: '病历基础内容已就绪，正在生成复诊核查与用药方案',
  }));

  const endPromptContextBuild = timing?.span('prompt_context_build');
  const inventoryCandidateContext = buildInventoryCandidateContext(baseCandidate);
  const inventoryCandidateTreatments = buildChronicRefillInventoryTreatments(
    inventoryCandidateContext.medications,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedicationOrders: inventoryCandidateContext.medicationOrders,
      prescriptionHistoryVisits: baseCandidate.prescriptionHistoryVisits || baseCandidate.chronicVisits,
    },
  );
  const exactInventoryIds = new Set(
    inventoryCandidateTreatments
      .map((item) => item.matchedItem?.id)
      .filter((id): id is string => Boolean(id)),
  );
  const useScopedInventoryPrompt = inventoryCandidateContext.medications.length > 0;
  const inventoryPromptItems = useScopedInventoryPrompt
    ? inventoryContext.items.filter((item) => exactInventoryIds.has(item.productId))
    : inventoryContext.items;
  const inventoryPromptContext = buildChronicRefillInventoryPromptContext(inventoryPromptItems);
  const medicationScopeContext = buildChronicRefillMedicationScopePromptContext(baseCandidate);
  const hasMedicationScope = medicationScopeContext.itemCount > 0;
  const historyEvidence = buildCompactChronicRefillHistoryEvidence(baseCandidate);
  timing?.mark(
    useScopedInventoryPrompt ? 'inventory_prompt_scoped' : 'inventory_prompt_full',
    inventoryPromptItems.length,
  );
  timing?.mark('inventory_prompt_chars', inventoryPromptContext.prompt.length);
  timing?.mark('history_evidence_chars', historyEvidence.length);
  timing?.mark('medication_scope_items', medicationScopeContext.itemCount);
  timing?.mark('medication_scope_groups', medicationScopeContext.groupCount);
  endPromptContextBuild?.(
    inventoryPromptContext.prompt.length + medicationScopeContext.prompt.length + historyEvidence.length,
  );
  const rawDraft: ChronicRefillDraft = { ...draft };
  const streamAccumulator = createChronicRefillRecordStreamAccumulator(rawDraft);
  let rawOutput = '';
  let receivedRecommendedMedicines = false;

  const getResolvedAvailableMedicationNames = (): string[] => buildChronicRefillInventoryTreatments(
    resolvedCandidate.medications,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedicationOrders: resolvedCandidate.medicationOrders,
      prescriptionHistoryVisits: resolvedCandidate.prescriptionHistoryVisits || resolvedCandidate.chronicVisits,
    },
  )
    .filter((item) => item.matchStatus === 'exact')
    .map((item) => item.name);

  const emitStreamPartial = (): void => {
    const resolvedAvailableMedicationNames = getResolvedAvailableMedicationNames();
    draft = normalizeDraft(
      streamAccumulator.draft,
      patient,
      resolvedCandidate,
      resolvedAvailableMedicationNames,
      inventoryPromptContext.byRef,
    );
    receivedRecommendedMedicines = streamAccumulator.readySections.includes('recommended_medicines');
    const partialTreatments = receivedRecommendedMedicines
      ? buildChronicRefillInventoryTreatments(
        draft.recommendedMedicines,
        inventoryContext.items,
        standardizeMedicineName,
        {
          historicalMedications: resolvedCandidate.medications,
          historicalMedicationOrders: resolvedCandidate.medicationOrders,
          prescriptionHistoryVisits: resolvedCandidate.prescriptionHistoryVisits || resolvedCandidate.chronicVisits,
        },
      )
      : [];
    options?.onPartial?.(buildChronicRefillClinicalResult(
      patient,
      resolvedCandidate,
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
    const sectionSize = JSON.stringify(event.data)?.length || 0;
    timing?.mark(`section_${event.event}`, sectionSize);
    applyChronicRefillRecordStreamEvent(streamAccumulator, event);
    if (event.event === 'medication_scope') {
      resolvedCandidate = applyChronicRefillMedicationScope(
        baseCandidate,
        medicationScopeContext.decode(event.data),
      );
    }
    if (event.event !== 'done') emitStreamPartial();
  });

  const endRequestBuild = timing?.span('llm_request_build');
  const streamOrder = hasMedicationScope
    ? 'record_core、medication_scope、review_plan、recommended_medicines、record_extra、done'
    : 'record_core、review_plan、recommended_medicines、record_extra、done';
  const patientTraits = [
    getPatientContextGenderText(patient),
    getPatientContextAgeText(patient),
  ].filter(Boolean).join('，') || '未记录';
  const messages: Parameters<typeof chatStream>[0] = [
    {
      role: 'system',
      content: [
        '你是基层门诊慢病复诊配药助手。病历核心、通用核查骨架和基础查体已由程序确定性生成；你只返回增量决策。',
        '慢病范围已由医生确认。所有核查、用药、健康指导和查体补充只能围绕已选慢病，不得把历史共病扩入本次范围，也不得编造当前症状、监测结果、生命体征、依从性、控制程度或不良反应。',
        ...(hasMedicationScope ? [
          'medication_scope 输入使用请求内短引用。只返回与某个候选慢病有明确直接治疗关系、且置信度至少为medium的药品；未返回即视为低置信或未归类。只能使用输入中的M/C引用，不解释。',
          'medication_scope.data格式为 {"accepted":[["M1","C1","h|m"]]}，第三项h=high、m=medium。只允许归入selected中的慢病。',
        ] : []),
        'recommended_medicines只生成药品，不生成检查、检验或处置。库存药必须返回库存ref，由程序恢复名称和规格；无合适库存时才返回规范通用名name。',
        '每个药品结合已选慢病、历史处方摘要和库存规格给出临床目标一次剂量、频次和用法。包装规格不是一次剂量；不得统一写成一次1单位。',
        '药品字段只允许ref或name、targetDose、targetDoseUnit、frequency、frequencyKey、route、routeKey、reason。不得输出dosage、dosageUnit、days、totalQty、totalUnit；这些由程序从可靠历史和药品详情计算。reason不超过40字，只写临床依据，不写剂量或包装算术。',
        'review_plan只补充确定性核查骨架。patch id只允许control-status或current-symptoms；最多2项，每项只含id、question、description、basis，文本简短且不写处方属性。没有更具体内容时patches为空。',
        'record_extra.healthEducation不超过160字，包含与已选慢病相关的规律用药、家庭监测、饮食和复诊提醒。不得写“注意休息”“1周内复诊”或笼统建议。',
        '基础查体由程序补齐。physicalExamSuggestions最多2项，只补基础库之外、与已选慢病直接相关的重点专科查体；每项包含field="physicalExam"、question、negativeRecordText、rationale、priority。不得生成测量值，不得把候选当作当前事实或用药依据。没有必要补充时返回空数组。',
        '逐行输出NDJSON，每行一个完整JSON对象，不输出markdown、解释或数组外壳。',
        `严格按${streamOrder}顺序输出。`,
        `record_core固定为{"event":"record_core","data":{}}。review_plan.data格式为{"patches":[{"id":"control-status","question":"...","description":"...","basis":"..."}]}。recommended_medicines.data为药品数组。record_extra.data包含healthEducation和physicalExamSuggestions。done.data为空对象。`,
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `患者特征：${patientTraits}`,
        `过敏史：${getPatientContextAllergyHistory(patient) || '未记录'}`,
        `已选慢病：${baseCandidate.diagnoses.join('、')}`,
        '历史处方摘要：',
        historyEvidence,
        ...(hasMedicationScope ? [
          `待归类药品：${medicationScopeContext.prompt}`,
        ] : []),
        inventoryPromptContext.prompt,
      ].join('\n'),
    },
  ];
  const llmPromptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  timing?.mark('llm_prompt_chars', llmPromptChars);
  endRequestBuild?.(llmPromptChars);

  let streamChunkCount = 0;
  let previousChunkAt: number | undefined;
  let maxChunkGapMs = 0;
  let streamMetricsRecorded = false;
  const recordStreamMetrics = () => {
    if (streamMetricsRecorded) return;
    streamMetricsRecorded = true;
    timing?.mark('llm_output_chars', rawOutput.length);
    timing?.mark('llm_stream_chunks', streamChunkCount);
    timing?.measure('llm_chunk_gap_max', maxChunkGapMs, streamChunkCount);
  };
  const endLlmStream = timing?.span('llm_stream_total');
  timing?.mark('llm_stream_started');
  try {
    await chatStream(messages, (chunk) => {
      const chunkAt = performance.now();
      if (previousChunkAt !== undefined) {
        maxChunkGapMs = Math.max(maxChunkGapMs, chunkAt - previousChunkAt);
      }
      previousChunkAt = chunkAt;
      streamChunkCount += 1;
      timing?.mark('llm_first_chunk');
      rawOutput += chunk;
      streamParser.push(chunk);
    }, undefined, undefined, undefined, {
      configProfile: 'fast',
      temperature: 0,
      traceContext: {
        scene: 'reception-chronic-refill-record',
        sourceModule: 'reception_risk',
        operationModule: 'reception',
        operationAction: 'generate_chronic_refill_record',
        title: '接诊生成复诊配药病历',
      },
    });
    streamParser.flush();
    recordStreamMetrics();
    timing?.mark('llm_stream_completed');
    endLlmStream?.();
    if (streamAccumulator.eventCount === 0 && rawOutput.trim()) {
      const parsedDraft = parseLLMJson<ChronicRefillDraft>(rawOutput);
      if (parsedDraft.medicationScope !== undefined) {
        resolvedCandidate = applyChronicRefillMedicationScope(
          baseCandidate,
          medicationScopeContext.decode(parsedDraft.medicationScope),
        );
      }
      draft = normalizeDraft(
        parsedDraft,
        patient,
        resolvedCandidate,
        getResolvedAvailableMedicationNames(),
        inventoryPromptContext.byRef,
      );
      receivedRecommendedMedicines = true;
    } else {
      draft = normalizeDraft(
        streamAccumulator.draft,
        patient,
        resolvedCandidate,
        getResolvedAvailableMedicationNames(),
        inventoryPromptContext.byRef,
      );
    }
  } catch (error) {
    streamParser.flush();
    recordStreamMetrics();
    timing?.mark('llm_stream_completed');
    endLlmStream?.();
    console.warn('[ChronicRefill] Streaming draft stopped, retaining available partial result', error);
    draft = normalizeDraft(
      streamAccumulator.draft,
      patient,
      resolvedCandidate,
      getResolvedAvailableMedicationNames(),
      inventoryPromptContext.byRef,
    );
  }
  options?.onProgress?.('finalizing-result');
  const endFinalTreatments = timing?.span('final_inventory_treatments');
  const treatments = buildChronicRefillInventoryTreatments(
    draft.recommendedMedicines,
    inventoryContext.items,
    standardizeMedicineName,
    {
      historicalMedications: resolvedCandidate.medications,
      historicalMedicationOrders: resolvedCandidate.medicationOrders,
      prescriptionHistoryVisits: resolvedCandidate.prescriptionHistoryVisits || resolvedCandidate.chronicVisits,
    },
  );
  endFinalTreatments?.(treatments.length);

  return buildChronicRefillClinicalResult(patient, resolvedCandidate, draft, treatments);
}
