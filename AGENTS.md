# AGENTS.md

全医慧助（PCIE，Primary Care Intelligent Expert）项目的协作规则；GitHub 仓库名为 `pcie`。

本项目是一个 `Tauri 2 + Vue 3 + TypeScript + Rust` 的基层医疗桌面工作站，当前真实运行形态包含：

1. 完整症状问诊主链路与主问诊内嵌灵活模式（`ConsultationPage.vue`）
2. 独立诊断路径窗口（`DiagnosisPathWindow.vue`）
3. 语音问诊与病历回写链路
4. 本地 HTTP Bridge 与 PHIS 引用回执入口（`src-tauri/src/http_server.rs`）
5. 服务端托管的外部知识库能力（`pmphai.ts` 为主，`KnowledgeBasePanel.vue` 为保留内置面板）

## 必读顺序

1. 先读 [CODE_MAP.md](./CODE_MAP.md) 快速定位要改的模块，按需深入
2. 再读 [ARCHITECTURE.md](./ARCHITECTURE.md) 理解整体架构
3. 涉及前端重构、复用、拆分或路径迁移时，先读 [frontend-reuse-architecture.md](./docs/frontend-reuse-architecture.md)，再读 [frontend-file-structure-plan.md](./docs/frontend-file-structure-plan.md)
4. 涉及本地 HIS 联调时再读 [api.md](./api.md)
5. 涉及交互、产品约束时再读 [PRODUCT.md](./PRODUCT.md)
6. 遇到疑似踩过的坑时，先查 [RETRO.md](./RETRO.md) 已有经验
7. 涉及历史上反复摇摆的设计决策时，先查 [DECISION_DRIFT.md](./DECISION_DRIFT.md)
8. 涉及服务端接入、设备签名或 `/v1/*` 契约时，读取 [../floating-ball-server/API.md](../floating-ball-server/API.md)、真实调用代码和 `requestSigner.ts`；旧区域化草案已归档，不作为当前契约

## 强制流程

1. 文档先行：架构、窗口形态、事件流、回写行为、模块职责变化，先改文档再改代码。
2. 契约同步：`src-tauri/src/http_server.rs` 或 `complete_consultation` 结果结构变化时，必须同步更新 `api.md`。
3. 规则同步：包管理器、验证命令、目录职责、Review 关注点变化时，必须同步更新本文件。
4. 交付顺序：`ARCHITECTURE/API/PRODUCT/AGENTS -> 代码 -> 构建/测试/手测说明`

## 硬约束（禁止）

以下规则优先级高于一切建议性条款，违反即视为无效交付：

1. **ConsultationPage.vue 冻结堆砌**：该文件已超 1300 行，禁止继续向其中添加新功能或新 UI 区块；新能力必须先拆出独立 composable 或子组件，经人工确认后才可合入。
2. **App.vue 不承接新业务逻辑**：新逻辑必须放入 composable，App.vue 只做编排。
3. **跨层调用禁止**：Service 不能直接操作 UI 状态；Store 只暴露显式 action，外部不得直接 mutate state。
4. **单边契约变更禁止**：修改 `http_server.rs` 接口定义而不同步更新 `api.md`，视为无效交付。修改前端调用而不同步更新后端实现和文档，同理。
5. **盲目新增全局状态禁止**：不得为临时 UI 状态新增 Pinia store；新增 store 必须先说明为什么 ref/reactive 不够用。
6. **锁文件混用禁止**：除非任务明确是"统一包管理器"，否则不得混用 npm/yarn/pnpm 安装或刷新锁文件。
7. **服务端请求签名禁止绕过**：所有 `regionalFetch`、`createRegionalSSE`、`createRegionalWebSocketUrl` 出口必须经过 `requestSigner.ts` 签名；新增 `/v1/*` 请求出口必须集成签名，不得由业务代码直接 fetch。
8. **主窗口几何出口禁止绕过**：业务组件和 feature composable 不得直接调用 Tauri `setSize / setPosition`；主窗口尺寸与位置统一由 `app/shell/useWindowTransitionCoordinator.ts` 编排，并经 `useWindowManagement.ts` 应用，纯 `workArea` / DPI / clamp 规则归 `windowGeometry.ts`。独立原生窗口的创建尺寸仍由各自窗口 service 管理，但必须设置合理 min size 并校验当前工作区。
9. **品牌与兼容协议禁止混改**：正式产品名统一为“全医慧助（PCIE）”，英文展开统一为“Primary Care Intelligent Expert”；历史 `MedHermes` / `med-hermes` 只允许在已发布的 HIS SDK 全局对象、SDK 文件/路由、深链 scheme、HTTP Header、Bundle Identifier 和迁移说明中作为兼容标识保留。品牌更新不得直接全局替换这些技术契约；如需废弃，必须先提供双栈迁移、版本计划和 HIS 联调验证。
10. **正式发布线禁止分叉复用**：当前仓库只有 `main` 可以发布正式桌面客户端，自 `1.4.0` 起版本必须严格高于所有历史公开版本；`feature/two-chronic-diseases` 不合并回 `main`，后续移出当前仓库，不得继续使用本仓库正式更新通道、tag 或版本号。禁止复用历史 tag / draft / `latest.json`；发布前必须核对三处版本一致、兼容 Bundle Identifier 与 updater 公钥不变，并验证 `latest.json` 中每个平台的 URL 文件名和签名都来自同一次构建，验证成功后才允许把 draft 转为 latest 正式发布。
11. **测试构建与正式发布禁止混用**：功能验收必须优先使用 `yarn release:test X.Y.Z` 或手动 `Test Build` 工作流。测试构建只能产生本机产物或 GitHub Actions Artifact，禁止修改或提交三处正式版本、创建 tag / GitHub Release / draft / `latest.json`，也禁止上传到客户端正式或测试更新源。验收通过后只能在干净 `main` 上用同一候选版本执行 `yarn release X.Y.Z`；正式 tag 仍须满足唯一、单调递增和 release preflight。候选工作流上传前必须验证真实安装包存在，来源清单不得单独满足产物门禁。
12. **Win7 legacy 验证线禁止混入正式发布**：Windows 7 只允许通过 `tauri.win7.conf.json + Win7 Legacy Test Build` 生成 Artifact-only 技术验证包；必须使用独立 identifier / UpgradeCode、外置安装的 WebView2 109、`x86_64-win7-windows-msvc + build-std` 和关闭的 updater artifact。禁止复用正式 `stable` Windows target、正式 UpgradeCode、tag、Release、draft、`latest.json` 或任一 updater 通道。Win7 原生窗口 region 裁剪必须只由 `win7-legacy` Cargo feature 启用；任何主窗口几何变更前先恢复 full region，球态稳定后才能应用中心圆或五圆联合 region，不得让正式 Windows/macOS 路径启用该裁剪。Win7 包保留 `med-hermes` 深链时不得与正式客户端共机安装；Actions 构建成功后仍须完成 Windows 7 SP1 x64 实机冒烟，未形成独立安全责任与退出计划前不得描述为正式支持版本。

## 棘轮式治理

以下模块已识别为高风险区域，改动时必须执行对应的额外约束：

| 文件/模块 | 当前风险 | 约束 |
| --- | --- | --- |
| `ConsultationPage.vue` | 1300+ 行，职责过重 | 只允许拆分和缩减，不允许净增行数 |
| `useEventListeners.ts` | 约 575 行，仍集中 App 级事件入口 | 新增 App 级 Tauri `listen` 默认复用 `shared/composables/useTauriEventListener.ts`；接诊 / 患者补全 / 风险胶囊状态机默认进入 `app/events/useReceptionController.ts`；SDK handshake 初始化默认进入 `app/events/useSdkHandshakeController.ts`；并说明为什么不能放在更局部的 composable |
| `useWindowManagement.ts` | 422 行 | 窗口尺寸/位置改动必须同步校验多显示器 `workArea` 与混合 DPI；纯计算下沉 `windowGeometry.ts`，内容/视图时序进入 `useWindowTransitionCoordinator.ts`，不得继续扩大职责 |
| `http_server.rs` 接口定义 | 共享契约 | 任何字段变更必须同步 api.md + 前端调用方 |

治理原则：每轮迭代只允许往"更好"的方向变化。如果一次改动会让上述文件变得更大或职责更模糊，必须先拆解再继续。

## 当前架构基线

-> 见 [ARCHITECTURE.md](./ARCHITECTURE.md)，该文件是架构的唯一真实来源。

以下仅列出 AGENTS.md 层面需要额外强调的架构约束（不重复 ARCHITECTURE.md 已有内容）：

1. `ConsultationPage.vue` 是完整问诊 + 灵活模式的唯一落点，不允许维护第二套推荐口径。
2. Pinia 当前只有 `consultationConfig` 和 `diagnosisPath` 两个权威 store，新增需人工审批。
3. 知识库入口主次关系：`pmphai.ts` 为主，`KnowledgeBasePanel.vue` 为保留备选。
4. 前端复用治理以 `docs/frontend-reuse-architecture.md` 为准，文件结构迁移以 `docs/frontend-file-structure-plan.md` 为目标路线图；新增业务组件 / composable / mapper 默认进入对应 `features/<feature>/ui|model|api|lib`，通用 UI / 工具进入 `shared/*`，稳定实体进入 `entities/*`，根级 `components/`、`composables/`、`services/` 不再作为新增默认落点，只保留历史入口或兼容 facade。
5. 后续重构不能只追求大文件行数下降；必须说明沉淀了哪类能力（Adapter / Builder / Strategy / Composable Controller / Headless UI / domain lib），以及是否减少重复规则或可删除旧入口。
6. 客户端只保留服务端托管运行形态，不再提供本地/区域模式开关；LLM、语音、PMPHAI/知识库、Prompt/模板同步、反馈和审计统一经签名 `/v1/*` 接口。不得重新引入客户端第三方密钥、供应商直连或本地 Tauri AI 代理。HIS Bridge、HIS Adapter、目录缓存、窗口/音频采集和确定性规则属于桌面基础设施，不等同于本地模式。

## 工程复盘与决策摇摆

-> 见 [RETRO.md](./RETRO.md)，记录开发过程中反复出现的错误和 vibe coding 典型困难。
-> 见 [DECISION_DRIFT.md](./DECISION_DRIFT.md)，记录历史上反复变更、撤回、合并、拆分或默认值来回调整的设计决策。

1. 遇到似曾相识的问题时，先查 RETRO.md 是否已有记录和解决方案。
2. 新发现的典型错误或反复踩坑，必须追加到 RETRO.md（使用文件末尾的模板）。
3. 遇到同一设计点被反复推翻、重做、拆分又合并、默认值来回切换时，必须追加到 DECISION_DRIFT.md。
4. 如果某条经验足够通用且反复触发，应升级为本文件的硬约束或棘轮条目。
5. 如果某个摇摆决策已经收敛为产品或架构立场，必须同步更新 PRODUCT.md / ARCHITECTURE.md / AGENTS.md，并在 DECISION_DRIFT.md 标注收敛位置。

## 文档更新矩阵

1. 组件、composable、store、service 职责变化：更新 `ARCHITECTURE.md`
2. 本地 HTTP Bridge 接口、字段、回写结果变化：更新 `api.md`
3. 医生交互约束、灵活模式门禁、引用闭环变化：更新 `PRODUCT.md`
4. 协作流程、验证命令、Review 热点变化：更新 `AGENTS.md`
5. 开发错误、踩坑经验、反复出现的困难：更新 `RETRO.md`
6. 设计决策反复推翻、拆分合并、默认值来回切换或当前立场不稳定：更新 `DECISION_DRIFT.md`
7. 模块新增/删除/重命名、文件职责迁移、依赖关系/数据流变更：更新 `CODE_MAP.md`

## 包管理与命令约束

1. 默认使用 `yarn`：
   - `yarn install`
   - `yarn type-check`
   - `yarn test:unit`
   - `yarn build`
   - `yarn tauri dev`
2. `package.json` 通过 `packageManager` 固定到 `yarn@1.22.22`，仓库根目录只保留 `yarn.lock`。
3. 根目录不得新增或提交 `package-lock.json`、`pnpm-lock.yaml`；若误生成，必须删除后再交付。
4. 除非任务明确是“统一包管理器”，否则不要顺手刷新或新增另一套锁文件。
5. 遇到依赖损坏时，先在交付说明中记录现状；不要无理由混用 `npm`/`yarn`/`pnpm` 重新安装。

## 最小质量门禁

1. 前端至少执行 `yarn type-check` 与 `yarn build`
2. Tauri/Rust 侧至少执行 `cargo check`
3. 新增生产代码默认同步新增或更新单元测试；确实不适合自动化覆盖时，交付说明必须写明原因和替代验证方式
4. Vitest 单元测试通过 `yarn test:unit` 执行；修改已覆盖的 service/composable/lib 必须执行该命令
5. 修改关键路径或本地/远端契约时，必须按工作区 [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) 补充对应单元测试、集成测试或关键手测记录
6. 若无法完成构建或测试，必须说明阻塞原因，并补充关键路径手测或静态审查结论

## 关键手测清单

1. `start-consultation` 能正确唤起完整问诊主流程
2. `/api/consultation/assist`（内部仍复用 `start-consultation-session` 事件名）会打开 `ConsultationPage` 灵活模式，并且每次只消费一个目标动作
3. 病历详情里的“回写病历”会写入 `draft` 结果；“引用诊断/用药/检查”会写入 `reference-request`
4. `POST /api/consultation/reference-feedback` 返回后，当前页面和 `/api/consultation/events/ws` 订阅方都能看到最新 `referenceStatus`
5. `consultationId` 与当前患者/当前就诊上下文匹配，不读到旧结果
6. 诊断保持单选并引用当前选中项；推荐用药、检查检验支持多选后按分组一次引入所选项
7. 点击“引用诊断/用药/检查”后窗口不会自动收起，医生仍可继续当前问诊；PHIS 回执返回后当前页面状态会即时更新
8. 语音问诊确认后能写回同一条本地结果通道
9. 诊断路径窗口能够正确复用缓存并在超时/失败时显示明确状态

## Review 门禁

以下改动模式已反复出现问题，必须在提交前逐条核对（不是建议，是门禁）：

1. `currentPatient` 的标识字段映射必须优先考虑 `idPi / patientId`，不能只依赖宽泛的 `id`
2. 任何写回本地结果通道的代码都要核对 `consultationId`、`resultType`、`requestId`、`referenceStatus`、可选字段和 HIS WebSocket 订阅行为；不得重新引入 `/api/consultation/events/poll` 长轮询出口
3. `ConsultationPage` 灵活模式不能重新引入一套独立于完整问诊的诊断/用药/检查推荐规则
4. 诊断路径缓存相关改动，必须评估“同患者重复接诊”污染风险与缓存误命中风险
5. 涉及 `emit('minimize')`、`exitWork()`、`handleCollapse()` 的改动，必须区分“同一运行期内保留现场”和“真正持久化恢复”，不要把内存保活误写成已落盘；结束就诊收球必须走统一 transition 队列并以完整 `160×160` 球态作为终态，不得被迟到的胶囊/语音 resize 覆盖
6. 修改 `windowSizes.ts`、`useWorkMode.ts`、`useWindowManagement.ts` 时，必须同步校验窗口尺寸、显示器边界和动画原点
7. `DiagnosisPathWindow.vue`、`diagnosisPath.ts`、`stores/diagnosisPath.ts` 的改动必须同时检查窗口生命周期、渲染就绪事件和缓存 key 策略
8. 知识库相关改动要明确是走 `pmphai.ts` 主链路，还是启用内置 `KnowledgeBasePanel.vue`，避免双轨长期漂移
9. **HIS 调用边界**：业务代码（`components/` / `composables/` / `services/` 中除 `services/his/*` 之外）禁止直接 `import ... from 'services/hisService'`。必须经 `services/his` 入口：业务调用走 `getHisAdapter()`，仅 SDK handshake / 服务端 bootstrap 等认证场景允许使用 `services/his` 重导出的 `getHisService` / `resetHisService`。新增 PHIS 私有字段读取必须通过 `entry.raw.xxx` 透传，不允许在中性 DTO 上加 PHIS 命名字段。
10. **药品定稿流水线**：任何 AI 或历史上下文产生的药品，在自动选中、缓存、库存校验和回写前必须调用共享 `finalizeMedicineRecommendation(s)`，依次完成当前库存对齐、药品详情、一次剂量换算、标准频次 / 用法、程序总量和最终库存校验。模型包装总量不得直接进入药品处方；只调用 hydrate、只在展示层 normalize 或只在提交 payload 时补字段均不满足门禁。
11. **Tauri capability 同步**：新增或首次调用 Tauri JS API 时，必须同时核对 `src-tauri/capabilities/*.json` 中对应的 `allow-*` 权限，并执行会真实触发该 API 的 Tauri 运行时冒烟；`type-check`、浏览器单测和 `cargo check` 不能替代 capability 验证。
12. **复诊配药事实与参考核查门禁**：慢病病历与复诊核查项必须由同一次生成返回，禁止恢复独立确认页或串行“确认计划 → 病历”两次模型调用。确认慢病范围后必须先进入共享结果页并立即展示确定性历史事实；同一次 SSE 必须按病历核心、复诊核查、药品建议和健康指导分段更新，禁止只改进度文案却继续等待完整 JSON 一次性落地，也禁止流式失败后追加第二次模型请求。迟到 partial / complete 必须同时经过 session token、患者锚点和机会校验。服务端 `done / complete` 只结束流，结果页必须继续维持 finalizing 状态，直到最终病历映射、药房选项和库存核对完成后才收起进度并开放编辑/回写；进度收起后禁止再为慢病渠道启动通用病历补充生成或自动改写正文。慢病复诊核查必须锚定主诊断卡片浮层并替代普通主诊核查，避免同位置双浮层和额外模型调用；浮层必须保持紧凑，不得恢复逐项大卡片、常驻编号、重点标签和完整依据。推荐值不得在医生点击选择前写入现病史；初始现病史只消费已确认慢病和复诊目的，禁止写入历史处方药名或处方属性、库存、推荐方案或模型未选择推断。历史规范药名只进入当前用药史，完整处方事实只进入药品卡近期处方核查。结果页选择只允许增量写入当前选项的 `recordText`，不得覆盖医生手工文本。核查项是非阻断参考，未处理不得阻断回写、弹出强制处理提示或自动重新打开浮层；选择异常状态时必须取消续方药品自动选中。
13. **PHIS 历史处方属性来源**：药品一次剂量、频次、用法、天数、总量和包装单位优先读取 `loadClinicMedicalRecord.presList[].presSubList[]`，在 `services/his` Adapter 内映射为中性字段；`orderList` 只作医嘱分类、检验检查关联和缺失兜底。不得把 `takeDays` 等 PHIS 命名字段加入中性 DTO，也不得在无法按 `idOrd / idMedPro / 唯一规范药名` 关联时猜测继承。
14. **多慢病复诊范围门禁**：患者历史存在多个慢病时，复诊核查项、病历生成、初始诊断和用药推荐必须只消费医生已确认的 scoped candidate；未选慢病的诊断、就诊和药品不得混入。胶囊中的诊断勾选就是本次范围确认，不得再增加逐药确认步骤。同次就诊含多慢病且 HIS 无处方-诊断归属关系时，部分选中不得整单沿用；只能自动纳入经白名单归一、由 AI 明确归入所选诊断且置信度为 high / medium 的历史药品。药品归类必须作为后台静默行为，胶囊不得展示 AI 识别、匹配数量、成功、失败或无匹配状态；若部分选择仍需等待归类收口，只能保留内部提交门禁，不得切换为 AI 识别文案。低置信、未归类、越权新增或归类失败的药品不得进入 scoped candidate，但仍保留在完整处方历史中供结果页事实核查。自动归类药品进入结果页后仍须经过共享药品定稿流水线并允许医生取消或调整，未经结果页最终确认不得回写。
15. **患者年龄单位门禁**：患者年龄必须把数值与单位作为同一事实处理；PHIS/HIS 补全返回的完整 `ageText` 优先于接诊事件的裸 `ageNum / age`。`M / D` 或“月 / 天”不得默认成“岁”，不得写入 `ageYears`；修改患者 mapper/selector 时必须覆盖月龄、日龄和成年年龄测试。
16. **模板病史与 AI 候选阴性内容门禁**：既往史、个人史、家族史允许使用统一标准模板预制到可编辑病历草稿；模板来源只用于内部去重与安全规则，正文不显示“模板预制”提示，医生执行一键回写视为对本次所选病历字段的整体确认。AI 还可基于当前病例、正式诊断或病历书写要求生成候选阴性/正常表述，即使当前没有明确问诊依据；候选条目统一使用 `AI` 标记，一般项为蓝色、与当前诊断高度相关或属于重点安全核查的条目为红色，并继续通过虚线和文字样式提供非颜色识别，不得在每个片段后重复来源提示。普通语音优先由同一次 `voiceIntentRecognitionStream` 的 `record_suggestions` 分区生成候选；该分区缺失时，才与症状结果一样由稳定状态 scheduler 自动补发一次，`finalizing` 期间保留待执行意图，禁止用一次性延时回调在阻塞态直接放弃。慢病复诊继续跳过通用候选生成，患者/就诊或结果切换必须取消旧任务。`AI` 标记只表示来源与阅读优先级，不再表示待确认；候选生成或旧缓存恢复后必须经统一正文质控和语义去重幂等合并进对应字段 `modelValue`，进入正式缓存与 `outpatientRecord`，并在该字段被医生选中时随一键回写进入 PHIS。已在正文中的候选只原位标记，不得重复追加；异步候选只能基于最新字段增量合并，不得覆盖医生手工文本。结果页不得恢复独立阅读层、“纳入病历”、逐项三选一确认、底部核查面板或重点项回写门禁；医生发现内容不准确时直接调整、移除或编辑病历正文。
17. **诊断建议分区与医生转入门禁**：AI 正式诊断建议最多 3 项且按匹配度排序，低置信或仍需补问/查体/检查才能成立的结果进入待鉴别方向；病例只支持 1～2 项时不得凑足 3 项。待鉴别项默认不得被选中、设为主诊断、触发治疗推荐或进入 `diagList`；“纳入诊疗方向”只建立当前结果页局部关注状态并可引导补充依据，不改变上述边界。只有医生再次显式执行“转为正式诊断”且项目已匹配标准诊断库时，才允许该项进入正式诊断与已选集合；转入项默认作为次诊断、保留已有主诊断、不自动刷新治疗，且不受 AI 三项展示截断。患者/就诊切换必须清空方向状态，缓存恢复必须按稳定诊断 key 校验，禁止把模型低置信结果静默升级为正式诊断。
18. **注意事项诊断作用域门禁**：AI 或规则自动生成的 `outpatientRecord.precautions` 只能消费医生已选正式诊断，不得带入待鉴别方向、未选诊断或上一次选择的教育内容。诊断选择变化时只允许重建尚未被医生修改的系统文案；医生手工文本不得被覆盖。回写前必须确认实际 `diagList` 与注意事项的诊断作用域一致。
19. **部分回写省略语义门禁**：医生通过“选择回写”取消的门诊病历字段或诊断，必须从 `record-confirmed` payload 中省略；注意事项未选时顶层兼容字段 `precautions` 也必须省略。PHIS 当前会无条件遍历 `orderList`，因此医嘱是唯一兼容例外：`record-confirmed.orderList` 必须始终为数组，未选择药品、检查、检验或处置时固定传 `[]`，PHIS 必须以 `writebackScope.orderTypes` 为空判断“不处理医嘱”，不得将空数组解释为清空既有医嘱。`writebackScope`、实际病历/诊断字段、`orderList` 内容和前置校验范围必须一致；部分回写仍只产生一条 `record-confirmed + batch` 并等待一次回执，未选内容不得记录为医生拒绝建议。
20. **慢病药品周期核查证据门禁**：慢病药品卡的近期处方核查必须消费已排除当前就诊的完整时间窗历史，按药品主键优先、唯一规范药名其次匹配；不得复用只保留最近处方的续方继承列表，也不得因历史就诊不是慢病诊断而漏掉同患者同药记录。累计量只允许汇总有效正数且单位一致的记录，单位不同或缺失时逐笔展示。没有院内权威医保周期与限量规则时只展示 HIS 处方事实，不得自动标记超量、违规、扣款风险或阻断回写。
21. **检验检查互认闭环门禁**：`queryAvailableExamLabItems` 返回的 `mutualRecognitionCode` 必须经 HIS Adapter 和标准项目匹配完整进入检查 / 检验 `orderList`，空字符串表示不参与互认。PHIS `sendFeedback(..., "pending", ..., recognizableItems)` 是中间态，不得清空原回写等待状态或按失败收尾；医生决策必须沿用原 `requestId`，只发送一条 `reference-request + recognitionDecision`，`recognize` 才携带所选 `idSrv`。最终 `success / failed / cancelled` 到达前不得结束结果页，重复 pending、跨患者或 requestId 不匹配的反馈不得打开互认弹窗。
22. **检验检查实时目录门禁**：检查 / 检验目录属于接诊级可开立事实，每次新接诊必须通过 `medicalDataService.beginAvailableExamLabReception()` 调用 `queryAvailableExamLabItems` 获取一次，并在同患者同就诊内存复用；结束接诊、患者 / 就诊或机构 / 租户 / 科室变化时必须失效。检查 / 检验项目不得写入或从 SQLite、`localStorage` mappings 恢复，实时查询失败时不得回退历史目录。普通问诊、语音问诊、独立治疗方案、手动匹配和回写必须消费同一实时目录，并完整保留 `jsonField.idLisCategory`、`idSrv`、执行科室、部位、互认编码和厂商 `raw`；迟到请求不得重新污染新接诊目录。
23. **普通语音渐进结果门禁**：同一患者 / 就诊 / `consultationRoundId` 的 NDJSON 分区只能首次 reset 结果页，后续 partial 与 complete 必须增量应用，禁止每个事件整页重置。核心病历、AI 候选、诊断和诊疗路由优先由同一次 `voiceIntentRecognitionStream` 返回；缺少 `record_suggestions` 时才允许稳定态 scheduler 补发一次通用候选请求。已选正式诊断与 `recommendation_plan` 就绪后可后台并行生成治疗，但前台必须先稳定诊断，再以固定药品 / 检查 / 检验槽位原位呈现分支进度和整组结果，禁止按网络返回顺序重排；结构化病历流完成后不得再显示独立顶部“院内目录匹配”阶段，目录绑定、详情补全和库存校验必须保持后台静默。医生明确医嘱可先展示，AI 治疗不得在初始正式诊断稳定前可见或进入回写选择。流中已有有效 `diagnoses` 分区但只有待鉴别项时不得追加第二次诊断请求或启动治疗，只有旧结果完全缺失诊断分区时普通语音才允许恢复一次；手动刷新期间保留上一版稳定结果。检查 / 检验仍必须来自本次实时目录、药品仍必须经过统一定稿流水线；核心病历稳定后允许编辑，初始诊断恢复或治疗完成前一键回写必须禁用。流式请求已有有效分区后不得自动重放整次请求或追加非流式全量请求，避免重复片段与长尾；迟到分区和治疗结果必须同时校验会话 token、患者锚点、主诊断与请求序列。该状态机只用于 `voice`；`chronic-refill` 专用流和报告回诊的独立 `TreatmentPlanPage` 不得复用普通语音诊断兜底、治疗启动或展示门禁。
24. **慢病长处方回写门禁**：只有 `chronic-refill` 结果页实际选择药品回写且当前患者签约状态明确为已签约时，`record-confirmed` 才能携带 `prescriptionAttributes.chronicLongTerm = true`；未签约、签约状态未知、无药回写和其他渠道必须省略并按普通处方处理。该中性属性不得改成 PHIS 私有 `slowMedicine` 并塞入药品明细。PHIS 必须通过 `searchByIdPiMB` 的慢病签约判定复用签约状态与慢病诊断配置校验，校验通过后只给普通西药 / 中成药处方头设置 `slowMedicine = "1"`；校验失败明确回执失败，不得静默降级为普通处方。回归需同时核对数据库处方头、医生站勾选框和打印版式。
25. **诊断标准库语义匹配门禁**：AI 诊断与院内标准库匹配必须先检查急性/慢性、左/右/双侧、1型/2型、原发性/继发性等互斥修饰词，再比较核心疾病与名称相似度；ICD 只能对语义兼容候选辅助排序，不能覆盖名称冲突。相反修饰词候选必须硬排除；标准项省略 AI 修饰词时只能作为未选中的 `compatible` 近似项展示，医生显式确认后才允许绑定标准 ID、选中和回写。解剖范围变化不得自动映射；AI 名称与编码冲突时不得以编码静默覆盖名称。新增或修改匹配规则必须覆盖急慢性、侧别、分型、原发/继发、核心解剖变化及医生确认状态测试。

## 推荐提交流程

1. 先更新文档
2. 再改代码
3. 最后附上验证结果：
   - `yarn type-check` / 阻塞原因
   - `yarn build` / 阻塞原因
   - `cargo check`
   - `yarn test:unit`（引入 Vitest 且命中已覆盖模块时）
   - 必要的手测结论
   - 测试构建附上候选版本、源 commit/ref 和 Actions Artifact 名称；不得把 Artifact 描述成已发布版本
   - 发布版本额外附上 release preflight、统一 `latest.json` 校验，以及至少一个历史正式版本到新版本的真实 updater 冒烟结果
   - Win7 legacy 验证附上固定 Rust 工具链 / target、外置 WebView2 109 版本、Artifact 名称与 Windows 7 SP1 x64 实机冒烟；不得描述为正式支持或已发布版本

## 工具使用
[Calicat MCP 使用说明]

在收到 calicat.cn 域名的连接时，不要直接尝试访问，而是通过 Calicat MCP 相关工具的说明获取数据。
get_meta_data 工具获取到的是大致的图层骨架结构，使用此工具可用较少的 Token 快速浏览页面设计、检索图层。get_meta_data 获取到的数据不能直接用作前端代码生成。
get_design_data 工具用于获取指定图层的详细设计数据，在你开始实际的前端代码生成前，确保你通过 get_design_data 获取到了图层的详细设计数据，并以此为基础进行前端代码生成。
