import { computed, readonly, ref } from 'vue';
import { appendVoiceTranscript } from '../lib/voiceRecordingContinuation';

export type VoiceTranscriptionStatus = 'idle' | 'transcribing' | 'failed' | 'empty' | 'ready';

interface StoppedRecording {
  audio: Blob;
  prefix: string;
  draft: string;
  finish: () => Promise<string>;
}

export function useVoiceTranscriptionReview() {
  const status = ref<VoiceTranscriptionStatus>('idle');
  const text = ref('');
  const errorMessage = ref('');
  let requestId = 0;
  const failedText = ref('');

  const isPending = computed(() => status.value === 'transcribing');
  const canContinue = computed(() => status.value === 'ready' || status.value === 'empty');
  /** 失败时允许医生强制编辑；转写中禁止编辑，避免与迟到结果互相覆盖。 */
  const canEdit = computed(() => canContinue.value || status.value === 'failed');
  const isFailedTextEdited = computed(() => (
    status.value === 'failed'
    && Boolean(text.value.trim())
    && text.value.trim() !== failedText.value.trim()
  ));
  const canConfirm = computed(() => (canContinue.value && Boolean(text.value.trim())) || isFailedTextEdited.value);

  function reset() {
    requestId += 1;
    text.value = '';
    failedText.value = '';
    errorMessage.value = '';
    status.value = 'idle';
  }

  function markFailed(message: string) {
    errorMessage.value = message;
    failedText.value = text.value;
    status.value = 'failed';
  }

  async function complete({ audio, prefix, draft, finish }: StoppedRecording) {
    reset();
    const currentRequest = requestId;
    text.value = appendVoiceTranscript(prefix, draft);
    if (!audio.size) {
      markFailed('录音保存失败');
      return;
    }

    status.value = 'transcribing';
    try {
      const result = await finish();
      if (currentRequest !== requestId) return;
      if (typeof result !== 'string') {
        markFailed('转写结果异常');
        return;
      }
      if (result.trim()) {
        text.value = appendVoiceTranscript(prefix, result);
        status.value = 'ready';
      } else {
        status.value = 'empty';
      }
    } catch {
      if (currentRequest !== requestId) return;
      markFailed('整段转写未完成');
    }
  }

  return {
    status: readonly(status), text, errorMessage: readonly(errorMessage),
    isPending, canContinue, canEdit, canConfirm,
    complete, reset,
  };
}
