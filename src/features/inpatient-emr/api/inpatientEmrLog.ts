import { getFeedbackActor } from '@/services/feedbackContext';
import { getDeviceCode } from '@/services/regionalClient';
import { enqueueInpatientLog, inpatientLogScope } from './inpatientEmrLogOutbox';
import type { InpatientLogEventType, InpatientLogSnapshot, InpatientLogStatus } from './inpatientEmrLogTypes';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult } from '../types';

export interface InpatientLogSession {
  generationId: string;
  terminal: boolean;
  record(type: InpatientLogEventType, result?: InpatientEmrGenerationResult | null, message?: string, final?: Record<string, string>): Promise<void>;
}
const statusOf = (type: InpatientLogEventType): InpatientLogStatus => {
  if (type === 'started') return 'generating';
  if (type === 'writeback_requested' || type === 'writeback_dispatched') return 'writeback_pending';
  return type;
};
const optional = (value: string | null | undefined) => value?.trim() || undefined;
export async function createInpatientLogSession(request: InpatientEmrGenerationRequest,
  enqueue = enqueueInpatientLog): Promise<InpatientLogSession> {
  const actor = getFeedbackActor();
  const generationId = crypto.randomUUID();
  const generationStartedAt = Date.now();
  const input = { ...request, patient: request.patient ? { ...request.patient } : undefined };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.htmlContent));
  const templateHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  await getDeviceCode();
  const scope = inpatientLogScope();
  let sequence = 0;
  let firstValues: Record<string, string> | undefined;
  let finalValues: Record<string, string> | undefined;
  const session: InpatientLogSession = {
    generationId, terminal: false,
    async record(type, result, message, final) {
      if (session.terminal) return;
      if (result && !firstValues && ['generated', 'fallback', 'waiting', 'generation_failed'].includes(type))
        firstValues = { ...result.initialFieldValues };
      if (final) finalValues = { ...final };
      const context = result?.context;
      const registration = context?.registration;
      const patient = input.patient;
      const sources: InpatientLogSnapshot['sources'] = [];
      if (input.doctorSupplement?.trim()) sources.push({ code: 'doctor_supplement', status: 'used', text: input.doctorSupplement.trim() });
      if (context) {
        const ai = context.aiContext;
        const hisText = [ai?.vitals?.summary, ai?.orders?.summary, ai?.labs?.summary,
          ...(ai?.previousRecords?.recentNotes || []).map(note => note.summary)].filter(Boolean).join('\n\n');
        sources.push({ code: 'his_summary', status: result?.evidenceSummary.hisContext.status || 'missing', text: hisText });
        const outpatient = context.outpatientRecord;
        const outpatientText = outpatient?.plainText || [outpatient?.chiefComplaint, outpatient?.historyOfPresentIllness,
          outpatient?.pastHistory, outpatient?.physicalExamination, outpatient?.diagnosis, outpatient?.treatmentPlan].filter(Boolean).join('\n');
        sources.push({ code: 'outpatient_record', status: result?.evidenceSummary.outpatientRecord.status || 'missing', text: outpatientText });
      }
      const snapshot: InpatientLogSnapshot = {
        generationId, eventId: crypto.randomUUID(), sequence: ++sequence, eventType: type, status: statusOf(type),
        generationStartedAt, occurredAt: Date.now(), admissionId: input.admissionId,
        templateId: input.templateId, templateName: input.templateName?.trim() || '住院病历模板', templateHash,
        requestId: result?.request.requestId || input.requestId, recordTime: context?.documentContext.recordTime || input.recordTime,
        doctorId: optional(actor.doctorId), doctorName: optional(actor.doctorName), hisOrgId: optional(actor.hisOrgId), orgName: optional(actor.orgName),
        patientId: optional(patient?.idPi || patient?.patientId || registration?.patientId || context?.aiContext?.patient?.patientId),
        patientName: optional(patient?.naPi || patient?.name || registration?.name || context?.aiContext?.patient?.name),
        patientGender: optional(patient?.sdSexText || patient?.gender || registration?.gender || context?.aiContext?.patient?.sex),
        patientAge: optional(registration?.ageText || registration?.inHospitalAgeText || patient?.ageText || patient?.age || context?.aiContext?.patient?.age),
        message, sources,
        fields: (result?.template.fields || []).map(field => ({
          id: field.id, name: field.name || field.id, section: field.article, source: field.rule.source,
          generatedValue: (firstValues || result?.initialFieldValues || {})[field.id] || '',
          finalValue: finalValues ? finalValues[field.id] ?? '' : null,
        })),
      };
      if (['writeback_success', 'abandoned', 'superseded'].includes(type)) session.terminal = true;
      await enqueue(snapshot, scope);
    },
  };
  return session;
}
