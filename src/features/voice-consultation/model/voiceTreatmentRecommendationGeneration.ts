import type { VoiceTimingSession } from './voiceTimingTracker';
import { chat, chatFast } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import { explicitlyRequestsRestrictedMedicalItem } from '@/services/medicalCatalogPolicy';
import type { PharmacyOption } from '@/services/his';
import { PROMPTS } from '@/prompts';
import type { TreatmentRecommendation } from '@/types/consultation';
import type { CurrentInformationMedicationRequestSource } from '@features/consultation-result';
import {
  alignMedicineRecommendationsToInventory,
  assessTreatmentCatalogMatch,
  buildClinicalResultTreatmentRecommendationsFromRaw,
  buildClinicalResultTreatmentRequestSpec,
  buildCurrentInformationMedicationIntentPrompt,
  buildCurrentInformationMedicationInventoryIntents,
  buildCurrentInformationMedicationPrompt,
  mergeCurrentInformationMedicationStageAssessments,
  parseCurrentInformationMedicationResult,
  buildInstitutionAuxiliaryCatalogContext,
  findUnmatchedMedicineInventoryIntentNames,
  formatAvailableMedicineInventoryCandidatesPrompt,
  loadAvailableMedicineInventoryContext,
  mapAuxiliaryCatalogRecommendations,
  parseLLMJson,
  selectAvailableMedicineInventoryCandidates,
  CURRENT_INFORMATION_MEDICATION_INVENTORY_LIMIT,
  type AuxiliaryCatalogRecommendationResponse,
  type ClinicalResultRecommendationType,
  type RawClinicalResultTreatmentRecommendationInput,
  type CurrentInformationMedicationAssessment,
} from '@features/clinical-result';

export interface VoiceTreatmentGenerationInput {
  timing?: VoiceTimingSession;
  patientName: string;
  gender: string;
  age: string;
  diagnosisName: string;
  diagnosisCode: string;
  chiefComplaint: string;
  clinicalContext: string;
  currentInformationMedication?: {
    symptomaticOnly: boolean;
    source: CurrentInformationMedicationRequestSource;
  };
  requestedTypes: ClinicalResultRecommendationType[];
  explicitTreatments: TreatmentRecommendation[];
  pharmacies: PharmacyOption[];
  consultationId: string;
  normalize: (item: Partial<TreatmentRecommendation>) => TreatmentRecommendation;
  onMedicationPhase?: (phase: 'preparing' | 'assessing') => void | Promise<void>;
  onTaskResult?: (result: VoiceTreatmentGenerationTaskResult) => void | Promise<void>;
}

export interface VoiceTreatmentGenerationTaskResult {
  key: 'medication' | 'auxiliary' | 'procedure';
  types: ClinicalResultRecommendationType[];
  items: TreatmentRecommendation[];
  status: VoiceTreatmentGenerationTaskStatus;
  error?: unknown;
  medicationAssessment?: CurrentInformationMedicationAssessment;
}

export type VoiceTreatmentGenerationTaskStatus =
  | 'ready_with_items'
  | 'ready_empty'
  | 'catalog_unavailable'
  | 'model_invalid'
  | 'failed';

class VoiceTreatmentModelInvalidError extends Error {
  readonly originalError: unknown;

  constructor(error: unknown) {
    super('模型返回格式不完整');
    this.name = 'VoiceTreatmentModelInvalidError';
    this.originalError = error;
  }
}

async function requestAndParseWithOneRetry<T>(
  request: () => Promise<string>,
  parse: (response: string) => T,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request();
    try {
      return parse(response);
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        console.warn('[VoiceTreatment] Invalid model response; retrying once');
      }
    }
  }
  throw new VoiceTreatmentModelInvalidError(lastError);
}

function readyResult(
  result: Omit<VoiceTreatmentGenerationTaskResult, 'status'>,
): VoiceTreatmentGenerationTaskResult {
  return {
    ...result,
    status: result.items.length > 0 ? 'ready_with_items' : 'ready_empty',
  };
}

function parseCurrentInformationMedicationModelResponse(
  response: string,
  symptomaticOnly: boolean,
) {
  const value = parseLLMJson<unknown>(response);
  const assessment = parseCurrentInformationMedicationResult(value, symptomaticOnly);
  const rawMedicines = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { medicines?: unknown }).medicines : undefined;
  if (assessment.disposition !== 'urgent_referral'
    && Array.isArray(rawMedicines) && rawMedicines.length > 0
    && assessment.recommendations.length === 0 && assessment.deferred.length === 0) {
    throw new Error('用药评估候选格式均无效');
  }
  return assessment;
}

function createBaseParams(input: VoiceTreatmentGenerationInput) {
  return {
    patientName: input.patientName,
    gender: input.gender,
    age: input.age,
    diagnosisName: input.diagnosisName,
    diagnosisCode: input.diagnosisCode,
    chiefComplaint: input.chiefComplaint,
    clinicalContext: input.clinicalContext,
  };
}

export async function generateVoiceTreatmentRecommendations(
  input: VoiceTreatmentGenerationInput,
): Promise<VoiceTreatmentGenerationTaskResult[]> {
  const requestedSet = new Set<ClinicalResultRecommendationType>(
    input.currentInformationMedication ? ['medicine'] : input.requestedTypes,
  );
  requestedSet.delete('procedure');
  const baseParams = createBaseParams(input);
  const runners: Array<{
    key: VoiceTreatmentGenerationTaskResult['key'];
    types: ClinicalResultRecommendationType[];
    run: () => Promise<VoiceTreatmentGenerationTaskResult>;
  }> = [];
  const immediateResults: VoiceTreatmentGenerationTaskResult[] = [];

  if (requestedSet.has('medicine')) {
    runners.push({ key: 'medication', types: ['medicine'], run: async () => {
      await input.onMedicationPhase?.('preparing');
      const endInventory = input.timing?.span('medicine_inventory');
      const inventoryStartedAt = Date.now();
      const inventoryPromise = loadAvailableMedicineInventoryContext({ pharmacies: input.pharmacies })
        .then((inventory) => {
          endInventory?.(inventory.items.length);
          if (input.currentInformationMedication) {
            console.info(`[CurrentInformationMedicationTiming] 库存准备 ${Date.now() - inventoryStartedAt} ms | 全量 ${inventory.items.length} 项`);
          }
          return inventory;
        }, (error) => {
          endInventory?.(0);
          throw error;
        });
      await input.onMedicationPhase?.('assessing');

      if (input.currentInformationMedication) {
        const intentPrompt = buildCurrentInformationMedicationIntentPrompt(
          input.currentInformationMedication.symptomaticOnly,
        );
        const intentSpec = buildClinicalResultTreatmentRequestSpec('medication', baseParams, intentPrompt, {
          consultationId: input.consultationId,
        }, {
          scene: 'current-information-medication-intent',
          operationAction: 'assess_medication_intent_with_current_information',
          title: input.currentInformationMedication.source === 'automatic'
            ? '普通语音空执行路由评估用药意图' : '医生主动评估用药意图',
        });
        const endIntentModel = input.timing?.span('medicine_intent_model');
        const intentModelStartedAt = Date.now();
        const intentAssessmentPromise = (async () => {
          try {
            return await requestAndParseWithOneRetry(
              () => chatFast(intentSpec.messages, undefined, undefined, undefined, {
                ...intentSpec.config,
                temperature: 0,
              }),
              (response) => parseCurrentInformationMedicationModelResponse(
                response,
                input.currentInformationMedication!.symptomaticOnly,
              ),
            );
          } finally {
            endIntentModel?.();
            console.info(`[CurrentInformationMedicationTiming] 用药意图模型 ${Date.now() - intentModelStartedAt} ms`);
          }
        })();
        const [intentAssessment, inventory] = await Promise.all([
          intentAssessmentPromise,
          inventoryPromise,
        ]);
        const intents = buildCurrentInformationMedicationInventoryIntents(intentAssessment);
        const candidates = selectAvailableMedicineInventoryCandidates(
          inventory.items,
          intents,
          CURRENT_INFORMATION_MEDICATION_INVENTORY_LIMIT,
        );
        const unavailableNames = findUnmatchedMedicineInventoryIntentNames(candidates, intents);
        console.info(
          `[CurrentInformationMedicationTiming] 候选收敛 全量 ${inventory.items.length} 项 | 意图 ${intents.length} 项 | 候选 ${candidates.length} 项 | 未命中 ${unavailableNames.length} 项`,
        );

        if (intentAssessment.disposition === 'urgent_referral'
          || intents.length === 0 || candidates.length === 0) {
          const assessment = mergeCurrentInformationMedicationStageAssessments(
            intentAssessment,
            null,
            unavailableNames,
          );
          return readyResult({
            key: 'medication',
            types: ['medicine'],
            medicationAssessment: assessment,
            items: [],
          });
        }

        const prescriptionPrompt = buildCurrentInformationMedicationPrompt(
          intentAssessment,
          input.currentInformationMedication.symptomaticOnly,
        );
        const prescriptionSpec = buildClinicalResultTreatmentRequestSpec('medication', {
          ...baseParams,
          availableMedicineInventory: formatAvailableMedicineInventoryCandidatesPrompt(candidates),
        }, prescriptionPrompt, {
          consultationId: input.consultationId,
        }, {
          scene: 'current-information-medication-prescription',
          operationAction: 'generate_medication_with_current_information',
          title: input.currentInformationMedication.source === 'automatic'
            ? '普通语音空执行路由生成候选处方' : '医生主动基于现有信息生成候选处方',
        });
        const endPrescriptionModel = input.timing?.span('medicine_prescription_model');
        const prescriptionModelStartedAt = Date.now();
        let prescriptionAssessment: ReturnType<typeof parseCurrentInformationMedicationResult>;
        try {
          prescriptionAssessment = await requestAndParseWithOneRetry(
            () => chat(prescriptionSpec.messages, undefined, undefined, undefined, {
              ...prescriptionSpec.config,
              temperature: 0,
            }),
            (response) => parseCurrentInformationMedicationModelResponse(
              response,
              input.currentInformationMedication!.symptomaticOnly,
            ),
          );
        } finally {
          endPrescriptionModel?.();
          console.info(`[CurrentInformationMedicationTiming] 候选处方模型 ${Date.now() - prescriptionModelStartedAt} ms`);
        }
        const assessment = mergeCurrentInformationMedicationStageAssessments(
          intentAssessment,
          prescriptionAssessment,
          unavailableNames,
        );
        const raw = alignMedicineRecommendationsToInventory(
          assessment.recommendations,
          candidates,
        );
        return readyResult({
          key: 'medication',
          types: ['medicine'],
          medicationAssessment: assessment,
          items: buildClinicalResultTreatmentRecommendationsFromRaw({
            rawRecommendations: raw as unknown as RawClinicalResultTreatmentRecommendationInput[],
            type: 'medicine',
            match: assessTreatmentCatalogMatch,
            normalize: input.normalize,
          }),
        });
      }

      const inventory = await inventoryPromise;
      const spec = buildClinicalResultTreatmentRequestSpec('medication', {
        ...baseParams,
        availableMedicineInventory: inventory.promptContext,
      }, PROMPTS.consultation.treatmentRecommendation, {
        consultationId: input.consultationId,
      });
      const endModel = input.timing?.span('medicine_model');
      let recommendations: RawClinicalResultTreatmentRecommendationInput[];
      try {
        recommendations = await requestAndParseWithOneRetry(
          () => chat(spec.messages, undefined, undefined, undefined, {
            ...spec.config,
            temperature: 0,
          }),
          (response) => {
            const value = parseLLMJson<unknown>(response);
            if (!Array.isArray(value)) throw new Error('药品推荐结果必须是数组');
            const valid = value.filter((item): item is RawClinicalResultTreatmentRecommendationInput => (
              Boolean(item) && typeof item === 'object' && !Array.isArray(item)
              && typeof (item as { name?: unknown }).name === 'string'
              && Boolean((item as { name: string }).name.trim())
            ));
            if (value.length > 0 && valid.length === 0) {
              throw new Error('药品推荐候选格式均无效');
            }
            return valid;
          },
        );
      } finally {
        endModel?.();
      }
      const raw = alignMedicineRecommendationsToInventory(
        recommendations,
        inventory.items,
      );
      return readyResult({
        key: 'medication',
        types: ['medicine'],
        items: buildClinicalResultTreatmentRecommendationsFromRaw({
          rawRecommendations: raw as unknown as RawClinicalResultTreatmentRecommendationInput[],
          type: 'medicine',
          match: assessTreatmentCatalogMatch,
          normalize: input.normalize,
        }),
      });
    } });
  }

  const generateAuxiliaryRecommendations = async () => {
    const auxiliaryRunners: typeof runners = [];
    const auxiliaryTypes = [...requestedSet].filter(
      (type): type is 'exam' | 'lab_test' => type === 'exam' || type === 'lab_test',
    );
    let auxiliaryItems = [] as Awaited<ReturnType<typeof medicalDataService.fetchAvailableExamLabItems>>;
    let auxiliaryCatalogError: unknown;
    if (auxiliaryTypes.length > 0) {
      const endCatalog = input.timing?.span('auxiliary_catalog');
      try {
        auxiliaryItems = await medicalDataService.fetchAvailableExamLabItems();
      } catch (error) {
        auxiliaryCatalogError = error;
        console.warn('[VoiceTreatment] Failed to query available exam/lab items from PHIS', error);
      } finally {
        endCatalog?.(auxiliaryItems.length);
      }
    }
    const endCatalogContext = input.timing?.span('auxiliary_catalog_context');
    const auxiliaryCatalog = buildInstitutionAuxiliaryCatalogContext(
      auxiliaryItems,
      auxiliaryTypes,
      {
        includeRestricted: explicitlyRequestsRestrictedMedicalItem([
          input.chiefComplaint,
          input.clinicalContext,
          ...input.explicitTreatments.map((item) => item.name),
        ].join(' ')),
      },
    );
    endCatalogContext?.(auxiliaryCatalog.entries.length);
    const availableAuxiliaryTypes = auxiliaryTypes.filter((type) => (
      type === 'exam' ? auxiliaryCatalog.counts.exam > 0 : auxiliaryCatalog.counts.labTest > 0
    ));
    auxiliaryTypes
      .filter((type) => !availableAuxiliaryTypes.includes(type))
      .forEach((type) => immediateResults.push({
        key: 'auxiliary',
        types: [type],
        items: [],
        status: 'catalog_unavailable',
        error: auxiliaryCatalogError || new Error(type === 'exam' ? '当前机构检查目录为空' : '当前机构检验目录为空'),
      }));

    if (availableAuxiliaryTypes.length > 0) {
      auxiliaryRunners.push({ key: 'auxiliary', types: availableAuxiliaryTypes, run: async () => {
        const endRequestBuild = input.timing?.span('auxiliary_request_build');
        const spec = buildClinicalResultTreatmentRequestSpec('exam', {
          ...baseParams,
          availableExamLabCatalog: auxiliaryCatalog.promptContext,
          requestedTypes: availableAuxiliaryTypes,
          explicitItemNames: input.explicitTreatments
            .filter((item) => availableAuxiliaryTypes.includes(item.type as 'exam' | 'lab_test'))
            .map((item) => item.name),
        }, PROMPTS.consultation.auxiliaryCatalogRecommendation, {
          consultationId: input.consultationId,
        }, {
          scene: 'voice-consultation-treatment-auxiliary-catalog',
          operationAction: 'generate_auxiliary_catalog_recommendation',
          title: '语音问诊生成院内目录检验检查推荐',
        });
        endRequestBuild?.();
        input.timing?.mark('auxiliary_model_started');
        const endModel = input.timing?.span('auxiliary_model');
        let mapped: TreatmentRecommendation[];
        try {
          mapped = await requestAndParseWithOneRetry(
            () => chatFast(spec.messages, undefined, undefined, undefined, {
              ...spec.config,
              temperature: 0,
            }),
            (response) => {
              const parsed = parseLLMJson<AuxiliaryCatalogRecommendationResponse>(response);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('检验检查推荐结果必须是对象');
              }
              const rawCount = [
                ...(Array.isArray(parsed.exams) ? parsed.exams : []),
                ...(Array.isArray(parsed.labTests) ? parsed.labTests : []),
              ].length;
              const items = mapAuxiliaryCatalogRecommendations(
                parsed,
                auxiliaryCatalog,
                availableAuxiliaryTypes,
                input.normalize,
              );
              if (rawCount > 0 && items.length === 0) {
                throw new Error('检验检查候选均未通过实时目录与字段校验');
              }
              return items;
            },
          );
        } finally {
          endModel?.();
        }
        return readyResult({
          key: 'auxiliary',
          types: availableAuxiliaryTypes,
          items: mapped,
        });
      } });
    }

    const auxiliaryResultsPromise = Promise.all(auxiliaryRunners.map(runTask));
    const immediateResultsApplication = (async () => {
      if (immediateResults.length === 0) return;
      const endImmediateApply = input.timing?.span('auxiliary_immediate_results');
      try {
        for (const result of immediateResults) {
          await input.onTaskResult?.(result);
        }
      } finally {
        endImmediateApply?.(immediateResults.length);
      }
    })();
    const [auxiliaryResults] = await Promise.all([
      auxiliaryResultsPromise,
      immediateResultsApplication,
    ]);
    return auxiliaryResults;
  };

  if (requestedSet.has('procedure')) {
    runners.push({ key: 'procedure', types: ['procedure'], run: async () => {
      const spec = buildClinicalResultTreatmentRequestSpec('procedure', baseParams, PROMPTS.consultation.procedureRecommendation, {
        consultationId: input.consultationId,
      });
      const recommendations = await requestAndParseWithOneRetry(
        () => chat(spec.messages, undefined, undefined, undefined, { ...spec.config, temperature: 0 }),
        (response) => {
          const parsed = parseLLMJson<RawClinicalResultTreatmentRecommendationInput[]>(response);
          if (!Array.isArray(parsed)) throw new Error('处置推荐结果必须是数组');
          return parsed;
        },
      );
      return readyResult({
        key: 'procedure',
        types: ['procedure'],
        items: buildClinicalResultTreatmentRecommendationsFromRaw({
          rawRecommendations: recommendations,
          type: 'procedure',
          match: assessTreatmentCatalogMatch,
          normalize: input.normalize,
        }),
      });
    } });
  }

  // Include directory preparation in each branch so auxiliary latency cannot delay medicine.
  const [asyncResults, auxiliaryResults] = await Promise.all([
    Promise.all(runners.map(runTask)),
    generateAuxiliaryRecommendations(),
  ]);
  return [...immediateResults, ...asyncResults, ...auxiliaryResults];

  async function runTask(runner: (typeof runners)[number]): Promise<VoiceTreatmentGenerationTaskResult> {
    let result: VoiceTreatmentGenerationTaskResult;
    try {
      result = await runner.run();
    } catch (error) {
      result = {
        key: runner.key,
        types: runner.types,
        items: [],
        status: error instanceof VoiceTreatmentModelInvalidError ? 'model_invalid' : 'failed',
        error,
      };
    }
    const endApply = input.timing?.span(`treatment_apply_${runner.key}`);
    await input.onTaskResult?.(result);
    endApply?.(result.items.length);
    return result;
  }
}
