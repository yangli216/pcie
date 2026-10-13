import type {
  PublicHealthCapability, PublicHealthConfirmed, PublicHealthFeedback, PublicHealthIdentity,
  PublicHealthManualFacts, PublicHealthMetrics, PublicHealthRequest, PublicHealthResult,
  PublicHealthSection, PublicHealthSectionId,
} from '../types';
import { assertGeneratedExerciseContent, assertPatientFacingContent } from './publicHealthPatientText';

export const CAPABILITY_TITLES = { health_prescription: '随访健康处方', weight_management: '智能减重助手' } as const;
export const SCENE_TITLES = { hypertension_followup: '高血压随访', diabetes_followup: '糖尿病随访', elderly_exam: '老年人体检' } as const;
export const SECTION_TITLES = {
  check_plan: '检查计划', medication_guidance: '用药指导', lifestyle_guidance: '生活方式建议',
  exercise_plan: '运动建议', meal_plan: '食谱推荐',
} as const;
export const SECTION_IDS: Record<PublicHealthCapability, PublicHealthSectionId[]> = {
  health_prescription: ['check_plan', 'medication_guidance', 'lifestyle_guidance'],
  weight_management: ['exercise_plan', 'meal_plan'],
};
const IDENTITY_KEYS = ['requestId', 'originRequestId', 'capability', 'scene', 'patientId', 'businessRecordId', 'recordVersion', 'snapshotAt'] as const;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value);
const isDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};
export const isZonedDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && isDate(value.slice(0, 10)) && Number(value.slice(11, 13)) <= 23 && Number(value.slice(14, 16)) <= 59
  && Number(value.slice(17, 19)) <= 59 && Number.isFinite(Date.parse(value));
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
// OpenAPI maxLength and the Java boundary count Unicode code points, not UTF-16 units.
export const characterCount = (value: string): number => Array.from(value).length;
const textWithin = (value: unknown, max: number): value is string => typeof value === 'string' && Boolean(value.trim()) && characterCount(value) <= max;
const keysWithin = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)));
const numberWithin = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const optionalTextWithin = (value: unknown, max: number) => value === undefined || textWithin(value, max);
function validSource(value: unknown): boolean {
  return keysWithin(value, ['system', 'recordId']) && textWithin(value.system, 64) && textWithin(value.recordId, 128)
    && (value.system !== 'PCIE_MANUAL' || isUuid(value.recordId));
}
function validFacts(request: PublicHealthRequest): boolean {
  const facts = request.facts;
  if (!keysWithin(facts, ['observations', 'conditions', 'medicationClasses', 'lifestyle', 'historySummary', 'nextFollowUpDate', 'weightProfile'])
    || !Array.isArray(facts.observations) || facts.observations.length > 256
    || !Array.isArray(facts.conditions) || facts.conditions.length > 64
    || !Array.isArray(facts.medicationClasses) || facts.medicationClasses.length > 64
    || !keysWithin(facts.lifestyle, ['smoking', 'alcohol', 'exercise', 'diet', 'exerciseAbility', 'occupation'])
    || Object.values(facts.lifestyle).some(value => !textWithin(value, 2000))
    || !optionalTextWithin(facts.historySummary, 12000)
    || (facts.nextFollowUpDate !== undefined && !isDate(facts.nextFollowUpDate))) return false;
  if (facts.observations.some(item => !keysWithin(item, ['id', 'code', 'value', 'unit', 'observedAt', 'source'])
    || !textWithin(item.id, 128) || !textWithin(item.code, 128)
    || !(numberWithin(item.value, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER) || textWithin(item.value, 2000))
    || !optionalTextWithin(item.unit, 64) || !isZonedDate(item.observedAt) || !validSource(item.source))) return false;
  if (facts.conditions.some(item => !keysWithin(item, ['code', 'name', 'status']) || !textWithin(item.code, 128)
    || !textWithin(item.name, 200) || !textWithin(item.status, 64))) return false;
  if (facts.medicationClasses.some(item => !keysWithin(item, ['code', 'name']) || !textWithin(item.code, 128) || !textWithin(item.name, 200))) return false;
  const profile = facts.weightProfile;
  if (profile === undefined) return true; // Local assist may enter the missing-facts workflow.
  return keysWithin(profile, ['heightCm', 'weightKg', 'heightObservationId', 'weightObservationId', 'region', 'season', 'contextSource', 'activityDescription', 'dietPreferences', 'limitations'])
    && numberWithin(profile.heightCm, Number.MIN_VALUE, 300) && numberWithin(profile.weightKg, Number.MIN_VALUE, 1000)
    && ['东北', '华北', '华东', '华中', '华南', '西南', '西北'].includes(profile.region)
    && ['spring', 'summer', 'autumn', 'winter'].includes(profile.season)
    && optionalTextWithin(profile.heightObservationId, 128) && optionalTextWithin(profile.weightObservationId, 128)
    && (profile.contextSource === undefined || validSource(profile.contextSource))
    && [profile.activityDescription, profile.dietPreferences, profile.limitations].every(value => optionalTextWithin(value, 4000));
}
export function sameIdentity(a: PublicHealthIdentity, b: PublicHealthIdentity): boolean {
  return IDENTITY_KEYS.every(key => a[key] === b[key]);
}
export function identityOf(value: PublicHealthIdentity): PublicHealthIdentity {
  return Object.fromEntries(IDENTITY_KEYS.map(key => [key, value[key]])) as unknown as PublicHealthIdentity;
}
export function assertRequest(request: PublicHealthRequest): void {
  if (!request || request.schemaVersion !== 'public-health.v1' || !isUuid(request.requestId)
    || !isUuid(request.originRequestId) || !SECTION_IDS[request.capability] || !SCENE_TITLES[request.scene]
    || !request.patientId?.trim() || !request.businessRecordId?.trim() || !request.recordVersion?.trim()
    || !isZonedDate(request.snapshotAt) || !request.patient?.name?.trim()
    || !['male', 'female', 'unknown'].includes(request.patient.sex)
    || !Number.isInteger(request.patient.ageYears) || request.patient.ageYears < 0 || request.patient.ageYears > 150
    || !Array.isArray(request.facts?.observations) || !Array.isArray(request.facts.conditions)
    || !Array.isArray(request.facts.medicationClasses) || !request.facts.lifestyle
    || !Array.isArray(request.writebackTargets)) throw new Error('公卫调入资料格式无效，请从 PHIS 重新打开。');
  if (!keysWithin(request, ['schemaVersion', ...IDENTITY_KEYS, 'patient', 'facts', 'writebackTargets'])
    || !textWithin(request.patientId, 128) || !textWithin(request.businessRecordId, 128) || !textWithin(request.recordVersion, 128)
    || !keysWithin(request.patient, ['name', 'sex', 'ageYears', 'sexSource']) || !textWithin(request.patient.name, 100)
    || (request.patient.sexSource !== undefined && !validSource(request.patient.sexSource)) || !validFacts(request)) {
    throw new Error('公卫事实或来源格式无效，请从 PHIS 核对后重新打开。');
  }
  const expected = SECTION_IDS[request.capability];
  const sections = request.writebackTargets.flatMap(target => target.sourceSections || []);
  if (!request.writebackTargets.length || request.writebackTargets.length > 3
    || request.writebackTargets.some(target => !keysWithin(target, ['targetFieldId', 'label', 'sourceSections', 'mode', 'valueType'])
    || !textWithin(target.targetFieldId, 128) || !textWithin(target.label, 200)
    || target.mode !== 'replace' || target.valueType !== 'string' || !target.sourceSections?.length
    || JSON.stringify(target.sourceSections) !== JSON.stringify(expected.filter(id => target.sourceSections.includes(id))))
    || new Set(request.writebackTargets.map(target => target.targetFieldId)).size !== request.writebackTargets.length
    || sections.length !== expected.length || new Set(sections).size !== expected.length
    || expected.some(id => !sections.includes(id))) throw new Error('PHIS 允许回写范围无效，请重新调入。');
  if (new Set(request.facts.observations.map(item => item.id)).size !== request.facts.observations.length) {
    throw new Error('事实来源标识重复，请重新核对资料。');
  }
}
export function missingFacts(request: PublicHealthRequest): string[] {
  if (request.capability !== 'weight_management') return [];
  const missing: string[] = [];
  const profile = request.facts.weightProfile;
  if (request.patient.sex === 'unknown') missing.push('明确性别');
  if (!profile) return [...missing, '身高及测量时间', '体重及测量时间', '地区', '季节'];
  for (const [id, code, unit, value, max, title] of [
    [profile.heightObservationId, 'height', 'cm', profile.heightCm, 300, '身高及测量来源'],
    [profile.weightObservationId, 'weight', 'kg', profile.weightKg, 1000, '体重及测量来源'],
  ] as const) {
    const observation = request.facts.observations.find(item => item.id === id);
    if (!Number.isFinite(value) || value <= 0 || value > max || !observation
      || observation.code !== code || observation.unit !== unit || observation.value !== value
      || !isZonedDate(observation.observedAt) || !observation.source?.system || !observation.source.recordId) missing.push(title);
  }
  if (!['东北', '华北', '华东', '华中', '华南', '西南', '西北'].includes(profile.region)) missing.push('地区');
  if (!['spring', 'summer', 'autumn', 'winter'].includes(profile.season)) missing.push('季节');
  return missing;
}
export function supplementFacts(request: PublicHealthRequest, input: PublicHealthManualFacts, uuid: () => string, now: () => string): PublicHealthRequest {
  if (characterCount(input.historySummary.trim()) > 12000) throw new Error('病史与补充摘要最多 12000 字。');
  for (const value of [input.activityDescription, input.dietPreferences, input.limitations]) {
    if (value && characterCount(value.trim()) > 4000) throw new Error('日常活动、饮食偏好与活动限制分别最多 4000 字。');
  }
  const next = clone(request);
  next.requestId = uuid(); next.snapshotAt = now();
  if (input.sex !== request.patient.sex) {
    if (request.patient.sex !== 'unknown' || input.sex === 'unknown') throw new Error('已明确的性别需在 PHIS 更正后重新调入。');
    next.patient.sex = input.sex;
    next.patient.sexSource = { system: 'PCIE_MANUAL', recordId: uuid() };
  }
  if (input.historySummary.trim()) next.facts.historySummary = input.historySummary.trim();
  else delete next.facts.historySummary;
  if (next.capability === 'weight_management') {
    if (!input.heightCm || !input.weightKg || !input.region || !input.season
      || !isZonedDate(input.heightMeasuredAt) || !isZonedDate(input.weightMeasuredAt)) throw new Error('请填写身高、体重、真实测量时间、地区与季节。');
    // Retain unchanged PHIS measurements and their original provenance.
    const originalProfile = request.facts.weightProfile;
    function resolveMeasurement(code: 'height' | 'weight', value: number, observedAt: string): string {
      const originalId = code === 'height' ? originalProfile?.heightObservationId : originalProfile?.weightObservationId;
      const unit = code === 'height' ? 'cm' : 'kg';
      const original = request.facts.observations.find(item => item.id === originalId);
      if (original && original.code === code && original.unit === unit && original.value === value
        && Date.parse(original.observedAt) === Date.parse(observedAt) && original.source?.system && original.source.recordId) return original.id;
      if (next.facts.observations.length >= 256) throw new Error('事实条目已达上限，请从 PHIS 核对后重新调入。');
      const id = uuid();
      next.facts.observations.push({ id, code, unit, value, observedAt, source: { system: 'PCIE_MANUAL', recordId: uuid() } });
      return id;
    }
    const heightId = resolveMeasurement('height', input.heightCm, input.heightMeasuredAt);
    const weightId = resolveMeasurement('weight', input.weightKg, input.weightMeasuredAt);
    const contextSource = originalProfile?.region === input.region && originalProfile.season === input.season
      ? originalProfile.contextSource : { system: 'PCIE_MANUAL', recordId: uuid() };
    next.facts.weightProfile = {
      heightCm: input.heightCm, weightKg: input.weightKg, region: input.region, season: input.season,
      heightObservationId: heightId, weightObservationId: weightId,
      ...(contextSource ? { contextSource } : {}),
      ...(input.activityDescription?.trim() ? { activityDescription: input.activityDescription.trim() } : {}),
      ...(input.dietPreferences?.trim() ? { dietPreferences: input.dietPreferences.trim() } : {}),
      ...(input.limitations?.trim() ? { limitations: input.limitations.trim() } : {}),
    };
    const missing = missingFacts(next);
    if (missing.length) throw new Error(`请核对：${missing.join('、')}`);
  }
  assertRequest(next);
  return next;
}
export function assertMetrics(value: PublicHealthMetrics): void {
  if (!keysWithin(value, ['bmi', 'bmrKcalPerDay', 'formulaVersion']) || !numberWithin(value.bmi, Number.MIN_VALUE, 1000)
    || !numberWithin(value.bmrKcalPerDay, Number.MIN_VALUE, 100000) || !textWithin(value.formulaVersion, 128)) throw new Error('服务端返回的减重指标无效。');
}
export function assertSection(section: PublicHealthSection, capability: PublicHealthCapability): void {
  if (!keysWithin(section, ['id', 'title', 'content', 'options']) || !SECTION_IDS[capability].includes(section.id)
    || !textWithin(section.title, 100) || !(textWithin(section.content, 16000)
      || capability === 'health_prescription' && section.content === '')) throw new Error('服务端返回的章节无效。');
  if (section.content) assertPatientFacingContent(section.content);
  if (section.options !== undefined) {
    if (section.id !== 'meal_plan' || !Array.isArray(section.options) || section.options.length !== 3
      || section.options.some(option => !keysWithin(option, ['id', 'title', 'content'])
        || !textWithin(option.id, 128) || !textWithin(option.title, 100) || !textWithin(option.content, 16000))) {
      throw new Error('服务端返回的食谱选项无效。');
    }
    if (new Set(section.options.map(option => option.id)).size !== 3 || section.content !== section.options[0].content) {
      throw new Error('食谱选项重复或默认正文不一致。');
    }
    section.options.forEach(option => assertPatientFacingContent(option.content));
  }
  if (section.id === 'exercise_plan') assertGeneratedExerciseContent(section.content);
}
export function assertResult(result: PublicHealthResult, request: PublicHealthRequest): void {
  if (!result || result.schemaVersion !== 'public-health.v1' || !sameIdentity(result, request)
    || !isUuid(result.generationId) || !isZonedDate(result.generatedAt) || !Array.isArray(result.sections)
    || JSON.stringify(result.sections.map(section => section.id)) !== JSON.stringify(SECTION_IDS[request.capability])
    || !Array.isArray(result.promptVersions) || !result.promptVersions.length || result.promptVersions.length > 16
    || !Array.isArray(result.knowledgeVersions) || result.knowledgeVersions.length > 16
    || !Array.isArray(result.warnings) || result.warnings.length > 32) {
    throw new Error('服务端结果与当前公卫任务不一致。');
  }
  if (!keysWithin(result, ['schemaVersion', ...IDENTITY_KEYS, 'generationId', 'generatedAt', 'sections', 'metrics', 'promptVersions', 'knowledgeVersions', 'warnings'])
    || result.promptVersions.some(item => !keysWithin(item, ['code', 'version']) || !textWithin(item.code, 128) || !textWithin(item.version, 128))
    || result.knowledgeVersions.some(item => !keysWithin(item, ['assetId', 'version', 'sha256']) || !textWithin(item.assetId, 128)
      || !textWithin(item.version, 128) || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256))
    || result.warnings.some(item => !keysWithin(item, ['code', 'message', 'sectionId']) || !textWithin(item.code, 128)
      || !textWithin(item.message, 2000) || (item.sectionId !== undefined && !Object.keys(SECTION_TITLES).includes(item.sectionId)))) {
    throw new Error('服务端结果的版本溯源或提示信息无效。');
  }
  result.sections.forEach(section => assertSection(section, request.capability));
  if (!result.sections.some(section => section.content.trim())) throw new Error('本次未生成可提供给患者的处方内容，请核对资料后重新生成。');
  if (request.capability === 'weight_management') assertMetrics(result.metrics!);
  else if (result.metrics) throw new Error('健康处方结果包含不适用的指标。');
}
export function assertConfirmation(value: PublicHealthConfirmed, request?: PublicHealthRequest, options?: { skipPatientTextValidation: true }): void {
  if (!value || value.schemaVersion !== 'public-health.v1' || request && !sameIdentity(value, request)
    || !isUuid(value.requestId) || !isUuid(value.originRequestId) || !SECTION_IDS[value.capability] || !SCENE_TITLES[value.scene]
    || !textWithin(value.patientId, 128) || !textWithin(value.businessRecordId, 128) || !textWithin(value.recordVersion, 128)
    || !isZonedDate(value.snapshotAt)
    || !isUuid(value.generationId) || !isUuid(value.writebackRequestId) || !isZonedDate(value.confirmedAt)
    || !Array.isArray(value.items) || !value.items.length
    || new Set(value.items.map(item => item.targetFieldId)).size !== value.items.length) throw new Error('已确认正文与当前公卫任务不一致。');
  if (!keysWithin(value, ['schemaVersion', ...IDENTITY_KEYS, 'generationId', 'writebackRequestId', 'items', 'confirmedAt'])) {
    throw new Error('已确认正文包含不允许的附加字段。');
  }
  for (const item of value.items) {
    const target = request?.writebackTargets.find(entry => entry.targetFieldId === item.targetFieldId);
    if (request && (!target || JSON.stringify(item.sourceSections) !== JSON.stringify(target.sourceSections))
      || !keysWithin(item, ['targetFieldId', 'sourceSections', 'value']) || !textWithin(item.targetFieldId, 128)
      || !Array.isArray(item.sourceSections) || !item.sourceSections.length
      || JSON.stringify(item.sourceSections) !== JSON.stringify(SECTION_IDS[value.capability].filter(id => item.sourceSections.includes(id)))
      || typeof item.value !== 'string' || !item.value.trim() || characterCount(item.value) > 64000) throw new Error('已确认正文超出 PHIS 允许的回写范围。');
    if (!options?.skipPatientTextValidation) assertPatientFacingContent(item.value);
  }
}
export function buildConfirmation(request: PublicHealthRequest, result: PublicHealthResult, values: Partial<Record<PublicHealthSectionId, string>>, selected: PublicHealthSectionId[], writebackRequestId: string, confirmedAt: string): PublicHealthConfirmed {
  assertResult(result, request);
  const items = request.writebackTargets.filter(target => target.sourceSections.every(id => selected.includes(id))).map(target => {
    const valuesForTarget = target.sourceSections.map(id => {
      const value = values[id];
      if (!value?.trim() || characterCount(value) > 16000) throw new Error('选中章节为空或超出长度限制。');
      assertPatientFacingContent(value);
      return target.sourceSections.length > 1 ? `${SECTION_TITLES[id]}\n${value}` : value;
    });
    return { targetFieldId: target.targetFieldId, sourceSections: [...target.sourceSections], value: valuesForTarget.join('\n\n') };
  });
  if (!items.length) throw new Error('请完整选择至少一个 PHIS 目标字段所需的章节。');
  const payload: PublicHealthConfirmed = { schemaVersion: 'public-health.v1', ...identityOf(request), generationId: result.generationId, writebackRequestId, items, confirmedAt };
  assertConfirmation(payload, request);
  return payload;
}
export function matchesFeedback(feedback: PublicHealthFeedback, confirmation: PublicHealthConfirmed): boolean {
  return Boolean(feedback && feedback.schemaVersion === 'public-health.v1' && sameIdentity(feedback, confirmation)
    && feedback.generationId === confirmation.generationId && feedback.writebackRequestId === confirmation.writebackRequestId
    && isZonedDate(feedback.feedbackAt) && (feedback.status === 'success'
      ? Boolean(feedback.savedRecordVersion) && !feedback.errorCode
      : feedback.status === 'failed' && Boolean(feedback.errorCode?.trim()) && Boolean(feedback.message?.trim()) && !feedback.savedRecordVersion));
}
