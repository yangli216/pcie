import type { OutpatientEmrAnalysisRequest, OutpatientEmrTemplateField, VoiceOutpatientEmrTemplateIdentity } from '../types';

export type ReviewedVoiceSections = Record<string, {
  chapterId?: string;
  fieldEditOnly?: boolean;
  supplement?: boolean;
  text: string;
  values?: Record<string, string | null>;
  error?: string;
}>;

/** Stored inside the existing patient- and visit-scoped voice editor snapshot. */
export interface VoiceOutpatientEmrReviewSnapshot extends VoiceOutpatientEmrTemplateIdentity {
  chapters: ReviewedVoiceSections[string][];
  fieldEdits: Record<string, string>;
}

// Bounded to one exact request. Keep this module free of browser/service imports
// so the session workflow can invalidate a collapsed draft without loading AI I/O.
export const voiceOutpatientEmrDraftCache: {
  draft: {
    request: OutpatientEmrAnalysisRequest;
    values: Record<string, string>;
    fields: OutpatientEmrTemplateField[];
    reviewedSections: ReviewedVoiceSections;
  } | null;
  epoch: number;
} = { draft: null, epoch: 0 };

export function clearVoiceOutpatientEmrRecordDraftCache(): void {
  voiceOutpatientEmrDraftCache.draft = null;
  voiceOutpatientEmrDraftCache.epoch += 1;
}
