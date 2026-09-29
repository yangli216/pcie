export type UpdateEnvironment = 'production' | 'testing';
export type UpdateBuildFlavor = 'standard' | 'win7';
export type UpdateChannel = UpdateEnvironment | 'win7-production' | 'win7-testing';

const ACTIVE_BUILD_FLAVOR: UpdateBuildFlavor =
  import.meta.env.VITE_PCIE_BUILD_FLAVOR === 'win7' ? 'win7' : 'standard';
const CONFIGURED_PUBLIC_VERSION = String(import.meta.env.VITE_PCIE_RELEASE_VERSION || '').trim();
const WIN7_PUBLIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-win7(?:\.([1-9]\d*))?$/;
const WIN7_INTERNAL_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(0|[1-9]\d*)$/;

export interface UpdateConfig {
  environment: UpdateEnvironment;
  productionUrl: string;
  testingUrl: string;
}

export const DEFAULT_UPDATE_CONFIG: UpdateConfig = {
  environment: normalizeUpdateEnvironment(import.meta.env.VITE_UPDATE_ENVIRONMENT),
  productionUrl: ACTIVE_BUILD_FLAVOR === 'win7'
    ? import.meta.env.VITE_WIN7_UPDATE_PRODUCTION_URL || ''
    : import.meta.env.VITE_INTRANET_UPDATE_PRODUCTION_URL || '',
  testingUrl: ACTIVE_BUILD_FLAVOR === 'win7'
    ? import.meta.env.VITE_WIN7_UPDATE_TESTING_URL || ''
    : import.meta.env.VITE_INTRANET_UPDATE_TESTING_URL || '',
};

const STANDARD_STORAGE_KEYS = {
  environment: 'UPDATE_ENVIRONMENT',
  productionUrl: 'INTRANET_UPDATE_PRODUCTION_URL',
  testingUrl: 'INTRANET_UPDATE_TESTING_URL',
} as const;

const WIN7_STORAGE_KEYS = {
  environment: 'WIN7_UPDATE_ENVIRONMENT',
  productionUrl: 'WIN7_INTRANET_UPDATE_PRODUCTION_URL',
  testingUrl: 'WIN7_INTRANET_UPDATE_TESTING_URL',
} as const;

const STORAGE_KEYS = ACTIVE_BUILD_FLAVOR === 'win7' ? WIN7_STORAGE_KEYS : STANDARD_STORAGE_KEYS;

const REGIONAL_STORAGE_KEYS = {
  baseUrl: 'REGIONAL_BASE_URL',
} as const;

const DEFAULT_REGIONAL_BASE_URL = (
  import.meta.env.VITE_REGIONAL_BASE_URL
  || 'http://127.0.0.1:8080'
).trim().replace(/\/+$/, '');

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function readStorageValue(key: string): string | null {
  const raw = localStorage.getItem(key);
  if (raw == null) {
    return null;
  }
  const text = raw.trim();
  return text ? text : null;
}

export function normalizeUpdateEnvironment(value?: string | null): UpdateEnvironment {
  return value === 'testing' ? 'testing' : 'production';
}

export function resolveUpdateChannel(
  environment: UpdateEnvironment,
  flavor: UpdateBuildFlavor = ACTIVE_BUILD_FLAVOR,
): UpdateChannel {
  if (flavor === 'win7') {
    return environment === 'testing' ? 'win7-testing' : 'win7-production';
  }
  return environment;
}

export function isWin7UpdateBuild(): boolean {
  return ACTIVE_BUILD_FLAVOR === 'win7';
}

export function resolvePublicClientVersion(
  nativeVersion: string,
  flavor: UpdateBuildFlavor = ACTIVE_BUILD_FLAVOR,
  configuredPublicVersion: string = CONFIGURED_PUBLIC_VERSION,
): string {
  const native = String(nativeVersion || '').trim();
  if (flavor !== 'win7') {
    return native || 'unknown';
  }

  const internalMatch = WIN7_INTERNAL_VERSION_PATTERN.exec(native);
  if (!internalMatch) {
    return 'unknown';
  }
  const revision = Number(internalMatch[4]);
  if (revision > 65535) {
    return 'unknown';
  }
  const derivedPublicVersion = `${internalMatch[1]}.${internalMatch[2]}.${internalMatch[3]}-win7${revision === 0 ? '' : `.${revision}`}`;
  const configured = String(configuredPublicVersion || '').trim();
  if (!configured) {
    return derivedPublicVersion;
  }
  return WIN7_PUBLIC_VERSION_PATTERN.test(configured) && configured === derivedPublicVersion
    ? configured
    : 'unknown';
}

function buildRegionalReleaseEndpoint(channel: UpdateChannel): string {
  const baseUrl = normalizeUrl(readStorageValue(REGIONAL_STORAGE_KEYS.baseUrl) || DEFAULT_REGIONAL_BASE_URL);
  if (!baseUrl) {
    return '';
  }
  return `${baseUrl}/v1/client/releases/${channel}/latest.json`;
}

export function getUpdateConfig(): UpdateConfig {
  const storedEnvironment = localStorage.getItem(STORAGE_KEYS.environment);
  const environment = normalizeUpdateEnvironment(storedEnvironment || DEFAULT_UPDATE_CONFIG.environment);
  const regionalProductionUrl = buildRegionalReleaseEndpoint(resolveUpdateChannel('production'));
  const regionalTestingUrl = buildRegionalReleaseEndpoint(resolveUpdateChannel('testing'));

  return {
    environment,
    productionUrl: normalizeUrl(localStorage.getItem(STORAGE_KEYS.productionUrl) || DEFAULT_UPDATE_CONFIG.productionUrl || regionalProductionUrl),
    testingUrl: normalizeUrl(localStorage.getItem(STORAGE_KEYS.testingUrl) || DEFAULT_UPDATE_CONFIG.testingUrl || regionalTestingUrl),
  };
}

export function resetUpdateConfigToRegionalDefaults(): UpdateConfig {
  const config: UpdateConfig = {
    environment: getUpdateConfig().environment,
    productionUrl: buildRegionalReleaseEndpoint(resolveUpdateChannel('production')),
    testingUrl: buildRegionalReleaseEndpoint(resolveUpdateChannel('testing')),
  };
  saveUpdateConfig(config);
  return config;
}

export function saveUpdateConfig(config: UpdateConfig): void {
  localStorage.setItem(STORAGE_KEYS.environment, config.environment);
  localStorage.setItem(STORAGE_KEYS.productionUrl, normalizeUrl(config.productionUrl));
  localStorage.setItem(STORAGE_KEYS.testingUrl, normalizeUrl(config.testingUrl));
}

export function getActiveUpdateEndpoint(config: UpdateConfig = getUpdateConfig()): string {
  return config.environment === 'testing' ? config.testingUrl : config.productionUrl;
}

export function getActiveUpdateChannel(config: UpdateConfig = getUpdateConfig()): UpdateChannel {
  return resolveUpdateChannel(config.environment);
}

export function getActiveUpdatePolicyEndpoint(config: UpdateConfig = getUpdateConfig()): string {
  const endpoint = getActiveUpdateEndpoint(config);
  if (!endpoint) {
    return '';
  }
  if (/\/latest\.json(?:\?.*)?$/.test(endpoint)) {
    return endpoint.replace(/\/latest\.json(\?.*)?$/, '/policy.json$1');
  }
  return `${endpoint.replace(/\/+$/, '')}/policy.json`;
}

export function getUpdateEnvironmentLabel(environment: UpdateEnvironment | UpdateChannel): string {
  const channel = environment.startsWith('win7-')
    ? environment as UpdateChannel
    : resolveUpdateChannel(environment as UpdateEnvironment);
  if (channel === 'win7-testing') return 'Win7 测试内网';
  if (channel === 'win7-production') return 'Win7 正式内网';
  return channel === 'testing' ? '测试内网' : '正式内网';
}
