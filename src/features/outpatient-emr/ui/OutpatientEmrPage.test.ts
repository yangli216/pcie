// @vitest-environment jsdom
import { createApp, h, nextTick, ref, shallowRef, type App } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrReferenceFeedbackPayload,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
} from '../types';
import OutpatientEmrPage from './OutpatientEmrPage.vue';

const mocks = vi.hoisted(() => ({
  analysis: null as Record<string, unknown> | null,
  listenerOptions: null as {
    isActive?: () => boolean;
    onFeedback: (payload: OutpatientEmrReferenceFeedbackPayload) => void;
  } | null,
}));

vi.mock('@features/consultation-result', () => ({
  useConsultationReferenceFeedbackListener: (options: typeof mocks.listenerOptions) => {
    mocks.listenerOptions = options;
    return { clearListener: vi.fn(), startListener: vi.fn() };
  },
}));

vi.mock('../model/useOutpatientEmrAnalysis', () => ({
  useOutpatientEmrAnalysis: () => mocks.analysis,
}));

vi.mock('./OutpatientEmrTemplatePreview.vue', () => ({
  default: {
    name: 'OutpatientEmrTemplatePreview',
    emits: ['update-field'],
    setup(_: unknown, { emit }: { emit: (event: 'update-field', fieldId: string, value: string) => void }) {
      return () => h('button', {
        type: 'button',
        'data-testid': 'template-update',
        onClick: () => emit('update-field', 'field', '医生修改值'),
      }, '修改字段');
    },
  },
}));

let app: App<Element> | null = null;
let root: HTMLDivElement | null = null;

const externalRequest: OutpatientEmrAnalysisRequest = {
  visitId: 'VIS-001',
  templateId: 'TPL-001',
  templateName: '门诊模板',
  templateHtml: '<section data-id="article-field" data-article="病史" data-name="病史"></section>',
  templateDefinition: '[{"ID":"article-field","NAME":"病史","ARTICLE":"病史","eles":[]}]',
  targetFieldIds: ['field'],
  recordContext: { recordText: '咳嗽3天。' },
  requestId: 'REQ-001',
};

const field: OutpatientEmrTemplateField = {
  id: 'field',
  name: '字段',
  type: 'text',
  articleTemplateId: 'article-field',
  articleId: '',
  articleName: '',
  articleDefinitionName: '',
  readonly: false,
  aiSuitable: true,
  baselineValue: '原值',
  baselineDictionaryValue: '',
  dictionaryItems: [],
  recordField: null,
  mappingSource: 'unmapped',
  projectionMode: null,
};

function createAnalysis() {
  return {
    request: shallowRef<OutpatientEmrAnalysisRequest | null>(null),
    template: shallowRef<OutpatientEmrTemplateParseResult | null>({
      sanitizedHtml: '<div>原值</div>',
      fields: [field],
      targetFields: [field],
    }),
    targetFields: ref([field]),
    aiTargetCount: ref(1),
    resultSummary: ref('AI 已填 1/1 个字段'),
    fieldValues: ref<Record<string, string>>({ field: 'AI 草稿' }),
    analysisStatus: ref<'idle' | 'analyzing' | 'ready' | 'error'>('ready'),
    analysisErrorCode: ref(''),
    analysisErrorMessage: ref(''),
    writebackStatus: ref<'idle' | 'submitting' | 'pending' | 'success' | 'failed'>('idle'),
    writebackMessage: ref(''),
    pendingWritebackRequestId: ref(''),
    dictionaryValidationMessage: ref(''),
    canSubmit: ref(true),
    canRetry: ref(true),
    start: vi.fn().mockResolvedValue(true),
    retry: vi.fn().mockResolvedValue(true),
    updateFieldValue: vi.fn(),
    buildConfirmedPayload: vi.fn().mockReturnValue({
      templateMetadata: { fields: [{ id: 'field', recordField: null }] },
      fieldValues: { field: 'AI 草稿' },
      writebackScope: { recordFields: [], includeDiagnosis: false, orderTypes: [] },
    }),
    writeBack: vi.fn().mockResolvedValue(true),
    cancel: vi.fn().mockResolvedValue(true),
    applyReferenceFeedback: vi.fn<(
      payload: OutpatientEmrReferenceFeedbackPayload,
    ) => 'success' | 'failed' | null>().mockReturnValue(null),
    reset: vi.fn(),
  };
}

function mountPage(
  request: OutpatientEmrAnalysisRequest | null,
  listeners: { onCancel?: () => void; onCompleted?: () => void } = {},
  baseWritebackPayload: OutpatientEmrPreparedWritebackPayload | null = null,
): void {
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(OutpatientEmrPage, {
    request,
    baseWritebackPayload,
    ...listeners,
  });
  app.mount(root);
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])
    .find(candidate => candidate.textContent?.includes(label));
  if (!button) throw new Error(`未找到按钮：${label}`);
  return button;
}

function getByTestId(testId: string): HTMLElement {
  const element = root?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!element) throw new Error(`未找到测试元素：${testId}`);
  return element;
}

afterEach(() => {
  app?.unmount();
  root?.remove();
  app = null;
  root = null;
  mocks.analysis = null;
  mocks.listenerOptions = null;
});

describe('OutpatientEmrPage formal HIS flow', () => {
  it('only starts from the caller request and returns confirmed parameters through writeBack', async () => {
    const analysis = createAnalysis();
    mocks.analysis = analysis;
    mountPage(externalRequest);
    await nextTick();

    expect(analysis.start).toHaveBeenCalledWith(externalRequest);
    expect(root?.textContent).not.toContain('实验台');
    getByTestId('template-update').click();
    expect(analysis.updateFieldValue).toHaveBeenCalledWith('field', '医生修改值');
    findButton('返回参数').click();
    await nextTick();

    expect(analysis.writeBack).toHaveBeenCalledTimes(1);
  });

  it('shows a passive HIS waiting state when no formal request exists', async () => {
    const analysis = createAnalysis();
    mocks.analysis = analysis;
    mountPage(null);
    await nextTick();

    expect(analysis.start).not.toHaveBeenCalled();
    expect(analysis.reset).toHaveBeenCalledTimes(1);
    expect(root?.textContent).toContain('等待 HIS 通过 Bridge 或 SDK 传入门诊病历模板');
    expect(root?.textContent).not.toContain('上传');
    expect(root?.textContent).not.toContain('粘贴');
    expect(root?.querySelector('.page-footer')).toBeNull();
  });

  it('shows one combined confirmation and submits the prepared voice scope with template fields', async () => {
    const analysis = createAnalysis();
    mocks.analysis = analysis;
    const baseWritebackPayload: OutpatientEmrPreparedWritebackPayload = {
      consultationId: 'VIS-001',
      timestamp: 123,
      resultType: 'record-confirmed',
      requestId: 'REQ-001',
      referenceType: 'batch',
      action: 'batch',
      referenceStatus: 'pending',
      referenceMessage: '等待 HIS 回执',
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        chiefComplaint: '咳嗽三天',
      },
      diagList: [{ naDiag: '急性上呼吸道感染' }],
      orderList: [{ naSrv: '血常规', sdSrv: '41' }],
      writebackScope: {
        recordFields: ['chiefComplaint'],
        includeDiagnosis: true,
        orderTypes: ['lab_test'],
      },
    };
    mountPage(externalRequest, {}, baseWritebackPayload);
    await nextTick();

    expect(root?.textContent).toContain('门诊模板映射确认');
    expect(root?.textContent).toContain('一次确认，统一回写');
    expect(root?.textContent).toContain('病历段 1');
    expect(root?.textContent).toContain('诊断 1');
    expect(root?.textContent).toContain('医嘱 1');
    findButton('一键回写').click();
    await nextTick();

    expect(analysis.writeBack).toHaveBeenCalledWith(baseWritebackPayload);
  });
});

describe('OutpatientEmrPage collapsed feedback lifecycle', () => {
  it('continues accepting an exact pending external feedback while the page is inactive', () => {
    const analysis = createAnalysis();
    const applyReferenceFeedback = vi.fn<(
      payload: OutpatientEmrReferenceFeedbackPayload,
    ) => 'success' | 'failed' | null>().mockReturnValue('success');
    analysis.request.value = externalRequest;
    analysis.template.value = null;
    analysis.writebackStatus.value = 'pending';
    analysis.writebackMessage.value = '等待回执';
    analysis.pendingWritebackRequestId.value = 'REQ-001';
    analysis.canSubmit.value = false;
    analysis.canRetry.value = false;
    analysis.applyReferenceFeedback = applyReferenceFeedback;
    mocks.analysis = analysis;

    const onCompleted = vi.fn();
    mountPage(externalRequest, { onCompleted });

    expect(mocks.listenerOptions?.isActive?.()).toBe(true);
    mocks.listenerOptions?.onFeedback({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'success',
    });

    expect(applyReferenceFeedback).toHaveBeenCalledWith({
      consultationId: 'VIS-001',
      requestId: 'REQ-001',
      status: 'success',
    });
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
});
