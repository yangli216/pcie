import type {
  DiagnosisHint,
  TreatmentHint,
  VoiceExtractionResult,
  VoiceRecommendationPlan,
} from '@/prompts';
import type { ClinicalResultGenerationSection } from '@features/clinical-result';

export type VoiceIntentStreamEventName = ClinicalResultGenerationSection | 'done';

export interface VoiceIntentStreamEvent {
  event: VoiceIntentStreamEventName;
  data: unknown;
}

const EVENT_NAMES = new Set<VoiceIntentStreamEventName>([
  'record_core',
  'history_context',
  'record_suggestions',
  'explicit_orders',
  'diagnoses',
  'recommendation_plan',
  'record_extra',
  'done',
]);

const EXPLICIT_TREATMENT_TYPE_ALIASES = new Map<string, TreatmentHint['type']>([
  ['medicine', 'medicine'],
  ['examination', 'examination'],
  ['exam', 'examination'],
  ['labTest', 'labTest'],
  ['lab_test', 'labTest'],
  ['procedure', 'procedure'],
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export interface ExplicitTreatmentHintSanitization {
  hints: TreatmentHint[];
  warnings: string[];
}

/**
 * 明确医嘱属于可选高风险分区。无法确认类型或名称时宁可隔离该条，
 * 不猜测为药品/检查，也不让它取消已经可用的病例核心分区。
 */
export function sanitizeExplicitTreatmentHints(
  value: unknown,
  fieldName = 'explicitTreatmentHints',
): ExplicitTreatmentHintSanitization {
  if (typeof value === 'undefined' || value === null) {
    return { hints: [], warnings: [] };
  }
  if (!Array.isArray(value)) {
    return { hints: [], warnings: [`${fieldName} 必须是数组，已隔离该分区`] };
  }

  const hints: TreatmentHint[] = [];
  const warnings: string[] = [];
  value.forEach((item, index) => {
    if (!isObject(item)) {
      warnings.push(`${fieldName}[${index}] 必须是对象，已隔离该条医嘱`);
      return;
    }
    const rawType = typeof item.type === 'string' ? item.type.trim() : '';
    const type = EXPLICIT_TREATMENT_TYPE_ALIASES.get(rawType);
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!type) {
      warnings.push(`${fieldName}[${index}].type 不是可识别的字符串枚举，已隔离该条医嘱`);
      return;
    }
    if (!name) {
      warnings.push(`${fieldName}[${index}].name 不是非空字符串，已隔离该条医嘱`);
      return;
    }
    hints.push({
      ...item,
      type,
      name,
    } as TreatmentHint);
  });

  return { hints, warnings };
}

export function sanitizeVoiceExtractionTreatmentSections(payload: unknown): {
  payload: unknown;
  warnings: string[];
} {
  if (!isObject(payload)) {
    return { payload, warnings: [] };
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'explicitTreatmentHints')) {
    const sanitized = sanitizeExplicitTreatmentHints(payload.explicitTreatmentHints);
    return {
      payload: { ...payload, explicitTreatmentHints: sanitized.hints },
      warnings: sanitized.warnings,
    };
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'treatmentHints')) {
    const sanitized = sanitizeExplicitTreatmentHints(payload.treatmentHints, 'treatmentHints');
    return {
      payload: { ...payload, treatmentHints: sanitized.hints },
      warnings: sanitized.warnings,
    };
  }

  return { payload, warnings: [] };
}

function parseEventValue(value: unknown): VoiceIntentStreamEvent[] {
  if (Array.isArray(value)) {
    return value.flatMap(parseEventValue);
  }
  if (!isObject(value)) {
    return [];
  }
  if (Array.isArray(value.events)) {
    return value.events.flatMap(parseEventValue);
  }
  if (typeof value.event !== 'string' || !EVENT_NAMES.has(value.event as VoiceIntentStreamEventName)) {
    return [];
  }
  return [{
    event: value.event as VoiceIntentStreamEventName,
    data: value.data,
  }];
}

interface CompleteJsonValue {
  candidate: string;
  endIndex: number;
}

function findCompleteJsonValue(source: string): CompleteJsonValue | null {
  const startIndex = source.search(/[\[{]/u);
  if (startIndex < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      stack.push(char);
      continue;
    }
    if (char !== '}' && char !== ']') continue;
    const opening = stack.pop();
    if ((opening === '{' && char !== '}') || (opening === '[' && char !== ']')) {
      return {
        candidate: source.slice(startIndex, index + 1),
        endIndex: index + 1,
      };
    }
    if (stack.length === 0) {
      return {
        candidate: source.slice(startIndex, index + 1),
        endIndex: index + 1,
      };
    }
  }
  return null;
}

export function createVoiceIntentStreamParser(onEvent: (event: VoiceIntentStreamEvent) => void) {
  let buffer = '';

  function drain(): void {
    while (buffer) {
      const complete = findCompleteJsonValue(buffer);
      if (!complete) {
        const openerIndex = buffer.search(/[\[{]/u);
        if (openerIndex > 0) buffer = buffer.slice(openerIndex);
        return;
      }
      buffer = buffer.slice(complete.endIndex);
      try {
        parseEventValue(JSON.parse(complete.candidate) as unknown).forEach(onEvent);
      } catch {
        // 只丢弃当前已闭合但非法的候选，继续寻找后续合法事件。
      }
    }
  }

  return {
    push(chunk: string): void {
      buffer += chunk;
      drain();
    },
    flush(): void {
      drain();
      buffer = '';
    },
  };
}

export interface VoiceIntentStreamAccumulator {
  payload: VoiceExtractionResult;
  readySections: ClinicalResultGenerationSection[];
  eventCount: number;
  protocolWarnings: string[];
}

export function createVoiceIntentStreamAccumulator(): VoiceIntentStreamAccumulator {
  return {
    payload: {
      recordDraft: {
        chiefComplaint: '',
        historyOfPresentIllness: '',
        pastMedicalHistory: '',
        allergyHistory: '',
        currentMedicationHistory: '',
        personalHistory: '',
        menstrualHistory: '',
        maritalReproductiveHistory: '',
        familyHistory: '',
        physicalExam: '',
        symptoms: [],
        negativeSymptoms: [],
        treatmentPlan: '',
        healthEducation: '',
      },
      diagnosisHints: [],
      explicitTreatmentHints: [],
      error: false,
      message: '',
    },
    readySections: [],
    eventCount: 0,
    protocolWarnings: [],
  };
}

function markReady(accumulator: VoiceIntentStreamAccumulator, section: ClinicalResultGenerationSection): void {
  if (!accumulator.readySections.includes(section)) {
    accumulator.readySections.push(section);
  }
}

export function applyVoiceIntentStreamEvent(
  accumulator: VoiceIntentStreamAccumulator,
  event: VoiceIntentStreamEvent,
): void {
  accumulator.eventCount += 1;
  const recordDraft = accumulator.payload.recordDraft!;

  switch (event.event) {
    case 'record_core':
      if (isObject(event.data)) Object.assign(recordDraft, event.data);
      markReady(accumulator, 'record_core');
      break;
    case 'history_context':
      if (isObject(event.data)) Object.assign(recordDraft, event.data);
      markReady(accumulator, 'history_context');
      break;
    case 'record_suggestions':
      accumulator.payload.recordFactSuggestions = Array.isArray(event.data)
        ? event.data as NonNullable<VoiceExtractionResult['recordFactSuggestions']>
        : [];
      markReady(accumulator, 'record_suggestions');
      break;
    case 'explicit_orders':
      {
        const sanitized = sanitizeExplicitTreatmentHints(event.data, 'explicit_orders.data');
        accumulator.payload.explicitTreatmentHints = sanitized.hints;
        accumulator.protocolWarnings.push(...sanitized.warnings);
      }
      markReady(accumulator, 'explicit_orders');
      break;
    case 'diagnoses':
      accumulator.payload.diagnosisHints = Array.isArray(event.data)
        ? event.data as DiagnosisHint[]
        : [];
      markReady(accumulator, 'diagnoses');
      break;
    case 'recommendation_plan':
      if (isObject(event.data)) {
        accumulator.payload.recommendationPlan = event.data as unknown as VoiceRecommendationPlan;
      }
      markReady(accumulator, 'recommendation_plan');
      break;
    case 'record_extra':
      if (isObject(event.data)) Object.assign(recordDraft, event.data);
      markReady(accumulator, 'record_extra');
      break;
    case 'done':
      if (isObject(event.data)) {
        accumulator.payload.error = event.data.error === true;
        accumulator.payload.message = typeof event.data.message === 'string' ? event.data.message : '';
      }
      break;
  }
}
