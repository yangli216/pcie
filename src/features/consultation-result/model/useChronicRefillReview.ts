import { computed, ref } from 'vue';
import {
  normalizeChronicRefillHistoryOfPresentIllness,
  normalizeChronicRefillReviewRecordText,
} from '@features/clinical-result/lib/chronicRefillReviewRecordText';
import type { TreatmentRecommendation } from '@/types/consultation';
import type {
  ChronicRefillReviewOption,
  ChronicRefillReviewPlan,
} from '@/types/consultation';

export function updateChronicRefillReviewRecordText(
  current: string,
  previousText: string,
  nextText: string,
): string {
  let result = current.trim();
  const previous = previousText.trim();
  const next = nextText.trim();
  if (previous) {
    result = result.replace(previous, '')
      .replace(/[；;]{2,}/gu, '；')
      .replace(/[。]{2,}/gu, '。')
      .replace(/^[，。；;、\s]+|[，；;、\s]+$/gu, '')
      .trim();
  }
  if (!next) return result;
  if (result.includes(next)) return result;
  if (!result) return next;
  const separator = /[。；;！？!?]$/u.test(result) ? '' : '；';
  return `${result}${separator}${next}`;
}

export interface ChronicRefillReviewOptions {
  getHistoryOfPresentIllness: () => string;
  setHistoryOfPresentIllness: (value: string) => void;
  isHistoryOfPresentIllnessModified?: () => boolean;
  getTreatments: () => TreatmentRecommendation[];
  notify?: (message: string, type?: string) => void;
}

export function useChronicRefillReview(options: ChronicRefillReviewOptions) {
  const plan = ref<ChronicRefillReviewPlan | null>(null);
  const selections = ref<Record<string, string>>({});
  const appliedRecordTexts = ref<Record<string, string>>({});
  const expanded = ref(true);
  const treatmentReviewTriggered = ref(false);

  const reviewedCount = computed(() => Object.keys(selections.value).length);

  function reset(value?: ChronicRefillReviewPlan | null): void {
    plan.value = value || null;
    selections.value = {};
    appliedRecordTexts.value = {};
    expanded.value = Boolean(value?.items.length);
    treatmentReviewTriggered.value = false;
  }

  function select(itemId: string, option: ChronicRefillReviewOption): void {
    const item = plan.value?.items.find((candidate) => candidate.id === itemId);
    const selectedOption = item?.options.find((candidate) => candidate.value === option.value);
    if (!item || !selectedOption) return;

    const medicationNames = options.getTreatments()
      .filter((treatment) => treatment.type === 'medicine')
      .map((treatment) => treatment.name);
    const nextRecordText = normalizeChronicRefillReviewRecordText(selectedOption.recordText, medicationNames);

    const currentHistory = options.getHistoryOfPresentIllness();
    // 仅清理自动生成/旧快照中的处方尾巴；医生已编辑正文保持原样。
    let nextHistory = options.isHistoryOfPresentIllnessModified?.()
      ? currentHistory
      : normalizeChronicRefillHistoryOfPresentIllness(currentHistory);
    const knownTexts = new Set([
      appliedRecordTexts.value[itemId] || '',
      ...item.options.map((candidate) => candidate.recordText),
    ]);
    knownTexts.forEach((recordText) => {
      if (!recordText || recordText === nextRecordText) return;
      nextHistory = updateChronicRefillReviewRecordText(nextHistory, recordText, '');
    });
    options.setHistoryOfPresentIllness(updateChronicRefillReviewRecordText(
      nextHistory,
      '',
      nextRecordText,
    ));
    selections.value = { ...selections.value, [itemId]: selectedOption.value };
    appliedRecordTexts.value = { ...appliedRecordTexts.value, [itemId]: nextRecordText };

    if (selectedOption.treatmentReviewRequired) {
      const selectedMedicines = options.getTreatments().filter((treatment) => (
        treatment.type === 'medicine' && treatment.selected
      ));
      selectedMedicines.forEach((treatment) => {
        treatment.selected = false;
      });
      treatmentReviewTriggered.value = true;
      if (selectedMedicines.length > 0) {
        options.notify?.('该情况可能影响续方，已取消药品自动选中，请核查方案后重新选择', 'warning');
      }
    }
  }

  return {
    expanded,
    plan,
    reviewedCount,
    selections,
    treatmentReviewTriggered,
    reset,
    select,
    setExpanded: (value: boolean) => { expanded.value = value; },
  };
}

export type ChronicRefillReview = ReturnType<typeof useChronicRefillReview>;
