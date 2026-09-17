<script setup lang="ts">
import type { CurrentInformationMedicationAssessment } from '../../clinical-result/currentInformationMedication';

defineProps<{
  disabled: boolean;
  pending: boolean;
  reason: string;
  assessment: CurrentInformationMedicationAssessment | null;
  error: string;
}>();
defineEmits<{ request: [] }>();
</script>

<template>
  <div class="current-information-medication">
    <div class="medication-action">
      <p>{{ assessment ? '本次评估基于已有信息，检查建议仍保留。' : reason }}</p>
      <button type="button" :disabled="disabled" @click="$emit('request')">
        {{ pending ? '正在评估用药…' : '基于现有信息推荐用药' }}
      </button>
    </div>
    <div role="status" aria-live="polite">
      <p v-if="error" class="medication-error">{{ error }}</p>
      <template v-else-if="assessment">
        <p :class="{ 'medication-urgent': assessment.disposition === 'urgent_referral' }">{{ assessment.summary }}</p>
        <p v-if="assessment.disposition !== 'urgent_referral'" class="medication-hint">新增药品请核对后勾选；原有医嘱及选择已保留。</p>
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
button { flex-shrink: 0; padding: 5px 10px; border: 1px solid var(--voice-border, #cbd5e1); border-radius: 5px; background: var(--voice-surface, #fff); color: var(--voice-accent, #2563eb); font: inherit; cursor: pointer; }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible, summary:focus-visible { outline: 2px solid var(--voice-accent, #2563eb); outline-offset: 2px; }
[role='status']:not(:empty) { margin-top: 8px; }
.medication-error, .medication-urgent { color: var(--voice-warning, #b45309); }
.medication-hint { color: var(--voice-text-muted, #64748b); }
summary { cursor: pointer; }
ul { padding-left: 18px; margin: 4px 0 0; }
</style>
