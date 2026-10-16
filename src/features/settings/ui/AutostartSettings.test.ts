// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AutostartSettings from './AutostartSettings.vue';

const gateway = vi.hoisted(() => ({
  isSupported: vi.fn(() => true),
  isEnabled: vi.fn(async () => false),
  setEnabled: vi.fn(async (_value: boolean) => {}),
}));
vi.mock('../api/autostart', () => ({ autostartGateway: gateway }));

let app: App | undefined;
let root: HTMLDivElement | undefined;
async function mount() {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(AutostartSettings);
  app.mount(root);
  await nextTick();
  await nextTick();
  return root.querySelector<HTMLInputElement>('[role="switch"]')!;
}
afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.resetAllMocks();
  gateway.isSupported.mockReturnValue(true);
  gateway.isEnabled.mockResolvedValue(false);
});

describe('autostart setting UI', () => {
  it('shows system state and rolls back a failed toggle, keeping an accessible error and retry', async () => {
    const input = await mount();
    expect(input.disabled).toBe(false);
    expect(root?.textContent).toContain('切换立即生效');
    gateway.setEnabled.mockRejectedValueOnce(new Error('denied'));
    input.click();
    await nextTick();
    await nextTick();
    await nextTick();
    expect(input.checked).toBe(false);
    expect(root?.querySelector('[role="status"]')?.textContent).toContain('修改开机自启动失败');
    expect(root?.querySelector('button')?.textContent).toContain('重新读取');
  });

  it('disables the switch in browser previews with an explanation', async () => {
    gateway.isSupported.mockReturnValue(false);
    const input = await mount();
    expect(input.disabled).toBe(true);
    expect(root?.textContent).toContain('仅桌面客户端支持');
    expect(gateway.isEnabled).not.toHaveBeenCalled();
  });
});
