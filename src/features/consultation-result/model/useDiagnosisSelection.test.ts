// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Diagnosis } from '@/types/consultation';
import { useDiagnosisSelection } from './useDiagnosisSelection';

function diagnosis(name: string, id: string): Diagnosis {
  return {
    id,
    code: '',
    name,
    rate: '高置信',
    rationale: '',
  };
}

describe('useDiagnosisSelection initial selection', () => {
  it('selects every doctor-scoped formal diagnosis for chronic refill', () => {
    const diagnoses = ref([
      diagnosis('原发性高血压', 'diag_hypertension'),
      diagnosis('2型糖尿病', 'standard-diabetes'),
      diagnosis('骨质疏松', 'standard-osteoporosis'),
      diagnosis('冠心病', 'standard-coronary-disease'),
    ]);
    const selection = useDiagnosisSelection({ diagnoses });

    selection.replaceInitialDiagnosisSelection(diagnoses.value, true);

    expect(selection.selectedDiagnoses.value.map((item) => item.name)).toEqual([
      '原发性高血压',
      '2型糖尿病',
      '骨质疏松',
      '冠心病',
    ]);
    expect(selection.selectedDiagnosis.value?.name).toBe('2型糖尿病');
  });

  it('keeps the single-primary default for other result channels', () => {
    const diagnoses = ref([
      diagnosis('原发性高血压', 'standard-hypertension'),
      diagnosis('2型糖尿病', 'standard-diabetes'),
    ]);
    const selection = useDiagnosisSelection({ diagnoses });

    selection.replaceInitialDiagnosisSelection(diagnoses.value, false);

    expect(selection.selectedDiagnoses.value.map((item) => item.name)).toEqual([
      '原发性高血压',
    ]);
    expect(selection.selectedDiagnosis.value?.name).toBe('原发性高血压');
  });

  it('leaves a compatible diagnosis unselected until one click confirms the standard item', () => {
    const compatible: Diagnosis = {
      code: 'A09.901',
      name: '胃肠炎',
      originalName: '急性胃肠炎',
      rate: '高置信',
      rationale: '',
      catalogMatchStatus: 'compatible',
      suggestedMatchItem: {
        id: 'diag-a09',
        code: 'A09.901',
        name: '胃肠炎',
      },
    };
    const diagnoses = ref([compatible]);
    const selection = useDiagnosisSelection({ diagnoses });

    selection.replaceInitialDiagnosisSelection(diagnoses.value, false);
    expect(selection.selectedDiagnoses.value).toEqual([]);
    expect(selection.selectedDiagnosis.value).toBeNull();

    selection.toggleDiagnosis(compatible);
    expect(compatible).toMatchObject({
      id: 'diag-a09',
      name: '胃肠炎',
      catalogMatchStatus: 'confirmed',
    });
    expect(selection.selectedDiagnoses.value).toEqual([compatible]);
    expect(selection.selectedDiagnosis.value).toMatchObject({
      id: 'diag-a09',
      catalogMatchStatus: 'confirmed',
    });
  });

  it('does not select a conflicting catalog assessment by clicking the card', () => {
    const conflicting: Diagnosis = {
      id: 'stale-ai-id',
      code: 'K52.905',
      name: '急性胃肠炎',
      rate: '高置信',
      rationale: '',
      catalogMatchStatus: 'conflict',
    };
    const diagnoses = ref([conflicting]);
    const selection = useDiagnosisSelection({ diagnoses });

    selection.replaceDiagnosisSelection(diagnoses.value, conflicting);
    selection.toggleDiagnosis(conflicting);
    selection.setPrimaryDiagnosis(conflicting);

    expect(selection.selectedDiagnoses.value).toEqual([]);
    expect(selection.selectedDiagnosis.value).toBeNull();
  });
});
