<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { applyOutpatientEmrHeaderValues } from '../lib/outpatientEmrHeader';
import {
  applyOutpatientEmrFieldSource,
  buildEditableOutpatientEmrPreviewHtml,
  readEditableOutpatientEmrField,
} from '../lib/outpatientEmrTemplate';
import type {
  OutpatientEmrFieldValueSource,
  OutpatientEmrTemplateField,
} from '../types';

const props = withDefaults(defineProps<{
  sanitizedHtml: string;
  fields: OutpatientEmrTemplateField[];
  visibilityFields?: OutpatientEmrTemplateField[];
  fieldValues: Record<string, string>;
  fieldSources?: Record<string, OutpatientEmrFieldValueSource>;
  conflictFieldIds?: ReadonlySet<string>;
  editable?: boolean;
  readonlyHint?: string;
  headerValues?: Readonly<Record<string, string>>;
}>(), {
  fieldSources: () => ({}),
  conflictFieldIds: () => new Set<string>(),
  editable: true,
  readonlyHint: '当前参数已发送，等待 HIS 回执',
  headerValues: () => ({}),
});

const emit = defineEmits<{
  'update-field': [fieldId: string, value: string];
}>();

const previewRoot = ref<HTMLElement | null>(null);
const hasTemplateDraft = computed(() => (
  Object.values(props.fieldSources).some((source) => source === 'template' || source === 'template-matched')
));

const hasUnmentionedDefault = computed(() => Object.values(props.fieldSources).includes('unmentioned-default'));

function renderPreview(): void {
  if (!previewRoot.value) return;
  previewRoot.value.innerHTML = buildEditableOutpatientEmrPreviewHtml(
    props.sanitizedHtml,
    props.fields,
    props.fieldValues,
    props.editable,
    props.fieldSources,
    props.conflictFieldIds,
    props.visibilityFields ?? props.fields,
  );
  applyOutpatientEmrHeaderValues(previewRoot.value, props.headerValues);
}

function syncDictionaryLabel(select: HTMLSelectElement): void {
  const label = select.nextElementSibling;
  if (!label) return;
  label.textContent = select.value ? select.selectedOptions.item(0)?.text || '' : select.dataset.placeholder || '';
  label.classList.toggle('placeholder', !select.value);
}

function syncValuesToPreview(): void {
  const root = previewRoot.value;
  if (!root) return;
  root.querySelectorAll<HTMLElement>('[data-outpatient-emr-field-id]').forEach((element) => {
    const fieldId = element.getAttribute('data-outpatient-emr-field-id') || '';
    applyOutpatientEmrFieldSource(
      element,
      props.fieldSources[fieldId],
      props.conflictFieldIds.has(fieldId),
    );
    if (!Object.prototype.hasOwnProperty.call(props.fieldValues, fieldId)) return;
    if (element instanceof HTMLSelectElement) {
      if (element.value !== props.fieldValues[fieldId]) {
        element.value = props.fieldValues[fieldId];
      }
      syncDictionaryLabel(element);
      return;
    }
    if (element.textContent !== props.fieldValues[fieldId] || (!element.textContent && element.childElementCount)) {
      element.textContent = props.fieldValues[fieldId];
    }
  });
}

function emitEditedField(eventTarget: EventTarget | null): void {
  const root = previewRoot.value;
  if (!root || !props.editable) return;
  const edited = readEditableOutpatientEmrField(eventTarget, root);
  if (edited) emit('update-field', edited.fieldId, edited.value);
}

function handleInput(event: Event): void {
  if (event.target instanceof HTMLSelectElement) return;
  // WebViews can leave a solitary <br> after the last character is deleted.
  if (event.target instanceof HTMLElement && event.target.isContentEditable && !event.target.textContent) {
    event.target.replaceChildren();
  }
  emitEditedField(event.target);
}

function handleChange(event: Event): void {
  if (!(event.target instanceof HTMLSelectElement)) return;
  syncDictionaryLabel(event.target);
  emitEditedField(event.target);
}

function handlePaste(event: ClipboardEvent): void {
  if (!props.editable || !event.clipboardData) return;
  const root = previewRoot.value;
  const edited = root ? readEditableOutpatientEmrField(event.target, root) : null;
  if (!root || !edited) return;

  event.preventDefault();
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!(event.target instanceof Element) || !event.target.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const textNode = document.createTextNode(event.clipboardData.getData('text/plain'));
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  emitEditedField(event.target);
}

onMounted(renderPreview);

watch(
  () => [
    props.sanitizedHtml,
    props.editable,
    (props.visibilityFields ?? props.fields).map(field => `${field.id}:${field.visible}`).join('|'),
    props.fields.map((field) => (
      `${field.id}:${field.type}:${field.dictionaryItems.map((item) => `${item.value}=${item.text}`).join(',')}`
    )).join('|'),
  ],
  () => void nextTick(renderPreview),
);
watch(() => props.headerValues, () => {
  if (previewRoot.value) applyOutpatientEmrHeaderValues(previewRoot.value, props.headerValues);
}, { deep: true });

watch(
  () => [props.fieldValues, props.fieldSources, Array.from(props.conflictFieldIds).join('|')],
  () => void nextTick(syncValuesToPreview),
  { deep: true },
);
</script>

<template>
  <section class="template-preview" aria-label="门诊病历模板预览">
    <div v-if="editable || readonlyHint" class="preview-hint">
      <span class="editable-dot"></span>
      <span>{{ editable ? '点击字段可编辑，按 Tab 切换字段。' : readonlyHint }}</span>
      <span v-if="hasUnmentionedDefault">点线下划线表示本次未提及，按默认值填写。</span>
      <template v-if="editable && hasTemplateDraft">
        <span class="template-dot"></span>
        <span>橙色为模板预置内容（虚线未经本次病例核对，实线为模型判定一致），请核对</span>
      </template>
    </div>
    <div class="template-paper-area">
      <div
        ref="previewRoot"
        class="template-document"
        @input="handleInput"
        @change="handleChange"
        @paste="handlePaste"
      ></div>
    </div>
  </section>
</template>

<style scoped>
.template-preview {
  display: grid;
  min-width: 0;
  min-height: 0;
  gap: 10px;
}

.preview-hint {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  color: #64748b;
  font-size: 12px;
}

.template-dot {
  width: 8px;
  height: 8px;
  margin-left: 8px;
  border-radius: 999px;
  background: #d97706;
}

.editable-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #3b82f6;
}

.template-paper-area {
  min-width: 0;
  overflow: auto;
  padding: 8px clamp(0px, 2%, 16px) 16px;
  background: #f1f4f6;
}

.template-document {
  box-sizing: border-box;
  width: min(100%, 560px);
  min-height: 360px;
  aspect-ratio: 560 / 756;
  margin: 0 auto;
  padding: clamp(16px, 6%, 38px);
  color: #161616;
  background: white;
  box-shadow: 0 1px 4px rgb(15 23 42 / 18%);
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  color-scheme: light;
}

.template-document :deep(table) {
  max-width: 100%;
  border-collapse: collapse;
}

.template-document :deep(header.tag-article > table),
.template-document :deep(table.tag-article) {
  width: 100%;
  max-width: 100%;
}

.template-document :deep(header.tag-article > table:first-of-type td) {
  text-align: center;
  line-height: 1.5;
}

.template-document :deep(header.tag-article > table:has(> colgroup):has([data-id='页眉姓名']) tr) {
  height: 32px;
}

.template-document :deep(header.tag-article > table:has(> colgroup):has([data-id='页眉姓名']) td) {
  vertical-align: middle;
}

.template-document :deep(header.tag-article hr) {
  margin: 6px 0;
  border: 0;
  border-top: 1px solid #999;
}

.template-document :deep(header.tag-article .tag-filed[data-readonly='true'] > .tag-marker) {
  color: #c41d1d;
}

.template-document :deep(p.tag-article) {
  margin: 0;
}

.template-document :deep(.tag-article-title) {
  border-inline-start: 2px solid #3782dc;
  padding-inline-start: 3px;
  font-weight: 700;
}

/* Wrap an inline HIS dictionary as a unit, including its opening and closing markers. */
.template-document :deep(span.tag-filed:is([data-type='select' i], [data-type='radio' i], [data-type='checkbox' i]):not([hidden])) {
  display: inline-flex;
  max-width: 100%;
  align-items: baseline;
  vertical-align: baseline;
}

.template-document :deep(.tag-filed[data-type='select'] > .tag-marker:last-child) {
  position: relative;
}

.template-document :deep(.tag-filed[data-type='select'] > .tag-marker:last-child::after) {
  position: absolute;
  right: 0;
  bottom: -2px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #b7312d;
  content: '';
  pointer-events: none;
}

.template-document :deep(.placeholder),
.template-document :deep([data-outpatient-emr-placeholder]:empty::before) {
  color: #767676;
}

.template-document :deep([data-outpatient-emr-placeholder]:empty::before) {
  content: attr(data-outpatient-emr-placeholder);
  pointer-events: none;
}

.template-document :deep([data-outpatient-emr-field-id]) {
  border-radius: 2px;
  white-space: pre-wrap;
}

.template-document :deep([contenteditable='true']:hover),
.template-document :deep(.outpatient-emr-dictionary-select:enabled:hover + span) {
  background: #eff6ff;
}

.template-document :deep([contenteditable='true']:focus),
.template-document :deep(.outpatient-emr-dictionary-select:focus + span) {
  outline: 2px solid #2563eb;
  outline-offset: 1px;
}

.template-document :deep([data-outpatient-emr-source='template']) {
  text-decoration: underline dashed #b45309;
  text-underline-offset: 3px;
}

.template-document :deep([data-outpatient-emr-source='unmentioned-default']),
.template-document :deep(.outpatient-emr-dictionary-select[data-outpatient-emr-source='unmentioned-default'] + span) {
  text-decoration: underline dotted #b45309;
  text-underline-offset: 3px;
}

.template-document :deep([data-outpatient-emr-source='template-matched']) {
  text-decoration: underline solid #b45309;
  text-underline-offset: 3px;
}

.template-document :deep([data-outpatient-emr-issue='conflict']),
.template-document :deep(.outpatient-emr-dictionary-select[data-outpatient-emr-issue='conflict'] + span) {
  outline: 2px solid #dc2626;
  background: #fef2f2;
}

/* Let the current word size the native selector even in WebView2 109. */
.template-document :deep(.outpatient-emr-dictionary) {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: baseline;
}

.template-document :deep(.outpatient-emr-dictionary-select) {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  margin: 0;
  padding: 0;
  opacity: 0;
  font: inherit;
  cursor: pointer;
}

.template-document :deep(.outpatient-emr-dictionary-select:disabled) {
  cursor: default;
}
</style>
