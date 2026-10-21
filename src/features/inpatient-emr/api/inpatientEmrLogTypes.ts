export type InpatientLogStatus = 'generating' | 'waiting' | 'generated' | 'generation_failed' | 'fallback' | 'writeback_pending' | 'writeback_success' | 'writeback_failed' | 'abandoned' | 'superseded';
export type InpatientLogEventType = 'started' | 'waiting' | 'generated' | 'generation_failed' | 'fallback' | 'writeback_requested' | 'writeback_dispatched' | 'writeback_success' | 'writeback_failed' | 'abandoned' | 'superseded';
export interface InpatientLogSnapshot {
  generationId: string; eventId: string; sequence: number; eventType: InpatientLogEventType; status: InpatientLogStatus;
  generationStartedAt: number; occurredAt: number; admissionId: string; templateId: string; templateName: string; templateHash: string;
  requestId?: string; recordTime?: string; doctorId?: string; doctorName?: string; hisOrgId?: string; orgName?: string;
  patientId?: string; patientName?: string; patientGender?: string; patientAge?: string; message?: string;
  sources: Array<{ code: 'doctor_supplement' | 'his_summary' | 'outpatient_record'; status: string; text: string }>;
  fields: Array<{ id: string; name: string; section?: string; source: string; generatedValue: string; finalValue: string | null }>;
}
