import { computed, ref } from 'vue';
import { canAppendPhysicalExamCandidate } from '../../clinical-result/lib/physicalExamGuidance';
import type { Diagnosis } from '@/types/consultation';
import {
  extractExplicitClinicalRecordFacts,
  completePhysicalExamSuggestions,
  stripUnverifiedPhysicalExam,
  normalizeClinicalRecordFactSuggestions,
  normalizeGeneratedClinicalRecordNarrative,
  type ClinicalRecordExplicitFact,
  type ClinicalRecordFactField,
  type ClinicalRecordFactRecord,
  type ClinicalRecordFactSuggestion,
} from '@features/clinical-result';

export interface ClinicalRecordFactConfirmationOptions {
  getRecord: () => ClinicalRecordFactRecord;
  isPhysicalExamModified?: () => boolean;
  getDiagnoses: () => readonly Diagnosis[];
  getNegativeSymptoms?: () => readonly string[];
  getPositiveSymptoms?: () => readonly string[];
  request: (input: {
    record: ClinicalRecordFactRecord;
    diagnoses: readonly Diagnosis[];
    explicitFacts: ClinicalRecordExplicitFact[];
  }) => Promise<string>;
  formatError: (error: unknown) => string;
  notify?: (message: string, type?: string) => void;
  mergeSuggestionIntoRecord: (suggestion: ClinicalRecordFactSuggestion) => boolean;
  onRecordChanged?: (suggestions: readonly ClinicalRecordFactSuggestion[]) => void;
}

export function useClinicalRecordFactConfirmation(options: ClinicalRecordFactConfirmationOptions) {
  const suggestions = ref<ClinicalRecordFactSuggestion[]>([]);
  const loading = ref(false);
  const error = ref('');
  let requestSequence = 0;

  const extractedFacts = computed(() => extractExplicitClinicalRecordFacts(
    { ...options.getRecord(), physicalExam: stripUnverifiedPhysicalExam(options.getRecord().physicalExam, suggestions.value) },
    options.getNegativeSymptoms?.() || [],
    options.getPositiveSymptoms?.() || [],
  ));
  const explicitFacts = computed<ClinicalRecordExplicitFact[]>(() => extractedFacts.value);

  function mergePendingSuggestions(items: readonly ClinicalRecordFactSuggestion[], preserveExam = false): void {
    const merged = items.filter((item) => (
      item.status === 'pending' && (!preserveExam || item.field !== 'physicalExam') && options.mergeSuggestionIntoRecord(item)
    ));
    if (merged.length > 0) options.onRecordChanged?.(merged);
  }

  async function generateSuggestions(): Promise<void> {
    const currentRequest = ++requestSequence;
    const initialPhysicalExam = options.getRecord().physicalExam;
    const initialDiagnoses = JSON.stringify(options.getDiagnoses().map((item) => [item.code, item.name]));
    loading.value = true;
    error.value = '';
    try {
      const response = await options.request({
        record: { ...options.getRecord(), physicalExam: stripUnverifiedPhysicalExam(options.getRecord().physicalExam, suggestions.value) },
        diagnoses: options.getDiagnoses(),
        explicitFacts: explicitFacts.value,
      });
      if (currentRequest !== requestSequence
        || initialDiagnoses !== JSON.stringify(options.getDiagnoses().map((item) => [item.code, item.name]))) return;
      const record = options.getRecord();
      const evidenceRecord = { ...record, physicalExam: stripUnverifiedPhysicalExam(record.physicalExam, suggestions.value) };
      const normalized = normalizeClinicalRecordFactSuggestions(response, explicitFacts.value);
      const proposed = completePhysicalExamSuggestions(evidenceRecord, options.getDiagnoses().map((item) => item.name), normalized);
      const preserveExam = options.isPhysicalExamModified?.() || record.physicalExam !== initialPhysicalExam;
      const nextSuggestions = preserveDismissals([
        ...proposed.filter((item) => !preserveExam || item.field !== 'physicalExam'),
        ...suggestions.value.filter((item) => preserveExam && item.field === 'physicalExam'),
      ]);
      mergePendingSuggestions(nextSuggestions, preserveExam);
      suggestions.value = nextSuggestions;
    } catch (cause) {
      if (currentRequest !== requestSequence) return;
      error.value = options.formatError(cause);
      options.notify?.(error.value, 'error');
    } finally {
      if (currentRequest === requestSequence) {
        loading.value = false;
      }
    }
  }

  function getFieldHighlights(field: ClinicalRecordFactField): ClinicalRecordExplicitFact[] {
    return explicitFacts.value.filter((item) => item.field === field);
  }

  function getFieldSuggestions(field: ClinicalRecordFactField): ClinicalRecordFactSuggestion[] {
    return suggestions.value.filter((item) => item.field === field && item.status === 'pending');
  }

  function dismissSuggestion(id: string): void {
    suggestions.value = suggestions.value.map((item) => (
      item.id === id ? { ...item, status: 'dismissed' } : item
    ));
  }

  function preserveDismissals(items: ClinicalRecordFactSuggestion[]): ClinicalRecordFactSuggestion[] {
    const dismissed = suggestions.value.filter((item) => item.status === 'dismissed');
    const incoming = items.map((item) => dismissed.some((old) => old.id === item.id
      || (old.field === item.field && old.negativeRecordText === item.negativeRecordText))
      ? { ...item, status: 'dismissed' as const } : item);
    return [...incoming, ...dismissed.filter((old) => !incoming.some((item) => item.id === old.id))];
  }

  function restoreSuggestions(value: unknown): void {
    if (!Array.isArray(value)) return;
    const validFields = new Set<ClinicalRecordFactField>([
      'historyOfPresentIllness',
      'pastMedicalHistory',
      'personalHistory',
      'familyHistory',
      'physicalExam',
    ]);
    const validated = value
      .filter((item): item is ClinicalRecordFactSuggestion => Boolean(
        item
        && typeof item === 'object'
        && typeof item.id === 'string'
        && validFields.has(item.field)
        && typeof item.question === 'string'
        && typeof item.negativeRecordText === 'string'
        && (item.priority === 'critical' || item.priority === 'general')
        && (item.status === 'pending' || item.status === 'dismissed')
      ))
      .map((item): ClinicalRecordFactSuggestion | null => {
        const negativeRecordText = normalizeGeneratedClinicalRecordNarrative(
          item.negativeRecordText,
          item.field,
        ).text;
        return negativeRecordText ? { ...item, negativeRecordText } : null;
      })
      .filter((item): item is ClinicalRecordFactSuggestion => Boolean(item));
    const record = options.getRecord();
    const evidence = stripUnverifiedPhysicalExam(record.physicalExam, [...suggestions.value, ...validated]);
    const preserveExam = options.isPhysicalExamModified?.();
    const restored = preserveDismissals([
      ...validated.filter((item) => item.field !== 'physicalExam'
        || (!preserveExam && (item.status === 'dismissed'
          || canAppendPhysicalExamCandidate(item.negativeRecordText, `${evidence}；${record.historyOfPresentIllness}`)))),
      ...[...suggestions.value, ...validated].filter((item, index, all) => preserveExam && item.field === 'physicalExam'
        && (item.status === 'dismissed' || record.physicalExam.includes(item.negativeRecordText))
        && all.findIndex((other) => other.id === item.id) === index),
    ]);
    mergePendingSuggestions(restored, preserveExam);
    suggestions.value = restored;
  }

  function reset(): void {
    requestSequence += 1;
    suggestions.value = [];
    loading.value = false;
    error.value = '';
  }

  return {
    error,
    explicitFacts,
    loading,
    suggestions,
    generateSuggestions,
    getFieldHighlights,
    getFieldSuggestions,
    dismissSuggestion,
    reset,
    restoreSuggestions,
  };
}

export type ClinicalRecordFactConfirmation = ReturnType<typeof useClinicalRecordFactConfirmation>;
