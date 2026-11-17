// @vitest-environment jsdom
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import { buildPatientContext } from '@/utils/patientContext';
import type {
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordContext,
  VoiceOutpatientEmrStartContext,
} from '../types';
import { clearVoiceOutpatientEmrRecordDraftCache, useVoiceOutpatientEmrRecord } from './useVoiceOutpatientEmrRecord';
import type { OutpatientEmrAnalysisDependencies } from './useOutpatientEmrAnalysis';

function context(): VoiceOutpatientEmrStartContext {
  return {
    visitId: 'SYN-VISIT',
    template: {
      templateId: 'SYN-TEMPLATE', templateName: '合成模板', requestId: 'SYN-REQUEST',
      targetFieldIds: ['chiefComplaint', 'familyHistory'],
      templateHtml: '<section data-id="chief" data-article="主诉" data-name="主诉">'
        + '<span data-id="chiefComplaint" data-name="主诉" data-type="text" data-readonly="false"></span></section>'
        + '<section data-id="family" data-article="家族史" data-name="家族史">'
        + '<span data-id="familyHistory" data-name="家族史" data-type="text" data-readonly="false"></span></section>',
      templateDefinition: JSON.stringify([
        { ID: 'chief', NAME: '主诉', ARTICLE: '主诉', eles: [
          { ID: 'chiefComplaint', NAME: '主诉', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
        ] },
        { ID: 'family', NAME: '家族史', ARTICLE: '家族史', eles: [
          { ID: 'familyHistory', NAME: '家族史', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
        ] },
      ]),
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const scopes: EffectScope[] = [];
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop());
  clearVoiceOutpatientEmrRecordDraftCache();
});

function setup(
  overrides: OutpatientEmrAnalysisDependencies = {},
  input: { recordContext?: OutpatientEmrRecordContext | null; context?: VoiceOutpatientEmrStartContext; patientId?: string } = {},
) {
  const options = {
    context: ref<VoiceOutpatientEmrStartContext | null>(input.context || context()),
    patient: ref<AppPatient | null>(buildPatientContext({
      payload: { idPi: input.patientId || 'SYN-PATIENT', idVis: 'SYN-VISIT', naPi: '合成患者', sdSexText: '男性', ageText: '40岁' },
    })),
    recordContext: ref<OutpatientEmrRecordContext | null>(input.recordContext === undefined
      ? { recordText: '咳嗽三天。' } : input.recordContext),
    enabled: ref(true),
  };
  const analyzeFields = vi.fn().mockResolvedValue({ chiefComplaint: '咳嗽三天。', familyHistory: '' });
  const completeConsultation = vi.fn().mockResolvedValue(undefined);
  const scope = effectScope();
  scopes.push(scope);
  const controller = scope.run(() => useVoiceOutpatientEmrRecord(options, {
    analyzeFields,
    resolveTemplateSnapshot: vi.fn().mockResolvedValue({ cacheHit: false }),
    persistTemplateSnapshot: vi.fn().mockResolvedValue({ id: 'SYN-SNAPSHOT' }),
    hashTemplate: vi.fn().mockResolvedValue('SYN-HASH'),
    completeConsultation,
    ...overrides,
  }))!;
  return { options, controller, analyzeFields, completeConsultation, scope };
}

function basePayload(): OutpatientEmrPreparedWritebackPayload {
  return {
    consultationId: 'SYN-VISIT', requestId: 'SYN-REQUEST', timestamp: 1,
    resultType: 'record-confirmed', referenceType: 'batch', action: 'batch',
    referenceStatus: 'pending', referenceMessage: '等待合成回执',
    outpatientRecord: { schemaVersion: 'outpatient-record.v1', chiefComplaint: '咳嗽三天。' },
    emrFieldValues: { unrelated: '保留其他已选绑定' },
    diagList: [{ naDiag: '合成诊断' }], orderList: [],
    writebackScope: { recordFields: ['chiefComplaint'], includeDiagnosis: true, orderTypes: [] },
  };
}

describe('useVoiceOutpatientEmrRecord', () => {
  it('generates the voice template in place, preserves edits and only builds one merged payload', async () => {
    const { controller, analyzeFields, completeConsultation } = setup();
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    expect(analyzeFields).toHaveBeenCalledTimes(1);
    expect(analyzeFields.mock.calls[0][0].request.recordContext).toEqual({ recordText: '咳嗽三天。' });
    controller.updateFieldValue('chiefComplaint', '医生修订：咳嗽四天。');
    const payload = controller.buildConfirmedPayload(basePayload());
    expect(payload?.fieldValues).toEqual({ chiefComplaint: '医生修订：咳嗽四天。' });
    expect(payload?.outpatientRecord?.chiefComplaint).toBe('医生修订：咳嗽四天。');
    expect(payload?.diagList).toEqual([{ naDiag: '合成诊断' }]);
    expect(payload?.writebackScope).toEqual(basePayload().writebackScope);
    expect(payload?.emrFieldValues).toEqual({ unrelated: '保留其他已选绑定', chiefComplaint: '医生修订：咳嗽四天。' });
    expect(payload?.templateMetadata.fields.map(field => field.id)).toEqual(['chiefComplaint']);
    expect(payload?.dictionarySelections).toEqual({});
    expect(controller.recordFieldValues.value).toEqual({ chiefComplaint: '医生修订：咳嗽四天。' });
    expect(completeConsultation).not.toHaveBeenCalled();
  });

  it('waits for stable clinical input and refuses another visit before any model call', async () => {
    const { controller, options, analyzeFields } = setup();
    options.enabled.value = false;
    options.patient.value = buildPatientContext({ payload: { idPi: 'SYN-OTHER', idVis: 'SYN-OTHER-VISIT' } });
    options.enabled.value = true;
    await nextTick();
    expect(controller.analysisStatus.value).toBe('idle');
    expect(controller.buildConfirmedPayload(basePayload())).toBeNull();
    expect(analyzeFields).not.toHaveBeenCalled();
  });

  it('requires a selected template record section instead of sending metadata with no fields', async () => {
    const { controller, completeConsultation } = setup();
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    const base = basePayload();
    base.writebackScope.recordFields = [];
    expect(() => controller.buildConfirmedPayload(base)).toThrow('请至少选择一个当前模板的病历段');
    expect(completeConsultation).not.toHaveBeenCalled();
  });

  it('invalidates old results immediately and ignores a late model response on new clinical facts', async () => {
    const old = deferred<Record<string, string>>();
    const fresh = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const { controller, options } = setup({ analyzeFields });
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(1));
    const oldRequest = analyzeFields.mock.calls[0][0].request;
    options.recordContext.value!.recordText = '发热一天。';
    expect(controller.canSubmit.value).toBe(false);
    expect(controller.buildConfirmedPayload(basePayload())).toBeNull();
    expect(oldRequest.recordContext.recordText).toBe('咳嗽三天。');
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(2));
    fresh.resolve({ chiefComplaint: '发热一天。', familyHistory: '' });
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    old.resolve({ chiefComplaint: '旧病历', familyHistory: '' });
    await nextTick();
    expect(controller.fieldValues.value.chiefComplaint).toBe('发热一天。');
    expect(controller.analysisErrorCode.value).toBe('');
  });

  it('keeps doctor edits on retry but starts a fresh draft for a new clinical revision', async () => {
    const initial = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValueOnce(initial.promise)
      .mockResolvedValue({ chiefComplaint: '重试生成', familyHistory: '' });
    const { controller, options } = setup({ analyzeFields });
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(1));
    controller.updateFieldValue('chiefComplaint', '医生已修订');
    initial.reject(new Error('合成模型失败'));
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('error'));
    expect(controller.canSubmit.value).toBe(false);
    await expect(controller.retry()).resolves.toBe(true);
    expect(controller.fieldValues.value.chiefComplaint).toBe('医生已修订');
    options.enabled.value = false;
    options.recordContext.value = { recordText: '新一次补充说明' };
    options.enabled.value = true;
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    expect(controller.fieldValues.value.chiefComplaint).toBe('重试生成');
  });

  it('refreshes selected diagnosis facts while preserving doctor edits including edits during generation', async () => {
    const refresh = deferred<Record<string, string>>();
    const analyzeFields = vi.fn()
      .mockResolvedValueOnce({ chiefComplaint: '模型首版', familyHistory: '模型补齐家族史' })
      .mockReturnValueOnce(refresh.promise);
    const { controller, options } = setup({ analyzeFields });
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    expect(controller.recordFieldValues.value.familyHistory).toBe('模型补齐家族史');
    controller.updateFieldValue('chiefComplaint', '医生首轮修改');
    options.recordContext.value = { recordText: '咳嗽三天。', diagnoses: [{ name: '合成新诊断' }] };
    expect(controller.canSubmit.value).toBe(false);
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(2));
    expect(controller.fieldValues.value.chiefComplaint).toBe('医生首轮修改');
    controller.updateFieldValue('chiefComplaint', '等待期间医生再次修改');
    refresh.resolve({ chiefComplaint: '模型不得覆盖', familyHistory: '新家族史' });
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    expect(controller.fieldValues.value.chiefComplaint).toBe('等待期间医生再次修改');
    expect(controller.fieldValueSources.value.chiefComplaint).toBe('doctor');
    expect(controller.recordFieldValues.value.familyHistory).toBe('新家族史');
  });

  it('does not restart for an equivalent snapshot and discards late results after disposal', async () => {
    const pending = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValue(pending.promise);
    const { controller, options, scope } = setup({ analyzeFields });
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(1));
    options.recordContext.value = { recordText: '咳嗽三天。' };
    await nextTick();
    expect(analyzeFields).toHaveBeenCalledTimes(1);
    scope.stop();
    pending.resolve({ chiefComplaint: '迟到结果', familyHistory: '' });
    await nextTick();
    expect(controller.template.value).toBeNull();
    expect(controller.fieldValues.value).toEqual({});
    expect(controller.canSubmit.value).toBe(false);
  });

  it('restores only doctor edits after collapse when the entire request snapshot matches', async () => {
    const original = setup({
      analyzeFields: vi.fn().mockResolvedValue({ chiefComplaint: '首轮模型内容', familyHistory: '旧模型家族史' }),
    });
    await vi.waitFor(() => expect(original.controller.canSubmit.value).toBe(true));
    original.controller.updateFieldValue('chiefComplaint', '收起前医生修改');
    original.scope.stop();
    const restored = setup({
      analyzeFields: vi.fn().mockResolvedValue({ chiefComplaint: '重新生成主诉', familyHistory: '新模型家族史' }),
    });
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(restored.controller.fieldValues.value).toEqual({ chiefComplaint: '收起前医生修改', familyHistory: '新模型家族史' });
    expect(restored.controller.fieldValueSources.value).toEqual({ chiefComplaint: 'doctor', familyHistory: 'ai' });
  });

  it('retains the exact cached draft while a remounted page is still restoring clinical input', async () => {
    const original = setup();
    await vi.waitFor(() => expect(original.controller.canSubmit.value).toBe(true));
    original.controller.updateFieldValue('chiefComplaint', '重挂载前医生修改');
    original.scope.stop();
    const restored = setup({}, { recordContext: null });
    expect(restored.controller.analysisStatus.value).toBe('idle');
    await nextTick();
    restored.options.recordContext.value = { recordText: '咳嗽三天。' };
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(restored.controller.fieldValues.value.chiefComplaint).toBe('重挂载前医生修改');
    expect(restored.controller.fieldValueSources.value.chiefComplaint).toBe('doctor');
  });

  it.each(['recordContext', 'requestId', 'template', 'patient'] as const)(
    'never restores a collapsed draft after a changed %s', async (changed) => {
      const original = setup();
      await vi.waitFor(() => expect(original.controller.canSubmit.value).toBe(true));
      original.controller.updateFieldValue('chiefComplaint', '旧任务医生修改');
      original.scope.stop();
      const nextContext = context();
      if (changed === 'requestId') nextContext.template.requestId = 'SYN-NEW-REQUEST';
      if (changed === 'template') nextContext.template.templateName = '另一个模板';
      const replacement = setup({}, {
        context: nextContext,
        patientId: changed === 'patient' ? 'SYN-OTHER-PATIENT' : undefined,
        recordContext: changed === 'recordContext' ? { recordText: '新事实' } : undefined,
      });
      await vi.waitFor(() => expect(replacement.controller.canSubmit.value).toBe(true));
      expect(replacement.controller.fieldValues.value.chiefComplaint).toBe('咳嗽三天。');
      expect(replacement.controller.fieldValueSources.value.chiefComplaint).toBe('ai');
    },
  );

  it('clears a restored draft on disable instead of reviving it in another round', async () => {
    const original = setup();
    await vi.waitFor(() => expect(original.controller.canSubmit.value).toBe(true));
    original.controller.updateFieldValue('chiefComplaint', '上一轮医生修改');
    original.scope.stop();
    const restored = setup();
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(restored.controller.fieldValues.value.chiefComplaint).toBe('上一轮医生修改');
    restored.options.enabled.value = false;
    restored.options.enabled.value = true;
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(restored.controller.fieldValues.value.chiefComplaint).toBe('咳嗽三天。');
  });

  it('does not recreate a cache after the owning workflow explicitly clears the session', async () => {
    const original = setup();
    await vi.waitFor(() => expect(original.controller.canSubmit.value).toBe(true));
    original.controller.updateFieldValue('chiefComplaint', '放弃前医生修改');
    clearVoiceOutpatientEmrRecordDraftCache();
    original.scope.stop();
    const restored = setup();
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(restored.controller.fieldValues.value.chiefComplaint).toBe('咳嗽三天。');
  });

  it('blocks a malformed template without starting the model or falling back to fixed fields', async () => {
    const { controller, options, analyzeFields } = setup();
    options.context.value!.template.templateDefinition = 'malformed';
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('error'));
    expect(controller.template.value).toBeNull();
    expect(controller.canSubmit.value).toBe(false);
    expect(controller.buildConfirmedPayload(basePayload())).toBeNull();
    expect(analyzeFields).not.toHaveBeenCalled();
  });
});
