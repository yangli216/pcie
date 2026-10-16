<template>
  <article
    class="vcn-treatment-item"
    :class="[layoutVariant, { selected, locked, matching, rejected, 'is-card-selectable': !rejected }]"
    @click="handleCardToggle"
  >
    <template v-if="layoutVariant === 'worklist'">
      <div class="worklist-row">
        <button
          class="treatment-select-button"
          :class="{ selected }"
          type="button"
          :aria-label="selected ? `将${rec.name}移出方案` : `将${rec.name}纳入方案`"
          :aria-pressed="selected"
          @click.stop="emit('toggle')"
        >
          <span class="worklist-select-dot">
            <svg v-if="selected" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </button>

        <div class="worklist-content">
          <div class="worklist-top-row">
            <div class="worklist-primary-row">
              <div class="worklist-name-wrap">
                <slot name="title-prefix" />
                <FactCheckHighlight :issue="issue">
                  <span class="card-title">{{ rec.name }}</span>
                </FactCheckHighlight>
                <span v-if="spec" class="meta-token worklist-spec-text">{{ spec }}</span>
                <span v-if="manufacturer" class="meta-token medicine-manufacturer" :title="`生产厂家：${manufacturer}`">
                  {{ manufacturer }}
                </span>
                <span
                  v-if="necessityLabel"
                  class="auxiliary-necessity-label"
                  :class="{ supplementary: rec.necessity === 'supplementary' }"
                >{{ necessityLabel }}</span>
                <span
                  v-if="reasonDisplay"
                  class="reason-tooltip-trigger"
                  :class="{ open: reasonOpen }"
                  @click.stop
                >
                  <button class="reason-icon-btn" type="button" aria-label="查看推荐依据" title="查看推荐依据" @click.stop="emit('toggle-reason', $event)">
                    <Icon icon="lucide:circle-help" size="14" />
                  </button>
                  <span class="hover-reason-tooltip">{{ reasonDisplay }}</span>
                </span>
              </div>
            </div>

            <div class="worklist-status-row">
              <div v-if="$slots['title-meta'] || showExecDeptChip || showPharmacyChip" class="worklist-attr-col">
                <div v-if="$slots['title-meta']" class="card-title-meta worklist-title-meta">
                  <slot name="title-meta" />
                </div>
                <button v-if="showExecDeptChip" class="exec-dept-chip worklist-chip" :class="{ missing: execDeptMissing, loading: execDeptLoading }"
                  type="button" :title="execDeptTitle" :aria-busy="execDeptLoading" @click.stop="emit('open-exec-dept', $event)">
                  <span v-if="execDeptMissing || execDeptLoading" class="exec-dept-chip-label">执行科室</span>
                  <span class="exec-dept-chip-value">{{ execDeptLoading ? '读取中' : execDeptDisplay || '待设置' }}</span>
                </button>
                <div v-if="showPharmacyChip" class="pharmacy-chip-anchor" @click.stop>
                  <button class="exec-dept-chip pharmacy-chip worklist-chip"
                    :class="{ missing: pharmacyMissing }" type="button" :title="pharmacyTitle"
                    @click.stop="emit('open-pharmacy', $event)">
                    <span v-if="pharmacyMissing" class="exec-dept-chip-label">发药药房</span>
                    <span class="exec-dept-chip-value">{{ pharmacyDisplay || '待设置' }}</span>
                  </button>
                  <slot name="pharmacy-popover" />
                </div>
              </div>
              <div v-if="$slots.actions" class="worklist-extra-attr-col">
                <slot name="actions" />
              </div>
            </div>

            <div class="card-actions treatment-card-actions worklist-actions">
              <button
                v-if="showManualMatchButton"
                class="manual-match-btn"
                :class="{
                  'is-success': manualMatchButtonText === '已更换'
                }"
                type="button"
                :title="manualMatchTitle"
                @click.stop="emit('toggle-manual-match', $event)"
              >
                <span v-if="manualMatchButtonText === '已更换'" class="match-icon-status">✓</span>
                {{ manualMatchButtonText }}
              </button>
              <button
                v-if="showRejectButton"
                class="recommendation-reject-btn"
                :class="{ active: rejected }"
                type="button"
                :title="rejected ? '恢复该药品推荐，但不会自动选中' : '明确不采用该药品推荐'"
                @click.stop="emit('toggle-rejected', $event)"
              >{{ rejected ? '撤销不采用' : '不采用' }}</button>
              <div v-if="showFeedback" class="voice-feedback-anchor" @click.stop>
                <button class="voice-feedback-trigger" :class="{ submitted: !!feedbackSubmittedLabel }" type="button"
                  @click.stop="emit('toggle-feedback', $event)">反馈</button>
                <div v-if="feedbackVisible" class="voice-feedback-panel">
                  <VoiceRecommendationFeedbackPopover :visible="true" :title="rec.name" :draft="feedbackDraft"
                     :submitting="feedbackSubmitting" :submitted-label="feedbackSubmittedLabel"
                     @close="emit('toggle-feedback')" @update:draft="emit('update:feedbackDraft', $event)"
                     @submit="emit('submit-feedback', $event)" />
                </div>
              </div>
              <button v-if="showEditorToggle" class="inline-arrow-btn action-arrow" type="button"
                :title="editorActionLabel" :aria-label="editorActionLabel"
                @click.stop="emit('toggle-editor', $event)">
                <span>{{ worklistEditorActionLabel }}</span>
                <span class="inline-arrow" :class="{ open: editorExpanded }"></span>
              </button>
            </div>
          </div>

          <div v-if="purposeDisplay || inlineSummary || originalName || usageToken || $slots['summary-action']" class="worklist-bottom-row">
            <div class="worklist-secondary-row">
            <div v-if="purposeDisplay" class="auxiliary-purpose-line worklist-purpose-line">
              <span class="auxiliary-purpose-text">{{ purposeDisplay }}</span>
            </div>
              <div v-if="inlineSummary || $slots['summary-action']" class="medicine-usage-row">
                <div v-if="inlineSummary" class="medicine-inline-summary worklist-inline-text">{{ inlineSummary }}</div>
                <slot name="summary-action" />
              </div>
              <div v-if="originalName" class="manual-match-origin-note worklist-inline-text worklist-inline-origin">
                {{ originalNameLabel }}：{{ originalName }}
              </div>
              <span v-if="usageToken" class="meta-token usage-summary-token worklist-usage-token">建议 {{ usageToken }}</span>
            </div>
          </div>

          <div v-if="probableMatchName" class="manual-match-origin-note probable-match-note">
            <span class="probable-match-copy">
              <span class="probable-match-label">候选标准项</span>
              <span class="probable-match-name">{{ probableMatchName }}</span>
            </span>
            <button
              class="confirm-match-btn inline"
              type="button"
              title="确认采用该标准库候选"
              @click.stop="emit('confirm-probable-match', $event)"
            >
              确认匹配
            </button>
          </div>
        </div>
      </div>

      <div v-if="$slots.body || $slots['manual-match'] || $slots.editor" class="worklist-detail-stack">
        <slot name="body" />
        <slot name="manual-match" />
        <slot name="editor" />
      </div>
    </template>

    <template v-else>
      <div class="card-row treatment-card-row default-treatment-card-row">
        <button
          class="treatment-select-button"
          :class="{ selected }"
          type="button"
          :aria-label="selected ? `将${rec.name}移出方案` : `将${rec.name}纳入方案`"
          :aria-pressed="selected"
          @click.stop="emit('toggle')"
        >
          <span class="worklist-select-dot">
            <svg v-if="selected" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
          </span>
        </button>
        <div class="card-main">
          <div class="default-card-top-row">
            <div class="card-title-line default-card-title-line">
              <div class="card-title-wrap">
                <slot name="title-prefix" />
                <FactCheckHighlight :issue="issue">
                  <span class="card-title">{{ rec.name }}</span>
                </FactCheckHighlight>
                <span v-if="spec" class="meta-token default-spec-text">{{ spec }}</span>
                <span v-if="manufacturer" class="meta-token medicine-manufacturer" :title="`生产厂家：${manufacturer}`">
                  {{ manufacturer }}
                </span>
                <span
                  v-if="necessityLabel"
                  class="auxiliary-necessity-label"
                  :class="{ supplementary: rec.necessity === 'supplementary' }"
                >{{ necessityLabel }}</span>
                <span
                  v-if="reasonDisplay"
                  class="reason-tooltip-trigger"
                  :class="{ open: reasonOpen }"
                  @click.stop
                >
                  <button class="reason-icon-btn" type="button" aria-label="查看推荐依据" title="查看推荐依据" @click.stop="emit('toggle-reason', $event)">
                    <Icon icon="lucide:circle-help" size="14" />
                  </button>
                  <span class="hover-reason-tooltip">{{ reasonDisplay }}</span>
                </span>
              </div>
            </div>

            <div class="card-actions treatment-card-actions default-card-actions">
              <button
                v-if="showManualMatchButton"
                class="manual-match-btn"
                :class="{
                  'is-success': manualMatchButtonText === '已更换'
                }"
                type="button"
                :title="manualMatchTitle"
                @click.stop="emit('toggle-manual-match', $event)"
              >
                <span v-if="manualMatchButtonText === '已更换'" class="match-icon-status">✓</span>
                {{ manualMatchButtonText }}
              </button>
              <button
                v-if="showRejectButton"
                class="recommendation-reject-btn"
                :class="{ active: rejected }"
                type="button"
                :title="rejected ? '恢复该药品推荐，但不会自动选中' : '明确不采用该药品推荐'"
                @click.stop="emit('toggle-rejected', $event)"
              >{{ rejected ? '撤销不采用' : '不采用' }}</button>
              <div v-if="showFeedback" class="voice-feedback-anchor" @click.stop>
                <button
                  class="voice-feedback-trigger"
                  :class="{ submitted: !!feedbackSubmittedLabel }"
                  type="button"
                  @click.stop="emit('toggle-feedback', $event)"
                >反馈</button>
                <div v-if="feedbackVisible" class="voice-feedback-panel">
                  <VoiceRecommendationFeedbackPopover
                    :visible="true"
                    :title="rec.name"
                    :draft="feedbackDraft"
                    :submitting="feedbackSubmitting"
                    :submitted-label="feedbackSubmittedLabel"
                    @close="emit('toggle-feedback')"
                    @update:draft="emit('update:feedbackDraft', $event)"
                    @submit="emit('submit-feedback', $event)"
                  />
                </div>
              </div>
              <button
                v-if="showEditorToggle"
                class="inline-arrow-btn action-arrow"
                type="button"
                :title="editorActionLabel"
                :aria-label="editorActionLabel"
                @click.stop="emit('toggle-editor', $event)"
              >
                <span>{{ editorActionLabel }}</span>
                <span class="inline-arrow" :class="{ open: editorExpanded }"></span>
              </button>
            </div>
          </div>

          <div class="default-card-bottom-row">
            <div class="default-card-summary">
            <div v-if="purposeDisplay" class="auxiliary-purpose-line">
              <span class="auxiliary-purpose-text">{{ purposeDisplay }}</span>
            </div>
              <div v-if="inlineSummary || $slots['summary-action']" class="medicine-usage-row">
                <div v-if="inlineSummary" class="medicine-inline-summary">{{ inlineSummary }}</div>
                <slot name="summary-action" />
              </div>
              <div v-if="originalName" class="manual-match-origin-note">
                {{ originalNameLabel }}：{{ originalName }}
              </div>
              <span v-if="usageToken && !inlineSummary" class="meta-token usage-summary-token">建议 {{ usageToken }}</span>
            </div>

            <div class="default-card-status-row">
              <div v-if="$slots['title-meta']" class="card-title-meta">
                <slot name="title-meta" />
              </div>
              <button
                v-if="showExecDeptChip"
                class="exec-dept-chip"
                :class="{ missing: execDeptMissing, loading: execDeptLoading }"
                type="button"
                :title="execDeptTitle"
                :aria-busy="execDeptLoading"
                @click.stop="emit('open-exec-dept', $event)"
              >
                <span v-if="execDeptMissing || execDeptLoading" class="exec-dept-chip-label">执行科室</span>
                <span class="exec-dept-chip-value">{{ execDeptLoading ? '读取中' : execDeptDisplay || '待设置' }}</span>
              </button>
              <div v-if="showPharmacyChip" class="pharmacy-chip-anchor" @click.stop>
                <button
                  class="exec-dept-chip pharmacy-chip"
                  :class="{ missing: pharmacyMissing }"
                  type="button"
                  :title="pharmacyTitle"
                  @click.stop="emit('open-pharmacy', $event)"
                >
                  <span v-if="pharmacyMissing" class="exec-dept-chip-label">发药药房</span>
                  <span class="exec-dept-chip-value">{{ pharmacyDisplay || '待设置' }}</span>
                </button>
                <slot name="pharmacy-popover" />
              </div>
              <slot name="actions" />
            </div>
          </div>

          <div v-if="probableMatchName" class="manual-match-origin-note probable-match-note">
            <span class="probable-match-copy">
              <span class="probable-match-label">候选标准项</span>
              <span class="probable-match-name">{{ probableMatchName }}</span>
            </span>
            <button
              class="confirm-match-btn inline"
              type="button"
              title="确认采用该标准库候选"
              @click.stop="emit('confirm-probable-match', $event)"
            >
              确认匹配
            </button>
          </div>
        </div>
      </div>

      <slot name="body" />
      <slot name="manual-match" />
      <slot name="editor" />
    </template>
  </article>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import FactCheckHighlight from '@features/feedback/ui/FactCheckHighlight.vue';
import VoiceRecommendationFeedbackPopover from '@features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue';
import type { TreatmentRecommendation } from '@/types/consultation';
import type { VoiceRecommendationFeedbackDraft } from '@/types/voiceFeedback';
import type { FactCheckIssue } from '@services/factChecker';
import { buildMedicineQuantityExplanation } from '@features/clinical-result';
import {
  getAuxiliaryNecessityLabel,
  getAuxiliaryRecommendationPurpose,
} from '../model/auxiliaryRecommendationPresentation';

const props = defineProps({
  rec: {
    type: Object as PropType<TreatmentRecommendation>,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  locked: {
    type: Boolean,
    default: false,
  },
  matching: {
    type: Boolean,
    default: false,
  },
  issue: {
    type: Object as PropType<FactCheckIssue | undefined>,
    default: undefined,
  },
  spec: {
    type: String,
    default: '',
  },
  manufacturer: {
    type: String,
    default: '',
  },
  reasonOpen: {
    type: Boolean,
    default: false,
  },
  matchLabel: {
    type: String,
    default: '',
  },
  matchTone: {
    type: String as PropType<'default' | 'warning' | 'success'>,
    default: 'default',
  },
  showExecDeptChip: {
    type: Boolean,
    default: false,
  },
  execDeptDisplay: {
    type: String,
    default: '',
  },
  execDeptMissing: {
    type: Boolean,
    default: false,
  },
  execDeptLoading: {
    type: Boolean,
    default: false,
  },
  execDeptTitle: {
    type: String,
    default: '',
  },
  showPharmacyChip: {
    type: Boolean,
    default: false,
  },
  pharmacyDisplay: {
    type: String,
    default: '',
  },
  pharmacyMissing: {
    type: Boolean,
    default: false,
  },
  pharmacyTitle: {
    type: String,
    default: '',
  },
  usageToken: {
    type: String,
    default: '',
  },
  probableMatchName: {
    type: String,
    default: '',
  },
  originalName: {
    type: String,
    default: '',
  },
  inlineSummary: {
    type: String,
    default: '',
  },
  showFeedback: {
    type: Boolean,
    default: true,
  },
  feedbackVisible: {
    type: Boolean,
    default: false,
  },
  feedbackDraft: {
    type: Object as PropType<VoiceRecommendationFeedbackDraft>,
    default: () => ({
      action: '',
      issueTags: [],
      comment: '',
      correctedValue: '',
    }),
  },
  feedbackSubmitting: {
    type: Boolean,
    default: false,
  },
  feedbackSubmittedLabel: {
    type: String,
    default: '',
  },
  showManualMatchButton: {
    type: Boolean,
    default: false,
  },
  manualMatchTitle: {
    type: String,
    default: '',
  },
  manualMatchButtonText: {
    type: String,
    default: '手动匹配',
  },
  showRejectButton: {
    type: Boolean,
    default: false,
  },
  rejected: {
    type: Boolean,
    default: false,
  },
  showEditorToggle: {
    type: Boolean,
    default: false,
  },
  editorExpanded: {
    type: Boolean,
    default: false,
  },
  layoutVariant: {
    type: String as PropType<'default' | 'worklist'>,
    default: 'default',
  },
});

const originalNameLabel = computed(() => (
  props.rec.sourceType === 'explicit' ? '对话表述' : 'AI 原建议'
));

const reasonDisplay = computed(() => [
  (props.rec.reason || '').trim(),
  buildMedicineQuantityExplanation(props.rec),
].filter(Boolean).join(' '));
const purposeDisplay = computed(() => getAuxiliaryRecommendationPurpose(props.rec));
const necessityLabel = computed(() => getAuxiliaryNecessityLabel(props.rec));

const editorActionLabel = computed(() => {
  if (props.editorExpanded) return '收起编辑';
  return props.rec.type === 'medicine' ? '编辑' : '编辑详情';
});
const worklistEditorActionLabel = computed(() => {
  if (props.editorExpanded) return '收起';
  return props.rec.type === 'medicine' ? '编辑' : '详情';
});

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'toggle-reason', event?: Event): void;
  (e: 'open-exec-dept', event?: Event): void;
  (e: 'open-pharmacy', event?: Event): void;
  (e: 'confirm-probable-match', event?: Event): void;
  (e: 'toggle-feedback', event?: Event): void;
  (e: 'update:feedbackDraft', draft: VoiceRecommendationFeedbackDraft): void;
  (e: 'submit-feedback', draft: VoiceRecommendationFeedbackDraft): void;
  (e: 'toggle-manual-match', event?: Event): void;
  (e: 'toggle-rejected', event?: Event): void;
  (e: 'toggle-editor', event?: Event): void;
}>();

function handleCardToggle(event: MouseEvent): void {
  if (props.rejected) return;
  const target = event.target as HTMLElement | null;
  if (!target || target.closest([
    'button',
    'input',
    'select',
    'textarea',
    'a',
    '[role="button"]',
    '[role="listbox"]',
    '.worklist-detail-stack',
  ].join(','))) return;
  emit('toggle');
}
</script>

<style scoped>
.vcn-treatment-item {
  position: relative;
  padding: 12px 14px;
  border: 1px solid var(--voice-border);
  border-radius: 14px;
  background: var(--voice-surface);
  cursor: default;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.vcn-treatment-item.is-card-selectable {
  cursor: pointer;
}

.vcn-treatment-item:hover {
  border-color: var(--voice-border-strong);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
}

.vcn-treatment-item.selected {
  background: var(--voice-surface);
  background: color-mix(in srgb, var(--voice-surface) 94%, var(--voice-accent));
  border-color: var(--voice-accent);
  box-shadow:
    0 0 0 1px var(--voice-accent-soft),
    0 8px 18px rgba(15, 23, 42, 0.028);
}

.vcn-treatment-item.rejected {
  border-color: var(--voice-border);
  background: #f8fafc;
  background: color-mix(in srgb, var(--voice-surface) 88%, #f8fafc);
  opacity: 0.72;
}

.vcn-treatment-item.locked {
  border-style: dashed;
}

.vcn-treatment-item.matching,
.vcn-treatment-item.worklist.matching {
  border-color: var(--voice-accent);
  box-shadow:
    0 0 0 1px var(--voice-accent-soft),
    0 10px 20px rgba(15, 23, 42, 0.03);
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.treatment-card-row {
  align-items: baseline;
}

.default-treatment-card-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 8px;
  align-items: stretch;
}

.vcn-treatment-item.worklist {
  padding: 8px 12px;
  border-color: #e2e8f0;
  border-radius: 10px;
  box-shadow: none;
}

.vcn-treatment-item.worklist.matching:hover {
  border-color: var(--voice-accent);
  box-shadow:
    0 0 0 1px var(--voice-accent-soft),
    0 10px 20px rgba(15, 23, 42, 0.03);
}

.vcn-treatment-item.worklist:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
}

.vcn-treatment-item.worklist.selected {
  background: var(--voice-surface);
  background: color-mix(in srgb, var(--voice-surface) 97%, var(--voice-accent));
  border-color: #dbe3ee;
  box-shadow: none;
}

.vcn-treatment-item.grouped-recommendation-row,
.vcn-treatment-item.grouped-recommendation-row:hover,
.vcn-treatment-item.grouped-recommendation-row.selected {
  border: 0;
  box-shadow: none;
}

.vcn-treatment-item.grouped-recommendation-row {
  background: var(--voice-surface);
  border-left: 3px solid transparent;
}

.vcn-treatment-item.grouped-recommendation-row:hover {
  background: var(--voice-surface);
  background: color-mix(in srgb, var(--voice-surface) 98%, var(--voice-accent));
}

.vcn-treatment-item.grouped-recommendation-row.selected {
  border-left: 3px solid var(--voice-accent);
  background: var(--voice-surface);
  background: color-mix(in srgb, var(--voice-surface) 94%, var(--voice-accent));
}

.vcn-treatment-item.grouped-recommendation-row
  + .vcn-treatment-item.grouped-recommendation-row {
  border-top: 1px solid rgba(148, 163, 184, 0.2);
}

.card-main {
  flex: 1;
  min-width: 0;
  overflow: visible;
}

.default-card-top-row,
.default-card-bottom-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, auto);
  gap: 6px 14px;
  align-items: center;
  min-width: 0;
}

.default-card-top-row {
  align-items: start;
}

.default-card-bottom-row {
  align-items: end;
  margin-top: 4px;
}

.default-card-summary {
  min-width: 0;
}

.default-card-status-row,
.default-card-actions {
  display: inline-flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  max-width: 440px;
  justify-self: end;
}

.default-card-status-row,
.default-card-actions {
  align-items: center;
}

.card-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: 1;
  max-width: 100%;
}

.card-title-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
  flex-wrap: nowrap;
  overflow: visible;
}

.default-card-title-line {
  min-width: 0;
}

.worklist-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
}

.treatment-select-button {
  display: flex;
  justify-content: center;
  align-items: center;
  align-self: start;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.treatment-select-button:focus-visible {
  outline: 2px solid var(--voice-accent-soft);
  outline-offset: 2px;
}

.worklist-select-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1.5px solid #cbd5e1;
  background: #ffffff;
  color: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.18s ease;
}

.treatment-select-button.selected .worklist-select-dot {
  border-color: var(--voice-accent);
  background: var(--voice-accent);
  color: #ffffff;
  box-shadow: none;
}

.worklist-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.worklist-top-row,
.worklist-bottom-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.worklist-top-row {
  align-items: center;
}

.worklist-bottom-row {
  align-items: center;
}

.worklist-primary-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.worklist-name-wrap {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.worklist-name-wrap .meta-token {
  min-width: 0;
  max-width: min(240px, 100%);
  overflow: hidden;
  text-overflow: ellipsis;
  color: #475569;
  font-weight: 500;
}

.worklist-secondary-row {
  display: flex;
  align-items: flex-start;
  gap: 4px 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.auxiliary-purpose-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  font-size: 13.5px;
  line-height: 1.45;
}

.worklist-purpose-line {
  flex: 1 1 100%;
}

.auxiliary-purpose-text {
  min-width: 0;
  color: #526579;
  font-weight: 500;
  word-break: break-word;
}

.auxiliary-necessity-label {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-height: 20px;
  padding: 0 7px;
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.1);
  color: #2563eb;
  font-size: 11.5px;
  font-weight: 700;
}

.auxiliary-necessity-label.supplementary {
  background: rgba(100, 116, 139, 0.1);
  color: #64748b;
}

.worklist-inline-text {
  font-size: 11.5px;
  line-height: 1.25;
  color: #1e293b !important;
}

.worklist-inline-origin {
  color: #94a3b8;
}

.worklist-status-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-left: auto;
  min-width: 0;
  max-width: 360px;
  flex-shrink: 0;
}

.worklist-status-col {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
  color: #b45309;
  font-weight: 600;
  flex: 0 0 auto;
}

.worklist .match-token {
  margin-left: 0;
}

.worklist-status {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 86px;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.worklist-attr-col {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  align-content: flex-start;
  justify-content: flex-end;
  flex: 1 1 auto;
  min-width: 0;
}

.worklist-extra-attr-col {
  display: inline-flex;
  justify-content: flex-end;
  min-width: 0;
}

.worklist-title-meta {
  display: contents;
}

.worklist-usage-token {
  color: #64748b;
  flex-shrink: 0;
}

.card-title {
  display: block;
  font-size: 14.5px;
  font-weight: 700;
  color: var(--voice-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.worklist .card-title {
  font-size: 15px;
  font-weight: 700;
  line-height: 1.4;
}

.reason-tooltip-trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.reason-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--voice-text-muted);
  cursor: help;
}

.reason-icon-btn:hover,
.reason-tooltip-trigger:hover .reason-icon-btn,
.reason-tooltip-trigger:focus-within .reason-icon-btn {
  color: var(--voice-accent);
}

.hover-reason-tooltip {
  position: absolute;
  left: 0;
  top: calc(100% + 8px);
  z-index: 60;
  width: min(320px, 48vw);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: #ffffff;
  box-shadow: 0 18px 36px rgba(15, 23, 42, 0.18);
  color: #334155;
  font-size: var(--voice-font-min);
  line-height: 1.6;
  white-space: normal;
  word-break: break-word;
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
  pointer-events: none;
}

.reason-tooltip-trigger:hover .hover-reason-tooltip,
.reason-tooltip-trigger:focus-within .hover-reason-tooltip,
.reason-tooltip-trigger.open .hover-reason-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}

.meta-token {
  flex-shrink: 0;
  font-size: var(--voice-font-min);
  color: var(--voice-text-muted);
  white-space: nowrap;
}

.worklist-spec-text {
  color: #334155 !important;
  font-weight: 600 !important;
}

.default-spec-text {
  color: #475569 !important;
  font-weight: 500 !important;
}

.meta-token.medicine-manufacturer {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  color: #64748b;
  font-weight: 400;
  text-overflow: ellipsis;
}

.match-token {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  max-width: 120px;
  color: #64748b;
  font-weight: 600;
  letter-spacing: 0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.worklist .match-token {
  font-size: 12px;
}

.meta-token.warning {
  color: #b45309;
}

.meta-token.success {
  color: #1d4ed8;
}

.card-title-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-shrink: 0;
}

.medicine-inline-summary {
  display: block;
  width: 100%;
  margin-top: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  font-size: var(--voice-font-min);
  color: #334155 !important;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.worklist .medicine-inline-summary {
  flex: 0 0 100%;
  max-width: 100%;
  min-width: 100%;
  width: 100%;
  margin-top: 0;
  white-space: normal;
  color: #475569;
}

.medicine-usage-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  min-width: 0;
}

.medicine-usage-row .medicine-inline-summary {
  flex: 0 1 auto;
  width: auto;
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.default-card-summary .manual-match-origin-note {
  margin-top: 0;
}

.worklist .worklist-secondary-row {
  display: block;
}

.worklist .worklist-secondary-row .worklist-inline-text,
.worklist .worklist-secondary-row .worklist-usage-token {
  display: block;
  margin-top: 4px;
}

.worklist .worklist-secondary-row .worklist-inline-text + .worklist-inline-text,
.worklist .worklist-secondary-row .worklist-usage-token + .worklist-inline-text,
.worklist .worklist-secondary-row .worklist-inline-text + .worklist-usage-token {
  margin-top: 4px;
}

.manual-match-origin-note {
  margin-top: 6px;
  font-size: var(--voice-font-min);
  color: var(--voice-text-muted);
  line-height: 1.5;
}

.worklist .manual-match-origin-note {
  margin-top: 0;
}

.probable-match-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid rgba(201, 122, 17, 0.18);
  background: linear-gradient(180deg, rgba(201, 122, 17, 0.09) 0%, rgba(201, 122, 17, 0.04) 100%);
  color: var(--voice-text);
}

.probable-match-copy {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.probable-match-label {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(201, 122, 17, 0.14);
  color: var(--voice-warning);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.probable-match-name {
  color: var(--voice-text);
  font-weight: 600;
  word-break: break-word;
}

.exec-dept-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 180px;
  min-height: 20px;
  padding: 0 8px;
  border: 1px solid var(--voice-accent-soft);
  border-radius: 999px;
  background: var(--voice-accent-softer);
  color: var(--voice-accent-strong);
  cursor: pointer;
  font-size: var(--voice-font-min);
  font-weight: 700;
}

.pharmacy-chip-anchor {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.default-card-status-row .exec-dept-chip {
  max-width: 172px;
}

.exec-dept-chip:hover {
  border-color: var(--voice-accent);
  background: rgba(37, 99, 235, 0.1);
}

.exec-dept-chip.missing {
  border-color: rgba(201, 122, 17, 0.28);
  background: rgba(201, 122, 17, 0.1);
  color: var(--voice-warning);
}

.exec-dept-chip.missing:not(.pharmacy-chip) {
  padding-right: 3px;
  padding-left: 3px;
  border-color: transparent;
  background: transparent;
  color: #64748b;
  font-weight: 500;
}

.exec-dept-chip.missing:not(.pharmacy-chip):hover {
  border-color: rgba(201, 122, 17, 0.22);
  background: rgba(201, 122, 17, 0.055);
}

.exec-dept-chip.missing:not(.pharmacy-chip) .exec-dept-chip-label {
  color: #64748b;
  font-weight: 500;
}

.exec-dept-chip.missing:not(.pharmacy-chip) .exec-dept-chip-value {
  color: #9a6200;
  font-weight: 600;
}

.exec-dept-chip.loading:not(.pharmacy-chip) {
  padding-right: 3px;
  padding-left: 3px;
  border-color: transparent;
  background: transparent;
  color: #64748b;
  cursor: progress;
  font-weight: 500;
}

.exec-dept-chip.loading:not(.pharmacy-chip) .exec-dept-chip-label,
.exec-dept-chip.loading:not(.pharmacy-chip) .exec-dept-chip-value {
  color: #64748b;
  font-weight: 500;
}

.exec-dept-chip-label {
  flex-shrink: 0;
  font-size: var(--voice-font-min);
  font-weight: 700;
}

.exec-dept-chip-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--voice-font-min);
  font-weight: 700;
}

.card-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  position: relative;
}

.treatment-card-actions {
  align-items: center;
  align-self: baseline;
  min-height: 28px;
}

.worklist-actions {
  display: inline-flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.worklist-chip {
  min-height: 20px;
  max-width: 132px;
  padding: 0 3px;
  border-color: transparent;
  background: transparent;
  color: #526579;
  font-weight: 600;
}

.worklist-chip:not(.missing):hover {
  border-color: rgba(37, 99, 235, 0.14);
  background: rgba(37, 99, 235, 0.045);
  color: #1d4ed8;
}

.vcn-treatment-item.worklist .worklist-chip:not(.missing) {
  border-color: transparent;
  border-radius: 4px;
  background: transparent;
  box-shadow: none;
}

.worklist-chip.missing {
  border-color: rgba(201, 122, 17, 0.28);
  background: rgba(201, 122, 17, 0.1);
  color: var(--voice-warning);
}

.worklist-actions .voice-feedback-anchor,
.worklist-actions .manual-match-btn,
.worklist-actions .recommendation-reject-btn,
.worklist-actions .inline-arrow-btn,
.worklist-actions .voice-feedback-trigger {
  flex-shrink: 0;
}

.worklist-actions .voice-feedback-trigger,
.worklist-actions .manual-match-btn,
.worklist-actions .recommendation-reject-btn,
.worklist-actions .action-arrow {
  min-height: 20px;
  border-radius: 4px;
}

.worklist-actions .voice-feedback-trigger,
.worklist-actions .manual-match-btn:not(.is-warning),
.worklist-actions .recommendation-reject-btn,
.worklist-actions .action-arrow {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.worklist-actions .voice-feedback-trigger:hover,
.worklist-actions .manual-match-btn:not(.is-warning):hover,
.worklist-actions .recommendation-reject-btn:hover,
.worklist-actions .action-arrow:hover {
  border-color: transparent;
  background: var(--voice-accent-softer);
}

.worklist-actions .action-arrow {
  color: var(--voice-accent-strong);
  font-weight: 650;
}

:slotted(.doc-icon-btn) {
  min-height: 30px;
  min-width: 30px;
  border: 1px solid var(--voice-border, #dbe3ee);
  border-radius: 8px;
  background: #fff;
}

.worklist-detail-stack {
  margin-top: 10px;
  margin-left: 34px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.voice-feedback-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.voice-feedback-trigger {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--voice-border);
  border-radius: 999px;
  background: var(--voice-surface);
  color: var(--voice-text-muted);
  font-size: var(--voice-font-min);
  cursor: pointer;
}

.voice-feedback-trigger:hover {
  border-color: var(--voice-accent);
  color: var(--voice-accent);
}

.voice-feedback-trigger.submitted {
  border-color: rgba(31, 138, 91, 0.2);
  background: rgba(31, 138, 91, 0.08);
  color: var(--voice-success);
}

.voice-feedback-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 12;
}

.manual-match-btn {
  min-height: 20px;
  padding: 0 8px;
  border: 1px solid var(--voice-accent-soft);
  border-radius: 999px;
  background: var(--voice-accent-softer);
  color: var(--voice-accent);
  font-size: var(--voice-font-min);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.manual-match-btn:hover {
  border-color: var(--voice-accent);
  background: var(--voice-accent-soft);
}

.manual-match-btn.is-success {
  border-color: rgba(31, 138, 91, 0.25);
  background: rgba(31, 138, 91, 0.06);
  color: #1f8a5b;
}

.manual-match-btn.is-success:hover {
  border-color: #1f8a5b;
  background: rgba(31, 138, 91, 0.12);
}

.manual-match-btn.is-warning {
  border-color: rgba(220, 115, 30, 0.25);
  background: rgba(220, 115, 30, 0.06);
  color: #c25e00;
}

.manual-match-btn.is-warning:hover {
  border-color: #c25e00;
  background: rgba(220, 115, 30, 0.12);
}

.recommendation-reject-btn {
  min-height: 20px;
  padding: 0 8px;
  border: 1px solid rgba(100, 116, 139, 0.24);
  border-radius: 999px;
  background: rgba(248, 250, 252, 0.9);
  color: var(--voice-text-muted);
  font-size: var(--voice-font-min);
  cursor: pointer;
}

.recommendation-reject-btn:hover,
.recommendation-reject-btn.active {
  border-color: rgba(185, 28, 28, 0.28);
  background: rgba(185, 28, 28, 0.07);
  color: #b91c1c;
}

.match-icon-status {
  font-weight: bold;
  font-size: 11px;
}

.confirm-match-btn {
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(201, 122, 17, 0.22);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.72);
  color: #9a5a07;
  font-size: var(--voice-font-min);
  font-weight: 600;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.36);
  transition: border-color 0.18s ease, background-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}

.confirm-match-btn.inline {
  min-height: 26px;
  padding: 0 10px;
  font-size: 12px;
  flex-shrink: 0;
}

.confirm-match-btn:hover {
  border-color: rgba(201, 122, 17, 0.34);
  background: rgba(201, 122, 17, 0.14);
  color: #7a4505;
  transform: translateY(-1px);
}

.inline-arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid var(--voice-border);
  border-radius: 999px;
  background: var(--voice-surface);
  color: var(--voice-text);
  font-size: var(--voice-font-min);
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.inline-arrow-btn:hover {
  border-color: var(--voice-accent);
  color: var(--voice-accent);
  background: var(--voice-accent-softer);
}

.action-arrow {
  background: var(--voice-surface);
}

.inline-arrow {
  width: 7px;
  height: 7px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg);
  transition: transform 0.18s ease;
}

.inline-arrow.open {
  transform: rotate(225deg);
}

@media (max-width: 900px) {
  .card-row {
    flex-direction: column;
    align-items: stretch;
  }

  .default-card-top-row,
  .default-card-bottom-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .default-card-status-row,
  .default-card-actions {
    max-width: none;
    justify-self: stretch;
    justify-content: flex-start;
  }

  .card-title-line {
    flex-wrap: wrap;
  }

  .voice-feedback-panel {
    left: 0;
    right: auto;
  }

  .worklist-row {
    grid-template-columns: 32px minmax(0, 1fr);
  }

  .worklist-top-row,
  .worklist-bottom-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .worklist-primary-row,
  .worklist-secondary-row {
    flex-wrap: wrap;
  }

  .worklist-status-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .worklist-actions {
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .worklist-detail-stack {
    margin-left: 32px;
  }
}
</style>
