<script setup lang="ts">
import { onMounted } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import { autostartGateway } from '../api/autostart';
import { useSettingsAutostart } from '../model/useSettingsAutostart';

const { supported, enabled, busy, disabled, error, message, refresh, setEnabled } =
  useSettingsAutostart(autostartGateway);

onMounted(refresh);

function handleChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const requested = input.checked;
  input.checked = enabled.value === true;
  void setEnabled(requested);
}
</script>

<template>
  <section class="autostart-settings" aria-labelledby="autostart-title" :aria-busy="busy">
    <h3 id="autostart-title"><Icon icon="lucide:power" :size="20" />启动设置</h3>
    <label class="autostart-row" for="autostart-enabled">
      <span class="autostart-copy">
        <span class="autostart-label">开机自启动</span>
        <span id="autostart-hint" class="autostart-hint">登录系统后自动启动全医慧助；切换立即生效，无需保存。</span>
      </span>
      <input
        id="autostart-enabled"
        type="checkbox"
        role="switch"
        :checked="enabled === true"
        :disabled="disabled"
        aria-describedby="autostart-hint autostart-status"
        @change="handleChange"
      >
      <span class="autostart-switch" aria-hidden="true"></span>
    </label>
    <div id="autostart-status" class="autostart-status" role="status" aria-live="polite">
      <span v-if="!supported">仅桌面客户端支持开机自启动。</span>
      <span v-else-if="busy">正在更新自启动状态…</span>
      <span v-else-if="error" class="autostart-error">{{ error }}</span>
      <span v-else>{{ message || (enabled ? '当前已开启' : '当前已关闭') }}</span>
      <button v-if="error && !busy" type="button" @click="refresh">重新读取</button>
    </div>
  </section>
</template>

<style scoped>
.autostart-settings {
  padding: 24px;
  background: var(--medical-bg-primary);
  border: 1px solid var(--medical-border-light);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 5%);
}
h3 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 0 0 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--medical-border-light);
  font-size: 18px;
  color: var(--medical-text-primary);
}
h3 :deep(svg) { color: var(--medical-primary); }
.autostart-row { display: flex; align-items: center; gap: 16px; cursor: pointer; }
.autostart-copy { display: flex; flex: 1; flex-direction: column; gap: 6px; }
.autostart-label { font-size: 14px; font-weight: 600; color: var(--medical-text-primary); }
.autostart-hint, .autostart-status { font-size: 13px; color: var(--medical-text-muted); line-height: 1.5; }
input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.autostart-switch {
  flex-shrink: 0;
  width: 44px;
  height: 24px;
  padding: 3px;
  box-sizing: border-box;
  border-radius: 12px;
  background: var(--medical-border-medium);
}
.autostart-switch::before {
  content: '';
  display: block;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--medical-bg-primary);
  transition: transform .2s;
}
input:checked + .autostart-switch { background: var(--medical-primary); }
input:checked + .autostart-switch::before { transform: translateX(20px); }
input:disabled + .autostart-switch { opacity: .5; cursor: not-allowed; }
input:focus-visible + .autostart-switch { outline: 3px solid var(--medical-primary); outline-offset: 3px; }
.autostart-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
.autostart-error { color: var(--medical-error, #b91c1c); }
button {
  padding: 4px 8px;
  border: 1px solid var(--medical-border-medium);
  border-radius: 6px;
  background: var(--medical-bg-primary);
  color: var(--medical-text-primary);
  font: inherit;
  cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--medical-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .autostart-switch::before { transition: none; } }
</style>
