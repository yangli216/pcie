<template>
  <div
    class="quality-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="回写前病历质控"
  >
    <section class="quality-dialog">
      <header class="quality-head">
        <div>
          <span>回写前质控</span>
          <strong>发现 {{ issues.length }} 项需确认的风险</strong>
        </div>
        <button
          class="workspace-button is-icon"
          type="button"
          title="关闭"
          aria-label="关闭回写前病历质控"
          :disabled="isWritingBack"
          @click="$emit('cancel')"
        >
          <Icon icon="lucide:x" :size="18" />
        </button>
      </header>

      <main class="quality-body">
        <p class="quality-intro">
          医生已在预览中确认病历内容；以下为回写前自动质控提醒。请返回预览修改，或确认风险可接受后继续回写。
        </p>

        <div class="issue-summary">
          <span class="summary-pill is-high">
            高风险 {{ highRiskCount }}
          </span>
          <span class="summary-pill is-medium">
            提醒 {{ mediumRiskCount }}
          </span>
        </div>

        <div class="issue-list">
          <article
            v-for="issue in issues"
            :key="issue.id"
            class="issue-item"
            :class="`is-${issue.severity}`"
          >
            <span class="issue-icon">
              <Icon :icon="issue.severity === 'high' ? 'lucide:triangle-alert' : 'lucide:info'" :size="16" />
            </span>
            <div class="issue-copy">
              <div class="issue-title-row">
                <strong>{{ issue.title }}</strong>
                <small>{{ issue.severity === 'high' ? '高风险' : '提醒' }}</small>
              </div>
              <p>{{ issue.description }}</p>
            </div>
          </article>
        </div>

        <div
          v-if="writebackMessage"
          class="quality-status"
          :class="`is-${writebackStatus}`"
        >
          <Icon :icon="writebackStatus === 'error' ? 'lucide:triangle-alert' : 'lucide:info'" :size="15" />
          <span>{{ writebackMessage }}</span>
        </div>
      </main>

      <footer class="quality-footer">
        <button
          class="workspace-button"
          type="button"
          :disabled="isWritingBack"
          @click="$emit('cancel')"
        >
          返回预览修改
        </button>
        <button
          class="workspace-button is-primary"
          type="button"
          :disabled="isWritingBack"
          @click="$emit('confirm')"
        >
          <Icon icon="lucide:send-horizontal" :size="16" />
          <span>{{ isWritingBack ? '发送中' : '确认继续回写' }}</span>
        </button>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type { InpatientEmrQualityIssue } from '../types';

const props = defineProps<{
  issues: InpatientEmrQualityIssue[];
  isWritingBack: boolean;
  writebackStatus: 'idle' | 'pending' | 'success' | 'error';
  writebackMessage: string;
}>();

defineEmits<{
  cancel: [];
  confirm: [];
}>();

const highRiskCount = computed(() => props.issues.filter((issue) => issue.severity === 'high').length);
const mediumRiskCount = computed(() => props.issues.filter((issue) => issue.severity === 'medium').length);
</script>

<style scoped>
.quality-overlay {
  position: absolute;
  inset: 0;
  z-index: 24;
  display: grid;
  place-items: center;
  padding: 22px;
  background: rgba(15, 23, 42, 0.3);
}

.quality-dialog {
  width: min(620px, 100%);
  max-height: min(680px, calc(100vh - 44px));
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  border-radius: 12px;
  padding: 20px;
  background: var(--workspace-surface, #fff);
  border: 1px solid var(--workspace-border, #e2e8f0);
  box-shadow: 0 24px 64px rgb(15 23 42 / 18%);
}

.quality-head,
.quality-footer,
.issue-summary,
.issue-item,
.issue-title-row,
.quality-status {
  display: flex;
  align-items: center;
}

.quality-head {
  justify-content: space-between;
  gap: 12px;
}

.quality-head div {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.quality-head span {
  color: var(--workspace-muted, #64748b);
  font-size: 12px;
  font-weight: 500;
}

.quality-head strong {
  color: var(--workspace-text, #172033);
  font-size: 16px;
  line-height: 1.5;
}

.quality-body {
  min-height: 0;
  display: grid;
  gap: 12px;
  overflow: hidden;
}

.quality-intro {
  margin: 0;
  color: var(--workspace-muted, #64748b);
  font-size: 13px;
  line-height: 1.6;
}

.issue-summary {
  gap: 8px;
}

.summary-pill {
  display: inline-flex;
  align-items: center;
  min-height: 26px;
  padding: 0 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.summary-pill.is-high {
  color: var(--workspace-danger, #b91c1c);
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.summary-pill.is-medium {
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
}

.issue-list {
  min-height: 0;
  display: grid;
  gap: 8px;
  overflow: auto;
  padding-right: 4px;
}

.issue-item {
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  border-radius: 9px;
  border: 1px solid var(--workspace-border, #e2e8f0);
  background: #f8fafc;
}

.issue-item.is-high {
  border-color: #fecaca;
  background: #fef2f2;
}

.issue-item.is-medium {
  border-color: #fde68a;
  background: #fffbeb;
}

.issue-icon {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  border-radius: 6px;
  color: #b45309;
  background: var(--workspace-surface, #fff);
}

.issue-item.is-high .issue-icon {
  color: var(--workspace-danger, #b91c1c);
}

.issue-copy {
  min-width: 0;
  display: grid;
  gap: 5px;
}

.issue-title-row {
  gap: 8px;
  flex-wrap: wrap;
}

.issue-title-row strong {
  min-width: 0;
  color: var(--workspace-text, #172033);
  font-size: 13px;
  font-weight: 600;
}

.issue-title-row small {
  flex: none;
  color: var(--workspace-muted, #64748b);
  font-size: 12px;
}

.issue-copy p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.quality-status {
  gap: 7px;
  padding: 9px 10px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--workspace-muted, #64748b);
  background: #f8fafc;
  border: 1px solid var(--workspace-border, #e2e8f0);
}

.quality-status span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.quality-status.is-success {
  color: #15803d;
  background: #f0fdf4;
  border-color: #bbf7d0;
}

.quality-status.is-error {
  color: var(--workspace-danger, #b91c1c);
  background: #fef2f2;
  border-color: #fecaca;
}

.quality-status.is-pending {
  color: var(--workspace-primary, #2563eb);
  background: var(--workspace-primary-soft, #eff6ff);
  border-color: #bfdbfe;
}

.quality-footer {
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--workspace-border, #e2e8f0);
}

@media (max-width: 680px) {
  .quality-overlay {
    padding: 14px;
  }

  .quality-dialog {
    max-height: calc(100vh - 28px);
  }
}
</style>
