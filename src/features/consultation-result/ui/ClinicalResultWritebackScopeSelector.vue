<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import type { WritebackScopeRecordFieldOption } from '../model/useClinicalResultWritebackScope';

const props = defineProps<{
  open: boolean;
  disabled: boolean;
  recordExpanded: boolean;
  recordFields: WritebackScopeRecordFieldOption[];
  recordGroupChecked: boolean;
  recordGroupIndeterminate: boolean;
  recordSelectionSummary: string;
  diagnosisAvailable: boolean;
  diagnosisSelected: boolean;
  diagnosisCount: number;
  medicineAvailable: boolean;
  medicineSelected: boolean;
  medicineCount: number;
  clinicalOrdersAvailable: boolean;
  clinicalOrdersSelected: boolean;
  clinicalOrdersCount: number;
  selectedOptionCount: number;
  availableOptionCount: number;
  allAvailableSelected: boolean;
  partialSelection: boolean;
  creatingPartialRecord: boolean;
}>();

const emit = defineEmits<{
  (event: 'toggle'): void;
  (event: 'close'): void;
  (event: 'toggle-all'): void;
  (event: 'toggle-record-group'): void;
  (event: 'toggle-record-expanded'): void;
  (event: 'toggle-record-field', field: string): void;
  (event: 'toggle-diagnosis'): void;
  (event: 'toggle-medicine'): void;
  (event: 'toggle-clinical-orders'): void;
}>();

const rootRef = ref<HTMLElement | null>(null);

function closeOnOutside(event: MouseEvent): void {
  if (!props.open) return;
  const target = event.target as Node | null;
  if (target && rootRef.value?.contains(target)) return;
  emit('close');
}

function closeOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape' && props.open) emit('close');
}

onMounted(() => {
  document.addEventListener('mousedown', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);
});
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeOnOutside);
  document.removeEventListener('keydown', closeOnEscape);
});
</script>

<template>
  <div ref="rootRef" class="writeback-scope-selector">
    <button
      class="writeback-scope-trigger"
      type="button"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="emit('toggle')"
    >
      <Icon icon="lucide:list-checks" size="15" aria-hidden="true" />
      <span>选择回写</span>
      <span class="writeback-scope-trigger-count">{{ selectedOptionCount }}项</span>
      <Icon :icon="open ? 'lucide:chevron-down' : 'lucide:chevron-up'" size="14" aria-hidden="true" />
    </button>

    <section
      v-if="open"
      class="writeback-scope-popover"
      role="dialog"
      aria-label="选择回写内容"
      @click.stop
    >
      <header class="writeback-scope-head">
        <div>
          <strong>选择回写内容</strong>
          <span>已选 {{ selectedOptionCount }}/{{ availableOptionCount }} 项</span>
        </div>
        <div class="writeback-scope-head-actions">
          <button type="button" @click="emit('toggle-all')">
            {{ allAvailableSelected ? '取消全选' : '全选' }}
          </button>
          <button type="button" aria-label="关闭选择回写内容" @click="emit('close')">
            <Icon icon="lucide:x" size="16" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div class="writeback-scope-list">
        <div class="writeback-scope-record-group">
          <div class="writeback-scope-row is-parent">
            <button
              type="button"
              class="writeback-scope-check-row"
              role="checkbox"
              :aria-checked="recordGroupIndeterminate ? 'mixed' : recordGroupChecked"
              :disabled="recordFields.every((item) => !item.available)"
              @click="emit('toggle-record-group')"
            >
              <span
                class="writeback-scope-check"
                :class="{ 'is-selected': recordGroupChecked, 'is-indeterminate': recordGroupIndeterminate }"
                aria-hidden="true"
              >
                <Icon v-if="recordGroupIndeterminate" icon="lucide:minus" size="12" />
                <Icon v-else-if="recordGroupChecked" icon="lucide:check" size="12" />
              </span>
              <span class="writeback-scope-row-copy">
                <strong>门诊病历</strong>
                <small>{{ recordSelectionSummary }}</small>
              </span>
            </button>
            <button
              type="button"
              class="writeback-scope-expand"
              :aria-label="recordExpanded ? '收起门诊病历字段' : '展开门诊病历字段'"
              :aria-expanded="recordExpanded"
              @click="emit('toggle-record-expanded')"
            >
              <Icon :icon="recordExpanded ? 'lucide:chevron-up' : 'lucide:chevron-down'" size="15" />
            </button>
          </div>

          <div v-if="recordExpanded" class="writeback-scope-record-fields">
            <button
              v-for="field in recordFields"
              :key="field.key"
              type="button"
              class="writeback-scope-check-row is-field"
              role="checkbox"
              :aria-checked="field.selected"
              :disabled="!field.available"
              @click="emit('toggle-record-field', field.key)"
            >
              <span class="writeback-scope-check" :class="{ 'is-selected': field.selected }" aria-hidden="true">
                <Icon v-if="field.selected" icon="lucide:check" size="12" />
              </span>
              <span class="writeback-scope-row-copy">
                <span>{{ field.label }}</span>
                <small v-if="field.isNew" class="is-new">新增</small>
                <small v-else-if="!field.available">暂无内容</small>
              </span>
            </button>
          </div>
        </div>

        <button
          type="button"
          class="writeback-scope-check-row"
          role="checkbox"
          :aria-checked="diagnosisSelected"
          :disabled="!diagnosisAvailable"
          @click="emit('toggle-diagnosis')"
        >
          <span class="writeback-scope-check" :class="{ 'is-selected': diagnosisSelected }" aria-hidden="true">
            <Icon v-if="diagnosisSelected" icon="lucide:check" size="12" />
          </span>
          <span class="writeback-scope-row-copy">
            <strong>诊断</strong>
            <small>{{ diagnosisAvailable ? `${diagnosisCount} 项` : '当前无已选内容' }}</small>
          </span>
        </button>

        <button
          type="button"
          class="writeback-scope-check-row"
          role="checkbox"
          :aria-checked="medicineSelected"
          :disabled="!medicineAvailable"
          @click="emit('toggle-medicine')"
        >
          <span class="writeback-scope-check" :class="{ 'is-selected': medicineSelected }" aria-hidden="true">
            <Icon v-if="medicineSelected" icon="lucide:check" size="12" />
          </span>
          <span class="writeback-scope-row-copy">
            <strong>用药</strong>
            <small>{{ medicineAvailable ? `${medicineCount} 项` : '当前无已选内容' }}</small>
          </span>
        </button>

        <button
          type="button"
          class="writeback-scope-check-row"
          role="checkbox"
          :aria-checked="clinicalOrdersSelected"
          :disabled="!clinicalOrdersAvailable"
          @click="emit('toggle-clinical-orders')"
        >
          <span class="writeback-scope-check" :class="{ 'is-selected': clinicalOrdersSelected }" aria-hidden="true">
            <Icon v-if="clinicalOrdersSelected" icon="lucide:check" size="12" />
          </span>
          <span class="writeback-scope-row-copy">
            <strong>检查、检验与处置</strong>
            <small>{{ clinicalOrdersAvailable ? `${clinicalOrdersCount} 项` : '当前无已选内容' }}</small>
          </span>
        </button>
      </div>

      <slot />

      <p v-if="partialSelection" class="writeback-scope-partial-note">
        本次仅更新已选内容，未选内容保持 HIS 原值。
      </p>
      <p v-if="creatingPartialRecord" class="writeback-scope-create-warning">
        当前尚无门诊病历，将创建部分病历草稿，请确认回写范围。
      </p>
      <p class="writeback-scope-safe-note">
        取消勾选表示本次不回写，不会删除 HIS 中已有内容。
      </p>
    </section>
  </div>
</template>

<style scoped>
.writeback-scope-selector { position: relative; }
.writeback-scope-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 132px; height: 32px; padding: 5px 11px; border: 1px solid #bfd5f6; border-radius: 4px; background: #f7fbff; color: #2469f2; font-size: 14px; cursor: pointer; }
.writeback-scope-trigger:hover:not(:disabled) { border-color: #95b8f1; background: #edf5ff; }
.writeback-scope-trigger:disabled { border-color: #d8e4f6; background: #f5f8fd; color: #8fa9d4; cursor: not-allowed; }
.writeback-scope-trigger-count { color: #5c779f; font-size: 12px; }
.writeback-scope-popover { position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 80; width: min(380px, calc(100vw - 32px)); max-height: min(610px, calc(100vh - 96px)); overflow-y: auto; padding: 13px; border: 1px solid rgba(105, 135, 175, .28); border-radius: 10px; background: #fff; color: var(--voice-text); box-shadow: 0 14px 38px rgba(15, 23, 42, .18); }
.writeback-scope-head { position: sticky; top: -13px; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin: -1px -1px 8px; padding: 1px 1px 9px; background: #fff; border-bottom: 1px solid rgba(148, 163, 184, .18); }
.writeback-scope-head > div:first-child { display: flex; flex-direction: column; gap: 2px; }
.writeback-scope-head strong { font-size: 14px; }
.writeback-scope-head span { color: var(--voice-text-muted); font-size: 12px; }
.writeback-scope-head-actions { display: flex; align-items: center; gap: 8px; }
.writeback-scope-head-actions button { display: inline-flex; align-items: center; justify-content: center; min-height: 26px; padding: 2px 5px; border: 0; background: transparent; color: #2469f2; font-size: 12px; cursor: pointer; }
.writeback-scope-list { display: flex; flex-direction: column; gap: 5px; }
.writeback-scope-record-group { border: 1px solid rgba(148, 163, 184, .18); border-radius: 8px; background: rgba(248, 250, 252, .72); }
.writeback-scope-row { display: flex; align-items: center; }
.writeback-scope-row.is-parent { padding-right: 6px; }
.writeback-scope-check-row { display: flex; flex: 1; align-items: center; gap: 9px; min-height: 38px; padding: 7px 9px; border: 0; border-radius: 7px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.writeback-scope-check-row:hover:not(:disabled) { background: rgba(36, 105, 242, .055); }
.writeback-scope-check-row:disabled { color: #94a3b8; cursor: not-allowed; }
.writeback-scope-check { display: inline-flex; flex: 0 0 16px; align-items: center; justify-content: center; width: 16px; height: 16px; border: 1px solid #b8c5d6; border-radius: 4px; background: #fff; color: #fff; }
.writeback-scope-check.is-selected, .writeback-scope-check.is-indeterminate { border-color: #2469f2; background: #2469f2; }
.writeback-scope-row-copy { display: flex; flex: 1; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.writeback-scope-row-copy strong, .writeback-scope-row-copy > span:first-child { font-size: 13px; font-weight: 600; }
.writeback-scope-row-copy small { flex: 0 0 auto; color: var(--voice-text-muted); font-size: 11px; }
.writeback-scope-row-copy small.is-new { padding: 1px 4px; border-radius: 3px; background: rgba(225, 139, 20, .1); color: #a75b00; }
.writeback-scope-expand { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; background: transparent; color: var(--voice-text-muted); cursor: pointer; }
.writeback-scope-record-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 1px 4px; padding: 0 6px 7px 29px; }
.writeback-scope-check-row.is-field { min-height: 32px; padding: 5px 7px; }
.writeback-scope-check-row.is-field .writeback-scope-check { flex-basis: 14px; width: 14px; height: 14px; }
.writeback-scope-partial-note, .writeback-scope-create-warning, .writeback-scope-safe-note { margin: 8px 2px 0; font-size: 12px; line-height: 1.5; }
.writeback-scope-partial-note { color: #285f8f; }
.writeback-scope-create-warning { padding: 6px 8px; border-radius: 5px; background: rgba(225, 139, 20, .08); color: #8a5200; }
.writeback-scope-safe-note { color: var(--voice-text-muted); }
</style>
