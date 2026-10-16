import { isTauri } from '@tauri-apps/api/core';
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';

export interface AutostartGateway {
  isSupported(): boolean;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
}

export const autostartGateway: AutostartGateway = {
  isSupported: isTauri,
  isEnabled,
  setEnabled: enabled => enabled ? enable() : disable(),
};
