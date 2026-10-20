import { effectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePublicHealthController } from './usePublicHealthController';
import { generatePublicHealth, PublicHealthGenerationError } from '../api/publicHealthGeneration';
import { regionalRequestResponse } from '@/services/regionalClient';
import { identityOf } from '../lib/publicHealthContract';
import { testFeedback, testMealResult, testRequest, testResult, testTime, testUuid, testWeightRequest } from '../testFixtures';
import type { PublicHealthRequest, PublicHealthResult } from '../types';

vi.mock('@/services/regionalClient', () => ({ regionalRequestResponse: vi.fn() }));
const scopes: ReturnType<typeof effectScope>[] = [];
let fixtureSequence = 100;
function setup(request = testRequest()) {
  const scope = effectScope(); scopes.push(scope); let id = fixtureSequence; fixtureSequence += 100;
  const deps = { generate: vi.fn(async (request: PublicHealthRequest) => testResult(request)), prepare: vi.fn(async () => undefined),
    confirm: vi.fn(async () => undefined), close: vi.fn(async (): Promise<void> => undefined), uuid: () => testUuid(id++), now: () => testTime };
  const c = scope.run(() => usePublicHealthController(deps))!;
  const launch = { bridgeSessionId: testUuid(50), request };
  c.receiveLaunch(launch);
  return { c, deps, launch };
}
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers(); });
describe('independent public health task lifecycle', () => {
  it.each(['health_prescription', 'weight_management'] as const)('confirms %s freeform generation and editing, then retries the frozen text', async capability => {
    const { c, deps } = setup(capability === 'weight_management' ? testWeightRequest() : testRequest());
    const content = '运动建议\n先准备。开始活动。休息。结束。\n来源：合成资料；待医生核实。BMI24、6.2 mmol/L。';
    deps.generate.mockImplementation(async request => {
      const result = testResult(request); result.sections.forEach(section => { section.content = content; }); return result;
    });
    await c.generate(); expect(c.state.value).toBe('reviewable'); expect(c.canWriteback.value).toBe(true);
    const section = c.sections.value[0]; c.editSection(section.id, `${content}\n制定依据：医生编辑。`);
    await c.writeback(); const frozen = structuredClone(c.frozen.value!);
    expect(frozen.items[0].value).toBe(`${content}\n制定依据：医生编辑。`);
    await c.writeback(); expect(deps.confirm.mock.calls[1]).toEqual(deps.confirm.mock.calls[0]);
  });
  it('leaves empty health chapters unselected, permits physician completion, and confirms only existing advice', async () => {
    const { c, deps } = setup();
    deps.generate.mockImplementation(async request => {
      const result = testResult(request);
      result.sections[0].content = ''; result.sections[1].content = '';
      result.warnings = [{ code: 'NO_CLASS', sectionId: 'medication_guidance', message: '未提供用药类别资料，请先核对用药信息。' }];
      return result;
    });
    await c.generate(); expect(c.state.value).toBe('reviewable');
    expect(c.selected.value).toEqual(['lifestyle_guidance']);
    c.selectSection('check_plan', true); c.selectAll(true);
    expect(c.selected.value).toEqual(['lifestyle_guidance']);
    await c.writeback();
    expect(c.frozen.value!.items.map(item => item.sourceSections)).toEqual([['lifestyle_guidance']]);
    expect(JSON.stringify(c.frozen.value)).not.toContain('NO_CLASS');
    expect(JSON.stringify(c.frozen.value)).not.toContain('请先核对');
  });
  it('allows a physician to fill an empty chapter and rejects an all-empty generation', async () => {
    const { c, deps } = setup();
    deps.generate.mockImplementation(async request => {
      const result = testResult(request); result.sections[0].content = ''; return result;
    });
    await c.generate(); c.editSection('check_plan', '按预约日期携带检查资料到院。'); c.selectSection('check_plan', true);
    expect(c.selected.value).toContain('check_plan'); expect(c.canWriteback.value).toBe(true);
    c.editSection('check_plan', ''); expect(c.selected.value).not.toContain('check_plan');
    deps.generate.mockImplementation(async request => {
      const result = testResult(request); result.sections.forEach(section => { section.content = ''; }); return result;
    });
    await c.generate(); expect(c.state.value).toBe('generation-failed'); expect(c.result.value).toBeNull();
  });
  it('requires physician completed chapters for a merged PHIS field and never substitutes doctor warnings for them', async () => {
    const request = testRequest();
    request.writebackTargets = [{ targetFieldId: 'combined', label: '综合指导', sourceSections: ['check_plan', 'medication_guidance', 'lifestyle_guidance'], valueType: 'string', mode: 'replace' }];
    const { c, deps } = setup(request);
    deps.generate.mockImplementation(async request => {
      const result = testResult(request); result.sections[0].content = ''; result.sections[1].content = '';
      result.warnings = [{ code: 'NO_PATIENT_CONTENT', message: '请医生核对资料后补充患者正文。' }]; return result;
    });
    await c.generate(); c.selectAll(true);
    expect(c.canWriteback.value).toBe(false); await c.writeback(); expect(deps.confirm).not.toHaveBeenCalled();
    c.editSection('check_plan', '按预约时间完成检查。'); c.editSection('medication_guidance', '按现有处方服药，不要自行停药。'); c.selectAll(true);
    expect(c.canWriteback.value).toBe(true); await c.writeback();
    expect(c.frozen.value!.items).toHaveLength(1);
    expect(c.frozen.value!.items[0].value).toContain('用药指导\n按现有处方服药，不要自行停药。');
    expect(JSON.stringify(c.frozen.value)).not.toContain('请医生核对');
  });
  it('accepts freeform physician edits and keeps separate warnings through meal choice, save failure and retransmission', async () => {
    const { c, deps, launch } = setup(testWeightRequest()); deps.generate.mockImplementation(async request => testMealResult(request));
    await c.generate(); c.selectSection('exercise_plan', false);
    const meal = c.result.value!.sections[1].options!;
    c.selectMealOption(meal[1].id); c.editSection('meal_plan', '待医生核实事项\n请医生核对食物过敏史。');
    expect(c.canWriteback.value).toBe(true); c.selectSection('meal_plan', true);
    await c.writeback(); const first = structuredClone(c.frozen.value!);
    expect(first.items[0].value).toBe('待医生核实事项\n请医生核对食物过敏史。');
    expect(JSON.stringify(first)).not.toContain('适用性待核实');
    expect(first).not.toHaveProperty('warnings'); expect(first).not.toHaveProperty('options');
    expect(c.result.value!.warnings[0].message).toContain('适用性待核实');
    await c.writeback(); expect(deps.confirm.mock.calls[1]).toEqual(deps.confirm.mock.calls[0]);
    c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(first, 'failed') });
    expect(c.values.value.meal_plan).toBe(first.items[0].value); expect(c.result.value!.warnings).toHaveLength(1);
    c.selectMealOption(meal[2].id); await c.writeback();
    expect(c.frozen.value!.items[0].value).toBe(meal[2].content);
    expect(c.frozen.value!.writebackRequestId).not.toBe(first.writebackRequestId);
    expect(JSON.stringify(c.frozen.value)).not.toContain('适用性待核实');
  });
  it('restores and retransmits an old freeform draft unchanged, and allows editing after save failure', async () => {
    const first = setup(); await first.c.generate(); await first.c.writeback();
    const pendingWriteback = structuredClone(first.c.frozen.value!);
    pendingWriteback.items[0].value = '检查安排\n请医生核对准备事项。';
    const second = setup();
    second.c.restore({ ...first.launch, originRequestId: first.launch.request.originRequestId, phase: 'awaiting-writeback', pendingWriteback, lastFeedback: null });
    expect(second.c.frozen.value!.items[0].value).toBe(pendingWriteback.items[0].value);
    await second.c.writeback(); expect(second.deps.confirm).toHaveBeenCalledWith(first.launch.bridgeSessionId, pendingWriteback);
    expect(second.c.message.value).not.toContain('内部说明');
    second.c.receiveFeedback({ bridgeSessionId: first.launch.bridgeSessionId, feedback: testFeedback(pendingWriteback, 'failed') });
    expect(second.c.canWriteback.value).toBe(true);
    second.c.editRestoredTarget(pendingWriteback.items[0].targetFieldId, '检查当天携带既往检查资料。');
    expect(second.c.canWriteback.value).toBe(true); await second.c.writeback();
    expect(second.c.frozen.value!.items[0].value).toBe('检查当天携带既往检查资料。');
    expect(second.c.frozen.value!.writebackRequestId).not.toBe(pendingWriteback.writebackRequestId);
  });
  it('keeps each meal draft, confirms one option, and freezes selection during retransmission', async () => {
    const { c, deps } = setup(testWeightRequest()); deps.generate.mockImplementation(async request => testMealResult(request));
    await c.generate(); const options = c.result.value!.sections[1].options!;
    expect(c.selectedMealOptionId.value).toBe(options[0].id); expect(c.values.value.meal_plan).toBe(options[0].content);
    c.editSection('meal_plan', '医生编辑的合成推荐食谱');
    c.selectMealOption(options[1].id); c.editSection('meal_plan', '医生编辑的合成备选1');
    c.selectMealOption(options[2].id); expect(c.values.value.meal_plan).toBe(options[2].content);
    c.selectMealOption(options[0].id); expect(c.values.value.meal_plan).toBe('医生编辑的合成推荐食谱');
    c.selectMealOption(options[1].id); expect(c.values.value.meal_plan).toBe('医生编辑的合成备选1');
    c.selectMealOption('unknown-source'); expect(c.selectedMealOptionId.value).toBe(options[1].id);
    c.selectSection('exercise_plan', false); await c.writeback();
    const frozen = structuredClone(c.frozen.value!);
    expect(frozen.items).toEqual([{ targetFieldId: 'target-meal_plan', sourceSections: ['meal_plan'], value: '医生编辑的合成备选1' }]);
    c.selectMealOption(options[2].id); c.editSection('meal_plan', '等待时不可改');
    expect(c.selectedMealOptionId.value).toBe(options[1].id); expect(c.values.value.meal_plan).toBe(frozen.items[0].value);
    await c.writeback(); expect(deps.confirm.mock.calls[1]).toEqual(deps.confirm.mock.calls[0]);
    expect(c.frozen.value).toEqual(frozen);
  });
  it('permits changing option after failed save with a new attempt, and locks successful or conflicting saves', async () => {
    for (const terminal of ['success', 'conflict'] as const) {
      const { c, deps, launch } = setup(testWeightRequest()); deps.generate.mockImplementation(async request => testMealResult(request));
      await c.generate(); const options = c.result.value!.sections[1].options!;
      await c.writeback(); const first = c.frozen.value!;
      c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(first, 'failed') });
      c.selectMealOption(options[2].id); expect(c.frozen.value).toBeNull();
      await c.writeback(); const next = c.frozen.value!;
      expect(next.writebackRequestId).not.toBe(first.writebackRequestId); expect(next.items[1].value).toBe(options[2].content);
      c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: terminal === 'success' ? testFeedback(next) : testFeedback(next, 'failed', 'RECORD_VERSION_CONFLICT') });
      c.selectMealOption(options[0].id); expect(c.selectedMealOptionId.value).toBe(options[2].id);
    }
  });
  it('clears meal selection and edits on regeneration and task change, and rejects empty current text', async () => {
    const { c, deps, launch } = setup(testWeightRequest()); deps.generate.mockImplementation(async request => testMealResult(request));
    await c.generate(); const options = c.result.value!.sections[1].options!;
    c.selectSection('exercise_plan', false); c.selectMealOption(options[1].id); c.editSection('meal_plan', '');
    expect(c.canWriteback.value).toBe(false); await c.writeback(); expect(deps.confirm).not.toHaveBeenCalled();
    c.editSection('meal_plan', '合成修改'); await c.generate();
    expect(c.selectedMealOptionId.value).toBe(options[0].id); expect(c.mealOptionValues.value[options[1].id]).toBe(options[1].content);
    const next = { ...launch.request, requestId: testUuid(77), originRequestId: testUuid(77), patientId: 'synthetic-next' };
    c.receiveLaunch({ ...launch, request: next }); expect(c.selectedMealOptionId.value).toBeNull(); expect(c.mealOptionValues.value).toEqual({});
    c.selectMealOption(options[2].id); expect(c.selectedMealOptionId.value).toBeNull();
  });
  it('prepares identity before generation and preserves the original PHIS association after regeneration', async () => {
    const { c, deps, launch } = setup(); await c.generate();
    expect(deps.prepare.mock.invocationCallOrder[0]).toBeLessThan(deps.generate.mock.invocationCallOrder[0]);
    expect(c.state.value).toBe('reviewable'); expect(c.request.value?.requestId).toBe(launch.request.requestId);
    c.editSection('check_plan', '医生合成编辑稿'); const generationId = c.result.value?.generationId;
    expect(c.result.value?.generationId).toBe(generationId);
    await c.generate();
    expect(c.request.value?.requestId).not.toBe(launch.request.requestId);
    expect(c.request.value?.originRequestId).toBe(launch.request.originRequestId);
  });
  it('locks a snapshot until receipt; retransmission keeps its ID and failure retry creates a new attempt', async () => {
    const { c, deps, launch } = setup(); await c.generate();
    c.editSection('check_plan', '合成已编辑内容'); c.selectSection('medication_guidance', false);
    await c.writeback(); const frozen = structuredClone(c.frozen.value!);
    expect(c.state.value).toBe('awaiting-writeback'); expect(c.editable.value).toBe(false);
    c.editSection('check_plan', 'should not apply'); expect(c.values.value.check_plan).toBe('合成已编辑内容');
    await c.writeback(); expect(deps.confirm.mock.calls[1]).toEqual(deps.confirm.mock.calls[0]);
    expect(c.receiveFeedback({ bridgeSessionId: testUuid(51), feedback: testFeedback(frozen) })).toBe(false);
    expect(c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(frozen, 'failed') })).toBe(true);
    expect(c.state.value).toBe('writeback-failed'); expect(c.selected.value).toEqual(['check_plan', 'lifestyle_guidance']);
    expect(c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(frozen) })).toBe(false);
    await c.writeback(); expect(c.frozen.value?.writebackRequestId).not.toBe(frozen.writebackRequestId);
    expect(c.frozen.value?.items).toEqual(frozen.items);
  });
  it('does not treat local timeout as failure and accepts a late matching PHIS receipt', async () => {
    vi.useFakeTimers(); const { c, launch } = setup(); await c.generate(); await c.writeback();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(c.state.value).toBe('awaiting-writeback'); expect(c.message.value).toContain('尚未收到');
    c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(c.frozen.value!) });
    expect(c.state.value).toBe('saved'); expect(c.canGenerate.value).toBe(false);
  });
  it('preserves the draft on a record-version conflict and requires a fresh PHIS launch', async () => {
    const { c, launch } = setup(); await c.generate(); c.editSection('check_plan', '合成保留草稿'); await c.writeback();
    c.receiveFeedback({ bridgeSessionId: launch.bridgeSessionId, feedback: testFeedback(c.frozen.value!, 'failed', 'RECORD_VERSION_CONFLICT') });
    expect(c.state.value).toBe('conflict'); expect(c.values.value.check_plan).toBe('合成保留草稿');
    expect(c.canGenerate.value).toBe(false); expect(c.canWriteback.value).toBe(false);
    expect(c.request.value?.recordVersion).toBe('7');
  });
  it('discards a late generation after a different patient task arrives', async () => {
    const { c, deps, launch } = setup(); let resolve!: (result: PublicHealthResult) => void;
    deps.generate.mockImplementation(() => new Promise(r => { resolve = r; }));
    const running = c.generate(); await Promise.resolve();
    const next = { ...launch, request: { ...launch.request, patientId: 'next-patient', requestId: testUuid(60), originRequestId: testUuid(60) } };
    c.receiveLaunch(next); resolve(testResult(launch.request)); await running;
    expect(c.request.value?.patientId).toBe('next-patient'); expect(c.result.value).toBeNull(); expect(c.state.value).toBe('ready');
  });
  it('stops local waiting without applying late content or claiming remote cancellation', async () => {
    const { c, deps, launch } = setup(); let resolve!: (result: PublicHealthResult) => void;
    deps.generate.mockImplementation(() => new Promise(r => { resolve = r; }));
    const running = c.generate(); await Promise.resolve(); c.stopWaiting(); resolve(testResult(launch.request)); await running;
    expect(c.state.value).toBe('ready'); expect(c.result.value).toBeNull(); expect(c.message.value).toContain('不代表服务端已取消');
  });
  it('blocks knowledge and policy failures without generating local medical content', async () => {
    const { c, deps } = setup();
    for (const code of ['KNOWLEDGE_NOT_READY', 'POLICY_NOT_READY']) {
      deps.generate.mockRejectedValueOnce(new PublicHealthGenerationError('内容未就绪', code, true));
      await c.generate(); expect(c.state.value).toBe('knowledge-missing'); expect(c.result.value).toBeNull(); expect(c.canWriteback.value).toBe(false);
    }
  });
  it('reconnects an interrupted generation with the same request and a new local run', async () => {
    const { c, deps } = setup(); deps.generate.mockRejectedValueOnce(new PublicHealthGenerationError('断流', 'STREAM_INTERRUPTED', false));
    await c.generate(); const requestId = c.request.value?.requestId;
    expect(c.reconnectable.value).toBe(true); await c.generate(true);
    expect(c.request.value?.requestId).toBe(requestId); expect(c.state.value).toBe('reviewable');
  });
  it('keeps one request through disconnection, running 409, and complete replay', async () => {
    const { c, deps, launch } = setup();
    const request = launch.request, result = testResult(request);
    const frame = (event: string, stream: number, sequence: number, extra: object) => `event: ${event}\nid: ${testUuid(stream)}:${sequence}\ndata: ${JSON.stringify({ schemaVersion: 'public-health.v1', ...identityOf(request), generationId: result.generationId, streamId: testUuid(stream), sequence, ...extra })}\n\n`;
    const response = (body: string) => ({ response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }), requestId: testUuid(99) });
    vi.mocked(regionalRequestResponse).mockReset()
      .mockResolvedValueOnce(response(frame('accepted', 20, 1, { mode: 'new', acceptedAt: testTime })))
      .mockRejectedValueOnce(Object.assign(new Error('still processing'), { code: 'GENERATION_IN_PROGRESS', status: 409 }))
      .mockResolvedValueOnce(response(frame('accepted', 21, 1, { mode: 'replayed', acceptedAt: testTime }) + frame('completed', 21, 2, { result })));
    deps.generate.mockImplementation(request => generatePublicHealth(request, () => undefined, new AbortController().signal));
    await c.generate(); expect(c.reconnectable.value).toBe(true);
    await c.generate(true); expect(c.reconnectable.value).toBe(true); expect(c.message.value).toContain('仍在服务端');
    await c.generate(true); expect(c.state.value).toBe('reviewable'); expect(c.result.value?.generationId).toBe(result.generationId);
    const requestIds = vi.mocked(regionalRequestResponse).mock.calls.map(call => JSON.parse(call[1]!.body as string).requestId);
    expect(requestIds).toEqual([request.requestId, request.requestId, request.requestId]);
    expect(c.request.value?.originRequestId).toBe(request.originRequestId);
  });
  it('restores pending content and terminal receipts without inventing a new generation result', async () => {
    const first = setup(); await first.c.generate(); await first.c.writeback();
    const pendingWriteback = first.c.frozen.value!;
    const second = setup();
    second.c.restore({ ...first.launch, originRequestId: first.launch.request.originRequestId, phase: 'awaiting-writeback', pendingWriteback, lastFeedback: null });
    expect(second.c.state.value).toBe('awaiting-writeback'); expect(second.c.frozen.value?.items).toEqual(pendingWriteback.items); expect(second.c.result.value).toBeNull();
    second.c.restore({ ...first.launch, originRequestId: first.launch.request.originRequestId, phase: 'saved', pendingWriteback, lastFeedback: testFeedback(pendingWriteback) });
    expect(second.c.state.value).toBe('saved');
  });
  it('does not let an old close completion clear a newly launched task', async () => {
    const { c, deps, launch } = setup(); let resolve!: () => void;
    deps.close.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    const pending = c.close();
    c.receiveLaunch({ ...launch, request: { ...launch.request, requestId: testUuid(70), originRequestId: testUuid(70), patientId: 'new-patient' } });
    resolve(); await expect(pending).resolves.toBe(false);
    expect(c.request.value?.patientId).toBe('new-patient'); expect(c.state.value).toBe('ready');
  });
  it('can edit restored merged-target text after failure and save it as a new attempt', async () => {
    const first = setup();
    const request = first.launch.request;
    request.writebackTargets = [{ targetFieldId: 'combined-guidance', label: '综合指导', sourceSections: ['check_plan', 'medication_guidance', 'lifestyle_guidance'], valueType: 'string', mode: 'replace' }];
    request.originRequestId = request.requestId = testUuid(80);
    first.c.receiveLaunch(first.launch); await first.c.generate(); await first.c.writeback();
    const pendingWriteback = structuredClone(first.c.frozen.value!);
    const second = setup();
    second.c.restore({ ...first.launch, originRequestId: request.originRequestId, phase: 'failed', pendingWriteback, lastFeedback: testFeedback(pendingWriteback, 'failed') });
    expect(second.c.result.value).toBeNull(); expect(second.c.canWriteback.value).toBe(true);
    expect(second.c.selected.value).toEqual(pendingWriteback.items[0].sourceSections);
    second.c.editRestoredTarget('combined-guidance', '合成恢复后的医生编辑全文');
    second.c.selectAll(false); // A target snapshot cannot reconstruct the original section boundaries.
    await second.c.writeback();
    expect(second.c.frozen.value?.writebackRequestId).not.toBe(pendingWriteback.writebackRequestId);
    expect(second.c.frozen.value?.generationId).toBe(pendingWriteback.generationId);
    expect(second.c.frozen.value?.items).toEqual([{ ...pendingWriteback.items[0], value: '合成恢复后的医生编辑全文' }]);
    const attempt = structuredClone(second.c.frozen.value!); await second.c.writeback();
    expect(second.c.frozen.value).toEqual(attempt);
  });
  it('rejects a restored target snapshot with a different patient or unallowed source sections', async () => {
    const first = setup(); await first.c.generate(); await first.c.writeback();
    const pendingWriteback = structuredClone(first.c.frozen.value!);
    const second = setup();
    const snapshot = { ...first.launch, originRequestId: first.launch.request.originRequestId, phase: 'awaiting-writeback' as const, pendingWriteback, lastFeedback: null };
    pendingWriteback.patientId = 'wrong-patient'; expect(() => second.c.restore(snapshot)).toThrow();
    pendingWriteback.patientId = first.launch.request.patientId;
    pendingWriteback.items[0].sourceSections = ['medication_guidance']; expect(() => second.c.restore(snapshot)).toThrow();
    expect(second.c.frozen.value).toBeNull();
  });
});
