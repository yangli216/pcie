import type { ClientOptions } from '@tauri-apps/plugin-http';

/**
 * HIS 请求固定直连，不使用操作系统代理。
 *
 * Tauri HTTP 插件底层的 reqwest 会自动读取 macOS 系统代理，但不遵循系统代理的例外列表，
 * 导致经 VPN / 内网可达的 HIS 被本机代理（如 Clash）接管并返回 502。
 *
 * reqwest 只要配置了显式代理就不再读取系统代理；这里给一个永远不会被使用的占位代理，
 * 再用 noProxy 覆盖所有域名（`*`）与所有 IPv4/IPv6 地址（`*` 不匹配 IP 字面量），
 * 从而让每个 HIS 请求都直接连接目标地址。
 */
export const HIS_DIRECT_CONNECTION_OPTIONS: Pick<ClientOptions, 'proxy'> = Object.freeze({
  proxy: {
    all: {
      url: 'http://127.0.0.1:9',
      noProxy: '*,0.0.0.0/0,::/0',
    },
  },
});
