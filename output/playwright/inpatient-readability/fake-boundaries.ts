import { onBeforeUnmount } from 'vue';

export const getHisAdapter = () => null;
export const inpatientLogUpload = { error: '', pending: 0, uploading: false, unrecorded: 0 };
export const retryInpatientLogs = async () => undefined;
export const audioRecorder = {
  start: async () => { throw new Error('合成预览不采集真实麦克风，请手动补充要点'); },
  stop: async () => new Blob(),
  getByteFrequencyData: () => null,
};
export const getMicrophoneErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export const transcribeSpeech = async () => '合成预览语音转写';

export function useConsultationReferenceFeedbackListener<T>(options: {
  onFeedback: (payload: T) => void;
}): void {
  const listener = (event: Event) => options.onFeedback((event as CustomEvent<T>).detail);
  window.addEventListener('preview-feedback', listener);
  onBeforeUnmount(() => window.removeEventListener('preview-feedback', listener));
}
