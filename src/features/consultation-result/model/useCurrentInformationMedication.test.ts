import { effectScope, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  useCurrentInformationMedication,
  type CurrentInformationMedicationContext,
  type CurrentInformationMedicationRequest,
} from './useCurrentInformationMedication';

const context = (): CurrentInformationMedicationContext => ({
  channel: 'voice', scopeKey: 'patient-1/visit-1/round-1/R05', hasSelectedDiagnosis: true,
  symptomaticOnly: true, hasMedicines: false, blocked: false, allowTreatmentRefresh: true,
  plan: { mode: 'diagnostic_first', recommendNow: ['lab_test'], defer: ['medicine'], skip: [], reason: '先检查', resumeCondition: 'report_available', confidence: 'high' },
});
const assessment = { summary: '暂无可推荐药品', disposition: 'medication_options' as const, deferred: [] };

function setup(run: (request: CurrentInformationMedicationRequest) => Promise<boolean>) {
  const state = reactive(context());
  const scope = effectScope();
  const onRequest = vi.fn();
  const controller = scope.run(() => useCurrentInformationMedication({ getContext: () => state, run, onRequest }))!;
  return { state, scope, onRequest, controller };
}

describe('useCurrentInformationMedication', () => {
  it('runs one explicit request, passes symptom-only scope and leaves automatic routing unchanged', async () => {
    let finish!: () => void;
    let activeRequest!: CurrentInformationMedicationRequest;
    const run = vi.fn(async (request: CurrentInformationMedicationRequest) => {
      activeRequest = request;
      expect(request.symptomaticOnly).toBe(true);
      await new Promise<void>((resolve) => { finish = resolve; });
      request.receive(assessment);
      return true;
    });
    const { controller, state, scope, onRequest } = setup(run);
    const first = controller.request();
    await controller.request();
    expect(run).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(controller.pending.value).toBe(true);
    expect(controller.phase.value).toBe('preparing');
    activeRequest.reportPhase('assessing');
    finish(); await first;
    expect(controller.assessment.value).toEqual(assessment);
    expect(controller.phase.value).toBe('completed');
    expect(state.plan?.recommendNow).toEqual(['lab_test']);
    expect(state.plan?.defer).toEqual(['medicine']);
    scope.stop();
  });

  it.each(['chronic-refill', 'urgent_referral', 'explicit_only', 'differential-only', 'busy', 'refresh-disabled'])('blocks %s', async (kind) => {
    const run = vi.fn(async () => true);
    const { controller, state, scope } = setup(run);
    if (kind === 'chronic-refill') state.channel = kind;
    if (kind === 'urgent_referral' || kind === 'explicit_only') state.plan!.mode = kind;
    if (kind === 'differential-only') state.hasSelectedDiagnosis = false;
    if (kind === 'busy') state.blocked = true;
    if (kind === 'refresh-disabled') state.allowTreatmentRefresh = false;
    await controller.request();
    expect(run).not.toHaveBeenCalled();
    scope.stop();
  });

  it('enables the shared symptom channel when no medicine was recommended', async () => {
    const { controller, state, scope } = setup(async (request) => { request.receive(assessment); return true; });
    state.channel = 'symptom'; state.plan = undefined; state.symptomaticOnly = false;
    await controller.request();
    expect(controller.assessment.value).toEqual(assessment);
    scope.stop();
  });

  it('rejects a late result when patient, encounter, diagnosis or clinical evidence scope changes', async () => {
    let finish!: () => void;
    let request!: CurrentInformationMedicationRequest;
    const { controller, state, scope } = setup(async (input) => {
      request = input;
      await new Promise<void>((resolve) => { finish = resolve; });
      input.receive(assessment);
      return true;
    });
    const running = controller.request();
    state.scopeKey = 'different-context';
    expect(request.isCurrent()).toBe(false);
    request.reportPhase('finalizing');
    request.receive(assessment);
    finish(); await running;
    expect(controller.assessment.value).toBeNull();
    expect(controller.pending.value).toBe(false);
    expect(controller.error.value).toBe('');
    expect(controller.phase.value).toBe('idle');
    scope.stop();
  });

  it('publishes the clinical assessment while medicine finalization is still pending', async () => {
    let finish!: () => void;
    const { controller, scope } = setup(async (request) => {
      request.reportPhase('assessing');
      request.receive(assessment);
      request.reportPhase('finalizing');
      await new Promise<void>((resolve) => { finish = resolve; });
      return true;
    });
    const running = controller.request();
    await Promise.resolve();
    expect(controller.assessment.value).toEqual(assessment);
    expect(controller.phase.value).toBe('finalizing');
    expect(controller.pending.value).toBe(true);
    finish();
    await running;
    expect(controller.phase.value).toBe('completed');
    scope.stop();
  });

  it('shows a recoverable error without discarding the previous assessment', async () => {
    const run = vi.fn(async (request: CurrentInformationMedicationRequest) => { request.receive(assessment); return true; });
    const { controller, scope } = setup(run);
    await controller.request();
    run.mockRejectedValueOnce(new Error('network detail'));
    await controller.request();
    expect(controller.error.value).toContain('原方案已保留');
    expect(controller.error.value).not.toContain('network detail');
    expect(controller.assessment.value).toEqual(assessment);
    expect(controller.disabled.value).toBe(false);
    scope.stop();
  });
});
