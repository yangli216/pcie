// @vitest-environment jsdom
// 真实模板串联：真实模板对 → 字段 prompt generator → Fake 模型输出 → 规范化 → 草稿来源
// → 医生补选 → 同源 builder → SDK 终态校验。模型为 Fake，不连接真实 AI 或 HIS。
// @ts-expect-error Node built-ins are provided by Vitest but @types/node is not a direct project dependency.
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { analyzeOutpatientEmrFields } from '@features/outpatient-emr/api/outpatientEmrService';
import { OUTPATIENT_EMR_PROMPT_VERSION } from '@features/outpatient-emr/lib/outpatientEmrPromptGenerator';
import { useOutpatientEmrAnalysis } from '@features/outpatient-emr/model/useOutpatientEmrAnalysis';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrRecordConfirmedPayload,
} from '@features/outpatient-emr/types';
import templateHtml from './fixtures/real-template.html?raw';
import templateDefinition from './fixtures/real-template.json?raw';
import sdkSource from '../../../sdk/med-hermes-sdk.js?raw';

vi.mock('@features/outpatient-emr/api/outpatientEmrTemplateSnapshotService', () => ({
  resolveOutpatientEmrTemplateSnapshot: vi.fn(async ({ templateId, templateHash }) => ({
    schemaVersion: 'outpatient-emr-template-pair-resolution.v1',
    cacheHit: false,
    id: null,
    templateId,
    templateHash,
    parseResult: null,
    receivedAt: null,
  })),
  persistOutpatientEmrTemplateSnapshot: vi.fn().mockResolvedValue({
    id: 'snapshot-real',
    templateHash: 'hash',
    deduplicated: false,
    receivedAt: 1,
  }),
}));


const TARGET_FIELD_IDS = [
  '就诊时间',
  '主诉文本',
  '现病史文本',
  '高血压病史标志',
  '吸烟史标志',
  '婚育状况',
  '怀孕标志',
  '体温',
  '收缩压',
  '意识',
  '目前诊断',
  '注意事项文本',
];

const FAKE_MODEL_OUTPUT: Record<string, string> = {
  就诊时间: '',
  主诉文本: '咳嗽、咳痰3天',
  现病史文本: '患者3天前受凉后出现咳嗽、咳白痰，无发热。',
  高血压病史标志: '1',
  高血压病史补充: '高血压5年，规律服用氨氯地平。',
  吸烟史标志: '',
  婚育状况: '已婚已育',
  怀孕标志: '否',
  体温: '36.8',
  收缩压: '138',
  意识: '',
  目前诊断: '急性支气管炎',
  注意事项文本: '戒烟，监测血压；如出现发热或气促及时复诊。',
};

function createRequest(): OutpatientEmrAnalysisRequest {
  return {
    visitId: 'SIM-VISIT-CHAIN-01',
    templateId: 'SIM-TPL-REAL-01',
    templateName: '门急诊病历模板',
    templateHtml,
    templateDefinition,
    targetFieldIds: [...TARGET_FIELD_IDS],
    recordContext: {
      recordText: '主诉：咳嗽、咳痰3天\n既往史：高血压5年',
      structuredFacts: { diagnoses: [{ name: '急性支气管炎', primary: '是' }] },
    },
    patient: { idPi: 'SIM-PI-01', name: '模拟患者', sdSexText: '女', ageText: '45岁' },
    requestId: 'SIM-REQ-CHAIN-01',
  };
}

type MedHermesConstructor = new () => {
  analyzeOutpatientEmr(request: OutpatientEmrAnalysisRequest): Promise<Record<string, unknown>>;
  _http: { post: (...args: unknown[]) => Promise<unknown> };
  _callWithFallback: (httpCall: () => Promise<unknown>) => Promise<unknown>;
  _resumeEventChannelIfNeeded: () => void;
  _dispatchEnvelope(envelope: unknown): void;
};

function loadSdk(): MedHermesConstructor {
  const moduleState: { exports: unknown } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleState,
    exports: moduleState.exports,
    AbortController,
    setTimeout,
    clearTimeout,
    console: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  sandbox.globalThis = sandbox;
  runInNewContext(sdkSource, sandbox);
  return moduleState.exports as MedHermesConstructor;
}

describe('outpatient EMR real-template chain (Fake model)', () => {
  it('produces one SDK-accepted record-confirmed from the real template pair', async () => {
    const chatFast = vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      const user = messages[1].content;
      const payload = JSON.parse(user.slice(user.indexOf('\n') + 1)) as {
        template: { fields: Array<{ id: string }> };
      };
      // Fake 模型逐字段返回，包含字典编码、空字典和需要保留模板草稿的空文本。
      return JSON.stringify(Object.fromEntries(
        payload.template.fields.map((field) => [field.id, FAKE_MODEL_OUTPUT[field.id] ?? '']),
      ));
    });
    const captured: OutpatientEmrRecordConfirmedPayload[] = [];
    const analysis = useOutpatientEmrAnalysis({
      analyzeFields: (input) => analyzeOutpatientEmrFields(input, { chatFast: chatFast as never }),
      completeConsultation: async (result) => {
        captured.push(result as OutpatientEmrRecordConfirmedPayload);
      },
      now: () => 1_800_000_000_000,
    });
    const request = createRequest();

    await expect(analysis.start(request)).resolves.toBe(true);
    expect(chatFast).toHaveBeenCalledTimes(1);
    const [system, user] = (chatFast.mock.calls[0][0] as Array<{ content: string }>)
      .map((message) => message.content);
    expect(system).toContain(OUTPATIENT_EMR_PROMPT_VERSION);
    expect(user).not.toContain('模拟患者');
    expect(user).not.toContain('SIM-PI-01');
    expect(user).not.toContain('SIM-VISIT-CHAIN-01');

    expect(analysis.fieldValues.value['就诊时间']).toBe('2025-03-18 10:52');
    expect(analysis.fieldValueSources.value['就诊时间']).toBe('template');
    expect(analysis.fieldValues.value['高血压病史标志']).toBe('有');
    expect(analysis.fieldValueSources.value['主诉文本']).toBe('ai');
    // 模型返回空串表示无法确定，允许医生选填，回写保留其余控件的 HIS 原值。
    expect(analysis.fieldValues.value['吸烟史标志']).toBe('');
    expect(analysis.fieldValues.value['意识']).toBe('');
    expect(analysis.canSubmit.value).toBe(true);

    analysis.updateFieldValue('吸烟史标志', '有');
    await expect(analysis.writeBack()).resolves.toBe(true);

    expect(captured).toHaveLength(1);
    const result = captured[0];
    expect(result.dictionarySelections['吸烟史标志']).toEqual({ value: '1', text: '有' });
    expect(result.fieldValues).not.toHaveProperty('意识');
    expect(result.emrFieldValues).not.toHaveProperty('意识');
    expect(result.dictionarySelections).not.toHaveProperty('意识');
    expect(result.templateMetadata.fields.map(field => field.id)).not.toContain('意识');
    expect(result.dictionarySelections['高血压病史标志']).toEqual({ value: '1', text: '有' });
    expect(result.emrFieldValues['高血压病史标志']).toBe('1');
    expect(result.fieldValues['体温']).toBe('36.8');
    expect(result.writebackScope.recordFields).toContain('maritalReproductiveHistory');
    expect(result.outpatientRecord?.maritalReproductiveHistory).toContain('已婚已育');
    expect(JSON.stringify(result)).not.toContain('"source"');

    const MedHermes = loadSdk();
    const sdk = new MedHermes();
    sdk._resumeEventChannelIfNeeded = vi.fn();
    sdk._callWithFallback = (httpCall) => httpCall();
    sdk._http.post = vi.fn().mockResolvedValue({ status: 'success' });
    const pending = sdk.analyzeOutpatientEmr(request);
    sdk._dispatchEnvelope({
      state: 'ready',
      event: {
        id: `${request.visitId}:${request.requestId}:record-confirmed:1`,
        type: 'record-confirmed',
        consultationId: request.visitId,
        requestId: request.requestId,
        timestamp: result.timestamp,
        terminal: false,
        payload: result,
      },
    });
    await expect(pending).resolves.toEqual(result);
  });
});
