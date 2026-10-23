# PCIE 桌面项目 Harness

继承工作区与本项目AGENTS.md；架构、产品和接口以ARCHITECTURE.md、PRODUCT.md、api.md为准，定位以CODE_MAP.md为准。

1. 先检查工作树并保留用户修改，读取真实调用和受影响模块规则。
2. 文档/契约先更新，再实现生产代码和Vitest测试；跨仓任务使用development-harness/HARNESS.md。
3. 默认执行yarn type-check、yarn test:unit、yarn build；Rust变化补cargo check。真实Tauri运行、HIS/PHIS和第三方服务验收与合成测试分别报告。

## GBase 与真实模型的客户端联调（2026-10-22）

分段语音回归执行 `yarn test:unit src/services/segmentedSpeechTranscriber.test.ts src/services/speechConfig.test.ts src/services/aliyunSpeech.test.ts`，覆盖顺序/背压、边界重叠、空结果/失败、关闭后的迟到回调及停止后完整转写。真实验证区分停止前字幕、停止后完整文本和医学病历；默认使用 Fake 转写，真实模型仍需独立机构与显式运行。

`node scripts/gbase-mock-his/server.mjs` 提供独立环回模拟 HIS 页面，默认 `http://127.0.0.1:4260/`。页面复用 `sdk/med-hermes-sdk.js`、医疗握手与桌面 Bridge，合成患者/就诊使用 `pcie-gbase-client` 前缀；目录查询仅返回合成资料，写回只保存页面内存并发送原请求的成功/失败回执。模拟服务不代理模型、不接收模型密钥、不连接真实 PHIS。

场景包括呼吸道结构化问诊，以及独立患者标识的高血压复诊配药。续方每次发起使用新的合成就诊标识，避免重复验证复用上一轮结果；使用生产 `receivePatient` 接诊，由模拟 HIS 返回近期合成诊断/处方，仍须经过原生慢病范围与医嘱确认；不能把原始历史药品直接当作本次已开立处方。

原生测试构建沿用 `yarn release:test`，单独的 Bundle Identifier 与私有数据目录隔离既有桌面配置，构建时将区域服务地址和独立测试机构注入默认值。默认测试不连 GBase/模型；显式联调保留生产 P-256 签名、模型路由与全部校验。页面受理、真实模型生成、医生确认、模拟回写、GBase 审计分别留证，HTTP 200 不作为功能完成。当前 `main` 没有公卫功能，不能用历史未跟踪的公卫 Mock 替代当前客户端验收。

模拟服务协议/隔离回归使用 `node --test scripts/gbase-mock-his/*.test.mjs`；完整证据和构建来源放忽略的 `output/gbase-client-runtime/.local/`，服务端模型与数据库信息留在服务端私有目录。知识库、实时 ASR、医学适用性、真实 PHIS 与商业数据库空库验收独立记录。

工作台恢复历史记录时，模拟回写完成只由 `mock-writeback-confirmed` 事件认定，不能由“转写成功”或“生成成功”等观察正文推断；协议回归同时核对该展示边界。

并发 HIS 调用另执行 `cargo test --manifest-path src-tauri/Cargo.toml concurrent_log_records_remain_individually_parseable`，检查日志逐行可解析、条目总数与 ID 唯一性；Rust 修改后补 `cargo check` 和原生包重建，真实日志只核对修复后新增区段，不修改历史问题行。

语音的显式合成输入验证另使用私有 Tauri 配置覆盖 `beforeBuildCommand` 为 `NODE_ENV=development yarn build`，配合 Rust debug 构建，使已有 `/api/debug/voice-transcript` 的双方 DEV 门禁都生效。输入仅为合成音频经真实 ASR 得到的文本，不注入 AI 结果；真实模型继续走生产签名代理。该变体与标准前端候选包分别保存摘要，不能称为真实麦克风或实时 ASR 验收；默认/正式构建不改变 DEV 门禁。

2026-10-23 标准前端候选 1.4.9 的真实麦克风验证已完成 14 秒试音：4 秒分段模式在停止前返回 3 次识别结果，其中 2 次有文字；用户观察暂停讲话时出现片段，停止后约 0.58 秒完整转写校正在原生确认页回显。该轮没有确认进入医疗生成或模拟回写，连续讲话、长录音及并发效果仍待验证。后台保存/回显和请求时间线见 `../pcie-server/deploy/gbase-postgresql/README.md`，私有截图及来源清单不进入 Git。

## 机构知识检索

按[知识服务设计](../development-harness/KNOWLEDGE_BASE_DESIGN.md)和机器契约实现；API经regionalClient签名，UI/控制器进入features/knowledge。执行knowledgeRetrieval、useInstitutionKnowledgeController与InstitutionKnowledgePanel测试及默认构建。机构、文档批准和版本由后端确定，不把DRAFT/示例数据当可用医学知识，不新增供应商密钥或自动聊天/公卫注入。

浏览器组件预览从本仓库运行 `yarn vite --config output/knowledge-retrieval-runtime/vite.config.ts`，默认 `http://127.0.0.1:5189/`。入口直接复用生产知识库组件和主题，开发配置仅替换服务依赖为合成响应；不连接 PCIE Server、WeKnora 或 Tauri，不把预览当真实联调。交互、主题和窄窗验证见该目录 README。
