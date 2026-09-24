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
  buildCurrentInformationMedicationPrompt,
  parseCurrentInformationMedicationResult,
  buildInstitutionAuxiliaryCatalogContext,
  loadAvailableMedicineInventoryContext,
  mapAuxiliaryCatalogRecommendations,
  parseLLMJson,
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
  error?: unknown;
  medicationAssessment?: CurrentInformationMedicationAssessment;
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
      const inventory = await loadAvailableMedicineInventoryContext({ pharmacies: input.pharmacies });
      endInventory?.(inventory.items.length);
      await input.onMedicationPhase?.('assessing');
      const medicationPrompt = input.currentInformationMedication
        ? buildCurrentInformationMedicationPrompt(
          PROMPTS.consultation.treatmentRecommendation,
          input.currentInformationMedication.symptomaticOnly,
        )
        : PROMPTS.consultation.treatmentRecommendation;
      const spec = buildClinicalResultTreatmentRequestSpec('medication', {
        ...baseParams,
        availableMedicineInventory: inventory.promptContext,
      }, medicationPrompt, {
        consultationId: input.consultationId,
      }, input.currentInformationMedication ? {
        scene: 'current-information-medication',
        operationAction: 'assess_medication_with_current_information',
        title: input.currentInformationMedication.source === 'automatic'
          ? '普通语音空执行路由自动评估用药' : '医生主动基于现有信息评估用药',
      } : undefined);
      const endModel = input.timing?.span('medicine_model');
      const response = await chat(
        spec.messages,
        undefined,
        undefined,
        undefined,
        input.currentInformationMedication
          ? { ...spec.config, temperature: 0 }
          : spec.config,
      );
      endModel?.();
      const assessment = input.currentInformationMedication
        ? parseCurrentInformationMedicationResult(
          parseLLMJson<unknown>(response), input.currentInformationMedication.symptomaticOnly,
        ) : undefined;
      const raw = alignMedicineRecommendationsToInventory(
        (assessment?.recommendations ?? parseLLMJson<TreatmentRecommendation[]>(response)) as TreatmentRecommendation[],
        inventory.items,
      );
      return {
        key: 'medication',
        types: ['medicine'],
        medicationAssessment: assessment ? {
          summary: assessment.summary,
          disposition: assessment.disposition,
          deferred: assessment.deferred,
        } : undefined,
        items: buildClinicalResultTreatmentRecommendationsFromRaw({
          rawRecommendations: raw as unknown as RawClinicalResultTreatmentRecommendationInput[],
          type: 'medicine',
          match: assessTreatmentCatalogMatch,
          normalize: input.normalize,
        }),
      };
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
        let response: Awaited<ReturnType<typeof chatFast>>;
        try {
          response = await chatFast(spec.messages, undefined, undefined, undefined, spec.config);
        } finally {
          endModel?.();
        }
        return {
          key: 'auxiliary',
          types: availableAuxiliaryTypes,
          items: mapAuxiliaryCatalogRecommendations(
            parseLLMJson<AuxiliaryCatalogRecommendationResponse>(response),
            auxiliaryCatalog,
            availableAuxiliaryTypes,
            input.normalize,
          ),
        };
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
      const response = await chat(spec.messages, undefined, undefined, undefined, spec.config);
      return {
        key: 'procedure',
        types: ['procedure'],
        items: buildClinicalResultTreatmentRecommendationsFromRaw({
          rawRecommendations: parseLLMJson<RawClinicalResultTreatmentRecommendationInput[]>(response),
          type: 'procedure',
          match: assessTreatmentCatalogMatch,
          normalize: input.normalize,
        }),
      };
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
        error,
      };
    }
    const endApply = input.timing?.span(`treatment_apply_${runner.key}`);
    await input.onTaskResult?.(result);
    endApply?.(result.items.length);
    return result;
  }
}
