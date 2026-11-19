# 病历界面合成预览

从 PCIE 仓库运行 `yarn vite --config output/emr-design-review-20261117/vite.config.ts`，访问 `http://127.0.0.1:5191/`。

直接渲染生产 `InpatientEmrPage.vue` 与 `OutpatientEmrPage.vue`，仅在此入口替换生成控制器、HIS、语音与原生回执边界。页面数据、状态与回写行为均为内存合成示例，不连接任何真实患者、模型、HIS 或 PCIE Server。

顶部工具栏可切换两页、生成完成/生成中/失败/等待 HIS 回执/空态，以及 640/1024/1280 容器宽度。生产组件实时热更新；此预览只用于结构、样式和局部交互验证，不代表真实桌面/HIS 验收。


## 本轮审查与优化

本轮以当前白云分支的门诊模板页为参考，使用生产组件和合成资料截图。工作区同时存在其他未提交与并行更新，住院页已有的阅读 / 原始模板切换、折叠依据与生成控制器均予以保留；下列检查代表当前混合工作树。

- 对照 [住院优化前](screenshots/01-inpatient-before.jpg) 与 [门诊参考](screenshots/02-outpatient-reference.jpg)：页头和底栏已有接近结构，但住院主按钮被全局 `.primary-btn` 强制覆盖为绿色，正文编辑提示及弹窗仍有独立视觉规则。
- 门诊与住院共同使用 `src/shared/styles/workspace-page.css` 维护标题、页头 / 底栏、按钮与局部颜色令牌；住院辅助面板、补充弹窗和质控弹窗统一蓝白灰。去掉受全局旧类覆盖的按钮类，局部焦点变量同步为蓝色。
- 住院正文与模板里的 AI 草稿使用浅蓝虚线，医生修改使用实线，并提供编辑说明。回执状态移至底部操作附近，保留完整文字与换行。
- 窄窗使用容器查询，补充和门诊详情弹窗限定于工作区内并可滚动。历史门诊选择改为原生按钮，补充输入加可访问名称，动画尊重减少动态效果偏好。
- 从已安装的官方 Lucide 资产补齐本页用到但未注册的离线图标；不新增依赖、网络图标请求或供应商调用。

## 当前运行的验证步骤

| 步骤 | 结果 | 证据 |
| --- | --- | --- |
| 1. 两页结构与视觉对照 | 完成，统一标题、底栏、按钮、卡片和 AI 编辑语义 | [门诊参考](screenshots/02-outpatient-reference.jpg)、[住院优化后](screenshots/03-inpatient-after.jpg) |
| 2. 病历编辑及阅读 / 原始模板切换 | 通过，主诉编辑后往返两种视图仍为同一草稿，已编辑标识可见 | [模板中的医生修改](screenshots/04-template-edited.jpg) |
| 3. 生成中、失败、空态与等待回执 | 通过，生成中及 pending 禁用现有操作，失败保留可编辑草稿；pending 正文只读，未宣称 HIS 已保存 | [生成中](screenshots/08-generating-640.jpg)、[失败](screenshots/09-failure-640.jpg)、[空态](screenshots/10-empty-640.jpg)、[pending](screenshots/06-pending-640.jpg) |
| 4. 窄窗、补充弹窗与键盘焦点 | 通过，640 / 1024 / 1280 视口检查；640 工作区 scrollWidth=clientWidth=640，底栏底部 890px 位于 900px 视口内；只读主诉通过 Tab 聚焦时 aria-readonly=true，实际 outline 为 rgb(37,99,235) solid 3px | [640 正文](screenshots/07-ready-640-viewport.jpg)、[1024 正文](screenshots/11-ready-1024.jpg)、[640 补充弹窗](screenshots/05-supplement-640.jpg) |

- `yarn type-check`：通过，见 [类型日志](validation/type-check.log)。
- `yarn test:unit`：230 个文件、1663 项通过，见 [全量单测日志](validation/test-unit.log)。
- `yarn build`：通过，见 [构建日志](validation/build.log)。离线图标修复后重新执行类型检查与构建。
- `git diff --check`：通过。浏览器最终错误日志为空；临时视口设置已恢复。

本轮只验证浏览器生产组件与 Fake 状态。真实 Tauri、HIS/PHIS、真实模型和医学效果均未运行，不以截图、单测或构建代替；截图也不代表完整可访问性认证。本轮没有提交、推送或发布。
