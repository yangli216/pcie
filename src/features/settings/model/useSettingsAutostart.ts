import { computed, ref } from 'vue';
import type { AutostartGateway } from '../api/autostart';

export function useSettingsAutostart(gateway: AutostartGateway) {
  const supported = gateway.isSupported();
  const enabled = ref<boolean | null>(null);
  const busy = ref(false);
  const error = ref('');
  const message = ref('');
  const disabled = computed(() => !supported || busy.value || enabled.value === null);

  async function refresh(): Promise<void> {
    if (!supported || busy.value) return;
    busy.value = true;
    error.value = '';
    message.value = '';
    try {
      enabled.value = await gateway.isEnabled();
    } catch (cause) {
      enabled.value = null;
      error.value = '无法读取开机自启动状态，请重试。';
      console.error('[SettingsAutostart] Read failed', cause);
    } finally {
      busy.value = false;
    }
  }

  async function setEnabled(value: boolean): Promise<void> {
    if (disabled.value || value === enabled.value) return;
    busy.value = true;
    error.value = '';
    message.value = '';
    try {
      await gateway.setEnabled(value);
      enabled.value = await gateway.isEnabled();
      if (enabled.value !== value) throw new Error('Autostart readback mismatch');
      message.value = value ? '已开启开机自启动' : '已关闭开机自启动';
    } catch (cause) {
      // A failed write can still change the OS registration; always reconcile it.
      try {
        enabled.value = await gateway.isEnabled();
      } catch {
        enabled.value = null;
      }
      error.value = '修改开机自启动失败，请重试；若仍失败，请检查系统登录项权限。';
      console.error('[SettingsAutostart] Update failed', cause);
    } finally {
      busy.value = false;
    }
  }

  return { supported, enabled, busy, disabled, error, message, refresh, setEnabled };
}
