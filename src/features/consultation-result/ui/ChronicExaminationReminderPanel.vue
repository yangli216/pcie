<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type { ChronicExaminationReminders } from '@features/clinical-result/clinicalResultContract';
const props = defineProps<{ reminders: ChronicExaminationReminders }>();
const matchedCount = computed(() => props.reminders.items.filter(item => item.matchStatus === 'matched').length);
const pendingCount = computed(() => props.reminders.items.length - matchedCount.value);
const open = ref(false);
const pinned = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const panelId = `chronic-examination-${useId()}`;
const position = ref({ left: '12px', top: '12px' });
let closeTimer: number | undefined;
let suppressFocus = false;

function cancelClose() { window.clearTimeout(closeTimer); }
function close(restoreFocus = false) {
  cancelClose(); open.value = false; pinned.value = false;
  if (restoreFocus) {
    suppressFocus = true; trigger.value?.focus({ preventScroll: true }); suppressFocus = false;
  }
}
function contains(target: EventTarget | null) {
  return target instanceof Node && (trigger.value?.contains(target) || panel.value?.contains(target));
}
function reposition() {
  if (!open.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  if (anchor.bottom < 0 || anchor.top > window.innerHeight) { close(); return; }
  const bounds = panel.value.getBoundingClientRect();
  const below = anchor.bottom + 8;
  const top = below + bounds.height <= window.innerHeight - 12 ? below : anchor.top - bounds.height - 8;
  position.value = {
    left: `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`,
    top: `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`,
  };
}
async function show() {
  if (suppressFocus) return;
  cancelClose(); open.value = true;
  await nextTick(); reposition();
}
async function toggle() {
  if (pinned.value) { close(true); return; }
  pinned.value = true; await show(); panel.value?.focus({ preventScroll: true });
}
function scheduleClose() {
  cancelClose();
  closeTimer = window.setTimeout(() => {
    if (!pinned.value && !contains(document.activeElement)) close();
  }, 150);
}
function outside(event: Event) { if (!contains(event.target)) close(); }
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  event.preventDefault(); event.stopPropagation(); close(true);
}
watch(open, async (value, _, onCleanup) => {
  if (!value) return;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('focusin', outside, true);
  document.addEventListener('keydown', escape, true);
  document.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  let observer: ResizeObserver | undefined;
  onCleanup(() => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('focusin', outside, true);
    document.removeEventListener('keydown', escape, true);
    document.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    observer?.disconnect();
  });
  await nextTick();
  if (open.value && panel.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(reposition); observer.observe(panel.value);
  }
});
watch(() => props.reminders, () => close(), { deep: true });
onBeforeUnmount(cancelClose);
function issueLabel(item: ChronicExaminationReminders['items'][number]) {
  if (item.matchStatus === 'matched') return '可在下方选择';
  if (item.matchIssue === 'unverified_group') return '组套或单项信息未确认，请在 PHIS 核对';
  if (item.matchIssue === 'unverified_part') return '部位或检查方式未明确，请在 PHIS 核对';
  return item.matchStatus === 'ambiguous' ? '院内同名或对照项目不唯一，请在 PHIS 核对'
    : '未匹配到本次可开立项目，请在 PHIS 核对';
}
</script>

<template>
  <aside class="chronic-exam-reminders" aria-label="慢病检查检验提醒">
    <div class="reminder-header">
      <h4>检查检验提醒</h4>
      <span v-if="reminders.sourceStatus === 'ready'" class="reminder-count">
        {{ matchedCount ? `可选 ${matchedCount} 项` : '暂无可选项目' }}<template v-if="pendingCount"> · {{ pendingCount }} 项待核对</template>
      </span>
      <button ref="trigger" type="button" class="reminder-info" aria-label="查看检查检验推荐明细"
        aria-haspopup="dialog" :aria-expanded="open" :aria-controls="open ? panelId : undefined"
        @pointerenter="show" @pointerleave="scheduleClose" @focus="show" @blur="scheduleClose" @click.stop="toggle">
        <Icon icon="lucide:info" size="16" aria-hidden="true" />
      </button>
    </div>
    <p v-if="reminders.sourceStatus === 'missing_identity'" role="status">缺少患者身份证或本次就诊标识，暂无法获取健康处方推荐。</p>
    <p v-else-if="reminders.sourceStatus === 'unavailable'" role="status">健康处方推荐暂不可用，本次未取得推荐清单。</p>
    <p v-else-if="!reminders.items.length" role="status">健康处方服务本次未返回推荐项目。</p>
    <p v-if="reminders.catalogStatus === 'unavailable'" role="status">本次可开立目录读取失败，暂不能将推荐项目加入医嘱。</p>
    <p v-if="reminders.historyStatus !== 'complete'" role="status">PHIS 历史查询{{ reminders.historyStatus === 'failed' ? '失败' : reminders.historyStatus === 'partial' ? '不完整' : '覆盖完整性未确认' }}，近期检查情况需进一步核实。</p>
    <Teleport to="body">
      <section v-if="open" :id="panelId" ref="panel" class="reminder-popover" :style="position" role="dialog"
        :aria-labelledby="`${panelId}-title`" tabindex="-1" @pointerenter="cancelClose" @pointerleave="scheduleClose" @click.stop>
        <header>
          <h4 :id="`${panelId}-title`">检查检验推荐明细</h4>
          <button type="button" class="reminder-close" aria-label="关闭检查检验推荐明细" @click="close(true)">×</button>
        </header>
        <div class="reminder-detail-content">
          <p>未查到不代表未检查；推荐周期未提供，请核对本次需要。可选项目在下方卡片勾选后随病历一起回写。</p>
          <p v-if="!reminders.items.length">{{ reminders.sourceStatus === 'ready' ? '本次未返回推荐项目' : '本次未取得推荐清单' }}</p>
          <ul v-else>
            <li v-for="item in reminders.items" :key="item.name">
              <strong>{{ item.name }}</strong><span> · {{ issueLabel(item) }}</span>
              <details v-if="item.recentReports.length">
                <summary>近90天有 {{ item.recentReports.length }} 条对应名称已出报告记录</summary>
                <div v-for="(record, index) in item.recentReports" :key="index">
                  {{ record.name }} · {{ record.requestedAt ? `申请时间：${record.requestedAt}` : '申请时间未提供' }}
                </div>
              </details>
              <span v-else class="history-note"> · 返回记录未找到对应名称已出报告</span>
            </li>
          </ul>
        </div>
      </section>
    </Teleport>
  </aside>
</template>

<style scoped>
.chronic-exam-reminders { margin: 8px 0 12px; padding: 8px 12px; background: var(--bg-secondary, #f6f8fa); border-radius: 8px; font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.reminder-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
h4 { margin: 0; font-size: 13px; }
p { margin: 3px 0; }
.history-note, .reminder-count { color: var(--text-secondary, #64748b); }
.reminder-info, .reminder-close { display: inline-flex; justify-content: center; align-items: center; flex: 0 0 auto; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--text-secondary, #64748b); cursor: pointer; font: inherit; }
.reminder-info { margin-left: auto; }
.reminder-info:hover, .reminder-info[aria-expanded="true"], .reminder-close:hover { background: var(--bg-hover, #e8eef7); color: var(--primary-color, #2563eb); }
.reminder-popover { position: fixed; z-index: 2200; width: min(440px, calc(100vw - 24px)); max-height: min(460px, calc(100vh - 24px)); display: flex; flex-direction: column; box-sizing: border-box; border: 1px solid var(--border-color, #d5e1eb); border-radius: 8px; background: var(--bg-primary, #fff); color: var(--text-primary, #1e293b); box-shadow: 0 8px 28px #0f172a29; font-size: 12px; line-height: 1.6; text-align: left; overflow-wrap: anywhere; }
.reminder-popover > header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--border-color, #d5e1eb); }
.reminder-detail-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 12px 12px; }
ul { margin: 8px 0 0; padding-left: 18px; }
li { margin: 7px 0; }
summary { cursor: pointer; }
button:focus-visible, summary:focus-visible, .reminder-popover:focus-visible { outline: 2px solid var(--primary-color, #2563eb); outline-offset: 2px; }
</style>
