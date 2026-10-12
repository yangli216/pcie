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

export async function regionalRequestResponse(
  path: string,
  options: RequestInit = {},
  responseOptions: { timeoutMs?: number } = {},
  allowAuthRetry = true,
  allowClockRetry = true
): Promise<{ response: Response; requestId: string }> {
  const baseUrl = getRegionalBaseUrl();
  if (!baseUrl) throw new Error('区域化服务地址未配置');

  const deviceCode = await getDeviceCode();

  let token = getDeviceToken();
  if (!token && path !== '/v1/client/register') {
    await restoreCachedDeviceRegistration(deviceCode);
    token = getDeviceToken();
  }
  if (!token && path !== '/v1/client/register') {
    await ensureRegisteredDevice();
    token = getDeviceToken();
  }
  const clientVersion = await getCurrentClientVersion();
  const updateChannel = getActiveUpdateChannel();
  const requestId = crypto.randomUUID();

  let signatureHeaders: SignatureHeaders = {} as SignatureHeaders;
  if (path !== '/v1/client/register') {
    const body = options.body ? String(options.body) : undefined;
    signatureHeaders = await signRequest(options.method || 'GET', path, body);
  }

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
    const timeoutMs = responseOptions.timeoutMs ?? resolveRegionalRequestTimeout(path);
    res = await fetchWithTimeout(
      `${baseUrl}${path}`,
      {
        ...options,
        headers,
      },
      {
        timeoutMs,
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

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const errorInfo = parseRegionalError(text, `区域化服务请求失败（${res.status}）`);
    if (
      res.status === 401
      && errorInfo.code === 'SIG-401'
      && allowClockRetry
      && path !== '/v1/client/register'
      && updateSignatureClockOffset(errorInfo.timestamp)
    ) {
      return regionalRequestResponse(path, options, responseOptions, allowAuthRetry, false);
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
      return regionalRequestResponse(path, options, responseOptions, false, allowClockRetry);
    }
    if (res.status === 401 && allowAuthRetry && path !== '/v1/client/register') {
      clearDeviceRegistration();
      setRegionalInitialized(false);
      await ensureRegisteredDevice();
      return regionalRequestResponse(path, options, responseOptions, false, allowClockRetry);
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

  return { response: res, requestId };
}

export async function regionalFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { response: res, requestId } = await regionalRequestResponse(path, options);
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
  updateSignatureClockOffset(body.timestamp);
  if (body.code !== '0') {
    if (isUpdateRequiredCode(body.code)) {
      notifyForceUpdateRequired({
        channel: getActiveUpdateChannel(),
        currentVersion: await getCurrentClientVersion(),
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

export async function regionalPost<T>(path: string, body: unknown): Promise<T> {
  return regionalFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
