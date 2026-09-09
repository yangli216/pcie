import type { ReportInterpretationTaskId } from '@/types/reportInterpretation';
import type { HisOutpatientFollowUpLabItem } from '@/services/his/types';
import type { HisOutpatientFollowUpReportApplication } from '@/services/his/types';

export interface ReportHistoryEntry {
  id: string;
  patientId?: string;
  visitId: string;
  visitTime: number;
  deptName?: string;
  diagnosisNames: string[];
  taskId: ReportInterpretationTaskId;
  title: string;
  reportTime?: string;
  reportId?: string;
  applicationId?: string;
  labItems?: HisOutpatientFollowUpLabItem[];
  applications?: HisOutpatientFollowUpReportApplication[];
  examFinding?: string;
  examConclusion?: string;
  reportUrl?: string;
  sourceQuery: string;
  available: boolean;
  isFollowUpSource: boolean;
}

export type ReportHistoryFilter = 'all' | 'lab' | 'exam';
