# 全医慧助（PCIE）HIS JS SDK 使用文档

门诊动态模板接入先看 [病历模板上传与最终回写接口](../docs/his-outpatient-emr-template-integration.md)：`startVoice` 的唯一患者参数中必须包含 `outpatientEmr` 模板六字段；通过 WebSocket 接收最终字段表，由 HIS 回填、保存后再调用 `sendFeedback`。该说明附完整上传、回写及回执 JSON；下文普通接诊快速示例不代表已上传模板。

> PCIE — Primary Care Intelligent Expert。现有 SDK 继续使用 `MedHermes` / `MedHermesLoader` 全局对象和 `med-hermes-*` 文件名，以兼容已部署 HIS 页面。

## 文件说明

| 文件 | 部署方式 | 说明 |
|------|----------|------|
| `med-hermes-loader.js` | **HIS 本地部署** | 引导加载器，负责检测在线、协议拉起、CDN 加载。功能纯粹，极少更新 |
| `med-hermes-sdk.js` | **CDN 托管** | 完整 SDK，封装全部 API + WebSocket 事件订阅、断线重连与去重 |
| `med-hermes-sdk.d.ts` | 随 SDK 分发 | TypeScript 类型声明（可选） |

**推荐架构：** HIS 本地只部署 `loader.js`，SDK 从 CDN 加载。这样 loader 几乎不需要更新，SDK 通过 CDN 自动获取最新版本。

如果直接从桌面端本地 Bridge 加载 `/sdk/med-hermes-loader.js` 或 `/sdk/med-hermes-sdk.js`，Bridge 会返回 `no-store` 缓存头；Loader 自动推导本地 SDK 地址时，也会在 URL 后追加 `?v=<桌面端版本>`，避免升级安装包后 HIS 内嵌浏览器继续执行旧 SDK。

SDK 3.0 起，`/api/consultation/events/ws` 是唯一结果通道；已移除 `pollEvent()`、`startPolling()`、`stopPolling()` 以及 `pollInterval / eventTransport / autoPoll` 配置。旧接入应改用 `subscribe()` 消费 WebSocket 事件。

---

## 方式一：使用 Loader（推荐）

最省心的接入方式。Loader 自动完成：检测桌面端 → 协议拉起 → 加载 SDK → 初始化。

```html
<!-- HIS 本地部署的 loader，指向 CDN 上的 SDK -->
<script src="/local/med-hermes-loader.js"
        data-sdk-url="https://cdn.example.com/med-hermes-sdk.js">
</script>

<script>
  // 等待 SDK 就绪，拿到已初始化的 MedHermes 实例
  MedHermesLoader.ready(function(mh) {
    mh.on('draft', function(result) {
      document.getElementById('chief').value = result.chiefComplaint;
    });

    // 绑定按钮
    document.getElementById('btn-ai').onclick = function() {
      mh.startConsultation({
        idPi: '12345', naPi: '张三',
        sdSexText: '男性', ageText: '30岁'
      });
    };
  });

  // 错误处理
  MedHermesLoader.onError(function(err) {
    console.error('全医慧助加载失败:', err.message);
  });
</script>
```

### Loader 配置属性

通过 `<script>` 标签的 `data-*` 属性配置：

| 属性 | 默认值 | 说明 |
|------|--------|------|
| `data-sdk-url` | *(必填)* | CDN 上 SDK 的完整 URL |
| `data-auto-init` | `true` | 是否自动实例化并初始化 SDK |
| `data-bridge-url` | `http://127.0.0.1:8081/api` | 本地桥接地址 |
| `data-scheme` | `med-hermes` | 深度链接协议名 |

### Loader API

```js
// 注册就绪回调（SDK 加载 + 初始化完成后触发）
MedHermesLoader.ready(function(mh) { ... });

// 注册错误回调
MedHermesLoader.onError(function(err) { ... });

// 获取当前状态
MedHermesLoader.getStatus();
// → { online: true, sdkLoaded: true, instance: MedHermes }

// 手动 ping 检测
MedHermesLoader.ping().then(...);

// 手动触发协议拉起
MedHermesLoader.launch();

// 手动触发完整检测流程（检测 + 拉起 + 重试）
MedHermesLoader.detect().then(function(online) { ... });

// 兼容旧 HIS 工具封装：可直接通过 Loader 代理调用 SDK 方法
MedHermesLoader.startConsultation(patient);
MedHermesLoader.assist(patient, 'suggestedDx');
MedHermesLoader.startVoice(patient);
MedHermesLoader.interpretReport({ taskId: 'inspectReport', query: '...' });
MedHermesLoader.generateInpatientEmr({ admissionId, templateId, templateName, htmlContent });
MedHermesLoader.analyzeOutpatientEmr({ visitId, templateId, templateName, templateHtml, templateDefinition, targetFieldIds, recordContext, requestId });
```

如果 HIS 页面只加载了 `med-hermes-sdk.js`，SDK 也会兜底挂载一个轻量 `window.MedHermesLoader`，避免旧封装直接访问 `MedHermesLoader` 时抛出 `ReferenceError`。直接调用 `MedHermesLoader.startConsultation(...)` 时，门面会先懒加载初始化 SDK，再转发到内部 `MedHermes` 实例。

### Loader 内部流程

```
页面加载
  │
  ├─ DOMContentLoaded
  │
  ├─ 1. ping 桌面端 (GET /api/health)
  │     ├─ 在线 → 继续
  │     └─ 离线 → med-hermes://launch 拉起 → 等 4 秒 → 重试 (最多 2 次)
  │
  ├─ 2. 动态加载 CDN 上的 med-hermes-sdk.js
  │
  ├─ 3. new MedHermes() + init() 握手
  │
  └─ 4. MedHermesLoader.ready(fn) 回调触发
```

---

## 方式二：直接引入 SDK

如果不需要 loader 的自动检测和拉起能力，可直接引入 SDK：

```html
<script src="https://cdn.example.com/med-hermes-sdk.js"></script>
```

零依赖、单文件，通过 `<script>` 标签引入即可完成与本地全医慧助（PCIE）桌面端的全部对接；`MedHermes` 是兼容保留的 SDK 构造函数名。

## 快速开始（5 分钟接入）

### 1. 引入 SDK

```html
<script src="https://cdn.example.com/med-hermes-sdk.js"></script>
```

### 2. 初始化

```js
const mh = new MedHermes();

// 初始化：采集浏览器上下文（域名、Cookie 等），与桌面端握手
// 如果桌面端未启动，会自动尝试通过协议拉起
await mh.init();

// 调试模式：手动覆盖握手入参（例如联调页手动塞 emrAccessToken）
await mh.debugHandshake({
  extra: {
    emrAccessToken: 'debug-sdk-test-token'
  }
});
```

### 3. 启动问诊并订阅事件

```js
// 订阅统一事件流
const unsubscribe = mh.subscribe((envelope) => {
  console.log('event:', envelope.event && envelope.event.type, envelope);
});

// 监听病历草稿回写
mh.on('draft', (result) => {
  console.log('主诉:', result.chiefComplaint);
  console.log('现病史:', result.historyOfPresentIllness);
});

// 监听完整报告
mh.on('final-report', (result) => {
  console.log('诊断:', result.diagnosisList);
  console.log('用药:', result.medications);
});

// 监听错误
mh.on('error', (err) => {
  console.error('通信异常:', err.message);
});

// 启动完整问诊
mh.startConsultation({
  idPi: '766842939207974912',
  naPi: '张三',
  sdSexText: '男性',
  ageText: '30岁',
  department: '全科门诊'
});
```

完成！SDK 会在 `init()` / `debugHandshake()` 成功后维持一条长寿命 WebSocket 交互通道，并自动处理指数退避重连、`event.id` 补发和去重。HIS 内嵌浏览器必须支持 WebSocket，SDK 不提供 HTTP 长轮询结果通道。

---

## 三步渐进接入

### 第一步：基础问诊（最简接入）

```js
const mh = new MedHermes();
await mh.init();

mh.on('draft', (result) => {
  fillChiefComplaint(result.chiefComplaint);
  fillHPI(result.historyOfPresentIllness);
});

mh.on('final-report', (result) => {
  fillFullRecord(result);
});

function onPatientSelected(patient) {
  mh.startConsultation(patient);
}
```

### 第二步：灵活模式（AI 辅助）

```js
// 医生已录入部分病历，需要 AI 推荐诊断
function requestDiagnosis(patient) {
  mh.assist(patient, 'suggestedDx');
}

// 需要 AI 推荐用药
function requestMedication(patient) {
  mh.assist(patient, 'medication');
}

// 语音问诊
function startVoice(patient) {
  mh.startVoice(patient);
}

// 检验/检查报告解读
function interpretReport() {
  mh.interpretReport({
    taskId: 'inspectReport',
    query: '报告日期：2026-05-15\n检查项目：血常规\n检查结果：WBC 12.5×10^9/L，NEUT% 82%，CRP 36mg/L',
    patient: {
      naPi: '张三',
      sdSexText: '男性',
      ageText: '34岁'
    }
  });
}

// 语音批量回写（含完整 PHIS 字段）
mh.on('batch', (result) => {
  // result.medications 包含 dosage, frequency, route 等
  showConfirmDialog(result);
});
```

### 第三步：引用闭环（PHIS 回写）

```js
mh.on('reference-request', (result) => {
  // 全医慧助（PCIE）请求 PHIS 保存推荐项目
  const items = result.referenceItems;
  const requestId = result.requestId;

  // 调用 PHIS 保存
  saveToPhis(items)
    .then(() => {
      mh.sendFeedback(requestId, 'success', 'PHIS 已保存');
    })
    .catch((err) => {
      mh.sendFeedback(requestId, 'failed', err.message);
    });
});

mh.on('reference-feedback', (result) => {
  if (result.referenceStatus === 'success') {
    showToast('回写成功');
  } else {
    showToast('回写失败: ' + result.referenceMessage);
  }
});
```

---

## 完整 API 参考

### 构造函数

```js
const mh = new MedHermes(options?)
```

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | string | `http://127.0.0.1:8081/api` | 本地桥接地址 |
| `wsReconnectMs` | number | `1000` | WebSocket 首次重连等待时间；后续按指数增长 |
| `wsReconnectMaxMs` | number | `30000` | WebSocket 重连退避上限 |
| `scheme` | string | `med-hermes` | 深度链接协议名 |
| `launchRetryMs` | number | `3000` | 协议拉起后等待重连时间 |
| `timeout` | number | `5000` | HTTP 请求超时 |
| `extra` | object | `{}` | 自定义浏览器上下文扩展字段 |

### 方法

#### `init(extra?): Promise`

初始化 SDK。采集浏览器上下文（域名、Cookie、UA 等）并与桌面端握手。如果桌面端不在线，会自动通过 `med-hermes://` 协议尝试拉起。

```js
await mh.init({ hospitalCode: 'H001', userId: 'doc-123' });
```

#### `startConsultation(patient): Promise`

启动完整问诊。

```js
await mh.startConsultation({
  idPi: '12345',
  idVis: 'VIS-20260527-001',
  naPi: '张三',
  sdSexText: '男性',
  ageText: '30岁',
  department: '全科',
  allergyHistory: '青霉素过敏',
  chiefComplaint: '咳嗽三天',
  historyOfPresentIllness: '受凉后出现咳嗽、咳黄痰，无明显胸痛气促。',
  diagnosis: '急性支气管炎'
});
```

#### `assist(patient, action): Promise`

灵活模式，直接进入指定 AI 模块。

| action 值 | 说明 |
|-----------|------|
| `record` | 病历记录（生成主诉+现病史） |
| `suggestedDx` | 诊断推荐（新接入推荐使用；不要传 `diagnosis` 字段） |
| `diffDx` | 鉴别诊断（新接入推荐使用；直接打开“鉴别排查确认”小窗，需传当前 `diagnosis`） |
| `diagnosis` | 诊断推荐（历史兼容） |
| `differential` | 鉴别诊断（历史兼容） |
| `medication` | 用药方案 |
| `examination` | 检查推荐 |
| `lab_test` | 检验推荐 |
| `procedure` | 处置推荐 |
| `treatment_plan` | 诊疗方案聚合推荐 |
| `reminder` | 智能提醒 |

#### `prepareOutpatientEmrTemplate(source, options): VoiceOutpatientEmrTemplateInput`

同步封装 HIS 模板查询响应中的原始 Base64 `htmlContent / xmlContent`，返回可放入 `startVoice` 的双 data URI 六字段模板规格；SDK 与 HIS 不解码，由桌面端签名转发 PCIE Server 解码。`source` 可为成功响应或其 `data` 对象；`options` 必须明确提供 `targetFieldIds / requestId`。方法不发请求、不执行模板脚本；Base64 结构、响应码或大小无效时直接抛错，UTF-8/HTML/JSON 内容由服务端校验。完整调用示例与来源要求见 [模板查询响应适配](../docs/his-outpatient-emr-template-integration.md#interface-upload)。

#### `startVoice(patient?): Promise`

启动语音问诊。`patient` 可选，不传则沿用桌面端当前上下文。

若 HIS 已在医生站中选中门急诊动态模板，可在患者对象中附加严格的 `outpatientEmr` 模板规格；此模式必须同时传 `idVis`。语音事实就绪后在病历详情直接按模板生成和编辑，医生完成诊断、治疗与模板字段核对后，最终只产生一条合并 `record-confirmed`：

下例 `templateSnapshot` 由 HIS 当前编辑器导出，不是 SDK 自带对象。白云 HI-EMR 4.1.0 的实际组件路径、`getXmlContent()` / `getHtmlContent()` 用法和采集函数见 [模板获取说明](../docs/his-outpatient-emr-template-integration.md#hiemr41-capture)；不要把示意 getter 名当成该编辑器已有 API。

```js
await mh.startVoice({
  idPi: 'P001',
  idVis: 'VIS-20260831-001',
  naPi: '张三',
  sdSexText: '男性',
  ageText: '45岁',
  outpatientEmr: {
    templateId: templateSnapshot.templateId,
    templateName: templateSnapshot.templateName,
    templateHtml: templateSnapshot.templateHtml,
    templateDefinition: templateSnapshot.templateDefinition,
    targetFieldIds: templateSnapshot.targetFieldIds,
    requestId: 'outpatient-voice-550e8400-e29b-41d4-a716-446655440000'
  }
});
```

`outpatientEmr` 只接受上例六个字段；身份和目标字段 ID 不修剪、不去重，模板两份原文不会进入联调日志。独立 `analyzeOutpatientEmr()` 仍只处理模板字段，不合并诊断和医嘱。

#### `interpretReport(request): Promise`

触发检验/检查报告解读，结果以独立窗口展示，不进入问诊事件流。

```js
await mh.interpretReport({
  taskId: 'checkReport',
  query: '报告日期：2026-05-15\n检查项目：胸部CT\n阴阳性：阳性\n检查结果：双肺纹理增粗，右下肺见斑片状高密度影。\n影像诊断：考虑右下肺感染。',
  patient: {
    naPi: '张三',
    sdSexText: '男性',
    ageText: '34岁',
    chiefComplaint: '咳嗽发热3天'
  }
});
```

请求字段：

- `taskId`: `inspectReport` 或 `checkReport`
- `query`: 报告原始文本
- `patient`: 可选患者背景；若桌面端当前已有接诊患者，可不传，由桌面端自动补齐

#### `generateInpatientEmr(request): Promise`

触发住院病历辅助生成。桌面端会从悬浮球切换到住院病历生成界面；Promise 会在医生点击“一键回写”并产生 `record-confirmed` 时 resolve，返回值与 `record-confirmed` 事件 payload 一致。原有事件订阅模式仍可继续使用。

```js
const record = await mh.generateInpatientEmr({
  admissionId: '69660377a5e9230bbcdc850f',
  templateId: 'emr_tpl_daily_course',
  templateName: '日常病程记录',
  recordTime: '2026-06-10 15:25',
  doctorSupplement: '今日患者咳嗽较前减轻，无胸闷气促；继续当前治疗并复查血常规。',
  htmlContent: '<p data-id="病程记录"><span data-id="病程记录文本"></span></p>',
  contextPolicy: {
    maxDays: 7,
    previousNoteLimit: 3,
    includePreviousNotes: true,
    includeLongStaySummary: true,
    labLookbackDays: 14,
    orderLookbackDays: 7
  },
  hisContext: {
    vitals: {
      recordDateItems: [],
      latestBeforeRecordDate: {
        recordTime: '2026-06-08 14:00',
        temperature: 39.0,
        temperatureType: '口温',
        bloodPressureSystolic: 154,
        bloodPressureDiastolic: 96
      },
      summary: '本日体温单暂无记录；最近一次体温单记录为2026-06-08 14:00，体温39.0℃，血压154/96mmHg。'
    },
    orders: {
      summary: '目前予降压等治疗，长期医嘱执行中。'
    },
    previousRecords: {
      recentNotes: [
        {
          recordTime: '2026-06-09 16:00',
          recordType: '日常病程记录',
          summary: '患者病情总体平稳，继续原治疗方案。'
        }
      ]
    }
  },
  patient: {
    idPi: '6829c705ef56b10001b6f0b1',
    naPi: '林娜',
    sdSexText: '女性',
    ageText: '35岁'
  }
});

// record.fieldValues 仅包含适合 AI 生成的 data-id 字段
await writeBackToHis(record.fieldValues || {});
await mh.sendFeedback(record.requestId, 'success', 'HIS 已成功回填住院病历');
```

请求字段：

- `admissionId`: 患者单次住院登记主键，PHIS 对应 `idAdsn`
- `templateId`: 病历模板主键，后端模板缓存按该字段命中
- `templateName`: 模板名称
- `htmlContent`: 当前病历模板 HTML
- `recordTime`: 可选，本次病程记录书写时间；生成正文会以该日期作为“今日 / 本次查房日期”
- `contextPolicy`: 可选，住院上下文裁剪策略，避免长住院全量数据进入 AI 上下文
- `hisContext`: 可选，HIS 直接传入的 AI 上下文包；存在时桌面端优先使用，字段规范见 `docs/his-inpatient-emr-ai-context-integration.md`
- `requestId`: 可选；传入后也会作为一键回写的 `requestId`
- `patient`: 可选患者兜底信息

#### `analyzeOutpatientEmr(request): Promise`

按 HIS 当前选中的门急诊病历模板执行一次结构化分析。HIS 必须显式提供 `requestId`，SDK 不生成、不修剪请求身份，并等待医生点击“返回参数”后产生的完整 `record-confirmed`；只有 payload 自身的 `emrType + visitId + requestId + templateMetadata.templateId` 全部匹配时 Promise 才会 resolve。

```js
const record = await mh.analyzeOutpatientEmr({
  visitId: 'VIS-20260824-001',
  templateId: 'OPD-TPL-001',
  templateName: '门诊通用病历',
  // 同一模板的渲染实例与结构定义必须成对传入
  templateHtml: '<section data-id="article-personal" data-article="个人史" data-name="个人史"><div data-id="personalHistoryText" data-type="text" data-name="个人史内容" data-readonly="false">否认吸烟史。</div></section>',
  templateDefinition: '[{"ID":"article-personal","NAME":"个人史","ARTICLE":"个人史","eles":[{"ID":"personalHistoryText","NAME":"个人史内容","TYPE":"text","READONLY":false,"VALUE":"","TEXT":"否认吸烟史。","RECORD_FIELD":"personalHistory"}]}]',
  targetFieldIds: ['personalHistoryText'],
  requestId: 'outpatient-emr-550e8400-e29b-41d4-a716-446655440000',
  recordContext: {
    recordText: '主诉：咳嗽3天。',
    sections: {
      personalHistory: '既往吸烟20年，已戒烟2年。'
    }
  },
  patient: {
    idPi: 'P001',
    name: '张三',
    sdSexText: '男性',
    ageText: '45岁'
  }
});

// fieldValues 按模板 data-id 返回显示文本；dictionarySelections 给出字典 VALUE/TEXT 命中项
await writeBackToHis({
  templateMetadata: record.templateMetadata,
  fieldValues: record.fieldValues,
  dictionarySelections: record.dictionarySelections,
  outpatientRecord: record.outpatientRecord,
  writebackScope: record.writebackScope
});
await mh.sendFeedback(record.requestId, 'success', 'HIS 已成功回填门诊病历模板');
```

`recordContext` 必须只含严格 JSON 值；`undefined`、非有限数值、日期对象、函数、循环引用及其他非 JSON 对象直接拒绝，不经 JSON 序列化静默删键或转型。

门诊 `record-confirmed/cancelled` 业务订阅只接收自身身份及固定回参结构完整的 payload；不完整事件会报告协议错误，不会先交给订阅回调再由 Promise 拒绝。

`visitId / templateId / templateName / templateHtml / templateDefinition / targetFieldIds / recordContext / requestId` 必填，`patient` 可选；请求及 `patient` 只接受文档化字段。`templateHtml` 是模板自带渲染器输出的当前实例，`templateDefinition` 是同一模板的顶层章节 JSON 定义，二者必须同时提供，旧 `htmlContent / templateSource / sourceFormat` 不再接受。SDK 不按文件名判断，也不把二者当作可选格式。解析器按章节 `ID + ARTICLE` 和字段 `ID` 严格配对；字段所属章节由最近的 `data-article` 祖先确定，所有非 `TYPE=import` 字段的类型、名称、只读状态、所属章节和当前显示值必须一致，渲染章节名与定义章节名可不同并分别保留。字典只读取定义中的 `BINDINGDATA[].VALUE/TEXT`，HTML 字典属性不再作为输入；`VALUE/TEXT` 归一化后同时为空的首项仅作为“请选择”占位排除，其余字典项仍严格禁止首尾空白。`targetFieldIds` 必须由 HIS 渲染器执行联动规则后生成，且至少包含一个当前实际显示、可写并需要 AI 分析的字段；全医慧助不执行模板脚本或扩充范围。模板当前字典选择不会成为本次结果；模型必须逐个返回生效字典字段，漏 key 时本次分析失败，显式空字符串或无法匹配时留空让医生选择。相同 `requestId` 只有在 `visitId / templateId / templateName / 原始 templateHtml / 原始 templateDefinition / targetFieldIds 集合 / patient / recordContext` 全部相同时才复用同一 Promise；任一输入变化都以 `REQUEST_ID_CONFLICT` 拒绝。模板对 hash 计算方式和完整字段约束见项目 `api.md` 6.3C。确认/取消 payload 必须自身身份和固定回参结构完整，SDK 不从事件外层补齐。

同一模板的 HTML/定义原文和 `recordContext` 只通过本地 HTTP body 发送。离线兜底仅使用无参数 `med-hermes://launch` 拉起桌面端，不会把临床内容写入协议 URL。

#### `stop(): Promise`

结束当前接诊，清空上下文。

#### `sendRisks(patient, risks?): Promise`

推送患者风险信息。`risks` 为空时由 AI 自动分析。

#### `sendFeedback(requestId, status, message?, items?): Promise`

发送 PHIS 引用回执。每收到一条 `reference-request` 或等待闭环中的 `record-confirmed`，都应调用此方法回执。
SDK 会优先使用最近一次事件的 `consultationId` 回执；如果当前患者传入了 `idVis / visitId`，该值会作为结果/回执锚点。

检验检查互认命中时，先发送中间态：

```js
await mh.sendFeedback(
  requestId,
  'pending',
  '存在可互认的检验检查项目，请医生在智医端决策',
  recognizableItems
);
```

随后监听同一 `requestId` 的 `reference-request`，读取 `recognitionDecision.decision` 和可选的 `recognizedItemIds`。完成保存后再次调用 `sendFeedback` 返回最终 `success`、`failed` 或 `cancelled`。`pending` 不是最终回执。

#### `ping(): Promise`

检测桌面端桥接服务是否在线，不会执行授权握手。

#### `subscribe(listener): () => void`

订阅统一事件流。底层 WebSocket 交互通道在 `init()` / `debugHandshake()` 成功后常驻，`subscribe()` 声明当前页面消费该通道上的事件。断线后 SDK 先重新握手，再按最高 30 秒的指数退避重建 WebSocket；返回取消订阅函数。

```js
const unsubscribe = mh.subscribe((envelope) => {
  if (envelope.event?.type === 'reference-request') {
    console.log('收到引用请求');
  }
});

unsubscribe();
```

#### `destroy()`

销毁实例，清理定时器和事件监听。页面卸载前建议调用。

### 事件

| 事件名 | 回调参数 | 说明 |
|--------|----------|------|
| `event` | `envelope` | 收到最新事件快照 envelope，适合统一分发处理 |
| `draft` | `result` | 收到病历草稿回写 |
| `record-confirmed` | `result` | 收到最终确认回写事件 payload |
| `final-report` | `result` | 收到完整问诊报告 |
| `batch` | `result` | 收到语音问诊批量回写 |
| `reference-request` | `result` | 收到引用请求或检验检查互认决策，需 PHIS 保存并回执 |
| `reference-feedback` | `result` | 收到引用回执确认 |
| `connected` | `info` | 与桌面端握手成功 |
| `disconnected` | - | 连接断开 |
| `launching` | - | 正在通过协议拉起桌面端 |
| `launch-failed` | - | 协议拉起失败 |
| `error` | `err` | 通信异常 |
| `subscription-start` | - | 页面开始消费 WebSocket 事件 |
| `subscription-stop` | - | 页面停止消费 WebSocket 事件；持久连接仍可供后续业务复用 |

`record-confirmed` 中的固定既往史、个人史、家族史正文保持兼容自然文本。若本次明确上下文把模板槽位从“否认”改为“有”，payload 会额外携带 `recordTemplateChanges`；PHIS 应按 `field + slotKey` 精确更新对应值，未选择回写的字段不会进入该清单。旧版接入可忽略该可选对象并继续读取原病历字段。

女性患者在本次对话或 HIS 既有病历中存在明确月经史时，`record-confirmed` 可额外携带 `menstrualHistory`，并在 `outpatientRecord.menstrualHistory` 中保持相同内容。该字段独立于个人史；男性患者、无明确内容或医生未选择该字段时均省略，PHIS 应保持原值。

---

## 浏览器上下文

SDK 初始化时会自动采集以下浏览器信息并传递给桌面端：

| 字段 | 说明 |
|------|------|
| `origin` | 当前域名，如 `https://his.hospital.com` |
| `href` | 完整 URL |
| `cookie` | 当前页面 Cookie（桌面端可借此调用 HIS 后端服务） |
| `userAgent` | 浏览器 UA |
| `timestamp` | 初始化时间戳 |
| `extra` | 自定义扩展字段（通过构造参数或 `init()` 传入） |

桌面端可利用 Cookie 和域名信息调用 HIS 同域后端服务，实现"借用浏览器登录态"的能力。

---

## 离线拉起

当全医慧助（PCIE）桌面端未启动时，SDK 会自动通过兼容保留的 `med-hermes://` 协议尝试拉起：

1. 首先尝试 HTTP 调用
2. 如果失败（桌面端离线），触发 `launching` 事件
3. 通过隐藏 iframe 触发协议拉起
4. 等待 3 秒后重试 HTTP
5. 成功则触发 `connected`，失败则触发 `launch-failed`

```js
mh.on('launching', () => {
  showLoading('正在启动全医慧助...');
});

mh.on('launch-failed', () => {
  showAlert('请手动启动全医慧助桌面端');
});
```

---

## 常见问题

### Q: 调用接口报 CORS 或 401 错误？

SDK 通过 `fetch` 调用本地 `127.0.0.1:8081`，请确认全医慧助（PCIE）桌面端已启动，并且已经成功执行 `init()` / `debugHandshake()`。如果返回 401，通常是尚未握手或握手缺少有效的 `extra.emrAccessToken`。

### Q: 桌面端退出后 SDK 如何重连？

WebSocket 断开后，SDK 会先重新握手，再按 `1/2/4/8/16/30 秒`上限指数退避。桌面端恢复后，SDK 携带最后消费的 `event.id` 重建 WebSocket 并接收内存队列中的未消费事件；不会启动 HTTP 长轮询。

### Q: 如何在 Vue/React 中使用？

```js
// Vue 3 示例
import MedHermes from './med-hermes-sdk.js';

const mh = new MedHermes();

onMounted(async () => {
  await mh.init();
  mh.on('draft', handleDraft);
});

onUnmounted(() => {
  mh.destroy();
});
```

### Q: 如何切换患者？

切换患者时建议先调用 `stop()` 结束当前接诊，再启动新的问诊：

```js
await mh.stop();
await mh.startConsultation(newPatient);
```
