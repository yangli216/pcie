# 全医慧助（PCIE）HIS 接入指南 / 接口说明

> 最后更新: 2026-09-10
>
> 本文档面向准备接入全医慧助（PCIE）的 HIS / 医生站 / PHIS 项目。
> 当前真实运行契约以 `src-tauri/src/http_server.rs` 与当前前端实现为准；旧区域化草案已归档，不能替代本文档。
> 为兼容既有院端部署，SDK 全局对象 `MedHermes`、SDK 文件名、`med-hermes://` 深链和 `X-MedHermes-Version` Header 保持不变。

## 1. 文档目标

本文档回答 4 件事：

1. HIS 应该按什么顺序接入全医慧助（PCIE）
2. 当前本地 HTTP Bridge 暴露了哪些接口
3. 各接口的请求字段、响应字段、异常场景是什么
4. 推荐诊断 / 用药 / 检查 / 独立诊疗方案的最终回写、历史/单项引用与 PHIS 回执闭环应该怎么做

## 2. 当前接入形态

全医慧助（PCIE）当前通过本地 Bridge 与 HIS 对接：

- 本地服务地址: `http://127.0.0.1:8081`
- 接口前缀: `/api`
- 协议: REST 命令 + WebSocket 事件流
- 数据格式: `application/json`
- 编码: `UTF-8`

约束说明：

1. 全医慧助（PCIE）必须先在医生本机启动，否则接口不可访问。
2. 当前服务只监听 `127.0.0.1:8081`，默认供本机 HIS / 联调页调用。
3. `/api/consultation/events/ws` 是唯一结果通道。桌面端以内存事件队列保留最近事件，SDK 断线重连时携带最后消费的 `event.id` 补发；不提供 HTTP 长轮询结果接口。
4. 接诊类 REST 接口的同步响应仍回传 `idPi / patientId` 作为基础 `consultationId`；进入前端结果/回执链路后，桌面端会优先使用当前就诊锚点 `idVis / visitId`，缺失时回退到 `idPi / patientId`。
   如果 HIS 存在“同患者多次接诊”场景，必须传入 `idVis`，避免旧就诊结果或回执误命中当前就诊。
5. 当前 Bridge 会为业务接口生成 `traceId` 并写入本地 HIS 集成日志，方便三方 HIS / PHIS 联调时按一次调用链路排查请求、响应和错误。
6. Bridge 与 SDK 对外展示的失败信息应使用可读中文说明，并优先带出 `traceId`；底层网络异常、Rust/JavaScript 异常、PHIS 原始错误体和堆栈只进入本地 HIS 集成日志，不应作为唯一错误提示直接展示给医生或 HIS 操作员。
7. 本地 Bridge 只承担 HIS/SDK 接入，不提供 AI、语音或知识库第三方代理；历史 `/api/pmphai/*` 路由已删除。PMPHAI 统一通过设备签名后的 `PCIE Server /v1/knowledge/pmphai/*` 调用。

## 3. 推荐接入顺序

建议分 4 步完成接入。

### 第一步: 打通基础接诊

1. HIS 选择患者后，调用 `POST /api/consultation/start`
2. 调用成功后通过 SDK 订阅 `GET /api/consultation/events/ws` WebSocket 事件流；HIS 内嵌浏览器必须支持 WebSocket
3. 收到 `draft` 或 `record-confirmed` 后回填医生站草稿

适用场景：

- 从完整问诊主流程开始
- 主要目标是生成主诉、现病史、初步诊断和建议

### 第二步: 打通灵活模式

1. HIS 在当前患者上下文下调用 `POST /api/consultation/assist`
2. 指定 `action` 为 `record / suggestedDx / diffDx / medication / examination / lab_test / procedure / treatment_plan / reminder`；历史 `diagnosis / differential` 继续兼容
3. 继续通过 SDK 事件订阅接收 `draft / record-confirmed / reference-request / reference-feedback` 等事件
4. 如果收到 `record-confirmed`，说明医生发起了最终一键回写；如果收到 `reference-request`，说明医生在历史或单项入口发起了引用；两者处理完成后都需要通过 `reference-feedback` 回执

适用场景：

- 医生已经在 HIS 里录入了部分病历，只想快速拿 AI 推荐
- 不希望再开第二套独立问诊窗口

### 第二点五步: 打通检验检查报告解读

1. HIS 在需要解读报告时调用 `POST /api/report/interpret`
2. 传入 `taskId + query`，`query` 直接承载报告日期、检查项目、检查结果、阴阳性或影像诊断等原始文本
3. 若当前桌面端已有接诊患者，全医慧助（PCIE）会自动补入该患者的性别、年龄、既往史、过敏史等上下文；若当前无接诊患者，可在 `patient` 字段显式传入患者基础信息
4. 全医慧助（PCIE）打开独立“报告解读”窗口并输出摘要结论、关键异常、临床意义、建议动作与风险提示

适用场景：

- HIS 已经拿到了检验或影像原始文本，只需要 AI 辅助解释
- 医生当前可能仍停留在问诊或其它页面，不希望被强制跳转

### 第二点六步: 打通住院病历辅助生成

1. HIS 在住院电子病历书写页调用 `POST /api/inpatient/emr/generate`
2. 传入 `admissionId + templateId + templateName + htmlContent`，可选传入 `recordTime` 指定本次病程记录书写时间；`admissionId` 对应 PHIS `idAdsn`，`templateId` 是病历模板主键，`htmlContent` 是当前病历模板 HTML
3. `全医慧助（PCIE）` 从悬浮球切换到“住院病历生成”界面，按步骤展示“住院上下文 -> 医嘱整理 -> 体温单整理 -> 模板解析 -> AI 生成”
4. 如果当前模板是入院记录，`全医慧助（PCIE）` 会按患者 `idPi` 通过 HIS Adapter 查询门诊就诊历史；若入口请求未直接携带 `patient.idPi / patient.patientId`，则要求 `api/phis.aiInpatientEmrContextService/buildContext` 返回的 `hisContext.patient.patientId` 保留患者主键。当前 PHIS 实现先调用 `api/phis.aiAdapterService/queryVisitHistory`，默认查询近 7 天，医生可切换近 1 月 / 近 3 月；时间范围入参放在 `params.dtBgn`，形如 `[{"limit":-1,"params":{"idPi":"患者ID","dtBgn":["2026-06-08 00:00:00","2026-06-15 23:59:59"]}}]`，并把 `idVis / idReg / cdClinic / dtBgn / idDeptText / idDocText / idOrgText / fgStatusText / visiting / naDiag` 等字段映射为中性门诊就诊列表。桌面端只展示“有有效诊断且存在门诊病历文书”的就诊记录：无诊断或 `getLookMedList` 无文书的就诊会被过滤。医生选定一次门诊就诊后，再调用 `api/phis.aiAdapterService/getLookMedList` 获取该就诊下的门诊病历文书列表；入参形如 `[{"idApp":"42","idTet":"xswjj","idHospital":"门诊idVis"}]`。其中 `idApp` 固定为 `42`，`idHospital` 取门诊就诊记录 `idVis`，`idTet` 优先取门诊记录原始字段，其次取 SDK 握手解析出的租户。随后按列表返回的 `idMedrecdoc` 调用 `api/phis.aiAdapterService/getMedContentLook` 获取 HTML 正文；入参形如 `[{"idApp":"42","idTet":"xswjj","idMedrecdoc":"文书ID","courseShow":0}]`。门诊病历正文会进入预览和 AI 参考上下文；若正文接口失败，桌面端才退回只展示文书列表。
5. 医生审核预览内容后点击“一键回写”
6. HIS 可继续通过 SDK 事件流收到 `record-confirmed`，也可直接等待 `sdk.generateInpatientEmr(...).then(record => ...)`；两种方式返回同一份回写 payload，读取其中的 `fieldValues`（`{ [data-id]: 文本 }`）回填当前住院病历编辑器
7. HIS 完成回填后，仍建议调用 `POST /api/consultation/reference-feedback` 回执成功或失败，桌面端会更新页面状态

适用场景：

- 住院出入院记录、病程记录等病历模板已有 HTML 结构
- HIS 希望 `全医慧助（PCIE）` 利用 PHIS 住院登记、诊断、医嘱、体温单等业务数据生成可审核草稿

### 第三步: 打通 PHIS 回写与引用回执闭环

1. HIS / PHIS 通过 WebSocket 收到 `record-confirmed` 或 `reference-request`
2. 收到 `record-confirmed` 时，读取 `requestId`、`writebackScope` 与 `referenceType/action = batch`；只处理 payload 中真实出现的 `outpatientRecord / diagList`，未出现范围保持 PHIS 原值；`orderList` 始终为数组，`writebackScope.orderTypes = []` 且 `orderList = []` 表示本次不处理医嘱
3. 收到 `reference-request` 时，若存在 `recognitionDecision`，按原 `record-confirmed` 的互认中间决策继续保存；否则读取 `action/referenceType`、`referenceItems`，按引用对象类型处理历史或单项引用
4. 处理成功或失败后，**必须**调用 `POST /api/consultation/reference-feedback`
5. `全医慧助（PCIE）` 收到回执后会更新当前页面状态，并通过 WebSocket 事件流推送 `reference-feedback`

这是当前联调最关键的一步，也是推荐诊断 / 用药 / 检查 / 独立诊疗方案真正写入 HIS 的闭环。

**重要：回执是强制要求的。** 当前医生点击“一键回写”时，`全医慧助（PCIE）` 只发出**一条** `record-confirmed`（`referenceType/action` 为 `batch`）。`writebackScope` 描述本次范围；出现的 `outpatientRecord / diagList` 分别承载已选病历字段和标准诊断，未出现内容不得清空；`orderList` 固定为数组，空数组与空 `writebackScope.orderTypes` 组合表示不处理医嘱。PHIS 处理完成后**必须**调用一次回执接口。

## 4. 标准字段与映射规则

### 4.1 患者上下文字段

以下字段是当前最推荐的标准字段名：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识；同一患者多次就诊时强烈建议传入 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本，如 `男性` / `女性` |
| `ageText` | String | 否 | 年龄文本，如 `19岁` |
| `department` | String | 否 | 当前科室 |
| `idCard` | String | 否 | 身份证号 |
| `mobilePhone` | String | 否 | 联系电话 |
| `allergyHistory` | String | 否 | 过敏史 |
| `chiefComplaint` | String | 否 | 主诉 |
| `historyOfPresentIllness` | String | 否 | 现病史 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `personalHistory` | String | 否 | 个人史 |
| `menstrualHistory` | String | 否 | 女性月经史；应与性别字段同时传入，独立于个人史 |
| `familyHistory` | String | 否 | 家族史 |
| `physicalExam` | String | 否 | 体格检查 |
| `precautions` | String | 否 | 注意事项 / 医嘱提示 |
| `diagnosis` | String | 否 | 当前 HIS 诊断草稿 |
| `vitals` | String | 否 | 体征摘要 |

### 4.2 字段别名兼容

当前本地桥接层兼容以下别名：

| 推荐字段 | 兼容别名 |
| :--- | :--- |
| `idPi` | `patientId` |
| `idVis` | `visitId` |
| `naPi` | `name` |
| `sdSexText` | `gender` |
| `ageText` | `age` |

建议：

1. 新接入项目统一使用标准字段名，不要长期依赖别名。
2. 接诊、完整问诊、灵活问诊、语音问诊、风险提醒这几类入口当前只强制要求 `idPi`；`naPi / sdSexText / ageText` 建议一并传入用于兜底展示，但桌面端在 HIS adapter 可用时会再按患者主键拉取标准化上下文。
3. 接诊类 REST 接口的同步响应仍以 `idPi / patientId` 作为基础 `consultationId`；`draft`、`record-confirmed`、`reference-request`、`reference-feedback` 等结果事件里的 `consultationId` 由前端当前患者上下文解析，优先使用 `idVis / visitId`，缺失时回退到 `idPi / patientId`，不是由 Bridge 额外生成的新流水号。
4. 推荐在 `start-consultation` / `assist` / `start-voice` / `patient-risks` 等入口同时下发 `idVis`（或别名 `visitId`）。桌面端会优先使用 `idVis` 作为结果事件、回执匹配、语音问诊缓存与最小化会话的就诊锚点；缺失时回退到 `idPi / patientId`，但同一患者多次就诊会共享同一结果/缓存锚点，存在被旧就诊数据污染的风险。
5. 如果你们 HIS 还没有就诊流水号，可暂时不传 `idVis`，但建议尽快补充。
6. Bridge 对未显式建模的患者扩展字段采用“保留并透传”策略。也就是说，像 `idCard`、`mobilePhone`、`idTet`、`idMpi`、`vitals`、`currentMedicationHistory` 等字段，即使本文档未逐一列为固定入参，也会原样传递到前端患者上下文的 `raw` 区域，供后续标准化构建使用。

## 5. 典型业务时序

### 5.1 完整问诊时序

1. HIS 调用 `POST /api/consultation/start`
2. `全医慧助（PCIE）` 置顶并进入完整问诊主流程
3. HIS 订阅 `GET /api/consultation/events/ws`
4. 医生在 `全医慧助（PCIE）` 中完成问诊或草稿回写
5. HIS 收到 `draft` 或 `record-confirmed` 后更新医生站；其中 `record-confirmed` 在 HIS 完成最终调入确认后，仍需继续调用 `POST /api/consultation/reference-feedback` 回执成功或失败

### 5.2 灵活模式时序

1. HIS 调用 `POST /api/consultation/assist`
2. `全医慧助（PCIE）` 直接进入对应辅助界面：单项推荐仍落到 `ConsultationPage` 灵活模式，`treatment_plan` 落到独立诊疗方案推荐页
3. 医生在当前界面中继续补充病历、看推荐、勾选方案并发起回写
4. HIS 继续复用同一条 WebSocket 订阅
5. 如果收到 `record-confirmed`，进入 PHIS 最终调入确认；如果收到 `reference-request`，进入历史/单项 PHIS 引用处理

### 5.3 最终回写闭环时序（一键回写）

医生点击“一键回写”后，`全医慧助（PCIE）` 会发出**一条** `record-confirmed`，`referenceType/action` 为 `batch`；实际出现的病历字段、`diagList` 和 `orderList` 内容由 `writebackScope` 决定，`orderList` 字段本身始终为数组：

1. `全医慧助（PCIE）` 发出 `record-confirmed`（`referenceType/action: "batch"`），scope 与 payload 中实际字段保持一致
2. PHIS 通过 WebSocket 收到该结果，只更新真实出现的病历字段、诊断和 `writebackScope.orderTypes` 明确选择的医嘱；空 `orderTypes + orderList: []` 时保持原医嘱
3. PHIS **必须**调用 `POST /api/consultation/reference-feedback` 回执
4. `全医慧助（PCIE）` 收到回执，页面更新最终回写状态

```text
PHIS                                全医慧助（PCIE）
 |                                       |
 |  <-- WebSocket /api/consultation/events/ws (record-confirmed, batch)
 |  按 writebackScope 读取实际出现字段     |
 |  POST /reference-feedback (success) -->|
 |                                       |  回写完成
```

`reference-request` 仍可能出现在历史兼容、单项引用，以及检验检查互认的医生中间决策场景；它不会替代当前一键回写的首条 `record-confirmed`。

#### 5.3.1 检验检查互认中间决策

当 `record-confirmed.orderList` 中的检查 / 检验项目命中 PHIS 可互认报告时，PHIS 不立即保存，而是通过同一回执接口返回中间态：

1. PHIS 调用 `sendFeedback(requestId, "pending", "存在可互认的检验检查项目，请医生在智医端决策", recognizableItems)`；`requestId` 必须与原 `record-confirmed` 一致。
2. 全医慧助保持原回写等待状态，弹出互认决策框。医生可部分勾选项目并选择互认、不互认或取消。
3. 全医慧助通过 WebSocket 结果流发送一条 `reference-request`，仍使用原 `requestId`，并携带 `recognitionDecision`。
4. PHIS 根据决策执行保存，再调用 `sendFeedback` 返回最终 `success / failed / cancelled`。

```text
PHIS                                全医慧助（PCIE）
 |  <-- record-confirmed (requestId=R)    |
 |  sendFeedback(R, pending, items) ----> |
 |                                       |  医生部分勾选并决策
 |  <-- reference-request                |
 |      recognitionDecision, requestId=R |
 |  sendFeedback(R, success/failed/      |
 |               cancelled, savedItems)->|  最终收尾
```

### 5.4 联调日志与 traceId

1. `POST /api/handshake`、`POST /api/consultation/start`、`POST /api/consultation/assist`、`POST /api/consultation/start-voice`、`POST /api/consultation/stop`、`POST /api/consultation/reference-feedback`、`POST /api/patient/risks`、`POST /api/report/interpret` 会写入本地 HIS 集成日志；WebSocket 连接与异常断开按状态记录。
2. 上述业务响应会额外返回 `traceId` 字段。三方联调时请把该值提供给桌面端开发或从“设置 -> HIS 联调日志”入口中筛选查看。
3. Bridge 入站日志会记录接口方向、路径、请求摘要、响应摘要、HTTP 状态、业务 `code/msg`、耗时、患者 / 问诊 / 回执标识和错误摘要；`Cookie`、`Authorization`、`token`、手机号、身份证号等敏感字段会默认脱敏，日志仅用于本机联调。
4. 桌面端主动调用 PHIS 的字典、药品详情、库存校验等出站接口也写入同一日志文件，便于用一次 `traceId` 串联 Bridge 入站与 PHIS 出站排查。出站记录只保存净化后的接口路径和结构摘要：完整 URL 的 userinfo、query、fragment 以及患者、就诊、住院、人员、机构、科室、凭据和自由文本值不得进入控制台或出站持久日志。
5. 日志仅保存在医生本机本地数据目录，可在日志面板中刷新、筛选、复制、导出或清空。
6. 前端处理 `sdk-handshake` 时不得把 raw ctx、`emrAccessToken`、完整 `urt`、HIS 地址、机构/租户/科室明细输出到浏览器控制台；只允许记录握手阶段、字段存在性和数量。
7. 控制台日志不得记录 HIS origin/baseUrl 的具体值，即使已去除 userinfo、路径和查询参数；只允许记录 `hasBaseUrl/hasToken/hasOrgCode/hasTenantId` 与科室数量等布尔或计数摘要。

### 5.5 门诊用药推荐的有效库存目录

1. 桌面端按当前用户可见发药药房调用 `api/phis.aiAdapterService/queryInvSubList`，单个药房请求参数为 `[{"start":0,"limit":-1,"sort":null,"params":{"idSto":"药房ID","naMedPro":null,"sdBasMed":null,"amountType":"1","fgActiveType":"1","sdMed":null,"sdMedType":null}}]`。
2. 返回的同一 `idMedPro` 多批次记录在 HIS Adapter 内合并；只有启用、未失效且可用数量大于 0 的药品进入 AI 候选目录。合并项保留近效期有效批次的 `priceSale` 作为当前药房库存单价；近效期批次未返回有效价格时，顺延取下一个有效批次价格。
3. 合并后的目录按机构、租户、药房缓存，短时间内重复生成方案不重复访问 PHIS；刷新失败时保留最近一次非空缓存作为降级。
4. 常规用药推荐的 AI 上下文只使用紧凑的药品名和规格列表约束推荐范围，不传入具体库存数量。报告回诊等先判断是否需要治疗的场景采用两阶段：第一阶段仅输出用药意图、首选规范通用名及别名；客户端按这些名称在有效库存目录精确检索，第二阶段只传入命中的候选药品名和规格。没有经审核的药品治疗类别/替代知识映射时，不以模型猜测等效药；精确候选为空时返回规范通用名无库存参考。该目录是推荐依据，不是提交时的库存承诺，最终回写前仍调用实时库存校验接口。库存校验请求中的单价和可用数量必须按 `药房 storeId + 药品 idMedPro` 从有效库存目录获取，不得使用药品详情接口返回的单价；目录中无有效库存单价时应拦截校验和回写。

## 6. 接口清单

### 基础可用性探测 `GET /api/health`

用途：仅检测本地桌面桥接服务是否在线。该接口不写入浏览器上下文，也不做授权握手校验，供 loader / SDK 的 `ping()` 用于避免误判“应用离线”。

完整地址：

```text
http://127.0.0.1:8081/api/health
```

成功响应：

```json
{
  "status": "success",
  "version": "1.2.8",
  "timestamp": 1704355200100
}
```

说明：

1. 该接口只表示“桥接服务在线”，不表示当前 HIS 已完成授权握手。
2. 业务调用前仍需执行 `POST /api/handshake` 并携带有效的 `extra.emrAccessToken`。

### 6.1 `POST /api/handshake`

用途：SDK 初始化握手，将浏览器上下文（域名、Cookie、UA 等）传递给桌面端，同时完成桌面端服务授权检测。握手必须携带有效的 `emrAccessToken`，否则桌面端服务不可调用。

完整地址：

```text
http://127.0.0.1:8081/api/handshake
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `origin` | String | 否 | SDK 采集的 HIS 基地址：浏览器 `location.origin` 加页面路径首段作为 contextPath，例如 `https://his.hospital.com/his-web` |
| `href` | String | 否 | 浏览器 `location.href`（完整 URL） |
| `cookie` | String | 否 | 浏览器 `document.cookie`，桌面端可借此调用 HIS 后端服务 |
| `userAgent` | String | 否 | 浏览器 `navigator.userAgent` |
| `timestamp` | Number | 否 | 初始化时间戳 |
| `sdkVersion` | String | 否 | SDK 版本号 |
| `extra` | Object | 否 | HIS 自定义扩展字段，必须包含有效的 `emrAccessToken`；SDK 会把 `$env.globalContext.get('urt')` 原样放入 `extra.urt`。桌面端从 `urt.personCd` 读取真实人员编码/工号，从 `urt.userId`、`urt.personId`、`urt.idDoctor` 等字段读取到的内部主键不得冒充工号 |

请求示例：

```json
{
  "origin": "https://his.hospital.com",
  "href": "https://his.hospital.com/doctor/outpatient",
  "cookie": "SESSION=abc123; JSESSIONID=xyz789",
  "userAgent": "Mozilla/5.0 ...",
  "timestamp": 1704355200000,
  "sdkVersion": "1.0.0",
  "extra": {
    "emrAccessToken": "valid-token-from-his-sdk",
    "urt": {
      "personCd": "0123",
      "userId": "HIS-INTERNAL-USER-ID",
      "userName": "张医生",
      "orgPureName": "示范社区卫生服务中心"
    }
  }
}
```

成功响应：

```json
{
  "status": "success",
  "version": "1.2.8",
  "timestamp": 1704355200100
}
```

失败响应（缺少或无效 `emrAccessToken`）：

```json
{
  "status": "error",
  "message": "SDK 握手失败：缺少有效的 emrAccessToken，桌面应用服务调用已被拒绝"
}
```

实现说明：

1. 桌面端会校验 `extra.emrAccessToken`；仅在 token 有效且非空时才会将浏览器上下文存入 `AppState`。
2. 授权握手成功后，桌面端收到握手会向前端发出 `sdk-handshake` 事件，前端可据此感知 HIS SDK 已连接。
3. 如果握手失败，桌面端会清空已缓存的浏览器上下文，并拒绝后续桌面应用服务调用。
4. 此接口支持重复调用，每次成功调用都会更新存储的浏览器上下文。
5. 推荐 HIS 在页面加载时调用一次，在用户重新登录、刷新 token 或切换组织后再调用一次以刷新授权上下文。
6. 前端初始化 HIS 服务时会保留 `origin` 中 SDK 已提取的 contextPath，只移除 userinfo、query、fragment，并去除末尾多余 `/`；握手的控制台与本地联调日志均不得记录 origin/href 的具体值。

授权门禁说明：

1. 除 `POST /api/handshake` 与 `/sdk/*` 静态文件接口外，其余本地桌面服务接口都要求先完成一次成功握手。
2. 若未握手，或握手中未携带有效的 `extra.emrAccessToken`，桌面端将统一返回 `401 Unauthorized`。
3. 推荐 HIS 仅在收到握手成功响应后，再调用完整问诊、灵活问诊、语音问诊、结果订阅、风险提示及知识代理等桌面服务接口。

### 6.2 `POST /api/consultation/start`

用途：启动完整问诊，并同步当前患者上下文。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/start
```

请求示例：

```json
{
  "idPi": "766842939207974912",
  "idVis": "VIS-20260507-001",
  "chiefComplaint": "咳嗽三天"
}
```

补充说明：

1. `idPi` 是唯一硬要求字段。
2. `idVis` 强烈建议传入，用于区分同一患者的不同就诊。
3. `naPi / sdSexText / ageText`、病历草稿字段、联系方式等都属于可选增强字段；如果 HIS adapter 已正常握手，桌面端会优先按 `idPi` 拉取完整标准化患者上下文。
4. 如果当前没有可用的 HIS adapter，桌面端会直接使用请求体中已有字段，因此建议至少补齐 `naPi / sdSexText / ageText` 作为兜底展示。
5. 未显式列在表格中的患者扩展字段不会被 Bridge 丢弃，会继续透传到前端患者上下文中。

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912"
}
```

实现说明：

1. 此接口会刷新当前患者上下文。
2. 此接口会清空上一条本地结果，避免直接读到旧结果。
3. `全医慧助（PCIE）` 收到后会尝试置顶主窗口并进入完整问诊。
4. 桌面端在接诊上下文校验通过并准备打开完整问诊页时，上报一次 `smart_consultation` 功能调用事件；同一就诊再次显式触发完整问诊入口按新调用计数，统计分析以该事件为事实源，不再从本地 Bridge 日志、问诊用户日志或 AI 代理日志推断。
5. 功能调用事件只保留产品功能、调用场景和必要的医生/机构/版本上下文，不发送顶层 `consultationId`、`payload`、`traceId` 或 `sessionId`。每条事件使用 `crypto.randomUUID()` 生成稳定 `eventId`，本地幂等键对所有功能统一只由功能编码与该 UUID 重建；旧离线队列加载时按允许字段重建，非 UUID 事件 ID 会被替换，调用方原始幂等文本、患者/就诊标识、跨表可关联伪标识、认证凭据以及 query/prompt/message/content/text 等自由文本不会再次落盘或上传。AI 技术链路关联只保留在独立审计链路。
6. `/v1/client/feature-events/batch` 的成功 HTTP 响应仍需逐条核对 `accepted / skipped / rejected / rejections[]`；拒绝项转入本地有界诊断隔离队列，且隔离记录只保存 eventId、featureCode、响应 index、reason 和 rejectedAt。隔离持久化失败、响应结构或计数畸形时保留整批待上传事件，不得静默删除。
7. 应用启动后、执行任何强制更新或后台初始化检查之前，必须同步清洗功能事件主队列和拒绝诊断队列；即使本次因强更、无配置或网络失败不启动上传器，旧 payload、关联标识、原始幂等文本和不可信拒绝原因也不得继续留在本地存储。`eventAction/sourceModule/scene` 只接受有长度上限的技术编码字符，不接受临床自由文本。

### 6.2 `POST /api/consultation/assist`

用途：在当前患者上下文里，直接进入灵活模式中的某个动作。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/assist
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `action` | String | 是 | 支持 `record`(病历记录) / `suggestedDx`(诊断推荐) / `diffDx`(鉴别诊断) / `medication`(用药方案) / `examination`(检查推荐) / `lab_test`(检验推荐) / `procedure`(处置推荐) / `treatment_plan`(诊疗方案聚合推荐) / `reminder`(智能提醒)；历史 `diagnosis / differential` 继续兼容 |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识，强烈建议传入 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本 |
| `ageText` | String | 否 | 年龄文本 |
| 其他患者上下文字段 | Mixed | 否 | 参考第 4 节 |

请求示例：

```json
{
  "action": "suggestedDx",
  "idPi": "766842939207974912",
  "idVis": "VIS-20260507-001",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "action": "suggestedDx",
  "traceId": "his-20260601-101500-abc123"
}
```

实现说明：

1. 当前接口底层仍发出历史事件名 `start-consultation-session`。除 `treatment_plan` / `diffDx` 外，前端落点仍是 `ConsultationPage` 灵活模式；`treatment_plan` 会打开独立诊疗方案推荐页，`diffDx` 会直接打开独立“鉴别排查确认”小窗。
2. 每次 `assist` 调用都会先清空本地结果通道。
3. 如果已经提供 `chiefComplaint + historyOfPresentIllness`，桌面端通常会直接跳过症状采集。
4. `suggestedDx` 是诊断推荐的新接入 action 名，内部复用历史 `diagnosis` 诊断推荐流程；`diffDx` 是鉴别诊断的新接入 action 名，会直接打开独立“鉴别排查确认”弹窗，不进入问诊结果页。
5. 如果触发 `diffDx / differential / medication / examination / lab_test / procedure`，但当前诊断不足，前端会提示医生先补全诊断。
6. `diffDx` 与 `treatment_plan` 要求请求体或当前接诊上下文中已存在 `chiefComplaint`、`historyOfPresentIllness` 与 `diagnosis`；诊断会先按标准诊断库匹配。`treatment_plan` 若无法匹配标准诊断，页面会提示医生不能一键回写诊断。
7. `suggestedDx` 要求已有 `chiefComplaint` 与 `historyOfPresentIllness`，**不要传 `diagnosis`**；如果 HIS 已有当前诊断并希望基于它做鉴别，请使用 `diffDx`。
8. 当前一个 `action` 只负责自动触发一个目标模块，不代表本次问诊到此结束。
9. `examination`、`lab_test`、`procedure` 三路推荐独立加载，各自有独立的 loading 状态和回写 / 引用闭环；`treatment_plan` 会聚合用药、检查、检验、处置四路推荐，并通过 `record-confirmed` 的 `diagList/orderList` 统一回写。
10. 桌面端在接诊上下文校验通过并准备打开目标辅助界面时即上报一次功能调用事件：`suggestedDx/diagnosis` 计入 AI推荐诊断，`diffDx/differential` 计入 AI诊断鉴别，`medication` 计入 AI推荐用药，`examination` 计入 AI推荐检查，`lab_test` 计入 AI推荐检验，`procedure` 计入 AI推荐处置，`treatment_plan` 计入 AI推荐治疗方案。同一就诊再次显式触发同一辅助入口按新调用计数；统计分析以 `/v1/client/feature-events/batch` 入库事件为事实源，后续 AI 生成和回写只用于审计、日志或结果闭环，不重复拆分计数。

#### 单独诊断推荐调用 `action: "suggestedDx"`

用途：HIS 已经有当前患者主诉、现病史等病历上下文，只希望单独打开“诊断推荐”能力，由 `全医慧助（PCIE）` 基于病历生成 AI 诊断建议。此调用不需要、也不建议传入 `diagnosis` 字段。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/assist
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `action` | String | 是 | 固定传 `suggestedDx` |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识，强烈建议传入；后续结果事件与回执都优先以该值作为 `consultationId` |
| `chiefComplaint` | String | 是 | 主诉；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `historyOfPresentIllness` | String | 是 | 现病史；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `allergyHistory` | String | 否 | 过敏史 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本 |
| `ageText` | String | 否 | 年龄文本 |
| `diagnosis` | String | 否 | **不要传入**；诊断推荐会由 AI 基于病历上下文生成 |
| 其他患者上下文字段 | Mixed | 否 | 参考第 4 节，会继续透传到前端患者上下文 |

请求示例：

```json
{
  "action": "suggestedDx",
  "idPi": "766842939207974912",
  "idVis": "VIS-20260601-001",
  "naPi": "张三",
  "sdSexText": "男性",
  "ageText": "38岁",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "allergyHistory": "否认药物过敏史。"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "action": "suggestedDx",
  "traceId": "his-20260601-101500-abc123"
}
```

后续事件：

1. 接口成功只表示桌面端已接收指令并进入诊断推荐流程，不表示 AI 诊断已生成或 PHIS 已保存。
2. 医生在 `全医慧助（PCIE）` 中确认诊断只记录当前页面状态；只有点击“引用诊断”才会产生 `reference-request + referenceType: "diagnosis"`。
3. PHIS 收到诊断引用请求并保存后，必须调用 `POST /api/consultation/reference-feedback` 回执同一个 `consultationId` 与 `requestId`。

#### 单独鉴别诊断调用 `action: "diffDx"`

用途：HIS 已经有当前患者主诉、现病史和诊断草稿，只希望单独打开“鉴别诊断”能力，由 `全医慧助（PCIE）` 基于当前诊断与病历上下文辅助医生做鉴别排查。入参字段与 `treatment_plan` 基本一致。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/assist
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `action` | String | 是 | 固定传 `diffDx` |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识，强烈建议传入 |
| `chiefComplaint` | String | 是 | 主诉；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `historyOfPresentIllness` | String | 是 | 现病史；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `diagnosis` | String | 是 | 当前 HIS 诊断草稿，鉴别诊断会围绕该诊断展开 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `allergyHistory` | String | 否 | 过敏史 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本 |
| `ageText` | String | 否 | 年龄文本 |
| 其他患者上下文字段 | Mixed | 否 | 参考第 4 节，会继续透传到前端患者上下文 |

请求示例：

```json
{
  "action": "diffDx",
  "idPi": "766842939207974912",
  "idVis": "VIS-20260601-001",
  "naPi": "张三",
  "sdSexText": "男性",
  "ageText": "38岁",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "allergyHistory": "否认药物过敏史。",
  "diagnosis": "急性上呼吸道感染"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "action": "diffDx",
  "traceId": "his-20260601-101501-abc124"
}
```

后续事件：

1. 接口成功只表示桌面端已接收指令并进入鉴别诊断流程，不表示 PHIS 已保存。
2. 桌面端会打开独立小窗弹出“鉴别排查确认”，并基于当前诊断、主诉和现病史开始生成鉴别排查建议；不会进入后面的问诊结果页 / 工作站页面。
3. 鉴别诊断本身是医生辅助判断，不直接产生 PHIS 回写；确认结果只记录在 `全医慧助（PCIE）` 页面状态和日志中。
4. 如果医生在诊断推荐卡片上另行点击“引用诊断”，仍按 `reference-request + referenceType: "diagnosis"` 的单项引用闭环处理。

#### 单独诊疗方案推荐调用 `action: "treatment_plan"`

用途：HIS 已经有当前患者主诉、现病史和诊断草稿，只希望单独打开“诊疗方案推荐”页，由 `全医慧助（PCIE）` 基于当前诊断生成用药、检查、检验、处置四类建议，医生勾选后一次性回写给 PHIS。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/assist
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `action` | String | 是 | 固定传 `treatment_plan` |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识，强烈建议传入；后续 `record-confirmed` 与回执都优先以该值作为 `consultationId` |
| `chiefComplaint` | String | 是 | 主诉；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `historyOfPresentIllness` | String | 是 | 现病史；也可来自当前已接诊上下文，但推荐本次调用显式传入 |
| `diagnosis` | String | 是 | 当前 HIS 诊断草稿；桌面端会尝试匹配标准诊断库，无法匹配时会阻止一键回写诊断 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `allergyHistory` | String | 否 | 过敏史 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本 |
| `ageText` | String | 否 | 年龄文本 |
| 其他患者上下文字段 | Mixed | 否 | 参考第 4 节，会继续透传到前端患者上下文 |

请求示例：

```json
{
  "action": "treatment_plan",
  "idPi": "766842939207974912",
  "idVis": "VIS-20260528-001",
  "naPi": "张三",
  "sdSexText": "男性",
  "ageText": "38岁",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "allergyHistory": "否认药物过敏史。",
  "diagnosis": "急性上呼吸道感染"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "action": "treatment_plan",
  "traceId": "his-20260528-101500-abc123"
}
```

后续事件：

1. 接口成功只表示桌面端已接收指令并打开独立诊疗方案页，不表示 AI 推荐已生成或 PHIS 已保存。
2. 页面会基于 `chiefComplaint + historyOfPresentIllness + diagnosis` 并行生成用药、检查、检验、处置四路推荐；任一路失败时只影响该路建议，其它已生成建议仍可勾选回写。
3. 医生点击“一键回写”后，事件流会产生 `record-confirmed`，其中 `requestId` 形如 `record-confirmed-1704355201000`，`referenceType/action` 按 `batch` 语义处理。
4. 选择诊断时 `record-confirmed.diagList` 承载标准诊断，未选择时省略；选择医嘱时 `record-confirmed.orderList` 承载对应药品、检查、检验、处置，未选择任何医嘱时仍返回 `orderList: []`。PHIS 不再按旧分组解析，并以 `writebackScope.orderTypes` 判断是否处理医嘱。
5. PHIS 完成最终调入确认后，必须调用 `POST /api/consultation/reference-feedback`，并带回同一个 `consultationId` 和 `requestId`。回执 `record-confirmed` 时 `referenceType` 可传 `batch`，也可留空由 Bridge 按 `batch` 处理。桌面端收到成功回执后会收起独立诊疗方案页；失败回执会保留当前页面和错误提示，方便医生调整后重试。

诊疗方案回执示例：

```json
{
  "consultationId": "VIS-20260528-001",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "status": "success",
  "message": "PHIS 已完成诊疗方案调入确认",
  "items": [
    {
      "name": "急性上呼吸道感染",
      "code": "J06.900",
      "type": "diagnosis"
    },
    {
      "name": "感冒灵颗粒",
      "type": "medication",
      "idCli": "65b8a81c3c6f492a8908d8d2"
    },
    {
      "name": "血常规",
      "type": "lab_test",
      "idCli": "642546e0fc69e81ae058f3ad"
    }
  ]
}
```

### 6.3 `POST /api/consultation/start-voice`

用途：启动语音接诊胶囊，并可选同步当前患者上下文。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/start-voice
```

请求说明：

1. 请求体可以为空。
2. 如果请求体不为空，`idPi` 是唯一硬要求字段。
3. 推荐同时传 `idVis`；`naPi / sdSexText / ageText` 为可选兜底展示字段。
4. 如果 HIS adapter 已正常握手，桌面端会优先按患者主键补齐标准化上下文。

请求示例：

```json
{
  "idPi": "766842939207974912",
  "idVis": "VIS-20260507-001",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912"
}
```

实现说明：

1. 如果请求体为空，则沿用桌面端当前内存中的患者上下文。
2. 如果当前桌面端没有患者上下文，前端会提示先接诊患者。
3. 语音结果最终通过 `/api/consultation/events/ws` 推送。
4. 未诊毕且未放弃时，同一接诊上下文内再次调用会恢复上一张语音结果页；但桌面端当前接诊切换到其他患者后，上一患者的语音缓存会失效，之后再切回该患者也会重新开始语音问诊。
5. 桌面端在接诊上下文校验通过并准备打开语音问诊页时，上报一次 `voice_consultation` 功能调用事件；同一就诊再次显式触发语音问诊入口按新调用计数，后续提交语音日志不再补记功能统计。
6. 桌面端进入语音流程前会先复用接诊阶段已获取的当前就诊信息和本次门诊病历文本；当 `loadClinicMedicalRecord.applyList[].items[].sdApply === "3"` 表示存在已出报告时，再通过 HIS Adapter 调用 PHIS 报告结果服务 `api/phis.aiInpatientEmrContextService/buildOutpatientFollowUpReportResults`。若本次病历文本和至少一份已报告且有实际结果内容的检验/检查结果均存在，则进入统一报告工作台；医生可自行选择仅查看原始报告、触发 AI 解读，或直接升级到报告回诊后续方案。若已执行解读，后续方案优先使用其结构化处置结论；未执行时使用本次病历和结构化原始报告。诊断只作为可选参考，不再阻断取数或报告解读。否则继续原语音录音问诊。

#### 6.3.1 PHIS 门诊复诊报告结果服务

RPC：

```text
api/phis.aiInpatientEmrContextService/buildOutpatientFollowUpReportResults
```

PHIS 实现位置：

```text
rbmh-phis-boot/src/main/java/com/bsoft/rbmh/phis/ai/AiInpatientEmrContextService.java
```

请求体：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `patientId` / `idPi` | String | 是 | 患者主键 |
| `currentVisitId` / `idVis` | String | 是 | 当前复诊就诊主键 |
| `contextPolicy` | Object | 否 | 裁剪策略，包括 `maxLabReports`、`maxExamReports` |

核心返回字段：

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `followUpEligible` | Boolean | 是否存在可用于报告回诊的已出报告结果 |
| `labReports` | Array | 已出具的检验报告单；按 LIS `idReportGroup` 聚合。每份报告包含时间、完整检验项目结果，以及该报告单覆盖的全部已出结果申请项目 `applications[]`（申请单 ID、名称）。报告单数量不等于开立申请项目数量。 |
| `examReports` | Array | 已出具的检查报告；保留时间、项目名称、检查所见 `finding`、诊断结论 `conclusion` 和可选原报告地址 `reportUrl`。所见或结论可以单独缺失，空字段不返回；只有原报告地址时仍可查看，但不可发起 AI 解读 |
| `ineligibleReason` | String/null | 不满足报告结果获取条件的原因；满足条件时为 `null` |

成功返回示例：

```json
{
  "followUpEligible": true,
  "labReports": [
    {
      "reportTime": "2026-06-21 10:00:00",
      "reportName": "血常规",
      "items": [
        {
          "itemName": "白细胞计数",
          "result": "12.8",
          "unit": "10^9/L",
          "referenceRange": "3.5-9.5",
          "abnormalFlag": "H"
        }
      ]
    }
  ],
  "examReports": [
    {
      "reportTime": "2026-06-21 11:00:00",
      "examName": "胸部CT",
      "finding": "右下肺见斑片状高密度影",
      "conclusion": "右下肺感染性病变",
      "reportUrl": "http://pacs.example/Report/Report/?AccessionNumber=XT0001"
    }
  ],
  "ineligibleReason": null
}
```

复诊有效性规则：

1. 请求必须显式传入患者主键和当前就诊主键；当前就诊信息、诊断参考和本次病历文本由桌面端接诊阶段提供，本服务不再重复返回。
2. 来源就诊必须属于同一患者；报告回诊默认使用当前就诊，不要求排除当前就诊。
3. 检验/检查申请单必须存在实际报告结果；仅开立、执行中或无结果内容的申请单不进入上下文。
   - 桌面端本地分流判断使用 `loadClinicMedicalRecord.applyList[].items[].sdApply === "3"` 识别“已出报告”。
   - `orderList.sdOrd` 只能表示医嘱类型，如检查/检验医嘱，不再作为报告回诊分流条件。
4. PHIS PACS 字段映射固定为：`DIAGNOSTIC_IMAGING -> finding`（影像表现/检查所见）、`CLINICAL_IMPRESSION -> conclusion`（诊断结论）；`RESULT` 和非 URL 的 `REMARK` 只作为其他院区兼容兜底。`REMARK` 中合法的 HTTP(S) 地址映射为 `reportUrl`，不得进入 `finding / conclusion / summary` 或 AI `sourceQuery`。
5. PHIS 与桌面端都必须过滤数据库空值、空白以及 `null / undefined / [NULL]` 空值哨兵。`finding / conclusion` 任一有效即可解读；二者均为空但 `reportUrl` 有效时保留报告供医生打开原报告，AI 解读按钮保持不可用。
6. 检验报告按 `HI_ODS_APPLY.ID_RESULT = HI_ODS_APPLY_LIS_REPORT.ID_REPORT_GROUP` 关联；检查报告按 `HI_ODS_APPLY.ID_APPLY = HI_ODS_APPLY_PACS_REPORT.ID_APPLY` 关联。
7. 仅有检验检查医嘱但没有报告结果时不满足回诊条件。
8. 服务不得返回患者资料、当前就诊摘要、病历正文、候选筛选过程、重复摘要或原始表字段；候选筛选细节只写后端日志。检验报告必须保留报告内完整结果项目，不能仅返回异常项或前若干关键项。
9. PHIS 端只查询当前 `idVis`、当前 `idPi` 且 `sdApply = 3` 的检验检查申请单；无已报告申请单时返回 `ineligibleReason = noReportedApplications`，存在已报告申请单但报告表中没有可用临床内容和原报告地址时返回 `ineligibleReason = noReportResults`。

### 6.3A `POST /api/report/interpret`

用途：触发检验检查报告解读。该接口不会写入问诊事件通道，也不会修改当前问诊页面，而是以独立窗口展示 AI 解读结果。

完整地址：

```text
http://127.0.0.1:8081/api/report/interpret
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `taskId` | String | 是 | 报告任务类型，当前建议使用 `inspectReport` 或 `checkReport` |
| `query` | String | 是 | 报告原始文本，直接拼接“报告日期 / 检查项目 / 阴阳性 / 检查结果 / 影像诊断”等内容；若原文含“门诊编号 / 样本编号 / 送检医生 / 申请时间 / 检验时间 / 检查时间 / 病历”等标签，桌面端会尽量解析到报告单式展示区 |
| `patient` | Object | 否 | 可选患者上下文；当前无接诊患者时建议传入 |

`patient` 支持的推荐字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `idPi` | String | 否 | 患者标识；仅用于日志和窗口标题，不参与事件通道 |
| `idVis` | String | 否 | 当前就诊标识 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本 |
| `ageText` | String | 否 | 年龄文本 |
| `chiefComplaint` | String | 否 | 主诉 |
| `historyOfPresentIllness` | String | 否 | 现病史 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `allergyHistory` | String | 否 | 过敏史 |

请求示例（检验）：

```json
{
  "taskId": "inspectReport",
  "query": "报告日期：2026-05-15\n检验项目：血常规\n门诊编号：00074561\n样本编号：250512003\n申请时间：2026-05-15 10:35\n检验时间：2026-05-15 10:39\n病历：发热、咳嗽 2 天。\n检验结果：\nWBC 12.5×10^9/L ↑（参考范围 3.5-9.5）\nNEUT% 82% ↑（参考范围 40-75）\nCRP 36mg/L ↑（参考范围 0-8）",
  "patient": {
    "naPi": "张三",
    "sdSexText": "男性",
    "ageText": "34岁"
  }
}
```

请求示例（影像/检查）：

```json
{
  "taskId": "checkReport",
  "query": "报告日期：2026-05-15\n检查项目：胸部CT\n门诊编号：00074562\n申请医生：王医生\n申请时间：2026-05-15 11:02\n检查时间：2026-05-15 11:36\n病历：咳嗽、发热 3 天。\n阴阳性：阳性\n检查结果：\n双肺纹理增粗，右下肺见斑片状高密度影。\n影像诊断：\n考虑右下肺感染。"
}
```

联调 mock 样例：

1. `web_project/public/report-interpretation-test.html` 是专用报告解读测试页，提供 Bridge 地址、mock token、报告样例、患者上下文、请求预览和响应日志，可直接调用 `sdk.debugHandshake()` 与 `sdk.interpretReport()`。
2. `web_project/public/mock-his.html` 仍内置“检验/检查报告解读”面板，适合在完整 HIS 联调流程里顺带验证报告解读。
3. 当前样例覆盖 `inspectReport` 检验报告（血常规 + CRP、肝肾功能 + 血脂尿酸、尿常规）和 `checkReport` 检查报告（胸部 CT、膝关节 X 线、头颅 CT）。
4. 样例文本刻意保留 `报告日期`、`检验项目/检查项目`、`门诊编号`、`样本编号`、`申请时间`、`检验时间/检查时间`、`病历`、`检验结果/检查结果`、`影像诊断/检查结论` 等标签，用于同时验证桌面端的结构化提取、异常点提炼和独立窗口展示。

成功响应：

```json
{
  "status": "success",
  "taskId": "checkReport",
  "traceId": "his-xxxxxxxx",
  "timestamp": 1704355200100
}
```

说明：

1. 若当前桌面端存在接诊患者，且请求未显式传入 `patient`，则默认使用当前患者上下文补强 prompt。
2. 若当前桌面端存在接诊患者，且请求同时传入 `patient`，桌面端会以当前患者为主、用显式入参补齐缺失字段；调用方不应借此切换当前接诊患者。
3. 报告解读结果不进入 `/api/consultation/events/ws`，调用方应把它视为桌面端即时展示能力，而不是回写事件。
4. `taskId` 当前仅用于提示词和窗口标题分流：`inspectReport` 偏实验室检验解释，`checkReport` 偏影像/器械检查解释。

### 6.3B `POST /api/inpatient/emr/generate`

用途：触发住院病历辅助生成。该接口只负责把病历生成请求投递到桌面端并打开预览界面；AI 生成、预览编辑和必要的回写前质控确认在前端异步完成，最终结果通过既有事件流返回给 HIS。

完整地址：

```text
http://127.0.0.1:8081/api/inpatient/emr/generate
```

SDK 调用：`sdk.generateInpatientEmr({ admissionId, templateId, templateName, htmlContent, recordTime, doctorSupplement, contextPolicy, hisContext, requestId, patient })`。该 Promise 会在医生点击“一键回写”并产生 `record-confirmed` 时 resolve，返回值与 `record-confirmed` 事件 payload 一致；原有 `mh.on('record-confirmed', ...)` 订阅模式仍保留。三方 HIS 推荐按 [住院电子病历 AI 辅助书写 HIS 对接手册](./docs/his-inpatient-emr-ai-context-integration.md) 组织 `hisContext`。

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `admissionId` | String | 是 | 患者单次住院登记主键，PHIS 对应 `idAdsn` |
| `templateId` | String | 是 | 病历模板主键；后端模板解析缓存以该字段作为唯一缓存依据 |
| `templateName` | String | 是 | 模板名称，如 `日常病程记录`；会随模板解析结果保存到后端模板缓存 |
| `htmlContent` | String | 是 | 当前病历模板 HTML，桌面端会解析其中带 `data-id` 的模板字段；会作为原生模板内容保存到后端，供管理端查看源码和 HTML 预览 |
| `recordTime` | String | 否 | 本次病程记录书写时间，如 `2026-06-10 15:25`；未传时桌面端使用当前系统时间。生成正文会以该日期作为“今日 / 本次查房日期”，避免把历史体温单日期误写成今日 |
| `doctorSupplement` | String | 否 | 医生补充的本次病历书写要点，通常由桌面端“重新生成”弹窗录入或语音转写得到；AI 生成时作为高优先级补充上下文，但仍不得扩展为未提供事实 |
| `allowGenerateWithoutExternalBasis` | Boolean | 否 | 桌面端内部重生成控制字段。入院类模板初次自动生成时若缺少补充要点和门诊正文会等待补充；医生点击“直接重新生成”时置为 `true`，表示已确认仅基于住院聚合上下文继续生成 |
| `contextPolicy` | Object | 否 | 住院上下文裁剪策略，如 `maxDays`、`previousNoteLimit`、`labLookbackDays`、`orderLookbackDays`；用于避免长住院全量数据进入 AI 上下文 |
| `hisContext` | Object | 否 | HIS 直接传入的 AI 上下文包；存在时桌面端优先使用该包中的登记、诊断、体温单、医嘱、检验检查、历史病程摘要等数据，不再强依赖分散住院接口 |
| `requestId` | String | 否 | HIS 侧请求 ID；未传时桌面端会生成 |
| `patient` | Object | 否 | 可选患者兜底信息；住院数据仍优先通过 `admissionId` 走 HIS adapter 获取 |

请求示例：

```json
{
  "admissionId": "69660377a5e9230bbcdc850f",
  "templateId": "emr_tpl_daily_course",
  "templateName": "日常病程记录",
  "recordTime": "2026-06-10 15:25",
  "doctorSupplement": "今日患者咳嗽较前减轻，无胸闷气促；查体双肺呼吸音稍粗，继续当前治疗并复查血常规。",
  "contextPolicy": {
    "maxDays": 7,
    "previousNoteLimit": 3,
    "includePreviousNotes": true,
    "includeLongStaySummary": true,
    "labLookbackDays": 14,
    "orderLookbackDays": 7
  },
  "hisContext": {
    "vitals": {
      "recordDateItems": [],
      "latestBeforeRecordDate": {
        "recordTime": "2026-06-08 14:00",
        "temperature": 39.0,
        "temperatureType": "口温",
        "bloodPressureSystolic": 154,
        "bloodPressureDiastolic": 96
      },
      "summary": "本日体温单暂无记录；最近一次体温单记录为2026-06-08 14:00，体温39.0℃，血压154/96mmHg。"
    },
    "orders": {
      "active": [
        {
          "orderId": "ord-001",
          "name": "安博维",
          "fullText": "安博维 150 mg 雾化吸入 每天两次(BID)",
          "displayText": "安博维 150 mg 雾化吸入 每天两次(BID)",
          "orderType": "药品",
          "status": "护士复核完成",
          "dose": "150",
          "frequency": "每天两次",
          "route": "雾化吸入"
        }
      ],
      "summary": "目前予降压等治疗，长期医嘱执行中。医嘱条目生成时优先使用 displayText；若 displayText/fullText 已包含剂量、用法、频次，不要再重复拼接 dose、route、frequency；不建议返回 frequencyCode、routeCode、orderTypeCode 等字典编码字段。"
    },
    "labs": {
      "abnormal": [
        {
          "reportTime": "2026-06-09 08:30",
          "groupName": "血常规",
          "itemName": "白细胞计数",
          "result": "12.8",
          "unit": "10^9/L",
          "referenceRange": "3.5-9.5",
          "abnormalFlag": "H",
          "clinicalHint": "白细胞计数结果12.8 10^9/L，异常标记：H"
        }
      ],
      "recentKeyResults": [
        {
          "reportTime": "2026-06-09 08:30",
          "groupName": "血常规",
          "abnormal": true,
          "summary": "白细胞计数12.8 10^9/L(H)。",
          "keyItems": [
            {
              "reportTime": "2026-06-09 08:30",
              "groupName": "血常规",
              "itemName": "白细胞计数",
              "result": "12.8",
              "unit": "10^9/L",
              "referenceRange": "3.5-9.5",
              "abnormalFlag": "H"
            }
          ]
        }
      ],
      "summary": "近期待关注检验异常：白细胞计数12.8 10^9/L(H)。"
    },
    "exams": [
      {
        "examTime": "2026-06-09 15:10",
        "examName": "胸部CT",
        "part": "胸部",
        "finding": "双肺纹理增多",
        "conclusion": "考虑支气管炎改变",
        "important": true,
        "summary": "胸部CT(胸部)结论：考虑支气管炎改变；所见：双肺纹理增多"
      }
    ],
    "previousRecords": {
      "recentNotes": [
        {
          "recordTime": "2026-01-13 16:40",
          "recordType": "入院记录",
          "recordName": "入院记录",
          "medType": "0",
          "recordCategory": "入院记录",
          "chiefComplaint": "体检发现血压升高1月",
          "presentIllness": "患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。",
          "structuredSections": {
            "chiefComplaint": "体检发现血压升高1月",
            "presentIllness": "患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。",
            "pastMedicalHistory": "既往高血压病史，否认糖尿病史。"
          },
          "summary": "入院记录；主诉：体检发现血压升高1月；现病史：患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。"
        },
        {
          "recordTime": "2026-06-09 16:00",
          "recordType": "日常病程记录",
          "medType": "1",
          "recordCategory": "病程记录",
          "summary": "患者病情总体平稳，继续原治疗方案。"
        }
      ]
    }
  },
  "htmlContent": "<p data-id=\"病程记录\" data-name=\"病程记录\"><span data-id=\"病程记录文本\" data-type=\"text\" data-name=\"病程记录文本\">病程记录</span></p>",
  "patient": {
    "idPi": "6829c705ef56b10001b6f0b1",
    "naPi": "林娜",
    "sdSexText": "女性",
    "ageText": "35岁"
  }
}
```

HTTP Bridge 受理响应：

```json
{
  "status": "success",
  "admissionId": "69660377a5e9230bbcdc850f",
  "requestId": "inpatient-emr-1704355201000",
  "traceId": "his-xxxxxxxx",
  "timestamp": 1704355200100
}
```

后续事件：

1. 桌面端打开“住院病历生成”界面，医生可看到“获取住院上下文 / 整理诊疗摘要 / 整理病历依据 / 解析病历 / AI 生成”的步骤状态。PHIS 通过 `api/phis.aiInpatientEmrContextService/buildContext` 一次性返回上下文，桌面端调用该 PHIS RPC 时使用数组入参 `[requestMap]`，界面上仅拆分展示处理阶段。
2. 若医生对生成结果不满意，可点击“重新生成”，在桌面端弹窗中手动输入或语音转写补充本次查房要点；桌面端会把补充内容作为 `doctorSupplement` 重新进入 AI 生成，不改变 HIS 原始上下文。若医生未补充要点且点击“直接重新生成”，桌面端会设置 `allowGenerateWithoutExternalBasis = true`，AI 继续基于住院聚合上下文生成，不再停留在“等待补充要点或门诊病历依据”状态。
3. 入院记录场景下，医生可在“重新生成”弹窗里选择一次门诊就诊作为基础资料。门诊历史默认查询近 7 天，并提供近 1 月、近 3 月切换；PHIS `aiAdapterService/queryVisitHistory` 入参在 `params.dtBgn` 中传时间范围，例如 `[{"limit":-1,"params":{"idPi":"患者ID","dtBgn":["2026-06-08 00:00:00","2026-06-15 23:59:59"]}}]`。桌面端只展示同时有有效诊断和门诊病历文书的就诊记录，无诊断或无文书记录会被过滤。当前 PHIS Adapter 会先根据门诊 `idVis` 调用 `api/phis.aiAdapterService/getLookMedList`，入参为 `[{"idApp":"42","idTet":"租户ID","idHospital":"门诊idVis"}]`，并把返回的 `idMedrecdoc / naMed / titleTime / medType / fgCommit` 等映射为门诊病历文书列表；随后按 `idMedrecdoc` 调用 `api/phis.aiAdapterService/getMedContentLook`，入参为 `[{"idApp":"42","idTet":"租户ID","idMedrecdoc":"文书ID","courseShow":0}]`，读取 `body.data.htmlContent` 作为门诊病历正文。正文会用于门诊病历预览，并转换为纯文本作为 AI 参考上下文；若正文接口失败，桌面端才退回只展示文书列表和正文不可用提示。
4. 医生在预览界面确认后点击“一键回写”。桌面端会先执行一轮本地轻量病历质控；无风险项时直接产生 `record-confirmed`，存在风险项时只弹出质控提醒，医生确认继续后再产生 `record-confirmed`。同时 `sdk.generateInpatientEmr(...)` 返回的 Promise 会 resolve 这份 payload。其中 `resultType` 固定为 `record-confirmed`，`referenceType/action` 固定为 `batch`，`emrType` 为 `inpatient-emr`。
5. `record-confirmed.payload.fieldValues` 为 `{ [data-id]: value }` 的结构化字段取值；仅包含本次传入 `htmlContent` 中真实存在、且模板解析结果标记为适合 AI 生成的字段，若医生在预览中编辑过 AI 字段，以编辑后的文本为准。
6. 住院病历回写事件不返回 `htmlContent`；HIS 侧按当前编辑器模板自行用 `data-id` 定位并回填文本。
7. HIS 完成回填后，建议调用 `POST /api/consultation/reference-feedback`，带回相同 `consultationId` 与 `requestId`。回执时 `referenceType` 可传 `batch`，也可留空由 Bridge 按 `batch` 处理；桌面端收到成功回执后会从病历生成界面收起回小球状态。
8. 病程正文生成时，`recordTime` 的日期是“今日 / 本次查房日期”的唯一依据；若体温单最新记录早于该日期，只能表述为“最近一次体温单记录（YYYY-MM-DD）”，不得写成“今日（历史日期）查房”。
9. 历史病历中 `medType=2` 的病案首页不进入 AI 上下文；`medType=0` 入院记录建议提取 `chiefComplaint`、`presentIllness` 和 `structuredSections`，不要只传整篇 HTML 文本。

说明：

1. 模板解析结果按 `templateId` 上传到后端 `/v1/client/inpatient-emr/templates/resolve` 缓存；后端命中时返回缓存字段和管理端维护过的字段提示词。后端不可用或未返回字段时，桌面端使用确定性模板解析兜底，未知字段分类仍通过服务端 LLM 链路完成。
2. 若请求携带 `hisContext`，桌面端优先使用该上下文包；否则必须调用 HIS Adapter 的聚合上下文能力。当前 PHIS Adapter 已直连 `api/phis.aiInpatientEmrContextService/buildContext`；不再回退到既有住院登记、医嘱、体温单分散接口。
3. AI 仅适合生成“病程记录正文”等叙述性字段；患者姓名、住院号、床号、记录时间、医师签名等字段按 HIS / 系统 / 医生签名流程填充。
4. 生成内容是医生审核草稿，不替代医生签署。
5. 轻量质控只影响桌面端是否弹出确认提醒，不改变 `record-confirmed` payload 字段结构；HIS 侧仍按 `fieldValues` 回填当前模板。

### 6.4 SDK 静态文件缓存策略

`/sdk/med-hermes-sdk.js` 与 `/sdk/med-hermes-loader.js` 由本地 Bridge 按当前安装包内置文件直接返回，并带 `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`。Loader 在探测到桌面端版本后，会给本地 SDK URL 追加 `?v=<version>`，避免 HIS 内嵌浏览器在升级安装包后继续执行旧版 SDK。

### 6.4.1 `GET /api/consultation/events/ws`

用途：订阅当前问诊流程的实时事件流。**这是唯一的 HIS 结果回传通道。** HIS 内嵌浏览器必须支持 WebSocket；SDK 不提供 HTTP 长轮询兜底。

完整地址：

```text
ws://127.0.0.1:8081/api/consultation/events/ws
```

可选查询参数：

| 参数 | 类型 | 说明 |
| :--- | :--- | :--- |
| `after` | String | 已消费的上一条 `event.id`。连接建立后，服务端会先补发内存队列中该事件之后的事件；未传时会先推送当前保留的最新事件，再进入实时推送。 |

推送消息：

1. 每条业务消息都是统一的事件 envelope，可能来自完整问诊、病历草稿回写、推荐项引用请求、PHIS 回执或语音问诊确认。
2. 服务端支持浏览器标准 `ping/pong/close` 交互。
3. 客户端重连时应带上最后处理过的 `event.id`，避免漏事件或重复消费。
4. SDK 在 `init()` / `debugHandshake()` 成功后维持这条 WebSocket 为长寿命交互通道；具体业务只复用该通道消费事件，而不是按单次业务临时建链。
5. WebSocket 异常断开后，SDK 先重新握手再建链；握手失败按 `1/2/4/8/16/30 秒`上限指数退避。重连成功后从最后 `event.id` 继续补发，不会并行启动其它结果通道。
6. SDK 会对 `event.id` 做本地去重，业务方监听 `subscribe()` 即可；HIS 仍必须按 `event.id / consultationId / requestId` 做幂等处理。

#### 通用响应 envelope

除 `pending` 场景外，服务端统一返回事件 envelope，不再把业务字段镜像到顶层。

```json
{
  "state": "ready",
  "traceId": "his-abc123",
  "event": {
    "id": "766842939207974912:record-confirmed-1704355201000:record-confirmed:1704355201000",
    "type": "record-confirmed",
    "consultationId": "766842939207974912",
    "requestId": "record-confirmed-1704355201000",
    "timestamp": 1704355201000,
    "terminal": false,
    "payload": {
      "resultType": "record-confirmed",
      "requestId": "record-confirmed-1704355201000",
      "referenceType": "batch",
      "referenceStatus": "pending"
    }
  }
}
```

#### 尚未就绪响应 (超时)

```json
{
  "state": "pending",
  "event": null,
  "message": "Consultation event not available",
  "code": "EVENT_NOT_READY",
  "timestamp": 1704355200000
}
```

以下各类“成功响应”示例为了突出业务字段，只展示 `event.payload` 内容；真实 HTTP 返回会包裹在上一节的统一 envelope 中，通过 `event.type / event.payload` 读取。

#### 成功响应: 病历草稿回写

当前 `draft` 类型仅包含主诉和现病史，不含诊断和治疗方案。

```json
{
  "consultationId": "766842939207974912",
  "timestamp": 1704355200000,
  "resultType": "draft",
  "requestId": "draft-record-1704355200000",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "diagnosisList": [],
  "medications": [],
  "examinations": [],
  "labTests": [],
  "procedures": [],
  "treatmentPlan": "建议结合医生站规则完成最终确认。",
  "medicalSummary": "主诉：咳嗽三天\n现病史：受凉后出现咳嗽、咳痰，无明显呼吸困难。"
}
```

#### 成功响应: 最终报告（已废弃）

> **DEPRECATED**：`final-report` 为历史结构，前端不再产生此 `resultType`。新链路统一使用下文 `record-confirmed`（包含 `diagList`/`orderList` 中性 PHIS 字段）。HIS 侧若仍需兼容旧字段，可读取 `record-confirmed` 后自行映射。

```json
{
  "consultationId": "766842939207974912",
  "timestamp": 1704355200000,
  "resultType": "final-report",
  "requestId": "final-report-1704355200000",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "diagnosisList": [
    {
      "name": "急性支气管炎",
      "code": "J20.900",
      "isTCM": false
    }
  ],
  "medications": [
    {
      "name": "氨溴索",
      "spec": "30mg*20片",
      "usage": "30mg，口服，每日3次"
    }
  ],
  "examinations": [
    {
      "name": "血常规"
    }
  ],
  "labTests": [
    {
      "name": "血常规"
    }
  ],
  "procedures": [
    {
      "name": "雾化吸入治疗"
    }
  ],
  "treatmentPlan": "建议用药：氨溴索；建议检查：血常规",
  "medicalSummary": "主诉：咳嗽三天\n现病史：受凉后出现咳嗽、咳痰，无明显呼吸困难。"
}
```

#### 成功响应: 问诊一键确认回写（record-confirmed）

`record-confirmed` 类型来自问诊最终确认提交。**症状问诊（`ConsultationPage` 完成问诊）、语音问诊（`VoiceConsultationNew` 提交病历）和独立诊疗方案推荐页（`treatment_plan` 聚合推荐后“一键回写”）共用此契约**，由 `src/features/clinical-result/recordConfirmedPayload.ts` 作为唯一构造点产出。共享结果页允许医生选择部分回写范围，但仍只产生一条 `record-confirmed + batch`；`writebackScope` 描述本次选择，未选门诊病历字段和诊断在 payload 中省略，PHIS 必须保持对应原值。为兼容 PHIS 既有遍历逻辑，`orderList` 始终为数组：没有选择任何药品、检查、检验或处置时返回 `[]`，并由 `writebackScope.orderTypes: []` 明确表示本次不处理医嘱，PHIS 不得据此清空既有医嘱。与 `reference-request` 不同，这仍是医生在结果页直接确认后的一次最终提交，不拆成逐项引用请求；PHIS 完成处理后仍必须调用 `POST /api/consultation/reference-feedback` 回执成功或失败。

```json
{
  "consultationId": "766842939207974912",
  "timestamp": 1704355201000,
  "resultType": "record-confirmed",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "action": "batch",
  "referenceStatus": "pending",
  "referenceMessage": "等待 HIS 完成最终回写并回执",
  "writebackScope": {
    "recordFields": ["chiefComplaint", "historyOfPresentIllness", "pastMedicalHistory", "personalHistory", "menstrualHistory", "familyHistory", "physicalExam", "precautions"],
    "includeDiagnosis": true,
    "orderTypes": ["medicine", "exam", "lab_test", "procedure"]
  },
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "pastMedicalHistory": "否认高血压、糖尿病病史。",
  "menstrualHistory": "月经规律，末次月经2026-08-05。",
  "precautions": "注意休息，1周内复诊，必要时上级医院进一步检查治疗。",
  "diagList": [
    {
      "idTet": "test",
      "idDiag": "69e83103fad30474c84dd19c",
      "naDiag": "急性上呼吸道感染",
      "sdDiag": "1",
      "cdIcd10": "J06.900",
      "naIcd10": "急性上呼吸道感染",
      "fgMain": "1",
      "sdDiagText": "西医诊断"
    }
  ],
  "orderList": [
    {
      "doseOnce": "1",
      "unitDose": "粒",
      "idFreq": "ST",
      "idUsge": "405",
      "takeDays": 1,
      "amount": 1,
      "fgSkintest": "0",
      "idDeptExec": "63e0bd493c6f495f34444b69",
      "fgCheckOrd": "1",
      "sdSrv": "11",
      "naSrv": "感冒灵颗粒",
      "idSrv": "65b8a81c3c6f492a8908d8d2"
    },
    {
      "amount": 1,
      "fgCheckOrd": "1",
      "sdSrv": "41",
      "naSrv": "尿常规",
      "idSrv": "642546e0fc69e81ae058f3ad",
      "idDeptExec": "63e0bd493c6f495f34444b69",
      "jsonField": "{\"idLisCategory\":\"63e1e5f362f1a02fb8e76ad8\",\"fgCombination\":\"1\"}",
      "mutualRecognitionCode": "B32R1WZZZ-00"
    },
    {
      "amount": 1,
      "fgCheckOrd": "1",
      "sdSrv": "31",
      "naSrv": "心电图",
      "idPart": "66c59143eda5140001f17fc1",
      "idDeptExec": "63e0bd493c6f495f34444b69",
      "mutualRecognitionCode": ""
    }
  ],
  "treatmentPlan": "用药：对乙酰氨基酚缓释片。检查：深部X线照射。检验：血常规（五分类）。处置：拔罐疗法(火罐)",
  "outpatientRecord": {
    "schemaVersion": "outpatient-record.v1",
    "chiefComplaint": "咳嗽三天",
    "historyOfPresentIllness": "患者3天前受凉后出现咳嗽、咳痰，无胸痛、无呼吸困难，今来就诊。",
    "pastMedicalHistory": "平素体健；否认肝炎史，否认结核史，否认疟疾史，否认其他传染病史；有高血压病史；否认糖尿病史；否认心脏病史；否认脑血管病史；否认肺部疾病史；否认肾脏疾病史；否认其他重大疾病史；否认手术史；否认外伤史；否认输血史；否认食品、药品过敏史。",
    "personalHistory": "否认外地久居史，否认疫水疫源接触史，否认牧区、矿山、高氟区、低碘区居住史，否认化学性物质、粉尘、放射性物质、有毒物质接触史，否认吸毒史，否认吸烟史，否认饮酒史，否认药物嗜好史，否认冶游史。",
    "menstrualHistory": "月经规律，末次月经2026-08-05。",
    "familyHistory": "否认家族重大遗传病史，否认家族肿瘤病史，否认家族传染病史，否认家族精神病史。",
    "physicalExam": "T:{36.5}℃ P:{78}次/分 R:{20}次/分 Bp:{120}/{60}mmHg。双肺呼吸音清，未及干湿啰音。",
    "precautions": "注意休息，1周内复诊，必要时上级医院进一步检查治疗。"
  },
  "recordTemplateChanges": {
    "schemaVersion": "outpatient-record-template-changes.v1",
    "items": [
      {
        "field": "pastMedicalHistory",
        "slotKey": "hypertensionHistory",
        "fromValue": "否认",
        "toValue": "有",
        "templateMarker": "{否认}高血压病史",
        "replacementMarker": "{有}高血压病史"
      }
    ]
  },
  "physicalExamVitalSigns": {
    "schemaVersion": "outpatient-record-physical-exam-vitals.v1",
    "items": [
      { "slotKey": "temperature", "value": "36.5", "unit": "℃", "marker": "{36.5}" },
      { "slotKey": "pulse", "value": "78", "unit": "次/分", "marker": "{78}" },
      { "slotKey": "respiration", "value": "20", "unit": "次/分", "marker": "{20}" },
      { "slotKey": "systolicBloodPressure", "value": "120", "unit": "mmHg", "marker": "{120}" },
      { "slotKey": "diastolicBloodPressure", "value": "60", "unit": "mmHg", "marker": "{60}" }
    ]
  }
}
```

##### record-confirmed 字段说明

`record-confirmed` 将已选诊断收敛到 `diagList`，将已选药品、检查、检验、处置统一收敛到 `orderList`，并通过 `outpatientRecord` 携带医生选择的门诊病历字段。PHIS 不再按旧分组解析；部分回写时病历与诊断以字段是否存在作为更新边界，医嘱以 `writebackScope.orderTypes` 和 `orderList` 内容共同确定范围。

补充说明：

1. `requestId` 是最终回写闭环的唯一请求标识，PHIS 在完成处理后必须带着同一个 `requestId` 调用 `POST /api/consultation/reference-feedback`。
2. `referenceType/action` 在 `record-confirmed` 场景下固定按 `batch` 语义理解，表示本次选择范围通过一条请求一次处理，并不表示每个分组都必然出现。
3. `referenceStatus = pending` 仅表示桌面端已发起最终回写请求，并不代表 HIS 已处理成功；真正成功/失败以后续 `reference-feedback` 回执为准。
4. `diagList.idDiag` 必须是 PHIS 标准诊断目录主键（`ID_DIE`）。桌面端不得把 AI 自由文本、前端临时 key 或 PHIS 草稿文本生成的占位 ID 写入该字段；若当前诊断未匹配标准诊断库，应在提交前拦截并提示医生先切换或重新匹配标准诊断。
5. 非空 `orderList` 必须来自已匹配标准库且通过前置非空校验的用药、检查、检验、处置推荐项。桌面端提交前必须拦截缺少标准服务 ID、服务名称、服务分类编码、执行位置 ID 或医保限用标识的医嘱；药品还必须具备一次剂量、剂量单位、频次 key、用法 key、总量、用药天数和发药药房；检查还必须具备检查部位；检验还必须具备非空检验附加 `jsonField`；处置还必须具备大于 0 的数量。医生手动清空检查 / 检验 / 处置的执行科室，或清空任一医嘱的医保限用后，桌面端必须按当前空输入拦截选中和提交，不得从 `matchedItem.idDeptExec`、`raw.idDeptExec/idDept`、详情 hydrate、默认执行科室或默认医保类型兜底生成必填字段。没有选择任何医嘱时不执行这些校验并返回空数组。
6. `writebackScope.recordFields` 支持 `chiefComplaint / historyOfPresentIllness / pastMedicalHistory / personalHistory / menstrualHistory / familyHistory / physicalExam / precautions`；`includeDiagnosis` 控制 `diagList` 是否出现；`orderTypes` 支持 `medicine / exam / lab_test / procedure` 并控制 `orderList` 中允许出现的类型。`menstrualHistory` 仅适用于女性患者且必须有明确对话或既有病历依据。scope 中未选择的病历和诊断范围必须在 payload 中省略；`orderList` 是唯一例外，固定存在且在 `orderTypes` 为空时为 `[]`。
7. `outpatientRecord` 在完整回写时包含七个通用门诊病历字段，女性患者有明确内容时可额外包含 `menstrualHistory`；在部分回写时只包含 `schemaVersion` 与 `writebackScope.recordFields` 明确选择的字段。该对象不包含 `diagnosisText`；HIS 只更新对象中真实出现的字段，其余保持原值。
8. 为兼容 PHIS 既有的顶层病历字段读取方式，选择 `precautions` 时 `record-confirmed` 同时返回顶层 `precautions`，其值与 `outpatientRecord.precautions` 完全一致；未选择时两处都不出现。主诉、现病史、既往史、月经史和家族史的顶层兼容字段同样只在对应 record field 被选择时出现；男性患者或月经史为空时不得出现 `menstrualHistory`。
9. 没有 `writebackScope` 的历史客户端仍按完整回写契约处理，继续携带完整 `outpatientRecord`、`diagList` 与 `orderList`；PHIS 不得要求旧版本补传 scope。
10. 固定既往史、个人史、家族史模板在桌面端编辑时使用 `{体健}` / `{否认}` / `{有}` 状态槽位；为兼容既有 PHIS，顶层病历字段和 `outpatientRecord` 中发送的是去掉花括号后的自然文本。若医生选择回写的病史字段中存在由明确上下文改为 `{有}` 的槽位，payload 额外携带 `recordTemplateChanges`；PHIS 应优先按 `field + slotKey` 精确更新对应模板值。未选字段不出现在变化清单中；没有变化时整个对象省略。旧 PHIS 可忽略此新增对象并继续读取自然文本。
11. `physicalExam` 固定以 `T:{体温}℃ P:{脉搏}次/分 R:{呼吸}次/分 Bp:{收缩压}/{舒张压}mmHg。` 槽位开头；对话、结构化问诊或本次 HIS 上下文有明确数值时，各槽位分别替换为带花括号的值。花括号是 PHIS 体格检查字段标记，不等同于已确认状态。选择回写体格检查且至少一个槽位已有数值时，payload 额外携带 `physicalExamVitalSigns`；未选择体格检查或仍全部为具名占位词时省略该对象。
12. `prescriptionAttributes.chronicLongTerm = true` 只允许出现在 `chronic-refill` 慢病复诊渠道、本次 `orderList` 至少包含一项已选药品且 HIS 当前患者签约状态明确为已签约时；它是跨 HIS 的中性处方头语义，不是药品明细字段。未签约、签约状态未知、普通语音、症状问诊、独立诊疗方案以及无药回写必须省略该对象并按普通处方处理。PHIS 收到后仍须复用 `searchByIdPiMB` 的签约判定，并校验本次正式诊断是否命中院内慢病长处方诊断配置；校验通过后映射为普通西药 / 中成药处方头 `slowMedicine = "1"`，失败必须回执失败，不得保存成普通处方。后续打印以落库的处方头标志选择慢病长处方版式。
13. 药品回写的分类事实源是 PHIS `HiBdMed.sdMed`：`sdMed=1` 必须映射为西药 `sdSrv=11`，`sdMed=2` 必须映射为中成药 `sdSrv=12`。桌面端在实时目录映射和最终 payload 构造两处执行同一规则；最终构造必须优先使用回写前药品详情补全返回的 `sdMed`，不得因本地匹配缓存缺少 PHIS 私有字段而把中成药回退成 `11`。PHIS 后端再按 `sdSrv` 统一组方：西药与中成药必须分别建方，不受混合开单参数影响；在药品分类、特殊处方类型和发药药房一致的组内，按传入顺序每张最多 5 条药品明细，超出自动新建处方，不合并或丢弃明细。每张拆分处方继承诊断、科室及适用的慢病长处方属性，分别保存、计费与审方，最终仍以原 `requestId` 返回一次回执。

慢病复诊含药回写时额外出现：

```json
{
  "prescriptionAttributes": {
    "chronicLongTerm": true
  }
}
```

**prescriptionAttributes 字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `chronicLongTerm` | Boolean | 慢病长处方语义；仅慢病复诊实际回写药品时为 `true`，PHIS 校验后映射到处方头，不得复制到每条 `orderList` |

**outpatientRecord 字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `schemaVersion` | String | 当前固定为 `outpatient-record.v1` |
| `chiefComplaint` | String | 主诉；与顶层 `chiefComplaint` 保持一致，用于整张病历字段回填 |
| `historyOfPresentIllness` | String | 现病史；与顶层 `historyOfPresentIllness` 保持一致 |
| `pastMedicalHistory` | String | 既往史；与顶层 `pastMedicalHistory` 保持一致 |
| `personalHistory` | String | 个人史 |
| `menstrualHistory` | String | 女性月经史；独立于个人史，仅在有明确内容且被医生选择时出现 |
| `familyHistory` | String | 家族史；与顶层 `familyHistory` 保持一致 |
| `physicalExam` | String | 体格检查；固定保留 T/P/R/BP 槽位标记，明确数值按槽位填入，其余查体正文接在槽位模板后 |
| `precautions` | String | 注意事项 / 健康宣教 / 复诊提示；不等同于 `treatmentPlan` |

**recordTemplateChanges 字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `schemaVersion` | String | 当前固定为 `outpatient-record-template-changes.v1` |
| `items[].field` | String | 固定模板所属病历字段：`pastMedicalHistory / personalHistory / familyHistory` |
| `items[].slotKey` | String | 跨模板文案和标点稳定的槽位标识，例如高血压病史为 `hypertensionHistory` |
| `items[].fromValue` | String | 模板默认状态，当前阳性变化固定为 `否认` |
| `items[].toValue` | String | 本次明确事实对应的状态，当前固定为 `有` |
| `items[].templateMarker` | String | 便于人工排查的原模板片段，例如 `{否认}高血压病史`；PHIS 定位应以 `field + slotKey` 为准 |
| `items[].replacementMarker` | String | 结果页显示片段，例如 `{有}高血压病史`；兼容正文中的实际文本不含花括号 |

**physicalExamVitalSigns 字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `schemaVersion` | String | 当前固定为 `outpatient-record-physical-exam-vitals.v1` |
| `items[].slotKey` | String | 稳定槽位：`temperature / pulse / respiration / systolicBloodPressure / diastolicBloodPressure` |
| `items[].value` | String | 本次明确获取的数值，不含单位；具名占位词不进入 items |
| `items[].unit` | String | 体温为 `℃`，脉搏/呼吸为 `次/分`，血压为 `mmHg` |
| `items[].marker` | String | 与 `physicalExam` 正文对应的独立标记，例如 `{120}`；PHIS 定位应优先使用 `slotKey` |

**diagList 字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `idTet` | String | 透传当前患者上下文中的 `idTet`；若当前上下文缺失则为空字符串 |
| `idDiag` | String | PHIS 标准诊断目录 ID，对应 PHIS `ID_DIE`，不得使用前端临时 ID |
| `naDiag` | String | 诊断名称 |
| `sdDiag` | String | 诊断类型编码，当前西医诊断为 `1`，中医诊断为 `2` |
| `cdIcd10` | String | ICD-10 或诊断编码 |
| `naIcd10` | String | ICD-10 对应名称，当前默认与诊断名称一致 |
| `fgMain` | String | 主诊断标识，主诊断为 `1`，其余诊断为 `0` |
| `sdDiagText` | String | 诊断类型文本，如 `西医诊断`、`中医诊断` |

**orderList 通用字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `amount` | Number | 开立数量；药品 / 处置取推荐项总量，提交前必须为大于 0 的数值；检查 / 检验固定按 `1` 回写 |
| `fgCheckOrd` | String | 医保限用标识，必填；`1` 表示医保使用，`2` 表示自费使用，来自医生在药品 / 检查 / 检验 / 处置推荐项中选择的“医保限用” |
| `sdSrv` | String | 服务分类编码，必填；药品按 PHIS `HiBdMed.sdMed` 映射：`1 -> 11`（西药）、`2 -> 12`（中成药），仅分类事实缺失时兼容回退 `11`；检查默认 `31`，检验默认 `41`，处置默认 `21` |
| `naSrv` | String | 标准服务名称，必填 |
| `idSrv` | String | 服务主键，必填；药品固定使用 `idMedPro`，检查 / 检验 / 处置固定使用 `idCli` |
| `idDeptExec` | String | 执行位置 ID，必填；药品取当前发药药房查询返回的药房 `idSto`，检查 / 检验 / 处置只取医生当前已选执行科室 |
| `memo` | String | 备注；来自医生在药品 / 检查 / 检验 / 处置推荐项中填写的“备注”，桌面端在输入、勾选和提交前校验不超过 200 字符，超限时展示提示并拦截，不在 payload 构造时自动裁剪 |

**药品附加字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `doseOnce` | String | 一次剂量，必填 |
| `unitDose` | String | 剂量单位，必填 |
| `idFreq` | String | 频次 key，必填 |
| `idUsge` | String | 用法 key，必填 |
| `takeDays` | Number | 用药天数，必填且大于 0，缺省时为 `1` |
| `fgSkintest` | String | 皮试标志，默认 `0` |

**检查 / 检验 / 处置附加字段：**

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| `idPart` | String | 检查部位 ID，检查项目必填 |
| `jsonField` | String | 检验附加 JSON，检验项目必填且不能是空对象，常见为 `idLisCategory`、`fgCombination` 等组合信息 |
| `mutualRecognitionCode` | String | 检验检查互认编码；检查 / 检验项目必传，原样来自 `queryAvailableExamLabItems`。空字符串表示该项目不参与互认；处置项目不传 |

#### 成功响应: 引用请求（历史/单项引用）

> 当前一键回写首条请求使用上方 `record-confirmed` 契约；`reference-request` 保留给历史兼容、单项引用，以及检验检查互认的医生中间决策。若 `referenceType` 为 `batch` 且存在 `recognitionDecision`，必须按互认决策处理；否则才按旧批量引用结构处理。

```json
{
  "consultationId": "766842939207974912",
  "timestamp": 1704355203000,
  "resultType": "reference-request",
  "requestId": "ref-batch-1704355203000",
  "referenceType": "batch",
  "action": "batch",
  "referenceStatus": "pending",
  "referenceMessage": "等待 PHIS 保存引用结果",
  "referenceItems": [
    {
      "name": "急性支气管炎",
      "code": "J20.900",
      "type": "diagnosis",
      "isTCM": false
    },
    {
      "name": "阿莫西林胶囊",
      "code": null,
      "type": "medication",
      "idCli": "10023"
    },
    {
      "name": "布洛芬缓释胶囊",
      "code": null,
      "type": "medication",
      "idCli": "10056"
    },
    {
      "name": "血常规",
      "code": null,
      "type": "lab_test",
      "idCli": "20045"
    },
    {
      "name": "胸部X线",
      "code": null,
      "type": "examination",
      "idCli": "30012"
    }
  ],
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "diagnosisList": [
    {
      "name": "急性支气管炎",
      "code": "J20.900"
    }
  ],
  "medications": [
    {
      "name": "阿莫西林胶囊",
      "spec": "0.25g*24粒",
      "usage": "口服，每日3次，每次1粒",
      "idMedPro": "10023"
    },
    {
      "name": "布洛芬缓释胶囊",
      "spec": "0.3g*20粒",
      "usage": "口服，每日2次，每次1粒",
      "idMedPro": "10056"
    }
  ],
  "examinations": [
    {
      "name": "胸部X线",
      "idCli": "30012"
    }
  ],
  "labTests": [
    {
      "name": "血常规",
      "idCli": "20045"
    }
  ]
}
```

> **注意：** `reference-request` 来自 ConsultationPage（表单问诊），其 `medications` / `examinations` / `labTests` / `procedures` 仍是按业务类型拆分的基础字段，不含 PHIS 调入确认扩展字段。而 `record-confirmed` 类型结果已统一收敛为 `orderList`，详见上方字段说明表。

#### 成功响应: 引用回执结果

```json
{
  "consultationId": "766842939207974912",
  "timestamp": 1704355205000,
  "resultType": "reference-feedback",
  "requestId": "ref-batch-1704355203000",
  "referenceType": "batch",
  "action": "batch",
  "referenceStatus": "success",
  "referenceMessage": "PHIS 已成功保存全部引用项目",
  "referenceItems": [
    {
      "name": "急性支气管炎",
      "code": "J20.900",
      "type": "diagnosis",
      "isTCM": false
    },
    {
      "name": "阿莫西林胶囊",
      "code": null,
      "type": "medication",
      "idCli": "10023"
    },
    {
      "name": "布洛芬缓释胶囊",
      "code": null,
      "type": "medication",
      "idCli": "10056"
    },
    {
      "name": "血常规",
      "code": null,
      "type": "lab_test",
      "idCli": "20045"
    },
    {
      "name": "胸部X线",
      "code": null,
      "type": "examination",
      "idCli": "30012"
    }
  ],
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰，无明显呼吸困难。",
  "diagnosisList": [
    {
      "name": "急性支气管炎",
      "code": "J20.900"
    }
  ]
}
```

#### 等待中响应

HTTP 状态码：`200`

```json
{
  "state": "pending",
  "event": null,
  "message": "Consultation event not available",
  "code": "EVENT_NOT_READY"
}
```

字段说明：

| 字段名 | 说明 |
| :--- | :--- |
| `state` | 通用快照状态；当前固定为 `pending` / `ready` / `cancelled` |
| `event` | 当前事件对象；待处理时为 `null` |
| `event.id` | 事件唯一标识，建议 HIS 用它做幂等去重 |
| `event.type` | 当前事件类型，通常与 `event.payload.resultType` 一致 |
| `event.consultationId` | 当前结果/回执锚点，优先等于 `idVis / visitId`，缺失时回退到 `idPi / patientId` |
| `event.requestId` | 请求 ID；草稿、最终回写和引用闭环都通过该字段关联后续处理 |
| `event.timestamp` | 本条事件生成时间戳 |
| `event.terminal` | 当前事件是否已到终态；`reference-request` 和 `referenceStatus = pending` 的 `record-confirmed` 都会返回 `false` |
| `event.payload` | 当前事件的规范化业务 payload |
| `traceId` | Bridge 侧生成的联调链路标识 |
| `timestamp` | 仅 `pending` 场景返回的服务端时间戳 |
| `code` | 待处理或异常语义码，如 `EVENT_NOT_READY` |
| `message` | 当前状态说明或失败原因 |

HIS 处理建议：

1. 必须先校验 `event.consultationId` 是否匹配当前患者。
2. 建议优先按 `event.id` 做去重；如果 HIS 需要自定义幂等键，可退化到 `event.consultationId + event.requestId + event.type + event.timestamp`。
3. 判断“这是一条什么回执”时，建议优先看 `event.type + event.payload.referenceType`：
   - `record-confirmed + batch` = 当前一键回写请求，读取 `diagList/orderList` 完成 PHIS 调入确认
   - `reference-request + batch + recognitionDecision` = 检验检查互认决策，必须与原 `record-confirmed` 使用同一 `requestId`
   - `reference-request + batch + referenceItems` = 旧批量引用请求，按每项 `type` 分类处理
   - `reference-request + diagnosis` = 请求 PHIS 保存诊断（单项引用场景）
   - `reference-feedback + batch` = 一键回写或旧批量引用回执；需结合此前的 `requestId` 对应的是 `record-confirmed` 还是 `reference-request`
   - `reference-feedback + diagnosis` = 诊断保存回执
   - `reference-feedback + medication` = 用药保存回执
   - `reference-feedback + examination` = 检查保存回执
   - `reference-feedback + lab_test` = 检验保存回执
   - `reference-feedback + procedure` = 处置保存回执
4. 收到 `reference-request` 或 `record-confirmed` 后**必须尽快调用 `/reference-feedback` 回执**。回执完成后，`reference-feedback` 确认状态会继续通过同一条 WebSocket 推送。

### 6.5 `POST /api/consultation/reference-feedback`（必须）

用途：PHIS 在处理最终一键回写、历史引用、单项推荐诊断 / 用药 / 检查 / 独立诊疗方案后，**必须**将成功或失败结果回执给 `全医慧助（PCIE）`。

**强制要求：** 每收到一条 `reference-request` 或 `record-confirmed`，PHIS 都必须调用本接口回执。一键回写场景下只回执一次即可；`reference-request` 走批量引用语义，`record-confirmed` 走最终调入确认语义，但两者都通过同一个接口回传成功或失败。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/reference-feedback
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `consultationId` | String | 是 | 当前结果/回执锚点，必须与收到的 `reference-request` 或 `record-confirmed` 保持一致 |
| `requestId` | String | 是 | 对应 `record-confirmed` 或 `reference-request` 中的请求 ID |
| `referenceType` | String | 否 | 建议新接入显式传入的引用对象类型，支持 `diagnosis` / `medication` / `examination` / `lab_test` / `procedure` / `batch`；若回执的是 `record-confirmed`，留空时默认按 `batch` 处理 |
| `action` | String | 否 | 兼容旧版字段，语义与 `referenceType` 相同；`reference-request` 场景下 `referenceType` 与 `action` 至少要传一个；回执 `record-confirmed` 时两者可同时省略 |
| `status` | String | 是 | `success` / `failed` / `pending` / `cancelled`；`pending` 仅用于检验检查互认的医生中间决策，`cancelled` 表示医生取消互认决策 |
| `message` | String | 否 | 成功说明或失败原因 |
| `items` | Array | 否 | `pending` 时为可互认项目列表；最终状态时为本次实际保存项目列表。SDK 第四参数 `recognizableItems/items` 会写入此字段 |

互认 `pending` 请求示例：

```json
{
  "consultationId": "766842939207974912",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "action": "batch",
  "status": "pending",
  "message": "存在可互认的检验检查项目，请医生在智医端决策",
  "items": [
    {
      "idSrv": "LAB-001",
      "idCli": "LAB-001",
      "naSrv": "血常规",
      "naCli": "血常规",
      "sdSrv": "41",
      "mutualRecognitionCode": "B32R1WZZZ-00",
      "priceSale": 20.0
    }
  ]
}
```

请求示例（record-confirmed batch 回执）：

```json
{
  "consultationId": "766842939207974912",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "action": "batch",
  "status": "success",
  "message": "PHIS 已完成最终调入确认",
  "items": [
    {
      "name": "急性支气管炎",
      "code": "J20.900",
      "type": "diagnosis"
    },
    {
      "name": "阿莫西林胶囊",
      "type": "medication",
      "idCli": "10023"
    },
    {
      "name": "血常规",
      "type": "lab_test",
      "idCli": "20045"
    }
  ]
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "timestamp": 1704355205000
}
```

异常响应：没有匹配到待处理回写或引用请求

HTTP 状态码：`409`

```json
{
  "status": "error",
  "code": "REFERENCE_REQUEST_MISMATCH",
  "message": "No matching pending reference request for current consultation result"
}
```

实现说明：

1. 当前回执必须匹配“最新一条结果”里的 `requestId`，且其 `resultType` 必须还是 `reference-request` 或 `record-confirmed`。
2. 如果 HIS 传错 `consultationId` 或 `requestId`，会返回 `409 REFERENCE_REQUEST_MISMATCH`。
3. `referenceType` 与 `action` 如果同时传入，语义必须一致；不一致时接口会返回 `400 INVALID_REFERENCE_TYPE`。若当前待确认结果是 `record-confirmed` 且两者都未传，服务端会默认按 `batch` 处理。
4. `status = pending` 只允许用于当前待处理 `record-confirmed + batch` 的检验检查互认中间态；桌面端不会把它当成最终回执。`items` 中至少应包含 `idSrv / naSrv / sdSrv / mutualRecognitionCode`，也兼容 `idCli / naCli / priceSale`。
5. `status = failed` 时应把失败原因写进 `message`；`status = cancelled` 时应说明医生取消了互认决策。两者都会保留当前页面现场。
6. 如果想让页面上的逐项“已引用/引用失败”状态更准确，建议原样回传本次成功或失败的 `items`。

互认决策 `reference-request` payload：

```json
{
  "resultType": "reference-request",
  "consultationId": "766842939207974912",
  "requestId": "record-confirmed-1704355201000",
  "referenceType": "batch",
  "action": "batch",
  "referenceStatus": "pending",
  "recognitionDecision": {
    "decision": "recognize",
    "recognizedItemIds": ["LAB-001"]
  }
}
```

`recognitionDecision.decision` 取值：

| 值 | 含义 | `recognizedItemIds` |
| :--- | :--- | :--- |
| `recognize` | 互认全部或部分项目 | 必填，填写医生勾选项目的 `idSrv` 列表 |
| `not_recognize` | 本次项目均不互认 | 省略 |
| `cancel` | 医生取消本次互认决策 | 省略 |

### 6.6 `POST /api/consultation/stop`

用途：通知桌面端结束当前接诊上下文。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/stop
```

请求示例：

```json
{}
```

成功响应：

```json
{
  "status": "success",
  "message": "Consultation stopped"
}
```

实现说明：

1. 此接口会清空当前接诊上下文，并视为当前接诊已诊毕。
2. 若当前接诊存在语音问诊缓存或问诊最小化恢复入口，此接口会同步清除；单次一键回写成功不会清除语音缓存。
3. 适合在 HIS 切换患者、结束当前接诊、退出本次联调时调用。
4. 它不会回放历史结果，也不是持久化归档接口。

### 6.7 `POST /api/patient/risks`（可选）

用途：把 HIS 当前患者的风险信息推送到 `全医慧助（PCIE）`，触发患者风险评估提醒。

完整地址：

```text
http://127.0.0.1:8081/api/patient/risks
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `idPi` | String | 是 | 患者唯一标识 |
| `idVis` | String | 否 | 当前就诊唯一标识，强烈建议传入 |
| `naPi` | String | 否 | 患者姓名 |
| `sdSexText` | String | 否 | 性别文本，如 `男性` / `女性` |
| `ageText` | String | 否 | 年龄文本，如 `65岁` |
| `chiefComplaint` | String | 否 | 主诉 |
| `historyOfPresentIllness` | String | 否 | 现病史 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `diagnosis` | String | 否 | 当前诊断 |
| `allergyHistory` | String | 否 | 过敏史 |
| `risks` | RiskItem[] | 否 | 预计算的风险项（若为空数组或不传，则由 LLM 自动分析） |

#### RiskItem 结构

当 HIS 已经有风险评估结果时，可以通过 `risks` 数组直接注入，跳过 LLM 分析：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `level` | Number | 是 | 风险等级：`1` = 红色（高危），`2` = 橙色（中危），`3` = 黄色（低危） |
| `category` | String | 是 | 风险类别：`allergy`（过敏）/ `chronic`（慢病）/ `medication`（用药）/ `population`（特殊人群）/ `vital`（体征）/ `other`（其他） |
| `content` | String | 是 | 风险描述文本，直接展示给医生 |

#### 两种使用方式

**方式一：HIS 传入患者信息，由 LLM 自动分析风险**

适用于 HIS 没有自己的风险评估引擎的场景。`risks` 传空数组或不传。

```json
{
  "idPi": "766842939207974912",
  "idVis": "VIS-20260507-001",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰",
  "pastMedicalHistory": "高血压10年，糖尿病5年",
  "diagnosis": "急性支气管炎",
  "allergyHistory": "青霉素过敏",
  "risks": []
}
```

**方式二：HIS 直接注入预计算的风险项**

适用于 HIS 已有风险评估结果的场景，前端直接展示，不再调用 LLM。

```json
{
  "idPi": "766842939207974912",
  "idVis": "VIS-20260507-001",
  "allergyHistory": "青霉素过敏",
  "risks": [
    {
      "level": 1,
      "category": "allergy",
      "content": "青霉素过敏，当前处方含阿莫西林，存在交叉过敏风险"
    },
    {
      "level": 2,
      "category": "chronic",
      "content": "高血压合并糖尿病，需关注肾功能指标"
    },
    {
      "level": 3,
      "category": "population",
      "content": "65岁以上老年患者，用药剂量需酌减"
    }
  ]
}
```

补充说明：

1. `idPi` 是唯一硬要求字段。
2. `idVis` 强烈建议传入，用于让风险提醒、语音缓存、最小化会话都能锚定到当前就诊。
3. `naPi / sdSexText / ageText` 和各类病历上下文字段都属于可选增强字段；如果 HIS adapter 已正常握手，桌面端会优先按患者主键拉取标准化上下文。
4. 如果请求里已经带了 `risks` 且非空，前端会直接展示这些预计算风险项，不再调用 LLM。
5. 其他患者扩展字段也会被 Bridge 原样透传到前端，后续可参与患者上下文标准化和提示词构建。

成功响应：

```json
{
  "status": "success",
  "idPi": "766842939207974912"
}
```

#### 前端展示行为

1. 收到请求后，`全医慧助（PCIE）` 会置顶窗口并展示风险提醒面板。
2. 风险项按 `level` 排序展示（红色在前，黄色在后）。
3. 如果存在 level 1 或 level 2 的高危/中危风险，医生必须手动点击"我已知悉"才能关闭面板。
4. 如果仅有 level 3 低危风险，面板将在 10 秒后自动关闭。

该接口不是问诊主链路必需项，可以后补。

## 7. `resultType` 处理约定

HIS 侧至少要识别以下 5 类结果：

| `resultType` | 含义 | HIS 建议动作 |
| :--- | :--- | :--- |
| `draft` | 病历草稿回写（早期病历字段） | 回填主诉、现病史等医生站草稿字段 |
| `final-report` | 【已废弃】完整问诊最终报告（含诊断、治疗方案） | 仅作历史兼容，新链路不产生此类型，统一使用 `record-confirmed` |
| `record-confirmed` | 问诊一键确认回写（`orderList` 统一格式） | 直接用于 PHIS 调入确认弹窗，不走 `reference-request` 引用请求 |
| `reference-request` | `全医慧助（PCIE）` 请求 PHIS 保存引用，或回传检验检查互认决策 | 先判断 `recognitionDecision`，否则按历史 / 单项引用处理，并准备最终回执 |
| `reference-feedback` | PHIS 回执后的最新状态 | 更新医生站状态，提示成功或失败 |

补充说明：

1. `draft` 仅携带主诉 / 现病史等早期字段；`record-confirmed` 携带 `writebackScope` 以及本次实际选择的 `outpatientRecord / diagList`，并固定携带数组 `orderList`。历史客户端未传 scope 时仍按三部分完整结构处理。`final-report` 仅作历史兼容保留，新代码不再产生。
2. `record-confirmed` 来自问诊结果确认提交或独立诊疗方案推荐提交，其 `diagList` 和 `orderList` 已转换成 PHIS 可直接消费的结构。PHIS 收到后可直接按 `fgMain` 识别主诊断并生成病历诊断行，再按 `sdSrv`、`idSrv`、`idDeptExec`、`doseOnce`、`idFreq`、`idUsge`、`jsonField`、`idPart` 等字段填充调入确认弹窗，无需二次补录。
3. `reference-request` 和 `reference-feedback` 都可能附带同一份病历上下文，便于 HIS 在当前界面直接处理。
4. 对回写 / 引用闭环结果，HIS 应继续结合 `resultType + referenceType` 判断具体业务对象，不建议只看 `referenceType`。
5. 当前一键回写场景下，`record-confirmed.referenceType/action` 为 `batch`；`diagList` 仅在选择诊断时出现，`orderList` 始终出现且仅包含 `writebackScope.orderTypes` 范围内医生已经选中的治疗项目，未选择时为 `[]`。互认决策使用 `reference-request + batch + recognitionDecision`；旧批量引用才使用 `referenceItems` 按 `type` 区分业务类型。单项引用场景下 `referenceType` 仍为具体类型（如 `diagnosis`）。

## 8. WebSocket 订阅与去重策略

推荐策略：

1. HIS 页面初始化后调用 SDK `init()` 或 `debugHandshake()`，SDK 建立 `/api/consultation/events/ws` 长寿命交互通道；所在容器必须支持 WebSocket。
2. `subscribe()` 只负责声明“当前页面要消费哪些事件”，不再等同于“临时创建一条新的业务专用 WebSocket”。
3. 调用 `/start`、`/assist` 或 `/start-voice` 成功后，继续复用同一条通道接收事件。
4. WebSocket 断开时，SDK 会携带最后处理过的 `event.id` 自动重连；握手失败使用最高 30 秒的指数退避，重连成功后由内存事件队列补发未消费事件。
5. 收到 `reference-request` 或 `record-confirmed` 后，PHIS 必须调用 `/reference-feedback` 回执；回执会继续通过同一事件流推送。
6. SDK 内部已封装连接、重连、补发和去重逻辑，HIS 接入建议直接使用 SDK 的事件监听。

推荐唯一键：

```text
consultationId + resultType + requestId + timestamp
```

## 9. 联调注意事项

1. 当前完整 HIS 联调参考页是 `web_project/public/mock-his.html`；报告解读专用测试页是 `web_project/public/report-interpretation-test.html`；SDK 位于 `sdk/med-hermes-sdk.js`。
2. `consultationId` 当前来自 HIS 下发的就诊锚点或患者标识；HIS 侧应尽量传入 `idVis / visitId`，并防止缺失就诊锚点时“同患者旧结果误命中当前就诊”。
3. `/assist` 每次调用都会重置当前业务上下文；不要在上一动作事件尚未消费完成时复用旧状态。
4. `reference-feedback` 只接受与“当前最新待处理回写或引用请求”匹配的回执。
5. 当前页面恢复依赖同一运行期内的前端内存状态；如果 `全医慧助（PCIE）` 进程已经退出或重启，不保证还能恢复到回执前页面。
6. `全医慧助（PCIE）` 内所有推荐结果本质上都是医生确认前的草稿，HIS / PHIS 仍应保留最终校验与保存逻辑。

## 10. 最小接入示例

### 10.1 启动完整问诊

```bash
curl -X POST 'http://127.0.0.1:8081/api/consultation/start' \
  -H 'Content-Type: application/json' \
  -d '{
    "idPi": "766842939207974912",
    "naPi": "张虎",
    "sdSexText": "男性",
    "ageText": "19岁",
    "department": "呼吸内科",
    "chiefComplaint": "咳嗽三天"
  }'
```

### 10.2 订阅结果事件

```js
const unsubscribe = mh.subscribe((envelope) => {
  console.log(envelope.event?.type, envelope.event?.payload);
});
```

### 10.3 回执最终一键回写结果（record-confirmed batch）

```bash
curl -X POST 'http://127.0.0.1:8081/api/consultation/reference-feedback' \
  -H 'Content-Type: application/json' \
  -d '{
    "consultationId": "766842939207974912",
    "requestId": "record-confirmed-1704355201000",
    "referenceType": "batch",
    "action": "batch",
    "status": "success",
    "message": "PHIS 已完成最终调入确认",
    "items": [
      {
        "name": "急性支气管炎",
        "code": "J20.900",
        "type": "diagnosis"
      },
      {
        "name": "阿莫西林胶囊",
        "type": "medication",
        "idCli": "10023"
      }
    ]
  }'
```

## 11. 推荐验收清单

HIS 接入完成后，至少验证以下场景：

1. `POST /start` 能唤起完整问诊
2. `POST /assist` 能进入对应灵活模式阶段
3. 单独诊断推荐：`POST /assist` 使用 `action: "suggestedDx"` 且不传 `diagnosis`，可打开诊断推荐流程；医生点击“引用诊断”后能先收到 `reference-request + referenceType: "diagnosis"`
4. 单独鉴别诊断：`POST /assist` 使用 `action: "diffDx"` 并传入 `diagnosis`，可直接打开独立“鉴别排查确认”弹窗；确认鉴别不直接产生 PHIS 回写
5. `/result` 能回收到当前患者的 `draft` 或 `record-confirmed`
6. PHIS 调用 `/reference-feedback` 后，`/result` 能继续返回 `reference-feedback`
7. 一键回写场景：PHIS 收到一条 `record-confirmed + referenceType/action: "batch"`，按 `writebackScope` 只处理 payload 中实际出现的 `outpatientRecord / diagList` 和 `orderTypes` 指定的 `orderList` 内容；空 `orderTypes + orderList: []` 时保持原医嘱，回执后页面显示“一键回写完成”
8. 切换患者后不会把上一位患者的结果误回填到当前医生站
9. 问诊一键确认回写：PHIS 收到 `resultType: "record-confirmed"` 结果后，可安全直接遍历始终存在的 `orderList`。非空时其中药品、检查、检验、处置已经统一转换成 PHIS 调入确认格式，可直接用于回填弹窗；为空且 `writebackScope.orderTypes` 为空时不处理、不得清空 HIS 原医嘱
10. 独立诊疗方案推荐：`POST /assist` 使用 `action: "treatment_plan"` 可打开聚合方案页；医生勾选后同样产生 `record-confirmed + referenceType: "batch"`，PHIS 按第 9 条处理并回执

如果你们 HIS 需要，我建议下一步可以再按这份文档继续拆一版“给后端开发直接对接的字段清单”和“一版给联调测试直接执行的验收用例”。
