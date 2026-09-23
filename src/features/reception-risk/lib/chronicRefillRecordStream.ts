import type { ClinicalResultGenerationSection } from '@features/clinical-result';

export type ChronicRefillRecordStreamEventName =
  | 'record_core'
  | 'medication_scope'
  | 'review_plan'
  | 'recommended_medicines'
  | 'record_extra'
  | 'done';

export interface ChronicRefillRecordStreamEvent {
  event: ChronicRefillRecordStreamEventName;
  data: unknown;
}

export interface ChronicRefillRecordStreamAccumulator<TDraft extends object> {
  draft: TDraft;
  readySections: ClinicalResultGenerationSection[];
  eventCount: number;
}

const EVENT_NAMES = new Set<ChronicRefillRecordStreamEventName>([
  'record_core',
  'medication_scope',
  'review_plan',
  'recommended_medicines',
  'record_extra',
  'done',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseEventLine(line: string): ChronicRefillRecordStreamEvent | null {
  const normalized = line.trim().replace(/^```(?:json)?\s*/u, '').replace(/```$/u, '').trim();
  if (!normalized) return null;
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (
      !isObject(parsed)
      || typeof parsed.event !== 'string'
      || !EVENT_NAMES.has(parsed.event as ChronicRefillRecordStreamEventName)
    ) {
      return null;
    }
    return {
      event: parsed.event as ChronicRefillRecordStreamEventName,
      data: parsed.data,
    };
  } catch {
    return null;
  }
}

export function createChronicRefillRecordStreamParser(
  onEvent: (event: ChronicRefillRecordStreamEvent) => void,
) {
  let buffer = '';
  const consumeLine = (line: string) => {
    const event = parseEventLine(line);
    if (event) onEvent(event);
  };

  return {
    push(chunk: string): void {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() || '';
      lines.forEach(consumeLine);
    },
    flush(): void {
      if (buffer.trim()) consumeLine(buffer);
      buffer = '';
    },
  };
}

export function createChronicRefillRecordStreamAccumulator<TDraft extends object>(
  draft: TDraft,
): ChronicRefillRecordStreamAccumulator<TDraft> {
  return { draft, readySections: [], eventCount: 0 };
}

function markReady<TDraft extends object>(
  accumulator: ChronicRefillRecordStreamAccumulator<TDraft>,
  section: ClinicalResultGenerationSection,
): void {
  if (!accumulator.readySections.includes(section)) accumulator.readySections.push(section);
}

export function applyChronicRefillRecordStreamEvent<TDraft extends object>(
  accumulator: ChronicRefillRecordStreamAccumulator<TDraft>,
  event: ChronicRefillRecordStreamEvent,
): void {
  accumulator.eventCount += 1;
  const draft = accumulator.draft as Record<string, unknown>;
  switch (event.event) {
    case 'record_core':
      if (isObject(event.data)) Object.assign(draft, event.data);
      markReady(accumulator, 'record_core');
      markReady(accumulator, 'history_context');
      markReady(accumulator, 'diagnoses');
      break;
    case 'review_plan':
      draft.reviewPlan = event.data;
      markReady(accumulator, 'review_plan');
      break;
    case 'medication_scope':
      draft.medicationScope = event.data;
      break;
    case 'recommended_medicines':
      draft.recommendedMedicines = Array.isArray(event.data) ? event.data : [];
      markReady(accumulator, 'recommended_medicines');
      break;
    case 'record_extra':
      if (isObject(event.data)) Object.assign(draft, event.data);
      markReady(accumulator, 'record_extra');
      break;
    case 'done':
      break;
  }
}
