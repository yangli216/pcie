import { assertRequest, isZonedDate } from './publicHealthContract';
import type { FactSource, PublicHealthObservation, PublicHealthRequest } from '../types';

export const HEALTH_RISK_CODES = ['risk_level', 'hypertension_risk_level', 'diabetes_risk_level', 'cardiovascular_risk_level'] as const;
export const HEALTH_LIFESTYLE_LABELS = {
  smoking: '吸烟', alcohol: '饮酒', exercise: '运动', diet: '饮食',
  exerciseAbility: '运动能力', occupation: '职业',
} as const;
const observationLabels: Record<string, string> = {
  systolic_bp: '收缩压', diastolic_bp: '舒张压', fasting_glucose: '空腹血糖',
  height: '身高', weight: '体重', waist: '腰围', bmi: 'BMI',
  risk_level: '已有风险等级', hypertension_risk_level: '高血压风险等级',
  diabetes_risk_level: '糖尿病风险等级', cardiovascular_risk_level: '心血管风险等级',
};
export const healthObservationLabel = (code: string): string => observationLabels[code] || code;

export interface PublicHealthProfileEvidence {
  ref: string; label: string; value: string | number;
  unit?: string; observedAt?: string; source?: FactSource;
}
export interface PublicHealthProfileSource extends FactSource { observationIds: string[] }
export interface PublicHealthProfileConflict { code: string; observedAt: string; observationIds: string[] }
const copyObservation = (item: PublicHealthObservation): PublicHealthObservation => ({ ...item, source: { ...item.source } });

/** Compare the UTC second and decimal fraction separately so Date's millisecond precision loses no facts. */
export function compareHealthObservationTime(left: string, right: string): -1 | 0 | 1 {
  function time(value: string) {
    if (!isZonedDate(value)) throw new Error('公卫观察时间格式无效，请核对带时区的时间。');
    const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value)!;
    return { seconds: Date.parse(parts[1] + parts[3]) / 1000, fraction: (parts[2] || '').replace(/0+$/, '') };
  }
  const a = time(left), b = time(right);
  if (a.seconds !== b.seconds) return a.seconds < b.seconds ? -1 : 1;
  const digits = Math.max(a.fraction.length, b.fraction.length);
  const aFraction = a.fraction.padEnd(digits, '0'), bFraction = b.fraction.padEnd(digits, '0');
  return aFraction === bFraction ? 0 : aFraction < bFraction ? -1 : 1;
}

/** A projection of the caller's current snapshot, without fetching, inferred normal values or mutation. */
export function buildPublicHealthHealthProfile(request: PublicHealthRequest) {
  assertRequest(request);
  const excludedObservationIds: string[] = [];
  const observations = request.facts.observations.filter(item => {
    if (compareHealthObservationTime(item.observedAt, request.snapshotAt) <= 0) return true;
    excludedObservationIds.push(item.id);
    return false;
  });
  const byCode = new Map<string, PublicHealthObservation[]>();
  for (const item of observations) {
    const list = byCode.get(item.code) || [];
    list.push(item); byCode.set(item.code, list);
  }
  const latestObservations: PublicHealthObservation[] = [];
  const conflicts: PublicHealthProfileConflict[] = [];
  for (const [code, list] of byCode) {
    let latest = [list[0]];
    for (const item of list.slice(1)) {
      const order = compareHealthObservationTime(item.observedAt, latest[0].observedAt);
      if (order > 0) latest = [item];
      else if (order === 0) latest.push(item);
    }
    if (latest.some(item => item.value !== latest[0].value || item.unit !== latest[0].unit)) {
      conflicts.push({ code, observedAt: latest[0].observedAt, observationIds: latest.map(item => item.id) });
    } else latestObservations.push(copyObservation(latest[0]));
  }
  const conflictIds = new Set(conflicts.flatMap(item => item.observationIds));
  const sources: PublicHealthProfileSource[] = [];
  for (const item of observations) {
    let source = sources.find(source => source.system === item.source.system && source.recordId === item.source.recordId);
    if (!source) { source = { ...item.source, observationIds: [] }; sources.push(source); }
    source.observationIds.push(item.id);
  }
  const evidence: PublicHealthProfileEvidence[] = [{ ref: 'patient:ageYears', label: '年龄', value: request.patient.ageYears }];
  if (request.patient.sex !== 'unknown') evidence.push({ ref: 'patient:sex', label: '性别', value: request.patient.sex, ...(request.patient.sexSource ? { source: { ...request.patient.sexSource } } : {}) });
  for (const item of observations) {
    if (!conflictIds.has(item.id)) evidence.push({ ref: `observation:${item.id}`, label: healthObservationLabel(item.code), value: item.value,
      ...(item.unit ? { unit: item.unit } : {}), observedAt: item.observedAt, source: { ...item.source } });
  }
  request.facts.conditions.forEach((item, index) => evidence.push({ ref: `condition:${index}`, label: '健康状况', value: `${item.name}（${item.status}）` }));
  request.facts.medicationClasses.forEach((item, index) => evidence.push({ ref: `medication:${index}`, label: '已提供用药类别', value: item.name }));
  for (const [key, label] of Object.entries(HEALTH_LIFESTYLE_LABELS)) {
    const value = request.facts.lifestyle[key as keyof typeof HEALTH_LIFESTYLE_LABELS];
    if (value?.trim()) evidence.push({ ref: `lifestyle:${key}`, label, value });
  }
  if (request.facts.historySummary?.trim()) evidence.push({ ref: 'historySummary', label: '病史与补充摘要', value: request.facts.historySummary });
  return {
    patient: { ...request.patient, ...(request.patient.sexSource ? { sexSource: { ...request.patient.sexSource } } : {}) },
    snapshotAt: request.snapshotAt,
    conditions: request.facts.conditions.map(item => ({ ...item })),
    medicationClasses: request.facts.medicationClasses.map(item => ({ ...item })),
    lifestyle: { ...request.facts.lifestyle },
    ...(request.facts.historySummary ? { historySummary: request.facts.historySummary } : {}),
    ...(request.facts.nextFollowUpDate ? { nextFollowUpDate: request.facts.nextFollowUpDate } : {}),
    latestObservations,
    knownRiskAssessments: latestObservations.filter(item => (HEALTH_RISK_CODES as readonly string[]).includes(item.code)).map(copyObservation),
    sources, evidence, excludedObservationIds, conflicts,
  };
}
export type PublicHealthHealthProfile = ReturnType<typeof buildPublicHealthHealthProfile>;
