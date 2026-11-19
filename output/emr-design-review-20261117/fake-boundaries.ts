import { reactive } from 'vue';
export function useConsultationReferenceFeedbackListener() {}
export const inpatientLogUpload = reactive({ error: '', pending: 0, uploading: false, unrecorded: 0 });
export async function retryInpatientLogs() {}
export function getHisAdapter() { return null; }
export const audioRecorder = { async start() { throw new Error('合成预览不启用真实麦克风'); }, async stop() { return new Blob(); }, getByteFrequencyData() { return null; } };
export function getMicrophoneErrorMessage(error: unknown) { return String(error); }
export async function transcribeSpeech() { return ''; }
