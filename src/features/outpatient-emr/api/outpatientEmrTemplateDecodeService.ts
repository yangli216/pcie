import { regionalPost } from '@/services/regionalClient';
import { OutpatientEmrError } from '../lib/outpatientEmrTemplate';
import type { OutpatientEmrAnalysisRequest } from '../types';

export type OutpatientEmrTemplateSource = Pick<OutpatientEmrAnalysisRequest, 'templateHtml' | 'templateDefinition'>;

const HTML_PREFIX = 'data:text/html;charset=utf-8;base64,';
const DEFINITION_PREFIX = 'data:application/json;charset=utf-8;base64,';
const RESPONSE_KEYS = ['schemaVersion', 'templateHtml', 'templateDefinition'];

function isDataUri(value: string): boolean {
  return /^\s*data:/iu.test(value);
}

function abortError(): Error {
  const error = new Error('门诊模板解码已取消。');
  error.name = 'AbortError';
  return error;
}

async function waitForDecode(task: Promise<unknown>, signal?: AbortSignal): Promise<unknown> {
  if (!signal) return task;
  if (signal.aborted) throw abortError();
  let rejectAbort: ((error: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort?.(abortError());
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([task, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Encoded sources are decoded only by the signed PCIE Server endpoint. */
export async function normalizeOutpatientEmrTemplateSource<T extends OutpatientEmrTemplateSource>(
  request: T,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw abortError();
  if (!isDataUri(request.templateHtml) && !isDataUri(request.templateDefinition)) return request;
  if (
    !request.templateHtml.startsWith(HTML_PREFIX)
    || request.templateHtml.length === HTML_PREFIX.length
    || !request.templateDefinition.startsWith(DEFINITION_PREFIX)
    || request.templateDefinition.length === DEFINITION_PREFIX.length
  ) {
    throw new OutpatientEmrError(
      'TEMPLATE_PAIR_MISMATCH',
      '编码模板必须成对使用规定的 HTML 与 JSON Base64 data URI。',
    );
  }

  const decoded = await waitForDecode(regionalPost<unknown>(
    '/v1/client/outpatient-emr/templates/decode',
    {
      schemaVersion: 'outpatient-emr-template-decode.v1',
      templateHtml: request.templateHtml,
      templateDefinition: request.templateDefinition,
    },
  ), signal);
  if (signal?.aborted) throw abortError();
  const source = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
    ? decoded as Record<string, unknown> : null;
  if (
    !source
    || Object.keys(source).length !== RESPONSE_KEYS.length
    || !RESPONSE_KEYS.every((key) => Object.prototype.hasOwnProperty.call(source, key))
    || source.schemaVersion !== 'outpatient-emr-template-decoded.v1'
    || typeof source.templateHtml !== 'string'
    || !source.templateHtml.trim()
    || isDataUri(source.templateHtml)
    || !source.templateHtml.trimStart().startsWith('<')
    || !/<\/?[a-z][^>]*>/iu.test(source.templateHtml)
    || typeof source.templateDefinition !== 'string'
    || !source.templateDefinition.trim()
    || isDataUri(source.templateDefinition)
    || !source.templateDefinition.trimStart().startsWith('[')
  ) {
    throw new OutpatientEmrError('INVALID_TEMPLATE_JSON', 'PCIE Server 返回的门诊模板解码原文不符合协议。');
  }

  return {
    ...request,
    templateHtml: source.templateHtml,
    templateDefinition: source.templateDefinition,
  };
}
