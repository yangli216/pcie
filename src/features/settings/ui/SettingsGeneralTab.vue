<script setup lang="ts">
import type { AudioInputDeviceOption } from '@services/audioRecorder';
import type { RegionalConnectionConfig } from '@services/regionalClient';
import type { Theme } from '@services/themeService';
import Icon from '@shared/ui/Icon.vue';
import KeyboardShortcutSettings from './KeyboardShortcutSettings.vue';
import AutostartSettings from './AutostartSettings.vue';
import type { KeyboardShortcutBindings } from '../model/keyboardShortcuts';

type RegionalConnectionDefaults = Pick<RegionalConnectionConfig, 'baseUrl' | 'orgCode'>;

interface RegionalConnectionResult {
  success: boolean;
  message: string;
}

defineProps<{
  currentTheme: Theme;
  themes: Theme[];
  alwaysOnTop: boolean;
  regionalBaseUrl: string;
  regionalOrgCode: string;
  regionalDeviceCode: string;
  regionalDefaults: RegionalConnectionDefaults;
  regionalConnectResult: RegionalConnectionResult | null;
  testingRegionalConnection: boolean;
  defaultAudioInputValue: string;
  audioInputOptions: AudioInputDeviceOption[];
  audioInputDevices: AudioInputDeviceOption[];
  selectedAudioInputDeviceId: string;
  audioDeviceLoading: boolean;
  audioDeviceError: string;
  voiceRecordingDir: string;
  voicePickingDir: boolean;
  keyboardShortcuts: KeyboardShortcutBindings;
}>();

const emit = defineEmits<{
  'select-theme': [theme: Theme];
  'update:alwaysOnTop': [value: boolean];
  'update:regionalBaseUrl': [value: string];
  'update:regionalOrgCode': [value: string];
  'update:selectedAudioInputDeviceId': [value: string];
  'update:keyboardShortcuts': [value: KeyboardShortcutBindings];
  'test-regional-connection': [];
  'refresh-audio-input-devices': [];
  'pick-voice-recording-dir': [];
  'clear-voice-recording-dir': [];
  'open-medical-cache': [];
  'open-his-log': [];
}>();

function readInputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function readCheckboxValue(event: Event): boolean {
  return (event.target as HTMLInputElement).checked;
}

function readSelectValue(event: Event): string {
  return (event.target as HTMLSelectElement).value;
}
</script>

<template>
  <div class="tab-pane settings-general-tab">
    <div class="settings-section theme-section">
      <div class="section-header theme-section-header">
        <div class="section-title-inline">
          <Icon icon="lucide:palette" :size="20" />
          <h3>界面主题</h3>
        </div>
        <span class="current-theme-pill">当前：{{ currentTheme.name }}</span>
      </div>

      <div class="theme-grid" role="group" aria-label="界面主题">
        <button
          v-for="theme in themes"
          :key="theme.id"
          type="button"
          :class="['theme-card', { active: currentTheme.id === theme.id }]"
          :aria-pressed="currentTheme.id === theme.id"
          :title="theme.description"
          @click="emit('select-theme', theme)"
        >
          <span
            class="theme-swatch"
            :style="{
              background: `linear-gradient(135deg, ${theme.colors.primary}, ${theme.colors.cta})`,
              borderColor: theme.colors.borderMedium,
            }"
          ></span>
          <span class="theme-name">{{ theme.name }}</span>
          <Icon v-if="currentTheme.id === theme.id" icon="lucide:check" :size="14" class="theme-check" />
        </button>
      </div>
    </div>

    <AutostartSettings />

    <KeyboardShortcutSettings
      :model-value="keyboardShortcuts"
      @update:model-value="emit('update:keyboardShortcuts', $event)"
    />

    <div class="settings-section">
      <div class="section-header">
        <Icon icon="lucide:layout" :size="20" />
        <h3>窗口设置</h3>
      </div>

      <div class="toggle-row">
        <div class="toggle-label-group">
          <label for="always-on-top" class="toggle-label">窗口始终置顶</label>
          <span class="toggle-hint">启用后，应用窗口将保持在其他窗口之上</span>
        </div>
        <div class="switch-wrapper">
          <input
            id="always-on-top"
            type="checkbox"
            :checked="alwaysOnTop"
            @change="emit('update:alwaysOnTop', readCheckboxValue($event))"
          >
          <label for="always-on-top" class="toggle-switch"></label>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-header">
        <Icon icon="lucide:server" :size="20" />
        <h3>服务端接入</h3>
      </div>
      <p class="section-desc">桌面端始终向 PCIE Server 注册设备、拉取 bootstrap 配置，并统一走签名 `/v1/*` 代理；实际生效模型和上游凭据由后台管理。</p>

      <div class="form-group">
        <label for="regional-base-url">后端地址</label>
        <div class="input-with-icon">
          <Icon icon="lucide:link" :size="16" class="input-icon" />
          <input
            id="regional-base-url"
            :value="regionalBaseUrl"
            type="text"
            :placeholder="regionalDefaults.baseUrl"
            @input="emit('update:regionalBaseUrl', readInputValue($event))"
          />
        </div>
        <p class="form-hint">默认值取构建时注入的 `VITE_REGIONAL_BASE_URL`；当前构建预置为 `{{ regionalDefaults.baseUrl }}`，留空会回退该值。</p>
      </div>

      <div class="form-group">
        <label for="regional-org-code">机构编码</label>
        <div class="input-with-icon">
          <Icon icon="lucide:building-2" :size="16" class="input-icon" />
          <input
            id="regional-org-code"
            :value="regionalOrgCode"
            type="text"
            :placeholder="regionalDefaults.orgCode"
            @input="emit('update:regionalOrgCode', readInputValue($event))"
          />
        </div>
        <p class="form-hint">默认回退 `ORG001`；当前构建预置为 `{{ regionalDefaults.orgCode }}`，需与后台机构表中的 `cdOrg` 一致，留空会回退该值。</p>
      </div>

      <div class="form-group">
        <label for="regional-device-code">设备编码</label>
        <div class="input-with-icon">
          <Icon icon="lucide:laptop-minimal-check" :size="16" class="input-icon" />
          <input
            id="regional-device-code"
            :value="regionalDeviceCode"
            type="text"
            readonly
          />
        </div>
        <p class="form-hint">优先读取当前设备 MAC 地址作为设备编码并持久化复用；仅在当前环境无法读取 MAC 时才回退到本地兜底编码。更换后端地址、机构编码或设备编码迁移后会自动重新注册。</p>
      </div>

      <div
        v-if="regionalConnectResult"
        :class="['regional-status', regionalConnectResult.success ? 'success' : 'error']"
      >
        <Icon :icon="regionalConnectResult.success ? 'lucide:check-circle' : 'lucide:alert-circle'" :size="16" />
        <span>{{ regionalConnectResult.message }}</span>
      </div>

      <div class="test-connection-row">
        <button
          type="button"
          class="test-btn"
          :disabled="testingRegionalConnection"
          @click="emit('test-regional-connection')"
        >
          <Icon
            :icon="testingRegionalConnection ? 'lucide:loader-2' : 'lucide:wifi'"
            :size="16"
            :class="{ spin: testingRegionalConnection }"
          />
          {{ testingRegionalConnection ? '测试中...' : '测试 server 连通性' }}
        </button>
        <span class="test-message testing">验证桌面端到 PCIE Server 的注册与 bootstrap 链路</span>
      </div>
    </div>

    <div class="settings-section">
      <div class="section-header">
        <Icon icon="lucide:mic" :size="20" />
        <h3>音频设置</h3>
      </div>
      <p class="section-desc">聊天语音输入和语音接诊共用同一套麦克风选择。若指定设备失效，录音会自动回退到系统默认输入设备。</p>

      <div class="form-group">
        <label for="audio-input-device">输入设备</label>
        <div class="input-with-icon">
          <Icon icon="lucide:audio-lines" :size="16" class="input-icon" />
          <select
            id="audio-input-device"
            class="select-input"
            :value="selectedAudioInputDeviceId"
            @change="emit('update:selectedAudioInputDeviceId', readSelectValue($event))"
          >
            <option :value="defaultAudioInputValue">跟随系统默认输入设备</option>
            <option v-for="device in audioInputOptions" :key="device.deviceId" :value="device.deviceId">
              {{ device.label }}
            </option>
          </select>
        </div>
        <p class="form-hint">选择固定麦克风后，应用会记住该设备；切回默认时始终跟随系统当前默认输入。</p>
      </div>

      <div class="test-connection-row">
        <button
          type="button"
          class="test-btn"
          :disabled="audioDeviceLoading"
          @click="emit('refresh-audio-input-devices')"
        >
          <Icon
            :icon="audioDeviceLoading ? 'lucide:loader-2' : 'lucide:refresh-cw'"
            :size="16"
            :class="{ spin: audioDeviceLoading }"
          />
          {{ audioDeviceLoading ? '刷新中...' : '刷新设备列表' }}
        </button>
        <span v-if="audioDeviceError" class="test-message error">
          <Icon icon="lucide:triangle-alert" :size="16" />
          {{ audioDeviceError }}
        </span>
        <span v-else class="test-message success">
          <Icon icon="lucide:mic-2" :size="16" />
          已检测到 {{ audioInputDevices.length }} 个输入设备
        </span>
      </div>

      <div class="form-group voice-recording-dir-group">
        <label for="voice-recording-dir">录音保存目录</label>
        <div class="input-with-icon">
          <Icon icon="lucide:folder" :size="16" class="input-icon" />
          <input
            id="voice-recording-dir"
            type="text"
            :value="voiceRecordingDir"
            placeholder="未配置：使用默认目录 (应用数据目录/voice_recordings)"
            readonly
          />
        </div>
        <p class="form-hint">每次结束语音接诊会把 .wav 音频与对应实时转写文本（同名 .txt）成对落盘到该目录，便于后续追溯。</p>
        <div class="test-connection-row">
          <button
            type="button"
            class="test-btn"
            :disabled="voicePickingDir"
            @click="emit('pick-voice-recording-dir')"
          >
            <Icon
              :icon="voicePickingDir ? 'lucide:loader-2' : 'lucide:folder-open'"
              :size="16"
              :class="{ spin: voicePickingDir }"
            />
            {{ voicePickingDir ? '选择中...' : '选择目录' }}
          </button>
          <button
            type="button"
            class="test-btn"
            :disabled="voicePickingDir || !voiceRecordingDir"
            @click="emit('clear-voice-recording-dir')"
          >
            <Icon icon="lucide:rotate-ccw" :size="16" />
            恢复默认
          </button>
        </div>
      </div>
    </div>

    <div class="settings-tool-links">
      <button type="button" class="settings-section settings-tool-card" @click="emit('open-medical-cache')">
        <span class="settings-tool-icon" aria-hidden="true">
          <Icon icon="lucide:database" :size="20" />
        </span>
        <span class="settings-tool-copy">
          <span class="settings-tool-title">缓存管理</span>
          <span class="settings-tool-desc">查看诊断、诊疗项目和药品目录等本地基础数据缓存</span>
        </span>
        <Icon class="settings-tool-arrow" icon="lucide:chevron-right" :size="20" aria-hidden="true" />
      </button>

      <button type="button" class="settings-section settings-tool-card" @click="emit('open-his-log')">
        <span class="settings-tool-icon" aria-hidden="true">
          <Icon icon="lucide:scroll-text" :size="20" />
        </span>
        <span class="settings-tool-copy">
          <span class="settings-tool-title">HIS 联调日志</span>
          <span class="settings-tool-desc">查看 Bridge 入站与 PHIS 出站调用流水，支持按 traceId 排查和导出</span>
        </span>
        <Icon class="settings-tool-arrow" icon="lucide:chevron-right" :size="20" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.settings-section {
  background: var(--medical-bg-primary);
  border: 1px solid var(--medical-border-light);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--medical-border-light);
  color: var(--medical-primary);
}

.section-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--medical-text-primary);
}

.section-desc {
  margin: 0 0 16px 0;
  font-size: 14px;
  color: var(--medical-text-muted);
  line-height: 1.5;
}

.theme-section {
  padding: 18px 20px;
}

.theme-section-header {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding-bottom: 10px;
}

.section-title-inline {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.current-theme-pill {
  flex-shrink: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(8, 145, 178, 0.08);
  color: var(--medical-primary);
  font-size: 12px;
  font-weight: 600;
}

.theme-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.theme-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 7px 10px;
  background: var(--medical-bg-primary);
  border: 1px solid var(--medical-border-light);
  border-radius: 999px;
  color: var(--medical-text-primary);
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out);
  text-align: left;
}

.theme-card:hover {
  border-color: var(--medical-border-medium);
  background: var(--medical-bg-secondary);
}

.theme-card.active {
  border-color: var(--medical-primary);
  background: rgba(8, 145, 178, 0.06);
  box-shadow: 0 0 0 2px rgba(8, 145, 178, 0.1);
}

.theme-swatch {
  width: 18px;
  height: 18px;
  border: 1px solid;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.55);
}

.theme-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.theme-check {
  flex-shrink: 0;
  color: var(--medical-primary);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.form-group:last-child {
  margin-bottom: 0;
}

.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: var(--medical-text-primary);
}

.voice-recording-dir-group {
  margin-top: 16px;
}

.input-with-icon {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 14px;
  color: var(--medical-text-muted);
  pointer-events: none;
}

.input-with-icon input,
.input-with-icon .select-input {
  padding-left: 44px !important;
}

.form-group input,
.form-group select {
  height: 48px;
  border-radius: 8px;
  border: 2px solid var(--medical-border-medium);
  padding: 12px 16px;
  background: var(--medical-bg-primary);
  color: var(--medical-text-secondary);
  outline: none;
  transition: all var(--duration-normal) var(--ease-out);
  font-size: 16px;
}

.form-group input:hover,
.form-group select:hover {
  border-color: var(--medical-border-medium);
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--medical-primary);
  box-shadow: 0 0 0 3px rgba(8, 145, 178, 0.1);
}

.form-group select {
  appearance: none;
  width: 100%;
}

.form-hint {
  margin: 0;
  font-size: 12px;
  color: var(--medical-text-muted);
  line-height: 1.5;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 16px;
  background: var(--medical-bg-secondary);
  border-radius: 10px;
  border: 1px solid var(--medical-border-light);
  margin-bottom: 20px;
  transition: background 0.2s ease;
}

.toggle-row:hover {
  background: #EFF6FF;
}

.toggle-label-group {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.toggle-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--medical-text-primary);
  white-space: nowrap;
  cursor: pointer;
}

.toggle-hint {
  font-size: 12px;
  color: var(--medical-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.switch-wrapper {
  position: relative;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.switch-wrapper input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.toggle-switch {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  min-height: unset;
  min-width: unset;
  background: #CBD5E1;
  transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  border-radius: 12px;
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-switch:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background: white;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.switch-wrapper input:checked+.toggle-switch:before {
  transform: translateX(20px);
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
}

.settings-tool-links {
  display: grid;
  flex: 0 0 auto;
  gap: 12px;
}

.settings-tool-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 82px;
  padding: 16px 18px;
  overflow: hidden;
  background: var(--medical-bg-primary);
  border: 1px solid var(--medical-border-light);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  color: var(--medical-text-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color var(--duration-normal) var(--ease-out),
    background-color var(--duration-normal) var(--ease-out),
    box-shadow var(--duration-normal) var(--ease-out),
    transform var(--duration-normal) var(--ease-out);
}

.settings-tool-card:hover {
  border-color: var(--medical-primary);
  background: #f7fcfd;
  background: color-mix(in srgb, var(--medical-primary) 3%, var(--medical-bg-primary));
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(8, 145, 178, 0.15);
}

.settings-tool-card:focus-visible {
  outline: 3px solid rgba(8, 145, 178, 0.35);
  outline: 3px solid color-mix(in srgb, var(--medical-primary) 35%, transparent);
  outline-offset: 2px;
}

.settings-tool-icon {
  display: inline-flex;
  flex: 0 0 40px;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(8, 145, 178, 0.1);
  background: color-mix(in srgb, var(--medical-primary) 10%, transparent);
  color: var(--medical-primary);
}

.settings-tool-copy {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}

.settings-tool-title {
  color: var(--medical-text-primary);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.35;
}

.settings-tool-desc {
  color: var(--medical-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.settings-tool-arrow {
  flex: 0 0 auto;
  color: var(--medical-text-muted);
  transition: transform var(--duration-normal) var(--ease-out), color var(--duration-normal) var(--ease-out);
}

.settings-tool-card:hover .settings-tool-arrow {
  color: var(--medical-primary);
  transform: translateX(3px);
}

@media (max-width: 640px) {
  .settings-tool-card {
    gap: 12px;
    min-height: 76px;
    padding: 14px;
  }

  .settings-tool-icon {
    flex-basis: 36px;
    width: 36px;
    height: 36px;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.test-connection-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.test-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid var(--medical-border-medium);
  background: var(--medical-bg-primary);
  color: var(--medical-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-normal) var(--ease-out);
}

.test-btn:hover:not(:disabled) {
  border-color: var(--medical-primary);
  color: var(--medical-primary);
}

.test-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.test-message {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.test-message.success {
  color: var(--medical-success);
}

.test-message.error {
  color: #DC2626;
}

.test-message.testing {
  color: var(--medical-text-muted);
}

.regional-status {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.5;
}

.regional-status.success {
  background: rgba(5, 150, 105, 0.08);
  color: var(--medical-success);
  border: 1px solid rgba(5, 150, 105, 0.18);
}

.regional-status.error {
  background: rgba(220, 38, 38, 0.08);
  color: #DC2626;
  border: 1px solid rgba(220, 38, 38, 0.18);
}
</style>
