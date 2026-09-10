import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type { DiagnosisCatalogAssessment } from '@services/diagnosisCatalogMatch';
import { normalizeRawTreatmentRecommendationFields } from './clinicalResultTreatmentFields';

export interface ClinicalResultDiagnosisCatalogMatch {
  id: string;
  code: string;
  name: string;
}

export interface MapClinicalResultAiDiagnosesInput {
  rawDiagnoses: Diagnosis[];
  assessDiagnosis: (
    queryName: string,
    context?: { icdCode?: string },
  ) => DiagnosisCatalogAssessment<ClinicalResultDiagnosisCatalogMatch>;
  clearUnmatchedId?: boolean;
}

type ClinicalResultTreatmentCatalogMatch = Pick<
  TreatmentRecommendation,
  'matchedItem' | 'suggestedMatchItem' | 'matchStatus'
>;

export interface RawClinicalResultTreatmentRecommendationInput {
  type?: string;
  name?: string;
  aliases?: unknown;
  spec?: string;
  [key: string]: unknown;
}

export interface MapClinicalResultAiTreatmentsInput {
  rawTreatments: TreatmentRecommendation[];
  assessCatalogMatch: (
    type: TreatmentRecommendation['type'],
    name: string,
    aliases?: string[],
    spec?: string,
  ) => ClinicalResultTreatmentCatalogMatch;
  normalize: (rec: Partial<TreatmentRecommendation>) => TreatmentRecommendation;
}

export interface ClinicalResultAiTreatmentParseFailure {
  error: unknown;
  responsePreview: string;
}

export interface MergeClinicalResultAiTreatmentResponsesInput {
  responses: Array<PromiseSettledResult<string>>;
  parse: (text: string) => TreatmentRecommendation[];
  assessCatalogMatch: MapClinicalResultAiTreatmentsInput['assessCatalogMatch'];
  normalize: MapClinicalResultAiTreatmentsInput['normalize'];
  onParseFailure?: (failure: ClinicalResultAiTreatmentParseFailure) => void;
}

export interface BuildClinicalResultTreatmentRecommendationsInput {
  rawRecommendations: RawClinicalResultTreatmentRecommendationInput[];
  type: TreatmentRecommendation['type'];
  match: MapClinicalResultAiTreatmentsInput['assessCatalogMatch'];
  normalize: MapClinicalResultAiTreatmentsInput['normalize'];
}

function discardAiMedicinePackageTotal(
  rec: Partial<TreatmentRecommendation>,
  type: TreatmentRecommendation['type'],
): Partial<TreatmentRecommendation> {
  if (type !== 'medicine') return rec;
  return {
    ...rec,
    totalQty: '',
    totalUnit: '',
    totalManualEdited: false,
  };
}

export function mapClinicalResultAiDiagnoses(input: MapClinicalResultAiDiagnosesInput): Diagnosis[] {
  return input.rawDiagnoses.map((diag) => {
    const matchContext = diag.code ? { icdCode: diag.code } : undefined;
    const assessment = input.assessDiagnosis(diag.name || diag.code, matchContext);
    const matched = assessment.status === 'exact' ? assessment.matchedItem : null;

    if (matched) {
      return {
        ...diag,
        code: matched.code,
        name: matched.name,
        id: matched.id,
        originalName: diag.name,
        catalogMatchStatus: 'exact',
        suggestedMatchItem: null,
        catalogMatchReason: assessment.reason,
        catalogAlternatives: assessment.alternatives,
      };
    }

    if (assessment.status === 'compatible' && assessment.suggestedMatchItem) {
      return {
        ...diag,
        id: undefined,
        code: assessment.suggestedMatchItem.code,
        name: assessment.suggestedMatchItem.name,
        originalName: diag.originalName || diag.name,
        catalogMatchStatus: 'compatible',
        suggestedMatchItem: assessment.suggestedMatchItem,
        catalogMatchReason: assessment.reason,
        catalogAlternatives: assessment.alternatives,
      };
    }

    if (input.clearUnmatchedId) {
      return {
        ...diag,
        id: undefined,
        catalogMatchStatus: assessment.status,
        suggestedMatchItem: null,
        catalogMatchReason: assessment.reason,
        catalogAlternatives: assessment.alternatives,
      };
    }

    return {
      ...diag,
      catalogMatchStatus: assessment.status,
      suggestedMatchItem: null,
      catalogMatchReason: assessment.reason,
      catalogAlternatives: assessment.alternatives,
    };
  });
}

export function buildClinicalResultTreatmentRecommendationsFromRaw(
  input: BuildClinicalResultTreatmentRecommendationsInput,
): TreatmentRecommendation[] {
  return input.rawRecommendations
    .filter((rec) => !rec.type || rec.type === input.type)
    .map((rec) => {
      const normalizedRaw = normalizeRawTreatmentRecommendationFields(rec, input.type);
      const aliases = Array.isArray(normalizedRaw.aliases) ? (normalizedRaw.aliases as string[]) : undefined;
      const assessment = input.match(input.type, normalizedRaw.name || '', aliases, normalizedRaw.spec);
      const safeRaw = discardAiMedicinePackageTotal(
        normalizedRaw as Partial<TreatmentRecommendation>,
        input.type,
      );
      return input.normalize({
        ...safeRaw,
        aliases,
        type: input.type,
        matchedItem: assessment.matchedItem,
        suggestedMatchItem: assessment.suggestedMatchItem,
        matchStatus: assessment.matchStatus,
        selected: false,
      });
    });
}

export function mapClinicalResultAiTreatments(input: MapClinicalResultAiTreatmentsInput): TreatmentRecommendation[] {
  return input.rawTreatments.map((rec) => {
    const normalizedRaw = normalizeRawTreatmentRecommendationFields(rec, rec.type);
    const type = normalizedRaw.type || rec.type;
    const aliases = Array.isArray(normalizedRaw.aliases) ? normalizedRaw.aliases : undefined;
    const assessment = input.assessCatalogMatch(
      type,
      normalizedRaw.name,
      aliases,
      type === 'medicine' ? normalizedRaw.spec : undefined,
    );
    const safeRaw = discardAiMedicinePackageTotal(normalizedRaw, type);
    return input.normalize({
      ...safeRaw,
      aliases,
      originalName: normalizedRaw.originalName || normalizedRaw.name,
      matchedItem: assessment.matchedItem,
      suggestedMatchItem: assessment.suggestedMatchItem,
      matchStatus: assessment.matchStatus,
      manualMatched: false,
      selected: assessment.matchStatus === 'exact',
    });
  });
}

export function mergeClinicalResultAiTreatmentResponses(
  input: MergeClinicalResultAiTreatmentResponsesInput,
): TreatmentRecommendation[] {
  return input.responses.flatMap((response) => {
    if (response.status !== 'fulfilled') {
      return [];
    }

    try {
      return mapClinicalResultAiTreatments({
        rawTreatments: input.parse(response.value),
        assessCatalogMatch: input.assessCatalogMatch,
        normalize: input.normalize,
      });
    } catch (error) {
      input.onParseFailure?.({
        error,
        responsePreview: response.value.slice(0, 400),
      });
      return [];
    }
  });
}
