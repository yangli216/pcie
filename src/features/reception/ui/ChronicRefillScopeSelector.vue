<template>
  <section class="rcs-root" aria-label="选择本次复诊慢病范围">
    <div class="rcs-head">
      <strong>本次复诊涉及</strong>
      <button type="button" aria-label="关闭慢病范围选择" @click="emit('close')">
        <Icon icon="lucide:x" size="14" />
      </button>
    </div>
    <p>只选择本次需要续方的慢病，未选病种不会进入病历和用药方案。</p>
    <div class="rcs-selection-list">
      <div class="rcs-condition-list">
        <button
          v-for="condition in conditionOptions"
          :key="condition.id"
          type="button"
          :class="['rcs-condition', { selected: selectedConditionIds.includes(condition.id) }]"
          role="checkbox"
          :aria-checked="selectedConditionIds.includes(condition.id)"
          @click="toggleCondition(condition.id)"
        >
          <Icon :icon="selectedConditionIds.includes(condition.id) ? 'lucide:check' : 'lucide:plus'" size="13" />
          <span>{{ condition.diagnosis }}</span>
        </button>
      </div>
    </div>
    <button
      class="rcs-confirm"
      type="button"
      :disabled="selectedConditionIds.length === 0"
      @click="submit"
    >
      生成病历与核查项
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import {
  getChronicRefillCandidateKey,
  getChronicRefillConditionOptions,
  type ChronicRefillCandidate,
  type ChronicRefillSelection,
} from '@features/reception-risk';

const props = defineProps<{
  candidate: ChronicRefillCandidate;
}>();

const emit = defineEmits<{
  (event: 'close'): void;
  (event: 'submit', selection: ChronicRefillSelection): void;
}>();

const selectedConditionIds = ref<string[]>([]);
const conditionOptions = computed(() => getChronicRefillConditionOptions(props.candidate));
const candidateKey = computed(() => getChronicRefillCandidateKey(props.candidate));

watch(candidateKey, () => {
  selectedConditionIds.value = conditionOptions.value.length === 1
    ? [conditionOptions.value[0].id]
    : [];
}, { immediate: true });

function toggleCondition(conditionId: string): void {
  selectedConditionIds.value = selectedConditionIds.value.includes(conditionId)
    ? selectedConditionIds.value.filter((id) => id !== conditionId)
    : [...selectedConditionIds.value, conditionId];
}

function submit(): void {
  if (selectedConditionIds.value.length === 0) return;
  emitSelection();
}

function emitSelection(): void {
  emit('submit', {
    conditionIds: [...selectedConditionIds.value],
  });
}
</script>

<style scoped>
.rcs-root {
  margin-top: 8px;
  padding: 9px;
  border: 1px solid #bfdbfe;
  border-radius: 9px;
  background: #f8fbff;
  -webkit-app-region: no-drag;
}

.rcs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #1e3a5f;
  font-size: 12px;
}

.rcs-head button {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #64748b;
  background: transparent;
  cursor: pointer;
}

.rcs-root p {
  margin: 3px 0 8px;
  color: #64748b;
  font-size: 10.5px;
  line-height: 1.4;
}

.rcs-selection-list {
  max-height: 82px;
  overflow-y: auto;
}

.rcs-condition-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rcs-condition {
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #475569;
  background: #fff;
  cursor: pointer;
  font-size: 11px;
}

.rcs-condition.selected {
  border-color: #60a5fa;
  color: #1d4ed8;
  background: #dbeafe;
}

.rcs-confirm {
  width: 100%;
  min-height: 30px;
  margin-top: 8px;
  border: 0;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #fff;
  background: #2563eb;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 600;
}

.rcs-confirm:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

</style>
