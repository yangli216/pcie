import { chatFast, chatStream, DEFAULT_RETRY_CONFIG } from '@/services/llm';
import { getHisAdapter } from '@/services/his';
import { regionalPost } from '@/services/regionalClient';
import type {
  HisInpatientOrder,
  HisInpatientEmrContextPackage,
  HisInpatientRegistrationInfo,
  HisInpatientTemperatureChart,
  HisInpatientQuery,
  HisOutpatientMedicalRecord,
} from '@/services/his';
import { parseLLMJson } from '@features/clinical-result/clinicalResultLlmJsonParser';
import {
  buildInpatientEmrGeneratePrompt,
} from '../lib/inpatientEmrPrompts';
import {
  buildDefaultFieldValues,
  fillInpatientEmrTemplateHtml,
  formatInpatientEmrDateMinute,
  parseInpatientEmrTemplate,
} from '../lib/inpatientEmrTemplate';
import { readInpatientEmrFieldValues } from '../lib/inpatientEmrGenerationValues';
export { readInpatientEmrFieldValues as parsePartialJson } from '../lib/inpatientEmrGenerationValues';
import {
  cloneInpatientEmrTrace,
  createInpatientEmrTrace,
  finishInpatientEmrTrace,
  finishInpatientEmrTraceStage,
  startInpatientEmrTraceStage,
} from '../lib/inpatientEmrObservability';
import type {
  InpatientEmrContext,
  InpatientEmrDocumentContext,
  InpatientEmrEvidenceSummary,
  InpatientEmrGenerationTrace,
  InpatientEmrGenerationProgress,
  InpatientEmrGenerationRequest,
  InpatientEmrGenerationResult,
  InpatientEmrTemplateField,
  InpatientEmrTemplateParseResult,
} from '../types';

export type InpatientEmrProgressHandler = (progress: InpatientEmrGenerationProgress) => void;

function report(
  onProgress: InpatientEmrProgressHandler | undefined,
  progress: InpatientEmrGenerationProgress,
): void {
  onProgress?.(progress);
}

function hasUsableOutpatientRecordReference(record: HisOutpatientMedicalRecord | null | undefined): boolean {
  if (!record) return false;
  const hasStructuredHistory = [
    record.chiefComplaint,
    record.historyOfPresentIllness,
    record.pastHistory,
    record.physicalExamination,
    record.auxiliaryExamination,
    record.diagnosis,
    record.treatmentPlan,
  ].some((value) => Boolean(value?.trim()));
  if (hasStructuredHistory || record.vitalSigns || record.sourceFacts) return true;
  if (record.contentPending) return false;
  return Boolean(record.plainText?.trim() ?? record.htmlContent?.trim());
}

function extractDatePart(value: string | undefined): string {
  return (value || '').split(/\s+/)[0] || '';
}

function normalizeRecordTime(value: string | undefined): string {
  const trimmed = (value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/.test(trimmed)) {
    return trimmed.length === 10 ? `${trimmed} 00:00` : trimmed;
  }
  return formatInpatientEmrDateMinute();
}

function buildDocumentContext(request: InpatientEmrGenerationRequest): InpatientEmrDocumentContext {
  const recordTime = normalizeRecordTime(request.recordTime);
  const recordType = (request.templateName || '').trim() || '住院病程记录';
  return {
    templateId: request.templateId,
    templateName: (request.templateName || '').trim() || '住院病历模板',
    recordType,
    recordTime,
    recordDate: extractDatePart(recordTime),
  };
}

function mergeDocumentContextIntoHisContext(
  hisContext: HisInpatientEmrContextPackage | undefined,
  documentContext: InpatientEmrDocumentContext,
  admissionId: string,
): HisInpatientEmrContextPackage | undefined {
  if (!hisContext) return undefined;
  return {
    ...hisContext,
    documentContext: {
      ...hisContext.documentContext,
      admissionId: hisContext.documentContext?.admissionId || admissionId,
      templateId: documentContext.templateId,
      templateName: documentContext.templateName,
      recordType: documentContext.recordType,
      recordTime: documentContext.recordTime,
      recordDate: documentContext.recordDate,
    },
  };
}

function buildRegistrationFromAiContext(
  hisContext: HisInpatientEmrContextPackage | undefined,
  query: HisInpatientQuery,
): HisInpatientRegistrationInfo | null {
  if (!hisContext) return null;
  const patient = hisContext.patient;
  const admission = hisContext.admission;
  if (!patient && !admission && !hisContext.diagnoses?.length) return null;
  return {
    patientId: patient?.patientId || query.patientId || query.admissionId || '',
    name: patient?.name,
    gender: patient?.sex,
    birthday: patient?.birthDate,
    ageText: patient?.age,
    inpatientVisitId: query.admissionId || query.inpatientVisitId,
    inpatientNo: patient?.inpatientNo,
    medicalRecordNo: patient?.medicalRecordNo,
    admissionTime: admission?.admissionTime,
    deptName: admission?.department,
    wardName: admission?.ward,
    bedNo: admission?.bedNo,
    attendingDoctorName: admission?.attendingDoctor,
    chiefDoctorId: admission?.chiefDoctor,
    allergyText: admission?.allergyText,
    isSevere: admission?.severeFlag,
    diagnoses: hisContext.diagnoses,
    raw: {
      source: 'inpatient-emr-ai-context',
      admission,
      patient,
    },
  };
}

function uniqueOrders(orders: HisInpatientOrder[]): HisInpatientOrder[] {
  const seen = new Set<string>();
  return orders.filter((order) => {
    const key = order.orderId || `${formatOrderDisplayText(order)}-${order.startTime || ''}-${order.status || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatOrderDisplayText(order: HisInpatientOrder): string {
  if (order.displayText?.trim()) {
    return order.displayText.trim();
  }
  const text = (order.fullText || order.name || '').trim();
  if (!text) return '';

  const hasDose = order.dose && text.includes(order.dose);
  const hasRoute = order.route && text.includes(order.route);
  const hasFreq = order.frequency && text.includes(order.frequency);

  const suffixParts: string[] = [];
  if (order.dose && !hasDose) {
    suffixParts.push(order.dose);
  }
  if (order.route && !hasRoute) {
    suffixParts.push(order.route);
  }
  if (order.frequency && !hasFreq) {
    suffixParts.push(order.frequency);
  }

  if (suffixParts.length > 0) {
    return `${text} ${suffixParts.join(' ')}`.trim();
  }
  return text;
}

function buildOrdersFromAiContext(
  hisContext: HisInpatientEmrContextPackage | undefined,
): HisInpatientOrder[] {
  if (!hisContext?.orders) return [];
  return uniqueOrders([
    ...(hisContext.orders.active || []),
    ...(hisContext.orders.changedNearRecordDate || []),
  ]);
}

function buildTemperatureChartFromAiContext(
  hisContext: HisInpatientEmrContextPackage | undefined,
  query: HisInpatientQuery,
): HisInpatientTemperatureChart | null {
  const vitals = hisContext?.vitals;
  if (!vitals) return null;
  const recordDateItems = vitals.recordDateItems || [];
  const latestBefore = vitals.latestBeforeRecordDate ? [vitals.latestBeforeRecordDate] : [];
  const records = [...recordDateItems, ...latestBefore].filter(Boolean);
  if (records.length === 0) return null;
  return {
    patientId: hisContext?.patient?.patientId || query.patientId || query.admissionId || '',
    inpatientVisitId: query.inpatientVisitId || query.admissionId,
    records,
    todayRecords: recordDateItems,
    historyRecords: latestBefore,
    raw: {
      source: 'inpatient-emr-ai-context',
      summary: vitals.summary,
      raw: vitals.raw,
    },
  };
}

function mergeGeneratedValues(
  fields: InpatientEmrTemplateField[],
  context: InpatientEmrContext,
  generatedValues: Record<string, string>,
): Record<string, string> {
  const defaults = buildDefaultFieldValues(fields, context);
  return Object.fromEntries(fields.map((field) => [
    field.id,
    field.aiSuitable
      ? generatedValues[field.id] ?? ''
      : defaults[field.id] || '',
  ]));
}

function buildGeneratedEmrText(
  fields: InpatientEmrTemplateField[],
  values: Record<string, string>,
): string {
  if (values.病程记录文本?.trim()) return values.病程记录文本.trim();
  return fields.filter((field) => field.aiSuitable)
    .map((field) => values[field.id]).filter((value) => value?.trim()).join('\n\n');
}

interface RemoteInpatientEmrTemplateCache {
  templateHash?: string;
  cacheHit?: boolean;
  fields?: unknown;
}

class InpatientEmrTemplateConfigurationError extends Error {}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A duplicate leaves only that ID undecided. Callers look up current HTML fields exclusively. */
function indexUniqueFieldRules(rows: unknown[]): Map<string, Record<string, unknown> | null> {
  const byId = new Map<string, Record<string, unknown> | null>();
  for (const row of rows) {
    const field = objectValue(row);
    if (field && typeof field.id === 'string') byId.set(field.id, byId.has(field.id) ? null : field);
  }
  return byId;
}

function normalizeTemplateField(
  value: unknown,
  local: InpatientEmrTemplateField,
): InpatientEmrTemplateField {
  const field = objectValue(value);
  const rule = objectValue(field?.rule) || {};
  if (!field || typeof field.aiSuitable !== 'boolean'
    || (rule.prompt !== undefined && typeof rule.prompt !== 'string')
    || ['constraints', 'dependencies'].some((key) => rule[key] !== undefined
      && (!Array.isArray(rule[key]) || (rule[key] as unknown[]).some((item) => typeof item !== 'string')))) {
    return {
      ...local,
      visible: field?.visible !== false,
      aiSuitable: false,
      rule: { ...local.rule, source: local.aiSuitable ? 'manual_or_his' : local.rule.source },
    };
  }
  const aiSuitable = field.aiSuitable;
  const source = aiSuitable ? 'ai'
    : ['his_or_system', 'fixed', 'doctor_signature', 'manual_or_his'].includes(String(rule.source))
      ? rule.source as InpatientEmrTemplateField['rule']['source'] : 'manual_or_his';
  return {
    // HTML owns identity, shape and current HIS values. The saved configuration
    // owns generation policy; neither cache metadata nor old presets can replace it.
    ...local,
    visible: field.visible !== false,
    meaning: typeof field.meaning === 'string' && field.meaning.trim() ? field.meaning : local.meaning,
    aiSuitable,
    rule: {
      ...rule,
      source,
      value: typeof rule.value === 'string' ? rule.value : undefined,
      prompt: typeof rule.prompt === 'string' ? rule.prompt : undefined,
      promptIntent: typeof rule.promptIntent === 'string' ? rule.promptIntent : undefined,
      constraints: Array.isArray(rule.constraints) ? rule.constraints as string[] : local.rule.constraints,
      dependencies: Array.isArray(rule.dependencies) ? rule.dependencies as string[] : local.rule.dependencies,
    },
  };
}

const TEMPLATE_REQUEST_TIMEOUT_MS = 30_000;

const defaultAiConstraints = [
  '仅依据已提供资料生成，不补充未出现的检查结果或症状',
  '围绕字段含义生成对应段落，不跨字段混写其他模板项',
  '合理引用住院登记、诊断、医嘱和体温单中的客观信息',
  '保留医生最终审核空间，避免给出绝对疗效判断',
];

async function classifyUnknownFieldsWithLLM(
  unknownFields: InpatientEmrTemplateField[],
  recordType?: string,
  deptName?: string,
): Promise<Array<{ id: string; aiSuitable: boolean; meaning: string; source: InpatientEmrTemplateField['rule']['source'] }>> {
  const prompt = [
    '你是一名严谨的住院电子病历模板字段分析专家。',
    '任务：分析以下未确定规则的病历字段，判断其是否适合由 AI 生成，并进行分类。',
    deptName ? `当前病区专科：${deptName}` : '',
    recordType ? `当前病历文书类型：${recordType}` : '',
    '判定标准：',
    '1. 适合由 AI 依据 HIS 住院诊疗数据书写大段正文、病程分析、诊疗经过或诊疗计划的，判定 aiSuitable 为 true，source 为 "ai"。',
    '2. 页眉、页脚、签名、纯客观系统/HIS 字段（如住院号、日期、时间等），判定 aiSuitable 为 false，source 为 "his_or_system"。',
    '3. 其他纯手动输入或带入不确定字段判定 aiSuitable 为 false，source 为 "manual_or_his"。',
    '输出格式：必须是严格的 JSON 数组，每一项结构如下：',
    '[{ "id": "字段ID", "aiSuitable": true, "meaning": "医疗含义详细说明", "source": "ai" }]',
    '请勿输出任何 Markdown 标记、JSON 外的解释说明或免责申明。',
    `待分析字段列表：\n${JSON.stringify(unknownFields.map(f => ({ id: f.id, name: f.name, templateText: f.templateText ?? f.defaultValue })), null, 2)}`
  ].filter(Boolean).join('\n');

  try {
    const response = await chatFast([
      { role: 'system', content: '你只输出 JSON 数组，不包含 markdown 格式标记。' },
      { role: 'user', content: prompt }
    ], undefined, { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 }, undefined, {
      configProfile: 'fast',
      nonStreamTimeoutMs: TEMPLATE_REQUEST_TIMEOUT_MS,
      traceContext: {
        scene: 'inpatient-emr-template-resolve',
        sourceModule: 'inpatient-emr',
        operationModule: 'inpatient-emr',
        operationAction: 'classify_unknown_fields',
        title: '分析病历模板未知字段',
      }
    });

    const parsed = parseLLMJson<unknown>(response);
    if (!Array.isArray(parsed)) return [];
    const byId = indexUniqueFieldRules(parsed);
    const classified: Array<{ id: string; aiSuitable: boolean; meaning: string; source: InpatientEmrTemplateField['rule']['source'] }> = [];
    for (const { id } of unknownFields) {
      const item = byId.get(id);
      if (!item || typeof item.aiSuitable !== 'boolean') continue;
      classified.push({
        id,
        aiSuitable: item.aiSuitable,
        meaning: typeof item.meaning === 'string' ? item.meaning : '',
        source: item.aiSuitable ? 'ai' : item.source === 'his_or_system' ? 'his_or_system' : 'manual_or_his',
      });
    }
    return classified;
  } catch (error) {
    console.warn('[InpatientEmr] LLM failed to classify unknown fields, using default manual fallback', error);
    return [];
  }
}

async function enrichUnknownFieldsWithLocalLLM(
  template: InpatientEmrTemplateParseResult,
  request: InpatientEmrGenerationRequest,
  registration?: HisInpatientRegistrationInfo | null,
): Promise<void> {
  const unknownFieldIds = new Set(template.unknownFieldIds || []);
  delete template.unknownFieldIds;
  const unknownFields = template.fields.filter((field) => unknownFieldIds.has(field.id));
  if (unknownFields.length === 0) return;

  console.log(`[InpatientEmr] 发现 ${unknownFields.length} 个未匹配预设字段，正在调用 LLM 进行智能特征分析...`);
  const classified = await classifyUnknownFieldsWithLLM(
    unknownFields,
    request.templateName,
    registration?.deptName || registration?.wardName,
  );
  const classifiedMap = new Map(classified.map((item) => [item.id, item]));

  template.fields = template.fields.map((field) => {
    if (unknownFieldIds.has(field.id) && classifiedMap.has(field.id)) {
      const aiInfo = classifiedMap.get(field.id)!;
      const aiSuitable = aiInfo.aiSuitable;
      return {
        ...field,
        aiSuitable,
        meaning: aiInfo.meaning || field.meaning,
        rule: {
          source: aiInfo.source,
          dependencies: aiSuitable ? ['registration', 'registration.diagnoses', 'orders', 'temperatureChart'] : field.rule.dependencies,
          promptIntent: aiSuitable ? (field.id.toLowerCase().includes('cy') ? 'inpatientDischargeRecordSection' : 'inpatientRecordSection') : undefined,
          constraints: aiSuitable ? defaultAiConstraints : ['按系统事实填充或手工录入，AI不自由改写'],
        }
      };
    }
    return field;
  });
}

async function resolveInpatientEmrTemplate(
  request: InpatientEmrGenerationRequest,
  registration: HisInpatientRegistrationInfo | null | undefined,
  onProgress?: InpatientEmrProgressHandler,
): Promise<{ template: InpatientEmrTemplateParseResult; source: string }> {
  const localTemplate = parseInpatientEmrTemplate(request.htmlContent);
  report(onProgress, {
    key: 'template', status: 'running',
    detail: `已识别 ${localTemplate.fields.length} 个模板字段，正在读取后台字段配置`,
  });
  let remote: RemoteInpatientEmrTemplateCache | undefined;
  let source = '后台未返回字段，使用本地模板';
  try {
    remote = await regionalPost<RemoteInpatientEmrTemplateCache>(
      '/v1/client/inpatient-emr/templates/resolve',
      {
        templateId: request.templateId,
        templateHash: localTemplate.cacheKey,
        templateName: request.templateName || '',
        htmlContent: request.htmlContent,
        fields: localTemplate.fields.map(({ templateText: _localText, ...field }) => field),
      },
      TEMPLATE_REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    source = '后台配置未取得，使用本地模板';
    console.warn('[InpatientEmr] remote template cache unavailable, using local parse result', error);
  }

  if (remote?.fields !== undefined && !Array.isArray(remote.fields)) {
    throw new InpatientEmrTemplateConfigurationError('模板字段配置格式不正确，请核对后台字段配置后重新生成。');
  }
  if (Array.isArray(remote?.fields) && remote.fields.length > 0) {
    const byId = indexUniqueFieldRules(remote.fields);
    return {
      source: remote.cacheHit ? '后台字段配置缓存命中' : '后台字段配置已读取',
      template: {
        cacheKey: remote.templateHash || localTemplate.cacheKey,
        cacheHit: remote.cacheHit === true,
        fields: localTemplate.fields.map((field) => normalizeTemplateField(byId.get(field.id), field)),
      },
    };
  }

  if (localTemplate.unknownFieldIds?.length) {
    report(onProgress, {
      key: 'template', status: 'running',
      detail: `${source}，正在分析 ${localTemplate.unknownFieldIds.length} 个待确认字段`,
    });
  }
  await enrichUnknownFieldsWithLocalLLM(localTemplate, request, registration);
  return { template: localTemplate, source };
}

interface LoadedInpatientHisContext {
  registration: HisInpatientRegistrationInfo | null;
  orders: HisInpatientOrder[];
  temperatureChart: HisInpatientTemperatureChart | null;
  aiContext: HisInpatientEmrContextPackage;
  outpatientRecord?: HisOutpatientMedicalRecord | null;
}

function matchReferencePatient(record: HisOutpatientMedicalRecord | null, patientId?: string) {
  return record?.patientId && patientId && record.patientId !== patientId ? null : record;
}

async function fetchSelectedOutpatientRecord(
  adapter: ReturnType<typeof getHisAdapter>,
  visitId?: string,
  trace?: InpatientEmrGenerationTrace,
  patientId?: string,
): Promise<HisOutpatientMedicalRecord | null> {
  if (!visitId) {
    if (trace) {
      finishInpatientEmrTraceStage(trace, 'outpatientRecord', 'skipped', '未选择门诊就诊');
    }
    return null;
  }
  if (!adapter) {
    if (trace) {
      finishInpatientEmrTraceStage(trace, 'outpatientRecord', 'skipped', 'HIS 适配器未就绪，未拉取门诊正文', { visitId });
    }
    return null;
  }

  if (trace) {
    startInpatientEmrTraceStage(trace, 'outpatientRecord', '正在拉取门诊病历正文', { visitId });
  }
  try {
    const fetched = await adapter.fetchOutpatientMedicalRecord(visitId);
    const record = fetched?.visitId === visitId ? matchReferencePatient(fetched, patientId) : null;
    if (trace) {
      finishInpatientEmrTraceStage(
        trace,
        'outpatientRecord',
        record ? 'success' : 'skipped',
        record?.contentPending
          ? '已获取文书列表，正文暂不可用'
          : record
            ? `已获取门诊正文${record.plainText ? `，${record.plainText.length} 字` : ''}`
            : '未返回门诊病历正文',
        {
          visitId,
          documentId: record?.documentId,
          plainTextLength: record?.plainText?.length || 0,
          contentPending: Boolean(record?.contentPending),
        },
      );
    }
    return record;
  } catch (error) {
    console.warn('[InpatientEmr] Failed to fetch outpatient medical record', error);
    if (trace) {
      finishInpatientEmrTraceStage(
        trace,
        'outpatientRecord',
        'error',
        error instanceof Error ? error.message : String(error),
        { visitId },
      );
    }
    return null;
  }
}

function getArrayCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function truncateText(value: string | undefined, maxLength = 48): string {
  const text = (value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function buildEvidenceSummary(
  context: InpatientEmrContext,
  template: InpatientEmrTemplateParseResult,
  options: {
    aiStatus: InpatientEmrEvidenceSummary['aiGeneration']['status'];
    aiDetail: string;
    fallbackUsed?: boolean;
    waitingForInput?: boolean;
  },
): InpatientEmrEvidenceSummary {
  const aiContext = context.aiContext;
  const outpatientRecord = context.outpatientRecord;
  const doctorSupplement = context.doctorSupplement?.trim();
  const diagnosisCount = aiContext?.diagnoses?.length || 0;
  const orderCount = context.orders.length;
  const labCount = getArrayCount(aiContext?.labs?.abnormal) + getArrayCount(aiContext?.labs?.recentKeyResults);
  const examCount = getArrayCount(aiContext?.exams);
  const previousRecordCount = getArrayCount(aiContext?.previousRecords?.recentNotes);
  const vitalCount = context.temperatureChart?.records.length || 0;
  const outpatientHasContent = hasUsableOutpatientRecordReference(outpatientRecord);
  const outpatientTitle = outpatientRecord?.documentTitle || outpatientRecord?.documents?.[0]?.title;
  const aiFieldCount = template.fields.filter((field) => field.aiSuitable).length;

  return {
    hisContext: {
      title: '住院上下文',
      status: aiContext ? 'used' : 'missing',
      detail: aiContext
        ? [
            context.registration?.name ? `${context.registration.name}` : '已获取',
            diagnosisCount > 0 ? `诊断 ${diagnosisCount}` : '',
            orderCount > 0 ? `医嘱 ${orderCount}` : '',
            labCount > 0 ? `检验 ${labCount}` : '',
            examCount > 0 ? `检查 ${examCount}` : '',
            previousRecordCount > 0 ? `历史病历 ${previousRecordCount}` : '',
          ].filter(Boolean).join(' / ')
        : '未获取到住院聚合上下文',
      count: diagnosisCount + orderCount + labCount + examCount + previousRecordCount + vitalCount,
      meta: {
        diagnosisCount,
        orderCount,
        labCount,
        examCount,
        previousRecordCount,
        vitalCount,
      },
    },
    outpatientRecord: {
      title: '门诊病历',
      status: outpatientHasContent ? 'used' : outpatientRecord?.contentPending ? 'waiting' : 'skipped',
      detail: outpatientHasContent
        ? [
            outpatientTitle || '已引用正文',
            outpatientRecord?.plainText ? `正文 ${outpatientRecord.plainText.length} 字` : '',
          ].filter(Boolean).join(' / ')
        : outpatientRecord?.contentPending
          ? '已获取文书列表，正文暂不可用'
          : '未引用门诊正文',
      count: outpatientRecord?.plainText?.length,
      meta: {
        visitId: outpatientRecord?.visitId,
        documentId: outpatientRecord?.documentId,
        hasContent: outpatientHasContent,
        contentPending: Boolean(outpatientRecord?.contentPending),
      },
    },
    doctorSupplement: {
      title: '补充要点',
      status: doctorSupplement ? 'used' : 'missing',
      detail: doctorSupplement ? truncateText(doctorSupplement, 64) : '未输入补充要点',
      count: doctorSupplement?.length,
    },
    template: {
      title: '模板解析',
      status: template.fields.length > 0 ? 'used' : 'missing',
      detail: `${template.cacheHit ? '服务端缓存命中' : '本地/兜底解析'} / AI 字段 ${aiFieldCount} / 总字段 ${template.fields.length}`,
      count: template.fields.length,
      meta: {
        cacheHit: template.cacheHit,
        fieldCount: template.fields.length,
        aiFieldCount,
      },
    },
    aiGeneration: {
      title: 'AI 生成',
      status: options.aiStatus,
      detail: options.aiDetail,
      count: aiFieldCount,
      meta: {
        fallbackUsed: Boolean(options.fallbackUsed),
        waitingForInput: Boolean(options.waitingForInput),
      },
    },
  };
}

function buildClinicalSummaryProgressDetail(
  aiContext: HisInpatientEmrContextPackage,
  orders: HisInpatientOrder[],
): string {
  const labCount = getArrayCount(aiContext.labs?.abnormal) + getArrayCount(aiContext.labs?.recentKeyResults);
  const examCount = getArrayCount(aiContext.exams);
  return [
    `诊断 ${aiContext.diagnoses?.length || 0} 条`,
    `医嘱 ${orders.length} 条`,
    labCount > 0 ? `检验 ${labCount} 项` : '',
    examCount > 0 ? `检查 ${examCount} 项` : '',
  ].filter(Boolean).join(' / ') || '已整理诊疗摘要';
}

function buildEvidenceProgressDetail(
  aiContext: HisInpatientEmrContextPackage,
  temperatureChart: HisInpatientTemperatureChart | null,
): string {
  const previousRecordCount = getArrayCount(aiContext.previousRecords?.recentNotes);
  const consultationCount = getArrayCount(aiContext.consultations);
  const operations = (aiContext.operations || []) as unknown;
  const operationCount = Array.isArray(operations)
    ? operations.length
    : getArrayCount((operations as { applications?: unknown[] })?.applications);
  const vitalsText = aiContext.vitals?.summary
    ? '生命体征已整理'
    : `生命体征 ${temperatureChart?.records.length || 0} 条`;
  return [
    vitalsText,
    previousRecordCount > 0 ? `历史病历 ${previousRecordCount} 份` : '',
    consultationCount > 0 ? `会诊 ${consultationCount} 条` : '',
    operationCount > 0 ? `手术 ${operationCount} 条` : '',
  ].filter(Boolean).join(' / ') || '已整理病历依据';
}

function reportLoadedContextProgress(
  onProgress: InpatientEmrProgressHandler | undefined,
  aiContext: HisInpatientEmrContextPackage,
  registration: HisInpatientRegistrationInfo | null,
  orders: HisInpatientOrder[],
  temperatureChart: HisInpatientTemperatureChart | null,
  admissionId: string,
  sourceLabel: string,
): void {
  report(onProgress, {
    key: 'patient',
    status: 'done',
    detail: registration?.name
      ? `${sourceLabel}：${registration.name} / ${registration.inpatientNo || admissionId}`
      : `${sourceLabel}：已获取住院上下文`,
  });
  report(onProgress, { key: 'orders', status: 'running', detail: '正在整理诊断、医嘱、检验检查摘要' });
  report(onProgress, {
    key: 'orders',
    status: 'done',
    detail: buildClinicalSummaryProgressDetail(aiContext, orders),
  });
  report(onProgress, { key: 'temperature', status: 'running', detail: '正在整理生命体征、历史病历和会诊手术资料' });
  report(onProgress, {
    key: 'temperature',
    status: 'done',
    detail: buildEvidenceProgressDetail(aiContext, temperatureChart),
  });
}

async function loadInpatientEmrHisContext(
  request: InpatientEmrGenerationRequest,
  documentContext: InpatientEmrDocumentContext,
  trace: InpatientEmrGenerationTrace,
  onProgress?: InpatientEmrProgressHandler,
): Promise<LoadedInpatientHisContext> {
  const adapter = getHisAdapter();
  const query: HisInpatientQuery = { admissionId: request.admissionId };

  const requestContext = mergeDocumentContextIntoHisContext(request.hisContext, documentContext, request.admissionId);
  if (requestContext) {
    startInpatientEmrTraceStage(trace, 'hisContext', '使用入口已携带 HIS 上下文包');
    const outpatientRecord = await fetchSelectedOutpatientRecord(adapter, request.outpatientVisitId, trace, requestContext.patient?.patientId);
    const registration = buildRegistrationFromAiContext(requestContext, query);
    const orders = buildOrdersFromAiContext(requestContext);
    const temperatureChart = buildTemperatureChartFromAiContext(requestContext, query);
    finishInpatientEmrTraceStage(
      trace,
      'hisContext',
      'success',
      '已使用入口 HIS 上下文包',
      {
        source: 'request.hisContext',
        diagnosisCount: requestContext.diagnoses?.length || 0,
        orderCount: orders.length,
      },
    );
    report(onProgress, { key: 'patient', status: 'running', detail: '正在读取 HIS 住院上下文包' });
    reportLoadedContextProgress(
      onProgress,
      requestContext,
      registration,
      orders,
      temperatureChart,
      request.admissionId,
      '已使用 HIS 上下文包',
    );
    return {
      registration,
      orders,
      temperatureChart,
      aiContext: requestContext,
      outpatientRecord,
    };
  }

  if (!adapter) {
    finishInpatientEmrTraceStage(trace, 'hisContext', 'error', 'HIS 适配器未就绪');
    throw new Error('HIS 适配器未就绪，请先完成 SDK 握手后再生成住院病历');
  }

  // 并发拉取门诊病历（如果有 outpatientVisitId）
  const outpatientPromise = fetchSelectedOutpatientRecord(adapter, request.outpatientVisitId, trace);

  report(onProgress, { key: 'patient', status: 'running', detail: '正在获取 HIS 住院上下文' });
  startInpatientEmrTraceStage(trace, 'hisContext', '正在调用 HIS 聚合上下文服务', {
    admissionId: request.admissionId,
    templateId: request.templateId,
  });
  const [packageContext, outpatientRecord] = await Promise.all([
    adapter.fetchInpatientEmrContext({
      ...query,
      templateId: request.templateId,
      templateName: request.templateName,
      recordTime: documentContext.recordTime,
      recordDate: documentContext.recordDate,
      contextPolicy: request.contextPolicy,
    }).then((context) => {
      finishInpatientEmrTraceStage(
        trace,
        'hisContext',
        context ? 'success' : 'error',
        context ? 'HIS 聚合上下文已返回' : 'HIS 聚合服务未返回有效上下文',
        {
          admissionId: request.admissionId,
          diagnosisCount: context?.diagnoses?.length || 0,
          activeOrderCount: context?.orders?.active?.length || 0,
          previousRecordCount: context?.previousRecords?.recentNotes?.length || 0,
        },
      );
      return context;
    }).catch((error) => {
      finishInpatientEmrTraceStage(
        trace,
        'hisContext',
        'error',
        error instanceof Error ? error.message : String(error),
        { admissionId: request.admissionId },
      );
      throw error;
    }),
    outpatientPromise,
  ]);

  const aiContext = mergeDocumentContextIntoHisContext(packageContext || undefined, documentContext, request.admissionId);
  if (!aiContext) {
    throw new Error('HIS 聚合服务未返回有效住院病历上下文');
  }
  const registration = buildRegistrationFromAiContext(aiContext, query);
  const orders = buildOrdersFromAiContext(aiContext);
  const temperatureChart = buildTemperatureChartFromAiContext(aiContext, query);
  reportLoadedContextProgress(
    onProgress,
    aiContext,
    registration,
    orders,
    temperatureChart,
    request.admissionId,
    '患者信息',
  );
  return {
    registration,
    orders,
    temperatureChart,
    aiContext,
    outpatientRecord: matchReferencePatient(outpatientRecord, aiContext.patient?.patientId),
  };
}


function buildGenerationResult(
  request: InpatientEmrGenerationRequest,
  context: InpatientEmrContext,
  template: InpatientEmrTemplateParseResult,
  fieldValues: Record<string, string>,
  initialFieldValues: Record<string, string>,
  trace: InpatientEmrGenerationTrace,
  evidenceSummary: InpatientEmrEvidenceSummary,
): InpatientEmrGenerationResult {
  const htmlContent = fillInpatientEmrTemplateHtml(request.htmlContent, fieldValues);
  return {
    emrContent: buildGeneratedEmrText(template.fields, fieldValues),
    htmlContent,
    fieldValues,
    initialFieldValues,
    trace: cloneInpatientEmrTrace(trace),
    evidenceSummary,
    request,
    context,
    template,
    generatedAt: Date.now(),
  };
}

/**
 * 流式住院病历生成服务。
 * 解析病历后，先通过 onStreamResult 返回一个包含默认值的空白模板，然后流式读取 AI 生成的段落并同步推送到前端中。
 */
export async function generateInpatientEmrPreviewStream(
  request: InpatientEmrGenerationRequest,
  onProgress?: InpatientEmrProgressHandler,
  onStreamResult?: (partialResult: InpatientEmrGenerationResult) => void,
  activeTrace?: InpatientEmrGenerationTrace,
  doctorEdits?: Record<string, string>,
): Promise<InpatientEmrGenerationResult> {
  const trace = activeTrace || createInpatientEmrTrace(request.requestId);
  const documentContext = buildDocumentContext(request);
  const {
    registration,
    orders,
    temperatureChart,
    aiContext,
    outpatientRecord,
  } = await loadInpatientEmrHisContext(request, documentContext, trace, onProgress);

  report(onProgress, { key: 'template', status: 'running', detail: '正在解析病历模板字段' });
  startInpatientEmrTraceStage(trace, 'templateResolve', '正在解析模板字段', {
    templateId: request.templateId,
    templateName: request.templateName || '',
  });
  let template: InpatientEmrTemplateParseResult;
  let templateSource: string;
  try {
    const resolved = await resolveInpatientEmrTemplate(request, registration, onProgress);
    template = resolved.template;
    templateSource = resolved.source;
  } catch (error) {
    finishInpatientEmrTraceStage(
      trace,
      'templateResolve',
      'error',
      error instanceof Error ? error.message : String(error),
      {
        templateId: request.templateId,
        templateName: request.templateName || '',
      },
    );
    throw error;
  }
  finishInpatientEmrTraceStage(
    trace,
    'templateResolve',
    'success',
    `${templateSource}，字段 ${template.fields.length} 个`,
    {
      cacheHit: template.cacheHit,
      fieldCount: template.fields.length,
      aiFieldCount: template.fields.filter((field) => field.aiSuitable).length,
    },
  );
  report(onProgress, {
    key: 'template',
    status: 'done',
    detail: `${templateSource}，字段 ${template.fields.length} 个`,
  });

  const context: InpatientEmrContext = {
    documentContext,
    doctorEdits,
    doctorSupplement: request.doctorSupplement?.trim() || undefined,
    aiContext,
    registration,
    orders,
    temperatureChart,
    outpatientRecord,
  };

  // 1. 在 AI 生成前，先渲染出病历框架和基础信息，实现“秒开”预览模板的效果
  const initialFieldValues = buildDefaultFieldValues(template.fields, context);
  const initialEvidenceSummary = buildEvidenceSummary(context, template, {
    aiStatus: 'waiting',
    aiDetail: '等待 AI 生成',
  });
  const initialResult = buildGenerationResult(
    request,
    context,
    template,
    initialFieldValues,
    initialFieldValues,
    trace,
    initialEvidenceSummary,
  );
  onStreamResult?.(initialResult);

  // One signed streaming request owns this generation. A partial response is
  // never replayed or replaced with a non-streaming or local clinical draft.
  const aiFieldKeys = template.fields.filter((field) => field.aiSuitable).map((field) => field.id);
  let accumulatedResponse = '';
  let hasFirstToken = false;
  let requested = false;
  let callbackFailed = false;
  let callbackError: unknown;
  const publish = (snapshot: InpatientEmrGenerationResult): void => {
    try { onStreamResult?.(snapshot); }
    catch (error) { callbackFailed = true; callbackError = error; throw error; }
  };

  try {
    if (aiFieldKeys.length === 0) {
      throw new InpatientEmrTemplateConfigurationError('当前模板没有开启 AI 生成的字段，请先核对模板字段配置。');
    }
    report(onProgress, { key: 'generate', status: 'running', detail: '正在生成病历草稿' });
    startInpatientEmrTraceStage(trace, 'aiFirstToken', '等待 AI 首段返回');
    startInpatientEmrTraceStage(trace, 'aiGenerate', '正在流式生成病历草稿');
    const prompt = buildInpatientEmrGeneratePrompt(template.fields, context);
    requested = true;
    await chatStream(
      [
        { role: 'system', content: '你是住院病历辅助书写助手。请综合本次提供的资料，按模板字段 ID 返回 JSON 病历草稿。' },
        { role: 'user', content: prompt },
      ],
      (chunk) => {
        accumulatedResponse += chunk;
        if (!hasFirstToken && chunk) {
          hasFirstToken = true;
          finishInpatientEmrTraceStage(trace, 'aiFirstToken', 'success', 'AI 首段已返回', {
            firstChunkLength: chunk.length,
          });
        }
        const partialValues = readInpatientEmrFieldValues(accumulatedResponse, aiFieldKeys);
        const currentFieldValues = mergeGeneratedValues(template.fields, context, partialValues);
        publish(buildGenerationResult(
          request, context, template, currentFieldValues, currentFieldValues, trace,
          buildEvidenceSummary(context, template, { aiStatus: 'waiting', aiDetail: 'AI 正在生成草稿' }),
        ));
      },
      undefined,
      { ...DEFAULT_RETRY_CONFIG, maxRetries: 0 },
      undefined,
      {
        configProfile: 'fast',
        traceContext: {
          scene: 'inpatient-emr-generate', sourceModule: 'inpatient-emr',
          operationModule: 'inpatient-emr', operationAction: 'generate_record_stream',
          title: '住院病历流式辅助生成',
        },
      },
    );

    const generatedValues = readInpatientEmrFieldValues(accumulatedResponse, aiFieldKeys);
    const finalFieldValues = mergeGeneratedValues(template.fields, context, generatedValues);
    const detail = '已收到 AI 回复，请医生核对病历草稿';
    finishInpatientEmrTraceStage(trace, 'aiGenerate', 'success', detail, {
      responseLength: accumulatedResponse.length,
      generatedFieldCount: Object.values(generatedValues).filter(value => value.trim()).length,
    });
    finishInpatientEmrTrace(trace);
    const finalResult = buildGenerationResult(
      request, context, template, finalFieldValues, finalFieldValues, trace,
      buildEvidenceSummary(context, template, { aiStatus: 'used', aiDetail: detail }),
    );
    publish(finalResult);
    report(onProgress, { key: 'generate', status: 'done', detail });
    return finalResult;
  } catch (error) {
    // A consumer failure is not an upstream failure and must not trigger another
    // callback, another model request, or a fabricated successful result.
    if (callbackFailed) throw callbackError;
    const partialValues = readInpatientEmrFieldValues(accumulatedResponse, aiFieldKeys);
    const fieldValues = mergeGeneratedValues(template.fields, context, partialValues);
    const receivedFields = aiFieldKeys.filter(key => fieldValues[key]).length;
    // Only display transport metadata. Upstream error bodies can contain clinical text.
    const remote = error as { status?: number; requestId?: string } | null;
    const status = remote?.status;
    const http = typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
      ? `（HTTP ${status}）` : '';
    const requestId = typeof remote?.requestId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(remote.requestId)
      ? ` 请求 ID：${remote.requestId}` : '';
    const draft = receivedFields ? `已保留 ${receivedFields} 项草稿。` : '未收到可用字段正文。';
    const failure = error instanceof InpatientEmrTemplateConfigurationError
      ? error
      : new Error(`住院病历生成未完成，AI 请求失败${http}。${draft}请检查后台连接后重试。${requestId}`);
    if (!hasFirstToken) {
      finishInpatientEmrTraceStage(trace, 'aiFirstToken', requested ? 'error' : 'skipped',
        requested ? '未收到可用 AI 正文' : '尚未调用 AI');
    }
    finishInpatientEmrTraceStage(trace, 'aiGenerate', 'error', failure.message);
    finishInpatientEmrTrace(trace);
    publish(buildGenerationResult(
      request, context, template, fieldValues, fieldValues, trace,
      buildEvidenceSummary(context, template, { aiStatus: 'failed', aiDetail: failure.message }),
    ));
    report(onProgress, { key: 'generate', status: 'error', detail: failure.message });
    throw failure;
  }
}
