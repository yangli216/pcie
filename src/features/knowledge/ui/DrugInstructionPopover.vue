<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { useDrugInstructionsController } from '../model/useDrugInstructionsController';
import { isDrugUsageSection } from '../lib/drugInstructionSections';
import { prioritizedDrugInstructionSections } from '../lib/drugInstructionPresentation';

const props = withDefaults(defineProps<{
  productId: string;
  productName: string;
  drugSpec?: string;
  producer?: string;
  patientAgeText?: string;
}>(), { drugSpec: '', producer: '', patientAgeText: '' });
const { detail, loadingDetail, detailError, sections, select, clearDetail } = useDrugInstructionsController();
const usage = computed(() => sections.value.filter(isDrugUsageSection));
const prioritized = computed(() => prioritizedDrugInstructionSections(sections.value, props.patientAgeText));
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelId = `drug-instruction-${useId()}`;
const position = ref({ left: '12px', top: '12px' });
let resizeObserver: ResizeObserver | undefined;

function close(restoreFocus = true) {
  if (!open.value) return;
  open.value = false;
  clearDetail();
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}

function reposition() {
  if (!open.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) { close(false); return; }
  const bounds = panel.value.getBoundingClientRect();
  const below = anchor.bottom + 8;
  const above = anchor.top - bounds.height - 8;
  const top = below + bounds.height <= window.innerHeight - 12 ? below : Math.max(12, above);
  position.value = {
    left: `${Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12))}px`,
    top: `${Math.min(top, Math.max(12, window.innerHeight - bounds.height - 12))}px`,
  };
}

function load() {
  return select({ productId: props.productId.trim(), productName: props.productName,
    drugSpec: props.drugSpec, producer: props.producer, genericName: '', drugForm: '', category: '' });
}

async function toggle() {
  if (open.value) { close(); return; }
  if (!props.productId.trim()) return;
  open.value = true;
  void load();
  await nextTick();
  reposition();
  panel.value?.focus({ preventScroll: true });
}

function handleOutside(event: Event) {
  const target = event.target as Node | null;
  if (target && !trigger.value?.contains(target) && !panel.value?.contains(target)) close(false);
}
function handleEscape(event: KeyboardEvent) {
  if (open.value && event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
}
function removeListeners() {
  document.removeEventListener('pointerdown', handleOutside, true);
  document.removeEventListener('focusin', handleOutside, true);
  document.removeEventListener('keydown', handleEscape, true);
  window.removeEventListener('resize', reposition);
  document.removeEventListener('scroll', reposition, true);
  resizeObserver?.disconnect();
}
watch(open, async value => {
  removeListeners();
  if (!value) return;
  document.addEventListener('pointerdown', handleOutside, true);
  document.addEventListener('focusin', handleOutside, true);
  document.addEventListener('keydown', handleEscape, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  await nextTick();
  if (open.value && panel.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(panel.value);
  }
});
watch(() => [props.productId, props.productName, props.drugSpec, props.producer], () => close(false));
watch([loadingDetail, detailError, detail, prioritized], async () => { await nextTick(); reposition(); });
onBeforeUnmount(removeListeners);
</script>

<template>
  <button ref="trigger" type="button" class="instruction-trigger" :disabled="!productId.trim()"
    :title="productId.trim() ? '查看药品说明书中的用法用量' : '请先匹配院内药品后查看说明书'"
    :aria-label="`查看${productName}的药品说明书`" aria-haspopup="dialog" :aria-expanded="open"
    :aria-controls="open ? panelId : undefined" @click.stop="toggle">说明书</button>
  <Teleport to="body">
    <section v-if="open" :id="panelId" ref="panel" class="instruction-popover" :style="position"
      role="dialog" :aria-labelledby="`${panelId}-title`" :aria-busy="loadingDetail" tabindex="-1" @click.stop>
      <header class="instruction-header">
        <div>
          <h3 :id="`${panelId}-title`">{{ detail?.productName || productName }} · 说明书</h3>
          <p v-if="detail || drugSpec || producer">{{ [detail?.drugSpec || drugSpec, detail?.producer || producer].filter(Boolean).join(' · ') }}</p>
        </div>
        <button type="button" class="instruction-close" aria-label="关闭药品说明书" @click="close()">×</button>
      </header>
      <div class="instruction-content" aria-live="polite">
        <p v-if="loadingDetail" role="status">正在加载说明书…</p>
        <div v-else-if="detailError" class="instruction-error">
          <p role="alert">{{ detailError }}</p>
          <button type="button" class="instruction-retry" @click="load">重试</button>
        </div>
        <template v-else-if="detail">
          <p v-if="!detail.summary.trim()" role="status">暂无用药说明</p>
          <template v-else>
            <section v-for="(section, index) in prioritized" :key="index" class="instruction-usage">
              <h4>{{ section.heading.trim() }}</h4>
              <p class="instruction-original">{{ section.content }}</p>
            </section>
            <p v-if="!usage.length" class="instruction-hint">原文未单列“用法用量”，请查阅完整说明书。</p>
            <details class="instruction-full" :open="!usage.length">
              <summary>完整说明书</summary>
              <section v-for="(section, index) in sections" :key="index" class="instruction-chapter">
                <h4 v-if="section.heading">{{ section.heading }}</h4>
                <p class="instruction-original">{{ section.content }}</p>
              </section>
            </details>
          </template>
        </template>
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.instruction-trigger { flex: 0 0 auto; padding: 1px 4px; border: 0; border-radius: 3px; color: var(--color-primary, #187a91); background: transparent; font: inherit; font-size: 12px; line-height: 1.6; cursor: pointer; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; }
.instruction-trigger:hover { background: var(--color-background-gray, #edf8fa); }
.instruction-trigger:disabled { color: var(--color-text-muted, #718096); opacity: .6; cursor: default; text-decoration: none; }
.instruction-popover { position: fixed; z-index: 2200; width: min(500px, calc(100vw - 24px)); max-height: min(540px, calc(100vh - 24px)); display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid var(--color-border-light, #d5e1eb); border-radius: 10px; background: var(--color-background-white, #fff); color: var(--color-text-strong, #1e293b); box-shadow: 0 8px 30px #0f172a29; font-size: 13px; text-align: left; }
.instruction-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--color-border-light, #d5e1eb); }
.instruction-header h3 { margin: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.instruction-header p { margin: 4px 0 0; color: var(--color-text-muted, #64748b); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.instruction-close { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: inherit; font-size: 22px; line-height: 1; cursor: pointer; }
.instruction-close:hover { background: var(--color-background-gray, #edf2f7); }
.instruction-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px 16px; }
.instruction-content > p { margin: 0; line-height: 1.7; }
.instruction-usage { border-left: 3px solid var(--color-primary, #187a91); padding: 10px 12px; background: var(--color-background-gray, #edf8fa); background: color-mix(in srgb, var(--color-primary, #187a91) 7%, var(--color-background-white, #fff)); border-radius: 0 5px 5px 0; }
.instruction-usage + .instruction-usage { margin-top: 10px; }
.instruction-popover h4 { margin: 0 0 6px; font-size: 13px; line-height: 1.6; }
.instruction-original { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; margin: 0; }
.instruction-full { margin-top: 14px; }
.instruction-full summary { cursor: pointer; color: var(--color-primary, #187a91); padding: 4px 0; }
.instruction-chapter { margin: 14px 0; }
.instruction-hint { color: var(--color-text-muted, #64748b); }
.instruction-error { overflow-wrap: anywhere; }
.instruction-error p { margin: 0 0 10px; line-height: 1.7; }
.instruction-retry { border: 1px solid var(--color-border-light, #d5e1eb); border-radius: 5px; padding: 4px 12px; color: inherit; background: transparent; font: inherit; cursor: pointer; }
button:focus-visible, summary:focus-visible, .instruction-popover:focus-visible { outline: 2px solid var(--color-primary, #187a91); outline-offset: 2px; }
</style>
