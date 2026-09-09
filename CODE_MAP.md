# CODE_MAP.md

> 代码地图 -- AI 再入时的快速索引。按需阅读对应模块，避免全量扫描。
>
> **维护规则**：模块职责、文件路径、依赖关系发生变更时，必须同步更新本文件。

---

药品回写分类与五项拆方：PHIS `ClinicDoctorCoreAIModule` → `AiPrescriptionBuilder`（纯组方规则），桌面端继续发送同一条 `orderList`。

同日跨报告验收：[report-cross-consistency-uat.md](docs/report-cross-consistency-uat.md)。同日跨报告校验：`features/report-interpretation/lib/reportConsistency.ts`（同日证据 Builder、提示词和输出校验）、`api/reportConsistencyHistory.ts`（外部报告关联）、`ui/ReportConsistencyPanel.vue`（冲突与核查展示）；工作台 controller 管理患者锚点及证据缓存。

## 快速导航

慢病回写签约判定：PHIS `searchByIdPiMB` -> HIS Adapter 中性 `signed` -> `recordConfirmedPayload.ts`；仅明确签约的慢病复诊含药回写携带 `prescriptionAttributes.chronicLongTerm`，未签约或未知状态按普通处方处理。

| 我要做什么 | 该读哪里 |
|-----------|---------|
| 了解整体架构 | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 规划前端复用边界 | [frontend-reuse-architecture.md](docs/frontend-reuse-architecture.md) + [frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md) |
| 了解 HIS 接口契约 | [api.md](./api.md) + [http_server.rs](src-tauri/src/http_server.rs) |
| 了解产品/交互约束 | [PRODUCT.md](./PRODUCT.md) |
| 了解协作规则与禁令 | [AGENTS.md](./AGENTS.md) |
| 了解踩坑记录 | [RETRO.md](./RETRO.md) |
| 了解反复摇摆的设计决策 | [DECISION_DRIFT.md](./DECISION_DRIFT.md) |
| 修改问诊主流程 | [ConsultationPage.vue](src/components/ConsultationPage.vue) + [SymptomResultEntry.vue](src/features/symptom-consultation/ui/SymptomResultEntry.vue) + [features/symptom-consultation](src/features/symptom-consultation/index.ts)；患者文本读取、既往史解析、患者草稿/诊断预填、症状问诊必填校验、诊断 identity / AI 请求防串线、同类诊断候选 / 替换列表更新、病历草稿主诉 / 现病史拼装、中医诊断证候 / 治法映射、中医四诊 prompt / 报告文案、一般情况现病史片段、诊断展示分组、诊断 / 治疗事实核查编排、LLM JSON 宽容解析、医嘱文案生成、最终报告数据拼装、完成问诊推荐采纳 / 拒绝埋点编排、推荐反馈目标落库 / 注册、当前问诊 payload / 用户日志快照、PHIS 引用 key / 状态图 / 回执归一 / 引用展示判断优先改 [features/symptom-consultation](src/features/symptom-consultation/index.ts)；症状结果页只保留包装语义，诊断鉴别入口和按钮锚定浮层由共享结果页主体提供；阴性事实来源、AI 候选生成、原文阅读标记和缓存恢复优先改 [clinicalRecordFactConfirmation.ts](src/features/clinical-result/clinicalRecordFactConfirmation.ts)、[clinicalRecordAnnotation.ts](src/features/clinical-result/clinicalRecordAnnotation.ts)、[useClinicalRecordFactConfirmation.ts](src/features/consultation-result/model/useClinicalRecordFactConfirmation.ts) 与 [ClinicalRecordAnnotatedText.vue](src/features/consultation-result/ui/ClinicalRecordAnnotatedText.vue)，正式诊断前三项与待鉴别分区优先改 [diagnosisSuggestionPresentation.ts](src/features/clinical-result/diagnosisSuggestionPresentation.ts) 和 [DiagnosisDifferentialList.vue](src/features/consultation-result/ui/DiagnosisDifferentialList.vue)，注意事项诊断作用域优先改 [useClinicalResultPrecautionsScope.ts](src/features/consultation-result/model/useClinicalResultPrecautionsScope.ts) 与 [outpatientRecord.ts](src/features/clinical-result/outpatientRecord.ts)；结果页补充说明文字 / 语音采集及真实音量波动优先改 [ClinicalResultSupplementDialog.vue](src/features/consultation-result/ui/ClinicalResultSupplementDialog.vue) 与 [useClinicalResultSupplementInput.ts](src/features/consultation-result/model/useClinicalResultSupplementInput.ts)，病例重写请求规格与响应归一优先改 [clinicalResultRegeneration.ts](src/features/clinical-result/clinicalResultRegeneration.ts)；western 诊断 raw 映射、AI 治疗推荐 raw 映射、完整门诊病历 `outpatientRecord` builder / 场景模板 / 质控、`record-confirmed` 回写契约和 PHIS 提交治疗选择 / 库存提示 / 处理意见拼装优先改 [features/clinical-result](src/features/clinical-result)，页面统一从 `@features/clinical-result` 导入，避免语音问诊反向依赖智能问诊私有目录；结果页首版 / 诊毕 / 放弃用户日志提交节奏优先改 [useClinicalResultUserLogController.ts](src/features/consultation-result/model/useClinicalResultUserLogController.ts)；涉及结果页诊断/治疗推荐卡片辅助逻辑、标准库候选搜索或手动匹配写入时优先改 [features/clinical-result](src/features/clinical-result) |
| 修改患者基础信息 / 年龄单位 | [patientAge.ts](src/entities/patient/lib/patientAge.ts) + [patientContext.ts](src/utils/patientContext.ts) + [PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) + [PatientHeader.vue](src/entities/patient/ui/PatientHeader.vue)；数值与单位在 patient entity 纯函数归一，HIS Adapter 产出完整 `ageText`，上下文负责权威来源优先级，UI 只通过 selector 展示 |
| 修改女性月经史生成 / 展示 / 回写 | [patientContext.ts](src/utils/patientContext.ts) + [prompts.ts](src/prompts/prompts.ts) + [useVoiceIntentRecognition.ts](src/features/voice-consultation/model/useVoiceIntentRecognition.ts) + [clinicalResultAdapter.ts](src/features/clinical-result/clinicalResultAdapter.ts) + [outpatientRecord.ts](src/features/clinical-result/outpatientRecord.ts) + [useClinicalResultWritebackScope.ts](src/features/consultation-result/model/useClinicalResultWritebackScope.ts) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue)；字段独立于个人史，仅女性患者在个人史下方显示；来源优先本次对话明确内容，其次 HIS / 既有病历，无依据留空；只有有内容且被医生选择时才进入 `record-confirmed` |
| 修改萧山试点反馈口径 / 验收 | [萧山临床结果专项 UAT](docs/xiaoshan-clinical-result-uat.md) + [萧山待明确反馈确认单](docs/xiaoshan-pending-feedback-confirmation.md) + [PRODUCT.md](PRODUCT.md)；试点反馈表中的待明确项先收敛验收口径，未确认前不直接进入开发或发布 |
| 修改窗口/动画行为 | [windowGeometry.ts](src/app/shell/windowGeometry.ts) + [useWindowManagement.ts](src/app/shell/useWindowManagement.ts) + [useWindowTransitionCoordinator.ts](src/app/shell/useWindowTransitionCoordinator.ts) + [useWorkMode.ts](src/app/shell/useWorkMode.ts) + [useNavigation.ts](src/app/navigation/useNavigation.ts) + [useReceptionController.ts](src/app/events/useReceptionController.ts) + [lib.rs](src-tauri/src/lib.rs) + [default.json](src-tauri/capabilities/default.json)；纯 workArea/DPI/尺寸裁剪进 `windowGeometry.ts`，前端原生窗口适配进 `useWindowManagement.ts`，位置与尺寸由 `apply_main_window_geometry` 单次 IPC 应用，内容淡出/几何/视图提交/恢复可见时序进 transition coordinator；患者胶囊进入语音和语音阶段 resize 使用无整窗淡出过渡，迟到的接诊分析只能经 `resizeReceptionCapsule` 调整仍为患者胶囊的当前视图；新增 Tauri 窗口 API 必须同步 capability，业务 UI 不直接改窗 |
| 修改 LLM 调用 | [llm.ts](src/services/llm.ts)（公开 facade）+ [services/llm](src/services/llm/types.ts) + [prompts.ts](src/prompts/prompts.ts) |
| 修改小助手联网搜索 | [ChatPanel.vue](src/components/ChatPanel.vue) + [llm.ts](src/services/llm.ts) + [llm/types.ts](src/services/llm/types.ts) + [PCIE Server ChatRequest](../floating-ball-server/server/src/main/java/com/regionalai/floatingball/server/modules/ai/dto/ChatRequest.java) + [AiProxyService](../floating-ball-server/server/src/main/java/com/regionalai/floatingball/server/modules/ai/service/AiProxyService.java) + [服务端 API](../floating-ball-server/API.md)；客户端与服务端都必须把联网意图限制在 `chat-stream / chat_panel` 流式请求，禁止影响普通语音问诊、病历生成、风险分析和审查链路 |
| 修改聊天语音输入 | [ChatPanel.vue](src/components/ChatPanel.vue) + [useChatVoiceInput.ts](src/features/chat/model/useChatVoiceInput.ts) + [aliyunSpeech.ts](src/services/aliyunSpeech.ts) + [speechConfig.ts](src/services/speechConfig.ts) + [audioRecorder.ts](src/services/audioRecorder.ts)；页面只处理按钮、输入框和错误提示，录音与实时语音会话生命周期由 chat feature composable 编排；`aliyun-dashscope` / `funasr-websocket` 优先走签名 `/v1/ai/speech/realtime/ws`，中途断线由 `RealtimeSpeechService` 重连并在停止后用完整音频批量补录，首次实时建链失败或 `openai-compatible` 直接走批量转写 |
| 修改语音问诊 | [VoiceCapsule.vue](src/features/voice-consultation/ui/VoiceCapsule.vue) + [voiceRecordingContinuation.ts](src/features/voice-consultation/lib/voiceRecordingContinuation.ts) + [ConsultationResultPage.vue](src/features/consultation-result/ui/ConsultationResultPage.vue) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue) + [useClinicalResultGenerationSequence.ts](src/features/consultation-result/model/useClinicalResultGenerationSequence.ts) + [useClinicalResultFinalization.ts](src/features/consultation-result/model/useClinicalResultFinalization.ts) + [useTreatmentSections.ts](src/features/consultation-result/model/useTreatmentSections.ts) + [ClinicalGenerationProgress.vue](src/features/consultation-result/ui/ClinicalGenerationProgress.vue) + [TreatmentGenerationPlaceholder.vue](src/features/consultation-result/ui/TreatmentGenerationPlaceholder.vue) + [features/clinical-result](src/features/clinical-result) + [availableMedicineInventory.ts](src/features/clinical-result/api/availableMedicineInventory.ts) + [VoiceResultHeader.vue](src/features/voice-consultation/ui/VoiceResultHeader.vue) + [VoiceSafetyReviewPanel.vue](src/features/voice-consultation/ui/VoiceSafetyReviewPanel.vue) + [VoiceRecommendationFeedbackPopover.vue](src/features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue) + [VoiceRecordFieldEditor.vue](src/features/voice-consultation/ui/VoiceRecordFieldEditor.vue) + [VoiceSessionFeedbackBar.vue](src/features/voice-consultation/ui/VoiceSessionFeedbackBar.vue) + [useVoiceEditorSnapshotPersistence.ts](src/features/voice-consultation/model/useVoiceEditorSnapshotPersistence.ts) + [useVoiceRecordFieldState.ts](src/features/voice-consultation/model/useVoiceRecordFieldState.ts) + [useVoiceResultFactCheckState.ts](src/features/voice-consultation/model/useVoiceResultFactCheckState.ts) + [useVoiceFeedbackActions.ts](src/features/voice-consultation/model/useVoiceFeedbackActions.ts) + [useVoiceKnowledgeSearch.ts](src/features/voice-consultation/model/useVoiceKnowledgeSearch.ts) + [useVoiceCatalogMatching.ts](src/features/voice-consultation/model/useVoiceCatalogMatching.ts) + [useVoiceResultRecord.ts](src/features/voice-consultation/model/useVoiceResultRecord.ts) + [useVoiceSafetyReview.ts](src/features/voice-consultation/model/useVoiceSafetyReview.ts) + [useVoiceRigidBlock.ts](src/features/voice-consultation/model/useVoiceRigidBlock.ts) + [useSafetyIssueResolver.ts](src/features/voice-consultation/model/useSafetyIssueResolver.ts) + [useVoiceResultFactCheck.ts](src/features/voice-consultation/model/useVoiceResultFactCheck.ts) + [useVoiceFeedback.ts](src/features/feedback/model/useVoiceFeedback.ts) + [useVoiceConsultation.ts](src/composables/useVoiceConsultation.ts) + [useVoiceIntentRecognition.ts](src/composables/useVoiceIntentRecognition.ts) + [safetyRules.ts](src/services/safetyRules.ts) + [voiceResult.ts](src/types/voiceResult.ts) + [prompts.ts](src/prompts/prompts.ts) + [aliyunSpeech.ts](src/services/aliyunSpeech.ts) + [speechConfig.ts](src/services/speechConfig.ts) + [audioRecorder.ts](src/services/audioRecorder.ts) + [voiceFeedback.ts](src/services/voiceFeedback.ts)；停录后继续采集的文字衔接和同规格 PCM WAV 合并属于语音功能域纯规则；App、智能问诊和复诊配药只能从 `@features/consultation-result` 的 `ConsultationResultPage` 进入共享结果页，根级 `VoiceConsultationNew.vue` 仅为待迁移的内部实现；普通语音诊断恢复、治疗启动和 AI 方案可见性必须经 generation sequence controller 且显式判断 `voice` 渠道，治疗区固定槽位和分支进度由共享结果 feature 提供；普通语音的顶部进度只描述结构化病历流与诊断恢复，治疗分支只在对应槽位显示“正在生成建议”，目录绑定与定稿保持后台静默；重点关注语音抽取契约是否覆盖病例草稿、explicit/inferred 来源标记、诊断/检查/药品结构化字段，以及推荐项反馈 / 整页评分的本地落库与 payload 组装；门诊用药推荐前的有效库存查询、批次合并、缓存与 AI 紧凑上下文统一由 `features/clinical-result/api/availableMedicineInventory.ts` 承担，PHIS 私有接口只在 HIS Adapter 内出现；共享结果页主体同时被症状问诊复用，推荐卡片 helper / 标准库匹配 helper / `record-confirmed` 回写 helper / 一键回写前治疗摘要 helper 统一从 `@features/clinical-result` 消费，反馈草稿 / target 登记 / 本地反馈提交统一从 `@features/feedback` 消费，语音侧只保留渠道初始化、缓存恢复、病例字段编辑状态、结果事实核查状态、标准目录匹配、安全复核、知识库轻包装与日志语义 |
| 修改普通语音诊断作用域 / 症状性工作诊断 | [ordinaryVoiceDiagnosisGuard.ts](src/features/voice-consultation/lib/ordinaryVoiceDiagnosisGuard.ts) + [useVoiceIntentRecognition.ts](src/features/voice-consultation/model/useVoiceIntentRecognition.ts) + [diagnosisSuggestionPresentation.ts](src/features/clinical-result/diagnosisSuggestionPresentation.ts) + [DiagnosisRecommendationCard.vue](src/features/consultation-result/ui/DiagnosisRecommendationCard.vue) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue) + [prompts.ts](src/prompts/prompts.ts)；Prompt 必须区分临床角色、诊断种类、当前就诊证据与历史上下文；纯规则过滤 `history_only / risk_modifier`，待鉴别只保留可解释当前主诉的病因项；无病因性正式诊断时最多提升一项已匹配 R 类标准编码的本次肯定症状为工作诊断，并把 AI 诊疗路由限制为检查 / 检验。门禁只作用于普通 `voice`，不得影响症状问诊或医生已确认慢病范围的 `chronic-refill` |
| 修改主诊核查 / 待鉴别方向 / 独立鉴别诊断 | [useClinicalResultDiagnosisChecklist.ts](src/features/consultation-result/model/useClinicalResultDiagnosisChecklist.ts) + [useDifferentialDiagnosisDirection.ts](src/features/consultation-result/model/useDifferentialDiagnosisDirection.ts) + [DiagnosisRecommendationCard.vue](src/features/consultation-result/ui/DiagnosisRecommendationCard.vue) + [DiagnosisDifferentialList.vue](src/features/consultation-result/ui/DiagnosisDifferentialList.vue) + [diagnosisSuggestionPresentation.ts](src/features/clinical-result/diagnosisSuggestionPresentation.ts) + [diagnosisChecklistPresentation.ts](src/features/clinical-result/diagnosisChecklistPresentation.ts) + [diagnosisChecklistRequest.ts](src/features/clinical-result/api/diagnosisChecklistRequest.ts) + [diagnosisChecklist.ts](src/features/clinical-result/diagnosisChecklist.ts) + [DifferentialDiagnosisModalPage.vue](src/features/differential-diagnosis/ui/DifferentialDiagnosisModalPage.vue) + [differentialDiagnosisPresentation.ts](src/features/differential-diagnosis/model/differentialDiagnosisPresentation.ts)；共享结果页中“待鉴别方向”是诊断推荐同批返回的其他候选疾病，“主诊断核查要点”是主诊断稳定后按就诊/诊断/病历上下文后台预取的安全核查动作。待鉴别纳入、取消、医生转入和缓存 key 归局部 direction controller；纳入只用于补充依据，不进入诊断或治疗，转入必须匹配标准诊断库并通过现有诊断选择与回写门禁。核查结果以“主诊核查 N 项”按钮为直接定位容器，在按钮正下方自动展示全部条目和每项全文，超过可用高度时清单区域滚动；底部“已确认”文字按钮与右上角关闭、Escape 共用关闭动作，不写病历或 PHIS。关键词只用文字色与字重高亮，不使用背景块。医生关闭后当前缓存上下文不再自动打开，点击按钮可重开，页面中央不再渲染共享 checklist 模态框。独立 `diffDx` 入口仍可使用自己的独立窗口页面，不受共享结果页浮层形态影响。两者统一走轻量模型请求网关和 checklist 纯规则；模型/网络/运行时异常单独展示为系统错误，不得计入临床风险数量或显示高风险标识；确认结果不写回 PHIS |
| 修改诊断标准库匹配 | [diagnosisCatalogMatch.ts](src/services/diagnosisCatalogMatch.ts) + [medicalData.ts](src/services/medicalData.ts) + [clinicalResultAiMapping.ts](src/features/clinical-result/clinicalResultAiMapping.ts) + [clinicalResultInitialization.ts](src/features/clinical-result/clinicalResultInitialization.ts) + [useDiagnosisSelection.ts](src/features/consultation-result/model/useDiagnosisSelection.ts) + [DiagnosisRecommendationCard.vue](src/features/consultation-result/ui/DiagnosisRecommendationCard.vue)；共享纯规则先做临床修饰词冲突与核心疾病一致性校验，再做名称相似度和 ICD 辅助排序；完整 assessment 区分精确、近似、歧义、冲突和未匹配，旧单项匹配入口仅返回可安全自动接受的精确项。近似标准项默认不选中、不携带可回写 ID，医生点击确认后才进入诊断选择；手动切换需清理旧近似状态 |
| 修改病历原文事实标记 / 正文重复与提示语质控 / AI 默认回写 / 调整移除 / 快速复制 | [clinicalRecordNarrativeQuality.ts](src/features/clinical-result/clinicalRecordNarrativeQuality.ts) + [historyRecordTemplates.ts](src/features/clinical-result/historyRecordTemplates.ts) + [clinicalRecordFactConfirmation.ts](src/features/clinical-result/clinicalRecordFactConfirmation.ts) + [clinicalRecordAnnotation.ts](src/features/clinical-result/clinicalRecordAnnotation.ts) + [useClinicalRecordFactConfirmation.ts](src/features/consultation-result/model/useClinicalRecordFactConfirmation.ts) + [useClinicalRecordFactSuggestionScheduler.ts](src/features/consultation-result/model/useClinicalRecordFactSuggestionScheduler.ts) + [voiceIntentStream.ts](src/features/voice-consultation/model/voiceIntentStream.ts) + [ClinicalRecordAnnotatedText.vue](src/features/consultation-result/ui/ClinicalRecordAnnotatedText.vue) + [VoiceRecordFieldEditor.vue](src/features/voice-consultation/ui/VoiceRecordFieldEditor.vue) + [ClinicalResultEditor.css](src/features/consultation-result/ui/ClinicalResultEditor.css)；AI 草稿进入编辑器前的工作流提示清理、精确重复去除、组合阴性覆盖判断及结构化阴性合并统一归 `clinicalRecordNarrativeQuality.ts`，语音抽取、症状问诊、补充说明重生成和慢病复诊入口均须复用，且不得重新处理医生已编辑字段；三类病史模板与内部模板识别归 `historyRecordTemplates.ts`，模板正文不显示来源提示；AI 可按病例相关性或书写要求生成候选阴性内容，候选已存在于正文时由切分规则原位标记，不存在时由 `clinicalRecordAnnotation.ts` 的幂等合并规则追加进正式字段，不再保留独立阅读层；普通语音优先从同次 NDJSON 的 `record_suggestions` 分区取得候选，缺失时才由 `useClinicalRecordFactSuggestionScheduler.ts` 在稳定态补发一次快速请求；候选生成和旧缓存恢复时的增量写入、来源状态、移除与缓存同步归 `useClinicalRecordFactConfirmation.ts`；正文来源、空态、标记密度、自然换行与左对齐、AI 核查浮层及正文选区快速复制由 `ClinicalRecordAnnotatedText.vue` 负责，浮层只保留复制、调整和移除，不再显示“纳入病历”或不会回写提示；病历级 AI 全局说明由共享结果页主体与 `ClinicalResultEditor.css` 负责，结果页不提供逐项确认或重点项回写门禁 |
| 修改固定病史模板槽位 / PHIS 精确回写 | [historyRecordTemplates.ts](src/features/clinical-result/historyRecordTemplates.ts) + [outpatientRecord.ts](src/features/clinical-result/outpatientRecord.ts) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [clinicalRecordFactConfirmation.ts](src/features/clinical-result/clinicalRecordFactConfirmation.ts) + [api.md](api.md)；固定 `{否认}/{有}` 槽位解析、稳定 `slotKey` 和变化清单统一归模板 helper，结果页按“根据上下文修正”展示阳性变化，一键回写只为已选字段附带 `recordTemplateChanges`，兼容文本去除花括号后继续发送 |
| 修改体格检查生命体征默认槽位 / 对话数值回填 | [physicalExamVitalTemplate.ts](src/features/clinical-result/physicalExamVitalTemplate.ts) + [outpatientRecord.ts](src/features/clinical-result/outpatientRecord.ts) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [useVoiceIntentRecognition.ts](src/features/voice-consultation/model/useVoiceIntentRecognition.ts) + [prompts.ts](src/prompts/prompts.ts) + [api.md](api.md)；T/P/R/BP 默认槽位、明确数值解析、正文去重与 `physicalExamVitalSigns` 构造统一归纯 helper，页面不得自行拼装回写字段 |
| 修改一键回写范围选择 | [useClinicalResultWritebackScope.ts](src/features/consultation-result/model/useClinicalResultWritebackScope.ts) + [ClinicalResultWritebackScopeSelector.vue](src/features/consultation-result/ui/ClinicalResultWritebackScopeSelector.vue) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [useClinicalResultWritebackPreflight.ts](src/features/consultation-result/model/useClinicalResultWritebackPreflight.ts) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue) + [api.md](api.md)；病历七字段、诊断、用药、检查检验处置的选择状态归 scope controller，浮层只负责展示与发出动作；未选病历/诊断范围由统一 payload builder 省略，`orderList` 因 PHIS 遍历兼容要求始终为数组并在未选医嘱时传 `[]`，禁止页面自行拼装；前置校验只消费最终选择范围 |
| 修改共享结果页双栏布局 / 滚动导航 / 诊疗建议扫读层级 | [ClinicalResultEditor.css](src/features/consultation-result/ui/ClinicalResultEditor.css) + [ClinicalResultColumnNavigator.vue](src/features/consultation-result/ui/ClinicalResultColumnNavigator.vue) + [useClinicalResultColumnNavigation.ts](src/features/consultation-result/model/useClinicalResultColumnNavigation.ts) + [DiagnosisDifferentialList.vue](src/features/consultation-result/ui/DiagnosisDifferentialList.vue) + [TreatmentRecommendationSection.vue](src/features/consultation-result/ui/TreatmentRecommendationSection.vue) + [TreatmentRecommendationCard.vue](src/features/consultation-result/ui/TreatmentRecommendationCard.vue) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue)；桌面宽屏由左右栏各自滚动，左栏病历标题和右栏分区导航吸顶，右栏导航只滚动右列并显示主诊断与各分区数量；待鉴别方向默认只显示名称 / 核查点 / 下一步紧凑摘要，支持依据按需展开；检查检验的单项目与多项目统一为组头 + 连续项目行，并汇总优先 / 可选 / 已选数量，必要性紧邻项目标题，项目行空白区可切换选择；窄屏恢复单栏统一滚动。不得用整张长病历 sticky、左右同步滚动或额外悬浮病历摘要替代该结构 |
| 修改检验检查互认 | [mutualRecognition.ts](src/features/clinical-result/mutualRecognition.ts) + [useMutualRecognitionDecision.ts](src/features/consultation-result/model/useMutualRecognitionDecision.ts) + [MutualRecognitionDecisionDialog.vue](src/features/consultation-result/ui/MutualRecognitionDecisionDialog.vue) + [MutualRecognitionDecisionHost.vue](src/features/consultation-result/ui/MutualRecognitionDecisionHost.vue) + [useSymptomConsultationFinalWriteback.ts](src/features/symptom-consultation/model/useSymptomConsultationFinalWriteback.ts) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) + [http_server.rs](src-tauri/src/http_server.rs) + [api.md](api.md)；目录编码透传和决策 payload 属于纯契约，pending 反馈、部分勾选与同 requestId 再发送属于结果页 controller，页面只挂载共享 Host；旧症状问诊最终回写由独立 composable 承接，不向 `ConsultationPage.vue` 堆叠状态机；最终 success / failed / cancelled 继续进入原回写状态机 |
| 修改独立诊疗方案推荐 | [TreatmentPlanPage.vue](src/features/treatment-plan/ui/TreatmentPlanPage.vue) + [TreatmentPlanGroup.vue](src/features/treatment-plan/ui/TreatmentPlanGroup.vue) + [useTreatmentPlanRecommendations.ts](src/features/treatment-plan/model/useTreatmentPlanRecommendations.ts) + [useTreatmentPlanWriteback.ts](src/features/treatment-plan/model/useTreatmentPlanWriteback.ts) + [features/clinical-result](src/features/clinical-result) + [features/consultation-result](src/features/consultation-result)；入口来自 `/api/consultation/assist` 的 `action: treatment_plan`，只做四类治疗方案聚合清单，不进入 `ConsultationPage.vue`；AI 请求、标准库匹配、推荐项二次编辑、药品/项目 hydrate、库存校验、完整门诊病历 `outpatientRecord` 和 `record-confirmed` 构造必须继续复用共享 clinical-result / consultation-result 能力 |
| 修改住院病历辅助生成 | [InpatientEmrPage.vue](src/features/inpatient-emr/ui/InpatientEmrPage.vue) + [useInpatientEmrGeneration.ts](src/features/inpatient-emr/model/useInpatientEmrGeneration.ts) + [inpatientEmrService.ts](src/features/inpatient-emr/api/inpatientEmrService.ts) + [inpatientEmrTemplate.ts](src/features/inpatient-emr/lib/inpatientEmrTemplate.ts) + [inpatientEmrQuality.ts](src/features/inpatient-emr/lib/inpatientEmrQuality.ts) + [safeHtml.ts](src/shared/lib/safeHtml.ts) + [services/his](src/services/his) + [http_server.rs](src-tauri/src/http_server.rs) + [api.md](./api.md)；入口来自 `/api/inpatient/emr/generate` 或 SDK，必须传 `admissionId + templateId + templateName + htmlContent`；HIS/PHIS 模板必须先经共享 HTML 白名单净化，再参与解析、预览和生成；模板解析优先走签名后端 `/v1/client/inpatient-emr/templates/resolve` 并按 `templateId` 缓存，只有后端不可用或未返回字段时才做桌面端确定性解析，未知字段分类仍复用服务端 LLM；生成结果经本地 HIS 结果/回执通道回写，联调日志只记录脱敏 trace、耗时、计数和 requestId |
| 修改服务端接入 | [SettingsPanel.vue](src/components/SettingsPanel.vue) + [regionalClient.ts](src/services/regionalClient.ts)（兼容 facade）+ [services/regional](src/services/regional/index.ts) + [regionalRuntime.ts](src/services/regionalRuntime.ts) + [fetchTimeout.ts](src/shared/lib/fetchTimeout.ts) + [userFeedback.ts](src/services/userFeedback.ts) + [consultationUserLog.ts](src/services/consultationUserLog.ts) + [featureUsageTracker.ts](src/services/featureUsageTracker.ts) + [recommendationPreferenceTracker.ts](src/services/recommendationPreferenceTracker.ts) + [device.rs](src-tauri/src/commands/device.rs)；医生使用情况依赖 `featureUsageTracker.ts` 在事件入队时固化真实工号、医生姓名、HIS 机构和客户端版本，不能在离线队列上传时改用新登录身份 |
| 修改诊断路径 | [DiagnosisPathWindow.vue](src/features/diagnosis-path/ui/DiagnosisPathWindow.vue) + [diagnosisPath.ts](src/services/diagnosisPath.ts) + [stores/diagnosisPath.ts](src/stores/diagnosisPath.ts) |
| 修改检验检查报告解读 | [ReportInterpretationWindow.vue](src/features/report-interpretation/ui/ReportInterpretationWindow.vue) + [ReportInterpretationWorkspace.vue](src/features/report-interpretation/ui/ReportInterpretationWorkspace.vue) + [ReportSourcePreview.vue](src/features/report-interpretation/ui/ReportSourcePreview.vue) + [ReportInterpretationContent.vue](src/features/report-interpretation/ui/ReportInterpretationContent.vue) + [reportInterpretationPresentation.ts](src/features/report-interpretation/lib/reportInterpretationPresentation.ts) + [useReportInterpretationWorkspace.ts](src/features/report-interpretation/model/useReportInterpretationWorkspace.ts) + [reportedReportHistory.ts](src/features/report-interpretation/api/reportedReportHistory.ts) + [reportNormalization.ts](src/services/his/reportNormalization.ts) + [PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) + [reportInterpretation.ts](src/services/reportInterpretation.ts) + [reportInterpretation.ts](src/types/reportInterpretation.ts) + [useEventListeners.ts](src/composables/useEventListeners.ts) + [useReceptionController.ts](src/app/events/useReceptionController.ts) + [http_server.rs](src-tauri/src/http_server.rs) + [sdk/med-hermes-sdk.js](sdk/med-hermes-sdk.js) + [report-interpretation-test.html](web_project/public/report-interpretation-test.html)；外部单报告请求保留独立窗口，接诊发现近 14 天已出报告时进入应用内报告工作台；工作台默认以统一报告单样式显示结构化原始报告，医生手动触发后才生成 AI 解读，并通过原始报告 / AI 解读双视图切换；PACS 字段映射与空值容错由 PHIS `AiInpatientEmrContextService.mapExam`、HIS Adapter `reportNormalization.ts` 与送入 AI 前的 `reportedReportHistory.ts` 分层承担，影像表现/诊断结论进入 `finding / conclusion`，`REMARK` URL 独立作为 `reportUrl` 查看入口，`null / undefined / [NULL]` 和 URL 均不进入 AI 原文；定性阳性、异常标记、非正常方向和数值越界会交叉复核上游 normal 标记，异常表只使用确定性字段；左侧就诊科室来自 `HisVisitRecord.deptName` |
| 修改门诊接诊与风险胶囊 | [useReceptionController.ts](src/app/events/useReceptionController.ts) + [receptionFlowGuard.ts](src/app/events/receptionFlowGuard.ts) + [receptionPatientSummary.ts](src/features/reception/lib/receptionPatientSummary.ts) + [reportedApplyResults.ts](src/features/reception/lib/reportedApplyResults.ts) + [useReceptionSessionController.ts](src/features/reception/model/useReceptionSessionController.ts) + [useOutpatientScenarioRouter.ts](src/features/reception/model/useOutpatientScenarioRouter.ts) + [ReceptionCapsule.vue](src/features/reception/ui/ReceptionCapsule.vue) + [riskPresentation.ts](src/features/reception-risk/lib/riskPresentation.ts) + [features/reception-risk](src/features/reception-risk)；患者补全、风险评估和复诊机会异步写入必须复用同一 flow token，风险评估失败只降级风险能力，不得把已成功的患者接诊标记为失败；患者展示信息从 `currentPatient` 派生，年龄必须以完整 `ageText` 穿过 session controller、胶囊和风险面板，禁止 UI 拼接“岁”；风险和机会状态只经 session controller action 修改；风险胶囊长文由 `riskPresentation.ts` 在入 session 前规范化，不在 UI 层截断；患者字段兼容读取、已出报告申请单判断和病史摘要属于纯 lib，具体门诊场景导航由统一路由执行 |
| 修改复诊配药 | [chronicRefillHistoryWindow.ts](src/features/reception-risk/lib/chronicRefillHistoryWindow.ts) + [chronicRefillAssessment.ts](src/features/reception-risk/lib/chronicRefillAssessment.ts) + [chronicRefillMedicationAttribution.ts](src/features/reception-risk/lib/chronicRefillMedicationAttribution.ts) + [chronicRefillMedicationAttribution.ts](src/features/reception-risk/api/chronicRefillMedicationAttribution.ts) + [chronicRefillMedicationHistory.ts](src/features/reception-risk/lib/chronicRefillMedicationHistory.ts) + [chronicRefillConfirmation.ts](src/features/reception-risk/lib/chronicRefillConfirmation.ts) + [chronicRefillRecordStream.ts](src/features/reception-risk/lib/chronicRefillRecordStream.ts) + [chronicRefillRecord.ts](src/features/reception-risk/api/chronicRefillRecord.ts) + [useGeneratedClinicalResultSession.ts](src/features/consultation-result/model/useGeneratedClinicalResultSession.ts) + [useClinicalResultFinalization.ts](src/features/consultation-result/model/useClinicalResultFinalization.ts) + [useChronicRefillReview.ts](src/features/consultation-result/model/useChronicRefillReview.ts) + [useDiagnosisSelection.ts](src/features/consultation-result/model/useDiagnosisSelection.ts) + [ChronicRefillReviewPanel.vue](src/features/consultation-result/ui/ChronicRefillReviewPanel.vue) + [chronicRefillInventory.ts](src/features/reception-risk/lib/chronicRefillInventory.ts) + [MedicationPrescriptionHistoryReview.vue](src/features/consultation-result/ui/MedicationPrescriptionHistoryReview.vue) + [ReceptionCapsule.vue](src/features/reception/ui/ReceptionCapsule.vue) + [useOutpatientScenarioRouter.ts](src/features/reception/model/useOutpatientScenarioRouter.ts) + [clinicalResultContract.ts](src/features/clinical-result/clinicalResultContract.ts) + [recordConfirmedPayload.ts](src/features/clinical-result/recordConfirmedPayload.ts) + [ClinicalGenerationProgress.vue](src/features/consultation-result/ui/ClinicalGenerationProgress.vue) + [VoiceConsultationNew.vue](src/components/VoiceConsultationNew.vue)；确认范围后立即进入结果页并先展示确定性历史事实；同一次 SSE 按病历核心、复诊核查、药品建议和健康指导分段原位更新，迟到 partial / complete 不得污染新会话，流式失败不得追加第二次模型调用；服务端 complete 后继续维持 finalizing，直到病历映射与药品信息整理完成才收起进度，慢病渠道完成后不得再启动通用病历补充；历史查询必须使用近 90 天时间窗并排除本次就诊；多慢病只在胶囊本地选范围，结果页默认勾选全部已确认正式诊断并保留首个标准诊断为主诊断；同次多慢病的无归属药品由后台快速模型限制在历史诊断候选内自动归类，high / medium 且落入已选诊断的药品自动恢复为 scoped candidate 历史处方，low / 未归类 / 失败继续安全降级，胶囊不再逐药确认；慢病复诊核查锚定主诊断卡片浮层并替代普通主诊核查，采用紧凑扁平的非阻断参考形态，未处理允许回写，异常选择取消药品自动选中；历史用药存在时只向模型发送相关库存候选；自动续方、医保周期核查、正文药名和可靠历史天数规则保持独立；库存匹配按历史产品 ID 优先，缺失时只接受厂家/规格可唯一确定或唯一同名候选，禁止首个同名药替代；最终选择药品时由统一 payload builder 仅为慢病渠道发送中性 `prescriptionAttributes.chronicLongTerm`，PHIS 校验后映射处方头慢病标记；通过 `recommendationPolicy` 禁止结果页自动补拉其他治疗 |
| 修改慢病范围与历史药品归类交互 | [ChronicRefillScopeSelector.vue](src/features/reception/ui/ChronicRefillScopeSelector.vue) + [ReceptionCapsule.vue](src/features/reception/ui/ReceptionCapsule.vue) + [chronicRefillMedicationAttribution.ts](src/features/reception-risk/lib/chronicRefillMedicationAttribution.ts) + [chronicRefillMedicationAttribution.ts](src/features/reception-risk/api/chronicRefillMedicationAttribution.ts)；父胶囊只控制入口开合，子组件只管理当前慢病范围，输出的 `ChronicRefillSelection` 仅包含诊断范围；后台自动归类状态不得进入界面，药品由纯规则按白名单、所选诊断和 high / medium 置信度自动纳入，不得在胶囊恢复逐药勾选，也不得直接发请求或修改 session |
| 修改门诊语音复诊聚合 | [outpatientFollowUpContext.ts](src/features/outpatient-follow-up/api/outpatientFollowUpContext.ts) + [outpatientFollowUpRecord.ts](src/features/outpatient-follow-up/lib/outpatientFollowUpRecord.ts) + [OutpatientFollowUpPage.vue](src/features/outpatient-follow-up/ui/OutpatientFollowUpPage.vue) + [OutpatientFollowUpEvidencePanel.vue](src/features/outpatient-follow-up/ui/OutpatientFollowUpEvidencePanel.vue) + [ReportInterpretationWorkspace.vue](src/features/report-interpretation/ui/ReportInterpretationWorkspace.vue) + [HisAdapter.ts](src/services/his/HisAdapter.ts) + [types.ts](src/services/his/types.ts) + [PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) + [hisService.ts](src/services/hisService.ts) + PHIS `AiInpatientEmrContextService.buildOutpatientFollowUpReportResults`；本次门诊病历正文来自接诊阶段已获取的 `HisOutpatientMedicalRecord`，进入报告回诊上下文时由纯函数按权威患者性别过滤不适用模板段落，净化结果同时供左侧展示和 AI 请求使用且不改写患者原始数据；已出报告结果来自新增报告结果服务，当前诊断只作为可选参考；共享页面上下文是 `followUpEligible / source / currentDiagnosis / medicalRecordText / labReports / examReports / assessment / ineligibleReason`，其中 `assessment` 是可选的医生触发 AI 解读结果，含处置结论、问题和药物检索意图；检验报告按 LIS `idReportGroup` 聚合，`labReports[].applications[]` 保留同组全部已出结果申请项目，报告单数不等于申请项目数；检验报告保留完整项目，不返回患者、候选检查或 raw；报告回诊统一先进入工作台，医生可跳过解读直接进入独立复诊页，左侧展示本次病历与报告依据，右侧复用 `features/treatment-plan` 的推荐与回写能力 |
| 修改知识库 | [pmphai.ts](src/services/pmphai.ts)（主） / [KnowledgeBasePanel.vue](src/features/knowledge/ui/KnowledgeBasePanel.vue)（备） / [KnowledgeDetailModal.vue](src/features/knowledge/ui/KnowledgeDetailModal.vue) / [safeHtml.ts](src/shared/lib/safeHtml.ts) / [features/knowledge](src/features/knowledge)；智能问诊和语音问诊批量检索分类词提取优先改 [knowledgeSearchCategories.ts](src/features/knowledge/lib/knowledgeSearchCategories.ts)，检索 loading / results / 面板开合优先改 [useKnowledgeSearchController.ts](src/features/knowledge/model/useKnowledgeSearchController.ts)；服务端知识 HTML 必须经共享白名单净化，外部知识页 iframe 必须保持 sandbox；PMPHAI 服务和埋点仍由调用方注入 |
| 修改设置面板 / 应用内快捷键 | [SettingsPanel.vue](src/components/SettingsPanel.vue) + [SettingsGeneralTab.vue](src/features/settings/ui/SettingsGeneralTab.vue) + [KeyboardShortcutSettings.vue](src/features/settings/ui/KeyboardShortcutSettings.vue) + [keyboardShortcuts.ts](src/features/settings/model/keyboardShortcuts.ts) + [useAppKeyboardShortcuts.ts](src/app/shortcuts/useAppKeyboardShortcuts.ts) + [UpdateChecker.vue](src/features/settings/ui/UpdateChecker.vue) + [speechConfig.ts](src/services/speechConfig.ts) + [regionalClient.ts](src/services/regionalClient.ts)；设置页只保留通用与关于页签，负责服务端连接参数、窗口、音频采集、本地快捷键、缓存/HIS 联调入口和版本更新；快捷键纯规则/持久化归 settings model，唯一全局监听归 app/shortcuts，设置组件只编辑受控草稿；模型、语音供应商与知识库凭据由服务端管理，不再提供本地配置页签 |
| 修改用户可见错误提示 | [errorMessages.ts](src/shared/lib/errorMessages.ts) + [App.vue](src/App.vue) + [services/regional](src/services/regional) + 具体业务入口；公共工具负责把网络、超时、后端 requestId、JSON/HTTP/上游异常归一为可操作文案，业务层只追加场景前缀 |
| 修改客户端更新源 / 测试构建 / 正式发版 / Win7 验证构建 | [发布流程](docs/release-process.md) + [UpdateChecker.vue](src/features/settings/ui/UpdateChecker.vue) + [ForceUpdateGate.vue](src/features/settings/ui/ForceUpdateGate.vue) + [updateCheckerStatus.ts](src/features/settings/model/updateCheckerStatus.ts) + [updateConfig.ts](src/services/updateConfig.ts) + [lib.rs](src-tauri/src/lib.rs) + [Win7 原生 region](src-tauri/src/win7_window_region.rs) + [Win7 region 协调器](src/app/shell/useWin7WindowRegion.ts) + [tauri.windows.conf.json](src-tauri/tauri.windows.conf.json) + [tauri.win7.conf.json](src-tauri/tauri.win7.conf.json) + [Cargo build-std 配置](src-tauri/.cargo/config.toml) + [Win7 Cargo runner](scripts/win7-cargo-runner.mjs) + [Windows runner 入口](scripts/win7-cargo-runner.cmd) + [Windows WiX 模板](src-tauri/windows/wix/main.wxs) + [test-release.mjs](scripts/test-release.mjs) + [test-build.yml](.github/workflows/test-build.yml) + [win7-test-build.yml](.github/workflows/win7-test-build.yml) + [validate-win7-build.mjs](scripts/validate-win7-build.mjs) + [release.mjs](scripts/release.mjs) + [release.yml](.github/workflows/release.yml) + [release-preflight.mjs](scripts/release-preflight.mjs) + [validate-release-assets.mjs](scripts/validate-release-assets.mjs) + [package-windows-internal-update.mjs](scripts/package-windows-internal-update.mjs)；普通候选与 Win7 legacy 验证构建都只上传 Actions Artifact，不改正式版本、不打 tag、不生成 Release / `latest.json`；Win7 flavor 额外固定 Tier 3 Rust target、上游 tauri-utils ctor 兼容修复、实机外置 WebView2 109 和原生球态 region 裁剪，使用独立安装身份且不进入 updater。测试通过后才允许在干净 `main` 上固化同一正式候选版本并创建正式 tag。强更策略是门禁事实源，门禁生效时即使 updater 没有返回安装包也不得展示“当前已是最新版本”；`main` 是唯一正式发布线，自 `1.4.0` 单调递增，draft 只有在统一更新清单与同批安装包 / 签名验证通过后才转为 latest；Windows release 产物内部名保持 `PCIE`，客户可见安装名由 WiX 模板统一为“全医慧助（PCIE）”，主升级码保持已发布 `PCIE` 安装线并兼容迁移历史 `MedHermes` / 早期中文安装线；内网发布端见 `../floating-ball-server/modules/release` |
| 修改窗口尺寸记忆 | [windowGeometry.ts](src/app/shell/windowGeometry.ts) + [useWindowManagement.ts](src/app/shell/useWindowManagement.ts) + [useNavigation.ts](src/app/navigation/useNavigation.ts) + [useEventListeners.ts](src/composables/useEventListeners.ts) + [windowSizes.ts](src/constants/windowSizes.ts)；保存值是视图偏好，恢复时仍须按当前显示器 `workArea` 重新裁剪 |
| 修改最小化/恢复语义 | [useMinimizedSessions.ts](src/composables/useMinimizedSessions.ts) + [App.vue](src/App.vue) + [useSymptomConsultationCache.ts](src/composables/useSymptomConsultationCache.ts) + [useVoiceConsultation.ts](src/composables/useVoiceConsultation.ts)；按 `idVis` 锚定，跨自然日过期；症状问诊状态由 `ConsultationPage.vue` 常驻 `v-show` 实例和症状问诊快照保留，收起/恢复/再次点击智能问诊不得复位内部页签；语音问诊整张病历快照走 `editorSnapshot` |
| 修改医学数据匹配 / HIS 出站标准服务 | [medicalData.ts](src/services/medicalData.ts) + [useReceptionController.ts](src/app/events/useReceptionController.ts) + [his/HisAdapter.ts](src/services/his/HisAdapter.ts) + [his/types.ts](src/services/his/types.ts) + [his/PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) + [his/MockHisAdapter.ts](src/services/his/MockHisAdapter.ts) + [his/registry.ts](src/services/his/registry.ts) + [hisService.ts](src/services/hisService.ts) + [availableMedicineInventory.ts](src/features/clinical-result/api/availableMedicineInventory.ts) + [medical_catalog.rs](src-tauri/src/commands/medical_catalog.rs)；检查 / 检验目录必须在每次接诊开始时通过 `queryAvailableExamLabItems` 实时获取、同次接诊内存复用、结束时失效，不得从 SQLite 恢复或在失败时回退历史目录；重点核对 `jsonField.idLisCategory`、执行科室、部位、互认编码和 `raw` 是否完整进入匹配与回写。诊断与非检查检验诊疗项目仍按机构+租户隔离，药品按机构+租户+药房 `storeId` 隔离；有效库存目录必须经 `HisAdapter.fetchAvailableMedicineInventory()` 获取，PHIS 侧经 `api/phis.aiAdapterService/queryInvSubList` 调用院端适配入口并按 `idMedPro` 合并批次，AI 缓存按机构+租户+药房隔离，Prompt 投影必须按清洗后“名称 + 规格”去重且不能反向合并真实 `productId` 库存，库存校验单价按 `storeId + idMedPro` 从目录合并项解析且不得回退药品详情；住院上下文是否使用 PHIS `idAdsn`（中性 `admissionId`）或 `patientId / inpatientVisitId / encounterId / inpatientNo` 锚定同患者多次住院，住院病历 AI 上下文是否只经 `fetchInpatientEmrContext` / PHIS `buildContext` 聚合入口返回，以及服务端暂不可用时既有缓存仍可恢复 |
| 测试 HIS 集成 | [mock-his.html](web_project/public/mock-his.html) + [report-interpretation-test.html](web_project/public/report-interpretation-test.html)；联调页统一通过正式 SDK 验证本地 Bridge、WebSocket 结果事件与报告解读入口 |
| 测试门诊接诊核心逻辑 | 与生产文件同目录的 `*.test.ts` + [vitest.config.ts](vitest.config.ts)；`yarn test:unit` 覆盖 reception flow token、慢病配药判定、门诊场景分流和接诊 session 状态迁移 |

---

## 目录结构总览

当前结构是迁移前基线。复用边界、设计模式和“什么时候不该继续拆”见 [docs/frontend-reuse-architecture.md](docs/frontend-reuse-architecture.md)，目标结构与分阶段迁移规则见 [docs/frontend-file-structure-plan.md](docs/frontend-file-structure-plan.md)。新业务代码不再默认新增到根级 `components/`、`composables/`、`services/`；应优先按功能域落到 `features/<feature>/ui|model|api|lib`，通用 UI / 工具落到 `shared/*`，稳定实体类型落到 `entities/*`，外部系统适配继续落到 `services/<integration>`。

```
pcie/
├── src/                        # Vue 3 前端源码
│   ├── components/             # 历史扁平组件目录（当前 46 个 Vue 文件，逐步迁移到 features/shared）
│   ├── composables/            # 历史组合函数目录（逐步迁移到 app/features/shared）
│   ├── features/               # 功能域目录；当前已有 consultation-result、voice-consultation、feedback、symptom-consultation/lib 等
│   ├── services/               # 外部系统和运行时基础设施；HIS/LLM/regional 已先行分组
│   ├── stores/                 # 2 个 Pinia store
│   ├── types/                  # 历史类型目录（逐步拆到 entities/features/shared）
│   ├── constants/              # 配置常量
│   ├── icons/                  # Iconify 离线图标精简集合
│   ├── prompts/                # LLM 提示词（统一收敛到 prompts.ts）
│   ├── styles/                 # CSS 模块（设计令牌、布局、动画）
│   ├── assets/                 # 医学数据 CSV + 模板 JSON
│   ├── utils/                  # 工具函数
│   ├── App.vue                 # 根组件（编排层）
│   └── main.ts                 # 应用入口
├── src-tauri/                  # Rust 后端（Tauri 2.0）
│   └── src/
│       ├── main.rs             # Rust 入口
│       ├── lib.rs              # Tauri 命令 + 窗口管理
│       ├── http_server.rs      # HIS HTTP Bridge（Actix-web）
│       ├── aliyun_speech.rs    # 阿里云语音识别
│       ├── commands/           # 扩展命令模块
│       └── db/                 # 数据库模型
├── scripts/                    # 构建/发版脚本
└── docs/                       # 当前前端治理与 HIS 集成文档
```

---

## 前端组件 (`src/components/`)

### 核心业务组件

| 组件 | 行数 | 职责 | 注意事项 |
|------|------|------|---------|
| **ConsultationPage.vue** | ~3200 | 完整问诊 + 灵活模式的唯一落点：症状采集（3种模式）、动态表单、AI 推荐（诊断/用药/检查）、病历回写、HIS 引用闭环；症状系统分类筛选下拉状态已抽到 `features/symptom-consultation/model/useSymptomCategoryFilter.ts`，伴随症状勾选与推荐派生已抽到 `features/symptom-consultation/model/useCompanionSymptoms.ts`，症状选中 / 移除 / 表单初始化动作已抽到 `features/symptom-consultation/model/useSymptomSelectionController.ts`，症状采集组合状态已抽到 `features/symptom-consultation/model/useSymptomCollectionController.ts`，症状列表过滤 / 拼音搜索已抽到 `features/symptom-consultation/lib/symptomFiltering.ts`，症状表单初始化 / checkbox 互斥处理已抽到 `features/symptom-consultation/lib/symptomFormData.ts`，症状表单渲染计划已抽到 `features/symptom-consultation/lib/consultationRenderPlan.ts`，一般情况 / 中医四诊静态表单配置已抽到 `features/symptom-consultation/lib/consultationFormConfigs.ts`，症状问诊必填校验已抽到 `features/symptom-consultation/lib/consultationFormValidation.ts`，assist 快进展示文案 / banner 样式 / 功能统计 featureCode 映射已抽到 `features/symptom-consultation/lib/consultationAssistPresentation.ts`，assist 快进流程编排已抽到 `features/symptom-consultation/model/useConsultationAssistController.ts`，推荐区可见性 / 类型标签 / 置信度 class / 药品行内摘要已抽到 `features/symptom-consultation/lib/consultationRecommendationPresentation.ts`；治疗推荐通过共享 `useMedicalDictionaries` + `useTreatmentNormalization` + `useTreatmentGates` + `useTreatmentHydration` 与语音问诊保持同一份归一化口径（频次/用法/剂量/总量/天数 ↔ HIS 字典 + 药品详情轮询 + 库存校验），并在加载 HIS 药房字典后显式按 active storeIds 预热药品目录、在执行科室字典就绪后回填已有推荐的标准 key；药品卡选中后通过 `TreatmentItemEditor.vue` 的自管 `inline` 模式提供与语音侧一致的“一次剂量/频次/用法/总量”主编辑区，其余项目继续走紧凑编辑模式；每条推荐提供"手动匹配 / 重新匹配"入口，弹出共用 `ManualMatchPicker` 从标准库选择候选项，弹层 key 与搜索关键词缓存复用 `features/consultation-result/model/useManualMatchState.ts`；推荐依据 tooltip 开合状态复用 `features/consultation-result/model/useReasonTooltipState.ts`，同类诊断卡片内联下拉开合与候选状态复用 `features/consultation-result/model/useRelatedDiagnosisDropdown.ts`；药品发药药房与检查/检验执行科室通过共用 `RecAttributeChip.vue` chip+popover 选择器设置，未设置时不允许勾选；勾选药品时自动在候选药房中轮询 medicineDetail，并执行库存校验，任一失败则阻止勾选；页面 scoped 样式已原样外置到 `features/symptom-consultation/ui/ConsultationPage.css`；记录页底部操作区现拆分为最终“一键回写”和单独命名的 PHIS 批量引用入口，避免把最终 `complete_consultation` 与引用闭环混用；患者文本读取、既往史解析、患者草稿/诊断预填、诊断 identity / AI 请求防串线、同类诊断候选 / 替换列表更新、AI 诊断 / 治疗推荐原始结果映射、诊断展示分组、诊断 / 治疗事实核查编排、LLM JSON 宽容解析、医嘱文案生成、最终报告数据拼装、完成问诊推荐采纳 / 拒绝埋点编排、诊断/治疗推荐反馈目标落库 / 注册、当前问诊 payload、智能问诊用户日志快照、PHIS 引用 key / 状态图 / 回执归一 / 引用展示判断已开始抽到 `features/symptom-consultation`；`record-confirmed` 回写契约、PHIS 提交治疗选择 / 库存提示 / 处理意见拼装已改为复用 `features/clinical-result`，与语音问诊共用；诊断卡与治疗卡现已接入共用 recommendation feedback popover，提交链路复用 `useVoiceFeedback`，recommendationId 由本页注入的 `feedbackService.saveRecommendation` 结果回填登记；AI 结构化结果采用成功后覆盖、宽容 JSON 抽取和当前诊断上下文校验，避免请求失败或慢响应覆盖已有可用结果 | **已冻结**：禁止净增行数，新功能须先拆出 composable/子组件 |
| **DiagnosisPathWindow.vue** | ~980 | 独立窗口：诊断推理路径可视化（ECharts 图）；真实实现已迁至 `src/features/diagnosis-path/ui/DiagnosisPathWindow.vue`，旧 `src/components/DiagnosisPathWindow.vue` 已删除 | 有独立 Pinia 缓存，注意缓存 key 策略 |
| **ReportInterpretationWindow.vue** | -- | 独立窗口：检验检查报告 AI 解读结果；真实实现已迁至 `src/features/report-interpretation/ui/ReportInterpretationWindow.vue`，旧 `src/components/ReportInterpretationWindow.vue` 已删除 | 不进入问诊事件队列；只读展示；当前基线为单页报告单式纵向阅读版式，注意当前患者上下文、显式 patient 入参的合并规则，以及报告原文元数据/异常项解析不到时的占位展示 |
| **VoiceConsultationNew.vue** | ~3000 | 当前共享结果页实现载体：左侧病例正文编辑，右侧 AI 诊断/治疗推荐与一键回写；消费中性 `ClinicalResultInput`（兼容旧语音 `VoiceIntentResult`），语音抽取结果和症状问诊快照都先经 `features/clinical-result/clinicalResultAdapter.ts` 进入该组件；患者头展示复用 `@entities/patient` 的 `PatientHeader`；结果页 `voice/symptom` 渠道到日志类型、语音缓存开关、患者头展示和取消文案的派生复用 `features/consultation-result/model/useClinicalResultChannelStrategy.ts`，放弃确认弹窗和忙碌态拦截复用 `features/consultation-result/model/useClinicalResultCancelController.ts`，首版 / 诊毕 / 放弃用户日志提交节奏复用 `features/consultation-result/model/useClinicalResultUserLogController.ts`，一键回写回执 success / failed 分发复用 `features/consultation-result/model/useWritebackFeedbackController.ts`，`consultation-reference-feedback` 订阅和当前就诊过滤复用 `features/consultation-result/model/useConsultationReferenceFeedbackListener.ts`，同类诊断下拉状态复用 `features/consultation-result/model/useRelatedDiagnosisDropdown.ts`，语音 editorSnapshot 节流 / 立即持久化复用 `features/voice-consultation/model/useVoiceEditorSnapshotPersistence.ts`，病例字段初始快照 / 修改判断复用 `features/voice-consultation/model/useVoiceRecordFieldState.ts`，诊断 / 治疗事实核查状态复用 `features/voice-consultation/model/useVoiceResultFactCheckState.ts`，推荐项反馈提交与结果页完成动作复用 `features/voice-consultation/model/useVoiceFeedbackActions.ts`；页面仍负责缓存恢复、反馈草稿清理、取消事件和 PHIS 回写，语音问诊与智能问诊结果页的诊断鉴别按钮锚定浮层统一在此共享主体内编排；中性输入到可编辑诊断 / 治疗列表的初始化复用 `features/clinical-result/clinicalResultInitialization.ts`，页面只注入标准库匹配、频次/用法推断、治疗归一化和当前病历文本，推荐依据文案 / 条件性用药 / 患者已自行服药 / 默认勾选判断复用 `features/clinical-result/clinicalResultNarrative.ts`，药品字段展示和频次 / 用法候选解析复用 `features/clinical-result/clinicalResultUsageFields.ts`，药房 / 执行科室 / 部位 / 医保候选构造和过滤复用 `features/clinical-result/clinicalResultAttributeOptions.ts`，诊断 key / 标准诊断 id 判断复用 `features/clinical-result/recordConfirmedPayload.ts`，诊断上下文 identity / 治疗编辑器 key 复用 `features/clinical-result/recommendationHelpers.ts`，手动匹配搜索 key 复用 `features/clinical-result/manualMatch.ts`，推荐反馈提交 payload 复用 `features/clinical-result/clinicalResultFeedback.ts`，推荐依据 tooltip 开合状态复用 `features/consultation-result/model/useReasonTooltipState.ts`，推荐反馈弹层开合 / 草稿读取复用 `features/consultation-result/model/useRecommendationFeedbackPopover.ts`，药品频次 / 用法搜索关键字状态复用 `features/consultation-result/model/useMedicineUsageSearch.ts`；药品频次/用法字段通过共用 `MedicineUsageFieldSelector` 组件接 HIS 字典，手动匹配标准库候选选择也抽取为共用 `ManualMatchPicker`；发药药房 / 执行科室门禁判定已与症状问诊收敛到共用 `useTreatmentGates`；结果页 scoped 样式已原样外置到 `features/consultation-result/ui/ClinicalResultEditor.css`；药房列表按 SDK 握手里的 `userRoleDepts` 过滤后从 HIS 动态加载；初始化时必须保留中性输入里的 `matchedItem/matchStatus/selected/manualMatched/药房/执行科室/部位`，只有缺匹配信息时才重新评估标准库；语义相同的 `intentResult` 重复传入时不得重置现场或重拉治疗方案；最终回写 payload 复用 `features/clinical-result/recordConfirmedPayload.ts`，页面只负责 pending 回执字段、等待态和成功后直接收尾；同时编排推荐项反馈入口，并在主诊断切换后只提示治疗方案需手动刷新、不自动重拉 | 推荐依据默认应折叠，避免右栏信息过载；hydration / 库存校验已迁移到共用 `useTreatmentHydration`，仅保留 `getCandidatePharmaciesForMedicine`（含失配 storeIds 警告日志）与 `ensureMedicineDefaultPharmacy` 这两段语音特有的本地副作用 |
| **diagnosisChecklist.ts** | ~100 | 诊断鉴别 checklist 纯规则：统一共享结果页与独立鉴别诊断窗口的响应类型、上下文缓存 key、LLM JSON 解析、条目归一、关键诊断不匹配判断和风险项映射 | 不调用 LLM、不持有 Vue 状态、不弹 toast、不处理窗口生命周期 |
| **useClinicalResultDiagnosisChecklist.ts** | ~230 | 共享结果页诊断鉴别 controller：监听主诊断与病历上下文，后台预取、复用并发请求、管理会话缓存和卡片状态；普通结果静默完成，高风险主动展开；同时管理弹窗空态、错误态和失败重试 | LLM/Prompt 经注入网关调用；不服务独立窗口折叠和窗口生命周期，不调用 PHIS 回写 |
| **DiagnosisRecommendationCard.vue** | ~280 | 单条诊断推荐卡片子组件；真实实现已迁至 `src/features/consultation-result/ui/DiagnosisRecommendationCard.vue`，旧 `src/components/DiagnosisRecommendationCard.vue` 兼容包装已删除。封装名称/编码/meta token、置信度/匹配度、推荐依据 tooltip、主诊断/移除动作、鉴别预取状态/结果数量、可选鉴别入口和同类诊断切换；反馈按钮可通过 `showFeedback=false` 关闭，额外动作与正文区域通过插槽扩展 | 不拥有诊断集合、鉴别缓存或请求状态；语音侧与症状侧现都可直接挂接同一个推荐反馈 popover，避免再次复制反馈 UI |
| **TreatmentRecommendationCard.vue** | ~350 | 单条治疗推荐卡片壳组件；真实实现已迁至 `src/features/consultation-result/ui/TreatmentRecommendationCard.vue`，旧 `src/components/TreatmentRecommendationCard.vue` 兼容包装已删除。封装标题行、匹配状态、执行科室/药房 chip、候选标准项确认、摘要文案、反馈/手动匹配/展开按钮；检查 / 检验项优先展示真实 `goal`，缺失时仅从已有 `evidenceText / reason` 截取简明来源说明，完整推荐依据继续按需展开；支持 `title-prefix/title-meta/actions/body/manual-match/editor` 插槽和可关闭的反馈入口 | 临床目标分组、对话明确项目的匹配 / 待匹配分区由 `features/consultation-result/model/auxiliaryRecommendationPresentation.ts` 负责；AI 扩充项由 `features/clinical-result/institutionAuxiliaryCatalog.ts` 校验实时目录引用与完整目的元数据；检查 / 检验不得通过 `manualMatchCache.ts` 读取或保存跨接诊人工映射；不得把 PHIS `idLisCategory` 申请单分组混入 UI 分组，也不得用通用用途冒充真实目标；secondary fields / 二级 selector 逻辑仍留在父级 |
| **VoiceRecommendationFeedbackPopover.vue** | -- | 单条诊断 / 治疗推荐反馈弹层；真实实现已迁至 `src/features/voice-consultation/ui/VoiceRecommendationFeedbackPopover.vue`，旧 `src/components/VoiceRecommendationFeedbackPopover.vue` 兼容包装已删除 | 输入问题标签、原因和最终处理动作 |
| **VoiceRecordFieldEditor.vue** | -- | 病例字段受控编辑器；文档态展示原文事实标记，表单态展示 textarea，已删除无使用量且遮挡正文的字段反馈按钮、弹层及右侧预留空间 | 只做字段值与事实确认事件分发，不提交反馈、不弹 toast、不写日志、不触发回写 |
| **useVoiceRecordFieldState.ts** | -- | 病例字段初始快照、当前值读取和人工修改判断；从已删除的字段反馈状态中保留下来的纯编辑状态 | 不创建反馈 key/草稿/提交状态，不控制 UI，不写日志或 PHIS |
| **VoiceSessionFeedbackBar.vue** | -- | 保留的语音问诊整页评价组件；真实实现位于 `src/features/voice-consultation/ui/VoiceSessionFeedbackBar.vue`，旧 `src/components/VoiceSessionFeedbackBar.vue` 兼容包装已删除 | 当前不再接入一键回写成功流程；回写成功直接收起结果页，问题反馈由工作区顶栏主动入口承接 |
| **VoiceCapsule.vue** | ~900 | 语音录制界面：音频采集（PCM16）、流式传输、“音频采集完成”审核、继续采集与二次确认放弃；续采文字拼接与同规格 PCM WAV 合并下沉 `features/voice-consultation/lib/voiceRecordingContinuation.ts`，放弃后的状态清理与取消结果写入由 `useVoiceConsultation.ts` 承担，App 只编排返回患者胶囊 | 配合 audioRecorder + aliyunSpeech；真正放弃才清空，继续采集必须保留前段 |
| **TreatmentItemEditor.vue** | ~150 | 治疗项可编辑字段子组件；真实实现已迁至 `src/features/consultation-result/ui/TreatmentItemEditor.vue`，旧 `src/components/TreatmentItemEditor.vue` 兼容包装已删除。默认 `compact` 模式供症状问诊使用，`inline` 模式把语音侧药品“一次剂量 / 频次 / 用法 / 总量”四格主编辑区也收敛到同一组件 | 仅 UI，不做候选切换或归一化；业务侧需自行调用 `useTreatmentNormalization` |
| **MedicineUsageFieldSelector.vue** | ~340 | 药品频次/用法可搜索下拉子组件；真实实现已迁至 `src/features/consultation-result/ui/MedicineUsageFieldSelector.vue`，旧 `src/components/MedicineUsageFieldSelector.vue` 兼容包装已删除 | 已被语音侧和症状侧同时采用 |
| **ManualMatchPicker.vue** | ~180 | 手动匹配候选弹窗子组件；真实实现已迁至 `src/features/consultation-result/ui/ManualMatchPicker.vue`，旧 `src/components/ManualMatchPicker.vue` 兼容包装已删除。props 中性化为 `candidates: ManualMatchCandidate[]`，不绑定具体业务 | UI 不负责业务逻辑；语音侧需在 select 后调 `applyManualMatch` 跟进药房/执行科室门禁 |
| **RecAttributeChip.vue** | ~310 | 推荐项必填属性 chip+popover 子组件；真实实现已迁至 `src/features/consultation-result/ui/RecAttributeChip.vue`，旧 `src/components/RecAttributeChip.vue` 兼容包装已删除。props 中性化为 `options: AttrOption[]` + `valueText` + `missing`，不绑定具体业务 | 语音侧沉量较重（secondary-selector 从 editor 弹出），本组件供轻量包装 chip 复用 |

### 辅助功能组件

| 组件 | 行数 | 职责 |
|------|------|------|
| **SettingsPanel.vue** | -- | 设置页根级历史入口和 shell：只编排通用/关于页签、服务端连接保存与重连、窗口置顶、音频采集、缓存/HIS 联调入口和更新检查；通用设置页签位于 `features/settings/ui/SettingsGeneralTab.vue`，音频设备、录音目录、保存快照/dirty 状态分别下沉到 settings model，底部保存状态条位于 `SettingsSaveBar.vue` |
| **HisIntegrationLogPanel.vue** | -- | HIS 联调日志独立视图面板：筛选、查看详情、复制、导出、清空本地 JSONL 日志；真实实现已迁至 `src/features/settings/ui/HisIntegrationLogPanel.vue`，旧 `src/components/HisIntegrationLogPanel.vue` 已删除 |
| **MedicalCatalogCachePanel.vue** | -- | 缓存管理独立视图：当前负责诊断 / 诊疗项目 / 药品等基础目录缓存状态、同步和按目录 / 机构 / 租户 / 药房清理；真实实现已迁至 `src/features/medical-catalog/ui/MedicalCatalogCachePanel.vue`，旧 `src/components/MedicalCatalogCachePanel.vue` 已删除 |
| **FeedbackSubmissionPanel.vue** | ~560 | 统一问题反馈面板（一键回写 + 右上角入口共用），紧凑星级 + 问题标签 + 选填截图；真实实现已迁至 `src/features/feedback/ui/FeedbackSubmissionPanel.vue`，旧 `src/components/FeedbackSubmissionPanel.vue` 已删除 |
| **KnowledgePanel.vue** | ~850 | PMPHAI 医学知识检索；真实实现已迁至 `src/features/knowledge/ui/KnowledgePanel.vue`，旧 `src/components/KnowledgePanel.vue` 已删除 |
| **BodyPartSelector.vue** | ~830 | 人体部位交互选症状（分性别）；真实实现已迁至 `src/features/symptom-consultation/ui/BodyPartSelector.vue`，旧 `src/components/BodyPartSelector.vue` 已删除 |
| **ChatPanel.vue** | ~670 | LLM 聊天界面（流式 + Markdown），默认按窄高聊天面板比例展示 |
| **KnowledgeBasePanel.vue** | ~560 | 内置知识库搜索（备选通道）；真实实现已迁至 `src/features/knowledge/ui/KnowledgeBasePanel.vue`，旧 `src/components/KnowledgeBasePanel.vue` 已删除 |
| **FactCheckWidget.vue** | ~470 | AI 回答事实核查浮窗；真实实现已迁至 `src/features/feedback/ui/FactCheckWidget.vue`，旧 `src/components/FactCheckWidget.vue` 兼容包装已删除 |
| **ReceptionCapsule.vue / ChronicRefillScopeSelector.vue / ChronicRefillReviewPanel.vue** | ~680 / ~350 / ~200 | 接诊胶囊只编排慢病“复诊配药”入口；范围选择子组件只承载多慢病勾选，后台 AI 药品归类不进入界面；复诊核查面板以主诊断卡片按钮为锚点，用紧凑扁平列表展示同次生成返回的可选参考项，支持关闭和重开，未处理不阻断回写 |
| **SystemCategorySelector.vue** | ~360 | 按系统分类选症状；真实实现已迁至 `src/features/symptom-consultation/ui/SystemCategorySelector.vue`，旧 `src/components/SystemCategorySelector.vue` 已删除 |
| **UpdateChecker.vue** | ~330 | 应用自动更新检查/安装；真实实现已迁至 `src/features/settings/ui/UpdateChecker.vue`，旧 `src/components/UpdateChecker.vue` 已删除，设置页和强更门禁通过 `@features/settings` 公开入口消费 |
| **ForceUpdateGate.vue** | ~130 | 服务端强制更新门禁，只展示版本要求并嵌入 `UpdateChecker` 执行检查、下载和重启；真实实现已迁至 `src/features/settings/ui/ForceUpdateGate.vue`，旧 `src/components/ForceUpdateGate.vue` 已删除，App 通过 `@features/settings` 异步消费 |
| **RiskAlertBubble.vue** | ~315 | 风险提醒气泡；真实实现已迁至 `src/features/reception-risk/ui/RiskAlertBubble.vue`，旧 `src/components/RiskAlertBubble.vue` 已删除 |
| **RiskAlertPanel.vue** | ~290 | 患者风险警报面板；真实实现已迁至 `src/features/reception-risk/ui/RiskAlertPanel.vue`，旧 `src/components/RiskAlertPanel.vue` 已删除；`RiskItem` 类型从 `@features/reception-risk` 导入 |
| **FactCheckHighlight.vue** | ~306 | 行内事实核查标注；真实实现已迁至 `src/features/feedback/ui/FactCheckHighlight.vue`，旧 `src/components/FactCheckHighlight.vue` 兼容包装已删除 |
| **FactCheckNotification.vue** | ~250 | 事实核查通知 Toast；真实实现已迁至 `src/features/feedback/ui/FactCheckNotification.vue`，旧 `src/components/FactCheckNotification.vue` 兼容包装已删除 |
| **KnowledgeDetailModal.vue** | ~380 | 知识文档详情弹窗；真实实现已迁至 `src/features/knowledge/ui/KnowledgeDetailModal.vue`，旧 `src/components/KnowledgeDetailModal.vue` 已删除 |
| **KnowledgeResultItem.vue** | ~170 | 知识搜索结果行；真实实现已迁至 `src/features/knowledge/ui/KnowledgeResultItem.vue`，旧 `src/components/KnowledgeResultItem.vue` 已删除 |
| **Toast.vue** | ~150 | 全局通知；真实实现已迁至 `src/shared/ui/Toast.vue`，旧 `src/components/Toast.vue` 兼容包装已删除，全局 provider 直接使用 shared 实现 |
| **LoadingSpinner.vue** | ~100 | 通用加载动画；真实实现已迁至 `src/shared/ui/LoadingSpinner.vue`，旧 `src/components/LoadingSpinner.vue` 兼容包装已删除 |
| **Icon.vue** | ~60 | 通用 Iconify 图标包装；真实实现已迁至 `src/shared/ui/Icon.vue`，旧 `src/components/Icon.vue` 兼容包装已删除；依赖 `src/icons/iconifyCollections.ts` 注册精简离线图标集合，新增图标时需同步该集合 |
| **IconShowcase.vue** | ~350 | 图标展示（测试用）；真实实现已迁至 `src/shared/ui/IconShowcase.vue`，旧 `src/components/IconShowcase.vue` 已删除，不进入业务功能域 |

---

## Composables (`src/composables/`)

> `features/consultation-result/model/useTreatmentHydration.ts` 同时负责药品定稿和非药品详情补全。检查、检验、处置进入可见推荐列表后由页面调用 `hydrateMatchedMedicalItemDetails()` 预取执行科室、单位、默认数量和检查部位；同一推荐项的预取与选中校验共用进行中请求，`isMedicalItemDetailHydrating()` 只提供卡片读取态，均不得改变选中状态或覆盖医生手动清空。

可复用逻辑层，从 App.vue 抽离的业务编排。

| 模块 | 行数 | 职责 | 关键导出 |
|------|------|------|---------|
| **useEventListeners.ts** | ~575 | 全局事件枢纽：HIS HTTP 事件、深链接、鼠标/窗口事件、Tauri 事件监听；`start-voice-consultation` 会按目标患者判断是否恢复未提交语音缓存，同患者有缓存则恢复结果页，否则开启新语音会话；仅在已处于录音胶囊页时对重复请求做幂等处理；App 级 Tauri 事件注册/解绑样板已复用 `shared/composables/useTauriEventListener.ts` 并按原顺序批量显式启动，接诊状态机已下沉到 `app/events/useReceptionController.ts`，SDK handshake 初始化已下沉到 `app/events/useSdkHandshakeController.ts` | HIS 事件绑定、deep link 处理、window 事件和事件分发；后续继续按事件域拆 controller |
| **useReceptionController.ts** | ~505 | App 级接诊状态机，位于 `src/app/events/useReceptionController.ts`；处理 HIS 患者补全、过敏史 / 历史就诊摘要合并、同患者并发接诊复用、自动静默接诊 guard、患者切换时语音缓存 / 最小化入口清理，以及风险胶囊加载 | 不注册 Tauri 事件、不处理 SDK handshake、不打开具体问诊 / 语音结果页、不提交 PHIS 回写 |
| **useSdkHandshakeController.ts** | ~240 | App 级 SDK handshake controller，位于 `src/app/events/useSdkHandshakeController.ts`；解析 handshake payload 的 HIS origin/token、机构/租户、角色科室和 URT，保留 SDK origin 的 contextPath 并移除 userinfo/query/fragment，初始化 / 重置 HIS 服务与反馈 actor，并同步医学目录上下文 | 不注册 Tauri 事件、不读写患者上下文、不打开页面、不提交 PHIS 回写 |
| **useWindowManagement.ts** | ~422 | 窗口位置/尺寸/显示器管理；真实实现已迁至 `src/app/shell/useWindowManagement.ts`，旧 `src/composables/useWindowManagement.ts` 兼容 re-export 已删除 | `saveWindowPosition()`, `restoreWindowPosition()`, `smartExpand()`, `resizeWorkWindow()` |
| **useWorkMode.ts** | ~422 | 球体 <-> 工作面板的切换；真实实现已迁至 `src/app/shell/useWorkMode.ts`，旧 `src/composables/useWorkMode.ts` 兼容 re-export 已删除 | `enterWorkMode()`, `exitWork()`, `handleCollapse()` |
| **useSymptomConsultationCache.ts** | -- | 智能问诊未结束现场缓存；按就诊锚点保存内部页面、症状/表单、病历草稿、诊断/推荐和引用状态；诊毕/放弃清理，跨自然日失效 | `read/write/clear` 快照 |
| **useConsultationRecordDraftGeneration.ts** | -- | 智能问诊病历草稿生成 controller：先用 `consultationRecordAiDraft.ts` 构造基层全科模板风格的 LLM 请求并解析 JSON 主诉/现病史，失败时退回 `consultationGeneratedRecord.ts` 本地规则草稿 | `generateRecordDraft()`, `buildLocalDraft()` |
| **useVoiceConsultation.ts** | -- | 语音录制 -> 转写 -> 病历生成；按 `consultationId` 缓存语音病例解析结果并支持重启后恢复未提交结果；缓存 key、跨自然日失效、base entry 读写 / 清理和 editorSnapshot 增量合并已抽到 `src/features/voice-consultation/model/voiceConsultationCache.ts` | 录制控制、转写回调、结果提交、窗口切换、toast、取消/错误结果写回 |
| **useVoiceIntentRecognition.ts / voiceIntentStream.ts / explicitTreatmentCatalogResolver.ts** | -- | 语音结构化抽取：真实实现位于 `src/features/voice-consultation/model`，旧 `src/composables/useVoiceIntentRecognition.ts` 仅保留兼容 re-export；`useVoiceIntentRecognition.ts` 把医患对话整理成病例草稿、诊断/检查/药品提示，并保留 explicit/inferred 来源标记与处方核心字段，供 `VoiceConsultationNew.vue` 直接落地到可编辑结果页；`voiceIntentStream.ts` 负责 NDJSON / 换行对象 / 连续对象 / 事件数组的协议解帧、分区累积和明确医嘱条目隔离，不允许单条可选医嘱格式异常取消已可用核心分区；`explicitTreatmentCatalogResolver.ts` 负责把明确医嘱映射到本次实时目录，名称上位或含糊时结合完整对话、病历和正式诊断在目录候选内推测补全标准项目与临床目标，只接受 high / medium 且保持未选中；LLM JSON 候选抽取复用 `features/clinical-result/clinicalResultLlmJsonParser.ts`，结构校验与一次修复流程留在语音域 model | LLM 抽取、流协议兼容、结果结构校验、异常医嘱隔离、对话驱动的目录内补全、结构归一、治疗项后处理；不处理缓存恢复、PHIS 回写、窗口切换或诊毕 / 放弃 |
| **clinicalResultLlmJsonParser.ts** | -- | 问诊结果共享 LLM JSON 宽容解析器：真实实现位于 `src/features/clinical-result/clinicalResultLlmJsonParser.ts`；症状问诊旧 `consultationLlmJsonParser.ts` 仅兼容重导出，语音结果页诊断 / 治疗推荐解析复用同一套去 BOM、markdown fence、平衡括号候选扫描和错误包装 | 不调用 LLM、不弹 toast、不写日志、不读写 Vue ref 或页面状态 |
| **clinicalResultAiRequest.ts** | -- | 问诊结果共享 AI 请求规格 helper：真实实现位于 `src/features/clinical-result/clinicalResultAiRequest.ts`；构造 diagnosis、medication、exam、lab_test、procedure 推荐的 chat messages 与 trace config，支持单路和多路治疗推荐规格；prompt 资产由调用方注入，trace 基础字段和具体 scene/title/action 可注入且默认保持语音问诊取值 | 不调用 `chat`、不改 loading、不处理错误、不写日志、不读写 Vue ref / 缓存 / PHIS |
| **clinicalResultAiMapping.ts** | -- | 问诊结果共享 AI raw 映射 helper：真实实现位于 `src/features/clinical-result/clinicalResultAiMapping.ts`；把语音结果页诊断 raw 标准库匹配、治疗 raw catalog assessment / normalize 组合、多路治疗响应解析失败隔离和合并，以及智能问诊 western 诊断 raw 策略化匹配、western 治疗 raw 数组按目标类型过滤转换从页面中抽离，匹配 / normalize / parser / parse-error 回调由页面注入 | 不调用 LLM、不弹 toast、不写日志、不读写 Vue ref、不触发事实核查 / 缓存 / PHIS |
| **clinicalResultTreatmentFields.ts** | -- | 问诊结果共享治疗字段归一 helper：真实实现位于 `src/features/clinical-result/clinicalResultTreatmentFields.ts`；把 AI raw 中的 `quantity/count/amount` 等数量别名归一到 `totalQty/totalUnit`，并把模型误放在 `dosage/dosageUnit` 的 mg/g/ml 临床剂量迁移到 `targetDose/targetDoseUnit`，供语音问诊、智能问诊和独立诊疗方案复用；同时提供执行科室当前值到标准 key 的同步函数，执行科室本身必须来自医生选择或 HIS 项目详情 hydrate，不从 AI raw 反填 | 纯函数，不调用 HIS、不改选中态、不弹 toast、不触发 hydrate / 库存 / PHIS |
| **treatmentRequiredFields.ts** | -- | 问诊结果共享治疗项必要字段校验 helper：真实实现位于 `src/features/clinical-result/treatmentRequiredFields.ts`；按用药、检查、检验、处置分别校验 `record-confirmed.orderList` 必需字段，并可复用 `useClinicalResultWritebackPayload` 暴露的 order resolver 保持校验口径与最终 payload 一致；执行科室、医保限用、药品总量等被医生清空时只认当前控件空值，不从匹配元数据或默认值补回 | 纯函数，不调用 HIS、不 hydrate、不弹 toast、不打开编辑器、不修改治疗项 |
| **useMedicalDictionaries.ts** | ~145 | HIS 字典统一加载：真实实现已迁至 `src/features/consultation-result/model/useMedicalDictionaries.ts`，旧 `src/composables/useMedicalDictionaries.ts` 兼容 re-export 已删除；负责频次 / 用法 / 发药药房 / 执行科室数据加载，不携带页面特有副作用，调用方需在 `loadPharmacyOptions/loadAllDictionaries` 之后自行补药品目录预热、执行科室 key 同步等后置动作。语音问诊与症状问诊共用 | `frequencyOptions/routeOptions/pharmacyOptions/execDeptOptions` refs、`loadXxxOptions()` |
| **useTreatmentNormalization.ts / useTreatmentHydration.ts** | ~290 / ~500 | 药品推荐共享归一与定稿流水线：`useTreatmentNormalization.ts` 负责 HIS 频次 / 用法标准化和基于最终处方字段的包装总量计算；精确换算失败但一次剂量、频次、天数与销售包装完整时，由 `clinicalResultMedicineQuantity.ts` 统一兜底一个销售包装并生成医生确认说明。`useTreatmentHydration.ts` 负责当前药房药品详情、目标剂量换算、归一结果落地及最终总量库存校验。语音问诊、症状问诊、报告回诊、慢病复诊和独立方案必须调用 `finalizeMedicineRecommendation(s)`，不得只 hydrate 后直接缓存、自动选中或校验库存 | `normalize()`、`finalizeMedicineRecommendation(s)`、`checkMedicineInventoryEnough()` |
| **useTreatmentGates.ts** | ~135 | 治疗项门禁逻辑：真实实现已迁至 `src/features/consultation-result/model/useTreatmentGates.ts`，旧 `src/composables/useTreatmentGates.ts` 兼容 re-export 已删除；`isPharmacyRequired/isExecDeptRequired`、`hasRequiredPharmacy/hasRequiredExecDept`、`getCandidatePharmaciesForMedicine`（按药品 storeIds 收窄候选药房）、`ensurePharmacy`（默认取首个候选）；执行科室必填覆盖检查、检验和处置，必填判断只认当前已选 `execDept`，医生清空后不再从 `matchedItem` 或 raw 兜底显示 | 不做副作用（如 medicineDetail 轮询），如需库存校验在调用方处理 |
| **useDiagnosisSelection.ts** | ~100 | 诊断推荐选择状态：真实实现位于 `src/features/consultation-result/model/useDiagnosisSelection.ts`；管理诊断勾选集合、主诊断、替换诊断后 key 同步和移除时兜底主诊断 | 只做状态规则，不触发治疗刷新、AI 请求、toast、反馈注册或 PHIS 回写 |
| **useManualMatchState.ts** | ~80 | 治疗推荐手动匹配弹层状态：真实实现位于 `src/features/consultation-result/model/useManualMatchState.ts`；管理当前打开的手动匹配 key、每条推荐的搜索关键词和打开时默认关键词 | 只做 UI 状态，不访问标准库、不应用匹配、不触发药房/执行科室/库存后置动作 |
| **useClinicalResultPatientContext.ts** | ~55 | 结果页患者展示 / 就诊锚点派生：真实实现位于 `src/features/consultation-result/model/useClinicalResultPatientContext.ts`；根据当前 patient 派生姓名、性别、年龄、`idTet`、anchorId 和 `consultationId` | 不补全患者、不切换患者、不读写缓存、不拼装 PHIS payload |
| **useClinicalResultIntentReset.ts** | -- | 结果页 intent 初始化重置：真实实现位于 `src/features/consultation-result/model/useClinicalResultIntentReset.ts`；新 `intentResult` 到来时清理上一次结果页现场、回填病历字段并设置病例字段初始快照 | 不触发 AI 请求、不叠加缓存快照、不事实核查、不注册推荐、不提交用户日志或 PHIS 回写 |
| **useClinicalResultProgressiveIntentApplication.ts** | -- | 普通语音分区流应用计划：按患者 / 就诊 / `consultationRoundId` 区分首次 reset、后续 patch 与 complete finalize，并返回本轮新增分区，避免每个 NDJSON 事件整页重置 | 只维护会话与已见分区，不读写页面字段、不发 AI 请求、不处理治疗、缓存或 PHIS 回写 |
| **useClinicalResultGenerationSequence.ts** | -- | 普通语音结果呈现时序 controller：区分初始诊断恢复、手动刷新和治疗生成，基于正式诊断、诊疗路由、当前诊断 identity 与已完成方案 identity 派生诊断兜底、治疗启动和 AI 方案可见性；非 `voice` 渠道保持透传 | 不发 AI 请求、不写诊断或治疗列表、不处理慢病专用流、不接管报告回诊或 PHIS 回写 |
| **useClinicalResultWritebackPayload.ts** | -- | 结果页最终回写清单 controller：真实实现位于 `src/features/consultation-result/model/useClinicalResultWritebackPayload.ts`；组合已选诊断 / 治疗推荐生成 `diagList` 与 `orderList`，复用 `features/clinical-result/recordConfirmedPayload.ts` 的纯 builder，并导出同一份 order resolver 供提交前必要字段校验复用 | 不调用 `complete_consultation`、不做库存校验、不弹 toast、不提交日志、不清缓存 |
| **useClinicalResultWritebackPreflight.ts** | -- | 结果页最终回写前置门禁 controller：真实实现位于 `src/features/consultation-result/model/useClinicalResultWritebackPreflight.ts`；按既有顺序编排标准诊断匹配、药品详情、库存、药房、执行科室、检查部位和治疗项必要字段校验，并返回可提交的已选治疗 | 不调用 `complete_consultation`、不构造 PHIS payload、不改提交状态、不提交日志、不清缓存、不改写治疗选择 |
| **useVoiceFeedbackActions.ts** | -- | 语音结果页反馈与完成动作 controller：真实实现位于 `src/features/voice-consultation/model/useVoiceFeedbackActions.ts`；只编排诊断 / 治疗推荐反馈提交、成功 toast、推荐弹层关闭与结果页完成回调，病例字段和整页反馈接线均已移除 | 不读取缓存、不提交用户日志、不调用 PHIS 回写、不触发 AI、不登记推荐目标 |
| **useVoiceFeedback.ts** | -- | 症状问诊和语音结果页共用反馈编排：真实实现位于 `src/features/feedback/model/useVoiceFeedback.ts`；管理推荐 target 登记、推荐 / 病例字段 / 整页反馈草稿、提交本地 feedbackService 和 voice feedback backend payload 队列 | 不弹 toast、不提交用户日志、不调用 PHIS 回写、不触发 AI、不关闭结果页 |
| **useSecondarySelector.ts** | ~125 | 治疗推荐二级搜索下拉（药房 / 执行科室 / 部位 / 医保）的统一状态：真实实现已迁至 `src/features/consultation-result/model/useSecondarySelector.ts`，旧 `src/composables/useSecondarySelector.ts` 兼容 re-export 已删除；按 `getEditorKey(rec) + ':field'` 唯一寻址 | 仅状态管理，不做候选过滤；过滤词通过 `resolveFilterKeyword(keyword, currentValue)` 共享口径 |
| **useTreatmentSections.ts** | ~130 | 治疗推荐展示派生：真实实现位于 `src/features/consultation-result/model/useTreatmentSections.ts`；按固定药品 / 检查 / 检验顺序组合已有推荐和普通语音分支状态，药品保持独立占位，同一联合任务的检查 / 检验状态合并为一个进度或失败占位，再生成内容分组、是否存在推荐和空状态文案 | 不触发 AI 刷新、不改变治疗项选中、不校验库存、不提交反馈或 PHIS 回写；不得把联合检查 / 检验请求伪装成两个独立加载任务 |
| **useTreatmentEditorState.ts** | ~100 | 治疗项编辑器轻状态：真实实现位于 `src/features/consultation-result/model/useTreatmentEditorState.ts`；管理展开的治疗项 key 集合、当前 active 字段 key、字段 DOM 注册与 focus | 不归一化治疗项、不写回字段、不触发库存/字典/二级选择器副作用 |
| **useMedicineFieldEditing.ts** | -- | 药品用法用量字段编辑 controller：真实实现位于 `src/features/consultation-result/model/useMedicineFieldEditing.ts`；编排字段激活、blur 收口、频次 / 用法 keyword 解析写回、总量输入和库存 warning 清理 | 不改变治疗项选中、不打开二级属性、不触发 AI 请求、不弹 toast、不提交 PHIS 回写 |
| **useTreatmentPharmacyResolution.ts** | -- | 治疗药房解析：真实实现位于 `src/features/consultation-result/model/useTreatmentPharmacyResolution.ts`；统一药品候选药房收窄、默认药房、已选药房匹配、药房名称归一化和详情加载后的默认药房填充 | 不触发库存校验、不改变治疗项选中、不清空字段、不弹 toast、不拉取药品详情、不提交 PHIS 回写 |
| **useTreatmentSelectionReadiness.ts** | -- | 治疗项选中前置校验：真实实现位于 `src/features/consultation-result/model/useTreatmentSelectionReadiness.ts`；统一药品详情、药房、执行科室、检查部位、治疗项必要字段和库存门禁，并通过注入回调打开对应编辑入口 / 提示 | 不修改 `selected`、不应用手动匹配、不刷新 AI、不提交 PHIS 回写 |
| **useTreatmentQuickSelector.ts** | ~45 | 治疗项 quick selector 打开编排：真实实现位于 `src/features/consultation-result/model/useTreatmentQuickSelector.ts`；封装展开治疗编辑器、打开药房 / 执行科室 / 部位二级选择器并聚焦输入框 | 不过滤候选、不写回字段、不清空字段、不校验库存、不弹 toast |
| **useTreatmentAttributeSearch.ts** | -- | 治疗项二级属性候选搜索：真实实现位于 `src/features/consultation-result/model/useTreatmentAttributeSearch.ts`；统一药房 / 执行科室 / 部位 / 医保的 keyword 读写、候选构造和过滤列表派生 | 不写回字段、不清空字段、不取消选中、不触发库存校验、不弹 toast、不提交 PHIS 回写 |
| **useWritebackStatus.ts** | ~90 | 最终一键回写等待态：真实实现位于 `src/features/consultation-result/model/useWritebackStatus.ts`；管理 pending requestId、等待提示、最近回执、按钮文案和 banner 文案，供共享结果页入口复用 | 不监听 Tauri 事件、不调用 `invoke`、不弹 toast、不提交日志；页面负责成功/失败后的业务副作用 |
| **useConsultationReferenceFeedbackListener.ts** | -- | PHIS 回执事件入口：真实实现位于 `src/features/consultation-result/model/useConsultationReferenceFeedbackListener.ts`；管理 `consultation-reference-feedback` 事件名、调用方活跃门禁、当前 `consultationId` 防串线和 Tauri listener 生命周期组合，供语音问诊、智能问诊和保活页面复用 | 不做 requestId 匹配、不写引用状态 map、不弹 toast、不提交日志、不清缓存 |
| **useBodySiteOptions.ts** | ~65 | 检查项目（exam）部位选项落地：真实实现已迁至 `src/features/consultation-result/model/useBodySiteOptions.ts`，旧 `src/composables/useBodySiteOptions.ts` 兼容 re-export 已删除；`applyMedicalItemPartOption(rec, option)` 把单个部位选项写入 `bodySite/bodySiteId/matchedItem.idPart + raw`；`applyMedicalItemPartOptions(rec, options)` 批量加载，优先匹配当前 partId，否则单选项时自动应用 | HIS 拉取（`his.fetchMedicalItemPartOptions`）由调用方完成，本 composable 不持副作用 |
| **useTreatmentHydration.ts** | ~310 | 真实实现已迁至 `src/features/consultation-result/model/useTreatmentHydration.ts`，旧 `src/composables/useTreatmentHydration.ts` 兼容 re-export 已删除；抽自语音问诊的"药品详情轮询 + 库存校验"核心：`hydrateMatchedMedicineDetail`（在 `getCandidatePharmaciesForMedicine` 候选药房中依次拉取 `fetchMedicineProDetail`，回填 dose/freq/route/spec/totalUnit/pharmacy + 在 `matchedItem.raw` 上打 `__medicineDetailLoaded`）、`ensureMedicineSelectable`、`checkMedicineInventoryEnough` + warning/checking 状态映射。语音问诊与症状问诊共用；非药品详情 / 检查部位仍由调用方编排 | 注入 `notify`，不持有 UI 状态（quick selector、editor expansion 等由调用方处理） |
| **useOutsideInteraction.ts** | -- | 通用 document 外部点击 / pointerdown 生命周期 composable，位于 `src/shared/composables/useOutsideInteraction.ts`；按 selector 或 element refs 判断点击是否落在浮层锚点外部，并调用注入的关闭回调 | 不包含推荐、症状、反馈业务状态；页面或 feature model 自行决定关闭哪些浮层 |
| **useTauriEventListener.ts** | -- | 通用 Tauri `listen` 生命周期 composable，位于 `src/shared/composables/useTauriEventListener.ts`；支持 mounted 自动订阅或显式 `startListener()`，unmounted 阶段统一解绑，统一输出订阅失败日志，并可在显式注册链路中传播失败 | 不包含事件 payload 业务过滤、PHIS 回执处理、下载进度、toast 或页面状态写入 |
| **useTauriWindowEventListeners.ts** | -- | 通用独立窗口 `appWindow.listen` 生命周期 composable，位于 `src/shared/composables/useTauriWindowEventListeners.ts`；支持批量显式 `registerListeners()`、unmounted 统一解绑和注册失败日志，当前用于诊断路径窗口与报告解读窗口 | 不发送 ready 事件、不写 payload 状态、不渲染图表、不处理窗口业务状态 |
| **useNavigation.ts** | -- | 视图导航；真实实现已迁至 `src/app/navigation/useNavigation.ts`，旧 `src/composables/useNavigation.ts` 兼容 re-export 已删除 | `openSettings()`, `openConsultation()`, `openChat()` 等 |

**依赖链**：
```
useWindowManagement (基础) <- useWorkMode (依赖位置管理)
useWorkMode <- useNavigation (视图切换在工作模式内)
useEventListeners (全局事件) -> 触发 useNavigation & useWorkMode
```

---

## Services (`src/services/`)

外部通信、数据转换、业务逻辑层。

### 核心服务

| 服务 | 行数 | 职责 | 关键接口 |
|------|------|------|---------|
| **llm.ts + services/llm/** | -- | LLM API facade 与服务端代理编排：`llm.ts` 保留公开 API、签名 `/v1/ai/*` 调用和 trace 编排；`services/llm/config.ts` 只读取 bootstrap 非敏感配置，`retry.ts` 提供指数退避，`payload.ts` 负责消息 payload / 摘要；客户端不再包含 OpenAI 兼容直连实现 | `chatStream()`, `chat()`, `chatFast()`, `transcribeAudio()`, `analyzePatientRisks()` |
| **medicalData.ts** | ~600 | 医学数据目录加载、缓存恢复与匹配（ICD-10 诊断/药品/检查项）；先恢复已有 SQLite / localStorage 缓存，再同步服务端 delta；诊疗项目缓存按机构+租户隔离，药品缓存按机构+租户+药房 `storeId` 隔离，并保留 `storeIds` 用于当前药房集合并集匹配；当前药房库存和药品详情仍经 HIS Adapter 按需读取，同时暴露调试态查询/清理能力 | 模糊匹配 + 拼音支持 |
| **diagnosisPath.ts** | ~568 | 诊断推理路径生成 | ECharts 节点/连线数据，ICD-10 匹配 |
| **pmphai.ts** | -- | PMPHAI 医学知识库服务端代理（主通道）；凭据和 OAuth token 仅由服务端管理 | 向量搜索、列表搜索、文档检索、页面 URL |
| **textGeneration.ts** | ~281 | 症状字段文本规则兜底 | 症状字段 -> 本地主诉/现病史片段；当前作为 AI 病历草稿失败时的兜底，不直接调用 LLM |

### 语音服务

| 服务 | 行数 | 职责 |
|------|------|------|
| **aliyunSpeech.ts** | ~275 | 语音转写编排：阿里云 DashScope 实时优先，兼容 OpenAI 风格批量转写兜底 |
| **speechConfig.ts** | -- | 统一管理语音转写 provider / API Key / Base URL / Model 配置，并兼容旧配置迁移 |
| **audioRecorder.ts** | ~317 | 浏览器音频录制（Web Audio API, PCM16），并统一处理输入设备枚举、首选设备持久化、首开权限预热和失效回退 |

### 辅助服务

| 服务 | 行数 | 职责 |
|------|------|------|
| **hisService.ts** | ~80 | @internal 底层 PHIS HTTP 客户端；仅供 `services/his/*` 包装使用。业务代码禁止跨层 import，必须走 [his](src/services/his/index.ts) 入口（业务调用 `getHisAdapter()`；SDK handshake 走 `getHisService()`）；底层 `post/get` 会写入已移除 URL userinfo/query/fragment 且请求摘要脱敏的 HIS 联调出站日志，控制台同样只记录方法、接口路径、状态、耗时和数量；诊断目录按 1000 条/页循环同步，避免弱网下一次性拉取数万条超时；封装检查项目部位 / 方式候选查询 |
| **hisIntegrationLog.ts** | -- | HIS 联调日志 Tauri 客户端：TS 出站写入前递归遮蔽患者、就诊、住院、人员、机构、科室、凭据及自由文本值，并提供结构化记录、查询、清空、导出 Bridge / PHIS 调用流水；不改写 Rust Bridge 入站日志的既有本地调试字段 |
| **his/HisAdapter.ts** | ~120 | 厂商无关的 HIS 适配器接口契约，14 个方法分 5 组（会话 / 目录 / 字典 / 详情 / 检查部位）；新厂商接入只需实现本接口 |
| **his/types.ts** | ~140 | vendor-neutral DTO：详情（`MedicineDetail` / `MedicalItemDetail`）+ 检查部位（`MedicalItemPartOption`）+ 目录（`DiagnosisCatalogEntry` / `MedicineCatalogEntry` / `MedicalItemCatalogEntry`）+ 字典（`DictionaryEntry`）+ 库存（`InventoryCheckRequest` / `InventoryCheckResult`）；语义化字段命名，PHIS 私有字段统一通过 `raw` / `properties` 透传 |
| **his/PhisHisAdapter.ts** | ~120 | 默认厂商实现：thin wrapper 包装 `HisService` 类，详情与检查部位方法在此处把 PHIS 字段映射为中性 DTO |
| **his/MockHisAdapter.ts** | ~150 | 内置 mock 实现：不连接任何后端，返回固定样本数据。主要用于反向验证抽象是否充分 + 本地 demo / E2E；已在 registry 中预注册（vendor='mock'） |
| **his/registry.ts** | ~100 | 适配器注册表与选择器；`getHisAdapter()` 是业务方唯一入口；选择优先级 setActiveHisVendor > VITE_HIS_VENDOR > localStorage.HIS_VENDOR > 默认 phis |
| **his/index.ts** | ~30 | 公开入口：重出 adapter / 注册 API / 类型 |
| **medical_catalog.rs** | -- | 医学目录 SQLite 持久化命令：诊断全局缓存、诊疗项目按机构+租户缓存、药品按机构+租户+药房缓存与同步状态管理，并提供调试态查看/清理命令 | 供 `medicalData.ts` 调用 |
| **factChecker.ts** | ~399 | AI 输出验证（医学指南核查） |
| **feedback.ts** | -- | 反馈与结构化操作日志适配：把前端事件转换为服务端审计需要的 `module/action/result/details` 载荷；不再写本地产品分析 SQLite |
| **featureUsageTracker.ts / featureUsageEntryTracker.ts** | -- | 辅诊功能调用统计事件入口：按产品功能维度向 `/v1/client/feature-events/batch` 上报一次真实用户调用，所有事件均使用 UUID `eventId` 与由 `featureCode + eventId` 重建的安全幂等键支持离线/重试去重；功能统计不保存或发送顶层 `consultationId`、payload、traceId、sessionId、调用方原始幂等文本，旧主队列与拒绝诊断队列会在任何启动早退判断前同步按允许字段重建并替换非法事件 ID，动作/来源/场景字段只接受有界技术编码；批量响应按 accepted/skipped/rejected 逐条结算，拒绝项进入只含最小诊断字段的有界隔离队列，隔离持久化失败或响应畸形时保留整批；`featureUsageEntryTracker.ts` 归一 HIS Bridge 的完整问诊、语音问诊和独立辅助入口计数，同一就诊再次显式触发入口按新调用计数，与 `operationTracker.ts` 的审计日志和 `consultationUserLog.ts` 的运维日志分离 |
| **recommendationPreferenceTracker.ts** | -- | 服务端推荐偏好采集与轻量重排入口：只学习目录匹配后的诊断/医嘱标准项，后台 `features.recommendationPreferenceCollection` 显式开启后，最终确认、手动匹配和 probable match 确认才会写入本地队列并通过 `/v1/client/recommendation-preferences/events/batch` 批量上传；若后台虽开启但未提供该上传接口并返回 404，本次运行暂停上传重试以避免控制台刷屏，本地队列仍保留；诊断/医嘱完成 `medicalDataService` 匹配后可调用 `/v1/client/recommendation-preferences/rank` 获取服务端 boost，但只重排已有候选、不新增候选、不修改 Prompt |
| **voiceFeedback.ts** | -- | 语音反馈 payload 组装、本地草稿、病例字段差异摘要与待同步队列；通过 `submitVoicePendingPayloadToBackend` 映射到统一 `/v1/client/feedbacks` |
| **aiTrace.ts** | ~200 | AI 调用链路缓存 + AI 代理结构化日志桥：补齐 traceId、scene、sourceModule 以及业务发起方 |
| **knowledgeBase.ts** | ~213 | 通用知识库 CRUD |
| **regionalClient.ts + services/regional/** | -- | 服务端核心客户端 facade 与内部模块：`regionalClient.ts` 保留兼容导出；`services/regional/config.ts` 管理连接配置与历史本地凭据清理，`device.ts` 负责 MAC/兜底设备编码，`registration.ts` 负责终端注册和 token，`httpClient.ts` 负责签名 HTTP 请求、服务端时间偏移校准、请求超时和 `SIG-401` 重签重试，`bootstrap.ts` 负责 bootstrap 缓存/初始化/心跳，`realtime.ts` 负责 SSE 与 WebSocket 签名 URL，`speechUpload.ts` 负责语音上传 payload；所有 `/v1/*` 出口必须经过签名模块 |
| **regionalRuntime.ts** | ~50 | 服务端连接运行时编排：统一初始化、重连、远程数据同步、审计/功能调用/推荐偏好队列上传启停 |
| **userFeedback.ts** | ~150 | 统一反馈提交服务（kind/severity/tags/hasCorrection），自动附加 doctor/org/dept actor 与 aiTrace |
| **consultationUserLog.ts** | -- | 运维用户日志上报服务：智能问诊/语音问诊首版 AI 内容与最终提交内容快照，按 `consultationId + consultationType` 聚合到后台用户日志模块 |
| **feedbackContext.ts** | ~80 | 反馈上下文：握手阶段缓存当前医生/机构/科室身份，供反馈提交回填 |
| **themeService.ts** | ~209 | 主题管理（深色/浅色模式） |
| **promptGuard.ts** | ~138 | 提示词注入防护 |
| **operationTracker.ts** | ~105 | 结构化操作日志白名单入口：过滤低价值 UI 噪声，只保留能定位业务路径的导航、提交、接诊、风险、反馈等事件 |
| **templateService.ts** | ~65 | 症状模板加载 |

**服务依赖**：
```
llm.ts <- factChecker.ts, diagnosisPath.ts, textGeneration.ts
his/HisAdapter.ts -> his/PhisHisAdapter.ts -> hisService.ts
his/registry.ts -> his/PhisHisAdapter.ts
his/index.ts -> medicalData.ts
his/index.ts -> VoiceConsultationNew.vue
hisService.ts -> medicalData.ts
medical_catalog.rs -> medicalData.ts
medicalData.ts <- diagnosisPath.ts, ConsultationPage.vue
pmphai.ts (独立知识库服务)
speechConfig.ts -> aliyunSpeech.ts, ChatPanel.vue, SettingsPanel.vue
aliyunSpeech.ts <- audioRecorder.ts (音频流)
```

---

## Stores (`src/stores/`)

Pinia 跨组件共享状态（仅两个，新增需人工审批）。

| Store | 职责 | 关键状态 |
|-------|------|---------|
| **consultationConfig.ts** | 问诊模式/患者状态 | `patientInfo`, `consultationMode`, `selectedDiagnosis`, `generatedRecord` |
| **diagnosisPath.ts** | 诊断路径缓存（跨窗口共享） | `diagnosisPathCache`（按患者+目标诊断键控） |

---

## Types (`src/types/`)

| 文件 | 职责 | 关键接口 |
|------|------|---------|
| **consultation.ts** | 问诊域类型 | `Diagnosis`, `Patient`, `TreatmentRecommendation`, `FinalRecord` |
| **appState.ts** | 应用级状态类型 | `PatientContext`, `AppPatient`, `AppStore`, `ViewType` |
| **patientContext.ts** | 统一患者上下文类型 | `PatientContext` 及 identity / demographics / clinical 子结构 |
| **consultationAssist.ts** | 灵活模式类型 | `ConsultationAssistRequest`, `DiagnosisPathOption` |
| **reportInterpretation.ts** | 报告解读域类型 | `ReportInterpretationRequest`, `ReportInterpretationPayload`, `ReportInterpretationPatientContext` |
| **feedback.ts** | 操作追踪类型 | `FeedbackEvent`, `SessionMetrics` |

## 患者上下文约束

1. `src/composables/useEventListeners.ts` 是唯一 App 级 HIS 事件入口；患者补全、自动接诊 guard 与风险胶囊写入由 `src/app/events/useReceptionController.ts` 统一承接。
2. 外部事件（接诊、风险、问诊、语音）只允许提供患者主键和场景字段；标准患者基本信息与就诊历史必须通过 `HisAdapter.fetchPatientInfo/fetchPatientHistory` 获取。
3. UI / AI prompt / 日志 / 缓存读取患者信息时，统一走 `PatientContext` 或对应 helper，不再各自做别名兼容。

---

## Constants (`src/constants/`)

| 文件 | 职责 |
|------|------|
| **windowSizes.ts** | 各视图窗口尺寸（chat: 420x620, consultation: 1120x760, voice: 360x80 等） |
| **animation.ts** | 动画时长、缓动、窗口尺寸容差阈值 |
| **consultationConfig.ts** | 问诊 UI 配置 |

---

## Rust 后端 (`src-tauri/src/`)

| 文件 | 行数 | 职责 |
|------|------|------|
| **lib.rs** | ~390 | Tauri 初始化、窗口命令（拖拽/位置/毛玻璃）、AppState 共享状态 |
| **http_server.rs** | ~831 | HIS Bridge（Actix-web, `127.0.0.1:8081`）：REST 命令、唯一 WebSocket 结果事件订阅、引用回执、语音触发、报告解读触发，并为入站联调请求生成 `traceId` 与结构化日志 |
| **aliyun_speech.rs** | ~326 | 阿里云语音 WebSocket + Token 刷新 |
| **main.rs** | ~6 | 入口，调用 `pcie_lib::run()` |
| **commands/** | -- | 扩展 Tauri 命令（反馈、医学目录、设备 MAC 读取等） |
| **db/** | -- | 数据库模型 |

### HTTP Server 端点摘要

| 方法 | 路径 | 用途 |
|------|------|------|
| POST | `/api/consultation/start` | 启动完整问诊 |
| POST | `/api/consultation/assist` | 进入灵活模式 |
| POST | `/api/inpatient/emr/generate` | 住院病历辅助生成 |
| GET | `/api/consultation/events/ws` | WebSocket 实时订阅问诊事件 envelope，支持 `after` 补发 |
| POST | `/api/consultation/reference-feedback` | PHIS 引用回执 |
| POST | `/api/consultation/start-voice` | 触发语音问诊 |
| POST | `/api/patient/risks` | 患者风险数据 |

---

## 静态资源 (`src/assets/`)

| 文件 | 大小 | 用途 |
|------|------|------|
| **diagnoses.csv** | 2.2 MB | 历史诊断资产；基础数据运行时不再直接从该 CSV 加载 |
| **tcm-diagnoses.csv** | 46 KB | 历史中医诊断资产；基础数据运行时不再直接从该 CSV 加载 |
| **tcm-syndromes.csv** | 107 KB | 历史中医证型资产；基础数据运行时不再直接从该 CSV 加载 |
| **medicines.csv** | 137 KB | 历史药品资产；基础数据运行时不再直接从该 CSV 加载 |
| **items.csv** | 6.5 KB | 历史诊疗项目资产；基础数据运行时不再直接从该 CSV 加载 |
| **templates.json** | 731 KB | 西医症状表单模板（动态字段） |
| **tcm-templates.json** | 187 KB | 中医症状模板 |
| **symptom-associations.json** | 23 KB | 症状关联推荐数据 |

---

## 核心数据流

### 完整问诊流

```
HIS POST /api/consultation/start
  -> http_server.rs 解析患者数据
  -> emit "start-consultation" 事件
  -> useEventListeners.ts 接收
  -> App.vue enterWorkMode() -> 打开 ConsultationPage
  -> 医生选症状(3种模式) -> 填表单(templates.json)
  -> LLM 按基层全科模板风格生成主诉+现病史（失败退回本地规则草稿）
  -> LLM 推荐诊断 -> medicalData.ts 匹配 ICD-10
  -> 医生确认 -> complete_consultation 命令
  -> lib.rs 存入 AppState
  -> HIS WebSocket /api/consultation/events/ws 订阅事件，断线时携带 after 游标重连
```

### 灵活模式流

```
HIS POST /api/consultation/assist {action: "suggestedDx", chiefComplaint: "..."}
  -> 跳过症状采集 -> 直达诊断推荐页
  -> 进入共享结果页 -> 医生确认诊断 / 勾选治疗项
  -> 点击一键回写 -> record-confirmed 写入结果通道
  -> HIS 处理后调 reference-feedback -> 页面即时更新
```

### 语音问诊流

```
触发(HTTP/深链接) -> VoiceCapsule 录音(PCM16)
  -> audioRecorder.ts 采集 -> aliyunSpeech.ts 流式传输
  -> 实时转写文本
  -> LLM 结构化病历 -> VoiceConsultationNew 编辑 + 一键回写（record-confirmed）
  -> 确认 -> 写入同一结果通道
```

---

## 变更热点与设计隐患

> 基于 git 历史（122 commits, 2025-01 至今）的变更频率分析。
> 高频变更往往指向抽象不足、职责模糊或业务理解偏差。改动这些区域时务必先理解根因。

### 一级热点（>30 次变更，结构性风险）

| 文件 | 变更次数 | 变更模式 | 根因诊断 | 改动前必读 |
|------|---------|---------|---------|-----------|
| **ConsultationPage.vue** | 38 | 不断堆砌新功能（中医、关联症状、事实核查、防误漏、灵活模式），间歇性重构文本生成逻辑 | **上帝组件**：完整问诊+灵活模式+诊断+用药+检查+引用闭环全塞在一个文件。"不开第二套窗口"的产品决策导致功能只进不出 | RETRO-002, AGENTS.md 棘轮表 |
| **App.vue** | 33 | 反复加入再抽离业务逻辑（语音、窗口位置、事件监听），一次大重构后稳定 | **曾经的上帝类**：已通过 composable 拆分治理，但每次新增入口级功能（语音、风险提醒、深链接）仍会先落到这里 | RETRO-001, AGENTS.md 硬约束 #2 |

### 二级热点（15-30 次变更，关注演进方向）

| 文件 | 变更次数 | 变更模式 | 根因诊断 |
|------|---------|---------|---------|
| **SettingsPanel.vue** | 20 | 不断新增配置项（LLM多模型、审核AI独立配置、主题、自动更新、模板维护），样式反复调整 | **配置膨胀**：每新增一个外部集成就加一坨设置 UI，缺少配置分组/分页抽象。将来应考虑按功能域拆分设置子面板 |
| **llm.ts** | 17 | 流式解析改了多次，审核AI配置拆分又合并，思考模式开关反复 | **LLM 策略未收敛**：业务AI vs 审核AI 是否分离、思考模式是否启用、流式 vs 非流式——这些决策反复摇摆说明 LLM 调用策略的抽象层级不够，混杂了"如何调用"和"调用谁" |

### 三级热点（8-14 次变更，值得留意）

| 文件 | 变更次数 | 变更模式 | 根因诊断 |
|------|---------|---------|---------|
| **VoiceConsultationResult.vue（已删除）** | 11 | 从创建到完善经历多次迭代，事实核查/知识库/主题功能反复附加；2025 年统一 record-confirmed 链路时连同空 `final-report` 路径一并删除 | **横切关注点侵入**（保留作为反面教材） |
| **ChatPanel.vue** | 11 | 主题样式反复、prompt 注入防护附加、演示场景打磨 | 基本稳定，变更多为样式和安全加固，非结构问题 |
| **SystemCategorySelector.vue** | 9 | 从创建到加搜索框到模板管理，持续补功能 | 症状选择的三种模式（常见/部位/系统）各自独立演进，缺少统一的"症状选择策略"抽象 |
| **http_server.rs** | 8 | 每新增一个 HIS 交互场景就加端点（语音、风险、灵活模式） | 基本健康，但端点增长要同步 api.md（已有硬约束） |

### 模块级变更密度

| 模块 | 文件触碰总次数 | 平均每文件 | 解读 |
|------|-------------|-----------|------|
| src/components/ | 152 | 6.1 | 变更最密集，UI 层承担了过多业务决策 |
| src/ (根) | 61 | -- | 主要是 App.vue 拖高 |
| src/services/ | 55 | 3.7 | 相对健康，服务层职责较清晰 |
| src-tauri/ | 38 | -- | Rust 侧变更集中在 http_server.rs 和 lib.rs |
| src/composables/ | 23 | 4.6 | 新拆出的模块，变更主要是初始建设期 |
| src/stores/ | 4 | 2.0 | 最稳定，状态管理边界清晰 |

### 反复摇摆的设计决策

-> 见 [DECISION_DRIFT.md](./DECISION_DRIFT.md)。

本文件只保留代码热点和模块地图；历史上反复推翻、拆分又合并、默认值来回调整的设计决策统一记录到 `DECISION_DRIFT.md`。在这些区域改动前，先确认当前立场。

---

## 变更时的更新义务

本文件需要在以下情况同步更新：

1. **新增/删除/重命名**组件、composable、service、store 文件
2. **模块职责变更**（如功能从一个文件迁移到另一个）
3. **依赖关系变更**（如服务间调用关系改变）
4. **HTTP 端点增减**
5. **数据流路径变更**
6. **静态资源增减**

> 参考 [AGENTS.md 文档更新矩阵](./AGENTS.md) 中的完整更新规则。
