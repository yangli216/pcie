<template>
  <div class="update-checker" :class="{ 'is-forced': forced }">
    <div class="header" v-if="!forced">
      <span class="title">全医慧助（PCIE）{{ isWin7Build ? ' Win7 兼容版' : '' }}版本更新</span>
      <span class="current-version">v{{ currentVersion }}</span>
    </div>
    
    <div class="content" :class="{ 'forced-content': forced }">
      <div class="advanced-toggle" @click="showAdvancedConfig = !showAdvancedConfig">
        <span>高级更新配置</span>
        <Icon :icon="showAdvancedConfig ? 'lucide:chevron-up' : 'lucide:chevron-down'" size="14" />
      </div>

      <div class="config-panel" v-show="showAdvancedConfig">
        <div class="config-title">更新源配置</div>

        <div class="form-group">
          <label for="update-environment">当前环境</label>
          <select id="update-environment" v-model="updateEnvironment" class="form-select">
            <option value="production">{{ getUpdateEnvironmentLabel('production') }}</option>
            <option value="testing">{{ getUpdateEnvironmentLabel('testing') }}</option>
          </select>
        </div>

        <div class="form-group">
          <label for="production-url">{{ getUpdateEnvironmentLabel('production') }}地址</label>
          <input id="production-url" v-model="productionUrl" type="text" class="form-input"
            :placeholder="`http://intra.example.com/v1/client/releases/${resolveUpdateChannel('production')}/latest.json`" />
        </div>

        <div class="form-group">
          <label for="testing-url">{{ getUpdateEnvironmentLabel('testing') }}地址</label>
          <input id="testing-url" v-model="testingUrl" type="text" class="form-input"
            :placeholder="`http://intra-test.example.com/v1/client/releases/${resolveUpdateChannel('testing')}/latest.json`" />
        </div>

        <div class="config-footer">
          <span class="source-tag">当前使用：{{ activeEnvironmentLabel }}</span>
          <div class="config-actions">
            <button @click="useRegionalDefaults" class="secondary-btn">使用后台默认源</button>
            <button @click="saveConfig" class="check-btn">保存更新源</button>
          </div>
        </div>
        <div class="endpoint-preview">{{ activeEndpoint || '未配置，回退到应用内默认更新地址' }}</div>
      </div>

      <div v-if="checkerStatus.kind === 'loading'" class="status-loading">
        <div class="spinner"></div>
        <span>{{ checkerStatus.message }}</span>
      </div>
      
      <div v-else-if="checkerStatus.kind === 'error' || checkerStatus.kind === 'forced-unavailable'" class="status-error">
        <span>{{ checkerStatus.message }}</span>
        <button @click="checkAndStore" class="retry-btn">重试</button>
      </div>
      
      <div v-else-if="checkerStatus.kind === 'latest'" class="status-latest">
        <span>{{ checkerStatus.message }}</span>
        <button @click="checkAndStore" class="check-btn">检查更新</button>
      </div>
      
      <div v-else class="update-available">
        <div class="new-version-badge">新版本 {{ updateInfo?.version }}</div>
        
        <div class="release-notes" v-if="updateInfo?.body">
          <div class="notes-title">更新内容：</div>
          <div class="notes-content">{{ updateInfo.body }}</div>
        </div>
        
        <div class="actions">
          <div v-if="installing" class="install-progress">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
            </div>
            <span>正在更新... {{ downloadProgress }}%</span>
          </div>
          <button v-else @click="installUpdate" class="install-btn">
            立即更新并重启
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTauriEventListener } from '@shared/composables/useTauriEventListener';
import {
  getActiveUpdateEndpoint,
  getUpdateConfig,
  getUpdateEnvironmentLabel,
  isWin7UpdateBuild,
  resetUpdateConfigToRegionalDefaults,
  resolveUpdateChannel,
  saveUpdateConfig,
  type UpdateEnvironment,
} from '@services/updateConfig';
import {
  checkForceUpdateRequired,
  getCurrentClientVersion,
  notifyForceUpdateRequired,
  type ForceUpdateState,
} from '@services/updatePolicy';
import { resolveUpdateCheckerStatus } from '../model/updateCheckerStatus';

interface UpdateInfo {
  version: string;
  body?: string | null;
  date?: string | null;
  currentVersion: string;
  downloadUrl: string;
  target: string;
}

interface UpdateProgressPayload {
  downloaded: number;
  contentLength?: number | null;
  percent: number;
  finished: boolean;
}

const currentVersion = ref('');
const checking = ref(false);
const updateAvailable = ref(false);
const updateInfo = ref<UpdateInfo | null>(null);
const installing = ref(false);
const downloadProgress = ref(0);
const error = ref('');
const updateEnvironment = ref<UpdateEnvironment>('production');
const productionUrl = ref('');
const testingUrl = ref('');
const showAdvancedConfig = ref(false);
const isWin7Build = isWin7UpdateBuild();
const showToast = inject('showToast', null) as ((msg: string, type: 'success' | 'error' | 'info') => void) | null;
const props = defineProps<{
  forced?: boolean;
  forceUpdateState?: ForceUpdateState;
}>();

const checkerStatus = computed(() => resolveUpdateCheckerStatus({
  checking: checking.value,
  error: error.value,
  updateAvailable: updateAvailable.value,
  forced: Boolean(props.forced),
  policyRequired: props.forceUpdateState?.required ?? Boolean(props.forced),
  currentVersion: props.forceUpdateState?.currentVersion || currentVersion.value,
  minSupportedVersion: props.forceUpdateState?.minSupportedVersion,
}));

const updateProgressListener = useTauriEventListener<UpdateProgressPayload>({
  eventName: 'update-download-progress',
  logContext: 'UpdateChecker',
  autoStart: false,
  handler: (event) => {
    downloadProgress.value = event.payload.percent;
  },
});

const activeEnvironmentLabel = computed(() => getUpdateEnvironmentLabel(updateEnvironment.value));
const activeEndpoint = computed(() => {
  return getActiveUpdateEndpoint({
    environment: updateEnvironment.value,
    productionUrl: productionUrl.value,
    testingUrl: testingUrl.value,
  });
});

onMounted(async () => {
  const config = getUpdateConfig();
  updateEnvironment.value = config.environment;
  productionUrl.value = config.productionUrl;
  testingUrl.value = config.testingUrl;

  try {
    currentVersion.value = await getCurrentClientVersion();
  } catch (e) {
    console.error('Failed to get version', e);
    currentVersion.value = '未知';
  }

  await updateProgressListener.startListener();

  if (props.forced) {
    await checkAndStore();
  }
});

const saveConfig = () => {
  saveUpdateConfig({
    environment: updateEnvironment.value,
    productionUrl: productionUrl.value,
    testingUrl: testingUrl.value,
  });
  if (showToast) {
    showToast(`更新源已切换为${activeEnvironmentLabel.value}`, 'success');
  }
  void checkForceUpdateRequired();
};

const applyConfig = (config: ReturnType<typeof getUpdateConfig>) => {
  updateEnvironment.value = config.environment;
  productionUrl.value = config.productionUrl;
  testingUrl.value = config.testingUrl;
};

const useRegionalDefaults = () => {
  const config = resetUpdateConfigToRegionalDefaults();
  applyConfig(config);
  if (showToast) {
    showToast('已切换为后台发布中心默认更新源', 'success');
  }
  void checkForceUpdateRequired();
};

async function checkAndStore() {
  checking.value = true;
  error.value = '';
  updateAvailable.value = false;
  
  try {
    const update = await invoke<UpdateInfo | null>('check_app_update', {
      endpoint: activeEndpoint.value || null,
    });
    if (update) {
      updateAvailable.value = true;
      updateInfo.value = update;
      if (props.forced) {
        notifyForceUpdateRequired({
          currentVersion: currentVersion.value,
          latestVersion: update.version,
        });
      }
    }
  } catch (e: any) {
    console.error(e);
    error.value = `检查失败: ${e.message || '网络错误或配置无效'}`;
  } finally {
    checking.value = false;
  }
}

const installUpdate = async () => {
  if (!updateInfo.value) return;
  
  installing.value = true;
  downloadProgress.value = 0;
  
  try {
    await invoke('install_app_update', {
      endpoint: activeEndpoint.value || null,
    });

    await relaunch();
  } catch (e: any) {
    console.error('Update install error:', e);
    let errorMsg = '未知错误';
    if (typeof e === 'string') {
      errorMsg = e;
    } else if (e?.message) {
      errorMsg = e.message;
    } else if (e?.toString && e.toString() !== '[object Object]') {
      errorMsg = e.toString();
    } else {
      // 尝试 JSON 序列化
      try {
        errorMsg = JSON.stringify(e);
      } catch {
        errorMsg = '安装过程中发生未知错误';
      }
    }
    error.value = `更新失败: ${errorMsg}`;
    installing.value = false;
  }
};
</script>

<style scoped>
.update-checker {
  border: 1px solid var(--color-border-light, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  background: var(--color-background-white, #fff);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.update-checker.is-forced {
  border: none;
  box-shadow: none;
  background: transparent;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--color-text-muted, #64748b);
  cursor: pointer;
  margin-bottom: 12px;
  user-select: none;
  transition: color 0.2s;
}

.advanced-toggle:hover {
  color: var(--color-primary, #0891B2);
}

.content.forced-content {
  padding: 0;
}

.header {
  background: var(--color-background-gray, #f8fafc);
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-light, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-weight: 600;
  font-size: 16px;
  color: var(--color-text-primary, #164E63);
}

.current-version {
  font-size: 12px;
  color: var(--color-text-muted, #64748b);
  background: var(--color-border-light, #e2e8f0);
  padding: 4px 10px;
  border-radius: 12px;
  font-weight: 500;
}

.content {
  padding: 20px;
}

.config-panel {
  padding: 16px;
  border: 1px solid var(--color-border-light, #e2e8f0);
  border-radius: 10px;
  background: var(--color-background-gray, #f8fafc);
  margin-bottom: 18px;
}

.config-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-strong, #0F172A);
  margin-bottom: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-group label {
  font-size: 13px;
  color: var(--color-text-muted, #64748b);
}

.form-input,
.form-select {
  min-height: 40px;
  border: 1px solid var(--color-border-light, #cbd5e1);
  border-radius: 8px;
  padding: 0 12px;
  font-size: 14px;
  background: var(--color-background-white, #fff);
  color: var(--color-text-strong, #0F172A);
}

.config-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
}

.config-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.source-tag {
  font-size: 12px;
  color: var(--color-primary, #0891B2);
  font-weight: 600;
}

.endpoint-preview {
  margin-top: 10px;
  font-size: 12px;
  color: var(--color-text-muted, #64748b);
  word-break: break-all;
}

.status-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--color-text-muted, #64748b);
  font-size: 14px;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border-light, #cbd5e1);
  border-top-color: var(--color-primary, #0891B2);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.status-error {
  color: var(--color-error, #ef4444);
  font-size: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.retry-btn, .check-btn, .secondary-btn, .install-btn {
  padding: 10px 20px;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: all var(--duration-normal) var(--ease-out);
  min-height: 40px;
}

.retry-btn {
  background: var(--color-error-bg, #fee2e2);
  color: var(--color-error, #ef4444);
  align-self: flex-start;
}

.retry-btn:hover {
  background: var(--color-error-border, #fca5a5);
}

.check-btn {
  background: var(--color-primary-100, rgba(8, 145, 178, 0.1));
  color: var(--color-primary, #0891B2);
}

.check-btn:hover {
  background: var(--color-primary-200, rgba(8, 145, 178, 0.2));
}

.secondary-btn {
  background: var(--color-background-soft, #f8fafc);
  color: var(--color-text-muted, #64748b);
  border: 1px solid var(--color-border-light, #cbd5e1);
}

.secondary-btn:hover {
  background: var(--color-background-hover, #f1f5f9);
}

.install-btn {
  background: var(--color-primary, #0891B2);
  color: white;
  width: 100%;
  box-shadow: 0 4px 12px rgba(8, 145, 178, 0.3);
}

.install-btn:hover {
  background: var(--color-primary-dark, #0E7490);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(8, 145, 178, 0.4);
}

.status-latest {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-cta, #059669);
  font-size: 14px;
  font-weight: 500;
}

.update-available {
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.new-version-badge {
  display: inline-block;
  background: var(--color-success-bg, #D1FAE5);
  color: var(--color-success-text, #166534);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 16px;
}

.release-notes {
  background: var(--color-background-gray, #f8fafc);
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 20px;
  border: 1px solid var(--color-border-light, #e2e8f0);
}

.notes-title {
  font-size: 12px;
  color: var(--color-text-muted, #64748b);
  margin-bottom: 8px;
  font-weight: 500;
}

.notes-content {
  font-size: 14px;
  color: var(--color-text-strong, #0F172A);
  white-space: pre-wrap;
  line-height: 1.6;
}

.install-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted, #64748b);
}

.progress-bar {
  height: 8px;
  background: var(--color-border-light, #e2e8f0);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--color-primary, #0891B2) 0%, var(--color-primary-light, #06B6D4) 100%);
  transition: width var(--duration-slow) var(--ease-out);
  border-radius: 4px;
}
</style>
