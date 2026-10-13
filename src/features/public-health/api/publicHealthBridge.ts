import { invoke } from '@tauri-apps/api/core';
import type { PublicHealthConfirmed, PublicHealthFeedback, PublicHealthLaunch, PublicHealthRequest } from '../types';
import { assertConfirmation } from '../lib/publicHealthContract';

export interface PublicHealthTaskSnapshot extends PublicHealthLaunch {
  originRequestId: string;
  phase: 'ready' | 'prepared' | 'awaiting-writeback' | 'saved' | 'failed' | 'closed';
  pendingWriteback: PublicHealthConfirmed | null;
  lastFeedback: PublicHealthFeedback | null;
}
async function bridgeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try { return await invoke<T>(command, args); }
  catch (error) {
    let detail: unknown = error;
    if (typeof detail === 'string') { try { detail = JSON.parse(detail); } catch { /* Preserve a plain command error. */ } }
    const fields = detail && typeof detail === 'object' ? detail as { errorCode?: string; message?: string } : null;
    const failure = new Error(fields?.message || '本地公卫会话操作未完成。') as Error & { code?: string };
    failure.code = fields?.errorCode;
    throw failure;
  }
}
export const publicHealthBridge = {
  getActive: () => bridgeInvoke<PublicHealthTaskSnapshot | null>('get_active_public_health_task'),
  prepare: (bridgeSessionId: string, request: PublicHealthRequest) => bridgeInvoke<{
    originRequestId: string; requestId: string; requestHash: string; preparedAt: string;
  }>('prepare_public_health_generation', { bridgeSessionId, request }),
  confirm: async (bridgeSessionId: string, payload: PublicHealthConfirmed) => {
    assertConfirmation(payload);
    return bridgeInvoke<{
      status: 'accepted'; originRequestId: string; requestId: string;
      generationId: string; writebackRequestId: string; eventId: string; duplicate: boolean;
    }>('confirm_public_health_result', { bridgeSessionId, payload });
  },
  close: (originRequestId: string) => bridgeInvoke('close_public_health_task', { originRequestId }),
};
