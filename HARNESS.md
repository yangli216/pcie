# PCIE 桌面项目 Harness

继承工作区与本项目AGENTS.md；架构、产品和接口以ARCHITECTURE.md、PRODUCT.md、api.md为准，定位以CODE_MAP.md为准。

1. 先检查工作树并保留用户修改，读取真实调用和受影响模块规则。
2. 文档/契约先更新，再实现生产代码和Vitest测试；跨仓任务使用development-harness/HARNESS.md。
3. 默认执行yarn type-check、yarn test:unit、yarn build；Rust变化补cargo check。真实Tauri运行、HIS/PHIS和第三方服务验收与合成测试分别报告。

## 源码启动与验证

后续问题排查、修复复现与界面验证必须从当前 `pcie` 工作树启动；桌面实例在本仓库执行 `yarn tauri dev`，不得直接使用系统已安装的 PCIE App。核对启动日志和进程可执行路径，确认实际操作的是当前源码实例；出现单实例或 HTTP Bridge 端口冲突时，先核对进程来源并排除冲突，不得静默改用安装版。

浏览器组件预览同样直接加载当前源码，并注明合成依赖及验证边界；不能将组件预览当作原生桌面验收。需要制作安装包时，遵守 [测试构建规则](./AGENTS.md#硬约束禁止)。

## 分段语音转写

停录审核运行 `useVoiceTranscriptionReview.test.ts` 与 `VoiceCapsule.test.ts`，使用合成录音覆盖[分段 ASR 与停录恢复](../TESTING_STRATEGY.md#34-分段-asr-与停录恢复)中的客户端场景。

分段语音回归执行 `yarn test:unit src/services/segmentedSpeechTranscriber.test.ts src/services/speechConfig.test.ts src/services/aliyunSpeech.test.ts`，覆盖顺序/背压、边界重叠、空结果/失败、关闭后的迟到回调及停止后完整转写。真实验证区分停止前字幕、停止后完整文本和医学病历；默认使用 Fake 转写，真实模型仍需独立机构与显式运行。

## 机构知识检索

按[知识服务设计](../development-harness/KNOWLEDGE_BASE_DESIGN.md)和机器契约实现；API经regionalClient签名，UI/控制器进入features/knowledge。执行knowledgeRetrieval、useInstitutionKnowledgeController与InstitutionKnowledgePanel测试及默认构建。机构、文档批准和版本由后端确定，不把DRAFT/示例数据当可用医学知识，不新增供应商密钥或自动聊天/公卫注入。

浏览器组件预览从本仓库运行 `yarn vite --config output/knowledge-retrieval-runtime/vite.config.ts`，默认 `http://127.0.0.1:5189/`。入口直接复用生产知识库组件和主题，开发配置仅替换服务依赖为合成响应；不连接 PCIE Server、WeKnora 或 Tauri，不把预览当真实联调。交互、主题和窄窗验证见该目录 README。
