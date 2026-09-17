import { ref, type Ref } from 'vue';

export interface ClinicalResultPrecautionsScopeOptions {
  precautions: Ref<string>;
  buildScopedPrecautions: (diagnosisNames: readonly string[]) => string;
  setSystemBaseline?: (value: string) => void;
  completeGeneratedPrecautions?: (value: string, diagnosisNames: readonly string[]) => string;
}

export interface ClinicalResultPrecautionsScopeSyncResult {
  updated: boolean;
  preservedManualEdit: boolean;
  value: string;
}

function normalizeDiagnosisNames(diagnosisNames: readonly string[]): string[] {
  return Array.from(new Set(
    diagnosisNames
      .map((item) => item.trim())
      .filter(Boolean),
  )).sort();
}

function buildScopeKey(diagnosisNames: readonly string[]): string {
  return normalizeDiagnosisNames(diagnosisNames).join('|');
}

export function useClinicalResultPrecautionsScope(
  options: ClinicalResultPrecautionsScopeOptions,
) {
  const sourceScopeKey = ref('');
  const sourcePrecautions = ref('');
  const lastSystemPrecautions = ref<string | null>(null);

  function applySystemValue(value: string): boolean {
    const updated = options.precautions.value !== value;
    options.precautions.value = value;
    lastSystemPrecautions.value = value;
    options.setSystemBaseline?.(value);
    return updated;
  }

  /** 记录一次新的 AI/规则结果，该作用域可包含尚未分区的全部候选诊断。 */
  function captureGeneratedPrecautions(
    diagnosisNames: readonly string[],
    value: string = options.precautions.value,
  ): void {
    sourceScopeKey.value = buildScopeKey(diagnosisNames);
    sourcePrecautions.value = options.completeGeneratedPrecautions?.(value, diagnosisNames) ?? value;
    applySystemValue(sourcePrecautions.value);
  }

  /**
   * 将系统文案收敛到医生已选正式诊断。
   * 当前值与最后一次系统值不同时，视为医生手工改写并原样保留。
   */
  function syncToSelectedDiagnoses(
    diagnosisNames: readonly string[],
  ): ClinicalResultPrecautionsScopeSyncResult {
    if (lastSystemPrecautions.value === null) {
      return {
        updated: false,
        preservedManualEdit: false,
        value: options.precautions.value,
      };
    }

    if (options.precautions.value !== lastSystemPrecautions.value) {
      return {
        updated: false,
        preservedManualEdit: true,
        value: options.precautions.value,
      };
    }

    const selectedNames = normalizeDiagnosisNames(diagnosisNames);
    const selectedScopeKey = buildScopeKey(selectedNames);
    const scopedValue = selectedScopeKey === sourceScopeKey.value
      ? sourcePrecautions.value
      : options.buildScopedPrecautions(selectedNames);
    const nextValue = options.completeGeneratedPrecautions?.(scopedValue, selectedNames) ?? scopedValue;
    const updated = applySystemValue(nextValue);

    return {
      updated,
      preservedManualEdit: false,
      value: nextValue,
    };
  }

  function resetPrecautionsScope(): void {
    sourceScopeKey.value = '';
    sourcePrecautions.value = '';
    lastSystemPrecautions.value = null;
  }

  return {
    captureGeneratedPrecautions,
    lastSystemPrecautions,
    resetPrecautionsScope,
    sourceScopeKey,
    syncToSelectedDiagnoses,
  };
}

export type ClinicalResultPrecautionsScope = ReturnType<typeof useClinicalResultPrecautionsScope>;
