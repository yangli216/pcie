<template>
  <li
    class="vcn-diagnosis-item"
    :class="{ selected, primary: isPrimary, 'differential-open': differentialOpen, 'actions-overlay-open': actionsOverlayOpen }"
    @click="emit('toggle')"
  >
    <div v-if="selected" class="diag-selected-mark">
      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </div>

    <div class="card-row diagnosis-card-row">
      <div class="card-main diagnosis-card-main">
        <div class="card-title-line diagnosis-title-line">
          <div class="card-title-wrap-group" style="display: flex; flex-direction: column; min-width: 0; flex-grow: 1;">
            <div class="card-title-wrap">
              <FactCheckHighlight :issue="issue">
                <span class="card-title">
                  <span v-if="showTcmBadge && diag.isTCM" class="tcm-badge">中</span>
                  {{ diag.name }}
                </span>
              </FactCheckHighlight>
              <span
                v-if="diag.rationale"
                class="reason-tooltip-trigger"
                :class="{ open: reasonOpen }"
                @click.stop
              >
                <button class="reason-icon-btn" type="button" aria-label="查看诊断依据" title="查看诊断依据" @click.stop="emit('toggle-reason', $event)">
                  <Icon icon="lucide:circle-help" size="14" />
                </button>
                <span class="hover-reason-tooltip">{{ diag.rationale }}</span>
              </span>
            </div>
            <div v-if="diag.originalName && diag.originalName !== diag.name" class="diagnosis-original-name">
              AI 原建议：{{ diag.originalName }}
            </div>
          </div>
          <div class="diagnosis-meta-row">
            <span v-if="displayRate" class="diag-rate-token" :class="rateToneClass">{{ displayRate }}</span>
            <span
              v-if="catalogMatchLabel"
              class="meta-token diag-catalog-token"
              :class="`is-${diag.catalogMatchStatus}`"
              :title="diag.catalogMatchReason || catalogMatchLabel"
            >{{ catalogMatchLabel }}</span>
            <span v-if="diag.code" class="meta-token">编码 {{ diag.code }}</span>
            <span v-if="diag.diagnosisKind === 'symptom_working'" class="meta-token diag-working-token">症状性工作诊断</span>
            <span v-if="isPrimary" class="meta-token diag-role-token">主诊断</span>
            <span v-else-if="selected" class="meta-token diag-role-token">已纳入</span>
            <button
              v-if="selected && !isPrimary"
              class="diag-action-btn"
              type="button"
              @click.stop="emit('set-primary', $event)"
            >设为主诊</button>
            <button
              v-if="selected && canRemove"
              class="diag-action-btn subtle"
              type="button"
              @click.stop="emit('remove', $event)"
            >移除</button>
            <button class="inline-arrow-btn" type="button" title="切换同类诊断" @click.stop="emit('toggle-related', $event)">
              <span class="inline-arrow" :class="{ open: relatedOpen }"></span>
            </button>
          </div>
        </div>
      </div>

      <div class="card-actions">
        <slot name="actions" />
        <div v-if="showDifferential" class="diagnosis-differential-anchor" @click.stop>
          <button
            class="diag-action-btn differential-status"
            :class="`is-${differentialStatus.state}`"
            type="button"
            @click.stop="emit('diagnosis-differential', $event)"
          >{{ differentialButtonLabel }}</button>

          <section
            v-if="selected && differentialOpen && differentialPreview.state !== 'idle'"
            class="diagnosis-differential-panel"
            :class="`is-${differentialPreview.state}`"
            role="dialog"
            aria-label="主诊断核查要点"
            tabindex="-1"
            @click.stop
            @keydown.esc.stop="emit('close-differential', $event)"
          >
            <header class="diagnosis-differential-panel-head">
              <strong>
                <Icon icon="lucide:list-checks" size="15" aria-hidden="true" />
                主诊断核查要点
              </strong>
              <span class="diagnosis-differential-panel-actions">
                <span>{{ differentialPreviewStateLabel }}</span>
                <button
                  type="button"
                  class="diagnosis-differential-close"
                  aria-label="关闭主诊断核查要点"
                  title="关闭"
                  @click.stop="emit('close-differential', $event)"
                >
                  <Icon icon="lucide:x" size="16" aria-hidden="true" />
                </button>
              </span>
            </header>

            <p v-if="differentialPreview.state === 'loading'" class="diagnosis-differential-state">
              正在生成鉴别信息…
            </p>
            <p v-else-if="differentialPreview.state === 'clear'" class="diagnosis-differential-state is-clear">
              暂无需要额外核查的鉴别项
            </p>
            <p v-else-if="differentialPreview.state === 'error'" class="diagnosis-differential-state is-error">
              {{ differentialPreview.message || '鉴别信息加载失败，请点击重试' }}
            </p>
            <ul v-else-if="differentialPreviewPoints.length" class="diagnosis-differential-points">
              <li v-for="(point, pointIndex) in differentialPreviewPoints" :key="`${pointIndex}-${point.text}`">
                <span class="diagnosis-differential-point-text">
                  <template v-for="(segment, segmentIndex) in point.segments" :key="`${segmentIndex}-${segment.text}`">
                    <mark v-if="segment.highlighted" class="diagnosis-differential-keyword">{{ segment.text }}</mark>
                    <span v-else>{{ segment.text }}</span>
                  </template>
                </span>
              </li>
            </ul>

            <footer v-if="differentialPreviewPoints.length" class="diagnosis-differential-panel-footer">
              <button
                type="button"
                class="diagnosis-differential-confirm"
                aria-label="已确认并关闭主诊断核查要点"
                @click.stop="emit('close-differential', $event)"
              >已确认</button>
            </footer>
          </section>
        </div>
        <div v-if="showFeedback" class="voice-feedback-anchor" @click.stop>
          <button
            class="voice-feedback-trigger"
            :class="{ submitted: !!submittedLabel }"
            type="button"
            @click.stop="emit('toggle-feedback', $event)"
          >反馈</button>
          <div v-if="feedbackVisible" class="voice-feedback-panel">
            <VoiceRecommendationFeedbackPopover
              :visible="true"
              :title="diag.name"
              :draft="feedbackDraft"
              :submitting="feedbackSubmitting"
              :submitted-label="submittedLabel"
              @close="emit('toggle-feedback')"
              @update:draft="emit('update:feedbackDraft', $event)"
              @submit="emit('submit-feedback', $event)"
            />
          </div>
        </div>
      </div>
    </div>

    <slot name="body" />

    <div v-if="relatedOpen && relatedDiagnoses.length > 0" class="related-section" @click.stop>
      <div class="related-list">
        <button
          v-for="item in relatedDiagnoses"
          :key="item.id"
          class="related-item"
          type="button"
          @click="emit('swap-related', item)"
        >
          <span class="related-code">{{ item.code }}</span>
          <span class="related-name">{{ item.name }}</span>
        </button>
      </div>
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed, type PropType } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import FactCheckHighlight from '@features/feedback/ui/FactCheckHighlight.vue';
import VoiceRecommendationFeedbackPopover from '@features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue';
import type { Diagnosis } from '@/types/consultation';
import type { VoiceRecommendationFeedbackDraft } from '@/types/voiceFeedback';
import type { FactCheckIssue } from '@services/factChecker';
import type {
  DiagnosisChecklistPrefetchStatus,
  DiagnosisChecklistPreview,
} from '../model/useClinicalResultDiagnosisChecklist';
import { buildDiagnosisChecklistHighlightSegments } from '@features/clinical-result';

interface RelatedDiagnosisCandidate {
  id?: string;
  code: string;
  name: string;
}

const props = defineProps({
  diag: {
    type: Object as PropType<Diagnosis>,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  canRemove: {
    type: Boolean,
    default: false,
  },
  reasonOpen: {
    type: Boolean,
    default: false,
  },
  relatedOpen: {
    type: Boolean,
    default: false,
  },
  relatedDiagnoses: {
    type: Array as PropType<RelatedDiagnosisCandidate[]>,
    default: () => [],
  },
  issue: {
    type: Object as PropType<FactCheckIssue | undefined>,
    default: undefined,
  },
  showTcmBadge: {
    type: Boolean,
    default: false,
  },
  showFeedback: {
    type: Boolean,
    default: false,
  },
  showDifferential: {
    type: Boolean,
    default: false,
  },
  actionsOverlayOpen: {
    type: Boolean,
    default: false,
  },
  differentialStatus: {
    type: Object as PropType<DiagnosisChecklistPrefetchStatus>,
    default: () => ({ state: 'idle', itemCount: 0 }),
  },
  differentialPreview: {
    type: Object as PropType<DiagnosisChecklistPreview>,
    default: () => ({ state: 'idle', items: [], message: '' }),
  },
  differentialOpen: {
    type: Boolean,
    default: false,
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
  submittedLabel: {
    type: String,
    default: '',
  },
});

const rateToneClass = computed(() => {
  const rate = displayRate.value;
  if (rate.includes('高')) return 'rate-high';
  if (rate.includes('中')) return 'rate-medium';
  if (rate.includes('低')) return 'rate-low';
  const numericRate = Number.parseInt(rate, 10);
  if (Number.isNaN(numericRate)) return 'rate-neutral';
  if (numericRate >= 70) return 'rate-high';
  if (numericRate >= 60) return 'rate-medium';
  return 'rate-low';
});

const displayRate = computed(() => props.diag.rate || 'AI分析');
const catalogMatchLabel = computed(() => {
  if (props.diag.catalogMatchStatus === 'compatible') return '标准库近似项';
  if (props.diag.catalogMatchStatus === 'ambiguous') return '需选择标准项';
  if (props.diag.catalogMatchStatus === 'conflict') return '标准库冲突';
  if (props.diag.catalogMatchStatus === 'unmatched') return '未匹配标准库';
  return '';
});
const differentialButtonLabel = computed(() => {
  const { state, itemCount } = props.differentialStatus;
  if (state === 'loading') return '主诊核查中…';
  if (state === 'risk') return '核查需关注';
  if (state === 'ready') return `主诊核查 ${itemCount}项`;
  if (state === 'clear') return '主诊核查完成';
  return '主诊核查';
});
const differentialPreviewPoints = computed(() => {
  const { state } = props.differentialPreview;
  const texts = state === 'risk' && props.differentialPreview.message
    ? [props.differentialPreview.message]
    : props.differentialPreview.items.map((item) => item.question || item.recordText);
  return texts
    .filter(Boolean)
    .map((text) => ({ text, segments: buildDiagnosisChecklistHighlightSegments(text) }));
});
const differentialPreviewStateLabel = computed(() => {
  const { state } = props.differentialPreview;
  if (state === 'loading') return '分析中';
  if (state === 'clear') return '无需额外核查';
  if (state === 'error') return '加载失败';
  if (state === 'risk') return '优先核查';
  return `${differentialPreviewPoints.value.length} 项`;
});

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'toggle-reason', event?: Event): void;
  (e: 'set-primary', event?: Event): void;
  (e: 'remove', event?: Event): void;
  (e: 'toggle-related', event?: Event): void;
  (e: 'swap-related', diag: RelatedDiagnosisCandidate): void;
  (e: 'diagnosis-differential', event?: Event): void;
  (e: 'close-differential', event?: Event): void;
  (e: 'toggle-feedback', event?: Event): void;
  (e: 'update:feedbackDraft', draft: VoiceRecommendationFeedbackDraft): void;
  (e: 'submit-feedback', draft: VoiceRecommendationFeedbackDraft): void;
}>();
</script>

<style scoped>
.vcn-diagnosis-item {
  position: relative;
  padding: 12px 14px 12px 34px;
  border: 1px solid var(--voice-border);
  border-radius: 14px;
  background: var(--voice-surface);
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease, background-color 0.18s ease;
}

.vcn-diagnosis-item:hover {
  border-color: var(--voice-border-strong);
  box-shadow: 0 8px 18px rgba(15, 23, 42, 0.035);
}

.vcn-diagnosis-item.selected {
  background: var(--voice-surface);
  border-color: var(--voice-accent);
  box-shadow:
    0 0 0 1px var(--voice-accent-soft),
    0 8px 18px rgba(15, 23, 42, 0.028);
}

.vcn-diagnosis-item.primary {
  border-color: var(--voice-accent);
  box-shadow:
    0 0 0 1px var(--voice-accent-soft),
    0 10px 20px rgba(15, 23, 42, 0.03);
}

.vcn-diagnosis-item.differential-open,
.vcn-diagnosis-item.actions-overlay-open {
  z-index: 24;
}

.diag-selected-mark {
  position: absolute;
  top: -1px;
  left: -1px;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 14px 0 12px 0;
  background: var(--voice-accent-softer);
  color: var(--voice-accent-strong);
  border-right: 1px solid var(--voice-accent-soft);
  border-bottom: 1px solid var(--voice-accent-soft);
  z-index: 2;
}

.diag-selected-mark::after {
  content: '';
  position: absolute;
  inset: 0;
  border-top: 1px solid rgba(255, 255, 255, 0.38);
  border-left: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: inherit;
  pointer-events: none;
}

.card-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.diagnosis-card-row {
  align-items: center;
}

.card-main {
  flex: 1;
  min-width: 0;
  overflow: visible;
}

.diagnosis-card-main {
  min-width: 0;
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

.diagnosis-title-line {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto;
  align-items: center;
  gap: 8px 14px;
}

.diagnosis-meta-row {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
  max-width: 430px;
  justify-self: end;
}

.card-title {
  display: block;
  font-size: var(--voice-font-strong);
  font-weight: 700;
  color: var(--voice-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.diagnosis-meta-row .meta-token {
  min-width: 0;
  max-width: 132px;
  overflow: hidden;
  text-overflow: ellipsis;
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
  z-index: 12;
  width: min(320px, 48vw);
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--voice-border);
  background: var(--voice-surface-glass);
  box-shadow: 0 14px 28px rgba(15, 23, 42, 0.14);
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

.diag-rate-token {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(100, 116, 139, 0.09);
  color: var(--voice-text-muted);
  font-size: var(--voice-font-min);
  font-weight: 700;
  white-space: nowrap;
}

.diag-rate-token.rate-high {
  background: rgba(31, 138, 91, 0.1);
  color: var(--voice-success);
}

.diag-rate-token.rate-medium {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.diag-rate-token.rate-low {
  background: rgba(239, 68, 68, 0.1);
  color: var(--voice-danger);
}

.diag-role-token {
  color: var(--voice-accent);
}

.diag-catalog-token.is-compatible,
.diag-catalog-token.is-ambiguous {
  color: #b45309;
  font-weight: 700;
}

.diag-catalog-token.is-conflict,
.diag-catalog-token.is-unmatched {
  color: var(--voice-danger);
  font-weight: 700;
}

.diag-action-btn {
  flex-shrink: 0;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid var(--voice-accent-soft);
  border-radius: 999px;
  background: var(--voice-accent-softer);
  color: var(--voice-accent);
  font-size: var(--voice-font-min);
  cursor: pointer;
}

.diag-action-btn.subtle {
  border-color: var(--voice-border);
  background: var(--voice-surface);
  color: var(--voice-text-muted);
}

.diag-action-btn:hover {
  border-color: var(--voice-accent);
}

.diag-action-btn.subtle:hover {
  color: var(--voice-text);
  border-color: var(--voice-border-strong);
}

.differential-status.is-loading {
  color: var(--voice-text-muted);
}

.differential-status.is-ready,
.differential-status.is-clear {
  color: var(--voice-accent-strong);
  border-color: var(--voice-accent-soft);
  background: var(--voice-accent-softer);
}

.differential-status.is-risk {
  color: #a83f1f;
  border-color: rgba(234, 88, 12, 0.35);
  background: rgba(255, 237, 213, 0.75);
}

.diagnosis-differential-anchor {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.diagnosis-differential-panel {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: min(520px, 70vw);
  max-height: min(480px, 62vh);
  overflow: hidden;
  padding: 12px 14px 10px;
  border: 1px solid rgba(44, 119, 180, .18);
  border-radius: 10px;
  background: var(--voice-surface-glass);
  color: var(--voice-text);
  box-shadow: 0 16px 34px rgba(15, 23, 42, .16);
}

.diagnosis-differential-panel.is-risk {
  border-color: rgba(234, 88, 12, .28);
  background: rgba(255, 247, 237, .98);
}

.diagnosis-differential-panel-head,
.diagnosis-differential-panel-head strong,
.diagnosis-differential-panel-actions,
.diagnosis-differential-close {
  display: flex;
  align-items: center;
}

.diagnosis-differential-panel-head { flex: 0 0 auto; justify-content: space-between; gap: 12px; }
.diagnosis-differential-panel-head strong { gap: 6px; color: var(--voice-text); font-size: 14px; }
.diagnosis-differential-panel-actions { gap: 6px; }
.diagnosis-differential-panel-actions > span {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(44, 119, 180, .08);
  color: var(--voice-accent-strong);
  font-size: 11px;
  white-space: nowrap;
}
.diagnosis-differential-panel.is-risk .diagnosis-differential-panel-actions > span {
  background: rgba(234, 88, 12, .1);
  color: #9a3412;
}
.diagnosis-differential-close {
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--voice-text-muted);
  cursor: pointer;
}
.diagnosis-differential-close:hover,
.diagnosis-differential-close:focus-visible {
  background: var(--voice-surface-hover);
  color: var(--voice-text);
  outline: 2px solid var(--voice-accent-soft);
  outline-offset: 1px;
}

.diagnosis-differential-state { min-height: 0; margin: 9px 0 2px; overflow-y: auto; color: var(--voice-text-muted); font-size: 13px; line-height: 1.6; }
.diagnosis-differential-state.is-clear { color: var(--voice-success); }
.diagnosis-differential-state.is-error { color: var(--voice-danger); }

.diagnosis-differential-points {
  min-height: 0;
  margin: 7px 0 0;
  padding: 0 6px 0 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: var(--voice-border-strong) transparent;
}
.diagnosis-differential-points::-webkit-scrollbar { width: 6px; }
.diagnosis-differential-points::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--voice-border-strong);
}
.diagnosis-differential-points li {
  position: relative;
  margin-top: 7px;
  padding-left: 15px;
  color: var(--voice-text);
  font-size: 13px;
  line-height: 1.65;
}
.diagnosis-differential-points li::before {
  content: '';
  position: absolute;
  top: .62em;
  left: 1px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--voice-accent);
}
.diagnosis-differential-point-text {
  display: block;
  overflow-wrap: anywhere;
}
.diagnosis-differential-keyword {
  margin: 0;
  padding: 0;
  background: transparent;
  color: #8a4b08;
  font-weight: 700;
}
.diagnosis-differential-panel.is-risk .diagnosis-differential-keyword {
  color: #9a3412;
}

.diagnosis-differential-panel-footer {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--voice-border);
}
.diagnosis-differential-confirm {
  min-height: 28px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--voice-accent-strong);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.diagnosis-differential-confirm:hover { text-decoration: underline; }
.diagnosis-differential-confirm:focus-visible {
  border-radius: 4px;
  outline: 2px solid var(--voice-accent-soft);
  outline-offset: 2px;
}

.card-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  position: relative;
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

.inline-arrow-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 999px;
  background: transparent;
  padding: 0;
  color: var(--voice-text-muted);
  cursor: pointer;
}

.inline-arrow-btn:hover {
  color: var(--voice-accent);
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

.related-section {
  margin-top: 10px;
}

.related-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.related-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--voice-border);
  border-radius: 999px;
  background: var(--voice-surface);
  color: var(--voice-text);
  font-size: var(--voice-font-min);
  cursor: pointer;
}

.related-item:hover {
  border-color: var(--voice-accent);
  color: var(--voice-accent);
}

.related-code {
  color: var(--voice-text-muted);
}

@media (max-width: 900px) {
  .card-row {
    flex-direction: column;
    align-items: stretch;
  }

  .card-title-line {
    flex-wrap: wrap;
  }

  .diagnosis-title-line {
    grid-template-columns: minmax(0, 1fr);
  }

  .diagnosis-meta-row {
    max-width: none;
    justify-self: stretch;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .voice-feedback-panel {
    left: 0;
    right: auto;
  }
}

.diagnosis-original-name {
  margin-top: 4px;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.3;
}
</style>
