import { getActiveUpdateChannel } from '../updateConfig';
import {
  getCurrentClientVersion,
  isUpdateRequiredCode,
  notifyForceUpdateRequired,
} from '../updatePolicy';
import { signRequest, updateSignatureClockOffset, type SignatureHeaders } from '../requestSigner';
import { getDeviceCode } from './device';
import { getOrgCode, getRegionalBaseUrl } from './config';
import { createRegionalRequestError, parseRegionalError } from './errors';
import { restoreCachedDeviceRegistration } from './registrationCache';
import { fetchWithTimeout } from '@shared/lib/fetchTimeout';
import {
  clearDeviceRegistration,
  getDeviceToken,
  setRegionalInitialized,
} from './storage';
import type { ApiResponse } from './types';

type RegisterDeviceFn = (deviceTokenProof?: string) => Promise<unknown>;

let registerDeviceHandler: RegisterDeviceFn | null = null;

const REGIONAL_CONTROL_TIMEOUT_MS = 15_000;
const REGIONAL_DEFAULT_TIMEOUT_MS = 30_000;
const REGIONAL_KNOWLEDGE_TIMEOUT_MS = 60_000;
const REGIONAL_AI_TIMEOUT_MS = 180_000;
const REGIONAL_SPEECH_TIMEOUT_MS = 120_000;

export function setRegisterDeviceHandler(handler: RegisterDeviceFn): void {
  registerDeviceHandler = handler;
}

async function ensureRegisteredDevice(): Promise<void> {
  if (!registerDeviceHandler) {
    throw new Error('区域化注册服务未初始化');
  }
  await registerDeviceHandler();
}

async function refreshRegisteredDevice(deviceTokenProof: string): Promise<void> {
  if (!registerDeviceHandler) {
    throw new Error('区域化注册服务未初始化');
  }
  await registerDeviceHandler(deviceTokenProof);
}

function resolveRegionalRequestTimeout(path: string): number {
  if (path.startsWith('/v1/ai/chat')) {
    return REGIONAL_AI_TIMEOUT_MS;
  }
  if (path.startsWith('/v1/ai/speech')) {
    return REGIONAL_SPEECH_TIMEOUT_MS;
  }
  if (path.startsWith('/v1/knowledge/')) {
    return REGIONAL_KNOWLEDGE_TIMEOUT_MS;
  }
  if (
    path === '/v1/client/register'
    || path === '/v1/client/bootstrap'
    || path === '/v1/client/heartbeat'
  ) {
    return REGIONAL_CONTROL_TIMEOUT_MS;
  }
  return REGIONAL_DEFAULT_TIMEOUT_MS;
}

function checkDeadline(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason || new Error('后台请求超时');
}

export async function regionalFetch<T>(
  path: string,
  options: RequestInit = {},
  allowAuthRetry = true,
  allowClockRetry = true,
  deadline?: AbortSignal,
): Promise<T> {
  checkDeadline(deadline);
  const baseUrl = getRegionalBaseUrl();
  if (!baseUrl) throw new Error('区域化服务地址未配置');

  const deviceCode = await getDeviceCode();

  checkDeadline(deadline);
  let token = getDeviceToken();
  if (!token && path !== '/v1/client/register') {
    await restoreCachedDeviceRegistration(deviceCode);
    token = getDeviceToken();
    checkDeadline(deadline);
  }
  if (!token && path !== '/v1/client/register') {
    await ensureRegisteredDevice();
    token = getDeviceToken();
  }
  checkDeadline(deadline);
  const clientVersion = await getCurrentClientVersion();
  const updateChannel = getActiveUpdateChannel();
  const requestId = crypto.randomUUID();

  let signatureHeaders: SignatureHeaders = {} as SignatureHeaders;
  if (path !== '/v1/client/register') {
    const body = options.body ? String(options.body) : undefined;
    signatureHeaders = await signRequest(options.method || 'GET', path, body);
  }

  checkDeadline(deadline);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant-Id': getOrgCode(),
    'X-Request-Id': requestId,
    'X-Client-Version': clientVersion,
    'X-Update-Channel': updateChannel,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...signatureHeaders,
    ...(options.headers as Record<string, string> || {}),
  };

  let res: Response;
  try {
    const timeoutMs = resolveRegionalRequestTimeout(path);
    res = await fetchWithTimeout(
      `${baseUrl}${path}`,
      {
        ...options,
        headers,
        ...(deadline && { signal: deadline }),
      },
      {
        // The POST deadline owns this signal through body consumption as well as headers.
        timeoutMs: deadline ? 0 : timeoutMs,
        timeoutMessage: `区域化服务请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查后台服务地址和网络后重试`,
      }
    );
  } catch (error) {
    throw createRegionalRequestError(
      { message: error instanceof Error ? error.message : String(error) },
      '区域化服务暂时无法连接，请检查后台服务地址和网络后重试',
      undefined,
      requestId
    );
  }

  checkDeadline(deadline);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    checkDeadline(deadline);
    const errorInfo = parseRegionalError(text, `区域化服务请求失败（${res.status}）`);
    if (
      res.status === 401
      && errorInfo.code === 'SIG-401'
      && allowClockRetry
      && path !== '/v1/client/register'
      && updateSignatureClockOffset(errorInfo.timestamp)
    ) {
      return regionalFetch<T>(path, options, allowAuthRetry, false, deadline);
    }
    if (
      res.status === 401
      && errorInfo.code === 'SIG-401'
      && allowAuthRetry
      && path !== '/v1/client/register'
      && token
    ) {
      setRegionalInitialized(false);
      await refreshRegisteredDevice(token);
      return regionalFetch<T>(path, options, false, allowClockRetry, deadline);
    }
    if (res.status === 401 && allowAuthRetry && path !== '/v1/client/register') {
      clearDeviceRegistration();
      setRegionalInitialized(false);
      await ensureRegisteredDevice();
      return regionalFetch<T>(path, options, false, allowClockRetry, deadline);
    }
    if (res.status === 426 || isUpdateRequiredCode(errorInfo.code)) {
      notifyForceUpdateRequired({
        channel: updateChannel,
        currentVersion: clientVersion,
        message: errorInfo.message,
      });
    }
    throw createRegionalRequestError(errorInfo, `区域化服务请求失败（${res.status}）`, res.status, requestId);
  }

  let body: ApiResponse<T>;
  try {
    body = await res.json();
  } catch (error) {
    throw createRegionalRequestError(
      { message: error instanceof Error ? error.message : String(error) },
      '区域化服务返回内容格式异常',
      res.status,
      requestId
    );
  }
  checkDeadline(deadline);
  updateSignatureClockOffset(body.timestamp);
  if (body.code !== '0') {
    if (isUpdateRequiredCode(body.code)) {
      notifyForceUpdateRequired({
        channel: updateChannel,
        currentVersion: clientVersion,
        message: body.message,
      });
    }
    throw createRegionalRequestError(
      {
        code: body.code,
        message: body.message || '区域化服务返回异常',
        requestId: body.requestId,
      },
      '区域化服务返回异常',
      res.status,
      requestId
    );
  }
  return body.data;
}

export async function regionalGet<T>(path: string): Promise<T> {
  return regionalFetch<T>(path);
}

export async function regionalPost<T>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
  const options = { method: 'POST', body: JSON.stringify(body) };
  if (timeoutMs === undefined) return regionalFetch<T>(path, options);

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`后台请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒），请检查连接后重试`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  try {
    // Native device lookup/signing may not observe an abort. Settle the caller
    // on time and check the signal before any subsequent network attempt.
    return await Promise.race([regionalFetch<T>(path, options, true, true, controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
