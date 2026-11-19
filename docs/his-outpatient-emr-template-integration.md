# HIS 接入接口：病历模板上传与最终回写

本文面向 HIS / PHIS 开发者，按实际接线顺序说明两个业务接口：**把当前病历模板传给 PCIE；接收医生确认后的病历结果，写入并保存到 HIS。**

| 接入点 | 方向与地址 | 开发者要实现什么 |
| --- | --- | --- |
| **接口一：上传病历模板并发起任务** | HIS → PCIE；语音接诊用 `POST /api/consultation/start-voice`；已有病例事实单独解析用 `POST /api/outpatient/emr/analyze` | 传同一时刻的 HTML 实例、JSON 定义字符串、目标字段 ID、就诊与请求身份 |
| **接口二：接收最终病历并回写** | PCIE → HIS；`GET /api/consultation/events/ws` 升级为 WebSocket，接收 `record-confirmed` | 按稳定字段 ID 通用匹配，回填当前编辑器，调用 HIS 自身保存接口 |
| 回写完成回执，属于接口二的收尾 | HIS → PCIE；`POST /api/consultation/reference-feedback` | HIS 保存确定成功后报 `success`；确定失败报 `failed` |

本机服务基址为 `http://127.0.0.1:8081`，JSON 请求使用 `Content-Type: application/json; charset=utf-8`。下文所有接口均由医生本机 PCIE 提供，HIS 无需调用 PCIE Server 的 `/v1/*`。

```text
HIS 当前模板 ──接口一上传──> PCIE 接诊 / 分析 ──医生确认──>
  ──接口二推送结果──> HIS 按 ID 回填 + 自身保存 ──回执──> PCIE 显示完成
```

**HTTP 受理成功、收到回写事件、HIS 保存成功是三个不同状态。** 当前协议没有独立的“只上传模板”接口，也没有 PCIE 主动 POST 到 HIS 保存 URL 的回调配置；模板随任务一起上传，最终结果通过 WebSocket 返回，保存由 HIS 完成。

先完成 [SDK 初始化](#integration-bootstrap)，并在发起任务前注册结果订阅。包内所有患者、就诊、模板和结果样例均为合成数据。

<a id="interface-upload"></a>
## 接口一：病历模板上传

### 1.1 语音接诊：随 start-voice 一起上传

| 项目 | 说明 |
| --- | --- |
| Method / URL | `POST http://127.0.0.1:8081/api/consultation/start-voice` |
| SDK | `await mh.startVoice(patientWithTemplate)` |
| 调用时机 | HIS 已打开本次就诊，模板已渲染并执行完性别、年龄及原生联动；开始 PCIE 语音接诊时 |
| 模板位置 | 请求体的 `outpatientEmr` 对象 |
| 返回含义 | 受理并打开 PCIE；最终病历等待接口二 |
| 完整报文 | [语音模板上传请求](examples/outpatient-emr/voice-upload.request.json)、[受理响应](examples/outpatient-emr/voice-upload.response.json) |

`patientWithTemplate` 的字段：

| 字段 | 类型 | 要求 |
| --- | --- | --- |
| `idPi` | string | 当前患者 ID |
| `idVis` | string | **本次就诊 ID，动态模板模式必须传入** |
| `naPi / sdSexText / ageText` | string | 患者姓名、性别文本、年龄文本，沿用患者协议 |
| `outpatientEmr.templateId` | string | HIS 当前选中模板的稳定 ID |
| `outpatientEmr.templateName` | string | 当前模板名称 |
| `outpatientEmr.templateHtml` | string | 正式渲染器当前 HTML 原文，或下文明确的 Base64 传输封装 |
| `outpatientEmr.templateDefinition` | string | 同一时刻的章节 JSON 定义字符串，或配套的 Base64 传输封装 |
| `outpatientEmr.targetFieldIds` | string[] | 当前实际可见、可写、允许 AI 填写的字段白名单；至少一项，无重复、空值或首尾空白 |
| `outpatientEmr.requestId` | string | HIS 为这次任务生成的唯一 ID；完整任务及回执沿用 |

HIS 模板查询若返回 `{ code: 200, data: { idTep, tepName, htmlContent, xmlContent } }`，其中两份内容是 Base64 UTF-8，可先调用：

```js
const outpatientEmr = mh.prepareOutpatientEmrTemplate(templateResponse, {
  targetFieldIds: visibleWritableFieldIds, // HIS 当前渲染器明确提供
  requestId: currentRequestId,
});
await mh.startVoice({ ...patient, idVis: currentVisitId, outpatientEmr });
```

该方法也接受 `data` 本身，仅将 HIS 原始 Base64 内容封装为 `templateHtml="data:text/html;charset=utf-8;base64,..."` 与 `templateDefinition="data:application/json;charset=utf-8;base64,..."`，使用 `idTep/tepName` 作为模板身份；SDK 和 HIS 均不解码、不推断字段。桌面端把这一明确的双编码源通过带设备令牌和 ECDSA P-256 签名的 `POST /v1/client/outpatient-emr/templates/decode` 转发 PCIE Server，由服务端严格 Base64/UTF-8 解码；失败立即停止，不以旧格式或本地解码兜底。成功后按解码原文计算既有模板对 hash、校验字段、展示和生成；快照登记仍发送编码源，服务端按相同规则解码后校验 hash 和保存。已在 HIS 正式渲染器获取到解码原文的既有六字段调用保持有效。编码只接受上述两个完整前缀且必须成对，禁止单侧封装或其他 data URI。

Base64 是可逆编码，不是加密。桌面端必须取得解码后的模板才能显示；解码响应也需要传输。远端传输保密依赖 HTTPS，ECDSA 签名保证身份与完整性，不能替代 TLS。本功能不改变部署 TLS 配置，也不把 HTTP 上的 Base64 表述为安全传输。两份源解码后各最多 1 MiB；本地两类门诊入口按独立 4 MiB JSON 请求上限接收 Base64 膨胀后的载荷（仍受总正文限制），不扩大其他 Bridge 入口。普通语音问诊在紧凑窗口内录音和核对转写，进入主界面后沿用原有的分段病历详情。PCIE 在后台解析模板。首次语音分析按原始控件 ID 给出本次病例有依据的填空值。PCIE 按源章固定句式、单位与这些值组成正文并展示 AI 标注。无依据的控件可以留空，已有模板默认项保留供医生核对。章节从生成到确认都沿用源章节 ID、名称及顺序。医生在原病历编辑器中分别核对同名、自定义及映射到同一标准段的不同章节。HIS 按返回的标准段落和字段 ID 接收本次选择的正文与模板值。模板字段以首轮生成值及后续医生修订为准。仅实际可写且在本次 targetFieldIds 中的源字段可回填；兼容绑定与源字段 ID 相同也遵守此范围。

同次就诊中，动态模板分析使用当前已选诊断、医嘱及其完整开立明细。医生对模板字段的修订（含清空字段及模板自定义段）会连同原有病例进入下一轮分析、重试或补充重生成。字段未填、字典值待选或存在冲突时，其余已编辑内容仍作为来源提交给模型；HIS 最终回写须由医生在原确认流程完成。本地未提交的语音结果与编辑快照按当前机构、租户、患者及就诊恢复；旧缓存只有在已有身份信息能对应本次患者时可复用。整段语音转写返回空文本时，保留分段草稿及先前核对文字，供医生查看、修改或确认后用于生成。

`outpatientEmr` 必须且只能包含上表六个模板字段；身份字符串不得带首尾空白。两份模板原文各自最多 1 MiB（UTF-8）。不要把整个定义对象直接传入 `templateDefinition`，也不要把模板放在 `startVoice` 的第二个参数。

```js
// currentVisit/currentPatient 来自 HIS 当前就诊。
// snapshot 来自 HIS 正式模板渲染器，不是 PCIE 提供的函数。
const snapshot = await his.captureCurrentTemplate();
const request = {
  idPi: currentPatient.id,
  idVis: currentVisit.id,
  naPi: currentPatient.name,
  sdSexText: currentPatient.sexText,
  ageText: currentPatient.ageText,
  outpatientEmr: {
    templateId: snapshot.templateId,
    templateName: snapshot.templateName,
    templateHtml: snapshot.renderedHtml,
    templateDefinition: snapshot.definitionJsonText,
    targetFieldIds: snapshot.visibleWritableAiFieldIds,
    requestId: his.createTemplateRequestId()
  }
};

// HIS 在发请求前持久保存 requestId → 当前病历 ID、原始模板、
// 就诊 ID、模板 hash、编辑器版本；这些本地关联字段不加到请求体。
await his.registerPendingTemplateTask(request);
const accepted = await mh.startVoice(request);
console.log(accepted.status); // 这里只表示受理，不能提示“病历已保存”
```

HTTP 200 受理响应示例：

```json
{
  "status": "success",
  "consultationId": "SIM-PATIENT-001",
  "traceId": "his-sim-voice-upload-001"
}
```

注意：当前 `start-voice` 的受理响应 `consultationId` 使用患者 ID；**动态模板最终结果及回执的 `consultationId = visitId = 本次 idVis`**。回执必须取最终结果中的身份，不能照抄受理响应。

排查是否真正上传：在 PCIE 的 HIS 联调日志中，`consultation.startVoice` 请求应显示 `hasOutpatientEmr=true`，`targetFieldCount>0`，`templateHtmlBytes>0`、`templateDefinitionBytes>0`。若这些为 false / 0，说明本次请求没有携带模板，接诊窗口能打开也不能证明新模板链路已接通。

### 1.2 已有对话或病历事实：上传模板并单独解析

如果 HIS 已有病例事实，直接使用以下入口；无需先启动语音，也无需与 1.1 连续调用。两个入口任选一个发起同一任务。

| 项目 | 说明 |
| --- | --- |
| Method / URL | `POST http://127.0.0.1:8081/api/outpatient/emr/analyze` |
| SDK | `mh.analyzeOutpatientEmr(request)` |
| 请求 | 模板六字段放顶层，另外传 `visitId + recordContext`；可选 `patient` |
| 受理 / 最终结果 | 直接 HTTP 返回受理；SDK Promise 等医生确认后返回最终 payload，同一结果也经接口二推送 |
| 完整报文 | [独立模板分析请求](examples/outpatient-emr/analyze.request.json)、[受理响应](examples/outpatient-emr/analyze.response.json)、[独立确认结果](examples/outpatient-emr/result.example.json) |

```js
const snapshot = await his.captureCurrentTemplate();
const request = {
  visitId: currentVisit.id,
  templateId: snapshot.templateId,
  templateName: snapshot.templateName,
  templateHtml: snapshot.renderedHtml,
  templateDefinition: snapshot.definitionJsonText,
  targetFieldIds: snapshot.visibleWritableAiFieldIds,
  recordContext: {
    conversationText: "医生：哪里不舒服？患者：咳嗽3天。医生：吸烟吗？患者：以前吸烟20年，2年前戒了。"
  },
  patient: {
    idPi: currentPatient.id,
    name: currentPatient.name,
    sdSexText: currentPatient.sexText,
    ageText: currentPatient.ageText
  },
  requestId: his.createTemplateRequestId()
};
await his.registerPendingTemplateTask(request);
const confirmed = await mh.analyzeOutpatientEmr(request);
// 此处可更新状态；保存统一在接口二的常驻订阅中做，避免同一结果保存两次。
```

`recordContext` 是至少包含一项非空临床事实的严格 JSON 对象，可用 `recordText / conversationText / sections / structuredFacts`；不接受函数、undefined、Date、非有限数值或循环对象。可选 `patient` 只允许 `idPi / name / sdSexText / ageText`。患者姓名、患者 ID、就诊 ID 不进入模型消息。

独立请求不接受 `recordId / idMedrecdoc / htmlContent / templateSource / sourceFormat`。HIS 自行保留 `requestId → 病历记录 ID`，不要往请求体添加未定义的字段。

`his.createTemplateRequestId()` 由 HIS 实现，可由后端生成 UUID 或等价唯一 ID。输入不变的失败重提沿用原任务；模板、目标或病例事实改变时创建新 requestId，不能用同一个 ID 覆盖不同输入。

独立入口的 HTTP 200 示例：

```json
{
  "status": "success",
  "visitId": "SIM-VISIT-001",
  "requestId": "SIM-REQUEST-001",
  "traceId": "his-sim-analyze-001",
  "timestamp": 1794355200000
}
```

### 1.3 HTML 与 JSON 如何配对

| HTML 渲染实例 | JSON 定义 | 用途 |
| --- | --- | --- |
| 章节 `data-id` | 章节 `ID` | 配对章节 |
| 章节 `data-article` | 章节 `ARTICLE` | 核对章节语义 |
| 字段 `data-id` | 章节 `eles[].ID` | 配对字段，也是最终回写 key |
| `data-type / data-name / data-readonly` | `TYPE / NAME / READONLY` | 类型、名称与只读属性 |
| 当前显示值 | `VALUE / TEXT` | 核对同一渲染快照的当前状态 |
| 选择控件 | `BINDINGDATA[{VALUE,TEXT}]` | 合法字典编码和显示文字 |

最小完整模板见 [template.html](examples/outpatient-emr/template.html) 和 [template.json](examples/outpatient-emr/template.json)。字典由 JSON 的 `BINDINGDATA` 提供。PCIE 逐项核对请求中的目标。可见、可写、两份来源配对唯一且映射明确的字段进入医生编辑与确认。单字段失配时，其余目标继续分析；可见临床原文和差异原因随 templateSourceNotes 提供给模型。隐藏值、行政身份与字典预设受原权限边界约束。

**每次发起任务都传完整当前模板对。** PCIE 自动按机构、模板 ID 和模板对 hash 查询 / 登记解析快照；HIS 不需要另写上传快照或判断历史命中的调用。命中快照后仍按本次病例分析，不复用其他患者的病历结果。

回填校验使用的 hash 算法如下：两份原文分别按 UTF-8 做 SHA-256，得到小写十六进制，再拼接并哈希：

```text
templateHash = SHA256("outpatient-emr-template-pair.v1:" + SHA256(templateHtml) + ":" + SHA256(templateDefinition))
```

实现见 [calculateTemplateHash](examples/outpatient-emr/integration.example.mjs)。必须保留发送时的原文，不能在回填前重新序列化定义来代替它；HTTP 内网页面如无 Web Crypto，可由 HIS 后端或等价 SHA-256 库计算同样的值。

<a id="hiemr41-capture"></a>
### 1.4 白云 HIS 的 HI-EMR 4.1.0：从哪里取模板

下列路径根据该 HIS 当前部署的静态脚本核对，只适用于这个编辑器版本。它把病历包在三层 Vue 组件中：HIS 的 `EMR` 引用 → `OUTPATIENT` 门诊容器 → `record` 编辑器组件。

```js
const emrRoot = $env.doctorStationContext.EMRView.vue.$refs.EMR;
const outpatient = emrRoot.$refs.OUTPATIENT;
const recordVm = outpatient.$refs.record;
const editor = recordVm.getCurrentEditor();

// 先同步并序列化模型，再取同一实例的 HTML；不调用 HIS 保存或签名。
const templateDefinition = recordVm.getXmlContent();
const templateHtml = recordVm.getHtmlContent();
const templateId = recordVm.record.idTep;
const templateName = recordVm.record.naTep || recordVm.record.naMed || templateId;
```

关键区别：`getXmlContent()` 虽然叫 Xml，当前源码实际返回 `JSON.stringify(editor.vmodel)`，就是接口要求的 JSON 定义字符串；`getHtmlContent()` 从当前 `editor.getContent()` 导出 HTML。`recordVm.record.xmlContent / htmlContent` 是加载记录携带的数据，不能代替医生当前编辑后的快照。

**`getRenderedHtml / getMedHtml / getTemplateDefinitionJson / getTemplateJson` 均不是这个版本根组件提供的方法。** 不应通过尝试这几个方法、失败后返回 null 来决定是否上传模板；它会使已显示的病历仍以“不带模板”发起接诊。SDK 本身只负责传输，没有通用的 HIS 模板读取方法。

获取时机：当前病历加载完成、`recordVm` 与 `myEditor` 就绪，当前输入已提交到编辑器且 HIS 原生联动完成。`getXmlContent()` 内部触发编辑器的 `beforesavedata` 序列化事件，不是数据库保存；不要为获取模板调用 `omrMedSave()`、签名或诊毕。

目标字段仍使用 JSON 的 `eles[].ID` 与当前 `editor.document` 中的 `data-id` 精确匹配，再结合实际显隐、只读状态和 HIS 的 AI 字段策略过滤；不能用 `getRefElementListCustom()` 返回的 `naEle` 字段名兜底。也不能只过滤 JSON 的 HIDDEN，而不看当前渲染状态。

可复用采集函数见 [hiemr41-template-snapshot.example.mjs](examples/outpatient-emr/hiemr41-template-snapshot.example.mjs)。它使用上述真实路径和方法；`allowedAiFieldIds` 是 HIS 明确允许 AI 填写的当前模板字段 ID 列表，由 HIS 统一字段策略提供，函数再与当前可见可写控件求交集。该参数没有默认“全选”，不包括姓名、证件号、签署等系统字段。函数只采集，不请求 PCIE、不回填、不保存。

上述路径已在当前 HIS 页面通过控制台实际取数：`getXmlContent()` 后接 `getHtmlContent()` 得到 HTML 44,580 字节、章节 JSON 52,082 字节，包含 11 个章节、66 个字段。PCIE 生产严格解析器已通过这份实际模板对，结构检查使用了 54 个当前可见可写候选；这些候选仍需经 HIS 系统字段策略过滤，不能直接视为正式 AI 白名单。

同一页面直接读取 `editor.body.innerHTML` 的对照未通过配对，报“主诉文本的 HTML 当前值与结构定义 TEXT 不一致”。因此本版本必须使用上述编辑器序列化方法，不用 iframe 原始 innerHTML 替代。当前证据覆盖取数和本地结构解析，真实模板上传、AI 分析和回写仍须分别联调。

<a id="phis-backend-template-pair"></a>
### 1.5 PHIS 后端 getMedcontentHTMLAndXML 能否作为来源

HIS 的 `AiAdapterService.getMedcontentHTMLAndXML(Map request)` 可作为模板对查询的候选来源。沿用当前适配服务名时，入口为 `POST /api/phis.aiAdapterService/getMedcontentHTMLAndXML`；RPC 方法只有一个 Map 参数，HTTP 请求体使用 `[requestMap]`，复用 HIS 现有有效登录态。请求体内部必填键与返回包裹仍须按该方法下游实现核对，不能只由方法名推断。

在 HIS 模块内，可沿用现有 RPC 请求器：

```js
// requestMap 按 getMedcontentHTMLAndXML 下游契约组装；不是患者信息对象。
const response = await this.miniJsonRequestAsync({
  serviceId: "phis.aiAdapterService",
  serviceAction: "getMedcontentHTMLAndXML",
  body: [requestMap]
});
```

本项目已有 `getMedContentLook` 调用使用 `idApp="42" / idTet / idMedrecdoc / courseShow=0`，可作为首轮核参参考，**不表示新方法已确认使用完全相同参数**。目前提供的转发实现实际调用 `otms.rpcPhisService.getMedcontentHTMLAndXML`，与其注解中提到的 `rpcEmrEditorLookService.getMedContentLook` 不同，应以下游真实实现和成功响应为准。

当前已使用浏览器 HIS 登录态通过上述 RPC 请求器实测，新方法的复现请求如下；占位值由当前文书与租户取出，此报文是本次失败的复现输入，不是已确认的新方法完整参数契约：

```json
[
  {
    "idApp": "42",
    "idMedrecdoc": "当前文书ID",
    "courseShow": 0,
    "idTet": "当前租户ID"
  }
]
```

实际响应：

```json
{
  "code": 200,
  "msg": "Success",
  "body": {
    "code": 400,
    "count": 0,
    "message": "未找到该病历"
  }
}
```

同一就诊 / 文书的对照结果：

| 方法 | 本次业务结果 | 可用模板内容 |
| --- | --- | --- |
| `getMedcontentHTMLAndXML` | `body.code=400`，未找到该病历 | 未取得模板对 |
| `getMedContentLook` | `body.code=200`，返回的文书 ID 匹配 | `htmlContent` 为空，未返回 `xmlContent`，不能只凭 200 当作成功取数 |
| `getLookMedList` | `body.code=200` | 当前就诊返回空列表 |
| 当前编辑器序列化 | 本地严格配对通过 | 取得上述完整 HTML 与章节 JSON |

这说明本次后端查询没有取得当前可用文书，不能替代当前编辑器快照；是否属于未保存文书、或新方法还需要其他参数 / 查询条件，仍需核对下游实现。不要为验证查询而自动保存、签名或诊毕。

拿到成功响应后，再明确以下映射及边界：

| 核对项 | 传给 PCIE 前的要求 |
| --- | --- |
| HTML 正文字段，例如 `htmlContent` | 原文映射为 `templateHtml`，保留稳定 `data-id / data-article / data-type` 等结构；打印文本或丢失控件属性的浏览 HTML 不能直接代替 |
| 结构定义字段，例如 `xmlContent` | 若为章节 JSON 字符串，映射为 `templateDefinition`；若是实际 XML，不能直接传入当前 JSON 协议 |
| 文书与模板身份 | 核对所查询文书属于当前就诊及模板；HIS 侧保留文书 ID 关联，PCIE 上传体不增加 `idMedrecdoc` |
| 保存状态 | 后端返回是否包含未保存编辑、是否包含本次联动结果，必须实测；数据库内容不能默认等于当前页面快照 |
| 新建病历 | 无文书 ID 时能否按模板 ID 查询，由下游契约确认；不为取模板自动保存或签名 |
| `targetFieldIds` | 仍由 HIS 当前渲染状态和 AI 字段策略生成，使用真实 ID，不从字段名猜测或默认全选 |

**改用后端查询时，异步必须贯穿现有调用链。** 当前 HIS 中 `getPcieEmrSnapshot()`、`buildOutpatientEmrSpec()` 和 `MedHermesLoader.ready(...)` 内发起 `startVoice` 的代码是同步取值；须依次等待快照、规格和请求组装完成。只把 getter 改成返回 Promise，而上层没有 await，会再次得到空模板。

无论使用编辑器快照还是经过验证的后端模板对，最终仍按 1.1 / 1.2 上传同一格式，按接口二接收并保存回写。后端查询不会自动接通模板上传或病历回写。

验证状态：登录态 RPC 调用与上述业务响应已实际核对，已排除“只是没有使用登录态”的问题；后端模板对读取尚未通过。当前页的编辑器取数与本地严格解析已通过。后端成功取数、保存 / 未保存版本对照、真实上传与回写的验收仍分别保留。

<a id="interface-writeback"></a>
## 接口二：接收最终病历、回填并保存

### 2.1 订阅结果接口

| 项目 | 说明 |
| --- | --- |
| 协议 / URL | WebSocket：`ws://127.0.0.1:8081/api/consultation/events/ws` |
| SDK 订阅 | `mh.subscribe(envelope => ...)`；结果取 `envelope.event.payload` |
| 触发时机 | 医生在 PCIE 核对、修改并确认返回参数 / 回写后 |
| 识别条件 | `event.type === "record-confirmed"`，payload 的 `resultType === "record-confirmed"` 且 `emrType === "outpatient-emr"` |
| 完整结果 | [语音合并回写事件](examples/outpatient-emr/voice-writeback.event.json)、[其中的完整 payload](examples/outpatient-emr/voice-writeback.payload.json) |
| HIS 保存 URL | 使用 HIS 自己已有的病历保存接口，由 HIS 开发者接入；PCIE 协议不规定这个 URL |

SDK 已处理握手、WebSocket 连接、重连及事件分发。无需另写轮询，也不要同时用 `subscribe` 和 `on("record-confirmed")` 各保存一次。单独注册一个常驻订阅，将两个上传入口的结果交给同一个保存处理器；独立 Promise resolve 也不再触发第二次保存。

事件外层包含 `state` 和 `event`，`event` 包含 `id / type / consultationId / requestId / timestamp / terminal / payload`。**`terminal: true` 表示该结果事件已形成，不代表 HIS 已保存。** 完整事件 JSON 已在上述文件中给出。

### 2.2 最终 payload：HIS 实际需要消费什么

| 字段 | 类型 / 用法 |
| --- | --- |
| `consultationId / visitId` | 均为上传时的就诊 ID，必须与待处理任务匹配 |
| `requestId` | 上传任务的原 ID；保存幂等与回执关联键 |
| `resultType / emrType` | 固定为 `record-confirmed / outpatient-emr` |
| `referenceType / action / referenceStatus` | `batch / batch / pending`，表示等待 HIS 处理 |
| `templateMetadata` | `schemaVersion + templateId + templateName + templateHash + fields[]` |
| `templateMetadata.fields[]` | 本次确认写入的模板字段，可为空数组；每项含 ID、名称、类型、章节、字典项及可选标准投影映射 |
| **`fieldValues`** | 开放 `字段 ID → 最终显示文本`，键与本次确认字段 ID 完全一致 |
| **`dictionarySelections`** | 字典字段的 `字段 ID → {value,text}` |
| **`emrFieldValues`** | 开放 `字段 ID → 控件绑定值`；文本为文本，字典为编码 |
| `outpatientRecord` | 可选标准病历投影；不代替按动态字段 ID 回填 |
| `writebackScope` | 标准病历、诊断和医嘱的医生选择范围 |
| `diagList / orderList` | 同批次已选诊断 / 医嘱；`orderList` 始终是数组 |

下面是最关键的三个实际回写对象；[完整 payload 文件](examples/outpatient-emr/voice-writeback.payload.json)还包括上表所有身份、模板元数据和范围：

```json
{
  "fieldValues": {
    "主诉文本": "咳嗽3天。",
    "吸烟史标志": "有",
    "吸烟史补充": "既往吸烟20年，已戒烟2年。"
  },
  "dictionarySelections": {
    "吸烟史标志": { "value": "1", "text": "有" }
  },
  "emrFieldValues": {
    "主诉文本": "咳嗽3天。",
    "吸烟史标志": "1",
    "吸烟史补充": "既往吸烟20年，已戒烟2年。"
  }
}
```

这里的中文 key 是合成模板原有 ID，不是协议固定字段名。HIS 的任何稳定 ID 都按同一算法处理；换患者、疾病或模板不需要增加业务分支。语音合并结果的 `emrFieldValues` 还可能包含已选标准病历的兼容绑定项，上面的片段只展示动态模板的三项。

<a id="field-binding"></a>
### 2.3 按 ID 通用回填

1. 从本地任务表按 `requestId` 找到发起时的患者、就诊、病历记录 ID、模板和编辑器版本；不能只看当前患者姓名。
2. 在 HIS 保存事务内锁定同一记录并校验当前版本。核对 `visitId / consultationId / templateId / templateName / templateHash`，模板已换或内容已变则拒绝旧结果。
3. 以 `templateMetadata.fields` 列出的医生确认字段为本次回写范围。其 ID 必须唯一、属于原 `targetFieldIds`，且与 `fieldValues` 的键完全一致。未提供值或未确认的目标从元数据、显示值、字典选择和绑定值中一并省略，HIS 保留控件原值。医生显式清空文本时，该 ID 仍在字段表中，显示值和绑定值均为 `""`。确认字段可以为零，独立分析和语音合并均跳过动态字段写入；语音流程继续处理同批已选诊疗内容，按原请求回执一次。
4. 从当前渲染器字段表建立 `Map<稳定字段ID, 控件>`，逐一匹配；复查可见、可写、AI 允许策略和控件类型。先生成完整绑定计划，全部通过后才写入。
5. 普通文本 / 数字 / 日期控件使用该 ID 的最终值；字典控件使用 `dictionarySelections[id].value` 作为编码、`.text` 作为显示值，二者必须唯一命中本控件字典。
6. 在同一个保存批次中处理范围内的标准病历、诊断和医嘱，核对本批次确认字段的实际写入结果后调用 HIS 保存。
7. 保存成功留存流水，再发送 2.5 的成功回执。

PHIS 可用 `medEleDatabinds(result.emrFieldValues)` 绑定，但必须检查返回结果和最终控件值，不能忽略无法匹配的 key。若绑定器会静默忽略未识别字段，应在调用前按上述规则校验，调用后逐项核对。**以 HIS 对本批确认内容的实际保存结果回执。**

[template-writeback.example.mjs](examples/outpatient-emr/template-writeback.example.mjs)给出可复用的目标校验和绑定计划函数，兼容语音合并与独立结果；不包含 HIS 的真实编辑器、保存事务或回执队列。开发者将计划交给自身渲染器执行，无需为“主诉”“吸烟史”写特例。

```js
import { buildTemplateWritebackPlan } from "./template-writeback.example.mjs";

// 放在 HIS 保存事务内，已校验当前模板 hash 与编辑器版本。
// task.mode 为 voice 或 standalone，request 是当时上传的完整请求。
const plan = buildTemplateWritebackPlan({
  mode: task.mode,
  request: task.request,
  expectedHash: task.templateHash,
  result,
  rendererFields: await hisEditor.getNormalizedFields()
});
// PHIS 绑定器示例：只取本次动态目标；兼容绑定及诊疗范围另按 scope 处理。
const dynamicBindings = Object.fromEntries(plan.map((field) => [field.id, field.value]));
if (plan.length) {
  await hisEditor.medEleDatabinds(dynamicBindings);
  await hisEditor.assertAppliedFields(plan);
}
// 随后调用 HIS 自身的病历保存；提交成功后才执行 2.5 回执。
```

`hisEditor` 同样由接入方实现；`getNormalizedFields()` 返回每个控件的 `id / type / visible / readonly / aiWritable / dictionaryItems`。类型与字典编码文本须归一化到 PCIE 返回的形式。示例模块不是 HIS 渲染器，不能把上述端口原样当作现成库调用。

`recordField=null` 或 `mappingSource="unmapped"` 的自定义字段仍在上述开放字段表中，必须按 ID 写入；`outpatientRecord` 的标准字段枚举不是动态模板的白名单。模板默认“否认 / 正常”可正常保留；明确相反病例事实和医生最终修改须保留，不能在回填时擅自恢复默认值。

### 2.4 接收 → 保存 → 回执的调用示例

以下 `his.*` 是接入方需要实现的端口，**不是 PCIE SDK 函数**。其中 `applyAndSaveOnce` 必须在 HIS 事务内完成 2.3 全部校验、完整回填、原生联动及实际保存，并记录幂等流水；重复事件返回已保存流水。数据库结果不明时先查流水，不得直接归类为失败。

```js
// 此订阅常驻；在发起任何模板任务前注册。
// 用串行队列避免同一病历的两个事件并发保存。
let queue = Promise.resolve();
mh.subscribe((envelope) => {
  const event = envelope.event;
  const result = event && event.payload;
  if (!event || event.type !== "record-confirmed"
      || !result || result.resultType !== "record-confirmed"
      || result.emrType !== "outpatient-emr") return;
  queue = queue.then(() => handleTemplateWriteback(event))
    .catch((error) => his.showIntegrationError(error));
});

async function handleTemplateWriteback(event) {
  const result = event.payload;
  const task = await his.requirePendingTemplateTask(result.requestId);
  // 持久状态键还需带机构、患者/就诊和病历记录 ID。
  const saved = await his.findSavedReceipt(task, result.requestId);
  if (!saved) {
    const outcome = await his.applyAndSaveOnce(task, result, event.id);
    if (outcome.state === "unknown") {
      await his.markSaveForReconciliation(task, event.id);
      return; // 查 HIS 保存流水后再确定 success/failed
    }
    if (outcome.state === "failed") {
      await his.enqueueTemplateFeedback(task, {
        consultationId: result.consultationId,
        requestId: result.requestId,
        referenceType: "batch",
        action: "batch",
        status: "failed",
        message: outcome.message,
        items: []
      });
      return his.flushTemplateFeedbackQueue();
    }
    if (outcome.state !== "saved") throw new Error("未知的 HIS 保存结果");
    // 此时病历和保存流水已经持久化成功。
  }
  await his.enqueueTemplateFeedback(task, {
    consultationId: result.consultationId,
    requestId: result.requestId,
    referenceType: "batch",
    action: "batch",
    status: "success",
    message: "HIS 已完整回填并保存病历",
    items: []
  });
  // 队列按原 consultationId/requestId POST 到 2.5 的接口。
  // 网络失败保留队列，仅重试回执，不重新写病历、不改报 failed。
  await his.flushTemplateFeedbackQueue();
}
```

两个范围的区别：

| 入口 | 动态模板字段 | 标准病历、诊断、医嘱 |
| --- | --- | --- |
| 1.1 语音一体化 | 按本次确认字段回填 | 保留医生已选 `writebackScope`；同批处理实际出现的 `outpatientRecord / diagList / orderList` |
| 1.2 独立分析 | 按本次确认字段回填 | 标准投影可选；`includeDiagnosis=false`、`orderTypes=[]`、`orderList=[]`，没有诊断医嘱合并 |

`orderList=[]` 与字段省略均不能解释为“清空 HIS 原内容”。语音结果的兼容绑定项与动态模板目标分开校验，不能因兼容项无法匹配而跳过动态目标，或将兼容项误算为越界动态字段；兼容绑定只允许写入本次已选标准范围。

白云医生站的语音按钮与结果监听器各自创建了 `MedHermes` 实例。发起前将任务登记在本次医生站上下文，监听器从同一处取回请求、患者、就诊、模板和授权控件。切换就诊或结束接诊时使旧任务失效。按 `templateMetadata.fields` 核对本次所选的实际控件、显示值和字典编码。在 HI-EMR 4.1 中，绑定前核对 `OUTPATIENT.recordContent`、`$refs.record.record` 和实际编辑器指向同一份文书，绑定后可用 `getMedEle(id)` 读回字段值。编辑器尚未就绪时保留任务供医生重试。回执分别说明任务已失效、病历已切换、无可绑定字段或绑定失败。仅确认诊断或医嘱时可以跳过空的模板绑定。

### 2.5 回写完成回执接口

| 项目 | 说明 |
| --- | --- |
| Method / URL | `POST http://127.0.0.1:8081/api/consultation/reference-feedback` |
| SDK | 当前活动任务可用 `mh.sendFeedback(result.requestId, status, message)` |
| 何时 success | HIS 自身保存已确定提交成功，并有保存流水 |
| 何时 failed | 身份 / 模板 / 字段校验失败，或确认未保存成功 |
| 身份来源 | **最终结果**的 `consultationId + requestId`，`referenceType/action="batch"` |
| 完整报文 | [成功回执请求](examples/outpatient-emr/feedback.request.json)、[受理响应](examples/outpatient-emr/feedback.response.json) |

```json
{
  "consultationId": "SIM-VISIT-001",
  "requestId": "SIM-VOICE-REQUEST-001",
  "referenceType": "batch",
  "action": "batch",
  "status": "success",
  "message": "HIS 已完整回填并保存病历",
  "items": []
}
```

HTTP 200：

```json
{
  "status": "success",
  "consultationId": "SIM-VISIT-001",
  "requestId": "SIM-VOICE-REQUEST-001",
  "referenceType": "batch",
  "timestamp": 1794355500000,
  "traceId": "his-sim-feedback-001"
}
```

```js
// 同一活动任务收到结果并完成 HIS 保存后：
await mh.sendFeedback(result.requestId, "success", "HIS 已完整回填并保存病历");
// 确定失败的另一种处理：
// await mh.sendFeedback(result.requestId, "failed", "目标字段缺失，病历未保存");
```

回执接口的 HTTP `status:"success"` 表示 PCIE **接收了这次回执**；即使提交的是业务 `failed`，它也可能返回 HTTP 200。只有提交 `status:"success"` 且 HIS 已实际保存，才是业务闭环完成。回执后 WebSocket 会推送 `reference-feedback`，不要再次当作待保存病历。

SDK `sendFeedback` 使用当前实例最近结果 / 会话身份。持久队列应保存原完整回执体，按原身份直接 POST；不应切换患者后用另一活动会话补发。PCIE 只接受当前匹配的待处理结果，不匹配会返回 HTTP 409 / `REFERENCE_REQUEST_MISMATCH`；遇到 409 停止自动重试并核对任务，不能改成新患者 ID 强行提交。

HIS 确定保存失败后，PCIE 保留医生修改，可再次提交同一任务；HIS 应允许同 `requestId` 的**新事件**重试，按保存流水防重复，而不是把“收到过这个 requestId”永久当成功。保存成功但回执失败时只补发原 success；提交结果未知先查流水。

## 接入时必须处理的模板边界

<a id="linkages"></a>
### 联动与显隐

HIS 在上传前先执行自己的模板渲染规则，生成当前可见可写目标；PCIE 校验隐藏 / 只读目标，但不执行 HIS 模板脚本，不按性别年龄自行展开字段。返回值触发新的补充字段显现时，由 HIS 原生联动呈现并由医生补写，或以新渲染快照、新目标、新 requestId 再发任务；不能把旧结果写入本次未上传的字段。

<a id="system-fields"></a>
### 系统字段

姓名、证件号、记录时间、签署时间、医生签名等由 HIS 或签署流程维护，不进入 AI 目标。HIS 应在目标生成和保存校验两处执行统一字段策略。当前 PCIE 的提示词约束不等于代码级自动剔除；即使模板把行政字段标成可写，也不能依赖模型自动保护。性别 / 年龄可作为分析上下文，系统头部控件仍由 HIS 管理。

<a id="integration-bootstrap"></a>
## 接口调用前：SDK 与会话初始化

桌面端运行后，可从本机加载 SDK，或将包内同版 JS 部署到 HIS：

```html
<script src="http://127.0.0.1:8081/sdk/med-hermes-sdk.js"></script>
```

```js
const mh = new window.MedHermes();
await mh.init(); // 已支持的 HIS 页面自动采集有效会话并握手
```

无法自动采集时，由 HIS 提供**当前有效登录会话**：

```js
const mh = new window.MedHermes();
await mh.init({
  emrAccessToken: currentHisSession,
  urt: currentHisSession
});
```

`MedHermes` 为已发布兼容名。不要在 HIS 放入模型供应商密钥或 PCIE 设备签名密钥。直接 HTTP / WS 接入也须按 [API 握手与会话约束](../api.md#61-post-apihandshake)完成初始化；SDK 封装已负责此流程。

## 交付文件与验收

| 文件 | 用途 |
| --- | --- |
| [voice-upload.request.json](examples/outpatient-emr/voice-upload.request.json) | **接口一**：可直接查看 / 发送的完整语音模板上传报文，两份模板原文都已内嵌 |
| [analyze.request.json](examples/outpatient-emr/analyze.request.json) | **接口一的独立分析方式**：包含病例对话 |
| [voice-writeback.event.json](examples/outpatient-emr/voice-writeback.event.json) | **接口二**：完整 WebSocket 回写事件 |
| [voice-writeback.payload.json](examples/outpatient-emr/voice-writeback.payload.json) | **接口二**：完整最终病历 payload |
| [feedback.request.json](examples/outpatient-emr/feedback.request.json) | **接口二收尾**：HIS 保存完成回执 |
| [template-writeback.example.mjs](examples/outpatient-emr/template-writeback.example.mjs) | 一套按 ID / 类型 / 字典匹配的绑定规划器 |
| [template.html](examples/outpatient-emr/template.html)、[template.json](examples/outpatient-emr/template.json) | 与完整请求内嵌原文一致的最小合成模板 |
| [result.example.json](examples/outpatient-emr/result.example.json) | 独立分析最终结果；旧的两个校验 / 绑定示例仅用于独立入口 |
| [SDK JS](../sdk/med-hermes-sdk.js)、[类型声明](../sdk/med-hermes-sdk.d.ts) | 实际 SDK 与完整类型 |
| [完整 API](../api.md#63c-post-apioutpatientemranalyze) | 详细契约与错误码参考 |

最小联调过程：

1. HIS 生成并保存任务身份，上传当前模板；PCIE 日志中模板和目标数量均非空。
2. 在 PCIE 完成合成对话 / 事实分析、修改一个字段并确认，保留请求及完整回写事件。
3. HIS 通用适配器完整回填，保存后刷新病历；逐项核对普通字段、字典编码 / 文字和医生修改。
4. 回执 success 后 PCIE 显示完成；另测保存失败、新事件重试、重复事件与回执断网。
5. 换一套字段 ID / 字典编码不同的模板，复用同一适配器；切患者 / 模板 / 版本后拒绝旧结果。
6. 核对隐藏、只读、自定义字段、默认值、联动及未选范围；不能以“接口已调用”替代实际保存。

常见排错：未带模板看 1.1 的请求计数；`TEMPLATE_PAIR_MISMATCH` 查同一快照与当前值；`INVALID_TARGET_FIELD_IDS` 查目标范围与显隐；字典错误查当前合法项；`TEMPLATE_SNAPSHOT_FAILED` 查服务端模板通道；`INVALID_OUTPATIENT_EMR_RESULT` 拒绝回填并查协议。

联调证据至少记录：上传请求 → HTTP 受理 → 最终事件 / payload → HIS 保存字段与流水 → 回执。只使用合成数据的工程验证与真实 HIS、真实 AI、语音采集和医学验收分别记录；文档与示例包本身不表示 HIS 已完成接入。

语音入口允许无患者的空请求沿用当前上下文；非空非法 JSON 或超过该入口总正文上限的请求必须拒绝，不得被当作“无患者/无模板”继续启动。
