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

  const isPending = computed(() => status.value === 'transcribing');
  const canContinue = computed(() => status.value === 'ready' || status.value === 'empty');
  const canConfirm = computed(() => canContinue.value && Boolean(text.value.trim()));
  const canRetry = computed(() => (status.value === 'failed' || status.value === 'empty') && Boolean(audio?.size));

  function reset() {
    requestId += 1;
    audio = null;
    prefix = '';
    text.value = '';
    errorMessage.value = '';
    status.value = 'idle';
  }

  async function resolveTranscription(transcribe: () => Promise<string>) {
    const currentRequest = ++requestId;
    status.value = 'transcribing';
    errorMessage.value = '';
    try {
      const result = await transcribe();
      if (currentRequest !== requestId) return;
      if (typeof result !== 'string') {
        errorMessage.value = '转写结果异常，录音已保留。请重试后再确认。';
        status.value = 'failed';
        return;
      }
      text.value = appendVoiceTranscript(prefix, result);
      status.value = result.trim() ? 'ready' : 'empty';
    } catch {
      if (currentRequest !== requestId) return;
      errorMessage.value = '整段转写失败，录音已保留。请重试后再确认。';
      status.value = 'failed';
    }
  }

  async function complete(recording: StoppedRecording) {
    reset();
    audio = recording.audio;
    prefix = recording.prefix;
    text.value = appendVoiceTranscript(prefix, recording.draft);
    if (!audio.size) {
      errorMessage.value = '录音保存失败，无法重试。请放弃后重新采集。';
      status.value = 'failed';
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
    isPending, canContinue, canConfirm, canRetry,
    complete, retry, reset,
  };
}
