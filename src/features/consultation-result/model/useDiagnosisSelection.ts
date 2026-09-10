import { computed, ref, type Ref } from 'vue';
import type { Diagnosis } from '@/types/consultation';
import { getClinicalDiagnosisIdentity } from '@features/clinical-result/recommendationHelpers';
import {
  getDiagnosisKey,
  getStandardDiagnosisId,
  getStandardDiagnosisKey,
} from '@features/clinical-result/recordConfirmedPayload';

interface Options {
  diagnoses: Readonly<Ref<readonly Diagnosis[]>>;
}

export function useDiagnosisSelection(options: Options) {
  const selectedDiagnosis = ref<Diagnosis | null>(null);
  const selectedDiagnosisKeys = ref<Set<string>>(new Set());

  const selectedDiagnoses = computed(() =>
    options.diagnoses.value.filter((diag) => selectedDiagnosisKeys.value.has(getDiagnosisKey(diag))),
  );

  function getDiagnosisIdentity(diag: Diagnosis | null): string {
    return getClinicalDiagnosisIdentity(diag);
  }

  function isDiagnosisSelected(diag: Diagnosis): boolean {
    return selectedDiagnosisKeys.value.has(getDiagnosisKey(diag));
  }

  function isPrimaryDiagnosis(diag: Diagnosis): boolean {
    return getDiagnosisKey(selectedDiagnosis.value) === getDiagnosisKey(diag);
  }

  function isDiagnosisSelectable(diag: Diagnosis): boolean {
    return !(
      diag.catalogMatchStatus === 'compatible'
      || diag.catalogMatchStatus === 'ambiguous'
      || diag.catalogMatchStatus === 'conflict'
      || diag.catalogMatchStatus === 'unmatched'
    );
  }

  function setDiagnosisSelection(keys: Iterable<string>): void {
    selectedDiagnosisKeys.value = new Set(Array.from(keys).filter(Boolean));
  }

  function syncPrimaryDiagnosis(preferred?: Diagnosis | null): void {
    const preferredKey = getDiagnosisKey(preferred);
    if (preferred && selectedDiagnosisKeys.value.has(preferredKey)) {
      selectedDiagnosis.value = preferred;
      return;
    }

    const currentKey = getDiagnosisKey(selectedDiagnosis.value);
    if (currentKey && selectedDiagnosisKeys.value.has(currentKey)) {
      const matchedCurrent = options.diagnoses.value.find((diag) => getDiagnosisKey(diag) === currentKey);
      selectedDiagnosis.value = matchedCurrent || null;
      if (selectedDiagnosis.value) {
        return;
      }
    }

    selectedDiagnosis.value =
      options.diagnoses.value.find((diag) => selectedDiagnosisKeys.value.has(getDiagnosisKey(diag))) || null;
  }

  function replaceDiagnosisSelection(diags: Diagnosis[], primary?: Diagnosis | null): void {
    const selectableDiagnoses = diags.filter(isDiagnosisSelectable);
    const selectablePrimary = primary && isDiagnosisSelectable(primary) ? primary : null;
    setDiagnosisSelection(selectableDiagnoses.map((diag) => getDiagnosisKey(diag)));
    syncPrimaryDiagnosis(selectablePrimary || selectableDiagnoses[0] || null);
  }

  function replaceInitialDiagnosisSelection(
    diags: Diagnosis[],
    selectAllFormalDiagnoses = false,
  ): void {
    const selectableDiagnoses = diags.filter(isDiagnosisSelectable);
    const primary = selectableDiagnoses.find((diag) => getStandardDiagnosisId(diag))
      || selectableDiagnoses[0]
      || null;
    replaceDiagnosisSelection(
      selectAllFormalDiagnoses ? selectableDiagnoses : (primary ? [primary] : []),
      primary,
    );
  }

  function resetDiagnosisSelection(): void {
    selectedDiagnosisKeys.value = new Set();
    selectedDiagnosis.value = null;
  }

  function toggleDiagnosis(diag: Diagnosis): void {
    if (isPrimaryDiagnosis(diag)) {
      return;
    }

    if (!isDiagnosisSelected(diag)) {
      if (diag.catalogMatchStatus === 'compatible') {
        const suggested = diag.suggestedMatchItem;
        if (!suggested?.id) {
          return;
        }
        diag.id = suggested.id;
        diag.code = suggested.code;
        diag.name = suggested.name;
        diag.catalogMatchStatus = 'confirmed';
        diag.catalogMatchReason = '医生已确认标准库近似项';
      }
      if (!isDiagnosisSelectable(diag)) {
        return;
      }
      const nextKeys = new Set(selectedDiagnosisKeys.value);
      nextKeys.add(getDiagnosisKey(diag));
      setDiagnosisSelection(nextKeys);
      selectedDiagnosis.value = diag;
      return;
    }

    if (!isPrimaryDiagnosis(diag)) {
      selectedDiagnosis.value = diag;
    }
  }

  function setPrimaryDiagnosis(diag: Diagnosis): void {
    if (!isDiagnosisSelectable(diag)) {
      return;
    }
    if (!isDiagnosisSelected(diag)) {
      const nextKeys = new Set(selectedDiagnosisKeys.value);
      nextKeys.add(getDiagnosisKey(diag));
      setDiagnosisSelection(nextKeys);
    }
    selectedDiagnosis.value = diag;
  }

  function removeDiagnosis(diag: Diagnosis): void {
    const key = getDiagnosisKey(diag);
    if (!key || !selectedDiagnosisKeys.value.has(key)) {
      return;
    }

    const nextKeys = new Set(selectedDiagnosisKeys.value);
    nextKeys.delete(key);
    if (nextKeys.size === 0) {
      return;
    }

    setDiagnosisSelection(nextKeys);
    if (isPrimaryDiagnosis(diag)) {
      syncPrimaryDiagnosis();
    }
  }

  function replaceDiagnosisInSelection(originalDiag: Diagnosis, updatedDiag: Diagnosis): void {
    const originalKey = getDiagnosisKey(originalDiag);
    const updatedKey = getDiagnosisKey(updatedDiag);
    if (selectedDiagnosisKeys.value.has(originalKey)) {
      const nextKeys = new Set(selectedDiagnosisKeys.value);
      nextKeys.delete(originalKey);
      nextKeys.add(updatedKey);
      setDiagnosisSelection(nextKeys);
    }

    if (selectedDiagnosis.value && getStandardDiagnosisKey(selectedDiagnosis.value) === getStandardDiagnosisKey(originalDiag)) {
      selectedDiagnosis.value = updatedDiag;
    } else {
      syncPrimaryDiagnosis();
    }
  }

  return {
    selectedDiagnosis,
    selectedDiagnosisKeys,
    selectedDiagnoses,
    getDiagnosisIdentity,
    isDiagnosisSelected,
    isPrimaryDiagnosis,
    setDiagnosisSelection,
    syncPrimaryDiagnosis,
    replaceDiagnosisSelection,
    replaceInitialDiagnosisSelection,
    resetDiagnosisSelection,
    toggleDiagnosis,
    setPrimaryDiagnosis,
    removeDiagnosis,
    replaceDiagnosisInSelection,
  };
}

export type DiagnosisSelection = ReturnType<typeof useDiagnosisSelection>;
