import { computed, ref, type Ref } from 'vue';
import { chat } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import type { HisOutpatientFollowUpContext } from '@/services/his/types';
import type { PharmacyOption } from '@/services/his';
import {
  applyRecommendationPreferenceRanking,
  buildTreatmentPreferenceCandidate,
} from '@/services/recommendationPreferenceTracker';
import { PROMPTS } from '@/prompts';
import type { AppPatient } from '@/types/appState';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type { ReportFollowUpActionability } from '@/types/reportInterpretation';
import {
  getPatientContextAgeText,
  getPatientContextAllergyHistory,
  getPatientContextId,
  getPatientContextName,
  getPatientContextPastMedicalHistory,
  getPatientContextGenderText,
} from '@/utils/patientContext';
import {
  alignMedicineRecommendationsToInventory,
  assessTreatmentCatalogMatch,
  buildClinicalResultTreatmentRequestSpec,
  buildClinicalResultTreatmentRecommendationsFromRaw,
  findUnmatchedMedicineInventoryIntentNames,
  formatAvailableMedicineInventoryCandidatesPrompt,
  loadAvailableMedicineInventoryContext,
  mapClinicalResultAiDiagnoses,
  parseLLMJson,
  readFirstString,
  selectAvailableMedicineInventoryCandidates,
  type RawClinicalResultTreatmentRecommendationInput,
} from '@features/clinical-result';
import type {
  ClinicalResultTreatmentRequestKind,
} from '@features/clinical-result';
import {
  buildOutpatientFollowUpEvidence,
  buildOutpatientFollowUpTreatmentEvidence,
  isOutpatientFollowUpActionable,
} from '@features/outpatient-follow-up/api/outpatientFollowUpContext';

export interface TreatmentPlanRecordContext {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  allergyHistory: string;
  diagnosisText: string;
  followUpEvidence: string;
  followUpActionability?: ReportFollowUpActionability;
  isFollowUp: boolean;
}

export interface TreatmentPlanRecommendationSection {
  key: ClinicalResultTreatmentRequestKind;
  title: string;
  itemType: TreatmentRecommendation['type'];
  items: TreatmentRecommendation[];
  loading: boolean;
  error: string;
}

export interface TreatmentPlanRecommendationOptions {
  patient: Ref<AppPatient | null>;
  followUpContext: Ref<HisOutpatientFollowUpContext | null>;
  diagnosis: Ref<Diagnosis | null>;
  treatments: Ref<TreatmentRecommendation[]>;
  pharmacies: Ref<PharmacyOption[]>;
  normalizeTreatment: (rec: Partial<TreatmentRecommendation>) => TreatmentRecommendation;
}

const UI_SECTIONS = [
  {
    key: 'medication' as const,
    itemType: 'medicine' as const,
    title: '药品',
  },
  {
    key: 'exam' as const,
    itemType: 'exam' as const,
    title: '检查项目',
  },
  {
    key: 'lab_test' as const,
    itemType: 'lab_test' as const,
    title: '检验项目',
  },
  {
    key: 'procedure' as const,
    itemType: 'procedure' as const,
    title: '处置项目',
  },
];

const RECOMMENDATION_TASKS = [
  {
    key: 'unified' as const,
    uiKeys: ['medication' as const, 'exam' as const, 'lab_test' as const, 'procedure' as const],
    itemTypes: ['medicine' as const, 'exam' as const, 'lab_test' as const, 'procedure' as const],
    prompt: PROMPTS.consultation.unifiedTreatmentPlanRecommendation,
    traceTitle: '诊疗方案推荐生成完整方案',
  }
];

function readPatientText(patient: AppPatient | null, keys: string[]): string {
  if (!patient) return '';

  const sources = [
    patient as Record<string, unknown>,
    patient.clinical as Record<string, unknown> | undefined,
    patient.raw,
  ];

  for (const source of sources) {
    const value = readFirstString(source, keys);
    if (value) return value;
  }

  return '';
}

function buildRecordContext(
  patient: AppPatient | null,
  followUpContext: HisOutpatientFollowUpContext | null,
): TreatmentPlanRecordContext {
  const followUpEvidence = followUpContext?.assessment
    ? buildOutpatientFollowUpTreatmentEvidence(followUpContext)
    : buildOutpatientFollowUpEvidence(followUpContext);
  const diagnosisText = followUpContext?.currentDiagnosis?.trim()
    || readPatientText(patient, ['diagnosis', 'diagnosisText', 'diagnosis_text']);
  return {
    chiefComplaint: readPatientText(patient, ['chiefComplaint', 'chief_complaint']),
    historyOfPresentIllness: readPatientText(patient, ['historyOfPresentIllness', 'history_of_present_illness']),
    pastMedicalHistory: getPatientContextPastMedicalHistory(patient) || readPatientText(patient, ['pastMedicalHistory', 'past_medical_history']),
    allergyHistory: getPatientContextAllergyHistory(patient) || readPatientText(patient, ['allergyHistory', 'allergy_history']),
    diagnosisText,
    followUpEvidence,
    followUpActionability: followUpContext?.assessment?.actionability,
    isFollowUp: Boolean(followUpContext?.followUpEligible),
  };
}

function buildDiagnosisFromText(text: string): Diagnosis | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const [matched] = mapClinicalResultAiDiagnoses({
    rawDiagnoses: [{
      name: trimmed,
      code: '',
      rate: 'HIS诊断',
      rationale: '来自当前 HIS 诊断草稿',
    }],
    assessDiagnosis: (query, context) => medicalDataService.assessDiagnosisMatch(query, context),
    clearUnmatchedId: true,
  });

  return matched || {
    name: trimmed,
    code: '',
    rate: 'HIS诊断',
    rationale: '来自当前 HIS 诊断草稿',
  };
}

export function useTreatmentPlanRecommendations(options: TreatmentPlanRecommendationOptions) {
  const loadingByKind = ref<Record<ClinicalResultTreatmentRequestKind, boolean>>({
    medication: false,
    exam: false,
    lab_test: false,
    procedure: false,
  });
  const errorByKind = ref<Record<ClinicalResultTreatmentRequestKind, string>>({
    medication: '',
    exam: '',
    lab_test: '',
    procedure: '',
  });
  const initialized = ref(false);
  const refreshing = ref(false);
  const lastRunKey = ref('');

  const recordContext = computed(() => buildRecordContext(
    options.patient.value,
    options.followUpContext.value,
  ));
  const canRecommend = computed(() => {
    if (recordContext.value.isFollowUp) {
      return Boolean(recordContext.value.followUpEvidence)
        && (!options.followUpContext.value?.assessment
          || isOutpatientFollowUpActionable(options.followUpContext.value));
    }
    return Boolean(
      recordContext.value.diagnosisText
      && recordContext.value.chiefComplaint
      && recordContext.value.historyOfPresentIllness,
    );
  });
  const missingContextTips = computed(() => {
    const tips: string[] = [];
    if (recordContext.value.isFollowUp) {
      if (options.followUpContext.value?.assessment && !isOutpatientFollowUpActionable(options.followUpContext.value)) {
        tips.push('当前报告无新增治疗指征');
      }
      else if (!recordContext.value.followUpEvidence) tips.push('本次病历及报告处置结论');
      return tips;
    }
    if (!recordContext.value.chiefComplaint) tips.push('主诉');
    if (!recordContext.value.historyOfPresentIllness) tips.push('现病史');
    if (!recordContext.value.diagnosisText) tips.push('诊断');
    return tips;
  });
  const isLoading = computed(() => Object.values(loadingByKind.value).some(Boolean));
  const selectedTreatments = computed(() => options.treatments.value.filter((item) => item.selected));
  const sections = computed<TreatmentPlanRecommendationSection[]>(() => UI_SECTIONS.map((config) => ({
    key: config.key,
    title: config.title,
    itemType: config.itemType,
    items: options.treatments.value.filter((item) => item.type === config.itemType),
    loading: loadingByKind.value[config.key],
    error: errorByKind.value[config.key],
  })));

  function buildRunKey(): string {
    const patient = options.patient.value;
    return [
      getPatientContextId(patient),
      recordContext.value.chiefComplaint,
      recordContext.value.historyOfPresentIllness,
      recordContext.value.diagnosisText,
      recordContext.value.followUpEvidence,
    ].join('|');
  }

  function replaceTreatmentsByType(type: TreatmentRecommendation['type'], items: TreatmentRecommendation[]): void {
    options.treatments.value = [
      ...options.treatments.value.filter((item) => item.type !== type),
      ...items,
    ];
  }

  async function fetchTask(task: (typeof RECOMMENDATION_TASKS)[number], runKey: string): Promise<void> {
    task.uiKeys.forEach((key) => {
      loadingByKind.value = { ...loadingByKind.value, [key]: true };
      errorByKind.value = { ...errorByKind.value, [key]: '' };
    });

    const patient = options.patient.value;
    const currentDiagnosis = options.diagnosis.value;
    try {
      const followUpAssessment = options.followUpContext.value?.assessment;
      const requiresMedicine = !recordContext.value.isFollowUp
        || !followUpAssessment
        || followUpAssessment?.actionability === 'needs_treatment';
      const inventoryContext = requiresMedicine && ((task.key as string) === 'medication' || (task.key as string) === 'unified')
        ? await loadAvailableMedicineInventoryContext({ pharmacies: options.pharmacies.value })
        : null;
      const medicationIntents = followUpAssessment?.medicationIntents || [];
      const medicineCandidates = recordContext.value.isFollowUp && inventoryContext
        ? selectAvailableMedicineInventoryCandidates(inventoryContext.items, medicationIntents)
        : inventoryContext?.items || [];
      const unmatchedMedicineReferences = recordContext.value.isFollowUp && inventoryContext
        ? findUnmatchedMedicineInventoryIntentNames(inventoryContext.items, medicationIntents)
        : [];
      const medicineRecommendationPolicy = recordContext.value.isFollowUp && followUpAssessment
        ? followUpAssessment?.actionability === 'needs_treatment'
          ? medicineCandidates.length > 0
            ? unmatchedMedicineReferences.length > 0
              ? 'candidates-or-standard-reference' as const
              : 'candidates-only' as const
            : 'standard-name-only' as const
          : 'not-needed' as const
        : undefined;
      const diagnosisName = currentDiagnosis?.name
        || recordContext.value.diagnosisText
        || '未读取到本次诊断，请基于本次病历和报告结果判断后续处理';
      const requestSpec = buildClinicalResultTreatmentRequestSpec(
        ((task.key as string) === 'medication' || (task.key as string) === 'unified') ? 'medication' : 'exam',
        {
          patientName: getPatientContextName(patient) || '未知患者',
          gender: getPatientContextGenderText(patient) || '未知',
          age: getPatientContextAgeText(patient) || '',
          diagnosisName,
          diagnosisCode: currentDiagnosis?.code || '',
          chiefComplaint: recordContext.value.chiefComplaint || '携本次病历及检验检查报告复诊',
          clinicalContext: recordContext.value.followUpEvidence,
          availableMedicineInventory: recordContext.value.isFollowUp
            ? medicineCandidates.length > 0
              ? formatAvailableMedicineInventoryCandidatesPrompt(medicineCandidates)
              : undefined
            : inventoryContext?.promptContext,
          medicineRecommendationPolicy,
          unavailableMedicineReferences: unmatchedMedicineReferences,
        },
        task.prompt,
        {
          sourceModule: 'treatment_plan_ai',
          operationModule: 'treatment_plan',
        },
        {
          scene: `treatment-plan-${task.key}`,
          title: task.traceTitle,
        }
      );

      const response = await chat(requestSpec.messages, undefined, undefined, undefined, requestSpec.config);
      if (runKey !== lastRunKey.value) return;

      const rawResults = parseLLMJson<RawClinicalResultTreatmentRecommendationInput[]>(response);
      const policyFilteredResults = medicineRecommendationPolicy === 'not-needed'
        ? rawResults.filter((item) => item?.type !== 'medicine')
        : rawResults;
      const alignedResults = ((task.key as string) === 'medication' || (task.key as string) === 'unified')
        ? alignMedicineRecommendationsToInventory(policyFilteredResults, medicineCandidates)
        : policyFilteredResults;

      for (const itemType of task.itemTypes) {
        let mapped = buildClinicalResultTreatmentRecommendationsFromRaw({
          rawRecommendations: alignedResults,
          type: itemType,
          match: assessTreatmentCatalogMatch,
          normalize: options.normalizeTreatment,
        });
        mapped = await applyRecommendationPreferenceRanking(
          mapped,
          buildTreatmentPreferenceCandidate,
          {
            consultationId: getPatientContextId(options.patient.value) || '',
            sourceModule: 'treatment_plan',
            scene: `treatment-plan-${task.key}`,
          },
        );
        replaceTreatmentsByType(itemType, mapped);
      }
    } catch (error) {
      console.error('[TreatmentPlan] Failed to fetch task recommendation', {
        kind: task.key,
        error,
      });
      task.uiKeys.forEach((key) => {
        const title = UI_SECTIONS.find((s) => s.key === key)?.title || '';
        errorByKind.value = {
          ...errorByKind.value,
          [key]: `${title}生成失败，已保留其它可用建议。`,
        };
      });
    } finally {
      task.uiKeys.forEach((key) => {
        loadingByKind.value = { ...loadingByKind.value, [key]: false };
      });
    }
  }

  async function refresh(): Promise<boolean> {
    if (!canRecommend.value) {
      return false;
    }

    const runKey = buildRunKey();
    lastRunKey.value = runKey;
    refreshing.value = true;
    options.treatments.value = [];
    options.diagnosis.value = buildDiagnosisFromText(recordContext.value.diagnosisText);
    initialized.value = true;

    await Promise.all(RECOMMENDATION_TASKS.map((task) => fetchTask(task, runKey)));
    refreshing.value = false;
    return runKey === lastRunKey.value;
  }

  function toggleSelection(item: TreatmentRecommendation): void {
    item.selected = !item.selected;
  }

  return {
    canRecommend,
    diagnosis: options.diagnosis,
    errorByKind,
    initialized,
    isLoading,
    missingContextTips,
    recordContext,
    refreshing,
    sections,
    selectedTreatments,
    treatments: options.treatments,
    refresh,
    toggleSelection,
  };
}

export type TreatmentPlanRecommendations = ReturnType<typeof useTreatmentPlanRecommendations>;
