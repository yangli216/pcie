# 架构文档 (ARCHITECTURE.md)

> **最后更新**: 2026-08-04
>
> **重要**: 此文档是项目架构的唯一真实来源。任何架构级别的代码修改都必须同步更新此文档。

## 目录

- [概述](#概述)
- [架构图索引](#架构图索引)
- [复用架构准则](#复用架构准则)
- [核心架构](#核心架构)
- [用户体系 (Auth)](#用户体系-auth)
- [应用入口 (App.vue)](#应用入口-appvue)
- [组合式函数 (Composables)](#组合式函数-composables)
- [组件 (Components)](#组件-components)
- [常量 (Constants)](#常量-constants)
- [样式模块 (Styles)](#样式模块-styles)
- [服务 (Services)](#服务-services)
- [数据流](#数据流)
- [维护指南](#维护指南)
- [重构历史](#重构历史)

---

## 架构图索引

架构图以本文档记录的当前真实运行形态为基线，Mermaid 源文件与 SVG 预览统一维护在 [docs/architecture](docs/architecture/README.md)：

1. [总体架构图](docs/architecture/overall-architecture.png)：系统边界、参与者、桌面端、服务端与外部依赖。
2. [业务架构图](docs/architecture/business-architecture.png)：接诊、辅助决策、医生审核、HIS 回写和运营治理闭环。
3. [技术架构图](docs/architecture/technical-architecture.png)：Vue/Tauri 桌面端、签名通信、Spring Boot 服务端、数据层与第三方上游。

---

## 概述

全医慧助（PCIE，Primary Care Intelligent Expert）是一个 Tauri 2.0 + Vue 3 桌面应用，采用**组合式架构 (Composition Architecture)** 模式。运行时由本地桌面 UI、Rust Bridge 与唯一远程业务后端 `PCIE Server` 共同组成：

- **UI 层**: Vue 组件负责渲染和用户交互
- **逻辑层**: Composables 封装可复用的业务逻辑
- **状态层**: Vue Composition API `ref/reactive` + Pinia（用于跨组件共享配置状态）
- **数据层**: Services 负责外部通信；AI、语音、知识库、配置与审计固定经 `PCIE Server`，HIS/SDK 使用桌面端本地 Bridge

补充说明：

1. 当前真实运行契约以 `src-tauri/src/http_server.rs` + `api.md` 为准。
2. 桌面端已取消“本地/区域”双模式；远端 `/v1/*` 契约以 `PCIE Server/API.md`、真实调用代码和签名实现为准。
3. 本地 `/api/*` 只承担 HIS/SDK 桥接和结果事件；`/api/consultation/events/ws` 是唯一结果通道，不提供 HTTP 长轮询兜底。
4. 正式产品与仓库名称为“全医慧助（PCIE）”与 `pcie`；历史 `MedHermes` / `med-hermes` 只在 SDK 全局对象、SDK 文件路径、深链 scheme、HTTP Header 和 Bundle Identifier 等已发布兼容契约中保留。品牌文案与兼容标识必须分层维护，不能用全局替换迁移。

### 设计原则

1. **单一职责 (SRP)**: 每个模块只做一件事
2. **关注点分离**: UI、逻辑、状态分离
3. **组合优于继承**: 通过 Composables 组合功能
4. **状态本地化**: 优先使用组件内状态，仅在必要时使用全局状态
5. **渐进式状态管理**: 优先局部 `ref/reactive`，跨模块共享状态使用 Pinia

### 架构特点

- ✅ **轻量级**: 以 `ref/reactive` 为主，仅在必要场景使用 Pinia
- ✅ **模块化**: 代码按职责分离到独立文件
- ✅ **可测试**: Composables 可独立测试
- ✅ **高性能**: 缓存优化、防抖、GPU 加速动画
- ✅ **可维护**: 清晰的代码结构，易于理解和修改

---

## 复用架构准则

前端复用治理以 [docs/frontend-reuse-architecture.md](docs/frontend-reuse-architecture.md) 为准，文件迁移路线图见 [docs/frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md)。两者关系是：

1. `frontend-reuse-architecture.md` 回答“哪些能力值得复用、用什么模式复用、什么时候不该继续拆”。
2. `frontend-file-structure-plan.md` 回答“稳定能力最终放在哪个路径、旧路径如何迁移”。

当前治理立场：

1. 不再把“拆出更多文件”视为单独成果；每次重构必须沉淀为 Adapter、Builder、Strategy、Composable Controller、Headless UI 或明确 feature/domain 能力之一。
2. 语音问诊、智能问诊与复诊配药共享的结果页能力优先沉淀在 `features/clinical-result` 与 `features/consultation-result`。`features/clinical-result` 定义 `ClinicalResultInput / ClinicalResultChannel` 等中性契约，`features/consultation-result` 的 `ConsultationResultPage` 是 App 和业务 feature 唯一允许消费的结果页公开入口；根级 `VoiceConsultationNew.vue` 当前仅作为待迁移的内部实现，不得再被新的业务入口直接引用。页面层只保留 toast、缓存、Tauri invoke 和渠道流程编排；渠道派生、放弃确认、用户日志三态这类轻状态优先进入 `consultation-result/model` 并通过 options 注入副作用。
3. `ConsultationPage.vue` 后续优先 controller 化：症状采集、assist 快进入口、AI 推荐、PHIS 引用、完成问诊分别形成可读的流程 controller，再考虑移动入口文件；App 级事件入口优先把接诊、患者补全和风险胶囊这类跨问诊/语音的状态机沉淀到 `app/events`。
4. `shared/*` 只接收无业务语义的基础能力；诊断、治疗、问诊、反馈等医疗语义能力不得因为“多个地方用”就提前放入 shared。
5. 旧 `components/`、`composables/` facade 在调用方切完后应被清理；治理后只新增不删除，视为未完成收敛。
6. 智能问诊症状采集阶段的模板表单初始化、互斥选择、必填校验、病历草稿拼装等纯规则归入 `features/symptom-consultation/lib`；页面只保留用户动作编排、toast、DOM 滚动、AI 请求和 PHIS/HIS 副作用。
7. 面向用户展示的错误文案统一经 `src/shared/lib/errorMessages.ts` 归一化。业务页面可以追加场景前缀，但不得直接把 `Error.message`、`TypeError: Failed to fetch`、`Load failed`、HTTP statusText、JSON 解析错误或后端底层异常原样展示给医生；需要排障时展示 `requestId` 或引导查看 HIS 联调日志 / 后台日志。
8. 应用内快捷键采用“纯配置规则 + App 级单监听器 + 设置页受控草稿”三层结构：`features/settings/model/keyboardShortcuts.ts` 定义默认值、规范化、冲突/保留键校验和 `localStorage` 持久化；`app/shortcuts/useAppKeyboardShortcuts.ts` 是唯一全局 `keydown` 监听入口，并通过注入的导航/收起动作分发；`KeyboardShortcutSettings.vue` 只通过 `v-model` 编辑草稿，`SettingsPanel.vue` 在现有保存动作成功后通知 App 替换并持久化生效。不得在各业务组件内重复注册全局快捷键，也不得为快捷键配置新增 Pinia store。
9. 键盘可访问性与全局快捷键是两层契约：Tab、Enter、Space 和可见焦点依赖原生语义元素，始终可用且不可被用户关闭；可配置快捷键只负责跨视图动作，必须跳过输入/编辑目标、输入法组合态、模态框、页面过渡和强制更新门禁，不能绕过医疗流程或安全门禁。

---

## 核心架构

```
┌─────────────────────────────────────────────┐
│           App.vue (应用编排器)               │
│  - 1351 行（保留编排，只允许缩减业务分支）   │
│  - 初始化所有 Composables                    │
│  - 管理全局状态（ref/reactive）              │
│  - 渲染根组件和路由视图                      │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ▼           ▼           ▼
   ┌────────┐  ┌────────┐  ┌────────┐
   │Components│ │Composables│ │Constants│
   │         │  │ (业务逻辑)│  │ (配置)  │
   └────────┘  └────────┘  └────────┘
        │           │           │
        └───────────┼───────────┘
                    ▼
              ┌──────────┐
              │ Services │
              │(外部通信)│
              └──────────┘
                    │
                    ▼
            ┌───────────────┐
            │ Tauri Backend │
            │  (Rust Core)  │
            └───────────────┘
```

### 层次职责

| 层次 | 职责 | 示例 |
|------|------|------|
| **App.vue** | 应用编排、状态声明、组件路由 | 初始化 composables、渲染视图组件 |
| **Composables** | 业务逻辑封装、可复用功能 | 窗口管理、工作模式、导航 |
| **Stores (Pinia)** | 跨组件共享状态 | `consultationConfig` 配置状态、`diagnosisPath` 诊断路径缓存 |
| **Components** | UI 渲染、用户交互 | 聊天面板、设置面板、语音胶囊 |
| **Services** | 外部通信、数据转换 | LLM API、语音识别、医疗数据匹配 |
| **Shared Lib** | 跨业务基础工具 | 错误文案归一、通用纯函数 |
| **Constants** | 配置常量、类型定义 | 窗口尺寸、动画参数 |
| **Styles** | 样式模块化 | 全局样式、布局、动画 |

### Pinia 使用说明

- `src/main.ts` 在应用启动时执行 `createPinia()` 并 `app.use(pinia)`
- 当前主要用于 `src/stores/consultationConfig.ts` 的跨组件配置共享
- `src/stores/diagnosisPath.ts` 用于主问诊页和独立诊断路径窗口之间共享诊断路径结构化结果缓存
- 其余页面状态仍以局部 `ref/reactive` 为主，避免过度全局化

---

## 用户体系 (Auth)

### 当前状态

当前代码库**尚未落地独立医生登录态**，桌面端只保留服务端托管运行形态：

1. 桌面端通过 `SettingsPanel.vue` 或预置配置保存 `REGIONAL_BASE_URL / REGIONAL_ORG_CODE`，再由 `regionalRuntime.ts -> regionalClient.ts` 完成设备注册、`bootstrap` 拉取和 `/v1/*` 调用；后端地址优先取构建时注入的 `VITE_REGIONAL_BASE_URL`，机构编码默认回退到 `ORG001`。历史 `REGIONAL_ENABLED=false` 与本地 AI/语音/知识库密钥在升级时清理，不再影响运行形态。
2. 模型、独立审查 AI、语音、PMPHAI 和内置知识库的上游地址与密钥只在 `PCIE Server` 管理，桌面端不再提供模型配置页或第三方直连实现。
3. 后台不可达时不切换为本地直连：桌面壳、HIS Bridge、PHIS 回写、本地缓存和确定性规则仍可运行，依赖 `/v1/*` 的能力返回可理解错误并等待后台恢复。
2.1 `regionalClient.ts` 会优先通过 Tauri Rust 命令读取设备网卡 MAC 地址，并将其作为 `cdDevice` / 设备编码持久化使用；仅在当前环境无法读取 MAC 时才回退到本地生成的兜底编码。
2.2 `SettingsPanel.vue` 需要同时提供“桌面端到 PCIE Server”的接入测试入口，用于验证 `register -> bootstrap` 链路，并与后台“server 到 LLM”测试入口形成分层排障。
2.3 设置页“测试 server 连通性”只等待更新策略检查、设备注册和 `bootstrap` 获取，不再同步等待 prompt / template / mapping 数据包等运行时后置同步；服务端 HTTP 请求与更新策略检查必须设置有限超时，失败时结束按钮等待态并展示可操作错误信息。
2.4 服务端请求签名时间戳使用 epoch 毫秒。`requestSigner.ts` 会根据 `/v1/*` 响应体顶层 `timestamp` 维护“本机到服务端”的时钟偏移；遇到 `SIG-401` 且响应带服务端时间时，HTTP/SSE 请求会刷新偏移后重签重试一次，避免桌面端系统时间与后台服务器相差超过 5 分钟时阻断诊断推荐。
2.5 客户端版本升级、WebView 存储域变化或本地签名密钥重建时，桌面端仍以同机构同 `cdDevice` 调用 `POST /v1/client/register`；若本地仍持有旧 `deviceToken`，注册请求会携带该令牌作为同终端证明，后台负责更新设备公钥并返回设备令牌，桌面端不应因同设备码已存在而提示医生手工更新密钥。
3. HIS 联调通过本地 HTTP Bridge 完成，不依赖独立登录态。
4. 独立医生登录态不在当前实现范围；恢复该能力必须重新补架构、API 和数据迁移文档。

### 前端分层设计

1. 设置页只管理桌面通用偏好、后台地址、机构编码、音频输入设备与更新源；主模型、`chatFast`、`enable_thinking`、语音 provider、独立审查 AI 与知识库配置全部由 `PCIE Server` 管理，桌面端只读消费 bootstrap 的非敏感视图。
2. 本地 HIS 对接入口由 `src-tauri/src/http_server.rs` 提供。
3. 若未来引入真实登录态，应新增专用文档章节并在 `AGENTS.md` / `api.md` 中同步说明。
4. Windows 内网更新源采用本地配置驱动：测试环境地址、正式环境地址和当前生效环境保存在 `localStorage`，前端只负责展示与选择，真正的 updater endpoint 在 Rust 侧通过 `updater_builder()` 运行时注入。客户端会按当前更新通道访问 `PCIE Server` 的 `/v1/client/releases/{channel}/policy.json`；若服务端发布策略要求强制更新且当前版本低于 `minSupportedVersion`，应用进入强制更新门禁，只保留更新源配置、检查更新、下载安装并重启能力。强制门禁的策略事实必须由 `ForceUpdateGate -> UpdateChecker` 显式透传，门禁仍生效时不得因为 updater 暂未返回安装包而显示“当前已是最新版本”；此时必须保留阻断状态并明确提示“未获取到可用安装包/请联系管理员”，避免策略判断与下载安装状态形成两套相互矛盾的真源。
5. 主窗口的聊天、设置、问诊等可调整工作视图会将用户最后一次手动调整后的窗口尺寸写入 `.settings.dat`，再次打开对应视图时优先恢复该尺寸；聊天视图会丢弃低于标准工作面板高度的历史扁窗尺寸并回到默认窄高比例，智能问诊视图会丢弃低于当前默认尺寸的历史记录并回到适度放大的双栏比例，避免欢迎区、病历编辑区、推荐清单或底部操作区被不合适的历史尺寸继续影响；悬浮球启动阶段在 Rust 层读取 `.settings.dat` 的历史位置，并按当前显示器 `workArea`、实际窗口物理尺寸和最近边缘吸附策略夹回可见安全区域，若历史位置已不属于当前工作区则回落到主屏右侧居中位置。
6. 通用设置页新增音频输入设备配置，首选麦克风 `deviceId` 保存在 `localStorage`；聊天录音和语音接诊共用同一配置，若指定设备不存在则自动回退到系统默认输入设备。设置页首次进入时会按权限状态自动补做一次设备列表预热，尽量避免初次枚举不完整、必须手动刷新后才看到全部麦克风。
7. `VoiceCapsule.vue` 实时语音和 `ChatPanel.vue` 录音转写共用 bootstrap 下发的 speech config；`aliyun-dashscope` 与 `funasr-websocket` 优先使用区域 WebSocket，`openai-compatible` 与实时失败场景统一使用区域批量转写接口。桌面端只连接签名 `/v1/ai/speech/realtime/ws`，不接收或直连第三方实时地址。实时连接在非医生主动结束时收到 `error` / `final` / `close` 必须进入有上限退避的自动重连，重连窗口内 PCM 暂存并在新连接建立后续传；发生过中断的录音在结束时必须优先用完整本地音频执行批量兜底，不能因已有部分实时文字而跳过补录。医生主动结束采集后进入“音频采集完成”审核态；选择继续采集时，`VoiceCapsule.vue` 保留前段审核文字、累计时长与 WAV 分段，仅重建录音器和实时识别会话，最终确认前由 `features/voice-consultation/lib/voiceRecordingContinuation.ts` 合并同规格 PCM WAV，保证审计音频与整段转写仍成对提交。选择放弃时，胶囊先二次确认并上报 `abandon`，`useVoiceConsultation.ts` 清理本轮状态、缓存并写入取消结果，App 再通过统一 `openReceptionCapsule` 窗口出口返回当前患者胶囊；缺少患者上下文时才执行 `exitWork('cancelled')`。

### 与主流程关系

1. 所有问诊、语音和知识库上游能力统一走 `PCIE Server` 的 `/v1/*` 代理或服务端签名接口；桌面端不保存、下发或直连第三方密钥。
2. 本地 HTTP Bridge、HIS Adapter、PHIS 回写、SQLite 医疗目录、Tauri Store、离线重传队列、问诊现场缓存和确定性模板/规则继续保留，不把这些桌面基础设施误判为本地运行模式。
3. 诊断和医嘱推荐在完成本地/HIS 目录匹配后，可在后台 `features.recommendationPreferenceCollection` 显式开启时通过 `recommendationPreferenceTracker` 上报医生最终选择、手动匹配和候选确认事件；若后台灰度开启重排，客户端只对已存在候选应用服务端返回的轻量 boost，不新增候选、不替换未匹配项、不把偏好数据写入 Prompt。
4. 工作区共用顶栏的“问题反馈”入口统一使用 `FeedbackSubmissionPanel`（紧凑星级 + 预置问题标签 + 选填截图 + 选填补充说明）；通用反馈面板会按“当前问诊锚点 + 模块”回填上次已提交内容，医生再次进入时默认编辑同一份反馈而不是新建一条；语音问诊的推荐项反馈通过 `voiceFeedback.ts` 映射到同一 `/v1/client/feedbacks` 接口，所有反馈都会附带最近一次 AI 调用的 `traceId`、`sessionId`、`chainContext` 与握手阶段缓存的医生 / 机构 / 科室身份（`feedbackContext.ts`），由 `PCIE Server` 端按 `kind`（`general | recommendation | record_field | session`）+ `severity` 分类落库。
5. 每个 `/v1/*` 业务请求会附带 `X-Client-Version` 与 `X-Update-Channel`，服务端返回 `426 / UPDATE-REQUIRED` 时，客户端立即切换到强制更新门禁，禁止继续使用问诊、语音、知识库、AI 代理、模板同步、反馈等业务能力。
6. 智能问诊和语音问诊会通过 `consultationUserLog.ts` 向 `PCIE Server` 的 `/v1/client/user-logs/consultations` 上报运维用户日志快照：首版 AI 生成内容与医生最终提交/回写内容分别落到同一条问诊记录中，不记录中间每一次编辑；病历快照统一包含主诉、现病史、既往史、个人史、家族史、体格检查、注意事项，智能问诊结果页必须透传原问诊轮次 ID，确保共享结果页的完整首版与最终快照合并到同一条日志；语音问诊停止录音后会额外上报本次录音和 ASR 识别文字，供后台用户日志详情播放与复盘。用户日志身份字段来自 SDK handshake：`doctorWorkNo` 只取真实人员编码 `urt.personCd`，不得用 `urt.userId / personId / idDoctor` 等内部主键或后台管理员账号兜底；`hisOrgId` 只取 `urt.userRoleDepts.orgId`，`orgName` 取 `urt.orgPureName`，`deptId` 取 `urt.userRoleDepts.deptId`。
6.1 `featureUsageTracker.ts` 与 `auditUploader.ts` 在事件入队时同步固化当前 SDK handshake 中的身份上下文，离线重传继续使用事件产生时的身份而不是上传时的新登录身份。功能事件至少固化 `hisOrgId`、`orgName`、`doctorWorkNo`、`doctorName` 与当前客户端版本；其中真实工号只取 `urt.personCd`，客户端版本取本次运行时已确认的 Tauri 应用版本。服务端把这些字段写入 `c_ai_feature_event`，并以实际功能交互事件计算医生当前版本、该版本首次交互时间和最近活跃时间。旧版离线队列缺失字段时允许在上传阶段补当前可确认值，但不得使用后台机构编码、设备所属 `idOrg`、医生内部主键或账号伪造 HIS 机构 ID / 工号。所有功能统计事件只按允许字段重建，不承载顶层 `consultationId`、`payload`、`traceId` 或 `sessionId`；每条事件使用 UUID `eventId`，本地幂等键只由 `featureCode + eventId` 重建。新事件入队、旧队列加载、持久化和上传前都会移除调用方原始幂等文本及其他未知字段，旧队列中的非 UUID 事件 ID 会被替换，避免患者/就诊标识、跨表可关联伪标识、认证凭据或原始自由文本继续落盘或发送。AI 技术链路关联只保留在独立审计链路，不进入功能统计。
6.2 应用初始化在任何强制更新、后台配置或网络早退判断之前，必须同步重建功能统计主队列和拒绝诊断队列，保证旧版本遗留的敏感字段即使本次不启动上传器也会立即从本地存储移除；功能动作、来源模块和场景只接受有界技术编码，不能作为自由文本旁路。SDK handshake 控制台日志只记录阶段、布尔值和计数，不记录 raw ctx、凭据、人员/科室明细或 HIS 地址。
6.3 桌面端主动发起的 HIS / PHIS 出站请求，其控制台与出站联调日志只允许记录方法、接口路径、状态、耗时、字段存在性和数量摘要；URL 必须移除 userinfo、query 与 fragment，请求/响应摘要必须递归遮蔽患者、就诊、住院、人员、机构、科室、凭据及自由文本值。目录同步控制台日志同样只记录阶段、布尔值和数量，不输出原始机构、租户、药房 ID 列表。出站调用关联统一使用本地生成的 `traceId`，不得以患者或就诊标识作为可读关联键；本约束不改变 Bridge 入站联调日志的既有本地调试合同。
7. 原始操作日志只保留能定位业务路径的结构化事件：`operationTracker.ts` 负责把高噪声 UI 事件白名单化过滤，并把保留事件统一上报为 `{ module, action, title, sourceModule, scene }`；`aiTrace.ts` 则为 AI 代理补齐“哪个业务发起了这次调用”的上下文，避免后台只看到泛化的 `ai/chat`。
8. 辅诊功能统计不再从原始操作日志推断。`featureUsageTracker.ts` 负责在用户真实触发功能时向 `/v1/client/feature-events/batch` 上报业务事件；一次明确功能调用只写一条，以稳定 UUID 事件 ID 生成安全幂等键，保证同一条离线事件或接口重试不重复入库。批量响应必须按 `accepted / skipped / rejected / rejections[]` 完整校验并逐条结算：接受项与幂等跳过项从待上传队列移除，拒绝项进入有界诊断隔离队列并只保留事件 ID、功能编码、响应索引、原因和拒绝时间；隔离记录持久化失败或响应计数、索引、事件 ID 畸形时整批保留等待重试，不得把 HTTP 200 等同于整批成功。`featureUsageEntryTracker.ts` 负责把 HIS Bridge 入口归一到产品功能维度：`start-consultation`、`start-voice`、`assist` 在接诊上下文校验通过并准备打开目标界面时即记一次成功调用；同一就诊再次显式触发入口按新调用计数，后续 AI 生成、问诊提交或结果页自动触发不再额外补一条功能统计。审计日志继续用于排障，功能事件才是后台“辅诊功能”统计事实源。智能问诊、语音问诊、报告单解读、聊天、知识库使用按用户进入/提交的主功能计数；知识库批量检索只按一次用户检索动作计数，不按内部拆开的多个查询词累加；诊断鉴别和推荐诊断/用药/检查/检验/处置/诊疗方案推荐只在医生显式触发独立辅助入口时计数，智能问诊或语音问诊主流程内部自动生成的 AI trace 不再拆成子功能调用次数。
9. 登录态设计在当前版本不是前置依赖，不能假定仓库内已有 `auth store` 或受保护 API 基座。
10. 独立诊疗方案推荐由 `features/treatment-plan` 承载，入口为 `/api/consultation/assist` 的 `action: treatment_plan`。该功能不进入 `ConsultationPage.vue` 的症状采集栈，也不维护另一套回写格式：AI 请求继续复用 `features/clinical-result` 的治疗推荐 request builder、JSON 解析、标准库匹配与治疗归一化能力；推荐项二次编辑继续复用 `features/consultation-result` 的 `TreatmentRecommendationCard`、`TreatmentItemEditor`、手动匹配、二级属性搜索、药品字段编辑、药品详情和库存校验能力；药品模型字段先由 `clinicalResultTreatmentFields.ts` 区分目标临床剂量与 PHIS 一次剂量，再由 `useTreatmentHydration.ts` 的统一药品定稿流水线结合当前库存和药品详情，把 `targetDose/targetDoseUnit` 换算到 `doseOnce/unitDose`，解析标准频次 / 用法，程序化计算包装总量并以最终总量校验库存；“必要时”等标准但不可量化的频次无法精确计算总量时，在核心处方字段与销售包装单位完整的前提下由共享数量 helper 兜底为一个销售包装并提示医生确认。语音问诊、智能问诊、报告回诊和慢病复诊不得各自维护剂量、包装或库存校验顺序。AI 药品 raw 中的包装总量在 mapper 层清空，仅历史明确总量或医生手工总量可保留；定稿失败的药品必须取消自动选中。选中前和最终提交前必须复用共享治疗项非空校验，确保用药、检查、检验、处置均具备 PHIS 调入确认所需的标准服务 ID、名称、分类、执行位置及各类型专属必填字段；医生手动清空执行科室后由 `TreatmentRecommendation.execDeptCleared` 标记当前输入空值，hydrate、归一化、门禁和 order resolver 都不得再用匹配元数据或默认科室补回；最终提交继续使用 `recordConfirmedPayload.ts` 构造 `outpatientRecord + diagList/orderList` 并等待 PHIS `reference-feedback` 回执，成功回执后通过 App 统一窗口管理收起并销毁本次方案页实例；医生点击放弃同样结束本次独立推荐，下次触发 `treatment_plan` 必须重新初始化并重新生成推荐；失败回执保留当前方案页和错误提示以便修改重试。独立鉴别诊断由 `features/differential-diagnosis` 承载，入口为 `action: diffDx`，只打开“鉴别排查确认”小窗并生成 checklist，不进入后续问诊结果页。鉴别清单的临床风险与请求/解析/运行时系统错误必须使用两个独立状态：只有成功解析出的临床风险才允许进入风险列表；系统错误只显示中性错误说明与重试操作，不得改写成“发现问题”或附加“高风险”临床徽标。
11. 住院病历辅助生成由 `features/inpatient-emr` 承载，入口为 `POST /api/inpatient/emr/generate`。该功能不进入 `ConsultationPage.vue` 或语音问诊结果页，而是作为独立工作视图展示模板解析、住院 HIS 数据拉取、AI 生成步骤和病历预览；模板字段侧栏只展示适合 AI 生成的字段，字段提示词默认折叠在详情中。入口必须传入 `templateId + templateName + htmlContent`，可选传入 `recordTime` 作为本次病程记录书写时间，并可传 `doctorSupplement + contextPolicy + hisContext` 按 [三方对接手册](docs/his-inpatient-emr-ai-context-integration.md) 提供裁剪后的 AI 上下文包；生成上下文会形成 `documentContext` 和标准化 `aiContext`，只使用请求自带 `hisContext` 或 HIS Adapter 聚合上下文能力，PHIS 侧直连 `api/phis.aiInpatientEmrContextService/buildContext`，不再回退到住院登记、医嘱、体温单分散接口。AI 生成以 `recordTime` 的日期作为“今日 / 本次查房日期”，体温单历史记录只能按“最近一次记录日期”引用，不能替代书写日期。医生可在“重新生成”弹窗中手动输入或语音转写补充本次查房要点，也可引用已拉取正文的门诊病历作为入院记录病史来源；两类材料可以同时进入提示词并共同作为依据，至少存在一类可用依据时即可启动 AI 生成。入院记录生成必须从住院病历书写角度综合门诊病历、医生补充与住院上下文重新组织语言，不得把门诊主诉、现病史或门诊正文原样搬到入院记录字段中。模板解析结果优先通过后端 `/v1/client/inpatient-emr/templates/resolve` 按 `templateId` 缓存并接收管理端维护的字段提示词，命中后不得再先跑未知字段 LLM 分类；只有后端不可用或后端未返回字段时才使用桌面端确定性模板解析及服务端 LLM 分类兜底。所有来自 HIS、PHIS、服务端知识库或入口模板的 HTML 在解析或 `v-html` 展示前，必须统一经过 `shared/lib/safeHtml.ts` 的 DOMPurify HTML-only 白名单净化；脚本、事件属性、表单、iframe/object/embed、危险 URL 和不受控 CSS 必须移除，只保留病历布局所需的安全 HTML、受控内联样式和模板 `data-*` 字段属性。净化后的模板才允许继续生成可编辑字段 DOM，组件不得直接渲染原始 `htmlContent`。内嵌知识页 iframe 必须使用最小权限 `sandbox`，应用 WebView 必须启用与实际 connect/img/frame 来源匹配的 CSP，不能再将 CSP 设为 `null`。病历预览中非 AI 字段保持只读，AI 字段高亮并允许医生直接修改；页眉病历标题等模板自带非 AI 字段必须保留原模板默认值，不得被病程记录固定文案覆盖。生成结果必须携带结构化 `trace` 与 `evidenceSummary`：trace 覆盖 HIS 聚合上下文、门诊正文、模板解析、AI 首 token / 总耗时、回写发送和回执耗时，evidenceSummary 展示住院上下文、门诊病历正文、医生补充要点和模板缓存是否参与生成；生成完成、回写发送和回执到达时会把脱敏 trace 汇总写入本地 HIS 集成日志，只记录阶段状态、耗时、计数和 requestId，不记录 `htmlContent`、`fieldValues` 或门诊/住院病历正文。医生在病历预览中确认 AI 字段后点击“一键回写”，页面先执行一轮本地轻量病历质控；未发现风险项时直接复用本地结果事件通道产出 `record-confirmed`，发现风险项时只弹出质控提醒让医生返回预览修改或确认继续回写。`record-confirmed.fieldValues` 仍只包含本次模板内标记为适合 AI 生成的 `{ [data-id]: 文本 }` 字段级结果，供 HIS 按当前模板回填；PHIS/HIS 后续通过 `reference-feedback` 回执更新页面状态，成功回执会让病历生成界面收起回小球状态，失败回执保留当前编辑现场并允许重试。

---

## 应用入口 (App.vue)

### 当前状态

**代码行数**: 约 723 行（当前以编排职责为主，未重新收敛回单体逻辑）

**职责**: 轻量级应用编排器

### 交互目标（2026-03 设计约束）

1. 保留 `ConsultationPage.vue` 现有症状问诊主链路，支持完整走完既有流程。
2. 原灵活模式入口已完全并入 `ConsultationPage.vue`，作为“主问诊内嵌灵活模式”存在；项目内不再保留独立 `consultation-session` 小窗实现。
3. `/api/consultation/assist` 与桌面端附加入口仍然保留，但其目标变为“打开 `ConsultationPage` 指定阶段”。当 HIS 已传入 `chiefComplaint/historyOfPresentIllness` 时，页面应直接跳过症状选择，进入病历详情与 AI 推荐阶段。
4. 灵活模式下的推荐诊断 / 推荐用药 / 推荐检查 / 推荐检验 / 推荐处置，必须继续复用 `ConsultationPage.vue` 现有的诊断生成、标准库匹配、诊断路径与方案联动逻辑，不允许维护第二套轻量推荐口径；外部 API 新接入推荐使用 `suggestedDx` 表示诊断推荐，前端事件层统一归一到内部 `diagnosis` 流程，历史 action 继续兼容。`diffDx` 是独立鉴别诊断入口，直接打开独立“鉴别排查确认”小窗，不进入 `ConsultationPage.vue` 或共享结果页。
5. 各模块的“确认”和“引用”语义必须拆分：主诉/现病史回写可以直接更新医生站草稿；诊断鉴别确认只记日志，不修改病历；推荐诊断、推荐用药、推荐检查等的“引用”才真正进入 PHIS 保存闭环。
6. 灵活模式必须实现前置门禁：`suggestedDx` / `diagnosis` 入口要求已有主诉和现病史，且诊断推荐调用不要求 HIS 传入当前诊断；`diffDx` / `differential` / `medication` / `examination` / `lab_test` / `procedure` 入口要求已有主诉、现病史和当前诊断；若条件不足，页面需要给出明确提示并停留在可继续补全信息的位置。
7. `web_project/public/mock-his.html` 作为联调页时，只通过 `sdk/med-hermes-sdk.js` 的 WebSocket 事件订阅获取 `/api/consultation/events/ws` 推送；本地 HIS 结果通道不提供 HTTP 长轮询兜底，并且仍必须支持“引用请求 -> PHIS 保存成功/失败 -> 回执全医慧助（PCIE）”的完整闭环。
8. `POST /api/consultation/reference-feedback` 成为 PHIS 引用回执入口。floating-ball 发起引用后应继续停留在当前 `ConsultationPage`，医生可继续完成本次问诊；收到回执后，必须更新当前问诊页状态、记录日志、标注已引用或失败原因。当前实现仍以内存状态为主，而不是落盘恢复。
9. `/api/consultation/events/ws` 是唯一的 HIS 结果事件通道，统一推送“病历草稿写回”、“引用请求发起”、“PHIS 引用回执”等事件 envelope；联调页或 HIS 侧仍需校验 `event.id`、`consultationId` 与当前患者一致，避免旧结果提前命中。断线时 SDK 携带最后消费的 `event.id` 重连，握手失败采用有上限的指数退避，不得并行启动 HTTP 轮询。
10. 本地 HTTP Bridge 的业务接口不允许使用 permissive CORS 或仅依赖已保存握手上下文；`POST /api/handshake` 成功后必须发放当前 origin 绑定的本地 Bridge session，后续 REST / WebSocket 请求必须逐请求校验 session、origin、timestamp、nonce 与签名。`GET /api/health` 和 `/sdk/*` 只用于在线探测与 SDK 加载，不代表业务授权。
11. 针对推荐诊断的重复引用，需要区分“同一诊断重复点击”和“更换为新诊断引用”；前者应提示已成功引用，后者应允许 PHIS 进入诊断修改流程并通过回执反馈最终结果。
12. 后端内部仍沿用 `start-consultation-session` 这个 Tauri 事件名承接 `/api/consultation/assist` 的兼容分发；普通灵活模式落点是 `navigation.openConsultation()` + `ConsultationPage`，`treatment_plan` / `diffDx` 分别由独立诊疗方案页和独立鉴别诊断小窗承载，不再存在旧版独立 session 小窗视图。
13. `ConsultationPage.vue` 里的推荐诊断必须保持单选，并以当前选中诊断作为引用对象；推荐用药、检查、检验、处置则保留多选，并在各自分组级提供一次引入所选项的入口。对暂不支持 PHIS 引用的推荐项，应作为只读处置建议单独展示，避免被误当作检查项提交。
   14. 检验检查报告解读不进入 `ConsultationPage.vue`。外部单份报告请求继续通过 `POST /api/report/interpret` -> `useEventListeners.ts` -> 独立报告解读窗口完成；接诊阶段识别到近 14 个自然日存在已出报告时，通过 reception `report-interpretation` opportunity 进入主窗口内报告工作台。独立窗口与工作台复用 `features/report-interpretation` 的报告正文组件、结构化报告 mapper、解读 controller 和 `services/reportInterpretation.ts` 核心能力，窗口生命周期只留在独立窗口包装层。工作台的结构化 HIS 路径额外保留检验项目、结果、单位、参考上下限、参考范围、异常标记和异常方向；检验结果按 LIS `idReportGroup` 聚合为报告单，并携带同组全部已出结果申请的 ID、名称，报告单数量不得被解释为申请项目数量；历史就诊中性 DTO 同时保留 `deptName` 供时间轴展示。PACS 报告采用“临床内容与原报告资源分离”的有效字段投影：PHIS 将 `DIAGNOSTIC_IMAGING` 映射为 `finding`、`CLINICAL_IMPRESSION` 映射为 `conclusion`，其他站点的 `RESULT / REMARK` 仅作为非 URL 临床文本兜底；`REMARK` 中的 HTTP(S) 地址单独映射为 `reportUrl`。PHIS 与 HIS Adapter 均过滤数据库空值、空白、空值哨兵和误入正文的 URL，`reportedReportHistory.ts` 在构建 AI `sourceQuery` 前再次净化。至少存在一项有效临床内容时报告可解读；只有 `reportUrl` 时报告仍保留在时间轴供医生打开原报告，但不得发起 AI 解读。异常表只消费确定性字段，`keyPoints` 不得反向生成异常项；解读内核同时产出 `actionability + problemList`，供已执行解读的报告回诊优先复用，但不是进入后续方案的门禁。未解读时，治疗方案回退消费结构化原始报告和本次病历。正文展示层对 summary / keyPoints / sections / recommendations 做职责分区与重复段落过滤，并由 `reportInterpretationPresentation.ts` 根据结构化判定是否完整、异常项数量和 `high` 风险生成 unknown / normal / attention / high 总体状态。患者基本信息只在头部展示，摘要展示层清理姓名、性别、年龄前缀。
15. 报告解读独立窗口默认隐藏原生标题栏，窗口移动依赖页面头部拖拽区，关闭动作统一走页面内虚拟按钮；窗口外壳、操作按钮、loading 与空态沿用 floating-ball 既有柔和玻璃态窗口语言；正文采用单页报告单式纵向阅读版式，窗口主体滚动容器承接溢出内容，不能裁切报告元数据、异常项目或综合判断；打印模式必须覆盖全局 `html/body/#app` 的固定高度与 `overflow: hidden`，让报告按内容自然分页。
15.1 住院病历辅助生成不进入 `ConsultationPage.vue`。该能力通过 `POST /api/inpatient/emr/generate` -> `start-inpatient-emr-generation` Tauri 事件 -> `navigation.openInpatientEmr()` 链路打开主窗口内独立界面；HIS 数据通过 `fetchInpatientEmrContext` / `buildContext` 一次性获取，当前 PHIS Adapter 直连 `api/phis.aiInpatientEmrContextService/buildContext`，再在桌面端拆解为登记、医嘱、生命体征、历史病历等上下文。入院记录引用门诊基础资料时，先由 `HisAdapter.fetchOutpatientVisitHistory` 调用 PHIS `api/phis.aiAdapterService/queryVisitHistory` 拉取门诊就诊列表并映射为中性 `HisOutpatientVisit`，查询所需患者主键来自入口 `patient.idPi / patient.patientId` 或 `buildContext` 返回的 `hisContext.patient.patientId`，该字段不得被上下文裁剪移除；门诊历史默认查近 7 天，弹窗提供近 1 月 / 近 3 月切换，PHIS 入参使用 `params.dtBgn: ["YYYY-MM-DD 00:00:00", "YYYY-MM-DD 23:59:59"]`；列表只展示同时具备有效诊断和门诊病历文书的就诊记录，无诊断或 `getLookMedList` 无文书的就诊在 adapter 层过滤。医生选定一次就诊后，当前 PHIS Adapter 先通过 `api/phis.aiAdapterService/getLookMedList` 拉取该门诊就诊下的病历文书列表，入参固定 `idApp = 42`、`idHospital = 门诊 idVis`、`idTet = 握手 tenantId 或门诊记录 raw.idTet`，再按选中的 `idMedrecdoc` 调用 `api/phis.aiAdapterService/getMedContentLook` 拉取 HTML 正文，入参固定 `courseShow = 0`。门诊病历正文会转换为预览 HTML 和 AI 可读纯文本；若正文接口失败，才退回只展示文书列表并提示正文暂不可用。已选门诊病历正文和医生补充要点可共同作为入院记录生成依据，即使请求已携带住院 HIS 聚合上下文，也必须继续按 `outpatientVisitId` 拉取该门诊正文；生成时必须以入院记录结构重新归纳主诉、现病史、入院情况等字段。历史病历上下文应在 HIS 适配层完成裁剪：病案首页不进入 AI 上下文，入院记录提取主诉、现病史和关键结构化章节，病程记录保留近期摘要。界面必须用统一“生成过程”面板合并展示“获取住院上下文 / 整理诊疗摘要 / 整理病历依据 / 解析病历 / AI 生成”的步骤状态和对应依据摘要；耗时统一只在面板底部折叠的详细联调 trace 中查看。AI 生成字段、折叠式字段提示词详情和可编辑病历预览仍独立展示。预览内非 AI 字段不得编辑，AI 字段直接在模板位置高亮编辑，避免为不同病历模板维护固定正文编辑区；“重新生成”必须先允许医生补充病历要点，支持文本输入和语音转写，补充内容作为 `doctorSupplement` 进入下一次 AI 生成；若已有补充要点、已引用带正文的门诊病历，或医生点击“直接重新生成”并由页面设置 `allowGenerateWithoutExternalBasis`，则不再停在等待输入状态。住院病历页的顶栏收缩和页面 `close` 事件只做最小化保活，可通过悬浮球恢复入口、双击小球或同一 `admissionId` 的新入口请求回到同一现场；页面“放弃”才清空现场并退回小球。一键回写前不再展示重复的字段审核页；页面改为执行本地轻量质控，重点检查 AI 字段空值或占位文本、生成兜底/等待输入、住院上下文缺失、体温单日期不匹配、上下文裁剪和门诊正文不可用等风险。只有存在风险项时才弹出质控提醒，医生可返回预览修改或确认继续回写；无风险时直接发送回写事件。发送回写后继续记录发送耗时与 `reference-feedback` 回执耗时。收到 HIS `reference-feedback` 成功回执后收起回小球，失败回执保留页面和当前编辑内容。
16. 智能问诊的页面留存与语音问诊一致：未诊毕、未确认放弃时，再次点击“智能问诊”或最小化后再次打开，必须恢复 `ConsultationPage` 上次内部页面（症状采集、病历详情或最终报告）及数据快照；症状问诊结果页“返回”只回编辑页，“放弃”确认后必须清空当前快照和页面内勾选/推荐状态并直接退回悬浮球；语音问诊一键回写成功只代表本次回写闭环成功，不代表诊毕，同一接诊上下文内再次触发 `start-voice-consultation` 时必须恢复上一张语音结果页；但当前接诊从患者 A 切换到患者 B 时，患者 A 的语音缓存和最小化入口必须同步失效，之后再切回患者 A 也重新开始语音问诊；只有诊毕、确认放弃、患者切换或跨自然日失效时才清理。
17. 智能问诊 AI 调用不得在请求发起时清空已有诊断或推荐结果；新结果只有在 LLM 响应解析成功且仍匹配当前诊断上下文时才提交到页面状态。结构化 JSON 解析统一允许代码块和少量前后说明，从响应中抽取 JSON 对象/数组后再解析；各路推荐独立失败时保留上一版数据，并只更新对应错误态，避免单次解析或网络抖动造成整页丢结果。
17.1 智能问诊症状采集后的主诉 / 现病史草稿优先由 LLM 生成：`ConsultationPage.vue` 收集症状表单、患者基础信息和一般情况，交给 `features/symptom-consultation/lib/consultationRecordAiDraft.ts` 组装基层全科模板风格的 JSON 请求；模型输出必须包含 `chiefComplaint` 与 `historyOfPresentIllness`，解析或内容校验失败时退回 `consultationGeneratedRecord.ts` 的本地规则草稿，避免阻断后续诊断推荐。AI 草稿只写入当前可编辑结果页，不直接回写 HIS。
   17.2 所有可能产出药品建议的 AI 调用都必须在请求前通过 HIS Adapter 获取当前可用发药药房的有效库存目录，包括语音结构化抽取、共享结果页用药刷新、智能问诊、独立诊疗方案、复诊配药及仍可运行的中医药品分支。PHIS 实现调用 `api/phis.aiAdapterService/queryInvSubList`，由院端 `aiAdapterService` 适配不同 PHIS 版本的库存查询差异；客户端仍使用 `idSto + amountType=1 + fgActiveType=1` 查询，过滤无可用数量或已失效批次后按 `idMedPro` 合并多批次。报告回诊等先判断用药意图的场景采用两阶段：第一阶段不传全量目录，只输出是否需用药、首选规范通用名和别名；共享 inventory helper 以通用名/别名精确检索当前有效库存并只把命中的候选名称与规格交给第二阶段处方生成。未经审核的药品知识映射不得用于推断临床等效药；精确命中为空时只允许返回规范通用名无库存参考。其他场景仍以只含药品名称与规格的紧凑格式加入 Prompt，不传入具体库存数量；格式化时按 Unicode 归一、前缀标记清洗后的“药品名称 + 规格”去重，不向模型重复传入仅 `productId` 不同的同名同规格项，但内部真实库存仍逐 `productId` 保留，供标准目录匹配、单价解析、库存校验和回写使用。合并项同时保留近效期有效批次的库存销售单价，若该批次无有效价格则顺延至下一个有效批次。目录为空或暂不可用时也必须注入策略，不得退回无约束推荐；库存命中项由共享 inventory helper 对齐院内名称和规格。目录按机构、租户、药房作用域持久化缓存，并以短 TTL 判断新鲜度；缓存刷新失败时允许使用最近一次非空缓存，但处方提交前仍必须执行实时库存校验。库存校验的 `unitPrice` 必须按当前 `storeId + idMedPro` 从该药房有效库存目录解析，禁止回退药品详情价格；未取得有效库存单价时不得继续校验或回写。库存接口依赖本机 HIS 登录态，不得迁移到 `PCIE Server`。
18. 症状问诊和语音问诊最终一键回写共用 `record-confirmed` 构造器；进入 `diagList.idDiag` 的值必须是标准诊断库 ID（PHIS `ID_DIE`），不得使用 `diag_*`、`phis-diagnosis-*` 等前端临时 ID。`record-confirmed.outpatientRecord` 由 `features/clinical-result` 的完整门诊病历 builder 先统一生成和质控，再由 `writebackScope` 过滤为本次选择的主诉、现病史、既往史、个人史、家族史、体格检查和注意事项字段；未选病历字段与 `diagList` 必须从 payload 中省略，HIS 保持原值。PHIS 会直接遍历 `orderList`，所以该字段在 `record-confirmed` 中始终存在：没有选择任何医嘱时传 `[]`，并以空的 `writebackScope.orderTypes` 表示不处理医嘱，不能据此清空 HIS 既有医嘱。该对象不包含 `diagnosisText`，只有选择诊断时才由 HIS 根据 `diagList` 自动生成病历诊断行，避免诊断文书来源与标准诊断回写来源分叉。症状问诊从 `Diagnosis` 适配到共享结果页的 `VoiceIntentResult.diagnoses` 时必须把标准诊断 ID 透传为 `matchedItem.id` 或等价标准 ID 字段，避免共享结果页初始化时丢失诊断主键。
18.1 检验检查互认复用最终回写的同一个 `requestId`，不拆成第二次 `record-confirmed`。`HisService -> PhisHisAdapter -> medicalDataService -> matchedItem.raw -> recordConfirmedPayload` 必须完整透传项目 `mutualRecognitionCode`，检查 / 检验 `orderList` 中该字段始终存在，空字符串表示不参与互认。PHIS 首次校验命中可互认报告时通过 `/api/consultation/reference-feedback` 返回 `status=pending + recognizableItems/items`；Rust Bridge 保留项目的 `idSrv / idCli / naSrv / naCli / sdSrv / mutualRecognitionCode / priceSale` 并发出 `consultation-reference-feedback`。共享 `useMutualRecognitionDecision` 消费该中间态，`MutualRecognitionDecisionDialog + MutualRecognitionDecisionHost` 负责部分勾选、三类医生决策和页面最小接线；页面现有 `useWritebackStatus` 不得把该 `pending` 清算为成功或失败。旧症状问诊入口由 `useSymptomConsultationFinalWriteback` 承接完整最终回写状态机，`ConsultationPage.vue` 只保留装配且本轮继续净缩减。医生决策通过 `complete_consultation` 追加 `reference-request + recognitionDecision`，仍使用原 `requestId`；后续 PHIS 最终 `success / failed / cancelled` 再交回原回写控制器收尾。纯协议归一和决策 payload builder 位于 `features/clinical-result`，状态编排与 UI 位于对应 feature，页面只接线。
19. HIS 联调相关的调用必须进入本地 HIS 集成日志：HTTP Bridge 入站接口由 Rust 侧直接记录，前端 `hisService.ts` 出站请求通过 `hisIntegrationLog.ts` 写入同一 JSONL 日志，并在日志面板中按 `traceId`、接口、方向、状态筛选和导出。

### 代码结构

```vue
<script setup lang="ts">
// 1. 导入声明 (~30 行)
import { useWindowManagement } from "@app/shell/useWindowManagement";
import { useWorkMode } from "@app/shell/useWorkMode";
import { useNavigation } from "@app/navigation/useNavigation";
// ...

// 2. 全局状态声明 (~40 行)
const appWindow = ref<TauriWindow | null>(null);
const currentView = ref<ViewType>('chat');
const currentPatient = ref<AppPatient | null>(null);
const storeRef = ref<AppStore | null>(null);
// ...

// 3. Composables 初始化 (~90 行)
const windowMgmt = useWindowManagement({ appWindow, store: storeRef, isWorking, transitioning });
const workMode = useWorkMode({ appWindow, windowMgmt, currentView, ... });
const navigation = useNavigation({ appWindow, currentView, windowMgmt, workMode });
const voiceConsultation = useVoiceConsultation({ appWindow, currentView, ... });
const eventListeners = useEventListeners({ appWindow, currentView, ... });

// 4. 辅助函数 (~50 行)
const closeRiskAlert = async () => { ... };
const handleRiskExpand = async (expanded: boolean) => { ... };

// 5. 生命周期钩子 (~100 行)
onMounted(async () => { ... });
onUnmounted(() => { ... });
watch([isWorking, currentView], async () => { ... });
</script>

<template>
  <!-- 6. 模板 (~115 行) -->
  <!-- 悬浮球层 -->
  <Transition name="morph">
    <div v-show="!isWorking" class="ball-layer">...</div>
  </Transition>

  <!-- 工作面板层 -->
  <Transition name="morph">
    <div v-show="isWorking" class="assistant-layer">...</div>
  </Transition>
</template>

<style scoped>
  /* 7. 组件样式 (~90 行) */
</style>
```

### 管理的全局状态

```typescript
// 窗口状态
const appWindow = ref<TauriWindow | null>(null);
const isWorking = ref(false);          // 是否处于工作模式
const isHovered = ref(false);          // 鼠标是否位于小球交互范围内（驱动环绕菜单显示）
const isFocused = ref(false);          // 是否聚焦（不驱动环绕菜单显示）
const transitioning = ref(false);      // 是否正在过渡动画

// 视图状态
const currentView = ref<ViewType>('chat');  // 当前视图
const hoveredBtnIndex = ref(-1);            // 悬停的按钮索引
const consultationAssistTrigger = ref(...);  // 灵活模式自动触发请求

// 业务状态
const currentPatient = ref<PatientContext | null>(null);  // 当前患者统一上下文
const generatedRecord = ref<GeneratedRecord | null>(null); // 生成的病历

// 风险提示状态
const riskPatientName = ref('');
const riskPatientGender = ref<'M' | 'F'>('M');
const riskPatientAge = ref(0);
const riskItems = ref<RiskItem[]>([]);
const isRiskAnalyzing = ref(false);
```

### 初始化的 Composables

| Composable | 职责 | 导出 API |
|-----------|------|---------|
| `windowMgmt` | 窗口管理 | 位置保存/恢复、智能展开、尺寸调整 |
| `workMode` | 工作模式 | 进入/退出工作模式、收起处理 |
| `navigation` | 导航管理 | 打开各视图、视图切换追踪 |
| `voiceConsultation` | 语音问诊 | 语音处理、病历生成、结果提交 |
| `eventListeners` | 事件监听 | HIS 集成、Deep Link、鼠标/窗口事件 |
| `reportInterpretation` | 报告解读服务 | 报告原文解析、LLM 解读、独立窗口事件投递 |
| `inpatientEmr` | 住院病历生成 | 后端模板解析缓存对接、住院 HIS 数据聚合、AI 病程生成、病历回写事件构造 |

### 患者上下文基线

`currentPatient` 是应用级唯一患者上下文。约束如下：

1. 外部事件只提供患者主键 / 就诊主键和少量当前场景字段。
2. `app/events/useReceptionController.ts` 的接诊流程负责调用 `HisAdapter.fetchPatientInfo()` 与 `HisAdapter.fetchPatientHistory()` 补全完整信息；`useEventListeners.ts` 只负责把 HIS 事件分发给该 controller。
2.1 患者年龄是“数值 + 单位”的一个不可分割事实。`entities/patient/lib/patientAge.ts` 统一归一 PHIS `Y / M / D` 与中文“岁 / 个月 / 天”展示；`PhisHisAdapter.fetchPatientInfo()` 必须优先产出完整 `ageText`，`utils/patientContext.ts` 在合并接诊事件与 HIS 补全信息时，优先使用 HIS 完整年龄文本，不允许事件中的裸 `ageNum` 覆盖。非“岁”单位不得进入 `ageYears` 或在中性 `Patient` 中伪装成岁数；展示、AI prompt、风险评估和结果页继续只通过患者上下文 selector 读取。
3. 风险评估完成后，`features/reception-risk` 基于 `HisPatientHistory.visits` 按时间读取近 90 天内的历史就诊，再提取其中含慢病诊断的就诊记录及其药品医嘱，不再按最近 3 次或最近 5 次截断。`chronicRefillHistoryWindow.ts` 负责生成包含当前自然日、向前覆盖 90 天的中性 `dateRange`；`useReceptionController.ts` 调用 `HisAdapter.fetchPatientHistory(patientId, { currentVisitId, dateRange, limit })`，PHIS 实现把时间范围映射为 `queryVisitHistory.params.dtBgn`，把当前 `idVis` 透传给院端排除本次就诊，并使用足以覆盖正常 90 天门诊量的技术上限避免固定 5 条截断。`PhisHisAdapter.ts` 只把 `loadClinicMedicalRecord.orderList` 中 `sdOrd / sdSrv === "11"` 或存在药品主键的医嘱映射为历史药品，检验 `41`、检查 `31`、处置等不得进入 `HisVisitRecord.medications`，字面量 `null / undefined` 不得进入业务文本。候选只要求窗口内历史中存在一条受支持的慢病诊断，不要求诊断重复或存在历史药品；历史药品为空时仍进入慢病复诊，由模型基于具体诊断和当前有效库存生成用药建议。当前主诉、现病史或诊断命中携报告/检查结果回诊语义时，报告回诊优先并抑制复诊配药候选。慢病候选必须区分“慢病分类组”和“临床诊断”：分类组仅用于候选识别，不能覆盖历史病历中的原始诊断名称；同组同时存在泛化诊断和有明确分型的诊断时，临床结果优先保留有历史依据的具体诊断，同等具体程度下采用最近一次，只有历史记录本身未提供分型时才允许保留泛化名称。候选必须分别保存简洁诊断依据与历史用药依据；诊断卡不得展示处方、检验检查项目或原始医嘱列表。命中结果由接诊 controller 写入胶囊状态，胶囊只展示临床诊断和历史用药可用状态，不展示有限历史窗口内的具体就诊次数。单一慢病点击后直接生成；多慢病只在 `ReceptionCapsule.vue` 内用本地选项确认本次范围，不产生独立工作页或模型调用。`useOutpatientScenarioRouter.ts` 在得到 scoped candidate 后先调用 `useGeneratedClinicalResultSession.ts` 创建带 session token 的慢病生成占位结果；结果页窗口过渡与 `chronicRefillRecord.ts` 生成请求随即并行启动，避免为了展示等待态反而增加总耗时。`chronicRefillRecord.ts` 在读取库存前先通过确定性 Builder 回传诊断、历史用药、既往史、过敏史、复诊目的和规则核查草稿；`useGeneratedClinicalResultSession.ts` 只接受当前 token 的 partial result，并保持 `generation.status = streaming`。模型仍只发起一次签名 SSE 请求，并按 `record_core / review_plan / recommended_medicines / record_extra / done` NDJSON 事件更新同一份 `ClinicalResultInput`；事件解析失败或流中断时保留最近一版安全草稿收口，不得追加第二次非流式模型请求。历史药品存在时，Prompt 只携带与历史药品匹配的库存候选；无历史药品时才使用受控库存目录。最终结果只有 token、患者锚点和当前接诊机会仍匹配时才能提交，迟到 partial / complete 都不得污染新患者或新会话；异常必须显式结束等待。`VoiceConsultationNew.vue` 把服务端 `complete` 结果应用到本地编辑器时继续维持本地 `finalizing` 状态，等待病历映射、药房选项和药品库存核对完成后才关闭进度并开放编辑/回写；慢病渠道完成后不得再调用通用 `generateFactSuggestions` 改写正文。初始主诉固定为具体慢病复诊配药，现病史只使用历史明确事实和复诊目的，不得使用未选择的控制情况、依从性、不适、人口学信息、库存或推荐方案；历史药品进入现病史前必须压缩为规范药名，规格、包装、剂量、频次和总量不得进入正文。`useChronicRefillReview.ts` 在共享结果页管理核查参考选择，医生点击后才把对应 `recordText` 追加或替换到现病史；核查项未选择不阻断整份病历回写。`ChronicRefillReviewPanel.vue` 作为主诊断卡片按钮的锚定非模态浮层默认展开，关闭后可从原按钮重新打开；面板采用紧凑扁平列表，问题依据按需查看，不常驻逐项编号、重点标签或大卡片。慢病渠道禁用普通 `useClinicalResultDiagnosisChecklist.ts` 预取与“主诊核查”入口，避免同位置双浮层和额外模型调用。选择影响续方安全的异常选项时取消药品自动选中。初始诊断及标准诊断库匹配统一使用保留下来的临床诊断，不得把慢病分类组名作为回写诊断；来自历史明确诊断的建议使用 `explicit / high` 语义，诊断依据只拼接一次，不得描述成模型猜测。模型接收有效库存名称与规格，并为最终药品返回结构化剂量、频次和用法；`chronicRefillInventory.ts` 按“历史处方明确值 → 模型结构化值 → HIS 药品默认值”合并，不得以固定 `1`、固定 `14天` 或销售包装单位补齐一次剂量、频次、用法和天数，核心用法不完整时保持未选中。推荐理由只承载临床与历史依据，不得采信模型生成的剂量、疗程或包装算术；结果页通过共享纯函数按最终可编辑处方字段实时生成“单次制剂数 × 每日次数 × 天数 = 总制剂数 → 包装数”的换算说明，并与自动总量共用同一计算口径。库存内同品或经模型确认的库存内等效药进入治疗项；既无同品也无等效药时返回规范通用名并保持未选中。复诊配药结果通过 `recommendationPolicy` 明确禁止共享结果页自动补拉通用治疗方案，默认不生成检查、检验和处置；复诊功能不得依赖语音渠道私有结果类型。
3.1 慢病续方的“自动沿用依据”和“医保周期核查证据”使用同一份近 90 天 HIS 查询结果，但必须是两条独立派生链路。自动沿用继续只消费医生已确认慢病范围内、可可靠归属的最近同药处方；`chronicRefillInventory.ts` 匹配当前库存时先使用历史 `productId`，缺失时再以规范药名、规格和中性 `manufacturer` 收窄候选，最后只允许唯一同名候选自动命中，禁止用 `Array.find` 的首个同名结果替代历史厂家。历史产品缺货或候选仍不唯一时返回未匹配项，不自动选中。PHIS Adapter 从处方子项 `naFac` 映射历史厂家，从药品详情映射当前实际厂家；`TreatmentRecommendationCard.vue` 只读取 `matchedItem.manufacturer`，并在药名与规格同行以可省略的元信息展示，因此医生看到的是本次将要回写的药品厂家，而不是历史厂家推断值。`chronicRefillMedicationHistory.ts` 则从已排除当前 `idVis` 的全部历史就诊中，按药品主键优先、规范药名精确匹配其次收集当前推荐药品的每笔处方，不受慢病诊断过滤影响。Builder 把中性的日期、科室、规格、用法、疗程和总量快照挂到 `TreatmentRecommendation.recentPrescriptionHistory`，`MedicationPrescriptionHistoryReview.vue` 在共享药品卡内显示最近一笔、同单位累计和可展开明细。累计只允许对有效正数且单位归一后相同的记录求和；单位不同、缺失总量和模糊匹配只能逐笔展示。桌面端当前没有权威医保限量规则源，因此该能力只提供只读事实核查，不产生超量结论、不改变推荐选中状态、不阻断回写；后续若接入院内规则，必须以独立结构化规则契约扩展，禁止把阈值硬编码到展示组件。

   PHIS 历史药品属性以 `loadClinicMedicalRecord.presList[].presSubList[]` 为主来源：Adapter 将 `idOrd / idMedPro / naMedPro / naFac / doseOnce / unitDose / idFreq / idFreqText / idUsge / idUsgeText / takeDays / amount / unitSale` 映射为不含厂商命名的 `HisHistoricalMedication`，其中 `naFac` 进入中性 `manufacturer`；原始 PHIS 对象仅保存在 `raw`。关联顺序固定为 `idOrd` 精确匹配、`idMedPro` 唯一匹配、规范药名唯一匹配，不能唯一关联时不继承处方属性。`orderList` 继续用于检验检查类型关联，并在 `presList` 缺失或单项不完整时提供药品名称、总量等兜底。复诊候选按就诊时间选择最近一次同药结构化处方；药品定稿优先消费其 `days`，无结构化或明确文本历史天数时保持为空，模型 `days` 不进入权威处方。

   复诊配药 `ClinicalResultInput.healthEducation` 是门诊病历“注意事项”的场景来源。共享 `useClinicalResultIntentReset.ts` 在没有显式 `outpatientRecord.precautions` 时必须以 `healthEducation` 作为 `buildOutpatientRecord()` 的 `precautions` 输入，避免再次触发通用默认 Builder；慢病复诊 API 对明显泛化的休息、固定一周复诊或无依据上转文案执行拒收并回退到慢病安全教育。`features/consultation-result/model/useClinicalResultPrecautionsScope.ts` 负责在共享结果页内管理系统生成注意事项的诊断作用域：初始结果可作为一次模型基线，当医生已选正式诊断与该基线不一致时，调用 `features/clinical-result/outpatientRecord.ts` 的诊断限定 Builder 重建文案；待鉴别方向不进入作用域。控制器以“当前值是否仍等于最后一次系统值”判断医生是否已手工编辑，医生文本不被自动覆盖；系统重建后同步更新字段初始基线，避免把系统修正误认为医生改稿。`ClinicalDecisionDisclaimer.vue` 只承载统一的临床辅助提示，不改变回写契约和门禁状态。
3.1 多慢病候选不直接进入同一份病历。`chronicRefillAssessment.ts` 为候选保存稳定的“慢病分组 + 历史临床诊断”选项，并把同次多慢病、无处方诊断关联的结构化药品提取为稳定 attribution item；`ReceptionCapsule.vue` 只编排入口开合，`ChronicRefillScopeSelector.vue` 只收集医生多选慢病范围，不渲染后台药品归类状态，再由纯规则构建仅包含已选诊断、相关就诊和可安全归属处方的 scoped candidate。前述“范围选择不调用模型”仅指医生勾选动作本身；药品归类是候选发布后的独立后台静默请求，不阻塞诊断选择。病历模型、结果页核查、确定性 Builder、初始诊断和用药定稿均只消费该 scoped candidate。`useDiagnosisSelection.ts` 负责共享结果页的初始勾选策略：慢病复诊渠道把 scoped candidate 生成的全部正式诊断设为已选，首个标准诊断作为主诊断、其余保留为已选次诊断；这些医生已确认的慢病诊断不受普通 AI 正式建议最多 3 项的截断。语音和症状问诊继续只默认选择一个主诊断。该策略只消费已经进入结果的正式诊断，不得恢复胶囊中未选慢病或把待鉴别方向升级为正式诊断。某次历史就诊同时含多个慢病、但 HIS 未提供处方与诊断的直接关联时，全部相关慢病均被选中才允许直接继承全部处方；部分选中时，`reception-risk/api/chronicRefillMedicationAttribution.ts` 通过签名服务端快速模型在该次就诊的既有慢病候选内异步生成“药品 → 慢病”归类，输出必须按稳定 item id 和 condition id 白名单归一，模型新增的药品或诊断一律丢弃。`scopeChronicRefillCandidate()` 自动恢复 suggested condition 落入医生已选范围且 confidence 为 high / medium 的结构化药品，不再消费逐药勾选状态；low、未归类或请求失败的药品继续只存在于不受慢病范围裁剪的 `prescriptionHistoryVisits`，供同品历史事实核查。生成后所有药品仍继续经过共享药品定稿流水线，并在结果页保持可取消、可调整，AI 归类不等于最终回写。接诊 controller 先发布本地候选再后台归类，迟到结果同时经过 reception flow token 和当前 candidate key 校验；多慢病部分选择时，`ChronicRefillScopeSelector.vue` 只用内部 loading 门禁延后提交，按钮文案和胶囊内容保持稳定，ready / failed 后再提交，避免空结果抢跑且不向医生暴露归类过程。归类失败不得阻塞无历史药品的安全降级方案。
4. 统一上下文同时保存身份信息、展示信息、结构化 `hisHistory`、历史摘要与接诊状态。
5. UI、AI prompt、日志、缓存等模块不得再各自维护 `naPi/name`、`sdSexText/gender`、`ageText/age` 的读取分支；统一通过患者上下文 helper / selector 读取。
6. `show-patient-risks`、`start-consultation`、`start-consultation-session`、`start-voice-consultation` 都必须复用同一套上下文构建逻辑，不能绕过 HIS 补全直接写全局状态。
7. 所有会异步写入患者上下文、风险列表、风险 loading 或复诊候选的接诊入口必须绑定同一个 reception flow token。新接诊、显式风险事件或结束就诊会使旧 token 失效；旧 HIS / LLM 响应不得覆盖新患者或新就诊状态。
8. 患者身份与 HIS 上下文补全成功即表示接诊成功；健康风险评估属于可降级的后置能力。风险上下文必须分别传递显式既往史与 `HisPatientHistory.visits[].diagnoses` 形成的结构化历史诊断摘要：历史诊断用于识别持续性慢病风险，但不得把历史急性疾病或症状当成本次急症；不得为了风险分析把按日期排列的门诊流水重新写入 `pastMedicalHistory`。风险模型失败时保留已接诊患者和胶囊入口，单独展示风险评估失败，不得回退成“接诊处理异常”。模型仍返回结构化 `RiskItem[]`，`features/reception-risk/lib/riskPresentation.ts` 在写入接诊 session 前统一完成胶囊文案规范化：慢病只保留疾病名称与核心关注点，过长的外部传入或旧格式文案也必须收敛；`ReceptionCapsule.vue` 只负责展示规范化结果，不在模板或 CSS 中隐式截断医疗语义。
9. `features/reception/model/useReceptionSessionController.ts` 是接诊胶囊局部状态的唯一所有者，保存 `status / risks / opportunities / executing` 等接诊阶段状态，并只通过显式 action 修改。患者姓名、性别和完整 `ageText` 必须从应用级 `currentPatient` 派生，不再维护可漂移的第二份患者展示状态；胶囊、风险面板和头像解析必须直接消费完整年龄文本，禁止先 `parseInt` 再在 UI 拼接“岁”。该 controller 是 App 生命周期内的局部 composable，不新增 Pinia store。
10. 门诊接诊后的业务分流统一由 `features/reception/model/useOutpatientScenarioRouter.ts` 承担。候选统一建模为 `ReceptionOpportunity` 判别联合类型；复诊配药确认和语音入口的报告复诊 / 缓存恢复 / 普通录音决策都从该路由进入。`useEventListeners.ts` 只转交入口事件，`useReceptionController.ts` 只产出机会，不直接打开具体结果页。
11. 报告回诊聚合上下文属于当前接诊 session 的 `report-follow-up` opportunity，不得写入 `PatientContext.raw`。报告回诊与慢病复诊配药互斥，当前就诊文本出现携报告、查看检验检查结果或报告解读语义时，`report-follow-up` 的分流优先级高于 `chronic-refill`。App 必须把上下文作为显式 prop 传给 `OutpatientFollowUpPage`，页面再显式传给治疗推荐 controller；患者上下文只保存患者与就诊事实，`raw` 继续只承载厂商原始字段。
11.1 接诊阶段的历史报告识别复用 `fetchPatientHistory()` 已经取得的近 90 天 `loadClinicMedicalRecord` 明细。PHIS Adapter 负责把厂商 `applyList[].items[]` 映射为 `HisVisitRecord.reportedApplications` 中性摘要，并保留 `visitId`；业务层仍只按近 14 个自然日筛选报告机会，只有 `sdApply = 3` 才进入 `report-interpretation` opportunity，不得因为配药历史窗口扩大而扩大报告助手的 14 天口径，也不得把检查/检验医嘱当成已出报告。进入报告工作台后，`features/report-interpretation/api` 再通过 `HisAdapter.fetchOutpatientFollowUpReportResults()` 按历史 `visitId` 获取实际报告，避免接诊阶段批量加载报告正文或调用 LLM。
11.2 风险胶囊对报告场景只提供一个“报告助手”动作：历史报告进入报告解读工作台，本次报告回诊上下文同时存在时由工作台提供“生成后续诊疗方案”升级动作。报告解读是只读认知辅助，不直接形成诊断、处方或 PHIS 回写；报告回诊继续复用 `OutpatientFollowUpPage` 和治疗推荐回写闭环。两种 opportunity 可以同时存在于 session，但 UI 不展示两个相似入口。
12. 慢病复诊的病历事实与推荐上下文必须分层：`chronicRefillRecord.ts` 可以把有效库存名称和规格发送给模型生成治疗方案，但 `historyOfPresentIllness` 只能使用患者诊断、历史用药和本次病情等事实。规则兜底不得拼接库存摘要；模型现病史命中库存、可续方或推荐方案语义时视为不合格，回退到事实型草稿。
13. 慢病复诊核查采用“单次 LLM 结果 + Composable Controller + deterministic record Builder”：模型在病历结果中同时返回最少问题、选项和推荐值，程序只做数量、结构和证据字段校验；医生在共享结果页点击选项是把推荐值升级为病历事实的唯一门禁。等待态由结果域 session controller 管理，不新增全局 store，也不恢复独立确认页。
14. 慢病长处方采用“渠道语义 -> HIS 中性签约状态 -> 中性回写契约 -> PHIS 私有映射”的单向链路：PHIS Adapter 使用慢病专用患者查询返回签约事实并映射为中性 `signed`，共享结果页仅在 `chronic-refill`、最终 `orderList` 含药品且 `signed === true` 时，由 `recordConfirmedPayload.ts` 发送 `prescriptionAttributes.chronicLongTerm = true`；未签约、状态未知、其他渠道和无药回写省略该对象并按普通处方处理。PHIS `MedHermes.js` 在诊断保存前复用 `searchByIdPiMB` 的患者签约状态与院内慢病诊断配置校验，再把中性属性作为兼容新增的 `saveAIPresWithAttributes` 独立处方属性参数传给后端，原三参数 `saveAIPres` 保持不变；`ClinicDoctorCoreAIModule` 只对普通西药 / 中成药处方头设置 `HiOdsPresVO.slowMedicine = "1"`，明细 `orderList` 不承载 PHIS 私有标记，打印继续读取已落库处方头。

---

## 组合式函数 (Composables)

Composables 是架构的核心，封装可复用的业务逻辑。

### `useWindowManagement.ts` ✅

**文件**: [src/app/shell/useWindowManagement.ts](src/app/shell/useWindowManagement.ts)

**行数**: 422 行

**职责**: 窗口位置、尺寸、显示器管理

**核心功能**:
- ✅ 保存/恢复窗口位置（带边界验证）
- ✅ 智能调整窗口位置（边界检测，防止超出显示器范围）
- ✅ 窗口尺寸调整（包含 Resizable 状态管理）
- ✅ 显示器信息缓存（性能优化，避免频繁调用 `currentMonitor`）
- ✅ 等待窗口尺寸达到目标值（确保动画完成）
- ✅ 窗口移动防抖处理（500ms）
- ✅ Tauri `Window` / `Store` 实例通过浅引用传递，避免被 Vue 深代理后触发私有字段异常；独立窗口展示需在 capability 中显式放行 `window.show`

**导出 API**:
```typescript
{
  // 状态
  cachedMonitor: Ref<Monitor | null>,
  lastBallPos: Ref<{x: number, y: number} | null>,
  isMoving: Ref<boolean>,

  // 方法
  saveWindowPosition: () => Promise<void>,
  restoreWindowPosition: () => Promise<void>,
  updateCurrentMonitor: () => Promise<void>,
  smartExpand: (width: number, height: number) => Promise<void>,
  waitForWindowSize: (logicalW: number, logicalH: number) => Promise<void>,
  resizeWorkWindow: (targetW: number, targetH: number) => Promise<void>,
  handleWindowMove: () => void
}
```

**使用示例**:
```typescript
const windowMgmt = useWindowManagement({
  appWindow,
  store: storeRef,
  isWorking,
  transitioning,
});

// 智能展开窗口（自动边界检测）
await windowMgmt.smartExpand(1200, 900);

// 恢复窗口位置
await windowMgmt.restoreWindowPosition();
```

---

### `useWorkMode.ts` ✅

**文件**: [src/app/shell/useWorkMode.ts](src/app/shell/useWorkMode.ts)

**行数**: 429 行

**职责**: 工作模式（展开/收起）切换逻辑

**核心功能**:
- ✅ 进入工作模式（小球展开为面板，支持动态尺寸）
- ✅ 退出工作模式（面板收起为小球，平滑动画）
- ✅ 计算变形动画原点（基于小球位置）
- ✅ 管理过渡状态（防止动画冲突）
- ✅ 智能收起逻辑（问诊→胶囊 or 完全退出）
- ✅ reception-capsule 始终以 `WINDOW_SIZES.RISK_CARD` 作为默认收起尺寸，避免不同入口出现两套胶囊几何
- ✅ 会话生命周期管理（集成 feedbackService）
- ✅ Always-on-Top 状态切换

**导出 API**:
```typescript
{
  // 状态
  exiting: Ref<boolean>,
  ballOffset: Ref<{x: number, y: number}>,
  morphOrigin: Ref<string>,
  containerStyle: ComputedRef<Record<string, string>>,
  ballStyle: ComputedRef<Record<string, string>>,

  // 方法
  enterWorkMode: (customW?: number, customH?: number) => Promise<void>,
  exitWork: (sessionStatus?: 'completed' | 'cancelled' | 'error') => Promise<void>,
  handleCollapse: () => Promise<void>
}
```

**使用示例**:
```typescript
const workMode = useWorkMode({
  appWindow,
  windowMgmt,
  currentView,
  isWorking,
  transitioning,
  isHovered,
  currentPatient,
  getReceptionWindowSize,
  store: storeRef,
});

// 进入工作模式（默认尺寸）
await workMode.enterWorkMode();

// 进入工作模式（自定义尺寸）
await workMode.enterWorkMode(360, 80);

// 智能收起（根据上下文决定收起到胶囊还是完全退出）
await workMode.handleCollapse();
```

---

### `useNavigation.ts` ✅

**文件**: [src/app/navigation/useNavigation.ts](src/app/navigation/useNavigation.ts)

**行数**: 194 行

**职责**: 应用内视图导航管理

**核心功能**:
- ✅ 统一管理所有视图导航逻辑
- ✅ 自动触发工作模式切换
- ✅ 自动调整窗口尺寸
- ✅ 集成视图切换追踪

**导出 API**:
```typescript
{
  // 基础导航
  openSettings: () => Promise<void>,
  openChat: () => Promise<void>,
  openAnalytics: () => Promise<void>,

  // 业务导航
  openHisIntegrationLog: () => Promise<void>,
  openMedicalCatalogCache: () => Promise<void>,
  openConsultation: () => Promise<void>,
  openKnowledgeBase: () => Promise<void>,
  startVoiceInteraction: () => Promise<void>
}
```

**使用示例**:
```typescript
const navigation = useNavigation({
  appWindow,
  currentView,
  isWorking,
  currentPatient,
  windowMgmt,
  workMode,
});

// 打开设置页（自动展开窗口）
await navigation.openSettings();

// 打开主问诊页（自动调整窗口尺寸）
await navigation.openConsultation();
```

---

### `useVoiceFeedback.ts` ✅

**文件**: [src/features/feedback/model/useVoiceFeedback.ts](src/features/feedback/model/useVoiceFeedback.ts)

**职责**: 结果页反馈编排（兼容历史 voice 命名）

**核心功能**:
- ✅ 登记语音结果页诊断 / 治疗推荐快照，便于后续反馈引用稳定 targetId
- ✅ 支持把页面已落库的 recommendationId 反注册回反馈编排层，供症状问诊等非语音页面复用同一套推荐反馈弹窗与提交链路
- ✅ 管理单条推荐反馈与整页评分草稿；病例字段级反馈已从产品入口和运行时编排移除
- ✅ 调用 `feedback.ts` 完成本地推荐反馈与整页反馈落库
- ✅ 调用 `voiceFeedback.ts` 生成后续可直推后台的推荐与整页反馈标准 payload；旧字段反馈 payload 仅作为历史数据兼容解析保留
- ✅ 负责从本地恢复未提交的语音反馈草稿，避免医生误关窗口后丢失
- ✅ 旧路径 [src/composables/useVoiceFeedback.ts](src/composables/useVoiceFeedback.ts) 仅保留兼容 re-export；新调用默认从 `@features/feedback` 消费

**导出 API**:
```typescript
{
  registerRecommendations: () => Promise<void>,
  registerExternalRecommendationTarget: () => void,
  submitRecommendationFeedback: () => Promise<void>,
  submitSessionFeedback: () => Promise<void>,
  restoreVoiceFeedbackDraft: () => void,
  clearVoiceFeedbackDraft: () => void,
}
```

---

### `useVoiceConsultation.ts` ✅

**文件**: [src/composables/useVoiceConsultation.ts](src/composables/useVoiceConsultation.ts)

**行数**: 262 行

**职责**: 语音问诊完整业务流程，并按 `consultationId` 缓存语音病例解析结果

**核心功能**:
- ✅ 处理语音停止事件（转录 + LLM 生成）
- ✅ 命中本地缓存时跳过重复 LLM 解析，应用重启后可恢复未提交结果
- ✅ 缓存 key 优先使用 `idVis`（就诊 ID），同患者多就诊互不串扰；缓存跨自然日自动失效，且当前接诊切换到其他患者时会清理上一患者语音缓存
- ✅ 通过 `editorSnapshot` 持久化整张语音病历快照（治疗方案、诊断、病历文本、当前选中诊断），下次同就诊恢复时直接复用，跳过 `fetchAITreatment`
- ✅ 当实时转写为空时，自动使用音频文件兜底转写
- ✅ LLM 病历生成（结构化 JSON，包含病例草稿、诊断/项目/药品提示与来源标记）
- ✅ 对语音抽取结果做结构校验与一次修复重试；流协议边界同时兼容标准 NDJSON、单对象换行格式、连续 JSON 对象和事件数组，避免模型只改变分帧格式就误入整段修复
- ✅ 对明确医嘱分区执行独立安全校验：无法确认字符串 `type` 或规范名称的异常条目仅从医嘱候选中隔离并记录协议告警，不得取消已可用的病历、诊断和诊疗路由
- ✅ JSON 解析和验证
- ✅ 病历确认并提交到 HIS
- ✅ 错误处理和降级

**导出 API**:
```typescript
{
  // 方法
  handleVoiceStop: (audioBlob: Blob, transcribedText: string) => Promise<void>,
  handleVoiceError: (err: any) => void,
  handleResultConfirm: (record: GeneratedRecord) => Promise<void>,
  cancelVoiceResult: () => Promise<void>,
  // 模块级缓存接口（顶层导出）
  // updateVoiceConsultationCache(patient, snapshot): 写回 editorSnapshot（实现位于 features/voice-consultation/model/voiceConsultationCache.ts）
  // getVoiceConsultationEditorSnapshot(patient): 读取 editorSnapshot（实现位于 features/voice-consultation/model/voiceConsultationCache.ts）
}
```

**使用示例**:
```typescript
const voiceConsultation = useVoiceConsultation({
  appWindow,
  currentView,
  generatedRecord,
  currentPatient,
  showToast,
  windowMgmt,
  workMode,
});

// 处理语音停止（自动调用 LLM 生成病历）
await voiceConsultation.handleVoiceStop(audioBlob, transcribedText);

// 确认并提交病历
await voiceConsultation.handleResultConfirm(record);
```

---

### `useMinimizedSessions.ts` ✅

**文件**: [src/composables/useMinimizedSessions.ts](src/composables/useMinimizedSessions.ts)

**职责**: 跟踪症状问诊 / 语音问诊从问诊态收起到悬浮球后的"最小化"现场

**核心功能**:
- ✅ 两个独立槽位：`symptom` / `voice`，可同时存在
- ✅ 以 `idVis`（缺失时降级 `idPi / patientId / id`）作为锚点；切换患者不丢弃旧会话
- ✅ 跨自然日自动失效，并在 init 时一次性清理
- ✅ 持久化到 `localStorage` (`MINIMIZED_SESSIONS_V1`)，仅存元数据（patientId/Name、anchorId、recordedAt），不存业务状态
- ✅ `latestType` 计算属性供"双击悬浮球恢复最近一个最小化会话"使用
- ✅ 症状问诊数据和内部页签由 `ConsultationPage.vue` 常驻 `v-show` 实例 + `useSymptomConsultationCache` 快照保留；收起到接待胶囊或从小球恢复时不得调用内部复位方法

**导出 API**:
```typescript
{
  symptomSession, voiceSession,
  hasSymptom, hasVoice, latestType,
  getActive(type),
  record(type, patient),
  clear(type),
  clearAll()
}
```

**约束**:
- 业务状态必须由各问诊链路自己承接：症状问诊由 `useSymptomConsultationCache` 按就诊锚点保存内部页面、症状、表单、病历、推荐和引用回执快照，语音问诊病历快照由 `useVoiceConsultation.editorSnapshot` 承接；本模块只负责"是否最小化、何时、对应哪个就诊"三件事

### `useSymptomConsultationCache.ts` ✅

**文件**: [src/composables/useSymptomConsultationCache.ts](src/composables/useSymptomConsultationCache.ts)

**职责**: 为智能问诊保存与恢复未结束现场，语义对齐语音问诊缓存

**核心功能**:
- ✅ 以就诊锚点为 key 写入 `localStorage` (`SYMPTOM_CONSULTATION_CACHE_V1:{consultationId}`)
- ✅ 保存内部页面、问诊模式、症状选择、动态表单、病历草稿、诊断、治疗推荐、引用回执和知识面板基础状态
- ✅ 跨自然日自动失效；诊毕回写成功或确认放弃时显式清除，其中结果页“放弃”会清空页面内状态并直接退回悬浮球
- ✅ 恢复时只作用于同一就诊，避免切换患者污染

---

### `useEventListeners.ts` ✅

**文件**: [src/composables/useEventListeners.ts](src/composables/useEventListeners.ts)

**行数**: ~575 行

**职责**: 统一管理 App 级 Tauri 事件监听、deep link、window listen 和事件到导航 / controller 的分发

**核心功能**:
- ✅ Deep Link 单点监听（仅在 `useEventListeners` 注册）
- ✅ HIS 集成事件监听
  - `receive-patient` - 接诊入口；具体患者补全、并发保护和风险胶囊加载委托 `app/events/useReceptionController.ts`
  - `show-patient-risks` - 风险提示入口；具体患者补全、风险状态和患者切换清理由 `app/events/useReceptionController.ts` 处理
  - `start-consultation` - 开始问诊
  - `start-consultation-session` - HIS 灵活模式 / assist 兼容事件（普通推荐打开 `ConsultationPage` 并写入自动触发上下文；`treatment_plan` / `diffDx` 分别打开独立诊疗方案页和独立鉴别诊断小窗）
  - `stop-consultation` - 停止问诊；视为诊毕/结束接诊，会清空当前患者上下文、当前就诊的语音缓存和问诊最小化恢复入口
  - `start-voice-consultation` - 语音问诊；来自 HIS / HTTP Bridge 的显式开始语音请求会先按目标患者 `idPi / patientId` 判断是否存在未提交缓存：同患者且存在缓存时直接恢复到语音结果页，否则开启新语音会话；仅在已处于录音胶囊页时对重复请求做幂等忽略
  - `start-inpatient-emr-generation` - 住院病历辅助生成；来自 `/api/inpatient/emr/generate`，打开 `features/inpatient-emr` 独立工作视图并按 `admissionId + templateId + templateName + htmlContent + recordTime?` 生成可回写预览
  - `sdk-handshake` - 订阅 HIS 握手事件；payload 解析、`HisService` 初始化、反馈 actor 和基础数据上下文由 `app/events/useSdkHandshakeController.ts` 处理
- ✅ 鼠标事件监听
  - `hover-change` - 小球交互范围悬停状态，作为环绕菜单唯一展开条件
  - `mouse-pos` - 鼠标位置（环绕菜单高亮）
- ✅ 窗口事件监听
  - `tauri://move` - 窗口移动
  - `tauri://resize` - 窗口大小变化（通过 `getWindowSizeForView(currentView)` 自愈）
- ✅ 自动清理所有监听器（含 Deep Link/HIS/mouse/window，防止重复处理和内存泄漏）

**导出 API**:
```typescript
{
  // 方法
  registerAllListeners: () => Promise<void>,
  unregisterAllListeners: () => void
}
```

**使用示例**:
```typescript
const eventListeners = useEventListeners({
  appWindow,
  currentView,
  isWorking,
  transitioning,
  isHovered,
  hoveredBtnIndex,
  ringMenuRef,
  currentPatient,
  receptionSession,
  showToast,
  handleWindowMove,
  workMode,
  navigation,
  exiting,
  resizeTimeoutRef,
});

// onMounted 中一行注册所有监听
await eventListeners.registerAllListeners();

// onUnmounted 中一行注销所有监听
eventListeners.unregisterAllListeners();
```

---

## 组件 (Components)

组件负责 UI 渲染和用户交互，不包含复杂业务逻辑。

> Tauri 回执监听的活跃门禁必须使用 App 外层 `currentView` 注入的 `active` 状态；使用 `v-show` 常驻保活的页面不能只依赖组件内部页签判断，否则隐藏页面仍会处理 `consultation-reference-feedback` 这类 PHIS 回执。

> 共享结果页的诊断不确定性采用两层机制：诊断推荐同批返回的“待鉴别方向”是尚不能成立的候选疾病列表；主诊断稳定后，`useClinicalResultDiagnosisChecklist.ts` 按“就诊 + 标准诊断 + 当前主诉/现病史”后台预取“主诊断核查要点”，用于复核当前主诊断一致性和高危漏排，并通过 `diagnosisChecklistRequest.ts` 使用轻量模型。两层不可互相替代：前者是疾病候选，后者是核查动作。待鉴别项默认仍不参与诊断选择、治疗或回写；医生通过 `useDifferentialDiagnosisDirection.ts` 先将其纳入当前结果页局部诊疗方向，再可打开已有补充说明流程完善依据。只有医生再次显式转入、且项目已匹配标准诊断库时，`diagnosisSuggestionPresentation.ts` 才允许该项越过低置信分区进入正式诊断列表；转入项加入现有选择集合但不替换已有主诊断，因此不会自动改变治疗依据。普通核查结果只更新卡片状态，严重不匹配或高危漏排才主动展开；浮层必须完整消费缓存中的全部条目并展示每项全文，内容较多时只在清单区域滚动，标题和关闭入口保持可见。两类状态都只在当前结果页实例内存在，不新增全局 store；语音缓存仅序列化必要的方向 key，患者或就诊切换必须清空，迟到结果不得覆盖新上下文。

> 普通语音问诊采用“单次结构化流 + 后台治疗分支 + 前台依赖有序”的渐进结果架构。`useVoiceIntentRecognition.ts` 使用独立版本化的 `voiceIntentRecognitionStream` Prompt，按 NDJSON 输出核心病历、病历上下文、AI 候选、诊断、诊疗路由、明确医嘱与其余病历字段；`useClinicalResultProgressiveIntentApplication.ts` 以患者 / 就诊 / `consultationRoundId` 为会话锚点，只在新轮次首次重置结果页，后续分区和 complete 仅增量应用，禁止重复整页 reset 覆盖已到达内容。`record_suggestions` 在同一次临床推理中生成，并在开放编辑前经统一正文质控和显式事实去重合并；缺失该分区时才由原稳定态 scheduler 兜底一次。`useClinicalResultGenerationSequence.ts` 只在 `voice` 渠道维护诊断请求模式、初始诊断恢复和治疗展示依赖：已选正式诊断与 `recommendation_plan` 同时就绪后，药品分支与检查 / 检验联合分支可后台并行；检查和检验共享一次实时目录上下文与一次轻量模型请求，前台由 `useTreatmentSections.ts` 合并成单个联合进度，完成后再按固定“检查、检验”顺序原子落位。普通语音调用 `ClinicalGenerationProgress.vue` 时只呈现结构化病历流、诊断恢复或生成错误，不再为治疗分支额外渲染顶部“院内目录匹配”阶段；治疗进度由 `TreatmentGenerationPlaceholder.vue` 在治疗区表达，目录引用绑定、项目详情补全与库存校验继续后台静默执行。共享结果页的其他渠道仍可保留顶部治疗反馈，但统一使用“生成诊疗方案”业务表达。明确医嘱作为医生已表达事实可先展示；`explicitTreatmentCatalogResolver.ts` 对名称明确的项目继续确定性匹配，对“B超、CT、化验”等上位表达则把本次完整对话、病历和正式诊断作为同一次目录映射请求的上下文，只允许从本次实时目录候选中返回 high / medium 置信的标准项目，并同步生成 `goal / goalGroup / goalGroupPurpose / necessity / reason`；补全结果保持未选中，原始对话表述保存在 `originalName / evidenceText`，医生勾选才完成临床确认，低置信或无唯一候选继续待匹配。`auxiliaryRecommendationPresentation.ts` 把已匹配与待匹配的明确项目分别标记为“对话明确项目”和“对话明确项目（待匹配）”；带完整补全目标的明确项目可按“对话明确 · 临床目标”细分，但不得混入 AI 自主推荐组。AI 生成项在初始正式诊断稳定前不得显示或进入回写选择，并由 `institutionAuxiliaryCatalog.ts` 同时校验本次实时目录引用和完整 `goal / goalGroup / goalGroupPurpose / necessity / reason`，任一不满足即丢弃。早到明确医嘱或旧结果缺少临床目标元数据时不生成通用目标标题和用途，但优先展示已有 `goal`，否则从真实 `evidenceText / reason` 截取简明来源说明，避免真实内容消失。流中已出现有效 `diagnoses` 分区但只有待鉴别项时不得追加诊断请求或启动治疗；仅旧结果完全缺失诊断分区时允许普通语音恢复一次。手动刷新保留上一版稳定内容，初始恢复才使用阻断型诊断进度。核心病历完成后页面允许阅读和编辑，诊断初始恢复或治疗分支未收口时一键回写继续禁用。检查 / 检验仍消费本次接诊实时目录全集，只在模型输入序列化时省略“通用 / 单项”等默认元数据并使用轻量模型降低目录推荐长尾，不裁剪任何可开立项目；`manualMatchCache.ts` 对检查 / 检验禁用跨接诊持久映射并清理旧条目，防止历史人工匹配参与新接诊，药品与非检查检验处置仍可按原作用域复用；药品仍走共享定稿流水线。`chronic-refill` 不进入该普通语音状态机，仍由慢病专用流和策略收口；报告回诊由 `OutpatientFollowUpPage` 复用独立 `features/treatment-plan`，不经过共享语音结果时序。该优化不改变 `record-confirmed` 或 PHIS Bridge 契约。

> 普通语音诊断在进入共享结果页前额外经过 `features/voice-consultation/lib/ordinaryVoiceDiagnosisGuard.ts` 的纯规则门禁。`voiceIntentRecognitionStream` 的诊断分区声明 `clinicalRole`、`diagnosisKind`、`evidenceScope` 与 `currentVisitEvidenceText`：`history_only / risk_modifier` 直接退出诊断建议区，不能解释本次主诉的历史共病不再降级为待鉴别；`differential_cause` 只允许表达可解释当前主诉的病因候选。若标准库匹配后不存在病因性正式诊断，门禁可从 `current_visit / both`、high / medium、本次肯定证据充分且匹配 R 类标准编码的症状候选中最多提升一项为 `symptom_working` 正式诊断，其余 R 类症状项退出诊断建议区而不进入待鉴别。该工作诊断经 `diagnosisSuggestionPresentation.ts` 保持在正式区并由 `DiagnosisRecommendationCard.vue` 明示“症状性工作诊断”，同时把诊疗路由限制为 `diagnostic_first` 的检查 / 检验分支，不启动 AI 药品推荐；明确医嘱与急诊转诊继续保持原优先级。旧 Prompt 缺少新角色字段时，门禁仍根据历史上下文、证据语义和标准 R 编码做兼容过滤与提升。规则分别在语音抽取归一和共享结果页 voice 初始化处执行，缓存 key 升级为 V3，避免旧 V1/V2 快照恢复已退出诊断区的历史共病。症状问诊与已确认范围的慢病复诊不经过此门禁。

> 检查、检验和处置推荐的执行科室属于 HIS 项目详情，不由 AI 推荐文本推断。标准项目进入共享结果页可见列表后，页面编排层立即调用 `useTreatmentHydration.hydrateMatchedMedicalItemDetails()` 后台补全；composable 按推荐项复用进行中的详情请求、跳过已加载详情并暴露读取态，选中校验复用同一请求作最终门禁。医生通过控件手动清空后以 `execDeptCleared` 为准，不得因预取、缓存恢复或再次校验自动补回。

### 核心组件列表

| 组件 | 职责 | 文件 |
|------|------|------|
| `ChatPanel.vue` | LLM 对话界面；助手回复宽度跟随消息区可用宽度，用户短消息保持紧凑右对齐；页面持有默认关闭的会话级联网开关，并只通过 `LLMConfigOverride.enableWebSearch` 为 `chat-stream / chat_panel` 流式请求声明联网意图；聊天语音按钮只编排 UI、输入回填与错误提示，录音和实时语音会话交由 `features/chat/model/useChatVoiceInput.ts` | [src/components/ChatPanel.vue](src/components/ChatPanel.vue) |
| `SettingsPanel.vue` | 系统设置 shell：只保留通用设置与关于版本，负责主题、窗口置顶、区域后台地址/机构编码、连接测试、音频输入设备、语音录音目录、缓存管理和 HIS 联调日志入口；不再提供模式开关或模型/语音/知识库密钥配置。音频输入设备、录音目录和保存快照分别下沉到 settings model，通用页签与保存条为受控 UI | [src/components/SettingsPanel.vue](src/components/SettingsPanel.vue) |
| `ConsultationPage.vue` | 完整症状问诊主链路，同时承接新的“内嵌灵活模式”；支持根据 `/assist` 上下文直接跳过症状采集进入病历详情页，继续复用现有推荐诊断、诊断鉴别、推荐用药、推荐检查与诊断路径能力；进入 `record` 阶段后不再继续内嵌维护旧结果页，而是把当前病历、诊断、治疗快照切换到独立的症状结果页包装组件，由后者复用共享结果页主体；PHIS 引用闭环状态仍由症状包装层承接；患者 / 就诊锚点变化时是硬 reset 边界，必须清空上一患者的症状、诊断、治疗方案、缓存快照和事实核查状态，并递增 AI 请求序列作废慢响应；页面 scoped 样式原样外置到 `features/symptom-consultation/ui/ConsultationPage.css`，SFC 继续保留模板、脚本和问诊状态机；AI 推荐链路采用成功后覆盖与当前诊断上下文校验，解析失败或慢请求过期时保留上一版结果；患者文本读取、既往史解析、患者草稿/诊断预填、诊断 identity / AI 请求防串线、同类诊断候选 / 替换列表更新、病历草稿 AI 请求规格与本地兜底、病历草稿主诉 / 现病史本地拼装、中医诊断证候 / 治法映射、诊断展示分组、诊断 / 治疗事实核查编排、LLM JSON 宽容解析、诊断/治疗推荐反馈目标落库 / 注册编排、完成问诊推荐采纳 / 拒绝埋点编排、医嘱文案生成、最终报告数据拼装、当前医疗 payload、智能问诊用户日志快照、PHIS 引用 key / 状态图 / 回执归一 / 引用展示判断等数据处理逐步下沉到 `features/symptom-consultation/lib|model`；western 诊断 raw 映射、western 治疗推荐 raw 映射和 PHIS 提交前治疗选择 / 库存提示 / 处理意见摘要复用 `features/clinical-result`；同类诊断卡片内联下拉开合与候选状态复用 `features/consultation-result/model/useRelatedDiagnosisDropdown.ts`，页面仅保留候选来源、诊断替换、选中同步和埋点；页面层只保留状态、副作用依赖注入和流程编排 | [src/components/ConsultationPage.vue](src/components/ConsultationPage.vue) |
| `entities/patient/*` | 患者实体展示与后续稳定转换归属。当前 `PatientHeader.vue` 是无副作用患者头部展示组件，接收 patient/payType/avatar props 和 actions slot，复用既有 patientContext / patientAvatar 工具解析姓名、性别、年龄、过敏史和头像；不持有问诊流程状态、不调用 Tauri / HIS / toast。智能问诊和语音问诊均通过 `@entities/patient` 复用，旧 `src/components/PatientHeader.vue` 已删除 | [src/entities/patient](src/entities/patient) |
| `features/symptom-consultation/*` | 智能问诊主流程的无 UI 辅助层：`model/useSymptomCategoryFilter.ts` 管理症状系统分类筛选下拉的已选分类、开合、按钮文案和外部点击关闭判断；`model/useCompanionSymptoms.ts` 管理伴随症状选中集合、名称派生、按关联表生成推荐和升级详细问诊后的移除；`model/useSymptomSelectionController.ts` 管理症状选中 / 取消 / 移除 / 清空和模板表单初始化，最大数量提示、埋点和伴随症状清理由页面通过 options 注入；`model/useSymptomCollectionController.ts` 组合分类筛选、伴随症状、症状选中、过滤结果、渲染计划和表单 key 同步，模板同步、动态症状 AI、缓存恢复、生成病历和 PHIS 回写仍由页面编排；`model/useConsultationAssistController.ts` 编排 assist 快进入口的病历/诊断上下文保障、按类型触发推荐/鉴别清单和成功后的埋点入口，AI 请求、toast、视图切换、预填、埋点和自动触发消费均由页面注入；`lib/symptomFiltering.ts` 负责症状列表的系统分类过滤、适用性别过滤、名称 / 拼音 / 首字母搜索纯函数；`lib/symptomFormData.ts` 负责症状模板字段默认值构造、字段 key 兼容和 checkbox mutualExclusions 数组处理；`lib/consultationRenderPlan.ts` 负责选中症状、问诊模式和当前 formData 到 renderList、需初始化 key、需清理 key 的纯计划；`lib/consultationFormConfigs.ts` 保存一般情况问诊和中医四诊的静态表单配置常量；`lib/consultationFormValidation.ts` 负责根据选中症状、formData、患者信息和注入的适用性判断生成必填错误列表、错误 key map 和首个错误 DOM id；`lib/consultationAssistPresentation.ts` 负责 assist 快进入口的展示标签、提示文案、banner tone / 样式和功能统计 featureCode 映射；`lib/consultationRecommendationPresentation.ts` 负责智能问诊推荐区的治疗推荐可见性、卡片显示、类型标签、诊断置信度 class 和药品行内摘要纯派生；`lib/consultationPatientText.ts` 负责患者/病历记录文本读取、既往门诊摘要过滤与既往史解析；`lib/consultationPayloadBuilders.ts` 根据显式入参构造当前问诊摘要、诊断列表、PHIS 引用/草稿医疗 payload 和用户日志快照；`lib/consultationPrefill.ts` 根据患者上下文和当前草稿/诊断状态推导预填动作；`lib/consultationReference.ts` 负责 PHIS 引用项类型、引用 key、状态 map 更新、回执 payload 归一、引用按钮文案和治疗类型到引用 action 的映射；`lib/consultationDiagnosisContext.ts` 负责诊断 identity 与 AI 请求防串线纯判断；`lib/consultationDiagnosisSwap.ts` 负责同类诊断候选过滤、替换时的列表更新和选中诊断同步判断，诊断 identity 与标准库候选查询函数均由页面显式注入；`lib/consultationGeneratedRecord.ts` 负责选中症状、表单数据、一般情况、四诊和伴随症状到 generatedRecord 草稿的纯拼装；`lib/consultationDiagnosisMapping.ts` 负责中医诊断项证候 / 治法匹配、伪码补齐和置信度排序，western 诊断 raw 匹配委托 `features/clinical-result/clinicalResultAiMapping.ts` 并通过策略保持 code 优先和未匹配清空临时 id；`lib/consultationTcmSigns.ts` 负责中医四诊表单到 AI prompt 文本和最终报告四诊文本的纯格式化；`lib/consultationGeneralCondition.ts` 负责一般情况表单到现病史片段的纯格式化；`lib/consultationDiagnosisGrouping.ts` 负责中医单组与西医 ICD10 展示分组、未知组兜底和分组排序，ICD10 分类查询函数由页面显式注入；AI 治疗推荐 raw 映射已收敛到 `features/clinical-result/clinicalResultAiMapping.ts`，症状域不再维护专属治疗推荐 mapper；`lib/consultationLlmJsonParser.ts` 负责去 BOM / markdown fence / 平衡括号候选扫描 / JSON parse 错误包装；`lib/consultationMedicalAdvice.ts` 负责西医 / 中医默认医嘱文案和中药煎服法追加规则；`lib/consultationFinalRecord.ts` 负责已选治疗快照、TCM 治则治法和 `FinalRecord` 对象拼装；`model/consultationFactCheck.ts` 负责诊断/治疗事实核查启用判断、逐条检查、进度回调、结果写入和 issue 合并编排，检查函数与页面状态写入均由页面注入；`model/recommendationFeedbackRegistration.ts` 负责诊断/治疗推荐反馈落库后的外部目标注册编排，并通过显式参数接收 `saveRecommendation`、`recordMetric`、`registerTarget` 和 `getRecommendationKey`；`model/consultationCompletionTracking.ts` 负责完成问诊时诊断/治疗推荐采纳或拒绝反馈和最终报告统计埋点编排，并通过显式参数接收追踪函数；`index.ts` 是对外公开入口。`lib` 不得直接访问 Vue ref、toast、Tauri invoke、PHIS 请求或页面缓存状态；`model` 可编排副作用，但不得直接 import 单例服务或读取页面 ref | [src/features/symptom-consultation](src/features/symptom-consultation) |
| `SymptomResultEntry.vue` | 症状问诊结果页包装组件：接收 `ConsultationPage.vue` 产出的记录快照、推荐诊断和治疗方案，委托 `features/clinical-result/clinicalResultAdapter.ts` 转换为中性 `ClinicalResultInput`；症状渠道只保留“返回上一页”等包装语义，诊断鉴别入口与按钮锚定核查浮层由共享结果页主体统一提供，结果页结构与编辑标准以共享结果页为准。旧 `src/components/SymptomConsultationResultPage.vue` 已删除，问诊页通过 `@features/symptom-consultation` 消费 | [src/features/symptom-consultation/ui/SymptomResultEntry.vue](src/features/symptom-consultation/ui/SymptomResultEntry.vue) |
| `DiagnosisPathWindow.vue` | 独立诊断推理路径窗口，使用 ECharts Sankey 展示患者事实、章节归类、证据汇聚与诊断去向；默认提供更宽画布，并按容器尺寸动态计算 Sankey 的布局盒子，用对称留白实现“适应屏幕并居中”的默认视图，再开放滚轮缩放、平移与节点拖动；点击入口后窗口先显示 loading 动画，并按“检查缓存 -> 生成推理链 -> 渲染图表”的阶段更新提示，若生成超时或渲染失败会切换到明确错误态；正文容器在收到 payload 后保持挂载，loading 改为遮罩层，避免 `chartEl` 尚未挂载时误判渲染成功；开窗后的 `show/focus` 调用采用 best-effort 非阻塞方式，避免 Tauri 原生命令卡住整个推理链；右侧说明面板采用“支持证据 / 反证提醒 / 鉴别要点”三段式，未返回结构化分段时回退显示整体 rationale；真实实现已迁至 diagnosis-path 功能域，旧 `src/components/DiagnosisPathWindow.vue` 已删除 | [src/features/diagnosis-path/ui/DiagnosisPathWindow.vue](src/features/diagnosis-path/ui/DiagnosisPathWindow.vue) |
| `features/report-interpretation/*` | 报告解读功能域：`ReportInterpretationWindow.vue` 保留 HIS / SDK 单份报告的独立窗口生命周期；`ReportInterpretationWorkspace.vue` 承载应用内近 14 天报告时间轴、类型筛选、原始报告 / AI 解读双视图、医生手动触发解读和“生成后续诊疗方案”升级动作；`ReportSourcePreview.vue` 始终以紧凑报告单样式展示结构化原始报告；`ReportInterpretationContent.vue` 是两种入口共用的 AI 报告单式正文；`lib/reportInterpretationPresentation.ts` 负责展示层文案去重、补充 section 筛选和人口学占位病史隐藏；`model/useReportInterpretationWorkspace.ts` 将报告选择与 AI 请求拆开，管理手动触发、选择防串线、当前视图和按报告缓存；`api/reportedReportHistory.ts` 经 HIS Adapter 按历史 visitId 获取报告结果，并用非正常方向、异常标记、定性阳性结果和数值范围对冲突的上游 normal 标记做确定性复核，再转换为既有解读输入。解读本身只读，不直接进入 PHIS 回写 | [src/features/report-interpretation](src/features/report-interpretation) |
| `VoiceCapsule.vue` | 语音录制胶囊；“音频采集完成”审核态支持保留前段文字、时长和音频后继续采集，最终确认时合并分段，也支持二次确认后主动放弃并返回患者胶囊；真实实现已迁至语音问诊功能域，旧 `src/components/VoiceCapsule.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceCapsule.vue](src/features/voice-consultation/ui/VoiceCapsule.vue) |
| `VoiceConsultationNew.vue` | 当前共享结果页实现载体：消费中性 `ClinicalResultInput`（兼容旧 `VoiceIntentResult`），承载左侧病例正文编辑、右侧诊断/治疗推荐、刷新方案与最终回写 UI；诊断 / 治疗项级反馈编排继续保留，但当前由推荐卡片默认可见性统一隐藏入口。“补充说明并重新生成”的文本 / 语音采集由 `ClinicalResultSupplementDialog.vue` 和 `useClinicalResultSupplementInput.ts` 承担，录音态的状态脉冲、计时与真实音量波动由 supplement composable 从共享 `audioRecorder` 分析数据派生，页面只编排共享病例重写、诊断刷新与策略允许的治疗刷新，并在整段流程完成前保留上一版可用结果、禁止回写；语音专属的缓存恢复、放弃语音会话、语音用户日志、HIS 回执等待态和成功后直接收尾仍留在此文件，语音问诊与智能问诊结果页的“诊断鉴别”按钮锚定浮层由此共享结果页主体统一提供，其响应归一和关键不匹配判断复用 `features/clinical-result/diagnosisChecklist.ts`，浮层状态与请求生命周期复用 `features/consultation-result/model/useClinicalResultDiagnosisChecklist.ts`，页面只注入 Prompt/LLM 请求、渠道 trace、错误文案和 toast；重复传入语义相同的 `intentResult` 时不得重置结果页现场，但患者 / 就诊锚点变化必须先重置诊断选择、治疗方案、编辑器状态、反馈弹层和回写等待态，避免新患者头下展示上一患者治疗方案；已选主诊断再次点击或点击其内部动作时也不得触发治疗方案刷新；editorSnapshot 的节流 / 立即持久化已下沉到 `features/voice-consultation/model/useVoiceEditorSnapshotPersistence.ts`，病例字段初始快照 / 当前值读取 / 人工修改判断已下沉到 `features/voice-consultation/model/useVoiceRecordFieldState.ts`，诊断 / 治疗事实核查结果 Map、issue getter 和逐条核查循环已下沉到 `features/voice-consultation/model/useVoiceResultFactCheckState.ts`，推荐项反馈提交与结果页完成动作已下沉到 `features/voice-consultation/model/useVoiceFeedbackActions.ts`，语音知识库检索轻包装已下沉到 `features/voice-consultation/model/useVoiceKnowledgeSearch.ts`，语音意图结构化抽取已下沉到 `features/voice-consultation/model/useVoiceIntentRecognition.ts`，语音标准目录匹配、结果记录 clone / 采纳埋点、L2 安全复核状态、L1 刚性阻断、L2 issue 执行动作和旧整页 fact-check 包装已分别下沉到 `features/voice-consultation/model/useVoiceCatalogMatching.ts`、`useVoiceResultRecord.ts`、`useVoiceSafetyReview.ts`、`useVoiceRigidBlock.ts`、`useSafetyIssueResolver.ts`、`useVoiceResultFactCheck.ts`；症状问诊和语音结果页共用的反馈草稿 / target 登记 / 本地反馈提交编排已下沉到 `features/feedback/model/useVoiceFeedback.ts`；结果页 scoped 样式原样外置到 `features/consultation-result/ui/ClinicalResultEditor.css`，SFC 继续保留模板、脚本和渠道编排；最终回写 payload 必须经 `features/clinical-result/recordConfirmedPayload.ts` 生成，页面只通过 `extra` 注入 pending 回执字段，不再手拼 `record-confirmed` 顶层结构；中性输入到可编辑诊断 / 治疗列表的初始化委托 `features/clinical-result/clinicalResultInitialization.ts`；语音诊断 / 治疗 LLM raw 结果到页面推荐项的映射委托 `features/clinical-result/clinicalResultAiMapping.ts`，页面只注入标准库匹配、字典推断、归一化和当前病历文本 | [src/components/VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue) |
| `ClinicalResultColumnNavigator.vue` / `useClinicalResultColumnNavigation.ts` | 共享结果页桌面双栏阅读能力：左侧病例与右侧诊疗建议在固定中间视口内独立滚动，患者头和底部回写栏继续由外层 flex 布局固定；导航组件只渲染当前主诊断、右栏分区和数量，navigation composable 只管理右栏元素引用、当前分区判断与分区内滚动，不读写诊断 / 治疗业务状态。`ClinicalResultEditor.css` 负责宽屏滚动边界、吸顶层级和窄屏单栏回退；不得把 UI 阅读分区映射成 PHIS 回写分组，也不得让左右栏同步滚动 | [src/features/consultation-result/ui/ClinicalResultColumnNavigator.vue](src/features/consultation-result/ui/ClinicalResultColumnNavigator.vue) + [src/features/consultation-result/model/useClinicalResultColumnNavigation.ts](src/features/consultation-result/model/useClinicalResultColumnNavigation.ts) |
| `DiagnosisDifferentialList.vue` / `TreatmentRecommendationSection.vue` / `TreatmentRecommendationCard.vue` | 共享结果页诊疗建议的扫读展示层：待鉴别组件只将既有 `rationale / missingInformation` 组织为“名称 + 最关键核查点 + 就近操作”的紧凑摘要行，操作区不再重复显示“下一步”提示标签；支持依据全文按需展开，并持有展开状态，不改变诊断分区或转入规则；治疗分组组件对单项目与多项目使用同一“浅色组头 + 连续无框项目行”结构，派生总数 / 优先 / 可选 / 已选展示统计；组头不保留装饰图标占位，直接从内容起点展示分组标题与具体问题，不重复渲染“临床问题”提示词；多项目只保留内部轻分隔线，组内列表保持可见溢出以允许项目名后的推荐依据浮层越过连续容器边界。推荐卡片只增强整行选择命中区、项目名称 / 必要性 / 项目价值正文的展示顺序，价值正文不重复渲染“项目作用”提示词；选中态在所有布局变体中统一以蓝色实心勾、窄蓝色左标线和极浅蓝底表达，不绘制四周高对比边框；已设置或缺失的执行科室都以低权重可点击文字呈现，次级操作在紧凑行中不重复绘制胶囊边框；诊断与治疗卡片的反馈 UI 默认隐藏，反馈状态与提交接线继续保留。两者不得修改 AI 原始数据、标准库匹配、选中门禁或 PHIS payload | [src/features/consultation-result/ui/DiagnosisDifferentialList.vue](src/features/consultation-result/ui/DiagnosisDifferentialList.vue) + [src/features/consultation-result/ui/TreatmentRecommendationSection.vue](src/features/consultation-result/ui/TreatmentRecommendationSection.vue) + [src/features/consultation-result/ui/TreatmentRecommendationCard.vue](src/features/consultation-result/ui/TreatmentRecommendationCard.vue) |
| `features/differential-diagnosis/*` | 独立鉴别诊断小窗：`DifferentialDiagnosisModalPage.vue` 从当前患者上下文读取诊断、主诉、现病史，直接展示“鉴别排查确认”弹窗并调用 diagnosisChecklist prompt 生成 checklist；该入口不进入 `ConsultationPage.vue`、不展示共享结果页、不产生 PHIS 回写，只记录功能统计和保留医生辅助判断现场 | [src/features/differential-diagnosis](src/features/differential-diagnosis) |
| `ConsultationResultPage.vue` | 问诊共享结果页薄包装层：只负责把 `ClinicalResultInput`、渠道语义和 slot 附加动作转给当前共享结果页实现，不拥有业务状态机。真实实现已迁至 `features/consultation-result/ui`，旧 `src/components/ConsultationResultPage.vue` 已删除；当前仍转发到根级 `VoiceConsultationNew.vue`，等待后续抽出真正的 `ClinicalResultEditor` 主体。语音问诊和症状问诊都通过各自包装组件把初始快照适配到这里；最终回写请求会进入“等待 HIS 回执”状态，失败时保留当前页面供医生修正并重试 | [src/features/consultation-result/ui/ConsultationResultPage.vue](src/features/consultation-result/ui/ConsultationResultPage.vue) |
| `features/clinical-result/*` | 问诊结果页共享业务 helper，对外统一通过 `@features/clinical-result` barrel 暴露，页面层不直接依赖内部深路径：`clinicalResultAdapter.ts` 定义中性 `ClinicalResultInput` 并承接症状/语音入口到共享结果页的无 UI 适配；`historyRecordTemplates.ts` 定义三类固定病史模板、稳定槽位 key、明确上下文到 `{有}` 的确定性解析、模板标记去除与 `recordTemplateChanges` 构造；`physicalExamVitalTemplate.ts` 定义体格检查 T/P/R/BP 固定槽位、对话与 HIS 生命体征数值的确定性解析、自由文本去重和独立 `physicalExamVitalSigns` 回写元数据；槽位变化只消费对话/结构化答案/HIS 既有病史中的明确事实，不消费 AI 诊断或待鉴别方向；`clinicalRecordFactConfirmation.ts` 定义阴性事实来源和 AI 阅读候选请求/响应纯规则，并把变化后的模板槽位作为“根据上下文修正”的阳性事实交给原文标记层；`clinicalRecordNarrativeQuality.ts` 负责 AI 病历草稿进入编辑器前的确定性正文质控，统一清除工作流提示、精确重复和已被组合阴性句覆盖的结构化阴性症状，并在阳性事实冲突时拒绝自动补入；该规则只能挂在模型或规则草稿入口，不得对医生编辑后的字段再次执行；`diagnosisSuggestionPresentation.ts` 负责 AI 正式诊断最多三项、低置信降级、待鉴别方向分区和医生显式转入 key 的展示覆盖；`clinicalResultRegeneration.ts` 定义“当前病例 + 医生补充”重写请求、trace 与响应归一，补充事实优先于旧草稿且不得扩写为未提供事实；`clinicalResultLlmJsonParser.ts` 负责 LLM 文本到 JSON 对象 / 数组的宽容纯解析，症状问诊旧解析器路径仅兼容重导出，语音结果页诊断 / 治疗推荐解析也复用此口径；`clinicalResultAiRequest.ts` 负责 diagnosis、medication、exam、lab_test、procedure 推荐的 messages 与 trace config 规格构造，支持单路和多路治疗推荐规格，prompt 资产由调用方显式注入，trace 基础字段和具体 scene/title/action 可注入且默认保持语音问诊取值，页面仍负责 `chat` 调用与并发策略；`clinicalResultAiMapping.ts` 负责语音结果页 AI raw 诊断 / 治疗项到已匹配页面推荐项的纯转换、智能问诊 western 诊断 raw 数组按策略转换、智能问诊 western 治疗推荐 raw 数组按目标类型过滤转换，以及多路治疗响应解析失败隔离和合并，标准库匹配、catalog assessment、normalize、parser 与 parse-error 回调均由调用方注入；`clinicalResultInitialization.ts` 负责中性结果输入到可编辑诊断 / 治疗列表的初始化、匹配状态继承和默认勾选纯规则，通过参数注入标准库匹配、字典推断、归一化和当前病历文本；`clinicalResultTreatmentFields.ts` 只做 AI 数量别名归一和执行科室当前值到字典 key 的同步，执行科室真实值必须来自医生选择或 `useTreatmentHydration` 的 HIS 项目详情；`clinicalResultNarrative.ts` 负责推荐依据文案、条件性用药 / 患者已自行服药识别和默认勾选判断；`clinicalResultUsageFields.ts` 负责药品频次 / 用法候选过滤、关键字解析和字段展示文案，不持有搜索关键字 ref 或写回副作用；`clinicalResultAttributeOptions.ts` 负责药房、执行科室、部位、医保候选构造和过滤，不修改推荐项；`clinicalResultFeedback.ts` 负责诊断 / 治疗推荐反馈提交 payload 的标题、snapshot、targetType 和 recommendationType 纯构造；`recordConfirmedPayload.ts` 是症状问诊 / 语音问诊共用的 `record-confirmed` PHIS 回写契约唯一构造点，负责按回写范围发送去标记正文、独立 `recordTemplateChanges` 和 `physicalExamVitalSigns`，并承接诊断 key / 标准诊断 id 判断、orderList 原始字段读取、服务分类兜底、检验 jsonField / 皮试 / 检查标志等纯解析；`treatmentRequiredFields.ts` 负责用药、检查、检验、处置写入 `orderList` 前的必要字段纯校验，覆盖执行位置、医保限用、药品总量、用药天数、检查部位、检验 jsonField 和处置数量等当前控件值；`consultationSubmitPayload.ts` 负责 PHIS 提交前的已选治疗合并、库存不足提示文案和治疗方案摘要纯拼装；其余 helper 覆盖治疗标准库匹配展示、标准库候选搜索、手动匹配写入、诊断上下文 identity、治疗编辑器 key、推荐依据 tooltip key、疑似匹配名称等逻辑。症状问诊和语音问诊必须优先复用这里，页面层只保留选中门禁、toast、弹层开合和渠道专属编排 | [src/features/clinical-result](src/features/clinical-result) |
| `features/consultation-result/model/*` | 问诊共享结果页的轻状态与治疗模型 composable：`useClinicalResultChannelStrategy.ts` 管理 `voice/symptom` 渠道到日志类型、语音缓存开关、患者头展示和取消弹窗文案的无副作用派生；`useClinicalResultProgressiveIntentApplication.ts` 只负责同一生成会话的首次 reset、后续新增分区 patch 与 complete 收口计划，不直接操作页面状态；`useClinicalResultGenerationSequence.ts` 维护普通语音的诊断请求模式、缺失诊断恢复门禁、正式诊断 / 路由 / 治疗依赖和 AI 治疗可见性，非 `voice` 渠道保持透传，不发请求、不写页面字段；`useClinicalResultFinalization.ts` 管理服务端完成后的本地病历映射 finalizing 状态，并为普通语音暴露诊断与路由就绪后的后台治疗权限和独立进度，治疗分支不再阻塞病历核心定稿，慢病渠道仍禁止通用补拉；`useTreatmentSections.ts` 按固定药品 / 检查 / 检验顺序组合已完成内容与分支进度，把同一联合任务的检查 / 检验状态合并为一个占位行，`TreatmentGenerationPlaceholder.vue` 只负责该派生结果的加载 / 失败提示；`useClinicalRecordFactSuggestionScheduler.ts` 把缺失同流候选时的兜底生成建模为可等待任务，阻塞期间保留一次待执行意图，稳定后去抖且只触发一次，渠道禁用、患者或结果切换时取消；`useClinicalResultCancelController.ts` 管理放弃确认弹窗开合、提交中 / 等待 HIS 回执时的拦截提示和确认入口，反馈草稿清理 / 放弃日志 / `emit('cancel')` 由页面注入；`useClinicalResultIntentReset.ts` 管理新 `intentResult` 到来时的旧现场清理、病历字段回填和初始字段快照设置；`useClinicalResultWritebackPayload.ts` 管理最终回写前 `diagList` / `orderList` 的构造 resolver 组合，并把同一 resolver 暴露给必要字段校验；`useClinicalResultWritebackScope.ts` 管理门诊病历七字段、诊断、用药和检查检验处置的可用性、父级三态、人工选择、重新生成后的新增内容策略、序列化恢复和最终 `writebackScope`，不构造 PHIS 字段；`useClinicalResultWritebackPreflight.ts` 只对调用方传入的实际回写诊断和治疗项执行标准库、库存、药房、执行科室、检查部位和必要字段门禁；页面仍负责 `complete_consultation`、PHIS payload、提交中状态、等待回执和日志；`useClinicalResultUserLogController.ts` 管理首版、最终和放弃三类用户日志的提交节奏、首版快照记忆、最终选择快照和可选变更摘要，页面仍注入快照构造、患者来源和服务端提交函数；`useWritebackFeedbackController.ts` 管理已命中 requestId 的 HIS 回执 success / failed 分发和默认提示，页面在成功分支注入缓存持久化、最终日志与直接关闭结果页，不再触发整页反馈弹窗；其余 composable 继续分别管理患者上下文、诊断选择、推荐反馈、治疗编辑、属性选择、hydrate 与回写状态，不保存 PHIS payload 或跨患者全局状态。症状问诊和语音问诊页面只负责把外部点击事件、提交成功关闭、字段写回、缓存读写和渠道专属反馈接入 | [src/features/consultation-result/model](src/features/consultation-result/model) |
| `useClinicalResultWritebackScope.ts` / `ClinicalResultWritebackScopeSelector.vue` | 共享结果页部分回写能力：controller 按当前字段正文和已选诊断/治疗计算可用范围，门诊病历父级支持 checked / mixed / unchecked，字段级选择使用稳定 key；浮层组件只渲染锚定入口、数量、三态复选、空态和“未选内容保持 HIS 原值”说明。新患者/就诊 reset，重新生成通过前后可用性快照决定新增内容是否默认选择；最终作用域交给 `recordConfirmedPayload.ts` 决定病历/诊断字段省略和 PHIS 兼容的 `orderList: []`，UI 不直接拼装 payload | [src/features/consultation-result/model/useClinicalResultWritebackScope.ts](src/features/consultation-result/model/useClinicalResultWritebackScope.ts) / [src/features/consultation-result/ui/ClinicalResultWritebackScopeSelector.vue](src/features/consultation-result/ui/ClinicalResultWritebackScopeSelector.vue) |
| `useClinicalRecordFactConfirmation.ts` / `useClinicalRecordFactSuggestionScheduler.ts` / `clinicalRecordAnnotation.ts` / `ClinicalRecordAnnotatedText.vue` | 共享结果页“病历 AI 来源标记”能力：既往史、个人史、家族史的标准模板由 `historyRecordTemplates.ts` 提供，模板识别仅用于内部候选去重与安全规则，不在字段级显示来源提示；confirmation controller 管理 AI 候选生成、默认合并、当前会话移除和缓存恢复，候选可消费病例相关性、正式诊断和病历书写完整性要求；scheduler controller 管理候选生成的待执行、结果稳定门禁、去抖、并发复用和取消，不能直接调用 LLM。`pending` 只表示继续显示 AI 来源标记，不代表等待医生确认；`dismissed` 用于医生调整或移除后结束该标记，不等同于拒绝建议。`clinicalRecordAnnotation.ts` 同时切分正式事实与 AI 候选，并提供候选到字段正文的幂等合并规则：候选已存在时只返回原文并原位标记，不存在时按自然标点追加，组合阴性等语义覆盖不得重复写入。controller 在候选生成和旧缓存恢复时基于最新 `getRecord()` 逐项调用页面注入的字段写入函数，并在实际新增后通知页面同步系统基线、回写范围和缓存；不得保存仅存在于 DOM 的阅读层正文。`ClinicalRecordAnnotatedText.vue` 只渲染已经位于 `modelValue` 中的 AI 片段，保持自然行高、换行与左对齐，一般项使用蓝色文字与虚线，重点项使用红色文字与虚线；点击标记打开锚定原文的非模态 AI 核查层，统一说明该片段会随所选病历字段回写，并提供复制、调整和移除，不再提供“纳入病历”或“当前不会回写”。调整和移除直接修改字段并结束当前来源标记，不产生确认状态或回写门禁。非编辑态正文选区的快速复制仍由组件本地管理。模型请求、toast、字段 ref、系统基线、缓存和 PHIS 回写由页面显式注入或编排 | [src/features/consultation-result/model/useClinicalRecordFactConfirmation.ts](src/features/consultation-result/model/useClinicalRecordFactConfirmation.ts) / [src/features/consultation-result/model/useClinicalRecordFactSuggestionScheduler.ts](src/features/consultation-result/model/useClinicalRecordFactSuggestionScheduler.ts) / [src/features/clinical-result/historyRecordTemplates.ts](src/features/clinical-result/historyRecordTemplates.ts) / [src/features/clinical-result/clinicalRecordAnnotation.ts](src/features/clinical-result/clinicalRecordAnnotation.ts) / [src/features/consultation-result/ui](src/features/consultation-result/ui) |
| `patientContext.ts` / `outpatientRecord.ts` / `recordConfirmedPayload.ts` 的女性月经史链路 | 月经史是独立于个人史的可选病历字段。患者上下文先从显式 `menstrualHistory` 读取，必要时从既有门诊病历的“月经史”段落提取；语音抽取只允许使用本次对话明确内容，并以既有病历为未被本次对话修订时的后备来源。共享结果页依据归一化性别仅对女性展示该字段，固定排在个人史与家族史之间；无依据时保持空白，不建立默认模板或 AI 正常候选。最终由 `useClinicalResultWritebackScope.ts` 纳入字段级选择，`recordConfirmedPayload.ts` 仅在有内容且被选择时向 `outpatientRecord.menstrualHistory` 与顶层兼容字段写入，男性患者始终省略 | [src/utils/patientContext.ts](src/utils/patientContext.ts) / [src/features/clinical-result/outpatientRecord.ts](src/features/clinical-result/outpatientRecord.ts) / [src/features/clinical-result/recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) / [src/components/VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue) |
| `ClinicalRecordAnnotatedText.vue` 的核查复制交互 | AI 核查浮层复用共享剪贴板写入 helper；复制成功后关闭当前核查浮层，失败时保留现场并记录警告。关闭动作只清理浮层与编辑态，不修改病历正文、候选状态或回写范围。病历详情顶部 AI 说明由共享结果页渲染，样式固定单行省略，避免说明区高度随窗口宽度变化 | [src/features/consultation-result/ui/ClinicalRecordAnnotatedText.vue](src/features/consultation-result/ui/ClinicalRecordAnnotatedText.vue) / [src/features/consultation-result/ui/ClinicalResultEditor.css](src/features/consultation-result/ui/ClinicalResultEditor.css) |
| `useDifferentialDiagnosisDirection.ts` / `diagnosisSuggestionPresentation.ts` / `DiagnosisDifferentialList.vue` | 共享结果页待鉴别方向与医生转入流程：纯展示规则继续把低置信、证据不足和模型显式 differential 项隔离在正式诊断之外，并保证 AI 正式建议最多 3 项；局部 controller 只保存“已纳入诊疗方向 / 已由医生转为正式诊断”的稳定 key，支持 reset、缓存序列化和恢复，不创建 Pinia store。列表组件展示匹配度、依据、缺失信息和“纳入诊疗方向 / 补充依据 / 转为正式诊断 / 取消纳入”动作；纳入状态不写诊断、不触发治疗，补充依据复用 `ClinicalResultSupplementDialog.vue`，转入必须匹配标准诊断库。纳入后摘要行使用“诊断身份与操作在首行、需核查信息独占次行”的布局，诊断名称保留最小可读宽度并允许长名称自然换行，操作数量不得把名称压缩为不可辨识省略文本；正式诊断为空时由共享结果页渲染紧凑诊断空态，并按是否存在待鉴别方向给出下一步。医生转入项不受 AI 三项截断，页面通过现有诊断选择 controller 把它加入已选次诊断并保留原主诊断；只有医生后续显式设为主诊并刷新方案才改变治疗依据。语音编辑快照同时保存方向状态、主诊断 identity 和全部已选正式诊断 identities，恢复时先恢复转入 key 再重建选择集合，避免转入次诊断在同就诊缓存恢复后丢失 | [src/features/consultation-result/model/useDifferentialDiagnosisDirection.ts](src/features/consultation-result/model/useDifferentialDiagnosisDirection.ts) / [src/features/clinical-result/diagnosisSuggestionPresentation.ts](src/features/clinical-result/diagnosisSuggestionPresentation.ts) / [src/features/consultation-result/ui/DiagnosisDifferentialList.vue](src/features/consultation-result/ui/DiagnosisDifferentialList.vue) |
| `useClinicalResultDiagnosisChecklist.ts` / `DiagnosisRecommendationCard.vue` / `diagnosisChecklistPresentation.ts` | 共享结果页主诊断核查能力：controller 负责按“就诊 + 诊断 + 病历上下文”预取/缓存 checklist，并单独管理当前锚定浮层 key 与已人工关闭 key；普通或高风险结果完成后可在当前主诊断卡自动打开，人工关闭后同一 key 不得再次自动打开，入口点击可显式重开。卡片负责名称、编码、置信度、推荐依据、核查状态入口；“主诊核查 N 项”按钮外层是浮层的直接 `position: relative` 容器，非模态浮层右边缘与按钮对齐并出现在按钮正下方。浮层完整消费全部条目并展示每项全文，超高时只滚动清单区域；标题 14px、正文 13px、带右上角关闭入口与底部“已确认”文字按钮、支持 Escape，不改变卡片文档流高度，不渲染页面中央遮罩。“已确认”只复用关闭动作，不产生病历、诊断或回写状态。`diagnosisChecklistPresentation.ts` 把动作词与症状、时间特征、危险信号、排除目标切分为安全文本片段，UI 只用文字色与字重高亮，不使用底色块或 `v-html`。独立 `diffDx` 窗口继续复用 checklist 纯规则，但不复用共享结果页浮层显隐状态 | [src/features/consultation-result/model/useClinicalResultDiagnosisChecklist.ts](src/features/consultation-result/model/useClinicalResultDiagnosisChecklist.ts) / [src/features/consultation-result/ui/DiagnosisRecommendationCard.vue](src/features/consultation-result/ui/DiagnosisRecommendationCard.vue) / [src/features/clinical-result/diagnosisChecklistPresentation.ts](src/features/clinical-result/diagnosisChecklistPresentation.ts) |
| `TreatmentRecommendationCard.vue` | 单条治疗推荐卡片壳：现同时服务语音问诊、症状问诊与独立诊疗方案推荐。组件负责渲染名称/规格、匹配状态、执行科室/发药药房 chip、候选标准项确认、AI 原建议、摘要文案，以及反馈 / 手动匹配 / 单层编辑等头部动作；检查 / 检验项直接展示简短 `goal` 开立目的，完整 `reason` 仍由推荐依据入口按需展示。勾选按钮与“编辑处方 / 收起编辑”按钮职责分离，卡片空白和内部字段不再切换选中状态。独立诊疗方案页复用默认同款卡片样式，并通过插槽注入检查部位、手动匹配和属性选择器，不再维护第二套匹配列表样式。真实实现已迁至共享结果页功能域，旧 `src/components/TreatmentRecommendationCard.vue` 兼容包装已删除 | [src/features/consultation-result/ui/TreatmentRecommendationCard.vue](src/features/consultation-result/ui/TreatmentRecommendationCard.vue) |
| `auxiliaryRecommendationPresentation.ts` | 检查 / 检验推荐展示纯规则：把真实存在的 `goal / goalGroup / goalGroupPurpose / necessity` 归一为直接可读的开立目的、优先级和临床目标分组；明确医嘱按本次目录匹配状态单列，具备对话推测补全目标时显示“对话明确 · 临床目标”，否则保持“对话明确项目 / 对话明确项目（待匹配）”，并优先显示真实 `goal`、其次显示简短 `evidenceText / reason`，不生成会被误认为临床结论的通用兜底，不改变推荐项选中状态，不参与 PHIS / LIS 申请单分组。`TreatmentRecommendationSection.vue` 只消费其分组结果并渲染组标题、组目的与卡片列表 | [src/features/consultation-result/model/auxiliaryRecommendationPresentation.ts](src/features/consultation-result/model/auxiliaryRecommendationPresentation.ts) |
>
> 治疗编辑器状态约束：`useTreatmentEditorState.ts` 同一时刻只保存一个展开项 key；切换展开项只收起前一项 UI，不清理推荐项中的医生编辑值，字段聚焦仍由 active field key 与已注册 DOM 引用统一编排。
| `FactCheckHighlight.vue` | 行内事实核查标注组件，展示 factChecker 返回的 issue 风险等级、问题和建议；真实实现已迁至 feedback 功能域，旧 `src/components/FactCheckHighlight.vue` 兼容包装已删除 | [src/features/feedback/ui/FactCheckHighlight.vue](src/features/feedback/ui/FactCheckHighlight.vue) |
| `FactCheckNotification.vue` / `FactCheckWidget.vue` | 事实核查通知和悬浮浮窗，展示 factChecker 审查开启、完成、问题数量和详情列表；真实实现已迁至 feedback 功能域，旧 `src/components/FactCheckNotification.vue` / `src/components/FactCheckWidget.vue` 兼容包装已删除 | [src/features/feedback/ui](src/features/feedback/ui) |
| `VoiceRecommendationFeedbackPopover.vue` | 语音结果页单条推荐反馈弹层：收集问题标签、反馈原因、是否已修正采用以及修正结果摘要；真实实现已迁至语音问诊功能域，旧 `src/components/VoiceRecommendationFeedbackPopover.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue](src/features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue) |
| `VoiceRecordFieldEditor.vue` | 共享结果页病例字段受控编辑器：文档态委托 `ClinicalRecordAnnotatedText.vue` 渲染原文内事实与 AI 阅读标记、未记录空态，并承接非阻断的 AI 核查参考与正文选区快速复制；表单态继续使用 textarea。不再展示或接收病例字段反馈按钮、AI 候选确认动作、草稿和提交事件，也不为这些已移除控件预留右侧空间。编辑器只转发受控字段值，不自行生成事实、不写缓存或 PHIS；父页负责字段值、用户日志和 PHIS 回写 | [src/features/voice-consultation/ui/VoiceRecordFieldEditor.vue](src/features/voice-consultation/ui/VoiceRecordFieldEditor.vue) |
| `useVoiceRecordFieldState.ts` | 共享结果页病例字段初始快照与人工修改判断；继续服务用户日志变更标记和系统文本基线保护，不再创建字段反馈草稿、反馈 key、提交状态或反馈展示文案 | [src/features/voice-consultation/model/useVoiceRecordFieldState.ts](src/features/voice-consultation/model/useVoiceRecordFieldState.ts) |
| `VoiceSessionFeedbackBar.vue` | 保留的整页评价 UI 组件，不再接入一键回写成功收尾流程；当前医生问题反馈统一从工作区顶栏主动入口进入，一键回写成功后直接结束结果页。真实实现位于语音问诊功能域，旧 `src/components/VoiceSessionFeedbackBar.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceSessionFeedbackBar.vue](src/features/voice-consultation/ui/VoiceSessionFeedbackBar.vue) |
| `TreatmentItemEditor.vue` / `MedicineUsageFieldSelector.vue` / `ManualMatchPicker.vue` / `RecAttributeChip.vue` | 共享结果页治疗项编辑、药品频次/用法选择、手动匹配和必填属性 chip；真实实现已迁至共享结果页功能域，对应旧 `src/components/*` 兼容包装已删除。组件本身只负责 UI 与事件分发，不承接归一化、库存校验或 HIS 回流逻辑 | [src/features/consultation-result/ui](src/features/consultation-result/ui) |
| `VoiceResultHeader.vue` | 语音结果页患者信息与确认/放弃操作头部；只负责展示和发出 `confirm/cancel` 事件，不承接结果记录、复核或回写逻辑；真实实现已迁至语音问诊功能域，旧 `src/components/VoiceResultHeader.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceResultHeader.vue](src/features/voice-consultation/ui/VoiceResultHeader.vue) |
| `VoiceSafetyReviewPanel.vue` | 语音安全复核员提示面板（L2 柔性提醒）：展示异步 LLM 复核状态和非干扰提醒，支持展开详情、知晓和忽略；当父组件提供 `getActionLabel` 时额外显示"采纳建议"按钮（移除冲突药 / 补充化验），按钮触发 `apply` 事件；面板自身不感知 record，只负责 UI 与事件；真实实现已迁至语音问诊功能域，旧 `src/components/VoiceSafetyReviewPanel.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceSafetyReviewPanel.vue](src/features/voice-consultation/ui/VoiceSafetyReviewPanel.vue) |
| `VoiceRigidBlockBanner.vue` | 语音刚性阻断条（L1 硬规则）：与 `VoiceSafetyReviewPanel` 并列展示，置于安全复核面板上方；仅渲染由 `useVoiceRigidBlock` 同步评估出的确定性告警，要求医生对每条 `block` 项二次确认；不调用 LLM、不发起网络请求；真实实现已迁至语音问诊功能域，旧 `src/components/VoiceRigidBlockBanner.vue` 兼容包装已删除 | [src/features/voice-consultation/ui/VoiceRigidBlockBanner.vue](src/features/voice-consultation/ui/VoiceRigidBlockBanner.vue) |
| `shared/composables/useOutsideInteraction.ts` | 通用 document 外部点击 / pointerdown 交互 composable：统一绑定和解绑全局事件，按 selector 或 element refs 判断是否点击在浮层锚点外部并触发关闭回调；不携带推荐、症状或反馈业务语义 | [src/shared/composables/useOutsideInteraction.ts](src/shared/composables/useOutsideInteraction.ts) |
| `shared/composables/useTauriEventListener.ts` | 通用 Tauri 事件监听生命周期 composable：统一在 mounted 阶段自动订阅 `listen`，或由调用方在需要保证时序时显式 `startListener()`；在 unmounted 阶段解绑，并集中处理订阅失败日志，可按调用方配置向外传播显式注册失败；不携带事件 payload 的业务过滤、PHIS 回执处理、下载进度处理或页面状态写入。`useEventListeners.ts` 的 App 级 Tauri 事件使用 `autoStart: false` 接入，保留原有显式 `registerAllListeners()` 时序 | [src/shared/composables/useTauriEventListener.ts](src/shared/composables/useTauriEventListener.ts) |
| `app/events/useReceptionController.ts` | App 级接诊状态机 controller：统一处理 `receive-patient`、自动静默接诊和 `show-patient-risks` 所需的 HIS 患者补全、过敏史 / 历史就诊摘要合并、统一 flow token、风险降级、同患者并发接诊复用、患者切换时语音缓存和最小化入口清理；风险和机会状态写入 `ReceptionSessionController`，不注册 Tauri 事件、不处理 SDK handshake、不打开具体结果页、不提交 PHIS 回写 | [src/app/events/useReceptionController.ts](src/app/events/useReceptionController.ts) |
| `features/reception/model` | 接诊 session 与门诊场景 Strategy：`useReceptionSessionController` 持有局部状态并从 `currentPatient` 派生患者摘要，其中年龄对外只提供保留单位的 `patientAgeText`，不得降级成裸数值；`useOutpatientScenarioRouter` 统一复诊配药、报告复诊、语音缓存恢复和普通录音分流 | [src/features/reception/model](src/features/reception/model) |
| `app/events/useSdkHandshakeController.ts` | App 级 SDK handshake controller：解析 `sdk-handshake` payload 中的 HIS origin、token、机构、租户、角色科室和 URT，保留 SDK origin 已提取的首段 contextPath，仅移除 userinfo、query、fragment 并规范化末尾 `/`，随后初始化 / 重置 `HisService` 与 `HisAdapter`，缓存反馈 actor，并把 `orgCode / tenantId` 写入医学目录上下文；用户日志与反馈 actor 中 `hisOrgId` 只来自 `urt.userRoleDepts.orgId`，`orgName` 来自 `urt.orgPureName`，`deptId` 来自 `urt.userRoleDepts.deptId`；TS 与 Rust 握手日志只记录阶段和必要的非敏感状态，不输出 origin/href 具体值、raw ctx、token 或完整 URT；不注册 Tauri 事件、不读写患者上下文、不打开页面或提交 PHIS 回写 | [src/app/events/useSdkHandshakeController.ts](src/app/events/useSdkHandshakeController.ts) |
| `shared/composables/useTauriWindowEventListeners.ts` | 通用独立窗口事件监听生命周期 composable：统一批量注册当前 Tauri `Window` 实例上的 `appWindow.listen`，在 unmounted 阶段解绑，并集中处理注册失败日志；独立窗口仍显式 `await registerListeners()` 后再发送 ready 事件，避免主窗口提前投递 payload；不携带窗口 payload 状态写入、图表渲染或业务状态机 | [src/shared/composables/useTauriWindowEventListeners.ts](src/shared/composables/useTauriWindowEventListeners.ts) |
| `ReceptionCapsule.vue` / `ChronicRefillScopeSelector.vue` | 接待胶囊负责患者摘要、风险和门诊机会入口编排；慢病范围与医生勾选确认由同域子组件独立承载，后台 AI 药品归类保持静默且不进入视图，父组件只转交 `ChronicRefillSelection`。风险规则和风险详情组件仍由 reception-risk 提供，App 通过 `@features/reception` 公开入口消费。患者年龄 prop 使用完整 `ageText`，原样展示“岁 / 个月 / 天”及复合月日龄，并将同一文本交给头像解析 | [src/features/reception/ui](src/features/reception/ui) |
| `RiskAlertPanel.vue` / `RiskAlertBubble.vue` | 风险详情面板 / 气泡；真实实现已迁至 reception-risk 功能域，旧 `src/components/RiskAlertPanel.vue` / `src/components/RiskAlertBubble.vue` 已删除，`RiskItem` 类型由 `src/features/reception-risk/types.ts` 统一导出，避免业务代码从 UI 文件借类型。患者年龄与接诊胶囊共用完整 `ageText`，不得自行补“岁” | [src/features/reception-risk/ui](src/features/reception-risk/ui) |
| `BodyPartSelector.vue` / `SystemCategorySelector.vue` | 症状问诊 UI 域：人体部位交互选症状和按系统分类选症状；真实实现已迁至 `features/symptom-consultation/ui`，旧 `src/components/*` 路径已删除，`ConsultationPage` 通过 `@features/symptom-consultation` 公开入口消费；本地症状库维护页已下线，模板维护改由 `PCIE Server` 后台承接 | [src/features/symptom-consultation/ui](src/features/symptom-consultation/ui) |
| `MedicalCatalogCachePanel.vue` | 缓存管理独立视图：页面标题统一为“缓存管理”，当前只展示诊断 / 诊疗项目 / 药品等基础数据 SQLite 缓存数量、同步状态、数据库路径，并提供面板内刷新、手动同步和按目录 / 机构 / 租户 / 药房定向清理；真实实现已迁至 medical-catalog 功能域，旧 `src/components/MedicalCatalogCachePanel.vue` 已删除，App 通过 `@features/medical-catalog` 公开入口消费 | [src/features/medical-catalog/ui/MedicalCatalogCachePanel.vue](src/features/medical-catalog/ui/MedicalCatalogCachePanel.vue) |
| `HisIntegrationLogPanel.vue` | HIS 联调日志独立视图面板：筛选、查看详情、复制、导出、清空本地 JSONL 日志；真实实现已迁至 settings 功能域下的排障工具面板，旧 `src/components/HisIntegrationLogPanel.vue` 已删除，App 通过 `@features/settings` 公开入口消费 | [src/features/settings/ui/HisIntegrationLogPanel.vue](src/features/settings/ui/HisIntegrationLogPanel.vue) |
| `UpdateChecker.vue` / `ForceUpdateGate.vue` | 客户端更新与服务端强制更新门禁 UI：`UpdateChecker` 负责更新源配置、检查按钮、下载进度和安装重启动作编排；`ForceUpdateGate` 只展示强更版本要求并复用 `UpdateChecker forced`。真实实现已迁至 settings 功能域，旧 `src/components/UpdateChecker.vue` / `src/components/ForceUpdateGate.vue` 已删除，设置页和 App 强更门禁通过 `@features/settings` 公开入口消费 | [src/features/settings/ui](src/features/settings/ui) |
| `FeedbackSubmissionPanel.vue` | 通用问题反馈面板：承接工作区顶栏反馈入口，提供紧凑星级、问题标签、选填截图和补充说明，并统一提交 `/v1/client/feedbacks` | [src/features/feedback/ui/FeedbackSubmissionPanel.vue](src/features/feedback/ui/FeedbackSubmissionPanel.vue) |
| `KnowledgeBasePanel.vue` / `KnowledgePanel.vue` | 知识库 UI 域：内置知识库检索面板、问诊页知识检索抽屉、搜索结果行和详情弹窗；真实实现已迁至 knowledge 功能域，旧 `src/components/Knowledge*.vue` 已删除，App 与问诊页通过 `@features/knowledge` 公开入口消费。智能问诊和语音问诊的批量检索分类词提取收敛到 `features/knowledge/lib/knowledgeSearchCategories.ts`，检索 loading / results / 面板开合收敛到 `features/knowledge/model/useKnowledgeSearchController.ts`；知识服务、配置判断、toast 和埋点仍由调用方注入。当前默认知识入口仍更偏向 `pmphai.ts` 生成的外部页面，内置面板作为保留备选通道 | [src/features/knowledge/ui](src/features/knowledge/ui) / [src/features/knowledge/lib](src/features/knowledge/lib) / [src/features/knowledge/model](src/features/knowledge/model) |
| `Toast.vue` | 消息提示；真实实现已迁至 `src/shared/ui/Toast.vue`，旧 `src/components/Toast.vue` 兼容包装已删除，全局 provider 直接使用 shared 实现 | [src/shared/ui/Toast.vue](src/shared/ui/Toast.vue) |
| `Icon.vue` | 通用图标封装真实实现已迁至 `src/shared/ui/Icon.vue`；旧 `src/components/Icon.vue` 兼容包装已删除。离线图标由 `main.ts` 注册 `src/icons/iconifyCollections.ts` 中的精简 Iconify 集合，避免把完整 `@iconify-json/*` 图标包打进产物 | [src/shared/ui/Icon.vue](src/shared/ui/Icon.vue) |

### 组件通信模式

**父子通信**:
- Props Down - 父组件通过 props 传递数据
- Events Up - 子组件通过 emit 触发事件

**跨组件通信**:
- `provide/inject` - Toast 提示功能
- 全局 ref 状态 - currentPatient, generatedRecord
- Pinia - `diagnosisPath` store 负责诊断路径缓存共享

---

## 常量 (Constants)

### `constants/windowSizes.ts` ✅

**文件**: [src/constants/windowSizes.ts](src/constants/windowSizes.ts)

**职责**: 窗口尺寸常量定义

**导出**:
```typescript
export const WINDOW_SIZES = {
  BALL: { width: 160, height: 160 },
  WORK: { width: 378, height: 449 },
  CHAT: { width: 420, height: 620 },
  DIAGNOSIS_PATH: { width: 972, height: 608 },
  CONSULTATION: { width: 1120, height: 760 },
  CAPSULE: { width: 360, height: 80 },
  CAPSULE_PROCESSING: { width: 360, height: 96 },
  CAPSULE_STOPPED: { width: 360, height: 140 },
  CAPSULE_EXPANDED: { width: 360, height: 248 },
  RISK_CARD: { width: 280, height: 92 },
  RISK_CARD_EXPANDED: { width: 280, height: 196 }, // 单条风险基线，按风险行与操作入口动态增高，最高 520
  VOICE_CONSULTATION: { width: 1080, height: 720 },
  HIS_LOG: { width: 980, height: 640 },
  MEDICAL_CACHE: { width: 980, height: 640 }
};

export type ViewType =
  | 'chat'
  | 'settings'
  | 'consultation'
  | 'risk-alert'
  | 'voice-interaction'
  | 'voice-consultation'
  | 'reception-capsule'
  | 'analytics'
  | 'his-log'
  | 'medical-cache'
  | 'knowledge-base';

export function getWindowSizeForView(view: ViewType): { width: number; height: number };
```

**用途**: 消除魔法数字，统一管理所有视图的窗口尺寸

`consultation` 现在既是 HIS 接诊后的默认业务入口，也是 `/api/consultation/assist` 的唯一主落点。

---

### `constants/animation.ts` ✅

**文件**: [src/constants/animation.ts](src/constants/animation.ts)

**职责**: 动画参数常量定义

**导出**:
```typescript
export const ANIMATION = {
  TRANSITION_MS: 300,              // 过渡动画时长
  MOVE_DEBOUNCE_MS: 500,           // 窗口移动防抖
  WINDOW_SIZE_WAIT_TIMEOUT: 1000,  // 窗口尺寸等待超时
  POSITION_VERIFY_DELAY: 50,       // 位置验证延迟
  SIZE_POLL_INTERVAL: 16,          // 尺寸轮询间隔（60fps）
};

export const MORPH_ORIGIN_DEFAULT = '80px 80px';

export function wait(ms: number): Promise<void>;
```

**用途**: 统一管理动画时长、防抖延迟、轮询参数

---

## 样式模块 (Styles)

### 样式文件组织

```
src/styles/
├── design-tokens.css       # 设计令牌（颜色、间距、字体）
├── global-overrides.css    # 全局覆盖
├── utilities.css           # 工具类
├── global.css              # 全局基础样式 ✅
├── layouts/
│   └── app-layout.css      # 应用布局样式 ✅
└── animations/
    └── morph.css           # 变形动画 ✅
```

### `styles/global.css` ✅

**职责**: 全局基础样式

**内容**:
- HTML/Body 重置
- 应用容器样式
- 滚动条样式
- 辅助功能（skip-link）

**行数**: 约 60 行

---

### `styles/layouts/app-layout.css` ✅

**职责**: 应用布局样式

**内容**:
- 状态层布局（ball-layer, assistant-layer）
- Assistant 容器（玻璃态设计）
- 工具栏样式
- 图标按钮样式

**行数**: 约 180 行

---

### `styles/animations/morph.css` ✅

**职责**: 变形动画

**内容**:
- Morph 过渡动画（悬浮球 ↔ 面板）
- GPU 加速优化（transform, opacity）
- 缩放比例定义

**行数**: 约 60 行

**动画参数**:
```css
/* 助手面板 */
.morph-enter-from.assistant-layer,
.morph-leave-to.assistant-layer {
  opacity: 0;
  transform: scale(0.35);  /* 从小球中心展开 */
}

/* 悬浮球 */
.morph-enter-from.ball-layer,
.morph-leave-to.ball-layer {
  opacity: 0;
  transform: scale(0.5);   /* 弹出效果 */
}
```

---

## 服务 (Services)

服务封装外部系统通信和数据处理。

| 服务 | 职责 | 文件 |
|------|------|------|
| `llm.ts` / `services/llm/*` | LLM facade 与服务端代理编排。`chat/chatStream/chatFast/transcribeAudio` 全部通过 `regionalClient.ts` 的签名 HTTP/SSE 出口调用 `/v1/ai/*`；`config.ts` 只读取 bootstrap 非敏感视图，`retry.ts` 提供指数退避，`payload.ts` 负责消息 payload 与摘要。客户端不存在第三方 API Key、Base URL 或本地 OpenAI 兼容客户端 | [src/services/llm.ts](src/services/llm.ts) / [src/services/llm](src/services/llm/types.ts) |
| `aliyunSpeech.ts` | 语音转写编排：DashScope / FunASR 优先走服务端托管实时 WebSocket，OpenAI 兼容和实时失败场景走服务端批量降级 | [src/services/aliyunSpeech.ts](src/services/aliyunSpeech.ts) |
| `audioRecorder.ts` | Web Audio API 录音、音频输入设备枚举与首选设备回退 | [src/services/audioRecorder.ts](src/services/audioRecorder.ts) |
| `medicalData.ts` | 医疗数据目录加载、缓存恢复与匹配。诊断、药品及非检查检验诊疗项目仍可按各自 scope 恢复 SQLite 缓存；检查 / 检验目录改为接诊级实时目录，由 `useReceptionController.ts` 在每次接诊开始时调用 `beginAvailableExamLabReception()` 预取，`medicalData.ts` 按 `orgCode + tenantId + deptId` 对同次接诊的请求和结果做内存复用，结束接诊或上下文变化时清空。该实时目录不写入、也不从 SQLite 恢复，查询失败时清空旧检查检验项且禁止回退历史目录，确保 `jsonField.idLisCategory`、执行科室、部位和互认编码保持本次 HIS 完整值。当前药房药品目录继续按 `orgCode + tenantId + storeId` 落库，确保真实库存 scope；缓存管理页的显式强制同步只持久化仍允许缓存的目录 | [src/services/medicalData.ts](src/services/medicalData.ts) |
| `hisService.ts` | HIS HTTP 调用封装（PHIS 形态默认实现）：统一处理鉴权头、POST/GET 请求，以及诊断/药品/诊疗项目目录与药品频次、用法等字典读取，供主问诊和语音问诊复用；PHIS 分散 RPC 不再由客户端直接打 `base/phis/otms` 旧服务名，而是统一经院端 `api/phis.aiAdapterService/*` 薄适配入口，由各项目处理不同 PHIS 版本差异；住院病历 AI 上下文仍保留 PHIS `api/phis.aiInpatientEmrContextService/buildContext` 聚合接口，登记 / 诊断 / 医嘱 / 体温单等明细由后端裁剪后一次性返回，不再维护桌面端分散 RPC 回退。**业务方不应直接 import 本文件**：所有出站调用应通过 `services/his` 适配器层 | [src/services/hisService.ts](src/services/hisService.ts) |
| `hisService.ts` 门诊回诊报告结果 | 门诊语音入口先根据 PHIS `loadClinicMedicalRecord` 返回的 `applyList[].items[].sdApply === "3"` 判断本次是否存在已出报告；当前就诊信息和本次门诊病历文本沿用接诊阶段已获取的 `HisOutpatientMedicalRecord`，不再由 AI 上下文服务重复读取。随后通过 `HisAdapter.fetchOutpatientFollowUpReportResults` 调用 PHIS 新增 `api/phis.aiInpatientEmrContextService/buildOutpatientFollowUpReportResults`，只返回 `labReports / examReports / ineligibleReason` 等报告结果 DTO。PHIS 取检验报告按 `HI_ODS_APPLY.ID_RESULT = HI_ODS_APPLY_LIS_REPORT.ID_REPORT_GROUP` 关联，取检查报告按 `HI_ODS_APPLY.ID_APPLY = HI_ODS_APPLY_PACS_REPORT.ID_APPLY` 关联；PACS 的影像表现、诊断结论和原报告 URL 分别进入 `finding / conclusion / reportUrl`，桌面端再把本次病历、诊断参考和报告结果组合成 `HisOutpatientFollowUpContext` 交给页面 | [src/services/hisService.ts](src/services/hisService.ts) / [src/services/his](src/services/his) |
| `services/his/HisAdapter.ts` | 厂商无关的 HIS 适配器接口契约：覆盖目录同步 / 字典 / 详情 / 有效库存目录 / 处方库存校验 / 患者信息 / 门诊病历引用 / 门诊复诊聚合 / 住院上下文场景。详情类和聚合上下文均使用中性 DTO（`MedicineDetail` / `AvailableMedicineInventoryItem` / `MedicalItemDetail` / `HisOutpatientFollowUpContext` / `HisInpatient*`）。PHIS Adapter 调用 `queryInvSubList` 后过滤停用、零库存和失效批次，按 `idMedPro` 合并，并保留近效期有效批次价格；`features/clinical-result/api/availableMedicineInventory.ts` 再负责按机构、租户、药房持久化短缓存、并发去重、仅面向 AI 的“清洗后名称 + 规格”投影去重与上下文格式化，以及按 `storeId + productId` 为实时库存校验解析目录单价；AI 投影去重不修改内部真实库存项。新厂商只需实现该接口并通过 `registerHisAdapterFactory(vendor, factory)` 注入，业务层无需改动 | [src/services/his/HisAdapter.ts](src/services/his/HisAdapter.ts) |
| `services/his/types.ts` | vendor-neutral DTO 定义：详情（`MedicineDetail` / `MedicalItemDetail`，诊疗项目详情包含 `defaultQuantity` 用于真实反填处置数量）+ 检查部位（`MedicalItemPartOption`）+ 目录（`DiagnosisCatalogEntry` / `MedicineCatalogEntry` / `MedicalItemCatalogEntry`）+ 字典（`DictionaryEntry`）+ 库存校验（`InventoryCheckRequest` / `InventoryCheckResult`）+ 患者信息与住院上下文（`HisPatientInfo` / `HisPatientHistory` / `HisInpatient*`）。业务方只读语义化字段（`productId` / `quantity` / `businessType` / `patientId` 等），不再泄漏 PHIS 命名（`idMedPro` / `amount` / `sdFrzBiz` / `idPi`）；厂商私有字段保留在 `raw` / `properties` 透传 | [src/services/his/types.ts](src/services/his/types.ts) |
| `services/his/PhisHisAdapter.ts` | 默认厂商实现：thin wrapper，把 `HisService` 类（PHIS 形态）暴露为 `HisAdapter` 接口；详情、检查部位、患者信息与门诊病历引用在此处把 PHIS 字段映射为中性 DTO，诊疗项目详情会把 `idDeptExec` 映射为 `executingDeptId`、`count/amount/quantity` 映射为 `defaultQuantity`，其中体温单会从 `detail` 半结构化文本提取血压、呼吸、血氧等生命体征，目录与字典方法仍直接透传，住院病历上下文直接通过 `buildContext` 聚合包进入业务层 | [src/services/his/PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) |
| `services/his/registry.ts` | 适配器注册表与选择器：`getHisAdapter()` 是业务方唯一入口；选择优先级 `setActiveHisVendor` > `VITE_HIS_VENDOR` > `localStorage.HIS_VENDOR` > 默认 `phis`；handshake 时由 `useEventListeners` 调用 `resetHisAdapter` 清缓存 | [src/services/his/registry.ts](src/services/his/registry.ts) / [src/services/his/index.ts](src/services/his/index.ts) |
| `hisIntegrationLog.ts` | HIS 联调调用日志客户端：为 PHIS 出站请求生成 / 记录结构化日志，提供查询、清空和导出 Tauri 命令封装 | [src/services/hisIntegrationLog.ts](src/services/hisIntegrationLog.ts) |
| `diagnosisPath.ts` | 诊断路径数据构建与独立窗口事件载荷封装；优先通过 LLM 生成结构化推理链，再在前端校验并映射为 Sankey 节点、连线和说明文案，失败时回退本地兜底链路；载荷中补充 `supportingEvidence`、`counterEvidence`、`differentialPoints` 三段式解释字段，供窗口右侧说明面板直接渲染 | [src/services/diagnosisPath.ts](src/services/diagnosisPath.ts) |
| `reportInterpretation.ts` | 检验检查报告解读核心与独立窗口兼容 facade：接收 `taskId + query + patientContext`，解析报告元数据与异常指标，构建检验/影像 prompt，调用 `llm.ts` 返回结构化解读 payload，并在模型不可用时回退本地摘要；`resolveReportInterpretationRequest` / `buildReportInterpretationPayload` 同时供应用内工作台复用，只有 `openReportInterpretationWindow` 承担 Tauri 独立窗口 ready/status/update 生命周期 | [src/services/reportInterpretation.ts](src/services/reportInterpretation.ts) |
| `feedback.ts` | 会话反馈服务；负责会话、推荐、反馈、性能指标的本地落库与服务端同步，同时把结构化操作日志转成服务端审计接口可消费的 `{ module, action, result, ... }` 载荷 | [src/services/feedback.ts](src/services/feedback.ts) |
| `voiceFeedback.ts` | 语音反馈服务；负责推荐项 / 病例字段 / 整页反馈 payload 组装、本地草稿恢复、病例字段差异摘要与待同步队列 | [src/services/voiceFeedback.ts](src/services/voiceFeedback.ts) |
| `aiTrace.ts` | 最近一次服务端 AI 调用链路上下文缓存；向反馈面板暴露 `traceId`、模型、场景、输入/输出摘要与耗时，并把 AI 代理调用按业务模块/动作回写到操作日志；AI trace 必须同时保留 `requestPayload/responsePayload` 完整业务出入参，供后台日志详情排障，凭据和语音原始音频不得进入 payload | [src/services/aiTrace.ts](src/services/aiTrace.ts) |
| `operationTracker.ts` | 结构化操作日志入口：白名单保留高价值业务事件，统一生成 `module/action/title/sourceModule/scene`，过滤 `collapse`、壳层导航等低价值噪声 | [src/services/operationTracker.ts](src/services/operationTracker.ts) |
| `featureUsageTracker.ts` | 服务端功能调用事件上报入口：按产品功能维度记录一次用户真实调用，入队时以 `crypto.randomUUID()` 生成事件 ID 并固化医生 / HIS 机构 / 客户端版本上下文，随后批量写入远端 `/v1/client/feature-events/batch`；所有功能事件都按允许字段重建，不保存或上传 payload、consultationId、traceId、sessionId、调用方原始幂等文本，幂等键只由功能编码与事件 UUID 重建，旧队列中的非 UUID 事件 ID 会在本地替换；批量结果按事件逐条结算，拒绝项进入有界诊断隔离队列，畸形响应保留整批；幂等只覆盖离线重试 / 接口重试，不把同一就诊的再次显式入口合并掉 | [src/services/featureUsageTracker.ts](src/services/featureUsageTracker.ts) |
| `themeService.ts` | 主题管理 | [src/services/themeService.ts](src/services/themeService.ts) |
| `pmphai.ts` | PMPHAI 集成 | [src/services/pmphai.ts](src/services/pmphai.ts) |
| `knowledgeBase.ts` | 知识库检索 | [src/services/knowledgeBase.ts](src/services/knowledgeBase.ts) |
| `types/consultationAssist.ts` | 主问诊灵活模式的动作类型、诊断路径候选类型与上下文结构定义，避免继续依赖历史 session 命名 | [src/types/consultationAssist.ts](src/types/consultationAssist.ts) |
| `types/reportInterpretation.ts` | 报告解读域类型：定义 `taskId/query/patient` 请求结构，以及独立窗口消费的结构化摘要、异常项、风险提示与患者上下文快照 | [src/types/reportInterpretation.ts](src/types/reportInterpretation.ts) |
| `templateService.ts` | 症状模板管理 | [src/services/templateService.ts](src/services/templateService.ts) |
| `factChecker.ts` | AI 防误防漏 / 审查能力；语音结果页只通过 `features/voice-consultation/model/useVoiceResultFactCheckState.ts`、`features/voice-consultation/model/useVoiceResultFactCheck.ts` 和 `features/voice-consultation/model/useVoiceSafetyReview.ts` 编排调用，不在组件内直接维护复核进度和 issue map | [src/services/factChecker.ts](src/services/factChecker.ts) |
| `safetyRules.ts` | L1 刚性安全复核规则引擎：纯本地、确定性、无网络的硬规则集合（抗生素过敏交叉、诊断-性别冲突、儿童禁用药、重复用药）；输入 `GeneratedRecord + PatientInfo`，输出 `RigidBlockAlert[]`；只暴露 `evaluateRigidSafetyRules`，不直接持有 UI 状态，由 `features/voice-consultation/model/useVoiceRigidBlock.ts` 包装为响应式 composable 后供 `VoiceRigidBlockBanner.vue` 渲染 | [src/services/safetyRules.ts](src/services/safetyRules.ts) |
| 患者长期记忆 | 当前仓库仅保留 `docs/patient-memory-*.drawio/png` 等历史规划图，未落地 `patientMemoryStore.ts`、`patientMemoryBackend.ts`、`patient_memory.rs` 或专用 SQLite migration。任何恢复该能力的工作必须先补架构 / API / 数据迁移文档，再实现前端 service、Rust command 和缓存管理 UI | `docs/patient-memory-architecture.drawio` / `docs/patient-memory-call-paths.png` |
| `useSafetyIssueResolver.ts` | L2 柔性提醒到 record 的执行层：把 `VoiceSafetyIssue` 解析为 `remove_medications` / `add_lab_tests` / `none` 动作计划，并在医生点击"采纳建议"时直接 mutate `record.medications` / `record.labTests`；通过 `getRecord/onRecordUpdated` 注入避免循环依赖，应用后自动重跑 L1 与 L2 复核；真实实现已迁至语音问诊功能域，旧路径只保留兼容 re-export | [src/features/voice-consultation/model/useSafetyIssueResolver.ts](src/features/voice-consultation/model/useSafetyIssueResolver.ts) |
| `promptGuard.ts` | Prompt 注入与泄漏保护 | [src/services/promptGuard.ts](src/services/promptGuard.ts) |
| `textGeneration.ts` | 主诉/现病史等文本生成辅助 | [src/services/textGeneration.ts](src/services/textGeneration.ts) |
| `regionalClient.ts` / `services/regional/*` | 服务端接入核心客户端 facade 与内部模块。`regionalClient.ts` 只保留兼容导出；真实职责拆到 `services/regional/config.ts`（连接配置与历史本地配置清理）、`device.ts`（设备编码）、`registration.ts`（终端注册与 token）、`httpClient.ts`（签名 HTTP 请求、服务端时间偏移校准、`SIG-401` 重签重试）、`bootstrap.ts`（bootstrap 缓存、初始化、心跳）、`realtime.ts`（SSE 与 WebSocket 签名 URL）、`speechUpload.ts`（语音上传 payload）。所有 `/v1/*` HTTP/SSE/WebSocket 出口必须经过签名模块，不允许业务代码直接 `fetch` 服务端接口 | [src/services/regionalClient.ts](src/services/regionalClient.ts) / [src/services/regional/index.ts](src/services/regional/index.ts) |
| `regionalRuntime.ts` | 服务端连接运行时编排：统一初始化、重连、远程 Prompt/模板/映射同步和审计上传启动/关闭；初始化成功后额外发送 `regional_runtime_initialized` 审计事件，方便直接在后台确认链路打通 | [src/services/regionalRuntime.ts](src/services/regionalRuntime.ts) |
| `userFeedback.ts` | 服务端问题反馈服务；负责图片编码、评分/说明校验、反馈 scope 元数据合并和调用远端 `/v1/client/feedbacks` 接口 | [src/services/userFeedback.ts](src/services/userFeedback.ts) |
| `consultationUserLog.ts` | 服务端运维用户日志服务；负责组装智能问诊/语音问诊首版与最终快照，语音问诊额外编码录音和 ASR 文本，并调用远端 `/v1/client/user-logs/consultations` 聚合到同一条问诊日志 | [src/services/consultationUserLog.ts](src/services/consultationUserLog.ts) |
| `promptOverride.ts` | 远程 Prompt 覆盖层：管理端发布的自定义 prompt 替换本地默认值 | [src/services/promptOverride.ts](src/services/promptOverride.ts) |
| `auditUploader.ts` | 审计事件批量上报：调用远端 `/v1/client/audit/events/batch`，本地只保留轻量离线队列用于失败重试；恢复遗留队列后立即补传，新事件入队后也会异步触发一次立即上报尝试；`operation` 事件会保留 `operationType/operationName/details`，并补齐 `module/action/result` 供服务端日志表查询；AI 调用类事件的 `details` 必须同时包含摘要与完整业务出入参，避免后台只能看到截断文本；不承担功能调用统计 | [src/services/auditUploader.ts](src/services/auditUploader.ts) |

### 当前模板/映射读取策略

1. `templateService.ts` 优先读取服务端同步缓存，本地 JSON 模板仅作为内置兜底。
2. `medicalData.ts` 启动时只恢复允许持久化的诊断、药品和非检查检验诊疗项目缓存；检查 / 检验目录由每次接诊实时预取并仅保留在内存中。当前药房库存与药品详情仍由 HIS Adapter 按需读取，用于推荐定稿和库存校验；这属于 HIS 集成，不是被废弃的本地 AI 模式。
3. 运行期可通过 `window.__medicalCatalogDebug__` 查看 SQLite 路径、同步状态、清理指定持久化目录并手动触发重同步，用于日常联调排查；检查 / 检验实时目录不计入 SQLite 行数。
4. `catalog` 匹配归一化规则固定为：小写后去除空格、连字符、下划线（`/[\s_-]/g`），用于兼容 `tcm_diagnoses/tcm-diagnoses/tcm diagnoses` 等格式。
5. 西医推荐诊断的 UI 分组固定按 ICD-10 类目码前三位做章节归类；当编码无法解析到标准章节时，前端回退到"未分类/待确认"分组，避免丢失候选项。

### 服务端托管运行链路

应用不再提供本地/区域模式开关。配置 `REGIONAL_BASE_URL / REGIONAL_ORG_CODE` 后，启动流程固定为：

```
main.ts mount
    ↓
initializeRegionalRuntime()
    ├─ initializeRegionalClient()
    │   ├─ registerDevice() → POST /v1/client/register
    │   ├─ getBootstrapConfig() → GET /v1/client/bootstrap
    │   ├─ stale token 时 clear auth cache 后自动重新 register
    │   └─ startHeartbeat() (30s interval)
    ↓
Promise.allSettled([
    syncRemotePrompts(),    → GET /v1/client/prompts/delta
    syncRemoteTemplates(),  → GET /v1/client/templates/delta
    syncRemoteData(),       → GET /v1/client/mappings/delta
])
    ↓
startAuditUploader() (startup flush + enqueue flush + 30s retry)
```

设置页保存服务端接入参数时，复用 `initializeRegionalRuntime() / reinitializeRegionalRuntime()` 链路即时生效，不要求重启应用；首启写入 `REGIONAL_BASE_URL=<VITE_REGIONAL_BASE_URL 或 http://127.0.0.1:8080> / REGIONAL_ORG_CODE=<VITE_REGIONAL_ORG_CODE 或 ORG001>`。升级时会删除 `REGIONAL_ENABLED` 和本地模型、语音、知识库凭据。设备编码首次优先写入当前机器 MAC 地址，若 MAC 暂不可读才生成本地兜底值；一旦已有 `REGIONAL_DEVICE_CODE`，后续启动不再重复探测 MAC。Windows 下 MAC 探测通过 `GetAdaptersAddresses` 直接读取网卡信息，不再启动 `getmac` / `ipconfig` 子进程，避免控制台窗口闪烁。

保存行为约束：

1. “保存参数”与“连通性校验”分离：即使 `PCIE Server` 暂时不可达，接入参数也应先持久化成功。
2. 若后台可连通，设置页显示连接成功状态，并补发 `regional_connection_saved` 操作日志。
3. 若后台不可达或返回错误，设置页仍保留“参数已保存”的结果，但连接状态与 toast 需要尽量展示真实失败原因，如网络不可达、设备鉴权失败、机构编码未识别或服务端 500；不再把整个保存动作判成失败。

当前服务路由：

| 服务 | 唯一运行路径 |
|------|-------------|
| LLM Chat | 签名 SSE/POST `/v1/ai/chat`，模型凭据由服务端持有；客户端与服务端双重限制 `enableSearch` 只作用于 `chat-stream / chat_panel` 流式小助手请求，其他问诊与病历场景强制关闭 |
| 批量语音转写 | 签名 POST `/v1/ai/speech/transcribe` |
| 阿里实时语音 | 签名 WebSocket `/v1/ai/speech/realtime/ws`，失败后降级签名 POST `/v1/ai/speech/realtime` |
| Prompt / 模板 | bootstrap + delta 覆盖，本地内置内容仅作失联兜底 |
| 医学目录 | 恢复本地缓存后同步服务端 delta；当前药房库存由 HIS Adapter 按需校验 |
| 操作日志 / 反馈 / 功能统计 | 本地失败重试队列 + 服务端批量接口 |
| Reviewer / PMPHAI / KB 配置 | bootstrap 下发，客户端不保存第三方凭据 |

客户端版本更新链路仍由 Tauri updater 执行安装与签名校验，settings 功能域下的 `UpdateChecker.vue` 只负责更新源配置、检查按钮、进度与安装动作编排，`ForceUpdateGate.vue` 只在强制更新时承接门禁展示并复用同一检查/安装 UI。若用户未手工配置内网更新源，`updateConfig.ts` 会从当前服务端地址推导出：

- 正式内网：`{REGIONAL_BASE_URL}/v1/client/releases/production/latest.json`
- 测试内网：`{REGIONAL_BASE_URL}/v1/client/releases/testing/latest.json`

`PCIE Server` 后台上传版本后生成 Tauri 兼容 `latest.json` 和公开下载地址；这些公开地址不携带设备令牌，避免 updater 下载阶段无法附带自定义鉴权头。内网部署允许使用 `http://` 更新源，`tauri.conf.json` 已通过 updater 的 `dangerous-insecure-transport-protocol` 开启非安全传输协议，运行时注入的 updater endpoint 同样继承该配置；安装包签名校验仍由 Tauri updater 强制执行。

`main` 是当前仓库唯一正式桌面客户端发布线，自 `1.4.0` 起继续单调递增；`feature/two-chronic-diseases` 属于另一产品方向，不合并回 `main`，后续移出当前仓库，也不得再使用本仓库正式更新通道或复用正式版本号。为保证已经安装的 `1.2.x` 与另一分支曾发布的 `1.3.x` 客户端都能升级，正式版本必须严格高于仓库所有历史公开版本，并继续保留 `com.med-hermes.app` Bundle Identifier、既有 updater 公钥和兼容更新地址。GitHub 发布先以 draft 汇聚 macOS / Windows 产物，只有在统一 `latest.json` 的版本、平台 URL、安装包文件名和 `.sig` 内容与同一次构建产物逐项匹配后才转为 latest 正式发布；不得复用旧 tag、旧 draft 或旧 `latest.json`。公开发布成功后，历史 `floating-ball` 仓库地址依赖 GitHub 仓库重命名重定向继续访问同一 release，当前及后续客户端直接使用 `pcie` 地址。

正式发布前增加独立候选构建层：`scripts/test-release.mjs` 根据当前三处一致的正式版本计算或接收候选版本，只在构建进程内临时改写 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml`，构建结束后无论成功或失败都恢复原内容；`.github/workflows/test-build.yml` 允许从当前选定 ref 手动生成 macOS / Windows 签名测试包，但只上传 GitHub Actions Artifact，不创建 tag、Release、draft 或更新清单。候选通过后，`scripts/release.mjs` 在干净的 `main` 工作区显式固化同一版本、提交并创建正式 tag，随后 `.github/workflows/release.yml` 才能进入公开发布链路。完整操作见 `docs/release-process.md`。

Windows 7 仅保留独立技术验证构建，不进入正式客户端支持范围。`src-tauri/tauri.win7.conf.json` 通过 Tauri config merge 覆盖独立 identifier、WiX UpgradeCode、WebView 安装模式和 updater 关闭状态，并移除正式 WiX 模板以避免执行历史安装线迁移；`.github/workflows/win7-test-build.yml` 固定 nightly 工具链，以 `x86_64-win7-windows-msvc + build-std` 生成 x64 MSI，并只上传带来源清单的 Actions Artifact。由于 Tier 3 target 不属于 rustup 可下载组件，构建步骤会临时隐藏 `rustup.exe` 绕过 Tauri CLI 的 rustup-only target 预检，并在结束时恢复；实际 Cargo/rustc 仍由固定 nightly、`rust-src` 和 `build-std` 驱动。Win7 flavor 还通过 `scripts/win7-cargo-runner.cmd` 把 Tauri 构建参数转交给 `scripts/win7-cargo-runner.mjs`，仅在该路径将 `tauri-utils 2.9.3` 固定到上游 ctor Win7 兼容修复提交，避免改变正式 Cargo.lock。验证包设置 `webviewInstallMode = skip`，不下载或内嵌运行时，Windows 7 SP1 x64 实机必须先由验证人员单独安装 WebView2 109。该 flavor 继续继承 `med-hermes` 深链以维持 HIS 技术契约，因此不得与正式客户端共机安装；构建成功也不能代替实机的安装、启动、WebView、Bridge 和 SDK handshake 冒烟。完整边界见 `docs/release-process.md`。

WebView2 在 Windows 7 上不支持透明默认背景，WRY 会为避免创建失败而忽略透明 alpha，因此 Win7 球态不依赖 WebView 透明合成。`tauri.win7.conf.json` 通过 `win7-legacy` Cargo feature 启用 `src-tauri/src/win7_window_region.rs`：待机球态使用中心椭圆原生 region，环绕菜单展开时使用“中心球 + 四个菜单圆”联合 region，从而裁掉 WebView2 的矩形白底。`app/shell/useWin7WindowRegion.ts` 只根据 `isWorking / transitioning / isHovered` 编排 region 模式；任何主窗口几何变更前必须先恢复 full region，球态稳定后才能重新裁剪，避免旧 region 截断工作面板。正式 Windows/macOS 构建不启用该 feature，原透明窗口路径保持不变。

Tauri `productName` 固定使用 ASCII 产物标识 `PCIE`，让跨平台安装包、`.sig` 与 `latest.json` 始终使用稳定文件名，避免发布 action 对中文及全角括号二次清洗后找不到签名；该字段不再直接决定 Windows 客户可见名称。Windows 安装包只发布 Tauri WiX MSI，不再同时生成 NSIS `.exe`。Windows 专用配置位于 `src-tauri/tauri.windows.conf.json`，其中 `bundle.targets = "msi"`、`bundle.windows.wix.language = "zh-CN"`，并通过 `windows/wix/main.wxs` 将“已安装的应用”、桌面快捷方式和开始菜单统一显示为正式中文品牌“全医慧助（PCIE）”，安装目录及 release 产物仍保持 `PCIE`。

Windows MSI 的主 `UpgradeCode` 固定为 `3b611483-0215-50cb-b961-cf1a889c5546`（已发布 `PCIE` 安装线），禁止再由 `productName` 隐式推导。自定义 WiX 模板同时检测并迁移 `MedHermes` 的 `14565492-a50a-59b4-b895-f9ebb5c21055` 与早期中文产品名的 `b12fd688-122f-51fe-bec8-022d41a503e1`，使从 `1.2.97/1.2.98`、`1.2.99`、`1.3.x/1.4.1` 升级时都只保留一套当前应用；安装阶段还要清理历史 `MedHermes` / `PCIE` 桌面与开始菜单快捷方式。发布 preflight 必须同时验证主升级码、模板路径、中文显示名和两套历史迁移码，Windows 真实冒烟至少覆盖 `1.2.97 -> 新版` 与 `1.4.1 -> 新版`。

### 当前本地基础设施边界

1. `src-tauri/src/http_server.rs` 仅保留 HIS/SDK 所需的本地 `/api/consultation/*`、住院病历入口和事件回执通道；已删除 `/api/pmphai/*` 第三方代理。
2. `operationTracker.ts` 与 `feedback.ts` 把事件规范化后送入服务端审计链路；本地只保留失败重试队列和 HIS 联调 JSONL 日志，不再维护产品分析 SQLite。
3. `pmphai.ts` 与 `knowledgeBase.ts` 只调用签名 `/v1/knowledge/pmphai/*` 和 bootstrap 配置。
4. 窗口管理、音频采集、HIS Adapter、目录 SQLite 缓存和本地确定性安全规则仍是桌面端基础能力，不属于已废弃的本地模式。

### `audioRecorder.ts` 能力说明

- 统一封装麦克风流请求：优先 `navigator.mediaDevices.getUserMedia`，兼容 legacy `getUserMedia` 系列 API
- 提供麦克风错误归一化：将浏览器/系统异常映射为用户可理解提示
- 提供输入设备枚举、首选 `deviceId` 持久化、首开权限预热与设备失效回退，保证 `VoiceCapsule.vue` 与 `ChatPanel.vue` 复用同一套音频选择策略
- 为 `VoiceCapsule.vue` 与 `ChatPanel.vue` 提供一致的录音能力基座

### 语音转写网络策略

- `llm.ts` 中 `transcribeAudio` 只调用签名 `/v1/ai/speech/transcribe`，客户端不持有语音供应商 key 或直连地址。
- `aliyunSpeech.ts` 中 `RealtimeSpeechService` 统一采集 PCM：`aliyun-dashscope` 与 `funasr-websocket` 走签名 `/v1/ai/speech/realtime/ws`；首次建链失败时转入批量模式，录音中途收到非主动 `error` / `final` / `close` 时按 `1/2/4/8/15 秒`上限的 full-jitter capped exponential backoff 自动重连，不允许 0ms 立即重试。每次重连都重新申请签名 WebSocket URL 和 nonce，避免复用过期或已消费凭据；等待期间暂存待发 PCM。每轮录音使用独立会话 epoch，关闭或重新开始后，上一轮尚未完成的退避协程不得在新会话中复活。重连只会建立新的实时识别任务，不保证把原节点上的上游识别会话迁移到新节点。只要实时链路发生过中断，停止录音后就使用完整本地音频调用 `/v1/ai/speech/realtime` 批量补录，失败时才保留已收到的实时文字；`openai-compatible` 统一走批量转写。FunASR 原生地址和协议仅由服务端托管。
- `ChatPanel.vue` 通过 `features/chat/model/useChatVoiceInput.ts` 把 `audioRecorder` 的 PCM 数据持续交给 `RealtimeSpeechService`，与 `VoiceCapsule.vue` 共用 bootstrap 下发的 speech provider/model/sampleRate/format；配置为 `funasr-websocket` 时，聊天麦克风不得在录音结束后直接跳到 `/v1/ai/speech/realtime` 批量接口。`SPEECH_TEST_MODE` 仅用于开发测试夹具，不提供生产本地执行路径。
- 审查 AI（`factChecker.ts` -> `llm.ts/chat`）复用签名 `/v1/ai/chat`，启用状态、模型和 `checkExaminationEnabled` 来自 bootstrap。

---

## 数据流

### 1. HIS 集成数据流

```
HIS 系统 (HTTP POST)
    ↓
Rust HTTP Server (src-tauri/src/http_server.rs)
    ↓
Tauri Event Emission (start-consultation, show-patient-risks)
    ↓
useEventListeners (监听事件)
    ↓
更新全局状态 (App.vue: currentPatient)
    ↓
navigation.openConsultation() (打开原症状问诊主流程)
    ↓
ConsultationPage.vue (渲染)
```

### 1.2 HIS 灵活模式数据流

```
HIS 医生站当前患者上下文
    ↓
医生通过 PHIS AI 按钮或附加入口点击目标动作
    ↓
Tauri Event / Deep Link / HTTP Bridge
    ↓
App.vue 更新 currentPatient + assist 上下文
    ↓
App.vue 写入目标动作 trigger
    ↓
ConsultationPage.vue 根据上下文决定：
    - 是否跳过症状选择
    - 是否直接进入病历详情页
    - 是否自动触发诊断 / 鉴别 / 用药 / 检查
    - 患者 / 就诊锚点变化时清空上一患者问诊现场并作废未完成 AI 请求
    ↓
医生确认草稿 / 发起引用 / 继续编辑
    ↓
Tauri Command: complete_consultation 写入当前草稿或引用请求
    ↓
HIS 通过 WebSocket /api/consultation/events/ws 接收事件，断线后携带 event.id 自动重连
    ↓
PHIS 保存成功 / 失败后调用 POST /api/consultation/reference-feedback
    ↓
floating-ball 保持当前问诊页面展开，并在同一运行期内更新页面状态与日志
```

### 1.3 检验检查报告解读流

```
外部单报告：HIS POST /api/report/interpret -> start-report-interpretation -> 独立窗口 ready/status/update

接诊报告助手：fetchPatientHistory 最近历史明细
  -> PHIS Adapter 提炼 sdApply=3 的 reportedApplications
  -> reception report-interpretation opportunity
  -> 风险胶囊统一“报告助手”入口
  -> ReportInterpretationWorkspace 按历史 visitId 获取实际报告结果
  -> 医生选择单份报告
  -> 立即展示结构化原始报告（项目 / 结果 / 方向 / 参考范围，或检查所见 / 结论）
  -> 医生点击“开始 AI 解读”（选择报告本身不发起 AI 请求）
  -> 结构化 abnormal/direction/abnormalFlag/result/参考范围交叉复核并生成确定性异常项；keyPoints 不参与异常判定
  -> resolveReportInterpretationRequest / buildReportInterpretationPayload
  -> 完整结构化 AI 解读一次性落屏并切换到 AI 视图（不流式渲染半截 JSON，可返回原始报告）
  -> ReportInterpretationContent 共用报告单式正文
  -> 若报告属于本次 report-follow-up 上下文，可升级进入 OutpatientFollowUpPage 生成后续方案
```

---

### 2. 语音问诊数据流

```
用户点击语音按钮
    ↓
useOutpatientScenarioRouter.resolveVoiceEntry()
    ↓
语音缓存是否存在
    ├── 是：恢复既有语音结果页
    └── 否：读取当前接诊患者与本次就诊标识
    ↓
HisAdapter.fetchOutpatientFollowUpReportResults(patientId, currentVisitId)
    ↓
本次门诊病历纯文本关联到已出具的检验/检查报告
    ├── 是：进入独立门诊复诊工作台，左侧预览依据，右侧生成后续诊疗方案
    └── 否：继续原语音录音问诊流程
    ↓
navigation.startVoiceInteraction()
    ↓
VoiceCapsule.vue (开始录音)
    ↓
audioRecorder.ts (麦克风兼容检测 + 采集 PCM16 音频)
    ↓
RealtimeSpeechService (优先 DashScope，可降级 OpenAI 兼容转写)
    ↓
通过签名 /v1/ai/speech/realtime/ws 逐帧发送 PCM；不可用时编码整段录音并上传 /v1/ai/speech/realtime
    ↓
voiceConsultation.handleVoiceStop() (停止录音)
    ↓
llm.ts (调用 LLM API，生成结构化病历)
    ↓
JSON 解析验证 (useVoiceConsultation.ts)
    ↓
VoiceConsultationNew.vue (右栏诊断/治疗 + 一键回写)
    ↓
buildRecordConfirmedPayload (src/features/clinical-result/recordConfirmedPayload.ts)
    ↓
Tauri Command: complete_consultation（resultType=record-confirmed）
    ↓
HIS 系统（通过 WebSocket /api/consultation/events/ws 获取）
```

---

### 3. 窗口状态流

```
用户操作触发
    ↓
navigation.openConsultation()
    ↓
useWindowTransitionCoordinator.transitionToView('consultation')
    ↓
按目标形态决定是否淡出并锁定本轮 transition token
    ↓
windowGeometry.resolveWindowGeometry(...)（纯函数）
    ↓
实时 currentMonitor.workArea + DPI 换算 + 历史尺寸裁剪
    ↓
windowMgmt.resizeWorkWindow(...)
    ↓
Tauri Command: apply_main_window_geometry（单次 IPC，按扩大/缩小选择 position/size 顺序）
    ↓
窗口几何稳定后提交 currentView
    ↓
提交 Vue 内容后立即恢复可见；胶囊恢复不可缩放，大工作台保持可缩放
```

窗口壳职责分层：

1. `app/shell/windowGeometry.ts` 是纯几何策略，只计算 `workArea` 内的安全逻辑尺寸和物理位置，不读取 Vue 状态、不调用 Tauri。
2. `app/shell/useWindowManagement.ts` 是原生窗口适配层，负责读取实时显示器、通过 `apply_main_window_geometry` 单次 IPC 应用位置/尺寸、等待 resize 完成和持久化偏好；历史尺寸永远不能绕过实时工作区裁剪。
3. `app/shell/useWindowTransitionCoordinator.ts` 是单主窗口过渡控制器，负责可选淡出/淡入、串行化过渡、延后提交 `currentView` 和胶囊 resizable 策略。恢复可见性只等待 Vue `nextTick`，不得继续等待后台 WebView 可能暂停的 `requestAnimationFrame`；语音阶段 resize 默认不淡出。
4. `app/shell/useWorkMode.ts` 只编排悬浮球与工作模式生命周期，并区分显式 `openReceptionCapsule` 与仅当前患者胶囊可执行的 `resizeReceptionCapsule`；`app/navigation/useNavigation.ts` 只声明目标视图，患者胶囊进入语音采集时明确使用无淡出小窗过渡，不再自行决定“先换页面还是先改窗”。
5. `VoiceCapsule.vue`、`ReceptionCapsule.vue` 等业务 UI 只能上报目标阶段或用户动作，不得直接调用 Tauri `setSize / setPosition`。
6. 结束就诊通过 coordinator 的 terminal ball transition 与其他几何请求共用一条队列：先使旧请求失效并等待在途原生调用结束，再应用 `160×160 + minSize + resizable=false`，最后提交 `isWorking=false`。球态下 `resizeCurrentView` 必须直接忽略；风险与接诊机会分析结束后的尺寸请求必须走 `resizeReceptionCapsule`，只有 `isWorking=true && currentView='reception-capsule'` 才能进入队列，防止迟到更新覆盖语音采集或其他工作台。

---

### 4. 事件监听流

```
应用启动
    ↓
App.vue onMounted
    ↓
eventListeners.registerAllListeners()
    ↓
并发注册所有监听器:
  - Deep Link (onOpenUrl)
  - HIS 事件 (listen('show-patient-risks'), listen('start-consultation'))
  - 窗口事件 (appWindow.listen('tauri://move'), listen('tauri://resize'))
  - 鼠标事件 (listen('hover-change'), listen('mouse-pos'))
    ↓
事件触发时调用对应 composable 方法
    ↓
App.vue onUnmounted
    ↓
eventListeners.unregisterAllListeners()
```

---

## 维护指南

### 前端文件结构规划

前端路径治理以 [docs/frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md) 为迁移路线图，复用边界和设计模式以 [docs/frontend-reuse-architecture.md](docs/frontend-reuse-architecture.md) 为准。当前 `src/components`、`src/composables`、`src/services` 仍保留历史扁平结构，但新增业务代码应优先进入规划中的 `features/<feature>/ui|model|api|lib`、`entities/*`、`shared/*` 或 `services/<integration>`。

路径迁移遵循三条原则：

1. 先判断能力归属和复用模式，再建立公开入口和兼容 facade。
2. 高风险入口（`ConsultationPage.vue`、`VoiceConsultationNew.vue`、`useEventListeners.ts`）先收敛 controller / strategy / builder，再迁移入口路径；避免只把大文件切成更多无边界 helper。`useEventListeners.ts` 的接诊状态机归入 `app/events/useReceptionController.ts`，SDK handshake 初始化归入 `app/events/useSdkHandshakeController.ts`，事件文件继续作为 Tauri event hub。
3. 每次迁移必须同步更新 `CODE_MAP.md` 和规划文档中的映射关系，并至少执行前端构建验证。
4. 如果拆分后不能删除旧逻辑、减少重复规则或形成稳定复用接口，应暂停继续拆分，先回到复用架构规划重划边界。

### 添加新 Composable

1. 新业务 composable 默认放入 `src/features/<feature>/model/`；只有跨业务且不依赖 feature 的通用 composable 才放入 `src/shared/composables/`；历史 `src/composables/` 仅保留旧入口或兼容 facade。
2. 遵循命名规范：`use[功能名].ts`
3. 导出明确的接口：
   ```typescript
   export interface UseFeatureOptions {
     // 参数定义
   }

   export function useFeature(options: UseFeatureOptions) {
     // 实现
     return {
       // 导出 API
     };
   }
   ```
4. 添加 JSDoc 文档注释
5. 更新本文档的 [组合式函数](#组合式函数-composables) 章节或 [docs/frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md) 对应功能域映射

### 添加新组件

1. 新业务组件默认放入 `src/features/<feature>/ui/`；只有真正跨业务、无领域语义的基础组件才放入 `src/shared/ui/`；历史 `src/components/` 仅保留旧入口或兼容 facade。
2. 明确定义 Props 和 Emits（使用 TypeScript）
3. 组件职责单一，避免过大
4. 更新本文档的 [组件](#组件-components) 章节或 [docs/frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md) 对应功能域映射
5. 若组件会修改本地桥接行为、回写结构或窗口形态，再同步更新 `api.md` / `PRODUCT.md`

### 添加新常量

1. 在 `src/constants/` 创建或更新文件
2. 使用 TypeScript 类型定义
3. 提供工具函数（如 `getWindowSizeForView`）
4. 更新本文档的 [常量](#常量-constants) 章节

### macOS 媒体权限配置

语音录音功能在 macOS 依赖应用级权限声明，相关文件位于 `src-tauri/`：

- `Info.plist`：声明 `NSMicrophoneUsageDescription`
- `Entitlements.plist`：声明 `com.apple.security.device.audio-input`
- `tauri.conf.json`：在 `bundle.macOS` 显式引用上述两个文件

若缺少以上配置，WebView 可能无法暴露 `navigator.mediaDevices.getUserMedia`，导致前端录音入口不可用。

### 修改现有模块

1. 先阅读本文档了解当前职责
2. 确保修改符合模块的单一职责原则
3. 修改代码后同步更新本文档
4. 运行测试确保不影响其他模块
5. 若改动涉及 `/api/consultation/*` 或结果通道，必须同时核对 `api.md`

---

## 重构历史

### 2026-02-10 - 大规模模块化重构完成（历史记录）

**目标**: 将 App.vue 从上帝类（1548 行）重构为轻量级编排器（425 行）

**成果**:
- ✅ 代码减少 72.5%（1548 → 425 行）
- ✅ 创建 5 个 Composables（共 1,673 行）
- ✅ 创建 2 个常量文件
- ✅ 创建 3 个样式模块文件
- ✅ 架构从单体转向组合式模式

**具体变更**:

| 日期 | 变更 | 代码减少 | 创建文件 |
|------|------|---------|---------|
| 2026-02-10 | 创建 `constants/windowSizes.ts` | ~50 行 | ✅ |
| 2026-02-10 | 创建 `constants/animation.ts` | ~50 行 | ✅ |
| 2026-02-10 | 创建 `composables/useWindowManagement.ts` (430 行) | ~200 行 | ✅ |
| 2026-02-10 | 创建 `composables/useWorkMode.ts` (428 行) | ~243 行 | ✅ |
| 2026-02-10 | 创建 `styles/global.css` | ~60 行 | ✅ |
| 2026-02-10 | 创建 `styles/layouts/app-layout.css` | ~120 行 | ✅ |
| 2026-02-10 | 创建 `styles/animations/morph.css` | ~20 行 | ✅ |
| 2026-02-10 | 创建 `composables/useEventListeners.ts` (415 行) | ~230 行 | ✅ |
| 2026-02-10 | 创建 `composables/useNavigation.ts` (180 行) | ~70 行 | ✅ |
| 2026-02-10 | 创建 `composables/useVoiceConsultation.ts` (220 行) | ~130 行 | ✅ |

**总计**: App.vue 减少 **~1,123 行**（包括样式迁移）

### 架构改进

**重构前**:
```
App.vue (1548 行)
├── 窗口管理逻辑 (~200 行)
├── 工作模式逻辑 (~243 行)
├── 导航逻辑 (~70 行)
├── 语音问诊逻辑 (~130 行)
├── 事件监听逻辑 (~230 行)
├── 样式定义 (~200 行)
└── 其他逻辑 (~475 行)
```

**重构后**:
```
App.vue (425 行)
├── 状态声明 (~40 行)
├── Composables 初始化 (~90 行)
├── 辅助函数 (~50 行)
├── 生命周期钩子 (~100 行)
├── 模板 (~115 行)
└── 样式 (~30 行)

Composables / App controllers
├── app/shell/windowGeometry.ts (workArea / DPI 纯几何策略)
├── app/shell/useWindowTransitionCoordinator.ts (内容与原生窗口过渡编排)
├── app/shell/useWindowManagement.ts (~422 行)
├── app/shell/useWorkMode.ts (~422 行)
├── composables/useEventListeners.ts (~575 行)
├── app/events/useReceptionController.ts (~505 行)
├── app/events/useSdkHandshakeController.ts (~240 行)
├── composables/useVoiceConsultation.ts
└── app/navigation/useNavigation.ts

Constants (2 个)
├── windowSizes.ts
└── animation.ts

Styles (3 个)
├── global.css
├── layouts/app-layout.css
└── animations/morph.css
```

### 性能优化

- ⚡ 窗口切换使用实时显示器 `workArea`；缓存仅用于查询失败降级，避免跨屏 DPI 使用旧边界
- ⚡ 窗口移动防抖（500ms）
- ⚡ 窗口大小变化防抖（200ms）
- ⚡ GPU 加速动画（transform, opacity）
- ⚡ 大小/位置请求在单次过渡内串行执行，过期的排队请求在应用几何前丢弃
- ⚡ 统一事件监听管理（避免内存泄漏）

### 代码质量指标

| 指标 | 重构前 | 重构后 | 改进 |
|------|--------|--------|------|
| App.vue 代码行数 | 1,548 | 425 | ↓ 72.5% |
| 最大函数行数 | ~130 | ~40 | ↓ 69% |
| 模块数量 | 1 | 12 | 模块化 |
| Composables 复用性 | 0% | ~85% | 大幅提升 |
| 单元测试难度 | 极高 | 中等 | 易于测试 |

---

## 架构优势

### 1. 可维护性 ⭐⭐⭐⭐⭐

**问题定位更快**:
- 窗口问题 → 直接查看 `useWindowManagement.ts`
- 导航问题 → 直接查看 `useNavigation.ts`
- 语音问题 → 直接查看 `useVoiceConsultation.ts`

**修改更安全**:
- 修改窗口管理不影响语音问诊
- 修改导航逻辑不影响事件监听
- 模块边界清晰，减少意外副作用

### 2. 可扩展性 ⭐⭐⭐⭐⭐

**添加新功能**:
- 创建新 Composable，在 App.vue 中一行初始化
- 不影响现有代码结构

**示例**:
```typescript
// 添加新功能只需 3 步
// 1. 创建 composable
export function useNewFeature(options) { ... }

// 2. 在 App.vue 中初始化
const newFeature = useNewFeature({ ... });

// 3. 使用
await newFeature.doSomething();
```

### 3. 可测试性 ⭐⭐⭐⭐⭐

**Composables 可独立测试**:
```typescript
// 测试窗口管理
import { useWindowManagement } from '@app/shell/useWindowManagement';

describe('useWindowManagement', () => {
  it('should save window position', async () => {
    const { saveWindowPosition } = useWindowManagement({...});
    await saveWindowPosition();
    // 断言...
  });
});
```

### 4. 团队协作 ⭐⭐⭐⭐⭐

**并行开发**:
- 开发者 A：优化窗口管理（`useWindowManagement.ts`）
- 开发者 B：增强语音功能（`useVoiceConsultation.ts`）
- 开发者 C：添加新视图（新组件 + `useNavigation.ts`）
- 互不干扰，最后在 App.vue 中集成

### 5. 知识传递 ⭐⭐⭐⭐⭐

**新人友好**:
- 清晰的模块划分
- 每个 Composable 都有明确的职责
- 完整的架构文档
- 易于理解和上手

---

## 总结

本架构通过**组合式模式**实现了高度的**模块化**、**可维护性**和**可扩展性**。

**核心原则**:
- ✅ 单一职责
- ✅ 关注点分离
- ✅ 组合优于继承
- ✅ 轻量级优于重量级

**技术选型**:
- ✅ Vue 3 Composition API（无额外状态管理库）
- ✅ TypeScript（类型安全）
- ✅ Tauri 2.0（跨平台桌面应用）
- ✅ 模块化 CSS（设计系统）

**未来方向**:
- 持续优化 Composables 的复用性
- 添加单元测试覆盖
- 性能监控和优化
- 文档持续更新

---

**文档维护**: 任何架构级别的修改都必须同步更新此文档。

**最后更新**: 2026-02-10
