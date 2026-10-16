# 系统设置开机自启动验收

入口：系统设置 → 通用设置 → 启动设置 → 开机自启动。开关立即生效，与底部保存设置独立；首次安装不默认开启。

## 自动化验证（2026-10-16）

- `yarn type-check`、`yarn build` 通过。
- `yarn test:unit`：196 个测试文件、1222 项通过；新增 9 项覆盖系统状态读取、开启/关闭、并发互斥、读写失败与回读不一致、重试、浏览器禁用和界面失败回退。
- `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` 通过。
- `yarn test:win7-build`、`yarn test:release` 通过（52 项发布脚本测试）；Win7 独立锁文件保留原有版本，只加入自启动所需依赖，带原有补丁的 `cargo metadata --locked --offline` 验证通过。
- macOS 真实 Tauri `main` WebView 挂载生产 `AutostartSettings.vue`，使用生产 gateway 与 capability：初始系统状态为关闭 → 点击开启、回读为开启 → 点击关闭、回读为关闭，界面分别显示已开启/已关闭。测试结束恢复初始关闭状态。验证实际触发 `is_enabled / enable / disable`，未绕过 IPC 权限。

## 待实机验收

1. Windows 安装包中进入该入口，开启后核对当前用户启动项指向已安装客户端；退出并重新登录系统，确认仅启动一个客户端。关闭后重新登录应不再启动。
2. macOS 已安装 `.app` 执行相同步骤，核对 LaunchAgent 路径指向安装包，关闭后不再登录启动。本次开发态验证未执行注销/重启。
3. 在系统设置/任务管理器中手动更改启动项，重新进入通用设置应反映系统状态；模拟权限不足时应出现可重试错误，不显示成功。
4. Win7 SP1 x64 沿独立测试构建实机验证；本次未构建 MSI、未执行 Win7 登录启动冒烟。

## 本机依赖环境

初次类型检查发现本机 TypeScript 5.6.3 的 `lib/tsc.js` 与 Yarn 缓存副本均被截断（约 905 KB），导致 `vue-tsc` 报 `Failed to locate tsc module path from shim`。从同版本官方包恢复本机文件后检查通过；未修改 TypeScript 版本或仓库依赖约束。
