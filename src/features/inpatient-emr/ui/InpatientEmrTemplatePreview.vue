<script setup lang="ts">
import { computed, onMounted, shallowRef, watch } from 'vue';
import { buildEditableInpatientEmrPreviewHtml } from '../lib/inpatientEmrTemplate';
import type { InpatientEmrTemplateField } from '../types';

const props = withDefaults(defineProps<{
  htmlContent: string;
  fields: InpatientEmrTemplateField[];
  fieldValues: Record<string, string>;
  initialFieldValues: Record<string, string>;
  editable: boolean;
  isGenerating?: boolean;
}>(), { isGenerating: false });

const emit = defineEmits<{
  'update-field': [fieldId: string, value: string];
}>();

const previewRoot = shallowRef<HTMLElement | null>(null);
const fieldsById = computed(() => new Map(props.fields.map((field) => [field.id, field])));
const canEdit = computed(() => props.editable && !props.isGenerating);

function fieldValue(field: InpatientEmrTemplateField): string {
  return props.fieldValues[field.id] ?? '';
}

function isEdited(field: InpatientEmrTemplateField): boolean {
  return Object.prototype.hasOwnProperty.call(props.initialFieldValues, field.id)
    && fieldValue(field) !== props.initialFieldValues[field.id];
}

function renderPreview(): void {
  const root = previewRoot.value;
  if (!root) return;
  root.innerHTML = buildEditableInpatientEmrPreviewHtml(
    props.htmlContent, props.fieldValues, props.fields, false,
  );
  // External template editability must never extend beyond recognized AI fields.
  root.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
    element.setAttribute('contenteditable', 'false');
  });
  syncPreview();
}

function syncPreview(): void {
  const root = previewRoot.value;
  if (!root) return;
  root.querySelectorAll<HTMLElement>('[data-inpatient-emr-field-id]').forEach((element) => {
    const field = fieldsById.value.get(element.getAttribute('data-inpatient-emr-field-id') || '');
    const editable = Boolean(field?.aiSuitable && canEdit.value);
    element.setAttribute('contenteditable', String(editable));
    element.classList.toggle('is-editable', editable);
    element.classList.remove('inpatient-emr-field--generating');
    if (!field) return;
    if (field.aiSuitable || Object.prototype.hasOwnProperty.call(props.fieldValues, field.id)) {
      const value = fieldValue(field);
      if (readText(element) !== value) element.textContent = value;
    }
    if (field.aiSuitable) {
      element.setAttribute('role', 'textbox');
      element.setAttribute('aria-label', field.name || field.id);
      element.setAttribute('aria-multiline', 'true');
      element.setAttribute('aria-readonly', String(!editable));
      element.setAttribute('spellcheck', 'false');
      element.setAttribute('tabindex', '0');
      element.setAttribute('data-placeholder', editable ? '未记录，点击补充…' : '未记录');
      element.setAttribute('data-field-state', isEdited(field) ? 'edited' : 'ai');
    }
  });
}

function readText(element: HTMLElement): string {
  return (element.innerText ?? element.textContent ?? '').replace(/\r\n?/g, '\n');
}

function editableField(target: EventTarget | null): HTMLElement | null {
  if (!canEdit.value || !(target instanceof Element)) return null;
  const element = target.closest<HTMLElement>('[data-inpatient-emr-field-id]');
  if (!element || !previewRoot.value?.contains(element)) return null;
  const field = fieldsById.value.get(element.getAttribute('data-inpatient-emr-field-id') || '');
  return field?.aiSuitable && element.getAttribute('contenteditable') === 'true' ? element : null;
}

function selectionWithinField(element: HTMLElement, range: Range): boolean {
  return element.contains(range.startContainer) && element.contains(range.endContainer);
}

function handleBeforeInput(event: InputEvent): void {
  const element = editableField(event.target);
  const selection = window.getSelection();
  if (!element || (selection?.rangeCount && !selectionWithinField(element, selection.getRangeAt(0)))) {
    event.preventDefault();
  }
}

function handleInput(event: Event): void {
  const element = editableField(event.target);
  if (!element) {
    syncPreview();
    return;
  }
  emit('update-field', element.getAttribute('data-inpatient-emr-field-id')!, readText(element));
}

function handlePaste(event: ClipboardEvent): void {
  event.preventDefault();
  const element = editableField(event.target);
  const selection = window.getSelection();
  if (!element || !event.clipboardData || !selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (!selectionWithinField(element, range)) return;
  range.deleteContents();
  const text = document.createTextNode(event.clipboardData.getData('text/plain'));
  range.insertNode(text);
  range.setStartAfter(text);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  emit('update-field', element.getAttribute('data-inpatient-emr-field-id')!, readText(element));
}

onMounted(renderPreview);
watch(
  () => [props.htmlContent, props.fields.map((field) => `${field.id}:${field.name}:${field.aiSuitable}`).join('|')],
  renderPreview,
  { flush: 'post' },
);
watch(
  () => [props.fieldValues, props.initialFieldValues, canEdit.value],
  syncPreview,
  { deep: true, flush: 'post' },
);
</script>

<template>
  <div
    ref="previewRoot"
    class="html-preview"
    role="region"
    aria-label="住院病历原始模板"
    :aria-busy="isGenerating"
    contenteditable="false"
    @beforeinput="handleBeforeInput"
    @input="handleInput"
    @paste="handlePaste"
    @drop.prevent
  ></div>
</template>

<style scoped>
.html-preview { flex: 1 0 auto; min-width: 0; min-height: 360px; overflow-x: auto; padding: 24px 28px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; color: #1f2937; font-size: 15px; line-height: 1.75; overflow-wrap: anywhere; }
.html-preview :deep(.inpatient-emr-field--ai) { min-width: 2em; padding: 1px 3px; border-radius: 3px; outline: 1px dashed #60a5fa; outline-offset: 1px; background: #eff6ff; white-space: pre-wrap; }
.html-preview :deep(.tag-marker) { opacity: .4; }
.html-preview :deep([data-inpatient-emr-field-id].is-editable) { cursor: text; }
.html-preview :deep([data-inpatient-emr-field-id][data-field-state="edited"]) { outline-style: solid; outline-color: #94a3b8; background: #fff; }
.html-preview :deep([data-inpatient-emr-field-id].is-editable:focus) { outline: 2px solid #2563eb; outline-offset: 2px; background: #eff6ff; }
.html-preview :deep([data-inpatient-emr-field-id][data-placeholder]:empty::before) { content: attr(data-placeholder); color: #94a3b8; }
@container workspace-page (max-width: 720px) { .html-preview { padding: 18px 16px; } }
</style>
