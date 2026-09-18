<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type { CurrentInformationMedicationAssessment } from '../../clinical-result/currentInformationMedication';
import type { CurrentInformationMedicationPhase } from '../model/useCurrentInformationMedication';

const props = defineProps<{
  disabled: boolean;
  pending: boolean;
  phase: CurrentInformationMedicationPhase;
  reason: string;
  assessment: CurrentInformationMedicationAssessment | null;
  error: string;
}>();
defineEmits<{ request: [] }>();

const phaseText = computed(() => {
  if (props.phase === 'preparing') return '正在准备院内药品范围…';
  if (props.phase === 'assessing') return '正在结合当前病情评估用药…';
  if (props.phase === 'finalizing') return '评估完成，正在核对可开立药品与库存…';
  return '';
});

const buttonText = computed(() => {
  if (props.phase === 'preparing') return '准备中…';
  if (props.phase === 'assessing') return '评估中…';
  if (props.phase === 'finalizing') return '核对中…';
  return '基于现有信息推荐用药';
});
</script>

<template>
  <div class="current-information-medication">
    <div class="medication-action">
      <p>{{ assessment ? '本次评估基于已有信息，检查建议仍保留。' : reason }}</p>
      <button type="button" :disabled="disabled" @click="$emit('request')">
        <Icon :icon="pending ? 'lucide:loader-2' : 'lucide:pill'" :class="{ spin: pending }" size="14" aria-hidden="true" />
        <span>{{ buttonText }}</span>
      </button>
    </div>
    <div role="status" aria-live="polite">
      <p v-if="pending" class="medication-phase">{{ phaseText }}</p>
      <p v-if="error" class="medication-error">{{ error }}</p>
      <template v-if="assessment">
        <p :class="{ 'medication-urgent': assessment.disposition === 'urgent_referral' }">{{ assessment.summary }}</p>
        <p v-if="assessment.disposition !== 'urgent_referral' && phase !== 'finalizing'" class="medication-hint">新增药品请核对后勾选；原有医嘱及选择已保留。</p>
        <details v-if="assessment.deferred.length">
          <summary>暂缓用药 {{ assessment.deferred.length }} 项</summary>
          <ul>
            <li v-for="(item, index) in assessment.deferred" :key="`${item.name}-${index}`">
              <strong>{{ item.name }}</strong>：{{ item.reason }}
            </li>
          </ul>
        </details>
      </template>
    </div>
  </div>
</template>

<style scoped>
.current-information-medication { padding: 10px 12px; margin-bottom: 10px; border-radius: 6px; background: var(--voice-surface-soft, #f8fafc); color: var(--voice-text, #334155); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.medication-action { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
p { margin: 0; }
.medication-action p { flex: 1 1 180px; color: var(--voice-text-muted, #64748b); }
button { flex-shrink: 0; min-width: 132px; min-height: 32px; padding: 5px 10px; border: 1px solid var(--voice-border, #cbd5e1); border-radius: 5px; background: var(--voice-surface, #fff); color: var(--voice-accent, #2563eb); font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--voice-accent, #2563eb); outline-offset: 2px; }
[role='status']:not(:empty) { margin-top: 8px; }
.medication-phase { color: var(--voice-accent, #2563eb); }
.medication-error, .medication-urgent { color: var(--voice-warning, #b45309); }
.medication-hint { color: var(--voice-text-muted, #64748b); }
summary { cursor: pointer; }
ul { padding-left: 18px; margin: 4px 0 0; }
.spin { animation: medication-spin 1s linear infinite; }
@keyframes medication-spin { to { transform: rotate(360deg); } }
</style>
