import { computed, readonly, ref } from 'vue';
import { appendVoiceTranscript } from '../lib/voiceRecordingContinuation';

export type VoiceTranscriptionStatus = 'idle' | 'transcribing' | 'failed' | 'empty' | 'ready';

interface ReviewOptions {
  retryTranscription: (audio: Blob) => Promise<string>;
}

interface StoppedRecording {
  audio: Blob;
  prefix: string;
  draft: string;
  finish: () => Promise<string>;
}

/** Owns only the current stopped segment; previously reviewed text is kept as a frozen prefix. */
export function useVoiceTranscriptionReview(options: ReviewOptions) {
  const status = ref<VoiceTranscriptionStatus>('idle');
  const text = ref('');
  const errorMessage = ref('');
  let audio: Blob | null = null;
  let prefix = '';
  let requestId = 0;
  /** 当前停录段首次失败时的文字快照：失败后须由医生改出不同的非空文字才可确认；重试再失败不重拍快照。 */
  const failedText = ref('');
  let hasFailedSnapshot = false;

  const isPending = computed(() => status.value === 'transcribing');
  const canContinue = computed(() => status.value === 'ready' || status.value === 'empty');
  /** 失败时允许医生强制编辑；转写中禁止编辑，避免与迟到结果互相覆盖。 */
  const canEdit = computed(() => canContinue.value || status.value === 'failed');
  const isFailedTextEdited = computed(() => (
    status.value === 'failed'
    && Boolean(audio?.size)
    && Boolean(text.value.trim())
    && text.value !== failedText.value
  ));
  const canConfirm = computed(() => (canContinue.value && Boolean(text.value.trim())) || isFailedTextEdited.value);
  const canRetry = computed(() => (status.value === 'failed' || status.value === 'empty') && Boolean(audio?.size));

  function reset() {
    requestId += 1;
    audio = null;
    prefix = '';
    text.value = '';
    failedText.value = '';
    hasFailedSnapshot = false;
    errorMessage.value = '';
    status.value = 'idle';
  }

  function markFailed(message: string) {
    errorMessage.value = message;
    if (!hasFailedSnapshot) {
      failedText.value = text.value;
      hasFailedSnapshot = true;
    }
    status.value = 'failed';
  }

  async function resolveTranscription(transcribe: () => Promise<string>) {
    const currentRequest = ++requestId;
    status.value = 'transcribing';
    errorMessage.value = '';
    try {
      const result = await transcribe();
      if (currentRequest !== requestId) return;
      if (typeof result !== 'string') {
        markFailed('转写结果异常，录音已保留。请重试，或手动编辑文字后确认。');
        return;
      }
      text.value = appendVoiceTranscript(prefix, result);
      status.value = result.trim() ? 'ready' : 'empty';
    } catch {
      if (currentRequest !== requestId) return;
      markFailed('整段转写失败，录音已保留。请重试，或手动编辑文字后确认。');
    }
  }

  async function complete(recording: StoppedRecording) {
    reset();
    audio = recording.audio;
    prefix = recording.prefix;
    text.value = appendVoiceTranscript(prefix, recording.draft);
    if (!audio.size) {
      markFailed('录音保存失败，无法重试。请放弃后重新采集。');
      return;
    }
    await resolveTranscription(recording.finish);
  }

  async function retry() {
    if (!canRetry.value || !audio) return;
    const recording = audio;
    await resolveTranscription(() => options.retryTranscription(recording));
  }

  return {
    status: readonly(status), text, errorMessage: readonly(errorMessage),
    isPending, canContinue, canEdit, canConfirm, canRetry,
    complete, retry, reset,
  };
}
