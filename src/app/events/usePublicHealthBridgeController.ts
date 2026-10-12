import { onBeforeUnmount, onMounted } from 'vue';
import { useTauriEventListener } from '@shared/composables/useTauriEventListener';
import { createPublicHealthController, type PublicHealthFeedbackEvent, type PublicHealthLaunch } from '@features/public-health';
import { publicHealthBridge } from '@features/public-health';

export function usePublicHealthBridgeController(options: {
  open: () => Promise<void>;
  notify: (message: string, type?: 'success' | 'error' | 'info') => void;
  enabled?: boolean;
}) {
  const controller = createPublicHealthController();
  type Recovery = { token: number; feedback: PublicHealthFeedbackEvent[] };
  let revision = 0, disposed = false, activeBridgeSessionId: string | null = null;
  let recovery: Recovery | null = null;
  function invalidateRecovery() {
    revision++;
    if (recovery) recovery.feedback.length = 0;
    recovery = null;
  }
  function beginRecovery(): Recovery {
    invalidateRecovery();
    recovery = { token: revision, feedback: [] };
    return recovery;
  }
  const isCurrent = (context: Recovery) => !disposed && context.token === revision;
  function finishRecovery(context: Recovery) {
    context.feedback.length = 0;
    if (recovery === context) recovery = null;
  }
  async function restoreActive(context: Recovery, incoming?: PublicHealthLaunch): Promise<boolean> {
    const snapshot = await publicHealthBridge.getActive();
    if (!isCurrent(context)) return false;
    if (snapshot && snapshot.phase !== 'closed'
      && (!incoming || (snapshot.bridgeSessionId === incoming.bridgeSessionId
        && snapshot.request.originRequestId === incoming.request.originRequestId))) {
      if (incoming && (['patientId', 'scene', 'businessRecordId', 'capability', 'recordVersion'] as const)
        .some(key => snapshot.request[key] !== incoming.request[key])) throw new Error('公卫恢复快照的业务身份不匹配。');
      if (incoming && JSON.stringify(snapshot.request.writebackTargets) !== JSON.stringify(incoming.request.writebackTargets)) {
        throw new Error('公卫恢复快照的回写目标不匹配。');
      }
      // Apply the full prepared request before restoring its frozen writeback identity.
      controller.restore(snapshot);
      activeBridgeSessionId = snapshot.bridgeSessionId;
    } else if (incoming) {
      controller.receiveLaunch(incoming);
      activeBridgeSessionId = incoming.bridgeSessionId;
    } else return false;
    // The feature controller checks the full task and writeback identity on replay.
    for (const feedback of context.feedback.splice(0)) controller.receiveFeedback(feedback);
    return true;
  }
  onBeforeUnmount(() => { disposed = true; invalidateRecovery(); });
  async function receive(incoming: PublicHealthLaunch) {
    if (disposed) return;
    const sameCurrent = activeBridgeSessionId === incoming.bridgeSessionId
      && controller.request.value?.originRequestId === incoming.request.originRequestId;
    const context = beginRecovery();
    try {
      if (sameCurrent) controller.receiveLaunch(incoming);
      else if (!await restoreActive(context, incoming)) return;
      if (isCurrent(context)) await options.open();
    } catch { if (isCurrent(context)) options.notify('公卫任务无法打开，请从 PHIS 核对资料后重试。', 'error'); }
    finally { finishRecovery(context); }
  }
  const launchListener = useTauriEventListener<PublicHealthLaunch>({
    eventName: 'start-public-health-assist', handler: event => { void receive(event.payload); },
    autoStart: false, throwOnError: true, logContext: 'PublicHealthBridge',
  });
  const feedbackListener = useTauriEventListener<PublicHealthFeedbackEvent>({
    eventName: 'public-health-writeback-feedback', handler: event => {
      if (disposed) return;
      if (!controller.receiveFeedback(event.payload) && recovery) {
        // A receipt can arrive after Rust took the snapshot but before the IPC response.
        if (recovery.feedback.length === 16) recovery.feedback.shift();
        recovery.feedback.push(event.payload);
      }
    },
    autoStart: false, throwOnError: true, logContext: 'PublicHealthBridge',
  });
  onMounted(async () => {
    if (options.enabled === false) return;
    const context = beginRecovery();
    try {
      await Promise.all([launchListener.startListener(), feedbackListener.startListener()]);
      if (!isCurrent(context)) return;
      if (await restoreActive(context) && isCurrent(context)) await options.open();
    } catch { if (isCurrent(context)) options.notify('公卫任务监听或恢复失败，请重新从 PHIS 调入。', 'error'); }
    finally { finishRecovery(context); }
  });
  return controller;
}
