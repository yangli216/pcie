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
const viewMode = shallowRef<'reading' | 'template'>('reading');
const fieldsById = computed(() => new Map(props.fields.map((field) => [field.id, field])));
const aiFields = computed(() => props.fields.filter((field) => field.aiSuitable));
const canEdit = computed(() => props.editable && !props.isGenerating);
const previewHint = computed(() => {
  if (props.isGenerating) return '正在生成病历，完成后可直接修改正文。';
  if (!canEdit.value) return '当前病历为只读，请查看回写状态。';
  return '蓝色虚线为 AI 草稿，可直接修改；切换视图会保留当前草稿。';
});

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
  if (viewMode.value === 'template') {
    root.innerHTML = buildEditableInpatientEmrPreviewHtml(
      props.htmlContent, props.fieldValues, props.fields, false,
    );
    // External template editability must never extend beyond recognized AI fields.
    root.querySelectorAll<HTMLElement>('[contenteditable]').forEach((element) => {
      element.setAttribute('contenteditable', 'false');
    });
  } else {
    const fragment = document.createDocumentFragment();
    aiFields.value.forEach((field) => {
      const article = document.createElement('section');
      article.className = 'reading-field';
      const heading = document.createElement('div');
      heading.className = 'reading-field-heading';
      const title = document.createElement('h3');
      title.className = 'reading-field-title';
      title.textContent = field.name || field.id;
      const badge = document.createElement('span');
      badge.className = 'field-source-badge';
      badge.setAttribute('data-field-badge', field.id);
      heading.append(title, badge);
      const body = document.createElement('div');
      body.className = 'reading-field-body';
      body.setAttribute('data-inpatient-emr-field-id', field.id);
      body.setAttribute('data-inpatient-emr-field-name', field.name || field.id);
      article.append(heading, body);
      fragment.append(article);
    });
    if (aiFields.value.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'reading-empty';
      empty.textContent = '当前模板没有 AI 生成字段，可切换原始模板查看完整病历。';
      fragment.append(empty);
    }
    root.replaceChildren(fragment);
  }
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
  root.querySelectorAll<HTMLElement>('[data-field-badge]').forEach((badge) => {
    const field = fieldsById.value.get(badge.getAttribute('data-field-badge') || '');
    if (!field) return;
    const edited = isEdited(field);
    badge.textContent = edited ? '已编辑' : 'AI 草稿';
    badge.classList.toggle('is-edited', edited);
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
  () => [props.htmlContent, viewMode.value, props.fields.map((field) => `${field.id}:${field.name}:${field.aiSuitable}`).join('|')],
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
  <section class="inpatient-template-preview" aria-label="住院病历预览">
    <div class="preview-toolbar">
      <div class="view-switch" role="group" aria-label="病历预览视图">
        <button type="button" :aria-pressed="viewMode === 'reading'" @click="viewMode = 'reading'">病历阅读</button>
        <button type="button" :aria-pressed="viewMode === 'template'" @click="viewMode = 'template'">原始模板</button>
      </div>
      <span class="preview-hint" role="status">{{ previewHint }}</span>
    </div>
    <div
      ref="previewRoot"
      class="html-preview"
      :class="{ 'is-reading': viewMode === 'reading', 'is-template': viewMode === 'template' }"
      :aria-busy="isGenerating"
      contenteditable="false"
      @beforeinput="handleBeforeInput"
      @input="handleInput"
      @paste="handlePaste"
      @drop.prevent
    ></div>
  </section>
</template>

<style scoped>
.inpatient-template-preview { display: flex; flex: 0 0 auto; flex-direction: column; min-width: 0; gap: 12px; }
.preview-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 16px; }
.view-switch { display: inline-flex; flex-shrink: 0; gap: 3px; padding: 3px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; }
.view-switch button { min-height: 30px; padding: 5px 12px; border: 0; border-radius: 5px; background: transparent; color: #64748b; font: inherit; font-size: 13px; cursor: pointer; }
.view-switch button[aria-pressed='true'] { background: #fff; color: #2563eb; box-shadow: 0 1px 4px rgb(15 23 42 / 9%); font-weight: 600; }
.view-switch button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.preview-hint { color: #64748b; font-size: 12px; line-height: 1.5; }
.html-preview { min-height: 360px; overflow-x: auto; padding: 24px 28px; border: 1px solid #e2e8f0; border-radius: 12px; background: #fff; color: #1f2937; font-size: 15px; line-height: 1.75; overflow-wrap: anywhere; }
.html-preview :deep(.reading-field) { max-width: 880px; margin: 0 auto 23px; }
.html-preview :deep(.reading-field:last-child) { margin-bottom: 0; }
.html-preview :deep(.reading-field-heading) { display: flex; align-items: center; gap: 9px; margin-bottom: 5px; }
.html-preview :deep(.reading-field-title) { margin: 0; color: #172033; font-size: 14px; font-weight: 700; }
.html-preview :deep(.field-source-badge) { padding: 1px 6px; border: 1px solid #bfdbfe; border-radius: 4px; color: #1d4ed8; background: #eff6ff; font-size: 10px; font-weight: 500; line-height: 1.6; }
.html-preview :deep(.field-source-badge.is-edited) { border-color: #cbdcfb; color: #1d4ed8; background: #eff6ff; }
.html-preview :deep(.reading-field-body) { min-height: 1.75em; padding: 2px 4px; margin: 0 -4px; border-radius: 4px; white-space: pre-wrap; outline: none; }
.html-preview :deep([data-inpatient-emr-field-id].is-editable) { cursor: text; outline: 1px dashed #60a5fa; outline-offset: 2px; background: #eff6ff; }
.is-reading :deep(.reading-field-body.is-editable) { padding: 6px 10px; margin: 0; }
.html-preview :deep([data-inpatient-emr-field-id][data-field-state="edited"]) { outline-style: solid; outline-color: #94a3b8; background: #fff; }
.html-preview :deep([data-inpatient-emr-field-id].is-editable:focus) { outline: 2px solid #2563eb; outline-offset: 2px; background: #eff6ff; }
.html-preview :deep([data-inpatient-emr-field-id][data-placeholder]:empty::before) { content: attr(data-placeholder); color: #94a3b8; }
.is-template :deep(.inpatient-emr-field--ai) { min-width: 2em; padding: 1px 3px; border-radius: 3px; outline: 1px dashed #60a5fa; outline-offset: 1px; background: #eff6ff; white-space: pre-wrap; }
.is-template :deep(.tag-marker) { opacity: .4; }
.html-preview :deep(.reading-empty) { margin: 30px auto; color: #64748b; text-align: center; }
@container workspace-page (max-width: 720px) { .html-preview { padding: 18px 16px; } .preview-toolbar { align-items: flex-start; flex-direction: column; gap: 8px; } }
</style>
