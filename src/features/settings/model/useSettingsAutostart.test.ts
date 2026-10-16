import { describe, expect, it, vi } from 'vitest';
import type { AutostartGateway } from '../api/autostart';
import { useSettingsAutostart } from './useSettingsAutostart';

function setup() {
  let registered = false;
  const gateway = {
    isSupported: vi.fn(() => true),
    isEnabled: vi.fn(async () => registered),
    setEnabled: vi.fn(async (value: boolean) => { registered = value; }),
  } satisfies AutostartGateway;
  return { gateway, controller: useSettingsAutostart(gateway) };
}

describe('system autostart settings', () => {
  it('reads the OS registration on entry without implicitly enabling it', async () => {
    const { gateway, controller } = setup();
    expect(controller.disabled.value).toBe(true);
    gateway.isEnabled.mockResolvedValueOnce(true);
    await controller.refresh();
    expect(controller.enabled.value).toBe(true);
    expect(controller.disabled.value).toBe(false);
    expect(gateway.setEnabled).not.toHaveBeenCalled();
  });

  it('enables and disables immediately and confirms each operation by reading the OS', async () => {
    const { gateway, controller } = setup();
    await controller.refresh();
    await controller.setEnabled(true);
    expect(controller.enabled.value).toBe(true);
    expect(controller.message.value).toContain('已开启');
    await controller.setEnabled(false);
    expect(controller.enabled.value).toBe(false);
    expect(controller.message.value).toContain('已关闭');
    expect(gateway.isEnabled).toHaveBeenCalledTimes(3);
    expect(gateway.setEnabled.mock.calls).toEqual([[true], [false]]);
  });

  it('blocks conflicting reads and repeated toggles until the OS write finishes', async () => {
    const { gateway, controller } = setup();
    await controller.refresh();
    let finish!: () => void;
    gateway.setEnabled.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    gateway.isEnabled.mockResolvedValue(true);
    const pending = controller.setEnabled(true);
    expect(controller.enabled.value).toBe(false);
    expect(controller.disabled.value).toBe(true);
    await controller.setEnabled(true);
    await controller.refresh();
    expect(gateway.setEnabled).toHaveBeenCalledTimes(1);
    expect(gateway.isEnabled).toHaveBeenCalledTimes(1);
    finish();
    await pending;
    expect(controller.enabled.value).toBe(true);
  });

  it('leaves an unreadable state unknown and disabled until a successful retry', async () => {
    const { gateway, controller } = setup();
    gateway.isEnabled.mockRejectedValueOnce(new Error('denied'));
    await controller.refresh();
    expect(controller.enabled.value).toBeNull();
    expect(controller.disabled.value).toBe(true);
    expect(controller.error.value).toContain('无法读取');
    await controller.setEnabled(true);
    expect(gateway.setEnabled).not.toHaveBeenCalled();
    await controller.refresh();
    expect(controller.error.value).toBe('');
    expect(controller.enabled.value).toBe(false);
  });

  it('reconciles the actual registration after a failed write without reporting success', async () => {
    const { gateway, controller } = setup();
    await controller.refresh();
    gateway.setEnabled.mockRejectedValueOnce(new Error('denied'));
    gateway.isEnabled.mockResolvedValueOnce(true);
    await controller.setEnabled(true);
    expect(controller.enabled.value).toBe(true);
    expect(controller.error.value).toContain('修改开机自启动失败');
    expect(controller.message.value).toBe('');
    expect(controller.busy.value).toBe(false);
  });

  it('detects an ineffective OS write and disables the control if readback also fails', async () => {
    const { gateway, controller } = setup();
    await controller.refresh();
    gateway.setEnabled.mockResolvedValueOnce(undefined);
    await controller.setEnabled(true);
    expect(controller.enabled.value).toBe(false);
    expect(controller.error.value).not.toBe('');
    gateway.isEnabled.mockRejectedValue(new Error('readback failed'));
    await controller.setEnabled(true);
    expect(controller.enabled.value).toBeNull();
    expect(controller.disabled.value).toBe(true);
    expect(controller.message.value).toBe('');
  });

  it('does not invoke native APIs in browser previews', async () => {
    const { gateway } = setup();
    gateway.isSupported.mockReturnValue(false);
    const controller = useSettingsAutostart(gateway);
    await controller.refresh();
    await controller.setEnabled(true);
    expect(controller.supported).toBe(false);
    expect(controller.disabled.value).toBe(true);
    expect(gateway.isEnabled).not.toHaveBeenCalled();
    expect(gateway.setEnabled).not.toHaveBeenCalled();
  });
});
