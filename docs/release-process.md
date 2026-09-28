# PCIE 测试构建与正式发布流程

## 目标

将“生成可安装测试包”和“提升正式版本、打 tag、发布更新”彻底分开。候选包用于功能验收，不占用正式版本记录和更新通道；只有验收通过的候选版本才能进入正式发布。

## 测试构建

当前正式版本为 `X.Y.Z` 时，默认补丁候选可直接执行：

```bash
yarn release:test
```

也可以明确指定准备验收的稳定版本：

```bash
yarn release:test 1.4.4
```

该命令会临时把 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml` 设为候选版本，执行当前平台的 Tauri 构建，并在成功或失败后恢复全部原文件。它不会提交文件、创建 tag、GitHub Release、draft 或 `latest.json`。本机未配置 updater 私钥时，只生成可直接安装的测试包并临时关闭 updater artifact；GitHub `Test Build` 使用发布环境中的私钥生成带签名的候选包。

需要 Windows 与 macOS 双平台测试包时，在 GitHub Actions 手动运行 `Test Build`：

1. 在运行工作流时选择需要验收的分支或 commit。
2. 输入候选稳定版本号，例如 `1.4.4`。
3. 工作流先执行类型检查、单元测试、前端构建和 Rust 检查，再分别生成签名的 Windows 与 macOS 测试包；上传前会检查目标目录中确实存在安装包，只有来源清单时必须失败。
4. 从该次工作流的 Artifacts 下载测试包；这些文件不会出现在 GitHub Releases，也不会被客户端自动更新发现。

测试包采用候选正式版本号，因此安装过候选包的测试机器不会把后续同版本正式包识别成更高版本。正式 updater 冒烟应另用仍停留在历史正式版本的环境执行。

## 正式发布

功能验收通过、改动已合入 `main` 且工作区干净后，使用与测试包相同的版本：

```bash
yarn release 1.4.4
```

正式命令会核对当前分支、工作区、三处基线版本和 tag 唯一性，然后固化版本号、执行 release preflight、创建 release commit 与本地 tag。确认无误后推送：

```bash
git push origin main
git push origin v1.4.4
```

tag 推送后才会触发正式 Release 工作流。该工作流继续以 draft 汇聚各平台产物，验证同批安装包、签名和 `latest.json` 后再发布为 latest。

## Windows 7 独立验证与发布构建

Windows 7 不属于普通 Windows 正式客户端支持范围。为仍在使用 Windows 7 SP1 x64 的院内环境提供受控过渡，仓库在同一 `main` 源码上维护独立的 `src-tauri/tauri.win7.conf.json` 构建 flavor，并把“技术验证”与“可发布更新包”分成两条工作流；不维护长期业务分支。

### 技术验证

1. `Win7 Legacy Test Build` 只允许手动触发，只生成 GitHub Actions Artifact，不创建 tag、Release、draft、`.sig` 或 `latest.json`，也不上传任何更新源。候选版本必须使用 `X.Y.Z-win7` 或 `X.Y.Z-win7.N`，其中基础 `X.Y.Z` 与所选源码 commit 的三处稳定版本一致；例如普通源码为 `1.4.8` 时，首次 Win7 候选为 `1.4.8-win7`，后续热修为 `1.4.8-win7.1`、`1.4.8-win7.2`。
2. 构建使用固定 nightly 工具链、`x86_64-win7-windows-msvc` Tier 3 目标和 `build-std`，不得复用普通正式构建的 `stable-x86_64-pc-windows-msvc` 产物。该 Tier 3 target 不在 `rustup target list` 的可下载组件中，工作流只在调用 Tauri CLI 时临时隐藏 `rustup.exe` 以跳过其 target 预检，并在 `finally` 中恢复；Cargo 和 rustc 仍必须使用固定 nightly 与 `rust-src`。当前 `tauri-utils 2.9.3` 的旧 `ctor 0.8` 不识别 `target_vendor = win7`，Win7 专用 Cargo runner 仅在该 flavor 内将 `tauri-utils` 固定到上游修复提交 `8a97d387a3a1a52f7c501762517e294d8c94e119`；普通构建继续使用原 Cargo.lock。
3. Win7 包设置 `webviewInstallMode = skip`，CI 不下载、不安装也不内嵌 WebView2。验证人员必须在 Windows 7 SP1 x64 实机上另行安装 WebView2 109，并在冒烟记录中写明实际版本。
4. Win7 flavor 使用独立 `identifier`、WiX `UpgradeCode` 和 Tauri 默认 WiX 模板，不继承普通正式模板中的历史安装线迁移规则；验证配置继续关闭 updater artifact 与运行时 updater，禁止把候选 Artifact 误传到发布中心。由于仍需保留历史 `med-hermes` HIS 深链，Win7 包不得与普通正式客户端安装在同一台机器。
5. 候选包必须记录版本、源 commit/ref、Rust 工具链、Rust target 和要求的外置 WebView2 版本。Artifact 名称必须包含 `win7-legacy`，不得描述为已发布版本。
6. WebView2 在 Windows 7 上不支持透明默认背景，Win7 flavor 必须通过 `win7-legacy` Cargo feature 启用原生窗口 region 裁剪：待机仅保留中心球，菜单展开时保留中心球与四个菜单圆，进入工作态或任何几何变更前先恢复完整矩形 region。实机必须回归启动白底、菜单展开/收起、四个按钮点击、拖拽、球态↔工作态及混合 DPI。
7. Actions 构建成功只证明安装包可生成；完成技术验证还必须在真实 Windows 7 SP1 x64 环境执行安装、进程启动、首屏渲染、本地 Bridge 健康检查、SDK handshake 和卸载手测。WebView2 109 不支持 `color-mix()` 等较新 Web 能力，关键页面还需检查样式 fallback。

### 独立发布通道

验证通过后，可手动运行 `Win7 Legacy Release Build` 生成供 PCIE Server 后台上传的签名更新包：

1. 源 commit 必须位于 `main`，版本只在 CI 构建期间临时注入，不提交三处版本、不创建 tag、GitHub Release、draft 或普通 Windows `latest.json`。发布版本必须为与源码稳定版本同基线的 `X.Y.Z-win7[.N]`；Win7 热修只递增末尾修订号，不占用普通客户端的下一个稳定版本。
2. 发布通道固定为 `win7-testing` 或 `win7-production`。两条通道拥有独立的 `latest.json`、`policy.json`、历史快照和回滚状态，不得上传到 `testing` / `production`。
3. CI 使用 `WIN7_TAURI_SIGNING_PRIVATE_KEY`、`WIN7_TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 和 `WIN7_TAURI_UPDATER_PUBLIC_KEY` 生成临时 release config；公私钥必须独立于普通正式客户端。仓库中的验证 config 仍保持 updater 关闭，避免本地误构建可发布包。Windows 构建完成后，独立 Linux job 必须重新下载 Artifact 并用 minisign 对 updater archive 做完整公钥验签。
4. Win7 updater 默认 target 与普通 Windows 一样是 `windows-x86_64`，隔离依赖的是独立通道，不得把两个安装包合并进同一份 `latest.json`。
5. GitHub 托管 Runner 不访问内网更新服务器。触发工作流时必须显式填写目标通道当前版本 `previous_version`（首次发布可填写已确认的旧稳定 Win7 验证基线，之后必须填写当前 `X.Y.Z-win7[.N]`），CI 只用它和源码版本执行离线递增预检；`WIN7_UPDATE_SERVER_BASE_URL` 只用于写入 `latest.json` 下载地址，不在构建期发起网络请求。每次构建必须记录源 commit/ref、Win7 SemVer、前置版本、Rust 工具链、Rust target、外置 WebView2 109、发布通道、安全责任人和支持截止日期。
6. CI 只生成签名发布包 Artifact；真正发布由管理员在 PCIE Server“版本发布”中把同一份 `latest.json` 与签名 updater archive（Windows 为 `*.msi.zip`）上传到对应 Win7 通道。服务端以该通道全部历史快照中的最高版本执行最终单调递增校验：只有与当前版本相同的补传，或严格高于历史最高版本的新发布可以进入；降级和恢复旧版本只能走显式回滚入口。原始 `*.msi` 位于 Artifact 的 `direct-install` 目录，只用于首次安装或人工恢复，不得代替 `latest.json` 指向的签名 updater archive。上传前必须复核通道、版本、文件名和签名来自同一次构建。
7. `win7-production` 首次发布及每次 updater 变更都必须完成 Windows 7 SP1 x64 的 `N -> N+1` 实机冒烟，覆盖签名校验、下载安装、重启、应用数据保留、Bridge/SDK、失败后的人工恢复；外置 WebView2 109 不随客户端更新。
8. 已安装的 1.4.5 及更早 Win7 验证包编译时关闭了 updater，不能自行发现首个 Win7 发布版本。首次迁移必须用更高版本的 `direct-install/*.msi` 手工覆盖安装；该 updater-enabled 引导版本安装成功后，下一版本才允许作为首次应用内更新冒烟基线。

Win7 独立发布线是有限期兼容分发，不等于承诺 Windows 7 正式支持。安全责任人与支持截止日期未明确、独立签名密钥未配置或实机升级冒烟未完成时，只允许使用 Artifact-only 技术验证流程。

## 边界

- 测试构建允许来自待验收分支；正式发布只能来自 `main`。
- 测试构建不进入 `production` 或 `testing` updater 通道；“测试更新源”仍属于后台管理的已发布更新通道，不等于 Actions 测试产物。
- 普通候选版本必须高于仓库当前三处一致的版本，且使用稳定 `X.Y.Z` 格式；Win7 候选不与普通版本比较高低，只允许与源码基线一致的 `X.Y.Z-win7[.N]`，并在独立 Win7 通道内单调递增。
- 正式发布不得换用未经该轮验收的新版本号，也不得复用已有 tag、draft 或历史更新清单。
- Win7 legacy 验证 Artifact 不得进入任何更新源；签名发布包只允许进入 `win7-testing` / `win7-production`，不得进入普通客户端 updater 兼容链。
