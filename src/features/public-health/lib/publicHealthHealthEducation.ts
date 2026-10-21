import { characterCount } from './publicHealthContract';
import { buildPublicHealthHealthProfile, compareHealthObservationTime, type PublicHealthHealthProfile, type PublicHealthProfileEvidence } from './publicHealthHealthProfile';
import type { PublicHealthPatient, PublicHealthRequest } from '../types';

export interface HealthCheckRule {
  code: string; name: string; prep: string; minIntervalDays: number; abnormalRetestIntervalDays: number;
  abnormalCriteria?: Array<{ observationCode: string; unit: string; operator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; threshold: number; maxEvidenceAgeDays: number }>;
  eligibility?: { minAgeYears?: number; maxAgeYears?: number; sexes?: Array<Exclude<PublicHealthPatient['sex'], 'unknown'>>; conditionCodes?: string[]; riskLevels?: string[] };
}
export interface HealthPrescriptionPolicy {
  checkWhitelist: HealthCheckRule[];
  medicationReminders: Record<string, string>;
  lifestyleRules: string[];
}

function invalid(): never { throw new Error('生成内容或机构规则格式无效，请重新生成并由医生核对。'); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.prototype.hasOwnProperty.call(result, key) || result[key] === undefined || result[key] === null)) return invalid();
  return result;
}
function string(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || characterCount(value) > max) return invalid();
  return value;
}
function strings(value: unknown, maxItems: number, maxLength: number, minItems = 0): string[] {
  if (!Array.isArray(value) || value.length < minItems || value.length > maxItems) return invalid();
  const result = value.map(item => string(item, maxLength));
  if (new Set(result).size !== result.length) return invalid();
  return result;
}
function identifier(value: unknown, max: number): string {
  const result = string(value, max);
  if (result.trim() !== value) return invalid();
  return result;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) return invalid();
  return value as T;
}
function boundedText(text: string): string {
  if (!text.trim() || characterCount(text) > 16000) return invalid();
  return text;
}
function doctorDraft(value: unknown, required: readonly string[], onDoctorNote?: (message: string) => void): Record<string, unknown> {
  const draft = object(value, required, ['doctorNotes']);
  if (draft.doctorNotes !== undefined && (!Array.isArray(draft.doctorNotes) || draft.doctorNotes.length > 8)) return invalid();
  const notes = draft.doctorNotes === undefined ? [] : (draft.doctorNotes as unknown[]).map(note => string(note, 1000));
  notes.forEach(note => onDoctorNote?.(note));
  return draft;
}
function evidenceText(evidence: PublicHealthProfileEvidence, snapshotAt: string): string {
  const value = evidence.ref === 'patient:sex' ? ({ male: '男', female: '女' } as Record<string, string>)[String(evidence.value)] : evidence.value;
  return `${evidence.label}：${value}${evidence.unit ? ` ${evidence.unit}` : ''}；${evidence.observedAt ? `观察时间：${evidence.observedAt}` : `资料快照：${snapshotAt}`}${evidence.source ? `；来源：${evidence.source.system} / 记录：${evidence.source.recordId}` : ''}`;
}

/** Render a strict internal AI draft into the existing lifestyle_guidance text section. */
export function renderHealthEducationDraft(value: unknown, profile: PublicHealthHealthProfile, onDoctorNote?: (message: string) => void): string {
  const draft = doctorDraft(value, ['risks', 'prevention', 'diet', 'exercise', 'followup', 'missingFacts'], onDoctorNote);
  if (!Array.isArray(draft.risks) || draft.risks.length > 6) return invalid();
  const available = new Map(profile.evidence.map(item => [item.ref, item]));
  const risks = draft.risks.map((value, index) => {
    const risk = object(value, ['type', 'name', 'concern', 'evidenceRefs', 'intervention']);
    const type = enumValue(risk.type, ['progression', 'complication']);
    const name = string(risk.name, 100), intervention = string(risk.intervention, 1000);
    const concern = enumValue(risk.concern, ['attention', 'needs_assessment']);
    const refs = strings(risk.evidenceRefs, 16, 256, 1);
    if ((risk.evidenceRefs as unknown[]).some((ref, i) => ref !== refs[i]) || refs.some(ref => !available.has(ref))) return invalid();
    onDoctorNote?.(`${index + 1}. ${name}（${type === 'progression' ? '慢病进展' : '并发症'}；${concern === 'attention' ? '关注' : '待评估'}；AI 定性分析，不表示概率或诊断）\n证据：${refs.map(ref => evidenceText(available.get(ref)!, profile.snapshotAt)).join('；')}`);
    return intervention;
  });
  const topics = [
    ['prevention', '疾病预防'], ['diet', '饮食建议'], ['exercise', '运动建议'],
    ['followup', '随访安排'],
  ] as const;
  const adviceTopics = topics.map(([key, title]) => ({ title, advice: strings(draft[key], 8, 1000) }));
  const missing = strings(draft.missingFacts, 8, 1000);
  missing.forEach(item => onDoctorNote?.(`待补充资料：${item}`));
  if (!risks.length) onDoctorNote?.('本次未生成可核实的潜在风险条目；不能据此判断无风险，请医生结合资料评估。');
  if (!risks.length && adviceTopics.every(topic => !topic.advice.length)) {
    onDoctorNote?.('本次资料不足以生成健康教育条目，请医生核对并补充资料。');
    return '';
  }
  const blocks = risks.length ? [`健康管理\n${risks.map((item, i) => `${i + 1}. ${item}`).join('\n')}`] : [];
  for (const { title, advice } of adviceTopics) {
    if (advice.length) blocks.push(`${title}\n${advice.map((item, i) => `${i + 1}. ${item}`).join('\n')}`);
  }
  return boundedText(blocks.join('\n\n'));
}

function integer(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return invalid();
  return value;
}
function validatePolicy(policy: HealthPrescriptionPolicy): void {
  const raw = object(policy, ['checkWhitelist', 'medicationReminders', 'lifestyleRules']);
  if (!Array.isArray(raw.checkWhitelist) || !raw.checkWhitelist.length || raw.checkWhitelist.length > 1000) return invalid();
  const codes = new Set<string>();
  for (const item of raw.checkWhitelist) {
    const rule = object(item, ['code', 'name', 'prep', 'minIntervalDays', 'abnormalRetestIntervalDays'], ['abnormalCriteria', 'eligibility']);
    const code = identifier(rule.code, 128);
    if (codes.has(code)) return invalid();
    codes.add(code);
    string(rule.name, 200); string(rule.prep, 2000);
    integer(rule.minIntervalDays, 36500); integer(rule.abnormalRetestIntervalDays, 36500);
    if (Object.prototype.hasOwnProperty.call(rule, 'abnormalCriteria')) {
      if (!Array.isArray(rule.abnormalCriteria) || !rule.abnormalCriteria.length || rule.abnormalCriteria.length > 32) return invalid();
      for (const value of rule.abnormalCriteria) {
        const criterion = object(value, ['observationCode', 'unit', 'operator', 'threshold', 'maxEvidenceAgeDays']);
        identifier(criterion.observationCode, 128); identifier(criterion.unit, 64);
        enumValue(criterion.operator, ['gt', 'gte', 'lt', 'lte', 'eq']); integer(criterion.maxEvidenceAgeDays, 36500);
        if (typeof criterion.threshold !== 'number' || !Number.isFinite(criterion.threshold)) return invalid();
      }
    }
    if (Object.prototype.hasOwnProperty.call(rule, 'eligibility')) {
      const eligibility = object(rule.eligibility, [], ['minAgeYears', 'maxAgeYears', 'sexes', 'conditionCodes', 'riskLevels']);
      if (Object.prototype.hasOwnProperty.call(eligibility, 'minAgeYears')) integer(eligibility.minAgeYears, 130);
      if (Object.prototype.hasOwnProperty.call(eligibility, 'maxAgeYears')) integer(eligibility.maxAgeYears, 130);
      if (eligibility.minAgeYears !== undefined && eligibility.maxAgeYears !== undefined && Number(eligibility.minAgeYears) > Number(eligibility.maxAgeYears)) return invalid();
      if (Object.prototype.hasOwnProperty.call(eligibility, 'sexes')) {
        for (const sex of strings(eligibility.sexes, 2, 10, 1)) enumValue(sex, ['male', 'female']);
      }
      for (const key of ['conditionCodes', 'riskLevels']) if (Object.prototype.hasOwnProperty.call(eligibility, key)) {
        const values = strings(eligibility[key], 64, 128, 1);
        if ((eligibility[key] as unknown[]).some((value, i) => value !== values[i])) return invalid();
      }
    }
  }
  if (!raw.medicationReminders || typeof raw.medicationReminders !== 'object' || Array.isArray(raw.medicationReminders)) return invalid();
  for (const [key, value] of Object.entries(raw.medicationReminders)) { identifier(key, 128); string(value, 16000); }
  strings(raw.lifestyleRules, 128, 2000, 1);
}
function eligible(rule: HealthCheckRule, request: PublicHealthRequest, profile: PublicHealthHealthProfile): boolean {
  const limits = rule.eligibility;
  return !limits || (limits.minAgeYears === undefined || request.patient.ageYears >= limits.minAgeYears)
    && (limits.maxAgeYears === undefined || request.patient.ageYears <= limits.maxAgeYears)
    && (!limits.sexes || request.patient.sex !== 'unknown' && limits.sexes.includes(request.patient.sex))
    && (!limits.conditionCodes || request.facts.conditions.some(item => limits.conditionCodes!.includes(item.code)))
    && (!limits.riskLevels || profile.knownRiskAssessments.some(item => limits.riskLevels!.includes(String(item.value))));
}
/** Filter approved rules before the model call; no matching rules is a valid empty list. */
export function eligibleHealthChecks(request: PublicHealthRequest, policy: HealthPrescriptionPolicy): HealthCheckRule[] {
  validatePolicy(policy);
  const profile = buildPublicHealthHealthProfile(request);
  return policy.checkWhitelist.filter(rule => eligible(rule, request, profile));
}
const DAY_MS = 86400000;
function dateDay(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const date = new Date(0);
  const [year, month, day] = value.split('-').map(Number);
  date.setUTCFullYear(year, month - 1, day); date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return invalid();
  return date.getTime();
}
function compare(value: number, criterion: NonNullable<HealthCheckRule['abnormalCriteria']>[number]): boolean {
  switch (criterion.operator) {
    case 'gt': return value > criterion.threshold;
    case 'gte': return value >= criterion.threshold;
    case 'lt': return value < criterion.threshold;
    case 'lte': return value <= criterion.threshold;
    case 'eq': return value === criterion.threshold;
  }
}

export interface HealthCheckScheduleConstraint {
  code: string; routineEarliestDate: string; routineAvailable: boolean;
  abnormalRetestAvailable: boolean; abnormalRetestEarliestDate?: string;
}

/** Deterministic model input; the model output is still independently checked against the full policy. */
export function buildHealthCheckSchedule(request: PublicHealthRequest, policy: HealthPrescriptionPolicy): HealthCheckScheduleConstraint[] {
  validatePolicy(policy);
  const profile = buildPublicHealthHealthProfile(request);
  const day = dateDay(request.snapshotAt.slice(0, 10)), windowEnd = day + 90 * DAY_MS;
  const existingEvidence = new Set(profile.evidence.map(item => item.ref));
  const evidence = request.facts.observations.filter(obs => existingEvidence.has(`observation:${obs.id}`));
  const formatDate = (value: number) => new Date(value).toISOString().split('T')[0];
  return policy.checkWhitelist.filter(rule => eligible(rule, request, profile)).map(rule => {
    const priorDays = request.facts.observations.filter(obs => obs.code === rule.code
      && compareHealthObservationTime(obs.observedAt, request.snapshotAt) <= 0).map(obs => dateDay(obs.observedAt.slice(0, 10)));
    const latest = priorDays.length ? Math.max(...priorDays) : undefined;
    const earliest = (interval: number) => latest === undefined ? day : Math.max(day, latest + interval * DAY_MS);
    const routineEarliest = earliest(rule.minIntervalDays);
    const constraint: HealthCheckScheduleConstraint = { code: rule.code, routineEarliestDate: formatDate(routineEarliest),
      routineAvailable: routineEarliest <= windowEnd, abnormalRetestAvailable: false };
    const supportsRetest = Boolean(rule.abnormalCriteria?.length && rule.abnormalCriteria.every(criterion => evidence.some(obs => {
      const age = (day - dateDay(obs.observedAt.slice(0, 10))) / DAY_MS;
      return obs.code === criterion.observationCode && obs.unit === criterion.unit && typeof obs.value === 'number'
        && age >= 0 && age <= criterion.maxEvidenceAgeDays && compare(obs.value, criterion);
    })));
    if (supportsRetest) {
      const abnormalEarliest = earliest(rule.abnormalRetestIntervalDays);
      constraint.abnormalRetestEarliestDate = formatDate(abnormalEarliest);
      constraint.abnormalRetestAvailable = abnormalEarliest <= windowEnd;
    }
    return constraint;
  });
}

export function renderHealthCheckPlan(value: unknown, request: PublicHealthRequest, policy: HealthPrescriptionPolicy, onDoctorNote?: (message: string) => void): string {
  validatePolicy(policy);
  const raw = doctorDraft(value, ['checks'], onDoctorNote);
  if (!Array.isArray(raw.checks) || raw.checks.length > 100) return invalid();
  const profile = buildPublicHealthHealthProfile(request);
  const rules = new Map(policy.checkWhitelist.filter(rule => eligible(rule, request, profile)).map(rule => [rule.code, rule]));
  const evidenceRefs = new Map(profile.evidence.map(item => [item.ref, item]));
  const available = new Map(request.facts.observations.filter(item => evidenceRefs.has(`observation:${item.id}`)).map(item => [item.id, item]));
  const day = dateDay(request.snapshotAt.slice(0, 10)), seen = new Set<string>();
  const checks = raw.checks.map(value => {
    const item = object(value, ['code', 'plannedDate', 'priority', 'reason', 'evidenceObservationIds', 'intervalKind'], ['evidenceRefs']);
    const code = identifier(item.code, 128), rule = rules.get(code);
    if (!rule || seen.has(code)) return invalid();
    seen.add(code);
    const plan = dateDay(item.plannedDate);
    if (plan < day || plan > day + 90 * DAY_MS) return invalid();
    const priority = enumValue(item.priority, ['low', 'medium', 'high']);
    const reason = string(item.reason, 2000);
    const ids = strings(item.evidenceObservationIds, 64, 128);
    if ((item.evidenceObservationIds as unknown[]).some((id, i) => id !== ids[i]) || ids.some(id => !available.has(id))) return invalid();
    const refs = Object.prototype.hasOwnProperty.call(item, 'evidenceRefs') ? strings(item.evidenceRefs, 16, 256, 1) : [];
    if ((!ids.length && !refs.length) || refs.some(ref => !evidenceRefs.has(ref))
      || ids.some(id => refs.includes(`observation:${id}`))) return invalid();
    const observationEvidence = ids.map(id => available.get(id)!);
    const intervalKind = enumValue(item.intervalKind, ['routine', 'abnormal_retest']);
    let interval = rule.minIntervalDays;
    if (intervalKind === 'abnormal_retest') {
      if (!rule.abnormalCriteria?.length || !rule.abnormalCriteria.every(criterion => observationEvidence.some(obs => {
        const age = (day - dateDay(obs.observedAt.slice(0, 10))) / DAY_MS;
        return obs.code === criterion.observationCode && obs.unit === criterion.unit && typeof obs.value === 'number'
          && age >= 0 && age <= criterion.maxEvidenceAgeDays && compare(obs.value, criterion);
      }))) return invalid();
      interval = rule.abnormalRetestIntervalDays;
    }
    const priorObservations = request.facts.observations.filter(obs => obs.code === code && compareHealthObservationTime(obs.observedAt, request.snapshotAt) <= 0);
    for (const obs of priorObservations) if (plan < dateDay(obs.observedAt.slice(0, 10)) + interval * DAY_MS) return invalid();
    const baselineNote = !priorObservations.length ? '\n既往结果：尚未提供本项目既往结果。'
      : profile.conflicts.some(conflict => conflict.code === code) ? '\n既往结果：本项目最新结果存在冲突，请医生核对。' : '';
    const citedRefs = [...ids.map(id => `observation:${id}`), ...refs];
    onDoctorNote?.(`${rule.name} · ${item.plannedDate}\n优先级：${({ high: '高', medium: '中', low: '低' })[priority]}\n依据：${reason}\n证据：${citedRefs.map(ref => evidenceText(evidenceRefs.get(ref)!, profile.snapshotAt)).join('；')}${baselineNote}`);
    const preparation = rule.prep;
    return `${rule.name} · ${item.plannedDate}${preparation ? `\n准备事项：${preparation}` : ''}`;
  });
  if (!checks.length) { onDoctorNote?.('本次未生成检查计划，请医生核对资料及适用检查目录。'); return ''; }
  return boundedText(checks.join('\n\n'));
}

export function renderHealthMedicationGuidance(value: unknown, request: PublicHealthRequest, policy: HealthPrescriptionPolicy, onDoctorNote?: (message: string) => void): string {
  validatePolicy(policy);
  buildPublicHealthHealthProfile(request);
  const raw = doctorDraft(value, ['medicationGuidance'], onDoctorNote);
  if (!Array.isArray(raw.medicationGuidance) || raw.medicationGuidance.length > 64) return invalid();
  const provided = new Map(request.facts.medicationClasses.map(item => [item.code, item.name]));
  const seen = new Set<string>();
  const blocks = raw.medicationGuidance.map(value => {
    const item = object(value, ['classCode', 'content']);
    const code = identifier(item.classCode, 128), name = provided.get(code) ?? code;
    if (seen.has(code) || !Object.prototype.hasOwnProperty.call(policy.medicationReminders, code)) return invalid();
    seen.add(code);
    onDoctorNote?.(`${name}：${policy.medicationReminders[code]}`);
    return `${name}\n${string(item.content, 16000)}`;
  });
  if (!blocks.length) { onDoctorNote?.('本次未生成可回写的用药指导，请医生核对用药信息及适用规则。'); return ''; }
  return boundedText(blocks.join('\n\n'));
}
