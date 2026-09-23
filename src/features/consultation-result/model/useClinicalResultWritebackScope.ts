import { computed, ref } from 'vue';
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
  recordFields: Record<RecordConfirmedWritebackField, boolean>;
  diagnosis: boolean;
  medicine: boolean;
  clinicalOrders: boolean;
}

export interface WritebackScopeRecordFieldOption {
  key: RecordConfirmedWritebackField;
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
}

export interface ClinicalResultWritebackScopeOptions {
  getRecord: () => WritebackScopeRecordValues;
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

function emptyRecordSelection(): Record<RecordConfirmedWritebackField, boolean> {
  return RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<Record<RecordConfirmedWritebackField, boolean>>((result, field) => {
    result[field] = false;
    return result;
  }, {} as Record<RecordConfirmedWritebackField, boolean>);
}

export function useClinicalResultWritebackScope(options: ClinicalResultWritebackScopeOptions) {
  const selectorOpen = ref(false);
  const recordExpanded = ref(true);
  const selectedRecordMap = ref(emptyRecordSelection());
  const includeDiagnosisPreference = ref(false);
  const includeMedicinePreference = ref(false);
  const includeClinicalOrdersPreference = ref(false);
  const customized = ref(false);
  const newlyAvailableRecordFields = ref<RecordConfirmedWritebackField[]>([]);
  const baselineAvailability = ref<WritebackScopeAvailability | null>(null);

  function getSelectedTreatmentItems(): TreatmentRecommendation[] {
    return options.getSelectedTreatments().filter((item) => item.selected !== false);
  }

  function getAvailability(): WritebackScopeAvailability {
    const record = options.getRecord();
    const selectedTreatments = getSelectedTreatmentItems();
    return {
      recordFields: RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<Record<RecordConfirmedWritebackField, boolean>>((result, field) => {
        result[field] = isMeaningful(record[field]);
        return result;
      }, {} as Record<RecordConfirmedWritebackField, boolean>),
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
    RECORD_CONFIRMED_WRITEBACK_FIELDS.map((field) => ({
      key: field,
      label: WRITEBACK_RECORD_FIELD_LABELS[field],
      available: availability.value.recordFields[field],
      selected: availability.value.recordFields[field] && selectedRecordMap.value[field],
      isNew: newlyAvailableRecordFields.value.includes(field),
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
      recordFields: recordFieldOptions.value.filter((item) => item.selected).map((item) => item.key),
      includeDiagnosis: includeDiagnosis.value,
      orderTypes: Array.from(orderTypes),
    };
  });

  function markCustomized(): void {
    customized.value = true;
  }

  function reset(): void {
    const current = getAvailability();
    selectedRecordMap.value = RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<Record<RecordConfirmedWritebackField, boolean>>((result, field) => {
      result[field] = current.recordFields[field];
      return result;
    }, emptyRecordSelection());
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
    const previous = baselineAvailability.value;
    const current = getAvailability();
    if (!previous) {
      reset();
      return;
    }

    const nextSelected = { ...selectedRecordMap.value };
    const newFields: RecordConfirmedWritebackField[] = [];
    RECORD_CONFIRMED_WRITEBACK_FIELDS.forEach((field) => {
      if (!current.recordFields[field]) return;
      if (!previous.recordFields[field]) {
        nextSelected[field] = !customized.value;
        if (customized.value) newFields.push(field);
      }
    });
    selectedRecordMap.value = nextSelected;
    newlyAvailableRecordFields.value = newFields;

    if (!previous.diagnosis && current.diagnosis) includeDiagnosisPreference.value = !customized.value;
    if (!previous.medicine && current.medicine) includeMedicinePreference.value = !customized.value;
    if (!previous.clinicalOrders && current.clinicalOrders) includeClinicalOrdersPreference.value = !customized.value;
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

  function toggleRecordField(field: RecordConfirmedWritebackField): void {
    if (!availability.value.recordFields[field]) return;
    selectedRecordMap.value = {
      ...selectedRecordMap.value,
      [field]: !selectedRecordMap.value[field],
    };
    newlyAvailableRecordFields.value = newlyAvailableRecordFields.value.filter((item) => item !== field);
    markCustomized();
  }

  function toggleRecordGroup(): void {
    const shouldSelect = !recordGroupChecked.value;
    const next = { ...selectedRecordMap.value };
    RECORD_CONFIRMED_WRITEBACK_FIELDS.forEach((field) => {
      if (availability.value.recordFields[field]) next[field] = shouldSelect;
    });
    selectedRecordMap.value = next;
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
    const next = { ...selectedRecordMap.value };
    RECORD_CONFIRMED_WRITEBACK_FIELDS.forEach((field) => {
      if (availability.value.recordFields[field]) next[field] = shouldSelect;
    });
    selectedRecordMap.value = next;
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
    return {
      recordFields: RECORD_CONFIRMED_WRITEBACK_FIELDS.filter((field) => selectedRecordMap.value[field]),
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
    selectedRecordMap.value = RECORD_CONFIRMED_WRITEBACK_FIELDS.reduce<Record<RecordConfirmedWritebackField, boolean>>((result, field) => {
      result[field] = recordFields.includes(field);
      return result;
    }, emptyRecordSelection());
    includeDiagnosisPreference.value = snapshot.includeDiagnosis === true;
    includeMedicinePreference.value = snapshot.includeMedicine === true;
    includeClinicalOrdersPreference.value = snapshot.includeClinicalOrders === true;
    customized.value = snapshot.customized === true;
    newlyAvailableRecordFields.value = [];
    baselineAvailability.value = getAvailability();
  }

  reset();

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
