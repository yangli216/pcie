import type { PublicHealthConfirmed, PublicHealthFeedback, PublicHealthRequest, PublicHealthResult, PublicHealthSectionId } from './types';
import { identityOf, SECTION_IDS, SECTION_TITLES } from './lib/publicHealthContract';
export const testUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const testTime = '2026-09-29T10:00:00+08:00';
export const testExerciseAdvice = [
  '1. 每周安排三次平地步行，每次先热身五分钟，再保持平稳的步伐活动二十分钟，结束时逐渐放慢脚步，选择平整明亮的路线并穿防滑鞋。步行时保持能够完整说话的速度，出现胸闷、头晕或明显气促应立即停止活动，持续不适及时就诊。',
  '2. 在日常空闲时做舒缓的关节活动，手臂向两侧缓慢展开并轻轻转动肩部，动作平稳且保持自然呼吸，每次可分成几个短时段完成。根据当日感受安排休息，身体不适时暂停活动，不要憋气或突然快速变换体位。',
  '3. 记录每次步行的时长和身体感受，固定在适合自己的时段完成活动，避免高温、湿滑道路和餐后立即运动，可邀请家人一起保持规律。随身携带饮水并适时休息，活动后观察恢复情况，出现持续不适应及时就诊。',
].join('\n');
export function testRequest(capability: PublicHealthRequest['capability'] = 'health_prescription'): PublicHealthRequest {
  return { schemaVersion: 'public-health.v1', requestId: testUuid(1), originRequestId: testUuid(1),
    capability, scene: 'hypertension_followup', patientId: 'synthetic-patient', businessRecordId: 'synthetic-record', recordVersion: '7', snapshotAt: testTime,
    patient: { name: '合成居民', sex: 'female', ageYears: 65 },
    facts: { observations: [], conditions: [], medicationClasses: [], lifestyle: {}, historySummary: '合成测试资料' },
    writebackTargets: SECTION_IDS[capability].map(id => ({ targetFieldId: `target-${id}`, label: SECTION_TITLES[id], sourceSections: [id], valueType: 'string', mode: 'replace' })),
  };
}
export function testWeightRequest(): PublicHealthRequest {
  const request = testRequest('weight_management');
  request.facts.observations = [
    { id: 'phis-bp', code: 'systolic_bp', value: 138, unit: 'mmHg', observedAt: testTime, source: { system: 'PHIS', recordId: 'original-bp' } },
    { id: 'phis-height', code: 'height', value: 165, unit: 'cm', observedAt: testTime, source: { system: 'PHIS', recordId: 'original-height' } },
    { id: 'phis-weight', code: 'weight', value: 72, unit: 'kg', observedAt: testTime, source: { system: 'PHIS', recordId: 'original-weight' } },
  ];
  request.facts.lifestyle = { smoking: '不吸烟（合成资料）', exercise: '原始散步资料', diet: '原始饮食资料' };
  request.facts.weightProfile = {
    heightCm: 165, weightKg: 72, heightObservationId: 'phis-height', weightObservationId: 'phis-weight',
    region: '华东', season: 'autumn', activityDescription: '原始散步资料', dietPreferences: '原始饮食资料',
  };
  return request;
}
export function testResult(request: PublicHealthRequest): PublicHealthResult {
  return { schemaVersion: 'public-health.v1', ...identityOf(request), generationId: testUuid(2),
    sections: SECTION_IDS[request.capability].map(id => ({ id, title: SECTION_TITLES[id], content: id === 'exercise_plan' ? testExerciseAdvice : '合成测试建议：按约定记录日常活动。' })),
    ...(request.capability === 'weight_management' ? { metrics: { bmi: 26, bmrKcalPerDay: 1200, formulaVersion: 'synthetic-only.v1' } } : {}),
    promptVersions: [{ code: 'synthetic-prompt', version: '1' }], knowledgeVersions: [], warnings: [], generatedAt: testTime };
}
export function testValues(request: PublicHealthRequest): Partial<Record<PublicHealthSectionId, string>> {
  return Object.fromEntries(SECTION_IDS[request.capability].map(id => [id, `合成测试正文-${id}`]));
}
export function testMealResult(request: PublicHealthRequest = testWeightRequest()): PublicHealthResult {
  const result = testResult(request), meal = result.sections.find(section => section.id === 'meal_plan')!;
  meal.options = [1, 2, 3].map(n => ({ id: `synthetic-recipe-${n}`, title: `合成食谱${n}`, content: `三餐参考食谱\n合成方案${n}：早餐、午餐、晚餐占位。` }));
  meal.content = meal.options[0].content;
  result.warnings = [{ code: 'SYNTHETIC_RECIPE_REVIEW', sectionId: 'meal_plan', message: '合成食谱适用性待核实。' }];
  return result;
}
export function testFeedback(payload: PublicHealthConfirmed, status: 'success' | 'failed' = 'success', errorCode = 'SAVE_FAILED'): PublicHealthFeedback {
  return { schemaVersion: 'public-health.v1', ...identityOf(payload), generationId: payload.generationId, writebackRequestId: payload.writebackRequestId, status,
    ...(status === 'success' ? { savedRecordVersion: '8' } : { errorCode, message: '合成失败原因' }), feedbackAt: testTime };
}
