import { ref, type Ref } from 'vue';

interface FemaleHistorySnapshot {
  menstrualHistory?: string;
  maritalReproductiveHistory?: string;
}

/** 女性专属字段的缓存与流式基线保护，避免后到分区覆盖医生编辑。 */
export function useFemaleHistoryFields(isFemale: Readonly<Ref<boolean>>) {
  const menstrualHistory = ref('');
  const maritalReproductiveHistory = ref('');
  const fields = { menstrualHistory, maritalReproductiveHistory };
  let baseline: FemaleHistorySnapshot = {};

  function restore(snapshot: FemaleHistorySnapshot): void {
    for (const key of Object.keys(fields) as Array<keyof FemaleHistorySnapshot>) {
      fields[key].value = isFemale.value ? snapshot[key] || '' : '';
    }
  }

  function captureBaseline(): void {
    if (!isFemale.value) restore({});
    baseline = { menstrualHistory: menstrualHistory.value, maritalReproductiveHistory: maritalReproductiveHistory.value };
  }

  function applyProgressive(snapshot: FemaleHistorySnapshot): void {
    if (!isFemale.value) return;
    for (const key of Object.keys(fields) as Array<keyof FemaleHistorySnapshot>) {
      if (fields[key].value.trim() === (baseline[key] || '').trim()) {
        fields[key].value = snapshot[key] || '';
        baseline[key] = fields[key].value;
      }
    }
  }

  return { ...fields, restore, captureBaseline, applyProgressive, resetBaseline: () => { baseline = {}; } };
}
