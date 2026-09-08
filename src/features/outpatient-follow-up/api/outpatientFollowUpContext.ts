import { getHisAdapter } from '@/services/his';
import type { HisOutpatientFollowUpContext } from '@/services/his/types';
import type { ReportFollowUpActionability } from '@/types/reportInterpretation';
import type { AppPatient } from '@/types/appState';
import {
  getPatientContextGenderCode,
  getPatientContextId,
  getPatientContextVisitId,
} from '@/utils/patientContext';
import { normalizeOutpatientFollowUpRecordText } from '../lib/outpatientFollowUpRecord';

function readPatientText(patient: AppPatient | null, keys: string[]): string {
  const sources = [
    patient as Record<string, unknown> | null,
    patient?.clinical as Record<string, unknown> | undefined,
    patient?.raw,
  ];

  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    }
  }
  return '';
}

function readCurrentDiagnosis(patient: AppPatient | null): string {
  return readPatientText(patient, ['diagnosis', 'diagnosisText', 'diagnosis_text']);
}

function readCurrentOutpatientRecordText(patient: AppPatient | null): string {
  return readPatientText(patient, ['currentOutpatientRecordText']);
}

function readCurrentOutpatientRecordTitle(patient: AppPatient | null): string {
  return readPatientText(patient, ['currentOutpatientRecordTitle']);
}

function readCurrentOutpatientRecordTime(patient: AppPatient | null): string {
  return readPatientText(patient, ['currentOutpatientRecordTime']);
}

const MAX_TREATMENT_RECORD_TEXT_LENGTH = 3_000;

function actionabilityLabel(value: ReportFollowUpActionability): string {
  const labels: Record<ReportFollowUpActionability, string> = {
    no_treatment_needed: '当前无需新增治疗',
    observe: '观察随访',
    needs_follow_up: '需复查、转诊或进一步处置',
    needs_treatment: '需药物治疗',
  };
  return labels[value];
}


export async function fetchOutpatientFollowUpContext(
  patient: AppPatient | null,
): Promise<HisOutpatientFollowUpContext | null> {
  const patientId = getPatientContextId(patient);
  const currentVisitId = getPatientContextVisitId(patient);
  const currentDiagnosis = readCurrentDiagnosis(patient);
  const sourceMedicalRecordText = readCurrentOutpatientRecordText(patient);
  const medicalRecordText = normalizeOutpatientFollowUpRecordText(
    sourceMedicalRecordText,
    getPatientContextGenderCode(patient),
  );
  const adapter = getHisAdapter();
  console.log('[outpatientFollowUpContext] fetchOutpatientFollowUpContext inputs:', {
    hasAdapter: Boolean(adapter),
    patientId,
    currentVisitId,
    currentDiagnosis,
    medicalRecordTextLength: medicalRecordText?.length || 0,
  });
  if (!adapter || !patientId || !currentVisitId) {
    console.log('[outpatientFollowUpContext] Validation failed: missing adapter, patientId or currentVisitId');
    return null;
  }

  try {
    console.log('[outpatientFollowUpContext] calling fetchOutpatientFollowUpReportResults with:', { patientId, currentVisitId });
    const reportResults = await adapter.fetchOutpatientFollowUpReportResults({
      patientId,
      currentVisitId,
    });
    console.log('[outpatientFollowUpContext] fetchOutpatientFollowUpReportResults response:', reportResults);
    if (!reportResults) {
      console.log('[outpatientFollowUpContext] fetchOutpatientFollowUpReportResults returned null/undefined');
      return null;
    }
    const hasLab = (reportResults.labReports || []).some((report) => (report.items || []).some((item) => (
      Boolean(item.itemName || item.result || item.abnormalFlag)
    )));
    const hasExam = (reportResults.examReports || []).some((report) => Boolean(
      report.examName || report.finding || report.conclusion,
    ));
    const eligible = Boolean(reportResults.followUpEligible && (hasLab || hasExam));
    console.log('[outpatientFollowUpContext] follow-up check details:', {
      followUpEligibleField: reportResults.followUpEligible,
      hasLab,
      hasExam,
      finalEligible: eligible,
    });
    const context: HisOutpatientFollowUpContext = {
      followUpEligible: eligible,
      source: {
        visitId: currentVisitId,
        visitTime: readCurrentOutpatientRecordTime(patient) || undefined,
        documentTitle: readCurrentOutpatientRecordTitle(patient) || '本次门诊病历',
      },
      currentDiagnosis: currentDiagnosis || undefined,
      medicalRecordText: medicalRecordText || '',
      labReports: reportResults.labReports || [],
      examReports: reportResults.examReports || [],
      ineligibleReason: reportResults.ineligibleReason ?? null,
    };
    console.log('[outpatientFollowUpContext] returning context, followUpEligible:', context.followUpEligible);
    return context.followUpEligible ? context : null;
  } catch (error) {
    console.warn('[VoiceFollowUp] Failed to fetch outpatient follow-up context; continuing voice flow', error);
    return null;
  }
}

export function buildOutpatientFollowUpPatientOverrides(
  patient: AppPatient | null,
  context: HisOutpatientFollowUpContext,
): Partial<AppPatient> {
  const diagnosis = context.currentDiagnosis
    || readCurrentDiagnosis(patient)
    || '';

  return {
    diagnosis,
    clinical: {
      ...patient?.clinical,
      diagnosis,
    },
    source: 'outpatient-follow-up',
  };
}

export function buildOutpatientFollowUpEvidence(context: HisOutpatientFollowUpContext | null | undefined): string {
  if (!context?.followUpEligible) return '';

  const labReports = (context.labReports || [])
    .map((report) => {
      const items = (report.items || [])
        .map((item) => {
          const result = [item.result, item.unit].filter(Boolean).join(' ');
          const attributes = [
            item.referenceRange ? `参考范围${item.referenceRange}` : '',
            item.abnormalFlag ? `异常标记${item.abnormalFlag}` : '',
          ].filter(Boolean);
          return `${item.itemName || '项目'}：${result || '未提供结果'}${attributes.length ? `（${attributes.join('，')}）` : ''}`;
        })
        .filter(Boolean);
      if (items.length === 0) return '';
      return `${report.reportName || '检验报告'}${report.reportTime ? `（${report.reportTime}）` : ''}：${items.join('；')}`;
    })
    .filter(Boolean)
    .slice(0, 8);
  const examReports = (context.examReports || [])
    .map((item) => {
      const result = [
        item.finding ? `所见：${item.finding}` : '',
        item.conclusion ? `结论：${item.conclusion}` : '',
      ].filter(Boolean).join('；');
      return result
        ? `${item.examName || '检查报告'}${item.reportTime ? `（${item.reportTime}）` : ''}：${result}`
        : '';
    })
    .filter(Boolean)
    .slice(0, 8);

  const medicalRecordText = context.medicalRecordText?.trim() || '';
  if (labReports.length === 0 && examReports.length === 0) {
    return '';
  }

  const parts: string[] = [];
  if (context.currentDiagnosis) {
    parts.push(`诊断参考：\n${context.currentDiagnosis}`);
  }

  if (medicalRecordText) {
    parts.push(`本次门诊病历全文：\n${medicalRecordText}`);
  }

  if (labReports.length > 0) {
    parts.push(`本次检验报告：\n${labReports.join('\n')}`);
  }

  if (examReports.length > 0) {
    parts.push(`本次检查报告：\n${examReports.join('\n')}`);
  }

  return parts.join('\n\n');
}

/** 报告回诊仅消费已确认的解读结论与必要病历摘要，避免重复传入全部报告明细。 */
export function buildOutpatientFollowUpTreatmentEvidence(
  context: HisOutpatientFollowUpContext | null | undefined,
): string {
  if (!context?.followUpEligible || !context.assessment) return '';

  const assessment = context.assessment;
  const parts = [
    `报告处置结论：${actionabilityLabel(assessment.actionability)}。${assessment.summary}`,
  ];
  if (assessment.problems.length > 0) {
    parts.push(`需处理问题：\n${assessment.problems.map((item) => (
      `- ${item.title}：${item.evidence}${item.urgency ? `（${item.urgency}）` : ''}`
    )).join('\n')}`);
  }
  if (assessment.actionability === 'needs_treatment' && assessment.medicationIntents.length > 0) {
    parts.push(`药物治疗意图（非处方）：\n${assessment.medicationIntents.map((item) => (
      `- ${item.indication}：优先${item.preferredGenericNames.join('、')}${item.route ? `；${item.route}` : ''}`
    )).join('\n')}`);
  }
  if (context.medicalRecordText?.trim()) {
    const record = context.medicalRecordText.trim();
    parts.push(`本次门诊病历：\n${record.slice(0, MAX_TREATMENT_RECORD_TEXT_LENGTH)}${
      record.length > MAX_TREATMENT_RECORD_TEXT_LENGTH ? '\n（病历正文已裁剪，报告处置结论优先）' : ''
    }`);
  }
  return parts.join('\n\n');
}

export function isOutpatientFollowUpActionable(
  context: HisOutpatientFollowUpContext | null | undefined,
): boolean {
  const actionability = context?.assessment?.actionability;
  return actionability === 'needs_follow_up' || actionability === 'needs_treatment';
}
