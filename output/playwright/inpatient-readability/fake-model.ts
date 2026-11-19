import { computed, ref } from 'vue';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult, InpatientEmrGenerationStep } from '../../../src/features/inpatient-emr/types';
import { previewFields, previewValues } from './fixtures';

export interface InpatientEmrReferenceFeedbackPayload {
  consultationId?: string; requestId?: string; status?: 'pending' | 'success' | 'failed'; message?: string;
}

export function useInpatientEmrGeneration() {
  const scenario = new URLSearchParams(window.location.search).get('state') || 'ready';
  const result = ref<InpatientEmrGenerationResult | null>(null);
  const steps = ref<InpatientEmrGenerationStep[]>([]);
  const errorMessage = ref('');
  const isGenerating = ref(false);
  const isWritingBack = ref(false);
  const writebackMessage = ref('');
  const writebackStatus = ref<'idle' | 'pending' | 'success' | 'error'>('idle');
  const pendingWritebackRequestId = ref('');
  const activeStepKey = computed(() => steps.value.find((step) => step.status === 'running')?.key || null);
  const completedStepCount = computed(() => steps.value.filter((step) => step.status === 'done').length);

  async function start(request: InpatientEmrGenerationRequest) {
    const generating = scenario === 'generating';
    isGenerating.value = generating;
    writebackStatus.value = scenario === 'pending' ? 'pending' : scenario === 'failed' ? 'error' : scenario === 'success' ? 'success' : 'idle';
    pendingWritebackRequestId.value = scenario === 'pending' ? request.requestId || '' : '';
    writebackMessage.value = scenario === 'pending' ? '已发送给 HIS，等待回填结果回执' : scenario === 'failed' ? 'HIS 合成回填失败，请调整后重试' : scenario === 'success' ? 'HIS 已完成病历回填' : '';
    steps.value = [
      ['patient', '获取住院上下文', '已读取本次合成住院资料'],
      ['orders', '整理诊疗摘要', '已整理合成诊断、医嘱与报告'],
      ['temperature', '整理病历依据', '已核对生命体征与查房要点'],
      ['template', '解析病历', '已解析 5 个可生成字段'],
      ['generate', 'AI 生成', generating ? '正在生成病情分析与诊疗计划' : '已完成本轮合成草稿'],
    ].map(([key, title, detail], index) => ({ key, title, detail, description: detail, status: generating && index === 4 ? 'running' : 'done' })) as InpatientEmrGenerationStep[];
    result.value = {
      request, generatedAt: Date.now(), fieldValues: { ...previewValues }, initialFieldValues: { ...previewValues },
      emrContent: previewValues.病程记录文本, htmlContent: request.htmlContent,
      template: { cacheKey: 'SYN-CACHE', cacheHit: true, fields: previewFields },
      context: {
        registration: { patientId: 'SYN-PATIENT-001', name: '合成患者', gender: '男', ageText: '58岁', inpatientNo: 'SYN-20261117', deptName: '内科', bedNo: '08' },
        documentContext: { templateId: request.templateId, templateName: request.templateName || '', recordType: '日常病程记录', recordTime: request.recordTime || '', recordDate: '2026-11-17' },
        doctorSupplement: request.doctorSupplement, aiContext: request.hisContext, orders: [], temperatureChart: null,
      },
      evidenceSummary: {
        hisContext: { title: '住院上下文', status: 'used', detail: '已使用合成住院登记、诊断、医嘱与检验资料', meta: { orderCount: 6, labCount: 1, examCount: 0 } },
        outpatientRecord: { title: '门诊病历', status: 'skipped', detail: '本次日常病程未引用门诊病历' },
        doctorSupplement: { title: '补充要点', status: 'used', detail: '已使用医生合成查房要点' },
        template: { title: '病历模板', status: 'used', detail: '命中合成模板解析缓存，5 个 AI 字段' },
        aiGeneration: { title: 'AI 生成', status: 'used', detail: generating ? '生成中：已有正文逐步呈现' : '已生成合成草稿，请核对' },
      },
      trace: { traceId: 'SYN-TRACE-001', startedAt: Date.now() - 4200, stages: [
        { key: 'hisContext', title: '住院上下文', status: 'success', durationMs: 120, detail: '合成资料已就绪' },
        { key: 'templateResolve', title: '解析病历', status: 'success', durationMs: 80, detail: '合成模板缓存命中' },
        { key: 'aiGenerate', title: 'AI 生成', status: generating ? 'running' : 'success', durationMs: generating ? undefined : 4000, detail: generating ? '合成生成状态' : '合成草稿完成' },
      ] },
    };
  }

  function updateFieldValue(fieldId: string, value: string) {
    if (!result.value || isGenerating.value || isWritingBack.value || ['pending', 'success'].includes(writebackStatus.value)) return;
    if (!previewFields.some((field) => field.id === fieldId && field.aiSuitable)) return;
    result.value.fieldValues = { ...result.value.fieldValues, [fieldId]: value };
  }
  async function writeBack() {
    if (!result.value || isGenerating.value || ['pending', 'success'].includes(writebackStatus.value)) return false;
    writebackStatus.value = 'pending';
    pendingWritebackRequestId.value = result.value.request.requestId || '';
    writebackMessage.value = '已发送给 HIS，等待回填结果回执（合成）';
    return true;
  }
  function applyReferenceFeedback(payload: InpatientEmrReferenceFeedbackPayload): 'success' | 'failed' | null {
    if (!result.value || payload.consultationId !== result.value.request.admissionId || payload.requestId !== pendingWritebackRequestId.value) return null;
    if (payload.status === 'pending') return null;
    if (payload.status !== 'success' && payload.status !== 'failed') return null;
    writebackStatus.value = payload.status === 'success' ? 'success' : 'error';
    writebackMessage.value = payload.message || (payload.status === 'success' ? 'HIS 已完成病历回填（合成）' : 'HIS 合成回填失败，请调整后重试');
    pendingWritebackRequestId.value = '';
    return payload.status;
  }
  function reset() { result.value = null; steps.value = []; }
  async function abandon() { reset(); return true; }
  return { steps, result, errorMessage, isGenerating, isWritingBack, writebackMessage, writebackStatus, activeStepKey, completedStepCount, start, updateFieldValue, writeBack, applyReferenceFeedback, abandon, pendingWritebackRequestId, reset };
}
