import { describe, expect, it } from 'vitest';
import { assertConfirmation, assertRequest, assertResult, assertSection, buildConfirmation, characterCount, matchesFeedback, missingFacts, SECTION_IDS, supplementFacts } from './publicHealthContract';
import { testFeedback, testMealResult, testRequest, testResult, testTime, testUuid, testValues, testWeightRequest } from '../testFixtures';
import type { PublicHealthRequest, PublicHealthResult, PublicHealthSection } from '../types';

describe('public health facts and writeback boundaries', () => {
  it('keeps physician warnings outside all confirmed target content and metadata, including combined fields', () => {
    const request = testRequest(), result = testResult(request);
    request.writebackTargets = [{ targetFieldId: 'combined', label: '综合指导', sourceSections: ['check_plan', 'medication_guidance', 'lifestyle_guidance'], valueType: 'string', mode: 'replace' }];
    result.warnings = [{ code: 'DOCTOR_REVIEW', message: '请医生核对证据：合成资料。', sectionId: 'lifestyle_guidance' }];
    const confirmation = buildConfirmation(request, result, testValues(request), SECTION_IDS.health_prescription, testUuid(9), testTime);
    expect(confirmation.items).toHaveLength(1);
    expect(confirmation.items[0].value).toContain('生活方式建议\n合成测试正文-lifestyle_guidance');
    expect(JSON.stringify(confirmation)).not.toContain('请医生核对');
    expect(confirmation).not.toHaveProperty('warnings'); expect(confirmation).not.toHaveProperty('doctorNotes');
    expect(() => assertConfirmation({ ...confirmation, warnings: result.warnings } as never, request)).toThrow('附加字段');
    const withItemNote = structuredClone(confirmation); Object.assign(withItemNote.items[0], { doctorNotes: ['医生提醒'] });
    expect(() => assertConfirmation(withItemNote, request)).toThrow('回写范围');
  });
  it('accepts empty health-only chapters when another patient chapter exists, and rejects all-empty or weight results', () => {
    const request = testRequest(), result = testResult(request);
    result.sections[0].content = ''; result.sections[1].content = '';
    expect(() => assertResult(result, request)).not.toThrow();
    const confirmation = buildConfirmation(request, result, { lifestyle_guidance: result.sections[2].content }, ['lifestyle_guidance'], testUuid(9), testTime);
    expect(confirmation.items.map(item => item.sourceSections)).toEqual([['lifestyle_guidance']]);
    expect(() => buildConfirmation(request, result, { check_plan: '' }, ['check_plan'], testUuid(9), testTime)).toThrow('为空');
    result.sections[2].content = ''; expect(() => assertResult(result, request)).toThrow('未生成');
    const weight = testWeightRequest(), weightResult = testResult(weight); weightResult.sections[0].content = '';
    expect(() => assertResult(weightResult, weight)).toThrow('章节无效');
  });
  it('rejects explanatory text from every meal option and edited confirmation while retaining long physician edits', () => {
    const request = testWeightRequest(), result = testMealResult(request);
    result.sections[1].options![2].content += '\n待医生核实事项\n适用性待核实。';
    expect(() => assertResult(result, request)).toThrow('内部说明');
    const clean = testMealResult(request);
    expect(() => buildConfirmation(request, clean, { exercise_plan: '制定依据\n当前资料如下' }, ['exercise_plan'], testUuid(9), testTime)).toThrow('内部说明');
    const edited = '每天记录身体活动，出现不适停止运动。'.repeat(30);
    const confirmation = buildConfirmation(request, clean, { exercise_plan: edited }, ['exercise_plan'], testUuid(9), testTime);
    expect(confirmation.items[0].value).toBe(edited);
  });
  it('rejects an over-sentence generated exercise section but permits a physician to edit the valid generated result beyond its style limit', () => {
    const request = testWeightRequest(), result = testResult(request);
    const invalid = structuredClone(result);
    invalid.sections[0].content = invalid.sections[0].content.replace('1. ', '1. 先准备。开始运动。');
    expect(() => assertResult(invalid, request)).toThrow('每条最多 2 句');
    expect(() => assertResult(result, request)).not.toThrow();
    const edited = '按医生安排完成活动，出现不适停止运动并及时就诊。'.repeat(25);
    const payload = buildConfirmation(request, result, { exercise_plan: edited }, ['exercise_plan'], testUuid(9), testTime);
    expect(payload.items[0].value).toBe(edited);
  });
  it('accepts three meal options bound to the default, while confirmation still contains only current text', () => {
    const request = testWeightRequest(), result = testMealResult(request), meal = result.sections[1];
    expect(() => assertResult(result, request)).not.toThrow();
    const current = meal.options![2].content;
    const payload = buildConfirmation(request, result, { meal_plan: current }, ['meal_plan'], testUuid(9), testTime);
    expect(payload.items).toEqual([{ targetFieldId: 'target-meal_plan', sourceSections: ['meal_plan'], value: current }]);
    expect(payload).not.toHaveProperty('options');
    expect(() => assertSection({ ...meal, id: 'exercise_plan' }, 'weight_management')).toThrow('食谱选项');
    delete meal.options; expect(() => assertResult(result, request)).not.toThrow();
  });
  it.each<[string, (section: PublicHealthSection) => void]>([
    ['missing alternative', section => { section.options!.pop(); }],
    ['extra alternative', section => { section.options!.push({ id: 'four', title: '合成', content: '合成' }); }],
    ['duplicate source ID', section => { section.options![2].id = section.options![0].id; }],
    ['default content mismatch', section => { section.content = 'other'; }],
    ['blank alternative', section => { section.options![2].content = '  '; }],
    ['invalid ID', section => { section.options![1].id = 1 as never; }],
    ['overlong ID', section => { section.options![1].id = '𠮷'.repeat(129); }],
    ['overlong title', section => { section.options![1].title = '𠮷'.repeat(101); }],
    ['overlong alternative', section => { section.options![2].content = '𠮷'.repeat(16001); }],
    ['extra option field', section => { Object.assign(section.options![1], { extra: true }); }],
    ['null options', section => { section.options = null as never; }],
  ])('rejects invalid meal selection data: %s', (_label, mutate) => {
    const request = testWeightRequest(), result = testMealResult(request);
    mutate(result.sections[1]); expect(() => assertResult(result, request)).toThrow();
  });
  it('does not treat height/weight values without measurement references as complete', () => {
    const request = testRequest('weight_management');
    request.facts.weightProfile = { heightCm: 160, weightKg: 68, region: '华东', season: 'autumn' };
    expect(() => assertRequest(request)).not.toThrow();
    expect(missingFacts(request)).toEqual(['身高及测量来源', '体重及测量来源']);
  });
  it('records manual measurements with explicit observed times and stable origin', () => {
    const request = testRequest('weight_management'); request.patient.sex = 'unknown';
    let id = 10;
    const next = supplementFacts(request, { historySummary: '', sex: 'female', heightCm: 160, weightKg: 68,
      heightMeasuredAt: '2026-09-20T08:00:00+08:00', weightMeasuredAt: '2026-09-21T08:00:00+08:00', region: '华东', season: 'autumn' }, () => testUuid(id++), () => testTime);
    expect(next.originRequestId).toBe(request.originRequestId);
    expect(next.requestId).not.toBe(request.requestId);
    expect(next.patient.sexSource?.system).toBe('PCIE_MANUAL');
    expect(next.facts.observations[0].observedAt).toBe('2026-09-20T08:00:00+08:00');
    expect(next.facts.observations[0].source.system).toBe('PCIE_MANUAL');
    expect(missingFacts(next)).toEqual([]);
    const unchanged = supplementFacts(next, { historySummary: '仅补充摘要', sex: 'female', heightCm: 160, weightKg: 68,
      heightMeasuredAt: next.facts.observations[0].observedAt, weightMeasuredAt: next.facts.observations[1].observedAt,
      region: '华东', season: 'autumn' }, () => testUuid(id++), () => testTime);
    expect(unchanged.facts.observations).toEqual(next.facts.observations);
    expect(unchanged.facts.weightProfile?.heightObservationId).toBe(next.facts.weightProfile?.heightObservationId);
    next.facts.observations[0].value = 170;
    expect(missingFacts(next)).toContain('身高及测量来源');
    expect(request.facts.observations).toEqual([]);
  });
  it('never invents measurement time or changes an established sex', () => {
    expect(() => supplementFacts(testRequest('weight_management'), { historySummary: '', sex: 'female', heightCm: 160, weightKg: 68, region: '华东', season: 'autumn' }, () => testUuid(5), () => testTime)).toThrow('真实测量时间');
    expect(() => supplementFacts(testRequest(), { historySummary: '', sex: 'male' }, () => testUuid(5), () => testTime)).toThrow('PHIS');
  });
  it('rejects duplicated or unmapped sections in the PHIS allowlist', () => {
    const request = testRequest(); request.writebackTargets[0].sourceSections.push('medication_guidance');
    expect(() => assertRequest(request)).toThrow('范围');
  });
  it('writes only fully selected targets, preserving edited text and omitting metrics', () => {
    const request = testRequest(); const result = testResult(request); const values = testValues(request);
    values.check_plan = '医生编辑的合成测试正文';
    const payload = buildConfirmation(request, result, values, ['check_plan', 'lifestyle_guidance'], testUuid(9), testTime);
    expect(payload.items.map(item => item.targetFieldId)).toEqual(['target-check_plan', 'target-lifestyle_guidance']);
    expect(payload.items[0].value).toBe(values.check_plan);
    expect(payload).not.toHaveProperty('metrics');
    request.writebackTargets = [{ targetFieldId: 'all', label: '总稿', sourceSections: [...SECTION_IDS.health_prescription], valueType: 'string', mode: 'replace' }];
    expect(() => buildConfirmation(request, result, values, ['check_plan'], testUuid(9), testTime)).toThrow('完整选择');
    const combined = buildConfirmation(request, result, values, SECTION_IDS.health_prescription, testUuid(9), testTime);
    expect(combined.items).toHaveLength(1); expect(combined.items[0].value).toContain('用药指导\n');
  });
  it('rejects wrong context, missing sections and mismatched terminal receipts', () => {
    const request = testRequest(); const result = testResult(request);
    expect(() => assertResult({ ...result, businessRecordId: 'other' }, request)).toThrow('不一致');
    expect(() => assertResult({ ...result, sections: result.sections.slice(1) }, request)).toThrow('不一致');
    const payload = buildConfirmation(request, result, testValues(request), SECTION_IDS.health_prescription, testUuid(9), testTime);
    expect(matchesFeedback(testFeedback(payload), payload)).toBe(true);
    expect(matchesFeedback({ ...testFeedback(payload), patientId: 'other' }, payload)).toBe(false);
    expect(matchesFeedback({ ...testFeedback(payload), errorCode: 'CONFLICT' }, payload)).toBe(false);
    expect(matchesFeedback(testFeedback(payload, 'failed', 'RECORD_VERSION_CONFLICT'), payload)).toBe(true);
  });
  it('counts section and merged target limits in Unicode code points', () => {
    const request = testRequest(), result = testResult(request);
    result.sections.forEach(section => { section.content = '𠮷'.repeat(16000); section.title = '𠮷'.repeat(100); });
    expect(() => assertResult(result, request)).not.toThrow();
    request.writebackTargets = [{ targetFieldId: 'all', label: '合并', sourceSections: [...SECTION_IDS.health_prescription], valueType: 'string', mode: 'replace' }];
    const values = Object.fromEntries(result.sections.map(section => [section.id, section.content]));
    const payload = buildConfirmation(request, result, values, SECTION_IDS.health_prescription, testUuid(9), testTime);
    expect(characterCount(payload.items[0].value)).toBeGreaterThan(48000);
    payload.items[0].value = '𠮷'.repeat(64000); expect(() => assertConfirmation(payload, request)).not.toThrow();
    payload.items[0].value += '𠮷'; expect(() => assertConfirmation(payload, request)).toThrow('范围');
    result.sections[0].content += '𠮷'; expect(() => assertResult(result, request)).toThrow('章节');
  });
  it('applies the same code-point counting to the 12000-character manual summary', () => {
    const request = testRequest();
    expect(() => supplementFacts(request, { historySummary: '𠮷'.repeat(12000), sex: 'female' }, () => testUuid(9), () => testTime)).not.toThrow();
    expect(() => supplementFacts(request, { historySummary: '𠮷'.repeat(12001), sex: 'female' }, () => testUuid(9), () => testTime)).toThrow('12000');
  });
  it.each<[string, (request: PublicHealthRequest) => void]>([
    ['invalid manual sex source', request => { request.patient.sexSource = { system: 'PCIE_MANUAL', recordId: 'bad' }; }],
    ['boolean observation', request => { request.facts.observations[0].value = true as never; }],
    ['nonfinite observation', request => { request.facts.observations[0].value = Infinity; }],
    ['unsafe observation number', request => { request.facts.observations[0].value = Number.MAX_SAFE_INTEGER + 1; }],
    ['invalid observed time', request => { request.facts.observations[0].observedAt = 'bad'; }],
    ['invalid calendar day', request => { request.facts.observations[0].observedAt = '2026-02-30T10:00:00+08:00'; }],
    ['invalid manual observation source', request => { request.facts.observations[0].source = { system: 'PCIE_MANUAL', recordId: 'bad' }; }],
    ['unbounded observations', request => { request.facts.observations = Array.from({ length: 257 }, (_, index) => ({ ...request.facts.observations[0], id: String(index) })); }],
    ['unbounded conditions', request => { request.facts.conditions = Array.from({ length: 65 }, () => ({ code: 'c', name: '合成', status: 'active' })); }],
    ['empty medication class', request => { request.facts.medicationClasses = [{} as never]; }],
    ['unbounded medication classes', request => { request.facts.medicationClasses = Array.from({ length: 65 }, () => ({ code: 'c', name: '合成' })); }],
    ['invalid lifestyle value', request => { request.facts.lifestyle.diet = true as never; }],
    ['unknown facts property', request => { Object.assign(request.facts, { systemPrompt: 'not allowed' }); }],
    ['oversized summary', request => { request.facts.historySummary = '𠮷'.repeat(12001); }],
    ['oversized fact text', request => { request.facts.observations[0].value = '𠮷'.repeat(2001); }],
    ['invalid next followup date', request => { request.facts.nextFollowUpDate = '2026-02-30'; }],
    ['invalid context source', request => { request.facts.weightProfile = { heightCm: 160, weightKg: 66, region: '华东', season: 'autumn', contextSource: { system: 'PCIE_MANUAL', recordId: 'bad' } }; }],
  ])('rejects malformed facts at the desktop boundary: %s', (_name, mutate) => {
    const request = testRequest();
    request.facts.observations = [{ id: 'measurement', code: 'height', value: 160, unit: 'cm', observedAt: testTime, source: { system: 'PHIS', recordId: 'record' } }];
    mutate(request);
    expect(() => assertRequest(request)).toThrow();
  });
  it.each<[string, (result: PublicHealthResult) => void]>([
    ['empty prompt version', result => { result.promptVersions = [{} as never]; }],
    ['oversized prompt version', result => { result.promptVersions[0].version = '𠮷'.repeat(129); }],
    ['too many prompt versions', result => { result.promptVersions = Array.from({ length: 17 }, () => ({ code: 'code', version: '1' })); }],
    ['invalid knowledge hash', result => { result.knowledgeVersions = [{ assetId: 'asset', version: '1', sha256: 'invalid' }]; }],
    ['invalid knowledge identity', result => { result.knowledgeVersions = [{ assetId: '', version: '1', sha256: 'a'.repeat(64) }]; }],
    ['too many knowledge versions', result => { result.knowledgeVersions = Array.from({ length: 17 }, () => ({ assetId: 'asset', version: '1', sha256: 'a'.repeat(64) })); }],
    ['missing warning message', result => { result.warnings = [{ code: 'x' } as never]; }],
    ['invalid warning section', result => { result.warnings = [{ code: 'x', message: '合成', sectionId: 'unknown' as never }]; }],
    ['too many warnings', result => { result.warnings = Array.from({ length: 33 }, () => ({ code: 'x', message: '合成' })); }],
  ])('rejects invalid result provenance or warnings: %s', (_name, mutate) => {
    const request = testRequest(), result = testResult(request); mutate(result);
    expect(() => assertResult(result, request)).toThrow();
  });
  it('accepts bounded facts and valid provenance without requiring missing local weight inputs', () => {
    const request = testRequest('weight_management'); request.patient.sex = 'unknown';
    expect(() => assertRequest(request)).not.toThrow(); expect(missingFacts(request).length).toBeGreaterThan(0);
    request.patient.sexSource = { system: 'PCIE_MANUAL', recordId: testUuid(99) };
    request.facts.observations = [{ id: 'fact', code: 'synthetic', value: Number.MAX_SAFE_INTEGER, observedAt: testTime, source: { system: 'PCIE_MANUAL', recordId: testUuid(98) } }];
    expect(() => assertRequest(request)).not.toThrow();
    const result = testResult(request);
    result.knowledgeVersions = [{ assetId: 'synthetic-asset', version: '1', sha256: 'a'.repeat(64) }];
    result.warnings = [{ code: 'SYNTHETIC', message: '合成验证', sectionId: 'exercise_plan' }];
    expect(() => assertResult(result, request)).not.toThrow();
  });
});
