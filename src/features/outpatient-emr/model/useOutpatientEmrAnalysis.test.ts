// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrCancelledPayload,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordConfirmedPayload,
} from '../types';
import { parseOutpatientEmrTemplate } from '../lib/outpatientEmrTemplate';
import { useOutpatientEmrAnalysis } from './useOutpatientEmrAnalysis';

const snapshotMocks = vi.hoisted(() => ({
  resolve: vi.fn().mockImplementation(({
    templateId,
    templateHash,
  }: { templateId: string; templateHash: string }) => Promise.resolve({
    schemaVersion: 'outpatient-emr-template-pair-resolution.v1',
    cacheHit: false,
    id: null,
    templateId,
    templateHash,
    parseResult: null,
    receivedAt: null,
  })),
  persist: vi.fn().mockResolvedValue({
    id: 'snapshot-default',
    templateHash: 'template-hash',
    deduplicated: false,
    receivedAt: 1,
  }),
}));

vi.mock('../api/outpatientEmrTemplateSnapshotService', () => ({
  resolveOutpatientEmrTemplateSnapshot: snapshotMocks.resolve,
  persistOutpatientEmrTemplateSnapshot: snapshotMocks.persist,
}));

const defaultTemplateHtml = `
  <section data-id="article-personal-history" data-article="个人史" data-name="个人史">
    <div data-id="personalHistory" data-type="text" data-name="个人史" data-readonly="false">个人史基线</div>
  </section>
  <section data-id="article-family-history" data-article="家族史" data-name="家族史">
    <div data-id="familyHistory" data-type="text" data-name="家族史" data-readonly="false">家族史基线</div>
  </section>
`;

const defaultTemplateDefinition = JSON.stringify([{
  ID: 'article-personal-history',
  NAME: '个人史',
  ARTICLE: '个人史',
  eles: [{
    ID: 'personalHistory',
    NAME: '个人史',
    TYPE: 'text',
    READONLY: false,
    VALUE: '个人史基线',
    TEXT: '个人史基线',
  }],
}, {
  ID: 'article-family-history',
  NAME: '家族史',
  ARTICLE: '家族史',
  eles: [{
    ID: 'familyHistory',
    NAME: '家族史',
    TYPE: 'text',
    READONLY: false,
    VALUE: '家族史基线',
    TEXT: '家族史基线',
  }],
}]);

function createRequest(overrides: Partial<OutpatientEmrAnalysisRequest> = {}): OutpatientEmrAnalysisRequest {
  return {
    visitId: 'VIS-001',
    templateId: 'TPL-001',
    templateName: '门诊模板',
    templateHtml: defaultTemplateHtml,
    templateDefinition: defaultTemplateDefinition,
    targetFieldIds: ['personalHistory', 'familyHistory'],
    recordContext: { recordText: '咳嗽3天。' },
    requestId: 'REQ-001',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useOutpatientEmrAnalysis analysis sessions', () => {
  it('resolves history before parsing and registers a miss before model analysis', async () => {
    const callOrder: string[] = [];
    const resolveTemplateSnapshot = vi.fn().mockImplementation(async ({
      templateId,
      templateHash,
    }: { templateId: string; templateHash: string }) => {
      callOrder.push('resolve');
      return {
        schemaVersion: 'outpatient-emr-template-pair-resolution.v1' as const,
        cacheHit: false,
        id: null,
        templateId,
        templateHash,
        parseResult: null,
        receivedAt: null,
      };
    });
    const parseTemplate = vi.fn().mockImplementation((
      templateHtml: string,
      templateDefinition: string,
      targetFieldIds: string[],
    ) => {
      callOrder.push('parse');
      return parseOutpatientEmrTemplate(templateHtml, templateDefinition, targetFieldIds);
    });
    const persistTemplateSnapshot = vi.fn().mockImplementation(async (input) => {
      callOrder.push('snapshot');
      expect(input.request).toEqual(expect.objectContaining({
        visitId: 'VIS-001',
        recordContext: { recordText: '咳嗽3天。' },
      }));
      expect(input.template.fields.map((field: { id: string }) => field.id)).toEqual([
        'personalHistory',
        'familyHistory',
      ]);
      return {
        id: 'snapshot-1',
        templateHash: 'template-hash',
        deduplicated: false,
        receivedAt: 1,
      };
    });
    const analyzeFields = vi.fn().mockImplementation(async () => {
      callOrder.push('model');
      return { personalHistory: '模型个人史', familyHistory: '模型家族史' };
    });
    const analysis = useOutpatientEmrAnalysis({
      resolveTemplateSnapshot,
      persistTemplateSnapshot,
      parseTemplate,
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest())).resolves.toBe(true);

    expect(callOrder).toEqual(['resolve', 'parse', 'snapshot', 'model']);
  });

  it('uses an exact historical parse without parsing or registering the template again', async () => {
    const cachedTemplate = parseOutpatientEmrTemplate(
      defaultTemplateHtml,
      defaultTemplateDefinition,
      ['personalHistory', 'familyHistory'],
    );
    const parseTemplate = vi.fn();
    const persistTemplateSnapshot = vi.fn();
    const analyzeFields = vi.fn().mockResolvedValue({
      personalHistory: '历史解析后的模型个人史',
      familyHistory: '历史解析后的模型家族史',
    });
    const resolveTemplateSnapshot = vi.fn().mockResolvedValue({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v1',
      cacheHit: true,
      id: 'snapshot-history',
      templateId: 'TPL-001',
      templateHash: 'template-hash',
      parseResult: {
        schemaVersion: 'outpatient-emr-template-pair.v1',
        fields: cachedTemplate.fields,
      },
      receivedAt: 1,
    });
    const analysis = useOutpatientEmrAnalysis({
      resolveTemplateSnapshot,
      persistTemplateSnapshot,
      parseTemplate,
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest())).resolves.toBe(true);

    expect(resolveTemplateSnapshot).toHaveBeenCalledWith({
      templateId: 'TPL-001',
      templateHash: 'template-hash',
    });
    expect(parseTemplate).not.toHaveBeenCalled();
    expect(persistTemplateSnapshot).not.toHaveBeenCalled();
    expect(analyzeFields).toHaveBeenCalledOnce();
    expect(analysis.template.value?.fields).toEqual(cachedTemplate.fields);
  });

  it('creates a new parse only when the same template ID has a changed content hash', async () => {
    const cachedTemplate = parseOutpatientEmrTemplate(
      defaultTemplateHtml,
      defaultTemplateDefinition,
      ['personalHistory', 'familyHistory'],
    );
    const resolveTemplateSnapshot = vi.fn().mockImplementation(async ({
      templateId,
      templateHash,
    }: { templateId: string; templateHash: string }) => (
      templateHash === 'hash-v1'
        ? {
            schemaVersion: 'outpatient-emr-template-pair-resolution.v1' as const,
            cacheHit: true,
            id: 'snapshot-v1',
            templateId,
            templateHash,
            parseResult: {
              schemaVersion: 'outpatient-emr-template-pair.v1' as const,
              fields: cachedTemplate.fields,
            },
            receivedAt: 1,
          }
        : {
            schemaVersion: 'outpatient-emr-template-pair-resolution.v1' as const,
            cacheHit: false,
            id: null,
            templateId,
            templateHash,
            parseResult: null,
            receivedAt: null,
          }
    ));
    const parseTemplate = vi.fn().mockImplementation(parseOutpatientEmrTemplate);
    const persistTemplateSnapshot = vi.fn().mockResolvedValue({
      id: 'snapshot-v2',
      templateHash: 'hash-v2',
      deduplicated: false,
      receivedAt: 2,
    });
    const analyzeFields = vi.fn().mockResolvedValue({
      personalHistory: '模型个人史',
      familyHistory: '模型家族史',
    });
    const hashTemplate = vi.fn()
      .mockResolvedValueOnce('hash-v1')
      .mockResolvedValueOnce('hash-v2');
    const analysis = useOutpatientEmrAnalysis({
      resolveTemplateSnapshot,
      persistTemplateSnapshot,
      parseTemplate,
      analyzeFields,
      hashTemplate,
    });

    await expect(analysis.start(createRequest())).resolves.toBe(true);
    await expect(analysis.start(createRequest({
      requestId: 'REQ-002',
      templateHtml: `${defaultTemplateHtml}\n`,
    }))).resolves.toBe(true);

    expect(resolveTemplateSnapshot).toHaveBeenNthCalledWith(1, {
      templateId: 'TPL-001',
      templateHash: 'hash-v1',
    });
    expect(resolveTemplateSnapshot).toHaveBeenNthCalledWith(2, {
      templateId: 'TPL-001',
      templateHash: 'hash-v2',
    });
    expect(parseTemplate).toHaveBeenCalledOnce();
    expect(persistTemplateSnapshot).toHaveBeenCalledOnce();
    expect(persistTemplateSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      templateHash: 'hash-v2',
    }));
    expect(analyzeFields).toHaveBeenCalledTimes(2);
  });

  it('does not parse or call the model when historical lookup fails', async () => {
    const parseTemplate = vi.fn();
    const persistTemplateSnapshot = vi.fn();
    const analyzeFields = vi.fn();
    const analysis = useOutpatientEmrAnalysis({
      resolveTemplateSnapshot: vi.fn().mockRejectedValue(new Error('查询超时')),
      persistTemplateSnapshot,
      parseTemplate,
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest())).resolves.toBe(false);

    expect(parseTemplate).not.toHaveBeenCalled();
    expect(persistTemplateSnapshot).not.toHaveBeenCalled();
    expect(analyzeFields).not.toHaveBeenCalled();
    expect(analysis.analysisErrorCode.value).toBe('TEMPLATE_SNAPSHOT_FAILED');
    expect(analysis.analysisErrorMessage.value).toContain('历史模板解析查询失败');
  });

  it('does not call the model when snapshot registration fails', async () => {
    const analyzeFields = vi.fn();
    const analysis = useOutpatientEmrAnalysis({
      persistTemplateSnapshot: vi.fn().mockRejectedValue(new Error('后台不可用')),
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest())).resolves.toBe(false);

    expect(analyzeFields).not.toHaveBeenCalled();
    expect(analysis.analysisErrorCode.value).toBe('TEMPLATE_SNAPSHOT_FAILED');
    expect(analysis.analysisErrorMessage.value).toContain('尚未启动模型分析');
  });

  it('drops a late response from a replaced request', async () => {
    const first = deferred<Record<string, string>>();
    const second = deferred<Record<string, string>>();
    const analyzeFields = vi.fn(({ request }: { request: OutpatientEmrAnalysisRequest }) => (
      request.visitId === 'VIS-001' ? first.promise : second.promise
    ));
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    const firstRun = analysis.start(createRequest());
    await flushPromises();
    const secondRun = analysis.start(createRequest({
      visitId: 'VIS-002',
      templateId: 'TPL-002',
      requestId: 'REQ-002',
    }));
    await flushPromises();

    second.resolve({ personalHistory: '第二次结果', familyHistory: '第二次家族史' });
    await expect(secondRun).resolves.toBe(true);
    first.resolve({ personalHistory: '迟到结果', familyHistory: '迟到家族史' });
    await expect(firstRun).resolves.toBe(false);

    expect(analysis.request.value?.visitId).toBe('VIS-002');
    expect(analysis.fieldValues.value).toEqual({
      personalHistory: '第二次结果',
      familyHistory: '第二次家族史',
    });
  });

  it('never overwrites a doctor edit made after analysis starts', async () => {
    const generated = deferred<Record<string, string>>();
    const analyzeFields = vi.fn().mockReturnValue(generated.promise);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    const run = analysis.start(createRequest());
    await vi.waitFor(() => expect(analyzeFields).toHaveBeenCalledOnce());
    analysis.updateFieldValue('personalHistory', '医生已修改');
    generated.resolve({
      personalHistory: '模型迟到覆盖值',
      familyHistory: '模型家族史',
    });
    await expect(run).resolves.toBe(true);

    expect(analysis.fieldValues.value).toEqual({
      personalHistory: '医生已修改',
      familyHistory: '模型家族史',
    });
  });

  it('keeps the sanitized template baseline and blocks submission after analysis failure', async () => {
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockRejectedValue(new Error('JSON解析失败')),
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest())).resolves.toBe(false);
    expect(analysis.analysisStatus.value).toBe('error');
    expect(analysis.fieldValues.value).toEqual({
      personalHistory: '个人史基线',
      familyHistory: '家族史基线',
    });
    expect(analysis.canSubmit.value).toBe(false);
  });

  it('clears the previous template before reporting a replacement template error', async () => {
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });
    await analysis.start(createRequest());

    await analysis.start(createRequest({
      visitId: 'VIS-002',
      requestId: 'REQ-002',
      templateId: 'TPL-002',
      templateHtml: `
        <section data-id="article-personal-history" data-article="个人史" data-name="个人史">
          <div data-id="duplicate" data-type="text" data-name="重复" data-readonly="false">一</div>
          <div data-id="duplicate" data-type="text" data-name="重复" data-readonly="false">二</div>
        </section>
      `,
    }));

    expect(analysis.analysisErrorCode.value).toBe('DUPLICATE_TEMPLATE_FIELD');
    expect(analysis.template.value).toBeNull();
    expect(analysis.fieldValues.value).toEqual({});
  });

  it('blocks every renderer-selected dictionary field regardless of local gender inference', async () => {
    const templateDefinition = JSON.stringify([{
      ID: 'article-marriage-history',
      NAME: '婚育史',
      ARTICLE: '婚育史',
      eles: [{
        ID: '婚育状况',
        NAME: '婚育状况',
        TYPE: 'select',
        READONLY: false,
        VALUE: '',
        TEXT: '',
        BINDINGDATA: [
          { VALUE: '', TEXT: '' },
          { VALUE: '1', TEXT: '未婚未育' },
          { VALUE: '2', TEXT: '已婚未育' },
          { VALUE: '3', TEXT: '已婚已育' },
        ],
      }],
    }]);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({ 婚育状况: '' }),
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest({
      templateHtml: `
        <section data-id="article-marriage-history" data-article="婚育史" data-name="婚育史">
          <span data-id="婚育状况" data-name="婚育状况" data-type="select" data-readonly="false"><span class="tag-value"></span></span>
        </section>
      `,
      templateDefinition,
      targetFieldIds: ['婚育状况'],
      patient: { sdSexText: '男性' },
    }))).resolves.toBe(true);
    expect(analysis.canSubmit.value).toBe(false);
    expect(analysis.dictionaryValidationMessage.value).toContain('婚育状况');

    analysis.updateFieldValue('婚育状况', '已婚已育');
    expect(analysis.canSubmit.value).toBe(true);
    expect(analysis.buildConfirmedPayload()).toEqual(expect.objectContaining({
      fieldValues: { 婚育状况: '已婚已育' },
      dictionarySelections: {
        婚育状况: { value: '3', text: '已婚已育' },
      },
    }));
  });

  it('requires an explicit model result even when the template has a valid default selection', async () => {
    const templateDefinition = JSON.stringify([{
      ID: 'article-past-history',
      NAME: '既往史',
      ARTICLE: '既往史',
      eles: [{
        ID: '高血压病史标志',
        NAME: '高血压病史标志',
        TYPE: 'select',
        READONLY: false,
        VALUE: '0',
        TEXT: '否认',
        BINDINGDATA: [
          { VALUE: '', TEXT: '' },
          { VALUE: '0', TEXT: '否认' },
          { VALUE: '1', TEXT: '有' },
        ],
      }],
    }]);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({ 高血压病史标志: '' }),
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest({
      templateHtml: `
        <section data-id="article-past-history" data-article="既往史" data-name="既往史">
          <span data-id="高血压病史标志" data-name="高血压病史标志" data-type="select" data-readonly="false"><span class="tag-value">否认</span></span>
        </section>
      `,
      templateDefinition,
      targetFieldIds: ['高血压病史标志'],
    }))).resolves.toBe(true);
    expect(analysis.fieldValues.value).toEqual({ 高血压病史标志: '' });
    expect(analysis.analysisStatus.value).toBe('ready');
    expect(analysis.canSubmit.value).toBe(false);
    expect(analysis.dictionaryValidationMessage.value).toContain('尚未确定');

    analysis.updateFieldValue('高血压病史标志', '否认');
    expect(analysis.canSubmit.value).toBe(true);
    expect(analysis.buildConfirmedPayload()).toEqual(expect.objectContaining({
      fieldValues: { 高血压病史标志: '否认' },
      dictionarySelections: {
        高血压病史标志: { value: '0', text: '否认' },
      },
    }));
  });

  it('returns confirmed history positives by PHIS data-id and dictionary code', async () => {
    const templateDefinition = JSON.stringify([{
      ID: 'article-past-history',
      NAME: '既往史',
      ARTICLE: '既往史',
      eles: [{
        ID: '高血压病史标志',
        NAME: '高血压病史标志',
        TYPE: 'select',
        READONLY: false,
        VALUE: '0',
        TEXT: '否认',
        BINDINGDATA: [
          { VALUE: '', TEXT: '' },
          { VALUE: '0', TEXT: '否认' },
          { VALUE: '1', TEXT: '有' },
        ],
      }],
    }, {
      ID: 'article-physical-exam',
      NAME: '体格检查',
      ARTICLE: '体格检查',
      eles: [{
        ID: '体温',
        NAME: '体温',
        TYPE: 'text',
        READONLY: false,
        VALUE: '',
        TEXT: '',
      }],
    }]);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({ 高血压病史标志: '', 体温: '' }),
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });

    await expect(analysis.start(createRequest({
      templateHtml: `
        <section data-id="article-past-history" data-article="既往史" data-name="既往史">
          <span data-id="高血压病史标志" data-name="高血压病史标志" data-type="select" data-readonly="false"><span class="tag-value">否认</span></span>
        </section>
        <section data-id="article-physical-exam" data-article="体格检查" data-name="体格检查">
          <span data-id="体温" data-name="体温" data-type="text" data-readonly="false"><span class="tag-value"></span></span>
        </section>
      `,
      templateDefinition,
      targetFieldIds: ['高血压病史标志', '体温'],
      recordContext: {
        recordText: '既往史：有高血压病史。体格检查：T:36.5℃。',
        structuredFacts: {
          historyTemplateChanges: {
            schemaVersion: 'outpatient-record-template-changes.v1',
            items: [{
              field: 'pastMedicalHistory',
              slotKey: 'hypertensionHistory',
              fromValue: '否认',
              toValue: '有',
            }],
          },
          physicalExamVitalSigns: {
            schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
            items: [{ slotKey: 'temperature', value: '36.5' }],
          },
        },
      },
    }))).resolves.toBe(true);

    expect(analysis.fieldValues.value).toEqual({
      高血压病史标志: '有',
      体温: '36.5',
    });
    expect(analysis.buildConfirmedPayload()).toEqual(expect.objectContaining({
      fieldValues: { 高血压病史标志: '有', 体温: '36.5' },
      dictionarySelections: {
        高血压病史标志: { value: '1', text: '有' },
      },
      emrFieldValues: { 高血压病史标志: '1', 体温: '36.5' },
    }));
  });

  it('rejects a reused requestId when the template snapshot changes', async () => {
    const analyzeFields = vi.fn().mockResolvedValue({
      personalHistory: '模型个人史',
      familyHistory: '模型家族史',
    });
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields,
      hashTemplate: vi.fn().mockResolvedValue('template-hash'),
    });
    await analysis.start(createRequest());

    await expect(analysis.start(createRequest({
      templateHtml: '<section data-id="changed" data-article="病史" data-name="病史"></section>',
    }))).resolves.toBe(false);

    expect(analysis.analysisErrorCode.value).toBe('REQUEST_ID_CONFLICT');
    expect(analysis.request.value?.templateHtml).toContain('personalHistory');
    expect(analyzeFields).toHaveBeenCalledTimes(1);
  });
});

describe('useOutpatientEmrAnalysis result lifecycle', () => {
  it('builds a local parameter payload without sending a completion event', async () => {
    const completeConsultation = vi.fn();
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation,
      now: () => 122,
    });

    expect(analysis.buildConfirmedPayload()).toBeNull();
    await analysis.start(createRequest());

    expect(analysis.buildConfirmedPayload()).toEqual(expect.objectContaining({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      timestamp: 122,
      fieldValues: {
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      },
    }));
    expect(completeConsultation).not.toHaveBeenCalled();
    expect(analysis.writebackStatus.value).toBe('idle');
  });

  it('emits a minimal record-confirmed payload and accepts only exact feedback', async () => {
    const completeConsultation = vi.fn().mockResolvedValue(undefined);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation,
      now: () => 123,
    });
    await analysis.start(createRequest());
    analysis.updateFieldValue('personalHistory', '医生最终个人史');

    await expect(analysis.writeBack()).resolves.toBe(true);
    expect(analysis.writebackStatus.value).toBe('pending');
    expect(completeConsultation).toHaveBeenCalledTimes(1);
    const payload = completeConsultation.mock.calls[0][0] as OutpatientEmrRecordConfirmedPayload;
    expect(payload).toEqual(expect.objectContaining({
      consultationId: 'VIS-001',
      visitId: 'VIS-001',
      requestId: 'REQ-001',
      emrType: 'outpatient-emr',
      resultType: 'record-confirmed',
      referenceStatus: 'pending',
      templateMetadata: expect.objectContaining({ templateHash: 'raw-input-hash' }),
      fieldValues: {
        personalHistory: '医生最终个人史',
        familyHistory: '模型家族史',
      },
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        personalHistory: '医生最终个人史',
        familyHistory: '模型家族史',
      },
      writebackScope: {
        recordFields: ['personalHistory', 'familyHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
      orderList: [],
    }));
    expect(payload).not.toHaveProperty('templateHtml');
    expect(payload).not.toHaveProperty('templateDefinition');
    expect(payload).not.toHaveProperty('recordContext');

    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-OTHER',
      requestId: 'REQ-001',
      status: 'success',
    })).toBeNull();
    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-OTHER',
      status: 'success',
    })).toBeNull();
    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'pending',
    })).toBeNull();
    expect(analysis.writebackStatus.value).toBe('pending');

    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'failed',
      message: '字段校验失败',
    })).toBe('failed');
    expect(analysis.writebackStatus.value).toBe('failed');
    expect(analysis.fieldValues.value.personalHistory).toBe('医生最终个人史');
    expect(analysis.canSubmit.value).toBe(true);

    await analysis.writeBack();
    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'success',
    })).toBe('success');
    expect(analysis.writebackStatus.value).toBe('success');
  });

  it('emits one combined record-confirmed after template confirmation', async () => {
    const completeConsultation = vi.fn().mockResolvedValue(undefined);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模板模型个人史',
        familyHistory: '模板模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation,
      now: () => 789,
    });
    const baseWritebackPayload: OutpatientEmrPreparedWritebackPayload = {
      consultationId: 'VIS-001',
      timestamp: 700,
      resultType: 'record-confirmed',
      requestId: 'REQ-001',
      referenceType: 'batch',
      action: 'batch',
      referenceStatus: 'pending',
      referenceMessage: '等待 HIS 回执',
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        personalHistory: '语音个人史',
      },
      diagList: [{ naDiag: '急性上呼吸道感染', cdIcd10: 'J06.900' }],
      orderList: [{ naSrv: '血常规', sdSrv: '41' }],
      writebackScope: {
        recordFields: ['personalHistory'],
        includeDiagnosis: true,
        orderTypes: ['lab_test'],
      },
    };
    await analysis.start(createRequest());

    await expect(analysis.writeBack(baseWritebackPayload)).resolves.toBe(true);

    expect(completeConsultation).toHaveBeenCalledTimes(1);
    expect(completeConsultation).toHaveBeenCalledWith(expect.objectContaining({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      emrType: 'outpatient-emr',
      fieldValues: {
        personalHistory: '模板模型个人史',
        familyHistory: '模板模型家族史',
      },
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        personalHistory: '模板模型个人史',
      },
      diagList: baseWritebackPayload.diagList,
      orderList: baseWritebackPayload.orderList,
      writebackScope: baseWritebackPayload.writebackScope,
    }));
    expect(analysis.writebackMessage.value).toContain('模板与已选诊疗内容');
  });

  it('sends a minimal cancelled terminal result before clearing an abandoned task', async () => {
    const completeConsultation = vi.fn().mockResolvedValue(undefined);
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation,
      now: () => 456,
    });
    await analysis.start(createRequest());

    await expect(analysis.cancel()).resolves.toBe(true);
    const payload = completeConsultation.mock.calls[0][0] as OutpatientEmrCancelledPayload;
    expect(payload).toEqual({
      consultationId: 'VIS-001',
      visitId: 'VIS-001',
      timestamp: 456,
      requestId: 'REQ-001',
      resultType: 'cancelled',
      status: 'cancelled',
      emrType: 'outpatient-emr',
    });
    expect(payload).not.toHaveProperty('templateHtml');
    expect(payload).not.toHaveProperty('templateDefinition');
    expect(payload).not.toHaveProperty('recordContext');
    expect(payload).not.toHaveProperty('fieldValues');
    expect(analysis.request.value).toBeNull();
  });

  it.each([
    ['success' as const, 'success' as const],
    ['failed' as const, 'failed' as const],
  ])('does not regress an early %s feedback after complete_consultation resolves', async (feedbackStatus, expectedStatus) => {
    const completion = deferred<unknown>();
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation: vi.fn().mockReturnValue(completion.promise),
    });
    await analysis.start(createRequest());

    const writeback = analysis.writeBack();
    expect(analysis.writebackStatus.value).toBe('submitting');
    expect(analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: feedbackStatus,
    })).toBe(feedbackStatus);
    completion.resolve(undefined);

    await expect(writeback).resolves.toBe(true);
    expect(analysis.writebackStatus.value).toBe(expectedStatus);
  });

  it('does not overwrite an early terminal feedback when complete_consultation rejects later', async () => {
    const completion = deferred<unknown>();
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: vi.fn().mockResolvedValue({
        personalHistory: '模型个人史',
        familyHistory: '模型家族史',
      }),
      hashTemplate: vi.fn().mockResolvedValue('raw-input-hash'),
      completeConsultation: vi.fn().mockReturnValue(completion.promise),
    });
    await analysis.start(createRequest());

    const writeback = analysis.writeBack();
    analysis.applyReferenceFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'success',
      message: 'HIS 已保存',
    });
    completion.reject(new Error('late invoke failure'));

    await expect(writeback).resolves.toBe(false);
    expect(analysis.writebackStatus.value).toBe('success');
    expect(analysis.writebackMessage.value).toBe('HIS 已保存');
  });
});
