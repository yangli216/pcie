import type { OutpatientEmrAnalysisRequest } from '../types';

// Bounded to one exact request. Keep this module free of browser/service imports
// so the session workflow can invalidate a collapsed draft without loading AI I/O.
export const voiceOutpatientEmrDraftCache: {
  draft: { request: OutpatientEmrAnalysisRequest; values: Record<string, string> } | null;
  epoch: number;
} = { draft: null, epoch: 0 };

export function clearVoiceOutpatientEmrRecordDraftCache(): void {
  voiceOutpatientEmrDraftCache.draft = null;
  voiceOutpatientEmrDraftCache.epoch += 1;
}
