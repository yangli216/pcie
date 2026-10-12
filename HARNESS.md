# PCIE 桌面项目 Harness

继承工作区与本项目AGENTS.md；架构、产品和接口以ARCHITECTURE.md、PRODUCT.md、api.md为准，定位以CODE_MAP.md为准。

1. 先检查工作树并保留用户修改，读取真实调用和受影响模块规则。
2. 文档/契约先更新，再实现生产代码和Vitest测试；跨仓任务使用development-harness/HARNESS.md。
3. 默认执行yarn type-check、yarn test:unit、yarn build；Rust变化补cargo check。真实Tauri运行、HIS/PHIS和第三方服务验收与合成测试分别报告。

## 机构知识检索

按[知识服务设计](../development-harness/KNOWLEDGE_BASE_DESIGN.md)和机器契约实现；API经regionalClient签名，UI/控制器进入features/knowledge。执行knowledgeRetrieval、useInstitutionKnowledgeController与InstitutionKnowledgePanel测试及默认构建。机构、文档批准和版本由后端确定，不把DRAFT/示例数据当可用医学知识，不新增供应商密钥或自动聊天/公卫注入。

浏览器组件预览从本仓库运行 `yarn vite --config output/knowledge-retrieval-runtime/vite.config.ts`，默认 `http://127.0.0.1:5189/`。入口直接复用生产知识库组件和主题，开发配置仅替换服务依赖为合成响应；不连接 PCIE Server、WeKnora 或 Tauri，不把预览当真实联调。交互、主题和窄窗验证见该目录 README。

## 公卫功能验证

独立健康处方与减重均从 PHIS 配对 Bridge 调入，生成走签名 `POST /v1/public-health/generations`。运行公卫/SDK/Bridge/签名相关 Vitest、`yarn type-check`、`yarn build`，Rust 运行 `cargo test --lib public_health` 与 `cargo check`；合成/Fake 回归与真实模型、PHIS、医学验收分别报告。公卫本机调试入口和过程截图只保留本地，不随功能分支提交。
