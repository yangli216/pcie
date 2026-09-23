import { nextTick, type Ref } from 'vue';
import type { VoiceEditorSnapshot } from './voiceConsultationCache';

interface VoiceEditorSnapshotRestorationOptions {
  channel: string;
  source: 'llm' | 'cache' | null | undefined;
  roundId: string | null | undefined;
  /** 调用方按当前患者/就诊从当日缓存取得，必须在重置编辑器前读取。 */
  snapshot: VoiceEditorSnapshot | null;
  suppressed: Ref<boolean>;
  isCurrent: () => boolean;
  apply: (snapshot: VoiceEditorSnapshot, isCurrent: () => boolean) => Promise<void>;
}

/** 普通语音恢复事务：仅同轮次重建或显式缓存入口可叠加编辑快照。 */
export async function restoreVoiceEditorSnapshot(
  options: VoiceEditorSnapshotRestorationOptions,
): Promise<boolean> {
  if (options.channel !== 'voice' || !options.isCurrent()) return false;
  options.suppressed.value = true;
  try {
    const snapshot = options.snapshot;
    if (snapshot && (
      options.source === 'cache'
      || (options.source === 'llm' && Boolean(options.roundId)
        && snapshot.consultationRoundId === options.roundId)
    )) {
      await options.apply(snapshot, options.isCurrent);
    }
  } finally {
    // 诊断/治疗 watcher 必须先在保护内消费已恢复的状态。
    await nextTick();
    if (options.isCurrent()) options.suppressed.value = false;
  }
  return options.isCurrent();
}
