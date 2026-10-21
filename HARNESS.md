# PCIE 桌面项目 Harness

公卫用药类别选择（2026-10-20，内网交接同步）：结构化草稿渲染与服务端一致，以机构 policy.medicationReminders 为输出类别边界，允许未提供居民用药记录或仅生成部分适用类别。显示名优先取居民类别名，否则使用批准编码；重复、非法类型、未批准类别、空正文及额外字段继续拒绝。空数组提示本次未生成建议，不误报已有用药资料缺失。请求类别仍须由批准资产覆盖。远端结果字段及机器契约不变。

继承工作区与本项目AGENTS.md；架构、产品和接口以ARCHITECTURE.md、PRODUCT.md、api.md为准，定位以CODE_MAP.md为准。

1. 先检查工作树并保留用户修改，读取真实调用和受影响模块规则。
2. 文档/契约先更新，再实现生产代码和Vitest测试；跨仓任务使用development-harness/HARNESS.md。
3. 默认执行yarn type-check、yarn test:unit、yarn build；Rust变化补cargo check。真实Tauri运行、HIS/PHIS和第三方服务验收与合成测试分别报告。

2026-10-19 候选构建：`tauri-plugin-deep-link` 使用 `>=2.0.0, <2.6.2` 约束，避开上游 Linux `ParseOption` 编译回归；由 Test Build 的 Ubuntu Rust quality gate 验证，Windows/macOS 构建继续使用同一源码快照。不得为此刷新 Win7 独立锁。

## 机构知识检索

按[知识服务设计](../development-harness/KNOWLEDGE_BASE_DESIGN.md)和机器契约实现；API经regionalClient签名，UI/控制器进入features/knowledge。执行knowledgeRetrieval、useInstitutionKnowledgeController与InstitutionKnowledgePanel测试及默认构建。机构、文档批准和版本由后端确定，不把DRAFT/示例数据当可用医学知识，不新增供应商密钥或自动聊天/公卫注入。

浏览器组件预览从本仓库运行 `yarn vite --config output/knowledge-retrieval-runtime/vite.config.ts`，默认 `http://127.0.0.1:5189/`。入口直接复用生产知识库组件和主题，开发配置仅替换服务依赖为合成响应；不连接 PCIE Server、WeKnora 或 Tauri，不把预览当真实联调。交互、主题和窄窗验证见该目录 README。

## 公卫功能验证

独立健康处方与减重均复用医疗 SDK `/api/handshake` 上下文和桌面拉起，通过独立公卫会话调入，生成走签名 `POST /v1/public-health/generations`。运行公卫/SDK/Bridge/签名相关 Vitest、`yarn type-check`、`yarn build`，Rust 运行 `cargo test --lib` 与 `cargo check`，覆盖医疗握手兼容、公卫扩展/Origin/缺失凭据拒绝和实际 WS 帧；合成/Fake 回归与真实模型、PHIS、医学验收分别报告。公卫本机调试入口和过程截图只保留本地，不随功能分支提交。


## 公卫患者正文提交验证（2026-10-20）

随访和减重客户端接收、编辑、确认、恢复和重传均不做正文风格、禁用词或内容关键词拦截；短运动、无编号、多句、长正文、内部说明及单位词须原样通过。独立 warnings 继续显示在医生区且不自动拼入确认正文。回归覆盖空章处理、三食谱选择、合并字段和失败重传；保留身份/映射/协议容量与真实保存回执校验。服务端拒绝须单独报告，不能凭客户端解除拦截认定上游生成成功。
