import { describe, expect, it } from 'vitest';
import { buildHealthCheckSchedule, eligibleHealthChecks, renderHealthCheckPlan, renderHealthEducationDraft, renderHealthMedicationGuidance, type HealthPrescriptionPolicy } from './publicHealthHealthEducation';
import { buildPublicHealthHealthProfile } from './publicHealthHealthProfile';
import { testRequest, testTime } from '../testFixtures';
import type { PublicHealthRequest } from '../types';

function request(): PublicHealthRequest {
  const result = testRequest();
  result.facts.conditions = [{ code: 'synthetic-condition', name: '合成慢病', status: '管理中' }];
  result.facts.observations = [
    { id: 'synthetic-measurement', code: 'synthetic-test', value: 15, unit: 'synthetic-unit', observedAt: '2026-09-20T10:00:00+08:00', source: { system: 'SYNTHETIC_EXAM', recordId: 'synthetic-report' } },
    { id: 'synthetic-risk', code: 'risk_level', value: 'high', observedAt: testTime, source: { system: 'SYNTHETIC_ARCHIVE', recordId: 'synthetic-archive' } },
  ];
  return result;
}
function policy(): HealthPrescriptionPolicy {
  return { checkWhitelist: [{ code: 'synthetic-test', name: '合成检查项目', prep: '合成准备要求', minIntervalDays: 30, abnormalRetestIntervalDays: 3,
    abnormalCriteria: [{ observationCode: 'synthetic-test', unit: 'synthetic-unit', operator: 'gte', threshold: 10, maxEvidenceAgeDays: 30 }],
    eligibility: { minAgeYears: 60, maxAgeYears: 80, sexes: ['female'], conditionCodes: ['synthetic-condition'], riskLevels: ['high'] } }],
  medicationReminders: { 'synthetic-class': '合成字典核对提醒' }, lifestyleRules: ['合成健康教育规则'] };
}
function education() {
  return { risks: [{ type: 'progression', name: '合成慢病进展关注', concern: 'needs_assessment', evidenceRefs: ['condition:0', 'observation:synthetic-measurement'], intervention: '合成随访干预占位' }],
    prevention: ['合成预防建议'], diet: ['合成饮食建议'], exercise: ['合成运动建议'], followup: ['合成随访建议'], missingFacts: ['合成待补充资料'] };
}
function checks() {
  return { checks: [{ code: 'synthetic-test', plannedDate: '2026-10-20', priority: 'medium', reason: '合成审核理由', patientReason: '了解本次合成检查指标的变化，便于后续随访。', evidenceObservationIds: ['synthetic-measurement'], intervalKind: 'routine' }] };
}

describe('health education draft rendering', () => {
  it('moves optional doctor notes and missing facts outside patient advice without deleting safety actions', () => {
    const notes: string[] = [];
    const draft = { ...education(), doctorNotes: ['请医生核对既往记录。'], exercise: ['出现胸闷时停止运动，持续不适请及时就诊。'] };
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(text).toContain('出现胸闷时停止运动，持续不适请及时就诊。');
    expect(text).not.toContain('请医生核对'); expect(notes).toContain('请医生核对既往记录。');
    expect(notes.join('\n')).toContain('合成待补充资料');
  });
  it.each([null, '不是数组', [' '], [3], ['😀'.repeat(16001)]].map(doctorNotes => ({ doctorNotes })))('rejects malformed doctorNotes $doctorNotes before applying a draft', ({ doctorNotes }) => {
    expect(() => renderHealthEducationDraft({ ...education(), doctorNotes }, buildPublicHealthHealthProfile(request()))).toThrow();
  });
  it('preserves duplicate valid physician notes because their contract has no uniqueness constraint', () => {
    const notes: string[] = [];
    renderHealthEducationDraft({ ...education(), doctorNotes: ['医生核对记录。', '医生核对记录。'] }, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(notes.filter(note => note === '医生核对记录。')).toHaveLength(2);
  });
  it('keeps longer and repeated notes without a fixed item-count limit', () => {
    const notes: string[] = [], doctorNotes = Array(9).fill('提醒正文'.repeat(300));
    renderHealthEducationDraft({ ...education(), doctorNotes }, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(notes.filter(note => note === doctorNotes[0])).toHaveLength(9);
  });
  it.each(['制定依据\n居民现状', '证据：资料', '请医生核对用药'])('preserves freeform language in advice and interventions: %s', content => {
    expect(renderHealthEducationDraft({ ...education(), diet: [content] }, buildPublicHealthHealthProfile(request()))).toContain(content);
    expect(renderHealthEducationDraft({ ...education(), risks: [{ ...education().risks[0], intervention: content }] }, buildPublicHealthHealthProfile(request()))).toContain(content);
  });
  it('renders all education topics and fills risk evidence date and source record from the current profile', () => {
    const notes: string[] = [];
    const text = renderHealthEducationDraft(education(), buildPublicHealthHealthProfile(request()), note => notes.push(note));
    const doctor = notes.join('\n');
    expect(doctor).toContain('AI 定性分析，不表示概率或诊断');
    expect(doctor).toContain('慢病进展；待评估');
    expect(doctor).toContain('2026-09-20T10:00:00+08:00');
    expect(doctor).toContain('SYNTHETIC_EXAM / 记录：synthetic-report');
    expect(doctor).toContain('待补充资料：合成待补充资料');
    for (const title of ['疾病预防', '饮食建议', '运动建议', '随访安排']) expect(text).toContain(title);
    for (const metadata of ['AI 定性分析', '待评估', '证据：', 'synthetic-report', '待补充资料']) expect(text).not.toContain(metadata);
    expect(text).toContain('合成随访干预占位');
    expect(text).not.toContain('riskProbability');
  });
  it('does not turn an empty risk list into a no-risk conclusion', () => {
    const draft = education(); draft.risks = [];
    const notes: string[] = [];
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(notes.join('\n')).toContain('不能据此判断无风险');
    expect(text).not.toContain('不能据此判断无风险');
  });
  it.each([
    { ...education(), diet: ['   '] },
    { ...education(), diet: [12] },
    { ...education(), prevention: ['😀'.repeat(16001)] },
    { ...education(), risks: [{ ...education().risks[0], type: 'diagnosis' }] },
    { ...education(), risks: [{ ...education().risks[0], concern: 'high' }] },
    { ...education(), risks: [{ ...education().risks[0], evidenceRefs: ['invented:source'] }] },
    { ...education(), risks: [{ ...education().risks[0], evidenceRefs: ['condition:0', 'condition:0'] }] },
    { ...education(), risks: [{ ...education().risks[0], evidenceRefs: [' condition:0'] }] },
  ])('rejects invalid required fields, excessive capacity or ungrounded AI references: %j', draft => {
    expect(() => renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()))).toThrow();
  });
  it('projects known draft fields without rejecting additional model fields', () => {
    const draft = { ...education(), probability: 0.8, extraText: '额外字段不进入正文',
      risks: [{ ...education().risks[0], probability: 0.5, extraText: '额外风险字段不进入正文' }] };
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()));
    expect(text).toContain('合成随访干预占位'); expect(text).toContain('合成预防建议');
    expect(text).not.toContain('额外'); expect(text).not.toContain('probability');
  });
  it('keeps repeated prose and more than eight topic items or six risk interventions', () => {
    const draft = education(), notes: string[] = [];
    draft.risks = Array.from({ length: 7 }, () => ({ ...draft.risks[0] }));
    for (const key of ['prevention', 'diet', 'exercise', 'followup', 'missingFacts'] as const) draft[key] = Array(9).fill(`合成${key}`);
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(text.match(/合成随访干预占位/g)).toHaveLength(7);
    for (const key of ['prevention', 'diet', 'exercise', 'followup']) expect(text.split(`合成${key}`)).toHaveLength(10);
    expect(notes.filter(note => note === '待补充资料：合成missingFacts')).toHaveLength(9);
  });
  it('keeps free text longer than the former 1000-character limit within the rendered chapter capacity', () => {
    const content = '合成建议'.repeat(300), draft = education(), notes: string[] = [];
    draft.diet = [content]; draft.risks[0].intervention = content; draft.missingFacts = [content];
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()), note => notes.push(note));
    expect(text.split(content)).toHaveLength(3); expect(notes).toContain(`待补充资料：${content}`);
  });
  it('preserves original advice text and omits empty topics, with a clear all-empty response', () => {
    const draft = education(); draft.risks = []; draft.diet = []; draft.exercise = []; draft.followup = []; draft.missingFacts = [];
    draft.prevention = [' 合成条目 ', '合成条目'];
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()));
    expect(text).toContain('1.  合成条目 '); expect(text).toContain('2. 合成条目');
    expect(text).not.toContain('饮食建议'); expect(text).not.toContain('随访安排');
    draft.prevention = [];
    const notes: string[] = [];
    expect(renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()), note => notes.push(note))).toBe('');
    expect(notes.join('\n')).toContain('本次资料不足以生成健康教育条目，请医生核对并补充资料。');
  });
  it('rejects omitted fields and risk references to future observations, conflicting latest results or unknown sex', () => {
    const current = request(); current.patient.sex = 'unknown';
    current.facts.observations.push({ ...current.facts.observations[0], id: 'future', observedAt: '2026-09-30T10:00:00+08:00' },
      { ...current.facts.observations[0], id: 'conflict', value: 25 });
    for (const ref of ['observation:future', 'observation:conflict', 'observation:synthetic-measurement', 'patient:sex']) {
      const draft = education(); draft.risks[0].evidenceRefs = [ref];
      expect(() => renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(current))).toThrow();
    }
    const { missingFacts: _missing, ...incomplete } = education();
    expect(() => renderHealthEducationDraft(incomplete, buildPublicHealthHealthProfile(current))).toThrow();
  });
  it('rejects an otherwise valid final rendered section over 16000 Unicode code points', () => {
    const draft = education();
    for (const key of ['prevention', 'diet', 'exercise', 'followup', 'missingFacts'] as const) draft[key] = Array.from({ length: 8 }, (_, i) => `${i}${'😀'.repeat(999)}`);
    expect(() => renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(request()))).toThrow();
  });
  it.each(['BMI24', 'bmr 1200', '1200KCAL', '130 mm Hg', '130 mm\nHg', '6.2 mmol / l', '6.2 MmOl／L',
    '减重目标', '目标体重', '三餐参考食谱', '备选食谱', '千卡', '卡路里'])('preserves the content keyword %s in risk and advice fields', keyword => {
    const profile = buildPublicHealthHealthProfile(request());
    for (const key of ['name', 'intervention'] as const) {
      const draft = education(), notes: string[] = []; draft.risks[0][key] = `合成正文：${keyword}`;
      const text = renderHealthEducationDraft(draft, profile, note => notes.push(note));
      expect(key === 'name' ? notes.join('\n') : text).toContain(`合成正文：${keyword}`);
    }
    for (const key of ['prevention', 'diet', 'exercise', 'followup', 'missingFacts'] as const) {
      const draft = education(), notes: string[] = []; draft[key] = [`合成正文：${keyword}`];
      const text = renderHealthEducationDraft(draft, profile, note => notes.push(note));
      expect(key === 'missingFacts' ? notes.join('\n') : text).toContain(`合成正文：${keyword}`);
    }
  });
  it('keeps original measurement units in program-rendered evidence and accepts exercise duration and frequency', () => {
    const current = request();
    current.facts.observations.push({ ...current.facts.observations[0], id: 'actual-bp', code: 'systolic_bp', value: 138, unit: 'mmHg' },
      { ...current.facts.observations[0], id: 'actual-glucose', code: 'fasting_glucose', value: 6.2, unit: 'mmol/L' },
      { ...current.facts.observations[0], id: 'actual-bmi', code: 'bmi', value: 24, unit: 'kg/m²' });
    const draft = education(); draft.risks[0].evidenceRefs = ['observation:actual-bp', 'observation:actual-glucose', 'observation:actual-bmi'];
    draft.exercise = ['合成运动安排：每周 3 次，每次 20 分钟。'];
    const notes: string[] = [];
    const text = renderHealthEducationDraft(draft, buildPublicHealthHealthProfile(current), note => notes.push(note));
    const doctor = notes.join('\n');
    expect(doctor).toContain('收缩压：138 mmHg'); expect(doctor).toContain('空腹血糖：6.2 mmol/L'); expect(doctor).toContain('BMI：24 kg/m²');
    expect(text).not.toContain('收缩压：138 mmHg');
    expect(text).toContain('每周 3 次，每次 20 分钟');
  });
});

describe('approved health check eligibility and plan validation', () => {
  it.each(['\n', '\r', '\u2028', '\u2029'])('preserves the complete preparation across separator %j without keyword filtering', separator => {
    const rules = policy();
    rules.checkWhitelist[0].prep = `检查前按安排禁食${separator}请医生核对目录`;
    expect(renderHealthCheckPlan(checks(), request(), rules)).toContain(`准备事项：${rules.checkWhitelist[0].prep}`);
  });
  it.each(['检查前空腹 8 小时。机构需核对现场准备规则。', '携带机构就诊卡到院。\n来源：批准规则。', '空腹 8 小时并由机构核对准备规则。'])('preserves mixed preparation text while keeping explicit doctorNotes separate: %s', prep => {
    const rules = policy(), notes: string[] = []; rules.checkWhitelist[0].prep = prep;
    const text = renderHealthCheckPlan({ ...checks(), doctorNotes: ['独立医生提醒。'] }, request(), rules, note => notes.push(note));
    expect(text).toContain(prep); expect(text).not.toContain('独立医生提醒。');
    expect(notes).toContain('独立医生提醒。');
  });
  it('requires age, sex, condition and caller risk to match together, independently of AI concern', () => {
    const current = request(), rules = policy();
    expect(eligibleHealthChecks(current, rules)).toHaveLength(1);
    for (const change of [(r: PublicHealthRequest) => { r.patient.ageYears = 59; }, (r: PublicHealthRequest) => { r.patient.sex = 'male'; },
      (r: PublicHealthRequest) => { r.facts.conditions = []; }, (r: PublicHealthRequest) => { r.facts.observations[1].value = 'attention'; }]) {
      const next = structuredClone(current); change(next); expect(eligibleHealthChecks(next, rules)).toEqual([]);
      expect(() => renderHealthCheckPlan(checks(), next, rules)).toThrow();
    }
    const notes: string[] = [];
    expect(renderHealthCheckPlan({ checks: [] }, current, rules, note => notes.push(note))).toBe('');
    expect(notes.join('\n')).toContain('本次未生成检查计划');
  });
  it('ignores future risk observations and refuses conflicting latest risk levels', () => {
    const current = request(); current.facts.observations[1].value = 'low';
    current.facts.observations.push({ ...current.facts.observations[1], id: 'future-risk', value: 'high', observedAt: '2026-10-01T10:00:00+08:00' });
    expect(eligibleHealthChecks(current, policy())).toEqual([]);
    current.facts.observations.push({ ...current.facts.observations[1], id: 'conflicting-risk', value: 'high' });
    expect(eligibleHealthChecks(current, policy())).toEqual([]);
  });
  it('ignores nanosecond-future risk levels and completed-check dates consistently with the profile', () => {
    const current = request(); current.snapshotAt = '2026-09-29T10:00:00.000000004+08:00';
    const futureAt = '2026-09-29T10:00:00.000000005+08:00';
    current.facts.observations.push({ ...current.facts.observations[0], id: 'nanosecond-future-check', observedAt: futureAt });
    expect(renderHealthCheckPlan(checks(), current, policy())).toContain('2026-10-20');
    current.facts.observations[1].value = 'low';
    current.facts.observations.push({ ...current.facts.observations[1], id: 'nanosecond-future-risk', value: 'high', observedAt: futureAt });
    expect(eligibleHealthChecks(current, policy())).toEqual([]);
  });
  it('renders the patient purpose while keeping clinical reasoning and evidence in doctor notes', () => {
    const notes: string[] = [];
    const text = renderHealthCheckPlan(checks(), request(), policy(), note => notes.push(note));
    expect(text).toContain('合成检查项目 · 2026-10-20'); expect(notes.join('\n')).toContain('优先级：中');
    expect(notes.join('\n')).toContain('记录：synthetic-report'); expect(text).toContain('合成准备要求');
    expect(text).toContain('检查目的：了解本次合成检查指标的变化，便于后续随访。');
    expect(text).not.toContain('合成审核理由'); expect(notes.join('\n')).toContain('合成审核理由');
    expect(text).not.toContain('优先级：中'); expect(text).not.toContain('证据：');
    const draft = checks(); draft.checks[0].plannedDate = '2026-10-19';
    expect(() => renderHealthCheckPlan(draft, request(), policy())).toThrow();
  });
  it.each([undefined, null, '', ' ', '\u00A0\uFEFF'])('keeps a check with absent patient purpose %j and asks the physician to complete it separately', patientReason => {
    const notes: string[] = [];
    const draft = { checks: [{ ...checks().checks[0], patientReason }] };
    const text = renderHealthCheckPlan(draft, request(), policy(), note => notes.push(note));
    expect(text).toContain('合成检查项目 · 2026-10-20'); expect(text).toContain('准备事项：合成准备要求');
    expect(text).not.toContain('检查目的'); expect(text).not.toContain('合成审核理由');
    expect(notes).toContain('合成检查项目：未提供检查目的，请医生核对并补充。');
  });
  it('accepts a check draft which omits the optional patient purpose field entirely', () => {
    const { patientReason: _patientReason, ...check } = checks().checks[0];
    const notes: string[] = [];
    expect(renderHealthCheckPlan({ checks: [check] }, request(), policy(), note => notes.push(note))).not.toContain('检查目的');
    expect(notes).toContain('合成检查项目：未提供检查目的，请医生核对并补充。');
  });
  it.each([42, false, [], {}, '😀'.repeat(16001)].map(patientReason => ({ patientReason })))('rejects an invalid or oversized patient purpose $patientReason', ({ patientReason }) => {
    const draft = { checks: [{ ...checks().checks[0], patientReason }] };
    expect(() => renderHealthCheckPlan(draft, request(), policy())).toThrow();
  });
  it('preserves the patient purpose without adding client content keyword filters', () => {
    const patientReason = '依据既往资料进行复查，请医生核对。';
    expect(renderHealthCheckPlan({ checks: [{ ...checks().checks[0], patientReason }] }, request(), policy())).toContain(`检查目的：${patientReason}`);
    expect(renderHealthCheckPlan({ checks: [{ ...checks().checks[0], patientReason: '😀'.repeat(1500) }] }, request(), policy())).toContain('😀'.repeat(1500));
  });
  it('keeps a longer clinical reason in doctor notes without projecting it into patient text', () => {
    const reason = '合成审核依据'.repeat(500), notes: string[] = [];
    const text = renderHealthCheckPlan({ checks: [{ ...checks().checks[0], reason }] }, request(), policy(), note => notes.push(note));
    expect(notes.join('\n')).toContain(reason); expect(text).not.toContain(reason);
    expect(() => renderHealthCheckPlan({ checks: [{ ...checks().checks[0], reason: '字'.repeat(16001) }] }, request(), policy())).toThrow();
  });
  it('accepts a missing-baseline routine check grounded in genuine age and condition refs', () => {
    const current = request(); current.facts.observations = current.facts.observations.filter(item => item.code === 'risk_level');
    const draft = { checks: [{ ...checks().checks[0], priority: 'low', reason: '合成年龄与病种的例行检查核对',
      evidenceObservationIds: [], evidenceRefs: ['patient:ageYears', 'condition:0'] }] };
    const notes: string[] = [];
    const text = renderHealthCheckPlan(draft, current, policy(), note => notes.push(note));
    expect(notes.join('\n')).toContain('年龄：65'); expect(notes.join('\n')).toContain('健康状况：合成慢病（管理中）');
    expect(notes.join('\n')).toContain(`资料快照：${current.snapshotAt}`);
    expect(notes.join('\n')).not.toContain('synthetic-report');
    expect(notes.join('\n')).toContain('既往结果：尚未提供本项目既往结果。');
    expect(text).not.toContain('既往结果');
    current.facts.observations.push({ ...request().facts.observations[0], id: 'future-baseline', observedAt: '2026-10-01T10:00:00+08:00' });
    const futureNotes: string[] = [];
    renderHealthCheckPlan(draft, current, policy(), note => futureNotes.push(note));
    expect(futureNotes.join('\n')).toContain('既往结果：尚未提供本项目既往结果。');
  });
  it('renders mixed genuine observation and profile evidence in deterministic order', () => {
    const draft = { checks: [{ ...checks().checks[0], evidenceRefs: ['patient:ageYears', 'condition:0'] }] };
    const notes: string[] = [];
    renderHealthCheckPlan(draft, request(), policy(), note => notes.push(note));
    const text = notes.join('\n');
    expect(text).toContain('记录：synthetic-report'); expect(text).toContain('年龄：65');
    expect(text).not.toContain('既往结果：尚未提供本项目既往结果。');
    expect(text.indexOf('synthetic-report')).toBeLessThan(text.indexOf('年龄：65'));
    expect(text.indexOf('年龄：65')).toBeLessThan(text.indexOf('健康状况：合成慢病'));
  });
  it('rejects empty evidence, invalid or duplicate profile refs and cross-category observation duplicates', () => {
    const item = checks().checks[0];
    for (const value of [
      { ...item, evidenceObservationIds: [] },
      { ...item, evidenceObservationIds: [], evidenceRefs: [] },
      { ...item, evidenceRefs: null },
      { ...item, evidenceRefs: 'patient:ageYears' },
      { ...item, evidenceObservationIds: [], evidenceRefs: ['unknown:ref'] },
      { ...item, evidenceObservationIds: [], evidenceRefs: [' patient:ageYears'] },
      { ...item, evidenceObservationIds: [], evidenceRefs: ['patient:ageYears', 'patient:ageYears'] },
      { ...item, evidenceRefs: ['observation:synthetic-measurement'] },
      { ...item, evidenceRefs: Array(17).fill('patient:ageYears') },
    ]) expect(() => renderHealthCheckPlan({ checks: [value] }, request(), policy())).toThrow();
  });
  it('rejects profile observation refs to future or disputed facts', () => {
    const current = request();
    current.facts.observations.push({ ...current.facts.observations[0], id: 'future-ref', observedAt: '2026-10-01T10:00:00+08:00' },
      { ...current.facts.observations[0], id: 'conflict-ref', value: 20 });
    for (const ref of ['observation:future-ref', 'observation:conflict-ref', 'observation:synthetic-measurement']) {
      const draft = { checks: [{ ...checks().checks[0], evidenceObservationIds: [], evidenceRefs: [ref] }] };
      expect(() => renderHealthCheckPlan(draft, current, policy())).toThrow();
    }
  });
  it('never substitutes profile refs for required numeric abnormal-retest observations', () => {
    const item = { ...checks().checks[0], plannedDate: '2026-09-29', intervalKind: 'abnormal_retest' };
    for (const evidenceObservationIds of [[], ['synthetic-risk']]) {
      const draft = { checks: [{ ...item, evidenceObservationIds, evidenceRefs: ['observation:synthetic-measurement', 'patient:ageYears'] }] };
      expect(() => renderHealthCheckPlan(draft, request(), policy())).toThrow();
    }
    const valid = { checks: [{ ...item, evidenceRefs: ['condition:0'] }] };
    expect(renderHealthCheckPlan(valid, request(), policy())).toContain('合成检查项目');
  });
  it('keeps a disputed result date as a completed check for minimum intervals, while rejecting it as evidence', () => {
    const current = request();
    current.facts.observations.push({ ...current.facts.observations[0], id: 'disputed-a', value: 14, observedAt: '2026-09-25T10:00:00+08:00' },
      { ...current.facts.observations[0], id: 'disputed-b', value: 18, observedAt: '2026-09-25T10:00:00+08:00' });
    const draft = checks(); draft.checks[0].plannedDate = '2026-10-20';
    expect(() => renderHealthCheckPlan(draft, current, policy())).toThrow();
    draft.checks[0].plannedDate = '2026-10-25';
    const notes: string[] = [];
    const text = renderHealthCheckPlan(draft, current, policy(), note => notes.push(note));
    expect(text).toContain('2026-10-25');
    expect(notes.join('\n')).toContain('既往结果：本项目最新结果存在冲突，请医生核对。');
    expect(text).not.toContain('既往结果');
    draft.checks[0].evidenceObservationIds = ['disputed-a'];
    expect(() => renderHealthCheckPlan(draft, current, policy())).toThrow();
  });
  it('ignores future measurements for intervals and allows abnormal retest only with all recent, numeric, unit-matched evidence', () => {
    const current = request(); current.facts.observations.push({ ...current.facts.observations[0], id: 'future-check', observedAt: '2026-11-01T10:00:00+08:00' });
    expect(renderHealthCheckPlan(checks(), current, policy())).toContain('2026-10-20');
    const draft = checks(); draft.checks[0].plannedDate = '2026-09-29'; draft.checks[0].intervalKind = 'abnormal_retest';
    expect(renderHealthCheckPlan(draft, current, policy())).toContain('2026-09-29');
    for (const mismatch of [(r: PublicHealthRequest) => { r.facts.observations[0].unit = 'wrong-unit'; },
      (r: PublicHealthRequest) => { r.facts.observations[0].value = 9; },
      (r: PublicHealthRequest) => { r.facts.observations[0].value = '15'; },
      (r: PublicHealthRequest) => { r.facts.observations[0].observedAt = '2026-08-01T10:00:00+08:00'; }]) {
      const next = structuredClone(current); mismatch(next); expect(() => renderHealthCheckPlan(draft, next, policy())).toThrow();
    }
  });
  it.each(['2026-09-28', '2026-12-29', '2026-02-30', '2026-10-20T10:00:00+08:00'])('rejects invalid or out-of-window planned date %s', plannedDate => {
    const draft = checks(); draft.checks[0].plannedDate = plannedDate;
    expect(() => renderHealthCheckPlan(draft, request(), policy())).toThrow();
  });
  it('rejects foreign codes, invented/duplicate/future evidence and duplicate checks', () => {
    for (const change of [
      (d: ReturnType<typeof checks>) => { d.checks[0].code = 'foreign-code'; },
      (d: ReturnType<typeof checks>) => { d.checks[0].evidenceObservationIds = ['foreign-id']; },
      (d: ReturnType<typeof checks>) => { d.checks[0].evidenceObservationIds = ['synthetic-measurement', 'synthetic-measurement']; },
      (d: ReturnType<typeof checks>) => { d.checks.push(d.checks[0]); },
    ]) { const draft = checks(); change(draft); expect(() => renderHealthCheckPlan(draft, request(), policy())).toThrow(); }
    const current = request(); current.facts.observations[0].observedAt = '2026-10-01T10:00:00+08:00';
    expect(() => renderHealthCheckPlan(checks(), current, policy())).toThrow();
  });
  it('ignores additional model fields while still using approved preparation and strict policy metadata', () => {
    const draft = { checks: [{ ...checks().checks[0], preparation: '模型追加准备字段' }], extraText: '模型追加字段' };
    const text = renderHealthCheckPlan(draft, request(), policy());
    expect(text).toContain('准备事项：合成准备要求'); expect(text).not.toContain('模型追加');
    expect(() => renderHealthCheckPlan(draft, request(), { ...policy(), extraText: '未知机构规则字段' } as HealthPrescriptionPolicy)).toThrow();
  });
  it('rejects invalid eligibility config instead of silently treating it as unrestricted', () => {
    for (const eligibility of [{ minAgeYears: 70, maxAgeYears: 60 }, { minAgeYears: -1 }, { maxAgeYears: 131 }, { sexes: [] }, { sexes: ['other'] }, { sexes: ['unknown'] }, { sexes: [' female '] }, { riskLevels: [3] }, { conditionCodes: ['x', 'x'] }, { probability: 0.3 }]) {
      const rules = policy(); rules.checkWhitelist[0].eligibility = eligibility as NonNullable<HealthPrescriptionPolicy['checkWhitelist'][number]['eligibility']>;
      expect(() => eligibleHealthChecks(request(), rules)).toThrow();
    }
  });
});

describe('deterministic approved check schedule supplied to the model', () => {
  it('starts a missing-baseline routine project at the snapshot date, without deriving abnormal eligibility from age or condition', () => {
    const current = request(), rules = policy();
    current.facts.observations = current.facts.observations.filter(obs => obs.code === 'risk_level');
    const before = structuredClone(current), originalPolicy = structuredClone(rules);
    expect(buildHealthCheckSchedule(current, rules)).toEqual([{ code: 'synthetic-test', routineEarliestDate: '2026-09-29',
      routineAvailable: true, abnormalRetestAvailable: false }]);
    expect(current).toEqual(before); expect(rules).toEqual(originalPolicy);
    current.patient.sex = 'male'; expect(buildHealthCheckSchedule(current, rules)).toEqual([]);
  });
  it('counts the current fasting glucose result before a 365-day routine interval, beyond the 90-day window', () => {
    const current = request(), rules = policy(); current.snapshotAt = '2026-10-08T10:00:00+08:00';
    current.facts.observations[0] = { ...current.facts.observations[0], code: 'fasting_glucose', observedAt: current.snapshotAt, value: 6.2, unit: 'mmol/L' };
    rules.checkWhitelist[0] = { ...rules.checkWhitelist[0], code: 'fasting_glucose', minIntervalDays: 365 };
    expect(buildHealthCheckSchedule(current, rules)[0]).toEqual({ code: 'fasting_glucose', routineEarliestDate: '2027-10-08',
      routineAvailable: false, abnormalRetestAvailable: false });
  });
  it('includes day 90 and excludes day 91 without truncating the actual earliest date', () => {
    const current = request(), rules = policy(); current.facts.observations[0].observedAt = current.snapshotAt;
    rules.checkWhitelist[0].minIntervalDays = 90;
    expect(buildHealthCheckSchedule(current, rules)[0]).toMatchObject({ routineEarliestDate: '2026-12-28', routineAvailable: true });
    rules.checkWhitelist[0].minIntervalDays = 91;
    expect(buildHealthCheckSchedule(current, rules)[0]).toMatchObject({ routineEarliestDate: '2026-12-29', routineAvailable: false });
  });
  it('ignores nanosecond-future observations for the interval and abnormal evidence', () => {
    const current = request(), rules = policy(); current.snapshotAt = '2026-09-29T10:00:00.000000004+08:00';
    current.facts.observations[0].value = 5;
    current.facts.observations.push({ ...current.facts.observations[0], id: 'future-measurement', value: 20, observedAt: '2026-09-29T10:00:00.000000005+08:00' });
    expect(buildHealthCheckSchedule(current, rules)[0]).toEqual({ code: 'synthetic-test', routineEarliestDate: '2026-10-20',
      routineAvailable: true, abnormalRetestAvailable: false });
  });
  it('counts conflicting latest results from different sources as completed dates, without treating their numbers as evidence', () => {
    const current = request(), rules = policy(), measurement = current.facts.observations.shift()!;
    current.facts.observations.push({ ...measurement, id: 'conflicting-a', observedAt: '2026-09-25T10:00:00+08:00', value: 14 },
      { ...measurement, id: 'conflicting-b', observedAt: '2026-09-25T10:00:00+08:00', value: 18, source: { system: 'SYNTHETIC_FOLLOWUP', recordId: 'synthetic-followup-record' } });
    expect(buildHealthCheckSchedule(current, rules)[0]).toEqual({ code: 'synthetic-test', routineEarliestDate: '2026-10-25',
      routineAvailable: true, abnormalRetestAvailable: false });
  });
  it('requires every approved abnormal condition to have real numeric, unit-matched and recent evidence', () => {
    const current = request(), rules = policy();
    rules.checkWhitelist[0].abnormalCriteria!.push({ observationCode: 'synthetic-marker', unit: 'marker-unit', operator: 'eq', threshold: 2, maxEvidenceAgeDays: 30 });
    expect(buildHealthCheckSchedule(current, rules)[0].abnormalRetestAvailable).toBe(false);
    expect(buildHealthCheckSchedule(current, rules)[0]).not.toHaveProperty('abnormalRetestEarliestDate');
    current.facts.observations.push({ ...current.facts.observations[0], id: 'marker', code: 'synthetic-marker', value: 2, unit: 'marker-unit' });
    expect(buildHealthCheckSchedule(current, rules)[0]).toMatchObject({ abnormalRetestAvailable: true, abnormalRetestEarliestDate: '2026-09-29' });
    for (const change of [(r: PublicHealthRequest) => { r.facts.observations[2].value = '2'; },
      (r: PublicHealthRequest) => { r.facts.observations[2].unit = 'other-unit'; },
      (r: PublicHealthRequest) => { r.facts.observations[2].observedAt = '2026-08-01T10:00:00+08:00'; }]) {
      const next = structuredClone(current); change(next);
      const constraint = buildHealthCheckSchedule(next, rules)[0];
      expect(constraint.abnormalRetestAvailable).toBe(false); expect(constraint).not.toHaveProperty('abnormalRetestEarliestDate');
    }
  });
  it('distinguishes no approved abnormal criteria from a qualified retest beyond the available window', () => {
    const current = request(), rules = policy();
    rules.checkWhitelist[0].abnormalRetestIntervalDays = 100;
    expect(buildHealthCheckSchedule(current, rules)[0]).toMatchObject({ abnormalRetestAvailable: false, abnormalRetestEarliestDate: '2026-12-29' });
    delete rules.checkWhitelist[0].abnormalCriteria;
    expect(buildHealthCheckSchedule(current, rules)[0]).not.toHaveProperty('abnormalRetestEarliestDate');
  });
});

describe('health medication guidance within institution approved classes', () => {
  it('keeps patient medication safety instructions while separating policy and model doctor reminders', () => {
    const current = request(); current.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成用药类别' }];
    const notes: string[] = [];
    const text = renderHealthMedicationGuidance({ medicationGuidance: [{ classCode: 'synthetic-class', content: '按医生处方服药，不要自行加量或停药。' }], doctorNotes: ['请医生核对现有处方。'] }, current, policy(), note => notes.push(note));
    expect(text).toContain('按医生处方服药，不要自行加量或停药。');
    expect(text).not.toContain('合成字典核对'); expect(text).not.toContain('请医生核对');
    expect(notes.join('\n')).toContain('合成字典核对提醒'); expect(notes).toContain('请医生核对现有处方。');
    expect(renderHealthMedicationGuidance({ medicationGuidance: [{ classCode: 'synthetic-class', content: '待医生核实具体用法。' }] }, current, policy())).toContain('待医生核实具体用法。');
  });
  it('allows no guidance without misreporting supplied medication records', () => {
    const current = request();
    const notes: string[] = [];
    expect(renderHealthMedicationGuidance({ medicationGuidance: [] }, current, policy(), note => notes.push(note))).toBe('');
    expect(notes.join('\n')).toContain('本次未生成可回写的用药指导');
    current.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成类别名称' }];
    expect(renderHealthMedicationGuidance({ medicationGuidance: [{ classCode: 'synthetic-class', content: '合成健康教育提醒' }] }, current, policy(), note => notes.push(note))).toBe('合成类别名称\n合成健康教育提醒');
    expect(notes.join('\n')).toContain('合成字典核对提醒');
    expect(renderHealthMedicationGuidance({ medicationGuidance: [] }, current, policy(), note => notes.push(note))).toBe('');
    expect(notes.join('\n')).not.toContain('未提供用药类别资料');
  });
  it('accepts approved classes without resident records and preserves partial guidance labels', () => {
    const current = request();
    const item = { classCode: 'synthetic-class', content: '合成健康教育提醒' };
    expect(renderHealthMedicationGuidance({ medicationGuidance: [item] }, current, policy())).toBe('用药注意事项\n合成健康教育提醒');
    const rules = policy(); rules.medicationReminders.other = '另一批准类别提醒';
    current.facts.medicationClasses = [{ code: 'synthetic-class', name: '已提供类别名称' }, { code: 'other', name: '另一类别' }];
    expect(renderHealthMedicationGuidance({ medicationGuidance: [item] }, current, rules)).toBe('已提供类别名称\n合成健康教育提醒');
    current.facts.medicationClasses = [{ code: 'other', name: '另一类别' }];
    expect(renderHealthMedicationGuidance({ medicationGuidance: [item] }, current, rules)).toBe('用药注意事项\n合成健康教育提醒');
    rules.medicationReminders['123'] = '合成提醒';
    expect(() => renderHealthMedicationGuidance({ medicationGuidance: [{ ...item, classCode: 123 }] }, current, rules)).toThrow();
  });
  it('resolves readable medication names from caller then policy while retaining the code only in doctor notes', () => {
    const current = request(), rules = policy(), notes: string[] = [];
    const draft = { medicationGuidance: [{ classCode: 'synthetic-class', content: '合成患者安全提醒' }] };
    rules.medicationClassNames = { 'synthetic-class': '合成机构类别（ABC）' };
    expect(renderHealthMedicationGuidance(draft, current, rules, note => notes.push(note))).toBe('合成机构类别（ABC）\n合成患者安全提醒');
    expect(notes.join('\n')).toContain('类别编码：synthetic-class');
    current.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成居民类别' }];
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe('合成居民类别\n合成患者安全提醒');
    for (const name of ['synthetic-class', 'SYNTHETIC-CLASS', 'CLASS-ONLY', 'SITE-TECH-合成类别', '合成MOCK_CLASS类别', '待补充类别', '示例随访检查项',
      '请医生核对类别', '\u00A0请医生核实类别\uFEFF', 'AI\u00A0定性分析', '类别 来源：机构', '医生提醒：核对类别']) {
      current.facts.medicationClasses[0].name = name;
      expect(renderHealthMedicationGuidance(draft, current, rules)).toBe('合成机构类别（ABC）\n合成患者安全提醒');
    }
    delete rules.medicationClassNames;
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe('用药注意事项\n合成患者安全提醒');
  });
  it('counts the original display-name length before trimming ECMAScript whitespace', () => {
    const current = request(), rules = policy();
    const draft = { medicationGuidance: [{ classCode: 'synthetic-class', content: '合成患者安全提醒' }] };
    const nameAtLimit = `${' '.repeat(98)}\u00A0合成类别\uFEFF${' '.repeat(96)}`;
    expect([...nameAtLimit]).toHaveLength(200);
    rules.medicationClassNames = { 'synthetic-class': nameAtLimit };
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe('合成类别\n合成患者安全提醒');
    rules.medicationClassNames['synthetic-class'] = ` ${nameAtLimit}`;
    expect(() => renderHealthMedicationGuidance(draft, current, rules)).toThrow();
  });
  it('applies internal-language filtering only to title metadata and preserves advice content', () => {
    const current = request(), rules = policy();
    current.facts.medicationClasses = [{ code: 'synthetic-class', name: '请医生核对类别' }];
    const content = '请医生核对类别。来源：既往资料。';
    expect(renderHealthMedicationGuidance({ medicationGuidance: [{ classCode: 'synthetic-class', content }] }, current, rules)).toBe(`用药注意事项\n${content}`);
  });
  it('supports mixed names and Han extension characters without requiring resident medication records', () => {
    const current = request(), rules = policy();
    const draft = { medicationGuidance: [{ classCode: 'synthetic-class', content: '合成患者安全提醒' }] };
    rules.medicationClassNames = { 'synthetic-class': '𠀀类 ABC' };
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe('𠀀类 ABC\n合成患者安全提醒');
    expect(current.facts.medicationClasses).toEqual([]);
  });
  it('keeps an explicitly supplied Chinese display name when it matches the approved class key', () => {
    const current = request(), rules = policy();
    const code = '合成中文类别';
    rules.medicationReminders = { [code]: '合成规则提醒' };
    const draft = { medicationGuidance: [{ classCode: code, content: '合成患者安全提醒' }] };
    rules.medicationClassNames = { [code]: code };
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe(`${code}\n合成患者安全提醒`);
    delete rules.medicationClassNames;
    current.facts.medicationClasses = [{ code, name: code }];
    expect(renderHealthMedicationGuidance(draft, current, rules)).toBe(`${code}\n合成患者安全提醒`);
  });
  it.each([null, [], '名称', { other: '未批准类别' }, { 'synthetic-class': '' }, { 'synthetic-class': 'CLASS-ONLY' },
    { 'synthetic-class': '合成'.repeat(101) }, { 'synthetic-class': 'SITE-TECH-合成' }, { 'synthetic-class': '待补充类别' },
    { 'synthetic-class': '合成MOCK_CLASS类别' }, { 'synthetic-class': '示例随访检查项' }, { 'synthetic-class': '请医生核对类别' },
    { 'synthetic-class': 'AI\u00A0定性分析' }, { 'synthetic-class': '医生提醒：核对类别' }])('rejects invalid policy name maps: %j', medicationClassNames => {
    const rules = { ...policy(), medicationClassNames } as unknown as HealthPrescriptionPolicy;
    expect(() => renderHealthMedicationGuidance({ medicationGuidance: [] }, request(), rules)).toThrow();
  });
  it.each(['SITE-TECH-CLASS', 'site-tech-class', 'MOCK_CLASS', 'mock_class'])('rejects known placeholder medication policies: %s', code => {
    const rules = policy(); rules.medicationReminders = { [code]: '合成提醒' };
    expect(() => renderHealthMedicationGuidance({ medicationGuidance: [] }, request(), rules)).toThrow();
  });
  it.each(['示例随访检查项', '待补充检查名称'])('rejects known placeholder check policies: %s', name => {
    const rules = policy(); rules.checkWhitelist[0].name = name;
    expect(() => renderHealthCheckPlan(checks(), request(), rules)).toThrow();
  });
  it('ignores extra medication draft fields without treating them as prescription instructions', () => {
    const draft = { medicationGuidance: [{ classCode: 'synthetic-class', content: '合成健康教育提醒', dose: 5, brand: '模型追加药名' }], extraText: '模型追加字段' };
    const text = renderHealthMedicationGuidance(draft, request(), policy());
    expect(text).toBe('用药注意事项\n合成健康教育提醒'); expect(text).not.toContain('模型追加');
  });
  it('rejects unapproved/duplicate classes, dictionary gaps and empty required content', () => {
    const current = request(); current.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成类别' }];
    const item = { classCode: 'synthetic-class', content: '合成健康教育提醒' };
    for (const medicationGuidance of [[{ ...item, classCode: 'other' }], [item, item], [{ ...item, content: ' ' }]]) {
      expect(() => renderHealthMedicationGuidance({ medicationGuidance }, current, policy())).toThrow();
    }
    const rules = policy(); rules.medicationReminders = {};
    expect(() => renderHealthMedicationGuidance({ medicationGuidance: [item] }, current, rules)).toThrow();
  });
});
