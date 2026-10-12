import { computed, shallowRef, type ComputedRef } from 'vue';
import type { PublicHealthMealOption } from '../types';

export function usePublicHealthMealSelection(options: ComputedRef<PublicHealthMealOption[] | undefined>, editable: ComputedRef<boolean>) {
  const selectedId = shallowRef<string | null>(null);
  const drafts = shallowRef<Record<string, string>>({});
  const currentValue = computed(() => selectedId.value === null ? undefined : drafts.value[selectedId.value]);

  function reset() { selectedId.value = null; drafts.value = {}; }
  function initialize() {
    drafts.value = Object.fromEntries((options.value ?? []).map(option => [option.id, option.content]));
    selectedId.value = options.value?.[0]?.id ?? null;
  }
  function select(id: string): boolean {
    if (!editable.value || id === selectedId.value || !options.value?.some(option => option.id === id)) return false;
    selectedId.value = id;
    return true;
  }
  function edit(value: string): boolean {
    if (!editable.value || selectedId.value === null || !options.value?.some(option => option.id === selectedId.value)) return false;
    drafts.value = { ...drafts.value, [selectedId.value]: value };
    return true;
  }
  return { selectedId: computed(() => selectedId.value), drafts: computed(() => drafts.value), currentValue,
    reset, initialize, select, edit };
}
