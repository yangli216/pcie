import { computed, ref, watch } from 'vue';
import type { TreatmentRecommendation } from '@/types/consultation';
import {
  RECORD_CONFIRMED_WRITEBACK_FIELDS,
  type RecordConfirmedWritebackField,
  type RecordConfirmedWritebackOrderType,
  type RecordConfirmedWritebackScope,
} from '../../clinical-result/recordConfirmedPayload';

export const WRITEBACK_RECORD_FIELD_LABELS: Record<RecordConfirmedWritebackField, string> = {
  chiefComplaint: '主诉',
  historyOfPresentIllness: '现病史',
  pastMedicalHistory: '既往史',
  personalHistory: '个人史',
  menstrualHistory: '月经史',
  maritalReproductiveHistory: '婚育史',
  familyHistory: '家族史',
  physicalExam: '体格检查',
  precautions: '注意事项',
};

export interface WritebackScopeRecordValues {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  personalHistory: string;
  menstrualHistory: string;
  maritalReproductiveHistory: string;
  familyHistory: string;
  physicalExam: string;
  precautions: string;
}

interface WritebackScopeAvailability {
  recordFields: Record<string, boolean>;
  diagnosis: boolean;
  medicine: boolean;
  clinicalOrders: boolean;
}

export interface WritebackScopeRecordFieldOption {
  key: string;
  label: string;
  available: boolean;
  selected: boolean;
  isNew: boolean;
}

export interface ClinicalResultWritebackScopeSnapshot {
  recordFields: RecordConfirmedWritebackField[];
  includeDiagnosis: boolean;
  includeMedicine: boolean;
  includeClinicalOrders: boolean;
  customized: boolean;
  templateChapterIds?: string[];
  templateScopeKey?: string;
  /** Only present if the doctor changes chapter preferences before an old canonical selection finishes migrating. */
  pendingChapterOverrides?: Record<string, boolean>;
}

export interface ClinicalResultWritebackScopeOptions {
  getRecord: () => WritebackScopeRecordValues;
  getTemplateChapters?: () => readonly { key: string; label: string; available: boolean; recordFields: readonly RecordConfirmedWritebackField[] }[] | null;
  getTemplateScopeKey?: () => string | null;
  isTemplateScopeReady?: () => boolean;
  getSelectedDiagnosisCount: () => number;
  getSelectedTreatments: () => readonly TreatmentRecommendation[];
  notify?: (message: string, type?: string) => void;
}

function isRecordField(value: unknown): value is RecordConfirmedWritebackField {
  return typeof value === 'string'
    && (RECORD_CONFIRMED_WRITEBACK_FIELDS as readonly string[]).includes(value);
}

function isMeaningful(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toOrderType(type: TreatmentRecommendation['type']): RecordConfirmedWritebackOrderType | null {
  if (type === 'medicine' || type === 'exam' || type === 'lab_test' || type === 'procedure') return type;
  if (type === 'acupuncture') return 'procedure';
  return null;
}

export function useClinicalResultWritebackScope(options: ClinicalResultWritebackScopeOptions) {
  const selectorOpen = ref(false);
  const recordExpanded = ref(true);
  const selectedRecordMap = ref<Set<string>>(new Set());
  const legacyTemplateSelection = ref<RecordConfirmedWritebackField[] | null>(null);
  const pendingChapterOverrides = ref(new Map<string, boolean>());
  const includeDiagnosisPreference = ref(false);
  const includeMedicinePreference = ref(false);
  const includeClinicalOrdersPreference = ref(false);
  const customized = ref(false);
  const newlyAvailableRecordFields = ref<string[]>([]);
  const baselineAvailability = ref<WritebackScopeAvailability | null>(null);

  function getSelectedTreatmentItems(): TreatmentRecommendation[] {
    return options.getSelectedTreatments().filter((item) => item.selected !== false);
  }

  const recordRows = computed(() => options.getTemplateChapters?.() ?? RECORD_CONFIRMED_WRITEBACK_FIELDS.map(field => ({
    key: field, label: WRITEBACK_RECORD_FIELD_LABELS[field], available: isMeaningful(options.getRecord()[field]), recordFields: [field],
  })));

  function getAvailability(): WritebackScopeAvailability {
    const selectedTreatments = getSelectedTreatmentItems();
    return {
      recordFields: Object.fromEntries(recordRows.value.map(row => [row.key, row.available])),
      diagnosis: options.getSelectedDiagnosisCount() > 0,
      medicine: selectedTreatments.some((item) => item.type === 'medicine'),
      clinicalOrders: selectedTreatments.some((item) => item.type !== 'medicine' && Boolean(toOrderType(item.type))),
    };
  }

  const availability = computed(getAvailability);
  const selectedDiagnosisCount = computed(() => options.getSelectedDiagnosisCount());
  const selectedMedicineCount = computed(() => getSelectedTreatmentItems().filter((item) => item.type === 'medicine').length);
  const selectedClinicalOrderCount = computed(() => getSelectedTreatmentItems().filter(
    (item) => item.type !== 'medicine' && Boolean(toOrderType(item.type)),
  ).length);

  const recordFieldOptions = computed<WritebackScopeRecordFieldOption[]>(() => (
    recordRows.value.map(({key, label, available}) => ({
      key, label, available, selected: available && selectedRecordMap.value.has(key),
      isNew: newlyAvailableRecordFields.value.includes(key),
    }))
  ));
  const availableRecordFieldCount = computed(() => recordFieldOptions.value.filter((item) => item.available).length);
  const selectedRecordFieldCount = computed(() => recordFieldOptions.value.filter((item) => item.selected).length);
  const recordGroupChecked = computed(() => (
    availableRecordFieldCount.value > 0
    && selectedRecordFieldCount.value === availableRecordFieldCount.value
  ));
  const recordGroupIndeterminate = computed(() => (
    selectedRecordFieldCount.value > 0
    && selectedRecordFieldCount.value < availableRecordFieldCount.value
  ));
  const includeDiagnosis = computed(() => availability.value.diagnosis && includeDiagnosisPreference.value);
  const includeMedicine = computed(() => availability.value.medicine && includeMedicinePreference.value);
  const includeClinicalOrders = computed(() => (
    availability.value.clinicalOrders && includeClinicalOrdersPreference.value
  ));
  const availableOptionCount = computed(() => (
    availableRecordFieldCount.value
    + Number(availability.value.diagnosis)
    + Number(availability.value.medicine)
    + Number(availability.value.clinicalOrders)
  ));
  const selectedOptionCount = computed(() => (
    selectedRecordFieldCount.value
    + Number(includeDiagnosis.value)
    + Number(includeMedicine.value)
    + Number(includeClinicalOrders.value)
  ));
  const hasAnySelection = computed(() => selectedOptionCount.value > 0);
  const allAvailableSelected = computed(() => (
    availableOptionCount.value > 0
    && selectedOptionCount.value === availableOptionCount.value
  ));
  const partialSelection = computed(() => (
    hasAnySelection.value && selectedOptionCount.value < availableOptionCount.value
  ));
  const recordSelectionSummary = computed(() => (
    selectedRecordFieldCount.value === availableRecordFieldCount.value
      ? `${selectedRecordFieldCount.value} 项`
      : `${selectedRecordFieldCount.value}/${availableRecordFieldCount.value} 项`
  ));

  const writebackScope = computed<RecordConfirmedWritebackScope>(() => {
    const selectedTreatments = getSelectedTreatmentItems();
    const orderTypes = new Set<RecordConfirmedWritebackOrderType>();
    if (includeMedicine.value) orderTypes.add('medicine');
    if (includeClinicalOrders.value) {
      selectedTreatments.forEach((item) => {
        const type = toOrderType(item.type);
        if (type && type !== 'medicine') orderTypes.add(type);
      });
    }
    return {
      recordFields: [...new Set(recordRows.value.filter(row => row.available && selectedRecordMap.value.has(row.key)).flatMap(row => row.recordFields))],
      includeDiagnosis: includeDiagnosis.value,
      orderTypes: Array.from(orderTypes),
    };
  });

  function markCustomized(): void {
    customized.value = true;
  }

  function syncLegacyTemplateSelection(): void {
    const fields = legacyTemplateSelection.value;
    const chapters = options.getTemplateChapters?.();
    if (!fields || !chapters) return;
    const selected = new Set(chapters.filter(row => (!customized.value && row.available)
      || row.recordFields.some(field => fields.includes(field))).map(row => row.key));
    for (const [key, include] of pendingChapterOverrides.value) {
      if (include) selected.add(key);
      else selected.delete(key);
    }
    selectedRecordMap.value = selected;
    if (chapters.length && (options.isTemplateScopeReady?.() ?? true)) {
      legacyTemplateSelection.value = null;
      pendingChapterOverrides.value.clear();
    }
  }

  function setRecordPreference(key: string, selected: boolean): void {
    if (selected) selectedRecordMap.value.add(key);
    else selectedRecordMap.value.delete(key);
    if (legacyTemplateSelection.value) pendingChapterOverrides.value.set(key, selected);
  }

  function reset(): void {
    legacyTemplateSelection.value = null;
    pendingChapterOverrides.value.clear();
    const current = getAvailability();
    selectedRecordMap.value = new Set(recordRows.value.filter(row => row.available).map(row => row.key));
    includeDiagnosisPreference.value = current.diagnosis;
    includeMedicinePreference.value = current.medicine;
    includeClinicalOrdersPreference.value = current.clinicalOrders;
    customized.value = false;
    newlyAvailableRecordFields.value = [];
    baselineAvailability.value = current;
    selectorOpen.value = false;
    recordExpanded.value = true;
  }

  function refreshAvailableContent(): void {
    syncLegacyTemplateSelection();
    const previous = baselineAvailability.value;
    const current = getAvailability();
    if (!previous) {
      reset();
      return;
    }

    const nextSelected = new Set(selectedRecordMap.value);
    const newFields: string[] = [];
    Object.keys(current.recordFields).forEach((field) => {
      if (!current.recordFields[field]) return;
      if (!previous.recordFields[field]) {
        if (!customized.value) nextSelected.add(field);
        else if (!nextSelected.has(field)) newFields.push(field);
      }
    });
    selectedRecordMap.value = nextSelected;
    newlyAvailableRecordFields.value = newFields;

    if (!customized.value) {
      if (!previous.diagnosis && current.diagnosis) includeDiagnosisPreference.value = true;
      if (!previous.medicine && current.medicine) includeMedicinePreference.value = true;
      if (!previous.clinicalOrders && current.clinicalOrders) includeClinicalOrdersPreference.value = true;
    }
    baselineAvailability.value = current;
  }

  function toggleSelector(): void {
    if (!selectorOpen.value) refreshAvailableContent();
    selectorOpen.value = !selectorOpen.value;
  }

  function closeSelector(): void {
    selectorOpen.value = false;
  }

  function setRecordExpanded(value: boolean): void {
    recordExpanded.value = value;
  }

  function toggleRecordField(field: string): void {
    if (!availability.value.recordFields[field]) return;
    setRecordPreference(field, !selectedRecordMap.value.has(field));
    newlyAvailableRecordFields.value = newlyAvailableRecordFields.value.filter((item) => item !== field);
    markCustomized();
  }

  function setAvailableRecords(selected: boolean): void {
    for (const { key, available } of recordRows.value) {
      if (!available) continue;
      setRecordPreference(key, selected);
    }
  }

  function toggleRecordGroup(): void {
    const shouldSelect = !recordGroupChecked.value;
    setAvailableRecords(shouldSelect);
    newlyAvailableRecordFields.value = [];
    markCustomized();
  }

  function toggleDiagnosis(): void {
    if (!availability.value.diagnosis) return;
    includeDiagnosisPreference.value = !includeDiagnosisPreference.value;
    markCustomized();
  }

  function toggleMedicine(): void {
    if (!availability.value.medicine) return;
    includeMedicinePreference.value = !includeMedicinePreference.value;
    markCustomized();
  }

  function toggleClinicalOrders(): void {
    if (!availability.value.clinicalOrders) return;
    includeClinicalOrdersPreference.value = !includeClinicalOrdersPreference.value;
    markCustomized();
  }

  function toggleAll(): void {
    const shouldSelect = !allAvailableSelected.value;
    setAvailableRecords(shouldSelect);
    includeDiagnosisPreference.value = shouldSelect && availability.value.diagnosis;
    includeMedicinePreference.value = shouldSelect && availability.value.medicine;
    includeClinicalOrdersPreference.value = shouldSelect && availability.value.clinicalOrders;
    newlyAvailableRecordFields.value = [];
    markCustomized();
  }

  function filterTreatments(items: readonly TreatmentRecommendation[]): TreatmentRecommendation[] {
    return items.filter((item) => {
      if (!item.selected) return false;
      if (item.type === 'medicine') return includeMedicine.value;
      return includeClinicalOrders.value && Boolean(toOrderType(item.type));
    });
  }

  function ensureSelection(): boolean {
    refreshAvailableContent();
    if (hasAnySelection.value) return true;
    selectorOpen.value = true;
    options.notify?.('请至少选择一项需要回写的内容', 'warning');
    return false;
  }

  function serialize(): ClinicalResultWritebackScopeSnapshot {
    const chapters = options.getTemplateChapters?.();
    const owner = options.getTemplateScopeKey?.();
    const pending = legacyTemplateSelection.value;
    const canonical = chapters
      ? [...new Set(chapters.filter(row => selectedRecordMap.value.has(row.key)).flatMap(row => row.recordFields))]
      : RECORD_CONFIRMED_WRITEBACK_FIELDS.filter(key => selectedRecordMap.value.has(key));
    return {
      recordFields: pending ?? canonical,
      ...(chapters && owner ? { templateScopeKey: owner } : {}),
      ...(chapters && !pending ? { templateChapterIds: [...selectedRecordMap.value] } : {}),
      ...(pending && pendingChapterOverrides.value.size ? { pendingChapterOverrides: Object.fromEntries(pendingChapterOverrides.value) } : {}),
      includeDiagnosis: includeDiagnosisPreference.value,
      includeMedicine: includeMedicinePreference.value,
      includeClinicalOrders: includeClinicalOrdersPreference.value,
      customized: customized.value,
    };
  }

  function restore(value: unknown): void {
    if (!value || typeof value !== 'object') {
      reset();
      return;
    }
    const snapshot = value as Partial<ClinicalResultWritebackScopeSnapshot>;
    const recordFields = Array.isArray(snapshot.recordFields)
      ? snapshot.recordFields.filter(isRecordField)
      : [];
    const chapters = options.getTemplateChapters?.();
    const ids = snapshot.templateChapterIds;
    if ((snapshot.templateScopeKey !== undefined && snapshot.templateScopeKey !== options.getTemplateScopeKey?.())
      || (!chapters && Array.isArray(ids))) {
      reset();
      return;
    }
    pendingChapterOverrides.value.clear();
    legacyTemplateSelection.value = chapters && !Array.isArray(ids) ? recordFields : null;
    if (legacyTemplateSelection.value && snapshot.pendingChapterOverrides && typeof snapshot.pendingChapterOverrides === 'object') {
      for (const [key, include] of Object.entries(snapshot.pendingChapterOverrides)) {
        if (typeof include === 'boolean') pendingChapterOverrides.value.set(key, include);
      }
    }
    selectedRecordMap.value = new Set(chapters
      ? Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
      : recordFields);
    includeDiagnosisPreference.value = snapshot.includeDiagnosis === true;
    includeMedicinePreference.value = snapshot.includeMedicine === true;
    includeClinicalOrdersPreference.value = snapshot.includeClinicalOrders === true;
    customized.value = snapshot.customized === true;
    syncLegacyTemplateSelection();
    newlyAvailableRecordFields.value = [];
    baselineAvailability.value = getAvailability();
  }

  reset();
  if (options.getTemplateScopeKey) watch(options.getTemplateScopeKey, reset, { flush: 'sync' });
  if (options.isTemplateScopeReady) watch(options.isTemplateScopeReady, syncLegacyTemplateSelection, { flush: 'sync' });

  return {
    selectorOpen,
    recordExpanded,
    recordFieldOptions,
    recordGroupChecked,
    recordGroupIndeterminate,
    recordSelectionSummary,
    availableRecordFieldCount,
    selectedRecordFieldCount,
    selectedDiagnosisCount,
    selectedMedicineCount,
    selectedClinicalOrderCount,
    diagnosisAvailable: computed(() => availability.value.diagnosis),
    medicineAvailable: computed(() => availability.value.medicine),
    clinicalOrdersAvailable: computed(() => availability.value.clinicalOrders),
    includeDiagnosis,
    includeMedicine,
    includeClinicalOrders,
    availableOptionCount,
    selectedOptionCount,
    hasAnySelection,
    allAvailableSelected,
    partialSelection,
    customized,
    writebackScope,
    toggleSelector,
    closeSelector,
    setRecordExpanded,
    toggleRecordField,
    toggleRecordGroup,
    toggleDiagnosis,
    toggleMedicine,
    toggleClinicalOrders,
    toggleAll,
    filterTreatments,
    ensureSelection,
    refreshAvailableContent,
    reset,
    serialize,
    restore,
  };
}

export type ClinicalResultWritebackScope = ReturnType<typeof useClinicalResultWritebackScope>;
