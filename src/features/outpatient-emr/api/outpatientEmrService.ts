import { parseLLMJson } from '@features/clinical-result';
import { chatFast, type ChatMessage } from '@/services/llm';
import { OutpatientEmrError } from '../lib/outpatientEmrTemplate';
import { normalizeOutpatientEmrModelValues } from '../lib/outpatientEmrWriteback';
import {
  buildOutpatientEmrPromptMessages,
  OUTPATIENT_EMR_PROMPT_VERSION,
} from '../lib/outpatientEmrPromptGenerator';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrTemplateField,
} from '../types';

export type OutpatientEmrChatFast = typeof chatFast;

export interface OutpatientEmrAnalysisApiDependencies {
  chatFast?: OutpatientEmrChatFast;
  parseJson?: typeof parseLLMJson;
}

function hasNonEmptyFact(value: unknown, visited: Set<object>): boolean {
  if (typeof value === 'string') return Boolean(value.trim());
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (!value || typeof value !== 'object') return false;
  if (visited.has(value)) return false;
  visited.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasNonEmptyFact(item, visited));
  }
  return Object.values(value).some((item) => hasNonEmptyFact(item, visited));
}

export function validateOutpatientEmrRecordContext(recordContext: Record<string, unknown>): void {
  if (!hasNonEmptyFact(recordContext, new Set<object>())) {
    throw new OutpatientEmrError(
      'INVALID_RECORD_CONTEXT',
      '门诊病历上下文至少需要包含一项非空临床事实。',
    );
  }
}

export function buildOutpatientEmrAnalysisMessages(input: {
  request: OutpatientEmrAnalysisRequest;
  fields: OutpatientEmrTemplateField[];
}): ChatMessage[] {
  validateOutpatientEmrRecordContext(input.request.recordContext);
  return buildOutpatientEmrPromptMessages(input);
}

function createAbortError(): Error {
  const error = new Error('门诊病历分析已取消。');
  error.name = 'AbortError';
  return error;
}

async function waitForChatFast(
  task: Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  if (!signal) return task;
  if (signal.aborted) throw createAbortError();

  let rejectAbort: ((reason?: unknown) => void) | null = null;
  const abortTask = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () => rejectAbort?.(createAbortError());
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([task, abortTask]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

export async function analyzeOutpatientEmrFields(
  input: {
    request: OutpatientEmrAnalysisRequest;
    fields: OutpatientEmrTemplateField[];
    signal?: AbortSignal;
  },
  dependencies: OutpatientEmrAnalysisApiDependencies = {},
): Promise<Record<string, string>> {
  const messages = buildOutpatientEmrAnalysisMessages(input);
  if (input.signal?.aborted) throw createAbortError();

  const requestChatFast = dependencies.chatFast || chatFast;
  const rawOutput = await waitForChatFast(
    requestChatFast(messages, undefined, undefined, undefined, {
      traceContext: {
        consultationId: input.request.visitId,
        scene: 'outpatient-emr-analysis',
        sourceModule: 'outpatient-emr',
        operationModule: 'outpatient-emr',
        operationAction: `analyze-template-fields:${OUTPATIENT_EMR_PROMPT_VERSION}`,
        title: '门诊病历模板分析',
      },
    }),
    input.signal,
  );
  if (input.signal?.aborted) throw createAbortError();

  const parseJson = dependencies.parseJson || parseLLMJson;
  const parsed = parseJson<unknown>(rawOutput);
  return normalizeOutpatientEmrModelValues(parsed, input.fields);
}
