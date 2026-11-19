# 住院病历可读性合成预览

仅复用生产 `InpatientEmrPage.vue` 与预览/过程组件；Vite alias 替换模型控制器、HIS、录音转写、日志补传和原生事件边界。无真实 AI、PCIE Server、HIS、麦克风请求，不新增依赖；所有资料显式为合成。

在 `pcie` 仓库运行：

```sh
yarn vite --config output/playwright/inpatient-readability/vite.config.ts
```

固定地址 `http://127.0.0.1:5197/`。可用状态：

- `/` 或 `/?state=ready`：完成生成，可编辑、切换模板、打开详情和补充要点。
- `/?state=generating`：已有部分正文、仍在生成，只读。
- `/?state=pending`：等待 HIS 回执，只读。
- `/?state=failed`：合成回填失败，可调整和重试。
- `/?state=success`：HIS 合成回填完成，只读。

建议浏览器尺寸 `1080×760` 和 `520×760`。点击“一键回写”只切换合成待回执状态。待回执时可在浏览器控制台注入合成回执：

```js
window.dispatchEvent(new CustomEvent('preview-feedback', { detail: {
  consultationId: 'SYN-ADMISSION-001', requestId: 'SYN-REQUEST-001', status: 'failed',
  message: 'HIS 合成回填失败，请调整后重试',
} }));
```

本目录与后续截图属于本地验证产物，不代表原生桌面、真实模型或 HIS 联调通过。
