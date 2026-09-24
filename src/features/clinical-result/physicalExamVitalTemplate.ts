import { buildPhysicalExamMeasurements } from './lib/physicalExamMeasurements';

export const PHYSICAL_EXAM_VITAL_SCHEMA_VERSION = 'outpatient-record-physical-exam-vitals.v1' as const;

export const DEFAULT_PHYSICAL_EXAM_VITAL_TEMPLATE =
  'T:{体温}℃ P:{脉搏}次/分 R:{呼吸}次/分 Bp:{收缩压}/{舒张压}mmHg。' as const;

export type PhysicalExamVitalSlotKey =
  | 'temperature'
  | 'pulse'
  | 'respiration'
  | 'systolicBloodPressure'
  | 'diastolicBloodPressure';

export interface PhysicalExamVitalValues {
  temperature?: string;
  pulse?: string;
  respiration?: string;
  systolicBloodPressure?: string;
  diastolicBloodPressure?: string;
}

export interface PhysicalExamVitalSignItem {
  slotKey: PhysicalExamVitalSlotKey;
  value: string;
  unit: '℃' | '次/分' | 'mmHg';
  marker: string;
}

export interface PhysicalExamVitalSigns {
  schemaVersion: typeof PHYSICAL_EXAM_VITAL_SCHEMA_VERSION;
  items: PhysicalExamVitalSignItem[];
}

function normalizeSource(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/／/gu, '/').replace(/：/gu, ':').replace(/\s+/gu, ' ').trim()
    : '';
}

function normalizeNumber(value: string, min: number, max: number): string | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return undefined;
  return String(numeric);
}

function readLastMatch(
  source: string,
  pattern: RegExp,
  min: number,
  max: number,
): string | undefined {
  let result: string | undefined;
  for (const match of source.matchAll(pattern)) {
    const normalized = normalizeNumber(match[1] || '', min, max);
    if (normalized) result = normalized;
  }
  return result;
}

export function extractPhysicalExamVitalValues(
  ...sources: Array<string | undefined | null>
): PhysicalExamVitalValues {
  return sources.reduce<PhysicalExamVitalValues>((values, rawSource) => {
    const source = normalizeSource(rawSource);
    if (!source) return values;

    const bloodPressureMatches = Array.from(source.matchAll(
      /(?:血压|\bBP)\s*[:=]?\s*\{?(\d{2,3})\}?\s*\/\s*\{?(\d{2,3})\}?\s*(?:mmHg)?/giu,
    ));
    const bloodPressure = bloodPressureMatches[bloodPressureMatches.length - 1];
    const systolic = bloodPressure
      ? normalizeNumber(bloodPressure[1] || '', 40, 300)
      : readLastMatch(source, /收缩压\s*[:=]?\s*\{?(\d{2,3})\}?\s*(?:mmHg)?/gu, 40, 300);
    const diastolic = bloodPressure
      ? normalizeNumber(bloodPressure[2] || '', 20, 200)
      : readLastMatch(source, /舒张压\s*[:=]?\s*\{?(\d{2,3})\}?\s*(?:mmHg)?/gu, 20, 200);
    const temperature = readLastMatch(
      source,
      /(?:体温|(?:^|[\s,，;；])T)\s*[:=]?\s*\{?(\d{2}(?:\.\d+)?)\}?\s*(?:℃|度)?/giu,
      30,
      45,
    );
    const pulse = readLastMatch(
      source,
      /(?:脉搏|心率|(?:^|[\s,，;；])P)\s*(?:每分钟)?\s*[:=]?\s*\{?(\d{2,3})\}?\s*(?:次\/?分|次每分|次|bpm)?/giu,
      20,
      250,
    );
    const respiration = readLastMatch(
      source,
      /(?:呼吸(?:频率)?|(?:^|[\s,，;；])R)\s*(?:每分钟)?\s*[:=]?\s*\{?(\d{1,2})\}?\s*(?:次\/?分|次每分|次)?/giu,
      5,
      80,
    );

    return {
      ...values,
      ...(temperature ? { temperature } : {}),
      ...(pulse ? { pulse } : {}),
      ...(respiration ? { respiration } : {}),
      ...(systolic ? { systolicBloodPressure: systolic } : {}),
      ...(diastolic ? { diastolicBloodPressure: diastolic } : {}),
    };
  }, {});
}

function marker(value: string | undefined, placeholder: string): string {
  return `{${value || placeholder}}`;
}

export function formatPhysicalExamVitalTemplate(values: PhysicalExamVitalValues = {}): string {
  return [
    `T:${marker(values.temperature, '体温')}℃`,
    `P:${marker(values.pulse, '脉搏')}次/分`,
    `R:${marker(values.respiration, '呼吸')}次/分`,
    `Bp:${marker(values.systolicBloodPressure, '收缩压')}/${marker(values.diastolicBloodPressure, '舒张压')}mmHg。`,
  ].join(' ');
}

export function stripPhysicalExamVitalNarrative(value: string): string {
  return value
    .replace(/T\s*[:：]\s*\{?[^\s，,；;。]+\}?℃\s*P\s*[:：]\s*\{?[^\s，,；;。]+\}?(?:次\/?分)\s*R\s*[:：]\s*\{?[^\s，,；;。]+\}?(?:次\/?分)\s*Bp\s*[:：]\s*\{?[^\s，,；;。/]+\}?\s*[／/]\s*\{?[^\s，,；;。]+\}?\s*mmHg[。.]?/giu, '')
    .replace(/(?:体温)\s*[:：]?\s*\{?\d{2}(?:\.\d+)?\}?\s*(?:℃|度)[，,；;。]?/giu, '')
    .replace(/(?:脉搏|心率)\s*(?:每分钟)?\s*[:：]?\s*\{?\d{2,3}\}?\s*(?:次\/?分|次每分|次|bpm)[，,；;。]?/giu, '')
    .replace(/(?:呼吸(?:频率)?)\s*(?:每分钟)?\s*[:：]?\s*\{?\d{1,2}\}?\s*(?:次\/?分|次每分|次)[，,；;。]?/giu, '')
    .replace(/(?:血压|BP)\s*[:：]?\s*\{?\d{2,3}\}?\s*[／/]\s*\{?\d{2,3}\}?\s*(?:mmHg)?[，,；;。]?/giu, '')
    .replace(/(?:收缩压|高压)\s*[:：]?\s*\{?\d{2,3}\}?\s*(?:mmHg)?[，,；;。]?/giu, '')
    .replace(/(?:舒张压|低压)\s*[:：]?\s*\{?\d{2,3}\}?\s*(?:mmHg)?[，,；;。]?/giu, '')
    .replace(/\bT\s*[:：]?\s*\{?\d{2}(?:\.\d+)?\}?\s*(?:℃|度)[，,；;。]?/giu, '')
    .replace(/\bP\s*[:：]?\s*\{?\d{2,3}\}?\s*(?:次\/?分|次每分|次|bpm)[，,；;。]?/giu, '')
    .replace(/\bR\s*[:：]?\s*\{?\d{1,2}\}?\s*(?:次\/?分|次每分|次)[，,；;。]?/giu, '')
    .replace(/^[\s，,；;。]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Returns only descriptive examination text for PHIS "other physical exam" fields.
 * The complete physical-exam record keeps these measurements; this projection removes
 * them because PHIS templates may bind them to dedicated fields.
 */
export function stripPhysicalExamStructuredNarrative(value: string): string {
  return stripPhysicalExamVitalNarrative(value)
    .replace(/身高\s*[:：]?\s*\{?(?:身高|\d+(?:\.\d+)?)\}?\s*(?:cm|厘米)[，,；;。]?/giu, '')
    .replace(/体重\s*[:：]?\s*\{?(?:体重|\d+(?:\.\d+)?)\}?\s*(?:kg|公斤|千克)[，,；;。]?/giu, '')
    .replace(/腰围\s*[:：]?\s*\{?(?:腰围|\d+(?:\.\d+)?)\}?\s*(?:cm|厘米)[，,；;。]?/giu, '')
    .replace(/([。])[，,；;]+/gu, '$1')
    .replace(/[，,；;]+(?=[。])/gu, '')
    .replace(/^[\s，,；;。]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function buildPhysicalExamWithVitalTemplate(input: {
  physicalExam?: string;
  vitals?: string;
  measurementContext?: string;
}): string {
  const physicalExam = normalizeSource(input.physicalExam);
  const values = extractPhysicalExamVitalValues(physicalExam, input.vitals);
  const detail = buildPhysicalExamMeasurements(
    stripPhysicalExamVitalNarrative(physicalExam), input.vitals || '', input.measurementContext || '',
  );
  const vitalTemplate = formatPhysicalExamVitalTemplate(values);
  return detail ? `${vitalTemplate}${detail}` : vitalTemplate;
}

export function collectPhysicalExamVitalSigns(
  physicalExam: string,
): PhysicalExamVitalSigns | undefined {
  const values = extractPhysicalExamVitalValues(physicalExam);
  const definitions: Array<{
    slotKey: PhysicalExamVitalSlotKey;
    value?: string;
    unit: PhysicalExamVitalSignItem['unit'];
  }> = [
    { slotKey: 'temperature', value: values.temperature, unit: '℃' },
    { slotKey: 'pulse', value: values.pulse, unit: '次/分' },
    { slotKey: 'respiration', value: values.respiration, unit: '次/分' },
    { slotKey: 'systolicBloodPressure', value: values.systolicBloodPressure, unit: 'mmHg' },
    { slotKey: 'diastolicBloodPressure', value: values.diastolicBloodPressure, unit: 'mmHg' },
  ];
  const items = definitions
    .filter((item): item is typeof item & { value: string } => Boolean(item.value))
    .map((item) => ({
      slotKey: item.slotKey,
      value: item.value,
      unit: item.unit,
      marker: `{${item.value}}`,
    }));

  return items.length > 0
    ? { schemaVersion: PHYSICAL_EXAM_VITAL_SCHEMA_VERSION, items }
    : undefined;
}
