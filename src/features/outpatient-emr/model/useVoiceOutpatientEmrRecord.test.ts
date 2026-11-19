// @vitest-environment jsdom
import { effectScope, nextTick, ref, type EffectScope } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppPatient } from '@/types/appState';
import { buildPatientContext } from '@/utils/patientContext';
import { analyzeOutpatientEmrFields, type OutpatientEmrChatFast } from '../api/outpatientEmrService';
import type {
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordContext,
  VoiceOutpatientEmrInitialDraft,
  VoiceOutpatientEmrStartContext,
} from '../types';
import { clearVoiceOutpatientEmrRecordDraftCache, useVoiceOutpatientEmrRecord } from './useVoiceOutpatientEmrRecord';
import { parseOutpatientEmrTemplate } from '../lib/outpatientEmrTemplate';
import { loadVoiceOutpatientEmrTemplateSource } from './useVoiceOutpatientEmrTemplateSource';
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

function compoundHistoryContext(): VoiceOutpatientEmrStartContext {
  const session = context();
  session.template.targetFieldIds = ['flag', 'operation'];
  session.template.templateHtml = '<section data-id="first" data-article="既往史" data-name="既往史">'
    + '<span data-id="flag" data-name="肝炎史标志" data-type="select" data-readonly="false"></span>肝炎史。</section>'
    + '<section data-id="second" data-article="既往史" data-name="既往史">'
    + '曾行<span data-id="operation" data-name="手术详情" data-type="text" data-readonly="false"></span>。</section>';
  session.template.templateDefinition = JSON.stringify([
    { ID: 'first', NAME: '既往史', ARTICLE: '既往史', eles: [
      { ID: 'flag', NAME: '肝炎史标志', TYPE: 'select', READONLY: false, VALUE: '', TEXT: '',
        BINDINGDATA: [{ VALUE: '0', TEXT: '否认' }, { VALUE: '1', TEXT: '有' }] },
    ] },
    { ID: 'second', NAME: '既往史', ARTICLE: '既往史', eles: [
      { ID: 'operation', NAME: '手术详情', TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' },
    ] },
  ]);
  return session;
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
  input: {
    recordContext?: OutpatientEmrRecordContext | null;
    context?: VoiceOutpatientEmrStartContext;
    patientId?: string;
    initialDraft?: VoiceOutpatientEmrInitialDraft;
    awaitInitialDraft?: boolean;
  } = {},
) {
  const options = {
    context: ref<VoiceOutpatientEmrStartContext | null>(input.context || context()),
    patient: ref<AppPatient | null>(buildPatientContext({
      payload: { idPi: input.patientId || 'SYN-PATIENT', idVis: 'SYN-VISIT', naPi: '合成患者', sdSexText: '男性', ageText: '40岁' },
    })),
    recordContext: ref<OutpatientEmrRecordContext | null>(input.recordContext === undefined
      ? { recordText: '咳嗽三天。' } : input.recordContext),
    enabled: ref(true),
    awaitingFeedback: ref(false),
    initialDraft: ref(input.initialDraft),
    awaitInitialDraft: ref(input.awaitInitialDraft ?? false),
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

function firstVoiceDraft(fieldValues: VoiceOutpatientEmrInitialDraft['fieldValues']): VoiceOutpatientEmrInitialDraft {
  const { template, visitId } = context();
  return { visitId, requestId: template.requestId, templateId: template.templateId, templateHash: 'SYN-HASH',
    targetFieldIds: [...template.targetFieldIds], fieldValues };
}

describe('useVoiceOutpatientEmrRecord', () => {
  it('previews and persists sparse supplements using the original fields and preserves individual doctor edits', async () => {
    const session = compoundHistoryContext();
    const initialDraft = { ...firstVoiceDraft({ flag: '0', operation: '原记录' }), targetFieldIds: session.template.targetFieldIds };
    const input = { context: session, initialDraft };
    const first = setup({}, input);
    await vi.waitFor(() => expect(first.controller.canSubmit.value).toBe(true));
    first.controller.updateChapterField('operation', '医生核对的手术');
    const patch = { flag: '1', operation: '不覆盖医生选定值', other: '模板外' };
    expect(first.controller.previewSupplementRecord(patch).pastMedicalHistory).toBe('有肝炎史。\n曾行医生核对的手术。');
    expect(first.controller.fieldValues.value.flag).toBe('否认');
    first.controller.applySupplementFields(patch);
    first.controller.applySupplementFields({ flag: '无此字典项', operation: null });
    expect(first.controller.fieldValues.value).toEqual({ flag: '有', operation: '医生核对的手术' });
    const snapshot = JSON.parse(JSON.stringify(first.controller.reviewSnapshot.value));
    first.scope.stop();
    clearVoiceOutpatientEmrRecordDraftCache();
    const reopened = setup({}, input);
    reopened.controller.restoreReviewSnapshot(snapshot);
    await vi.waitFor(() => expect(reopened.controller.fieldValues.value).toEqual({ flag: '有', operation: '医生核对的手术' }));
    expect(reopened.controller.chapterRows.value.map(row => row.text)).toEqual(['有肝炎史。', '曾行医生核对的手术。']);
    expect(reopened.analyzeFields).not.toHaveBeenCalled();
  });
  it('restores reviewed source chapters and leaves after a fresh launch for the exact template revision', async () => {
    const session = compoundHistoryContext();
    const initialDraft = { ...firstVoiceDraft({ flag: '0', operation: '原记录' }), targetFieldIds: session.template.targetFieldIds };
    const input = { context: session, initialDraft };
    const first = setup({}, input);
    await vi.waitFor(() => expect(first.controller.canSubmit.value).toBe(true));
    first.analyzeFields.mockResolvedValue({ flag: '1' });
    first.controller.updateChapterText('first', '医生核实有肝炎史。');
    first.controller.updateChapterField('operation', '本次核对的手术');
    await vi.waitFor(() => expect(first.controller.fieldValues.value.flag).toBe('有'));
    const snapshot = JSON.parse(JSON.stringify(first.controller.reviewSnapshot.value));
    first.scope.stop();
    clearVoiceOutpatientEmrRecordDraftCache();

    const reopened = setup({}, input);
    reopened.controller.restoreReviewSnapshot(snapshot);
    await vi.waitFor(() => expect(reopened.controller.chapterRows.value.find(row => row.key === 'first')?.text)
      .toBe('医生核实有肝炎史。'));
    expect(reopened.controller.fieldValues.value).toEqual({ flag: '有', operation: '本次核对的手术' });
    expect(reopened.analyzeFields).not.toHaveBeenCalled();

    reopened.scope.stop();
    clearVoiceOutpatientEmrRecordDraftCache();
    const fresh = setup({}, input);
    fresh.controller.restoreReviewSnapshot({ ...snapshot, templateHash: 'other-hash' });
    await vi.waitFor(() => expect(fresh.controller.analysisStatus.value).toBe('ready'));
    expect(fresh.controller.fieldValues.value).toEqual({ flag: '否认', operation: '原记录' });
  });

  it('waits for the first voice stream, reuses its values and keeps edits made before or after binding', async () => {
    const { controller, options, analyzeFields } = setup({}, { awaitInitialDraft: true });
    await vi.waitFor(() => expect(controller.canRetry.value).toBe(true));
    expect(controller.canSubmit.value).toBe(false);
    controller.updateReviewedRecordField('familyHistory', '');
    options.initialDraft.value = firstVoiceDraft({ chiefComplaint: '首轮字段', familyHistory: '迟到的草稿', outside: '范围外' });
    options.awaitInitialDraft.value = false;
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    expect(controller.fieldValues.value).toEqual({ chiefComplaint: '首轮字段', familyHistory: '' });
    expect(controller.fieldValueSources.value).toEqual({ chiefComplaint: 'ai', familyHistory: 'doctor' });
    options.recordContext.value = { recordText: '补齐同次流的诊疗资料' };
    expect(controller.canSubmit.value).toBe(true);
    expect(controller.buildConfirmedPayload(basePayload(), { chiefComplaint: '医生当前看到的主诉' })?.fieldValues)
      .toEqual({ chiefComplaint: '医生当前看到的主诉' });
    controller.updateReviewedRecordField('chiefComplaint', '');
    const cleared = controller.buildConfirmedPayload(basePayload(), { chiefComplaint: '' });
    expect(cleared?.fieldValues).toEqual({ chiefComplaint: '' });
    expect(cleared?.outpatientRecord?.chiefComplaint).toBe('');
    expect(cleared?.chiefComplaint).toBe('');
    expect(analyzeFields).not.toHaveBeenCalled();
    await expect(controller.retry()).resolves.toBe(true);
    expect(analyzeFields).toHaveBeenCalledTimes(1);
    expect(analyzeFields.mock.calls[0][0].request.recordContext.recordText).toBe('补齐同次流的诊疗资料');
    expect(controller.fieldValues.value.chiefComplaint).toBe('');
  });

  it('reuses the approved first-stream template and decoded pair without a second parse or snapshot request', async () => {
    const session = context();
    const source = await loadVoiceOutpatientEmrTemplateSource(session, async input => input);
    const template = parseOutpatientEmrTemplate(source.templateHtml, source.templateDefinition, session.template.targetFieldIds);
    const getPreparedVoiceTemplate = vi.fn(() => ({ template, source, templateHash: 'SYN-HASH' }));
    const unexpected = vi.fn(() => { throw new Error('不应重复准备模板'); });
    const { controller, analyzeFields } = setup({
      getPreparedVoiceTemplate, normalizeTemplateSource: unexpected, hashTemplate: unexpected,
      resolveTemplateSnapshot: unexpected, restoreTemplateFromSnapshot: unexpected,
      parseTemplate: unexpected, persistTemplateSnapshot: unexpected,
    }, { context: session, initialDraft: firstVoiceDraft({ chiefComplaint: '首轮结果' }) });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    expect(controller.fieldValues.value.chiefComplaint).toBe('首轮结果');
    expect(getPreparedVoiceTemplate).toHaveBeenCalledOnce();
    expect(unexpected).not.toHaveBeenCalled();
    expect(analyzeFields).not.toHaveBeenCalled();
  });

  it('treats an empty first-stream field map as a completed generation', async () => {
    const { controller, analyzeFields } = setup({}, { initialDraft: firstVoiceDraft({}), recordContext: null });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    expect(controller.fieldValues.value).toEqual({ chiefComplaint: '', familyHistory: '' });
    const payload = controller.buildConfirmedPayload(basePayload(), { chiefComplaint: '同轮主病历' });
    expect(payload?.fieldValues).toEqual({ chiefComplaint: '同轮主病历' });
    expect(payload?.outpatientRecord?.chiefComplaint).toBe('同轮主病历');
    expect(analyzeFields).not.toHaveBeenCalled();
  });

  it.each(['visitId', 'requestId', 'templateId', 'templateHash', 'targetFieldIds'] as const)(
    'rejects an initial voice draft for a different %s without an extra model call', async key => {
      const initialDraft = firstVoiceDraft({ chiefComplaint: '过期结果' });
      if (key === 'targetFieldIds') initialDraft.targetFieldIds = ['chiefComplaint', 'other'];
      else initialDraft[key] = 'SYN-OTHER';
      const { controller, analyzeFields } = setup({}, { initialDraft });
      await vi.waitFor(() => expect(controller.analysisErrorCode.value).toBe('REQUEST_ID_CONFLICT'));
      expect(controller.buildConfirmedPayload(basePayload())).toBeNull();
      expect(analyzeFields).not.toHaveBeenCalled();
    },
  );

  it('allows an explicit retry when the initial voice stream could not prepare its template', async () => {
    const { controller, analyzeFields } = setup({}, { awaitInitialDraft: true });
    await vi.waitFor(() => expect(controller.canRetry.value).toBe(true));
    expect(analyzeFields).not.toHaveBeenCalled();
    await expect(controller.retry()).resolves.toBe(true);
    expect(analyzeFields).toHaveBeenCalledOnce();
    expect(controller.canSubmit.value).toBe(true);
  });

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

  it('clears a reviewed compound section immediately and can map it again after the doctor re-enters facts', async () => {
    const session = compoundHistoryContext();
    const initialDraft = { ...firstVoiceDraft({ flag: '0', operation: '阑尾切除术' }), targetFieldIds: session.template.targetFieldIds };
    const analyzeFields = vi.fn().mockResolvedValue({ flag: '1', operation: null });
    const { controller } = setup({ analyzeFields }, { context: session, initialDraft });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    const base = basePayload();
    base.writebackScope.recordFields = ['pastMedicalHistory'];
    controller.updateReviewedRecordField('pastMedicalHistory', '');
    const cleared = controller.buildConfirmedPayload(base, { pastMedicalHistory: '' });
    expect(cleared?.fieldValues).toEqual({ operation: '' });
    expect(cleared?.dictionarySelections).toEqual({});
    expect(cleared?.pastMedicalHistory).toBe('');
    expect(analyzeFields).not.toHaveBeenCalled();
    controller.updateReviewedRecordField('pastMedicalHistory', '有肝炎史。');
    expect(analyzeFields).toHaveBeenCalledOnce();
    const submitted = analyzeFields.mock.calls[0][0];
    expect(submitted.fields.map((field: { id: string }) => field.id)).toEqual(['flag', 'operation']);
    expect(submitted.request.recordContext).toEqual({ reviewedSection: 'pastMedicalHistory', recordText: '有肝炎史。' });
    expect(submitted.reviewedSectionOnly).toBe(true);
    await vi.waitFor(() => expect(controller.fieldValues.value.flag).toBe('有'));
    const rewritten = controller.buildConfirmedPayload(base, { pastMedicalHistory: '有肝炎史。' });
    expect(rewritten?.fieldValues).toEqual({ flag: '有' });
    expect(rewritten?.dictionarySelections.flag).toEqual({ text: '有', value: '1' });
  });

  it('retains an explicitly cleared paragraph for selection even when all its HIS fields are dictionaries', async () => {
    const session = compoundHistoryContext();
    session.template.targetFieldIds = ['flag'];
    const initialDraft = { ...firstVoiceDraft({ flag: '0' }), targetFieldIds: ['flag'] };
    const { controller } = setup({}, { context: session, initialDraft });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    controller.updateReviewedRecordField('pastMedicalHistory', '');
    expect(controller.recordFieldValues.value).toEqual({ pastMedicalHistory: '' });
    const base = basePayload();
    base.writebackScope.recordFields = ['pastMedicalHistory'];
    base.outpatientRecord = { schemaVersion: 'outpatient-record.v1', pastMedicalHistory: '旧模板既往史' };
    const confirmed = controller.buildConfirmedPayload(base, { pastMedicalHistory: '' });
    expect(confirmed?.pastMedicalHistory).toBe('');
    expect(confirmed?.outpatientRecord?.pastMedicalHistory).toBe('');
    expect(confirmed?.fieldValues).toEqual({});
    expect(confirmed?.dictionarySelections).toEqual({});
  });

  it('drops obsolete leaf responses, keeps independent doctor edits and retries only the revised section', async () => {
    const session = compoundHistoryContext();
    const initialDraft = { ...firstVoiceDraft({ flag: '0', operation: '阑尾切除术' }), targetFieldIds: session.template.targetFieldIds };
    const stale = deferred<Record<string, string>>();
    const retry = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValueOnce(stale.promise)
      .mockRejectedValueOnce(new Error('合成服务失败')).mockReturnValueOnce(retry.promise);
    const { controller, scope } = setup({ analyzeFields }, { context: session, initialDraft });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    controller.updateFieldValue('operation', '医生已核对手术名称');
    controller.updateReviewedRecordField('pastMedicalHistory', '患者有肝炎史。');
    controller.updateReviewedRecordField('pastMedicalHistory', '肝炎史待核实。');
    expect(analyzeFields.mock.calls.map(([input]) => input.request.targetFieldIds)).toEqual([['flag'], ['flag']]);
    expect(analyzeFields.mock.calls[0][0].signal.aborted).toBe(true);
    stale.resolve({ flag: '1' });
    await vi.waitFor(() => expect(controller.analysisErrorMessage.value).toContain('合成服务失败'));
    const base = basePayload();
    base.writebackScope.recordFields = ['pastMedicalHistory'];
    const reviewed = { pastMedicalHistory: '肝炎史待核实。' };
    expect(controller.buildConfirmedPayload(base, reviewed)?.fieldValues).toEqual({ operation: '医生已核对手术名称' });
    expect(controller.buildConfirmedPayload(base, reviewed)?.pastMedicalHistory).toBe(reviewed.pastMedicalHistory);
    scope.stop();
    const remounted = setup({ analyzeFields }, { context: session, initialDraft }).controller;
    await vi.waitFor(() => expect(remounted.analysisErrorMessage.value).toContain('合成服务失败'));
    expect(remounted.fieldValues.value).toEqual({ flag: '', operation: '医生已核对手术名称' });
    const retryTask = remounted.retry();
    expect(analyzeFields.mock.calls[2][0].request.targetFieldIds).toEqual(['flag']);
    remounted.updateFieldValue('flag', '否认');
    retry.resolve({ flag: '1', operation: '错误覆盖' });
    await expect(retryTask).resolves.toBe(true);
    expect(remounted.fieldValues.value).toEqual({ flag: '否认', operation: '医生已核对手术名称' });
    expect(remounted.analysisErrorMessage.value).toBe('');
  });

  it.each(['submit', 'new visit'] as const)('discards a late section remapping after %s', async action => {
    const session = compoundHistoryContext();
    const initialDraft = { ...firstVoiceDraft({ flag: '0', operation: '旧手术' }), targetFieldIds: session.template.targetFieldIds };
    const pending = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValue(pending.promise);
    const { controller, options } = setup({ analyzeFields }, { context: session, initialDraft });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    controller.updateReviewedRecordField('pastMedicalHistory', '手术史待核实。');
    expect(controller.fieldValues.value).toEqual({ flag: '', operation: '' });
    if (action === 'submit') controller.stopGenerationForWriteback();
    else options.patient.value = buildPatientContext({ payload: { idPi: 'SYN-OTHER', idVis: 'SYN-OTHER-VISIT' } });
    expect(analyzeFields.mock.calls[0][0].signal.aborted).toBe(true);
    pending.resolve({ flag: '1', operation: '已过时手术' });
    await pending.promise;
    await nextTick();
    const base = basePayload();
    base.writebackScope.recordFields = ['pastMedicalHistory'];
    const confirmed = controller.buildConfirmedPayload(base, { pastMedicalHistory: '手术史待核实。' });
    if (action === 'submit') {
      expect(confirmed?.fieldValues).toEqual({});
      expect(confirmed?.pastMedicalHistory).toBe('手术史待核实。');
    } else expect(confirmed).toBeNull();
  });

  it('uses the edited clinical sentences for selection and writeback while each HIS field keeps its own value', async () => {
    const session = compoundHistoryContext();
    const analyzeFields = vi.fn().mockResolvedValue({ flag: '0', operation: '阑尾切除术' });
    const { controller } = setup({ analyzeFields }, { context: session });
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    expect(controller.recordFieldValues.value).toEqual({ pastMedicalHistory: '否认肝炎史。\n曾行阑尾切除术。' });
    expect(analyzeFields.mock.calls[0][0].templateNarrative[0].clauses[0]).toEqual(expect.arrayContaining([
      { kind: 'field', id: 'flag', name: '肝炎史标志' }, { kind: 'text', text: '肝炎史' },
    ]));
    expect(analyzeFields.mock.calls[0][0].request.recordContext).not.toHaveProperty('templateNarrative');

    const base = basePayload();
    base.writebackScope.recordFields = ['pastMedicalHistory'];
    base.outpatientRecord = { schemaVersion: 'outpatient-record.v1', pastMedicalHistory: '旧病历' };
    controller.updateFieldValue('flag', '有');
    controller.updateFieldValue('operation', '');
    const payload = controller.buildConfirmedPayload(base);
    expect(controller.recordFieldValues.value).toEqual({ pastMedicalHistory: '有肝炎史。' });
    expect(payload?.pastMedicalHistory).toBe('有肝炎史。');
    expect(payload?.outpatientRecord).toEqual({ schemaVersion: 'outpatient-record.v1', pastMedicalHistory: '肝炎史：有' });
    expect(payload?.fieldValues).toEqual({ flag: '有', operation: '' });
    expect(payload?.dictionarySelections).toEqual({ flag: { value: '1', text: '有' } });
    expect(payload?.emrFieldValues).toMatchObject({ flag: '1', operation: '' });

    controller.updateFieldValue('flag', '');
    expect(controller.recordFieldValues.value).toEqual({ pastMedicalHistory: '' });
    const cleared = controller.buildConfirmedPayload(base);
    expect(cleared?.outpatientRecord?.pastMedicalHistory).toBe('');
    expect(cleared?.fieldValues).toEqual({ operation: '' });
    expect(cleared?.dictionarySelections).toEqual({});
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

  it('reuses the pending decode after remount and waits for clinical input before generation', async () => {
    const session = context();
    const original = { templateHtml: session.template.templateHtml, templateDefinition: session.template.templateDefinition };
    session.template.templateHtml = 'data:text/html;charset=utf-8;base64,PHNlY3Rpb24+';
    session.template.templateDefinition = 'data:application/json;charset=utf-8;base64,W10=';
    const decoding = deferred<typeof original>();
    const normalizeTemplateSource = vi.fn().mockReturnValue(decoding.promise);
    const resolveTemplateSnapshot = vi.fn().mockResolvedValue({ cacheHit: false });
    const persistTemplateSnapshot = vi.fn().mockResolvedValue({ id: 'SYN-SNAPSHOT' });
    const deps = { normalizeTemplateSource, resolveTemplateSnapshot, persistTemplateSnapshot };
    const first = setup(deps, { context: session, recordContext: null });
    expect(normalizeTemplateSource).toHaveBeenCalledTimes(1);
    first.scope.stop();
    const restored = setup(deps, { context: session, recordContext: null });
    decoding.resolve(original);
    await decoding.promise;
    await nextTick();
    expect(resolveTemplateSnapshot).not.toHaveBeenCalled();
    expect(restored.analyzeFields).not.toHaveBeenCalled();
    expect(restored.controller.canSubmit.value).toBe(false);
    restored.options.recordContext.value = { recordText: '合成就诊事实' };
    await vi.waitFor(() => expect(restored.controller.canSubmit.value).toBe(true));
    expect(normalizeTemplateSource).toHaveBeenCalledTimes(1);
    expect(first.analyzeFields).not.toHaveBeenCalled();
    expect(restored.analyzeFields.mock.calls[0][0].request).toMatchObject(original);
    expect(persistTemplateSnapshot.mock.calls[0][0].request.templateHtml).toBe(session.template.templateHtml);
  });

  it('ignores a delayed template source after switching visits', async () => {
    const original = context().template;
    const decoding = deferred<typeof original>();
    const newSession = context();
    newSession.visitId = 'SYN-OTHER-VISIT';
    newSession.template.requestId = 'SYN-OTHER-REQUEST';
    const normalizeTemplateSource = vi.fn().mockReturnValueOnce(decoding.promise)
      .mockResolvedValue({ templateHtml: newSession.template.templateHtml, templateDefinition: newSession.template.templateDefinition });
    const current = setup({ normalizeTemplateSource });
    current.options.patient.value = buildPatientContext({ payload: { idPi: 'SYN-OTHER', idVis: 'SYN-OTHER-VISIT' } });
    current.options.context.value = newSession;
    await vi.waitFor(() => expect(current.controller.analysisStatus.value).toBe('ready'));
    decoding.resolve(original);
    await decoding.promise;
    await nextTick();
    expect(current.analyzeFields).toHaveBeenCalledTimes(1);
    expect(current.analyzeFields.mock.calls[0][0].request).toMatchObject({
      visitId: 'SYN-OTHER-VISIT', requestId: 'SYN-OTHER-REQUEST',
    });
    expect(current.controller.request.value?.requestId).toBe('SYN-OTHER-REQUEST');
  });

  it('retries a failed decode without generating a record until clinical facts are available', async () => {
    const normalizeTemplateSource = vi.fn().mockRejectedValueOnce(new Error('合成解码失败'))
      .mockResolvedValue(context().template);
    const current = setup({ normalizeTemplateSource }, { recordContext: null });
    await vi.waitFor(() => expect(current.controller.analysisErrorMessage.value).toBe('合成解码失败'));
    expect(current.controller.canRetry.value).toBe(true);
    await current.controller.retry();
    expect(normalizeTemplateSource).toHaveBeenCalledTimes(2);
    expect(current.controller.analysisErrorMessage.value).toBe('');
    expect(current.controller.analysisStatus.value).toBe('idle');
    expect(current.analyzeFields).not.toHaveBeenCalled();
    current.options.recordContext.value = { recordText: '合成重试后事实' };
    await vi.waitFor(() => expect(current.controller.canSubmit.value).toBe(true));
    expect(current.analyzeFields.mock.calls[0][0].request.recordContext.recordText).toBe('合成重试后事实');
    expect(normalizeTemplateSource).toHaveBeenCalledTimes(2);
  });

  it('sends a selected diagnosis without requiring a template section', async () => {
    const { controller, completeConsultation } = setup();
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    const base = basePayload();
    base.writebackScope.recordFields = [];
    delete base.outpatientRecord;
    expect(controller.buildConfirmedPayload(base)).toMatchObject({
      fieldValues: {}, dictionarySelections: {}, templateMetadata: { fields: [] },
      diagList: [{ naDiag: '合成诊断' }], writebackScope: { recordFields: [] },
    });
    expect(completeConsultation).not.toHaveBeenCalled();
  });

  it('retains the submitted draft after a background clinical update while HIS saves, and can regenerate against the update', async () => {
    const { controller, options, analyzeFields } = setup();
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
    controller.updateFieldValue('chiefComplaint', '');
    options.awaitingFeedback.value = true;
    options.recordContext.value = { recordText: '后台诊疗更新' };
    expect(controller.recordFieldValues.value).toHaveProperty('chiefComplaint', '');
    expect(analyzeFields).toHaveBeenCalledTimes(1);
    options.awaitingFeedback.value = false;
    expect(controller.canSubmit.value).toBe(true);
    expect(controller.buildConfirmedPayload(basePayload())?.fieldValues).toEqual({ chiefComplaint: '' });
    expect(await controller.retry()).toBe(true);
    expect(analyzeFields.mock.calls[1][0].request.recordContext.recordText).toBe('后台诊疗更新');
    expect(controller.fieldValues.value.chiefComplaint).toBe('');
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
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
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
    expect(controller.canSubmit.value).toBe(true);
    await expect(controller.retry()).resolves.toBe(true);
    expect(analyzeFields.mock.calls[1][0].request.recordContext.doctorTemplateEdits)
      .toContainEqual(expect.objectContaining({ id: 'chiefComplaint', value: '医生已修订' }));
    expect(controller.fieldValues.value.chiefComplaint).toBe('医生已修订');
    options.enabled.value = false;
    options.recordContext.value = { recordText: '新一次补充说明' };
    options.enabled.value = true;
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    expect(controller.fieldValues.value.chiefComplaint).toBe('重试生成');
  });

  it('sends current and deliberately cleared doctor edits with the next model request only for this patient', async () => {
    const model = vi.fn<OutpatientEmrChatFast>().mockResolvedValue(JSON.stringify({
      chiefComplaint: '模型病历', familyHistory: '模型家族史',
    }));
    const { controller, options } = setup({
      analyzeFields: input => analyzeOutpatientEmrFields(input, { chatFast: model }),
    });
    await vi.waitFor(() => expect(controller.canSubmit.value).toBe(true));
    controller.updateFieldValue('chiefComplaint', '医生核对为咳嗽四天');
    controller.updateFieldValue('familyHistory', '');
    options.recordContext.value = { recordText: '咳嗽三天。', diagnoses: [{ name: '合成新诊断' }] };
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(2));
    const userMessage = model.mock.calls[1][0].find(message => message.role === 'user')!;
    expect(JSON.parse(String(userMessage.content).split('\n')[1]).recordContext).toMatchObject({
      recordText: '咳嗽三天。',
      diagnoses: [{ name: '合成新诊断' }],
      doctorTemplateEdits: [
        { id: 'chiefComplaint', name: '主诉', source: 'doctor', value: '医生核对为咳嗽四天' },
        { id: 'familyHistory', name: '家族史', source: 'doctor', value: '' },
      ],
    });
    options.patient.value = buildPatientContext({ payload: { idPi: 'SYN-OTHER', idVis: 'SYN-VISIT' } });
    await vi.waitFor(() => expect(model).toHaveBeenCalledTimes(3));
    expect(JSON.stringify(model.mock.calls[2][0])).not.toContain('医生核对为咳嗽四天');
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
    await vi.waitFor(() => expect(controller.analysisStatus.value).toBe('ready'));
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
