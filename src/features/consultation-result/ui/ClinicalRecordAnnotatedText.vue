<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import {
  applyClinicalRecordSuggestionEdit,
  buildClinicalRecordAnnotationSegments,
  type ClinicalRecordExplicitFact,
  type ClinicalRecordAnnotationSuggestionSegment,
  type ClinicalRecordFactSuggestion,
} from '@features/clinical-result';

const props = defineProps<{
  modelValue: string;
  readonly?: boolean;
  title: string;
  placeholder: string;
  emptyText?: string;
  facts: ClinicalRecordExplicitFact[];
  suggestions: ClinicalRecordFactSuggestion[];
  commitOnBlur?: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: string): void;
  (event: 'dismiss-suggestion', id: string): void;
}>();

const annotationRootRef = ref<HTMLElement | null>(null);
const editableContentRef = ref<HTMLElement | null>(null);
const editing = ref(false);
let draftEdited = false;
const editingSuggestionId = ref('');
const activeAnnotationKey = ref('');
const copiedText = ref('');
const popoverPosition = reactive({ top: 0, left: 0 });
const selectionCopy = reactive({ text: '', top: 0, left: 0 });
const suggestionDrafts = reactive<Record<string, string>>({});
let copyFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

const pendingSuggestions = computed(() => props.suggestions.filter((item) => item.status === 'pending'));
const segments = computed(() => buildClinicalRecordAnnotationSegments(props.modelValue, props.facts, pendingSuggestions.value));

function sourceLabel(fact: ClinicalRecordExplicitFact): string {
  if (fact.source === 'template-context') return '根据上下文修正';
  if (fact.source === 'structured-answer') return '结构化问诊已明确';
  return '问诊中已明确';
}

function readEditableText(element: HTMLElement): string {
  return element.innerText.replace(/\u00a0/g, ' ').replace(/\n+$/u, '');
}

function syncEditableContent(): void {
  const element = editableContentRef.value;
  if (!element || document.activeElement === element) return;
  if (element.innerText !== props.modelValue) element.textContent = props.modelValue || '';
}

async function startEditing(event: Event): Promise<void> {
  // A popover action can remove its own DOM before the click reaches the paragraph.
  if (event.target instanceof Element && event.target.closest('button, textarea, .clinical-record-popover')) return;
  if (props.readonly || window.getSelection()?.toString().trim() || selectionCopy.text) return;
  activeAnnotationKey.value = '';
  draftEdited = false;
  editing.value = true;
  await nextTick();
  syncEditableContent();
  editableContentRef.value?.focus();
}

function handleDocumentInput(event: Event): void {
  if (props.readonly) return;
  draftEdited = true;
  if (props.commitOnBlur) return;
  const target = event.target as HTMLElement | null;
  emit('update:modelValue', target ? readEditableText(target) : '');
}

function finishEditing(): void {
  if (draftEdited && editing.value && props.commitOnBlur && !props.readonly && editableContentRef.value) {
    const text = readEditableText(editableContentRef.value);
    if (text !== props.modelValue) emit('update:modelValue', text);
  }
  editing.value = false;
}

function positionPopover(event: MouseEvent, expectedWidth = 360, expectedHeight = 340): void {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return;
  const rect = target.getBoundingClientRect();
  popoverPosition.left = Math.max(12, Math.min(rect.left, window.innerWidth - expectedWidth - 12));
  popoverPosition.top = rect.bottom + 7 + expectedHeight > window.innerHeight
    ? Math.max(12, rect.top - expectedHeight - 7)
    : rect.bottom + 7;
}

function toggleFact(id: string, event: MouseEvent): void {
  positionPopover(event, 280, 230);
  const key = `fact:${id}`;
  activeAnnotationKey.value = activeAnnotationKey.value === key ? '' : key;
  selectionCopy.text = '';
}

function toggleSuggestion(id: string, text: string, event: MouseEvent): void {
  positionPopover(event, 330, 240);
  const key = `suggestion:${id}`;
  activeAnnotationKey.value = activeAnnotationKey.value === key ? '' : key;
  editingSuggestionId.value = '';
  suggestionDrafts[id] = text;
  selectionCopy.text = '';
}

function closeAnnotationPopover(): void {
  activeAnnotationKey.value = '';
  editingSuggestionId.value = '';
}

function startSuggestionEdit(segment: ClinicalRecordAnnotationSuggestionSegment): void {
  suggestionDrafts[segment.suggestion.id] = segment.text;
  editingSuggestionId.value = segment.suggestion.id;
}

function cancelSuggestionEdit(segment: ClinicalRecordAnnotationSuggestionSegment): void {
  suggestionDrafts[segment.suggestion.id] = segment.text;
  editingSuggestionId.value = '';
}

function applySuggestionEdit(segment: ClinicalRecordAnnotationSuggestionSegment): void {
  const nextText = suggestionDrafts[segment.suggestion.id]?.trim() || '';
  if (!nextText) return;
  emit('update:modelValue', applyClinicalRecordSuggestionEdit(props.modelValue, segment, nextText));
  emit('dismiss-suggestion', segment.suggestion.id);
  closeAnnotationPopover();
}

function removeSuggestion(segment: ClinicalRecordAnnotationSuggestionSegment): void {
  const nextValue = applyClinicalRecordSuggestionEdit(props.modelValue, segment, '');
  if (nextValue !== props.modelValue) emit('update:modelValue', nextValue);
  emit('dismiss-suggestion', segment.suggestion.id);
  closeAnnotationPopover();
}

function clearCopyFeedback(): void {
  if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
  copyFeedbackTimer = undefined;
  copiedText.value = '';
}

function showCopyFeedback(value: string): void {
  clearCopyFeedback();
  copiedText.value = value;
  copyFeedbackTimer = setTimeout(() => {
    copiedText.value = '';
    copyFeedbackTimer = undefined;
  }, 1200);
}

async function copyText(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('copy command failed');
    }
    showCopyFeedback(text);
    return true;
  } catch (error) {
    console.warn('[ClinicalRecordAnnotatedText] 复制失败', error);
    return false;
  }
}

async function copySuggestionText(segment: ClinicalRecordAnnotationSuggestionSegment): Promise<void> {
  if (!(await copyText(segment.text))) return;
  closeAnnotationPopover();
  clearCopyFeedback();
}

function clearSelectionCopy(): void {
  selectionCopy.text = '';
}

function handleTextSelection(event: MouseEvent | KeyboardEvent): void {
  const root = annotationRootRef.value;
  const selection = window.getSelection();
  if (!root || !selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearSelectionCopy();
    return;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    clearSelectionCopy();
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.closest('.clinical-record-popover, .clinical-record-selection-copy')) return;
  const text = selection.toString().trim();
  if (!text) {
    clearSelectionCopy();
    return;
  }
  const rect = range.getBoundingClientRect();
  const fallbackX = event instanceof MouseEvent ? event.clientX : rect.left;
  const fallbackY = event instanceof MouseEvent ? event.clientY : rect.bottom;
  const centerX = rect.width > 0 ? rect.left + rect.width / 2 : fallbackX;
  const anchorTop = rect.height > 0 ? rect.top : fallbackY;
  const anchorBottom = rect.height > 0 ? rect.bottom : fallbackY;
  const expectedWidth = 82;
  selectionCopy.text = text;
  selectionCopy.left = Math.max(12, Math.min(centerX - expectedWidth / 2, window.innerWidth - expectedWidth - 12));
  selectionCopy.top = anchorTop >= 48 ? anchorTop - 42 : anchorBottom + 8;
  activeAnnotationKey.value = '';
}

async function copySelectedText(): Promise<void> {
  await copyText(selectionCopy.text);
}

function closeOnOutside(event: MouseEvent): void {
  const target = event.target as Node | null;
  if (target && annotationRootRef.value?.contains(target)) return;
  activeAnnotationKey.value = '';
  clearSelectionCopy();
}

function closeTransientLayers(): void {
  activeAnnotationKey.value = '';
  clearSelectionCopy();
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeTransientLayers();
}

onMounted(() => {
  document.addEventListener('mousedown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
  document.addEventListener('scroll', closeTransientLayers, true);
  window.addEventListener('resize', closeTransientLayers);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
  document.removeEventListener('scroll', closeTransientLayers, true);
  window.removeEventListener('resize', closeTransientLayers);
  clearCopyFeedback();
});
watch(() => props.readonly, (locked) => {
  if (locked) {
    finishEditing();
    closeAnnotationPopover();
  }
});
watch(() => props.modelValue, () => void nextTick(syncEditableContent));
</script>

<template>
  <div ref="annotationRootRef" class="clinical-record-annotated-text">
    <p v-if="editing && !readonly" class="clinical-record-line is-editing">
      <label>{{ title }}：</label>
      <span
        ref="editableContentRef"
        class="clinical-record-editable"
        contenteditable="plaintext-only"
        role="textbox"
        :aria-label="title"
        :data-placeholder="placeholder"
        @input="handleDocumentInput"
        @blur="finishEditing"
      ></span>
    </p>

    <p
      v-else
      class="clinical-record-line"
      :aria-label="readonly ? `${title}，只读` : `${title}，点击正文可编辑，选择文字可快速复制，点击 AI 标记可查看核查参考`"
      :tabindex="readonly ? undefined : 0"
      @keydown.enter.self.prevent="startEditing"
      @click="startEditing"
      @mouseup="handleTextSelection"
      @keyup="handleTextSelection"
    >
      <label>{{ title }}：</label>
      <template v-if="segments.length">
        <template v-for="(segment, index) in segments" :key="`${segment.kind}-${index}-${segment.text}`">
          <span v-if="segment.kind === 'text'">{{ segment.text }}</span>
          <span v-else-if="segment.kind === 'fact'" class="clinical-record-annotation-anchor">
            <button
              type="button"
              class="clinical-record-annotation"
              :class="[
                `is-${segment.fact.polarity}`,
                `is-${segment.fact.source}`,
              ]"
              :aria-label="`${segment.text}，${sourceLabel(segment.fact)}，${segment.fact.polarity === 'positive' ? '阳性指标' : '阴性事实'}`"
              @click.stop="toggleFact(segment.fact.id, $event)"
            >
              <span class="clinical-record-annotation-sign" aria-hidden="true">
                {{ segment.fact.polarity === 'positive' ? '+' : '−' }}
              </span>
              {{ segment.text }}
            </button>
            <span
              v-if="activeAnnotationKey === `fact:${segment.fact.id}`"
              class="clinical-record-popover is-fact"
              role="dialog"
              aria-label="病历事实来源"
              :style="{ top: `${popoverPosition.top}px`, left: `${popoverPosition.left}px` }"
              @click.stop
            >
              <span class="clinical-record-popover-header">
                <strong>{{ sourceLabel(segment.fact) }}</strong>
                <button type="button" class="clinical-record-popover-close" aria-label="关闭事实说明" @click="closeAnnotationPopover">×</button>
              </span>
              <span class="clinical-record-popover-tags">
                <span>{{ segment.fact.polarity === 'positive' ? '阳性指标' : '阴性事实' }}</span>
              </span>
              <span>{{ readonly ? '该内容已属于正式病历。' : '该内容已属于正式病历，点击正文空白处可继续编辑。' }}</span>
              <button type="button" class="clinical-record-copy-button" @click="copyText(segment.text)">
                {{ copiedText === segment.text.trim() ? '已复制' : '复制此段' }}
              </button>
            </span>
          </span>
          <span v-else class="clinical-record-annotation-anchor">
            <button
              type="button"
              class="clinical-record-annotation is-suggestion"
              :class="{ 'is-critical': segment.suggestion.priority === 'critical' }"
              :data-clinical-fact-id="segment.suggestion.id"
              :aria-label="`${segment.text}，AI 补充建议，${segment.suggestion.priority === 'critical' ? '重点提示' : '一般提示'}，已在病历正文${readonly ? '' : '，会随所选字段回写'}，点击查看核查参考`"
              @click.stop="toggleSuggestion(segment.suggestion.id, segment.text, $event)"
            >
              <span class="clinical-record-annotation-sign" aria-hidden="true">AI</span>
              {{ segment.text }}
            </button>
            <span
              v-if="activeAnnotationKey === `suggestion:${segment.suggestion.id}`"
              class="clinical-record-popover is-suggestion-detail"
              role="dialog"
              aria-label="AI 核查"
              :style="{ top: `${popoverPosition.top}px`, left: `${popoverPosition.left}px` }"
              @click.stop
            >
              <span class="clinical-record-popover-header">
                <strong>AI 核查</strong>
                <button type="button" class="clinical-record-popover-close" aria-label="关闭 AI 核查" @click="closeAnnotationPopover">×</button>
              </span>
              <textarea
                v-if="editingSuggestionId === segment.suggestion.id"
                v-model="suggestionDrafts[segment.suggestion.id]"
                class="clinical-record-suggestion-editor"
                rows="3"
                aria-label="调整 AI 病历表述"
                @click.stop
              ></textarea>
              <span v-else class="clinical-record-suggestion-text">{{ segment.text }}</span>
              <span class="clinical-record-popover-line">
                <strong>核查</strong>
                <span>{{ segment.suggestion.question }}</span>
              </span>
              <span v-if="segment.suggestion.rationale" class="clinical-record-popover-line is-muted">
                <strong>依据</strong>
                <span>{{ segment.suggestion.rationale }}</span>
              </span>
              <span v-if="!readonly" class="clinical-record-writeback-state is-included">
                已在病历正文中，将随当前所选病历字段回写；如不准确请调整或移除。
              </span>
              <span class="clinical-record-popover-actions">
                <template v-if="editingSuggestionId === segment.suggestion.id">
                  <button type="button" class="clinical-record-text-button" @click="cancelSuggestionEdit(segment)">取消</button>
                  <button
                    type="button"
                    class="clinical-record-copy-button"
                    :disabled="!suggestionDrafts[segment.suggestion.id]?.trim()"
                    @click="applySuggestionEdit(segment)"
                  >应用</button>
                </template>
                <template v-else>
                  <button v-if="!readonly" type="button" class="clinical-record-text-button is-danger" @click="removeSuggestion(segment)">移除</button>
                  <button v-if="!readonly" type="button" class="clinical-record-text-button" @click="startSuggestionEdit(segment)">调整</button>
                  <button type="button" class="clinical-record-copy-button" @click="copySuggestionText(segment)">
                    {{ copiedText === segment.text.trim() ? '已复制' : '复制' }}
                  </button>
                </template>
              </span>
            </span>
          </span>
        </template>
      </template>
      <span v-else class="clinical-record-placeholder">{{ emptyText ?? (readonly ? '未记录' : '未记录（点击补充）') }}</span>
    </p>
    <span
      v-if="selectionCopy.text && !editing"
      class="clinical-record-selection-copy"
      role="toolbar"
      aria-label="选中文本操作"
      :style="{ top: `${selectionCopy.top}px`, left: `${selectionCopy.left}px` }"
      @mousedown.prevent
      @click.stop
    >
      <button type="button" @click="copySelectedText">
        {{ copiedText === selectionCopy.text.trim() ? '已复制' : '复制' }}
      </button>
    </span>
  </div>
</template>

<style scoped>
.clinical-record-annotated-text { position: relative; }
.clinical-record-line { margin: 0; color: var(--voice-text); font-size: 15px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; cursor: text; }
.clinical-record-line label { display: inline; color: inherit; font-size: inherit; font-weight: 700; }
.clinical-record-placeholder { color: var(--voice-text-disabled); border-bottom: 1px dashed rgba(100, 116, 139, .32); }
.clinical-record-editable { display: inline; min-width: 2em; margin: 0 -3px; padding: 1px 3px; border: 0; border-radius: 3px; outline: none; white-space: pre-wrap; word-break: break-word; }
.clinical-record-editable:empty::before { content: attr(data-placeholder); color: var(--voice-text-disabled); }
.clinical-record-editable:focus { background: rgba(15, 143, 123, .045); box-shadow: inset 0 -1px 0 rgba(15, 143, 123, .22); }
.clinical-record-annotation-anchor { position: relative; display: inline; }
.clinical-record-annotation { display: inline; margin: 0; padding: 0 1px; border: 0; border-radius: 2px; background: transparent; color: inherit; font: inherit; line-height: inherit; text-align: left; white-space: normal; vertical-align: baseline; cursor: pointer; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.clinical-record-annotation-sign { display: inline-flex; align-items: center; justify-content: center; min-width: 11px; height: 12px; margin-right: 1px; border-radius: 2px; background: transparent; font-size: 9px; font-weight: 800; line-height: 1; vertical-align: 1px; }
.clinical-record-annotation.is-positive { background: rgba(225, 139, 20, .055); box-shadow: inset 0 -1px 0 rgba(225, 139, 20, .52); }
.clinical-record-annotation.is-positive .clinical-record-annotation-sign { color: #a75b00; }
.clinical-record-annotation.is-negative { background: rgba(15, 143, 123, .035); box-shadow: inset 0 -1px 0 rgba(15, 143, 123, .4); }
.clinical-record-annotation.is-negative .clinical-record-annotation-sign { color: var(--voice-accent-strong); }
.clinical-record-annotation.is-suggestion { padding: 0 1px; border-bottom: 1px dashed rgba(44, 119, 180, .72); border-radius: 0; background: rgba(44, 119, 180, .035); color: #285f8f; }
.clinical-record-annotation.is-suggestion { cursor: pointer; }
.clinical-record-annotation.is-suggestion .clinical-record-annotation-sign { min-width: 17px; color: #285f8f; }
.clinical-record-annotation.is-suggestion.is-critical { border-color: rgba(197, 48, 48, .75); background: rgba(197, 48, 48, .035); color: #9f2929; }
.clinical-record-annotation.is-suggestion.is-critical .clinical-record-annotation-sign { min-width: 17px; color: #b52f2f; }
.clinical-record-annotation:focus-visible { outline: 2px solid var(--voice-accent); outline-offset: 2px; }
.clinical-record-popover { position: fixed; z-index: 120; width: min(330px, calc(100vw - 24px)); max-height: calc(100vh - 24px); overflow-y: auto; padding: 12px; border: 1px solid var(--voice-border); border-radius: 11px; background: var(--voice-surface); color: var(--voice-text); box-shadow: 0 12px 30px rgba(15, 23, 42, .16); font-size: 13px; line-height: 1.55; white-space: normal; cursor: default; }
.clinical-record-popover, .clinical-record-popover-header, .clinical-record-popover-tags, .clinical-record-popover-line { display: flex; }
.clinical-record-popover { flex-direction: column; gap: 8px; }
.clinical-record-popover-header { align-items: center; justify-content: space-between; gap: 12px; }
.clinical-record-popover-header strong { font-size: 14px; }
.clinical-record-popover-close { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--voice-text-secondary); font: inherit; font-size: 20px; line-height: 1; cursor: pointer; }
.clinical-record-popover-close:hover { background: var(--voice-hover-bg, rgba(100, 116, 139, .09)); color: var(--voice-text); }
.clinical-record-popover-tags { flex-wrap: wrap; gap: 6px; }
.clinical-record-popover-tags > span { padding: 2px 7px; border-radius: 999px; background: var(--voice-accent-soft); color: var(--voice-accent-strong); font-size: 11px; white-space: nowrap; }
.clinical-record-popover-line { align-items: flex-start; gap: 8px; }
.clinical-record-popover-line > strong { flex: 0 0 auto; color: var(--voice-text-secondary); font-size: 12px; font-weight: 600; }
.clinical-record-popover-line.is-muted > span { color: var(--voice-text-secondary); }
.clinical-record-suggestion-text { padding-left: 9px; border-left: 3px solid currentColor; color: inherit; font-weight: 600; }
.clinical-record-suggestion-editor { width: 100%; min-height: 72px; padding: 8px 9px; border: 1px solid var(--voice-accent); border-radius: 7px; background: var(--voice-surface); color: var(--voice-text); font: inherit; line-height: 1.55; resize: vertical; outline: none; box-sizing: border-box; }
.clinical-record-suggestion-editor:focus { box-shadow: 0 0 0 3px var(--voice-accent-soft); }
.clinical-record-writeback-state { padding: 7px 9px; border-radius: 7px; background: var(--voice-hover-bg, rgba(100, 116, 139, .08)); color: var(--voice-text-secondary); font-size: 12px; line-height: 1.5; }
.clinical-record-writeback-state.is-included { background: var(--voice-accent-soft); color: var(--voice-accent-strong); }
.clinical-record-popover-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.clinical-record-copy-button { align-self: flex-end; min-width: 76px; min-height: 30px; padding: 5px 11px; border: 1px solid var(--voice-accent); border-radius: 7px; background: transparent; color: var(--voice-accent-strong); font: inherit; font-size: 12px; cursor: pointer; }
.clinical-record-copy-button:hover { background: var(--voice-accent-soft); }
.clinical-record-copy-button:disabled { cursor: not-allowed; opacity: .45; }
.clinical-record-text-button { min-height: 30px; padding: 5px 9px; border: 0; border-radius: 7px; background: transparent; color: var(--voice-text-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.clinical-record-text-button:hover { background: var(--voice-hover-bg, rgba(100, 116, 139, .09)); color: var(--voice-text); }
.clinical-record-text-button.is-danger { color: var(--voice-danger, #c53030); }
.clinical-record-popover.is-fact { width: min(280px, calc(100vw - 24px)); }
.clinical-record-selection-copy { position: fixed; z-index: 130; display: inline-flex; padding: 3px; border: 1px solid var(--voice-border); border-radius: 8px; background: var(--voice-surface); box-shadow: 0 8px 22px rgba(15, 23, 42, .18); }
.clinical-record-selection-copy button { min-width: 74px; min-height: 30px; padding: 4px 12px; border: 0; border-radius: 6px; background: var(--voice-accent); color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.clinical-record-selection-copy button:hover { filter: brightness(.97); }
@media (max-width: 720px) { .clinical-record-popover { top: auto !important; right: 16px; bottom: 16px; left: 16px !important; width: auto; } }
</style>
