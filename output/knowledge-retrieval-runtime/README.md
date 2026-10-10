# 知识库生产组件浏览器预览

直接挂载生产 `features/knowledge/ui/KnowledgeBasePanel.vue`，使用生产主题样式。舞台默认引用生产 `WINDOW_SIZES.WORK`（378 × 449 逻辑像素），可切换为 720 × 600 的宽窗及深浅色。外置工具栏仅用于预览，不属于产品交互；舞台直接挂载组件，不包含 Tauri 窗口外壳。

从 `pcie` 目录运行：

```sh
yarn vite --config output/knowledge-retrieval-runtime/vite.config.ts
```

打开 `http://127.0.0.1:5189/`。此入口须由 Vite 提供，不能直接打开 `file://` 文件。关闭终端中的服务即可停止；已安装桌面客户端和其他服务不受影响。

该入口仅在自己的 Vite 配置中将 `regionalClient` 和 `pmphai` 替换为合成依赖。它不连接真实 PCIE Server、WeKnora、Tauri 或模型，不收集令牌，也不绕过生产请求签名。成功检索显示明确标记的合成原文、版本和 hash；输入“零命中”“失败”“内容变化”分别验证空结果、上游失败和内容变更提示。“人卫知识”显示未配置状态。关闭知识库后可重新打开。

真实 WeKnora 环境及本机启动方式见 `../../../pcie-server/deploy/weknora/README.md`。浏览器观察与截图仅证明生产组件渲染与交互；真实解析、检索、设备签名及医学资料审核分别验收。

2026-09-30：该入口已构建并在浏览器完成上述状态、关闭/重新打开、深浅色、宽窗和生产窄窗滚动检查。`yarn type-check` 与 `yarn build` 再次通过；预览服务保持运行，管理端链接指向已启动的真实本机 WeKnora。
