# 全医慧助（PCIE）标准接入文档

> 最后更新: 2026-03-23
>
> 本文档用于给 HIS / 医生站 / PHIS 后端开发、联调测试、项目实施直接对接使用。
> 当前详细运行契约仍以 [api.md](./api.md) 与 `src-tauri/src/http_server.rs` 为准；本文档是标准接入口径，不替代底层真实契约。
> 历史 `MedHermes` / `med-hermes` 名称仅作为 SDK、深链和 Header 等兼容技术标识保留。

门诊动态模板接入请使用 [HIS 接入接口：病历模板上传与最终回写](docs/his-outpatient-emr-template-integration.md)：先看模板如何随 `start-voice` 或 `outpatient/emr/analyze` 上传，再看 WebSocket 最终回写、HIS 实际保存与 `reference-feedback` 回执；附完整请求、响应和回写 JSON。

## 1. 文档目的

本文档回答 5 个问题：

1. HIS 应该按什么顺序接入全医慧助（PCIE）
2. 接入时最少需要准备哪些患者字段
3. 本地 HTTP Bridge 暴露了哪些标准接口
4. 推荐诊断 / 用药 / 检查的引用闭环怎么做
5. 联调完成后应该如何验收

## 2. 接入概览

### 2.1 当前对接方式

全医慧助（PCIE）当前通过本地 HTTP Bridge 与 HIS 对接：

- 服务地址：`http://127.0.0.1:8081`
- 接口前缀：`/api`
- 协议：REST 命令 + WebSocket 结果事件流
- 数据格式：`application/json`
- 编码：`UTF-8`

### 2.2 接入前提

1. 医生本机必须先启动全医慧助（PCIE），否则本地接口不可访问。
2. 当前服务只监听 `127.0.0.1`，默认只供本机 HIS / 联调页调用。
3. `/api/consultation/events/ws` 是唯一结果回传通道；桌面端保留有限内存事件队列供断线重连补发，不提供 HTTP 长轮询。
4. 普通接诊的 `consultationId` 默认使用 `idPi / patientId`；动态门诊模板最终结果和回执使用本次就诊 ID（`consultationId = visitId`），详见上述专题接口说明。

### 2.3 标准接入建议

建议按以下 3 步推进：

1. 先接 `POST /api/consultation/start` + `GET /api/consultation/events/ws`
2. 再接 `POST /api/consultation/assist`，打通灵活模式
3. 最后接 `POST /api/consultation/reference-feedback`，完成 PHIS 引用闭环

## 3. 标准字段

### 3.1 患者上下文标准字段

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `idPi` | String | 是 | 患者唯一标识 |
| `naPi` | String | 是 | 患者姓名 |
| `sdSexText` | String | 是 | 性别文本，如 `男性` / `女性` |
| `ageText` | String | 是 | 年龄文本，如 `19岁` |
| `department` | String | 否 | 当前科室 |
| `idCard` | String | 否 | 身份证号 |
| `mobilePhone` | String | 否 | 联系电话 |
| `allergyHistory` | String | 否 | 过敏史 |
| `chiefComplaint` | String | 否 | 主诉 |
| `historyOfPresentIllness` | String | 否 | 现病史 |
| `pastMedicalHistory` | String | 否 | 既往史 |
| `diagnosis` | String | 否 | 当前 HIS 诊断草稿 |
| `vitals` | String | 否 | 体征摘要 |

### 3.2 兼容字段别名

当前桥接层兼容以下别名：

| 推荐字段 | 兼容别名 |
| :--- | :--- |
| `idPi` | `patientId` |
| `naPi` | `name` |
| `sdSexText` | `gender` |
| `ageText` | `age` |

建议：

1. 新接入统一使用标准字段名。
2. HIS 如果已有 `encounterId / visitId`，需要在 HIS 本地自行维护与 `consultationId` 的映射。
3. 不要假设当前接口原生支持“同患者多次接诊隔离”。

## 4. 标准接入流程

### 4.1 基础接诊流程

1. HIS 选中患者后调用 `POST /api/consultation/start`
2. 调用成功后通过 SDK 订阅 `GET /api/consultation/events/ws`
3. 收到 `draft` 或 `final-report` 后回填医生站草稿

适用场景：

- 从完整问诊开始
- 目标是生成病历草稿、初步诊断、用药建议、检查建议

### 4.2 灵活模式流程

1. HIS 在当前患者上下文下调用 `POST /api/consultation/assist`
2. 传入 `action`
3. 继续复用同一条 WebSocket 订阅
4. 如收到 `reference-request`，说明医生在全医慧助（PCIE）中发起了引用

`action` 支持：

- `record`
- `diagnosis`
- `differential`
- `medication`
- `examination`
- `reminder`

适用场景：

- 医生已在 HIS 中录入部分病历，只想快速拿某类 AI 建议
- 不希望再开第二套独立问诊窗口

### 4.3 PHIS 引用闭环流程

1. HIS / PHIS 通过 WebSocket 收到 `reference-request`
2. 读取 `requestId`、`referenceType`、`referenceItems`
3. 在 HIS / PHIS 内完成保存
4. 保存成功或失败后调用 `POST /api/consultation/reference-feedback`
5. 全医慧助（PCIE）收到回执后更新页面状态
6. HIS 通过同一条 WebSocket 收到 `reference-feedback`

这是当前推荐诊断 / 用药 / 检查真正写入业务系统的闭环。

## 5. 接口标准

### 5.1 `POST /api/consultation/start`

用途：启动完整问诊，并同步当前患者上下文。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/start
```

请求示例：

```json
{
  "idPi": "766842939207974912",
  "naPi": "张虎",
  "sdSexText": "男性",
  "ageText": "19岁",
  "department": "呼吸内科",
  "chiefComplaint": "咳嗽三天"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912"
}
```

处理说明：

1. 会刷新当前患者上下文。
2. 会清空上一条本地结果。
3. 桌面端会尝试置顶并进入完整问诊。

### 5.2 `POST /api/consultation/assist`

用途：在当前患者上下文里直接进入灵活模式中的某个动作。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/assist
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `action` | String | 是 | `record` / `diagnosis` / `differential` / `medication` / `examination` / `reminder` |
| `idPi` | String | 是 | 患者唯一标识 |
| `naPi` | String | 是 | 患者姓名 |
| `sdSexText` | String | 是 | 性别文本 |
| `ageText` | String | 是 | 年龄文本 |
| 其他患者字段 | Mixed | 否 | 见第 3 节 |

请求示例：

```json
{
  "action": "diagnosis",
  "idPi": "766842939207974912",
  "naPi": "张虎",
  "sdSexText": "男性",
  "ageText": "19岁",
  "department": "呼吸内科",
  "chiefComplaint": "咳嗽三天",
  "historyOfPresentIllness": "受凉后出现咳嗽、咳痰",
  "pastMedicalHistory": "高血压10年",
  "diagnosis": "急性支气管炎"
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "action": "diagnosis"
}
```

处理说明：

1. 每次调用都会清空旧结果通道。
2. 如果已传入 `chiefComplaint + historyOfPresentIllness`，前端通常会跳过症状采集。
3. 如果触发 `differential / medication / examination` 但诊断不足，前端会提示医生先补全诊断。

### 5.3 `POST /api/consultation/start-voice`

用途：启动语音接诊胶囊。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/start-voice
```

说明：

1. 请求体可以为空。
2. 若不为空，字段结构与 `/start` 基本一致。
3. 语音接诊结果最终通过 `GET /api/consultation/events/ws` 推送。

### 5.4 `GET /api/consultation/events/ws`

用途：订阅问诊、回写与 PHIS 回执事件。

完整地址：

```text
ws://127.0.0.1:8081/api/consultation/events/ws
```

结果说明：

1. 这是当前唯一结果回传通道，HIS 内嵌浏览器必须支持 WebSocket。
2. SDK 断线后会先重新握手，再按最高 30 秒的指数退避重连，并携带最后消费的 `event.id` 补发。
3. HIS 必须按 `event.id` 做去重，并校验 `consultationId` 与当前患者/就诊一致。

#### 结果类型

| `resultType` | 含义 | HIS 建议动作 |
| :--- | :--- | :--- |
| `draft` | 病历草稿回写 | 回填主诉、现病史、诊断和建议 |
| `final-report` | 完整问诊最终报告 | 作为完整结构化结果回写 |
| `reference-request` | 全医慧助（PCIE）请求 PHIS 保存引用 | 调用 PHIS 保存，并准备回执 |
| `reference-feedback` | PHIS 回执后的最新状态 | 更新医生站状态，提示成功或失败 |

#### 重点字段

| 字段名 | 说明 |
| :--- | :--- |
| `consultationId` | 当前患者标识，现阶段默认等于 `idPi / patientId` |
| `timestamp` | 本条结果生成时间戳 |
| `requestId` | 引用闭环请求 ID，仅引用相关结果存在 |
| `referenceType` | 引用对象类型，支持 `diagnosis` / `medication` / `examination` |
| `action` | 兼容旧版字段，语义与 `referenceType` 相同 |
| `referenceStatus` | 引用状态，常见值 `pending` / `success` / `failed` |
| `referenceMessage` | 当前状态说明或失败原因 |
| `referenceItems` | 引用闭环中的结构化项目列表 |

#### 处理规则

1. 必须先校验 `consultationId` 是否匹配当前患者。
2. 判断回执类型时，建议优先看 `resultType + referenceType`。
3. 收到 `reference-request` 后保持 WebSocket 订阅，继续等待 `reference-feedback`。
4. WebSocket 断线时由 SDK 携带最后 `event.id` 自动重连；业务侧不另起 HTTP 结果请求。

### 5.5 `POST /api/consultation/reference-feedback`

用途：PHIS 保存推荐诊断 / 用药 / 检查后，把成功或失败结果回执给全医慧助（PCIE）。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/reference-feedback
```

请求字段：

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :--- | :--- |
| `consultationId` | String | 是 | 当前患者 / 当前问诊标识 |
| `requestId` | String | 是 | 对应 `reference-request` 中的请求 ID |
| `referenceType` | String | 否 | 建议新接入显式传入，支持 `diagnosis` / `medication` / `examination` |
| `action` | String | 否 | 兼容旧版字段，语义与 `referenceType` 相同 |
| `status` | String | 是 | `success` / `failed` |
| `message` | String | 否 | 成功说明或失败原因 |
| `items` | Array | 否 | 本次实际保存项目列表 |

请求示例：

```json
{
  "consultationId": "766842939207974912",
  "requestId": "ref-diagnosis-1704355203000",
  "referenceType": "diagnosis",
  "action": "diagnosis",
  "status": "success",
  "message": "PHIS 已成功保存诊断",
  "items": [
    {
      "name": "急性支气管炎",
      "code": "J20.900",
      "type": "diagnosis"
    }
  ]
}
```

成功响应：

```json
{
  "status": "success",
  "consultationId": "766842939207974912",
  "requestId": "ref-diagnosis-1704355203000",
  "referenceType": "diagnosis",
  "timestamp": 1704355205000
}
```

异常说明：

| HTTP 状态码 | `code` | 说明 |
| :--- | :--- | :--- |
| `400` | `INVALID_REFERENCE_TYPE` | `referenceType` 与 `action` 同时传入但不一致，或两者都没传 |
| `409` | `REFERENCE_REQUEST_MISMATCH` | 当前没有匹配的待处理引用请求 |

处理说明：

1. 当前回执必须匹配“最新一条结果”里的 `requestId`。
2. 当前回执必须匹配“最新一条结果”里的 `referenceType`。
3. 建议失败时把失败原因写进 `message`。
4. 建议原样回传成功或失败的 `items`，便于页面逐项更新状态。

### 5.6 `POST /api/consultation/stop`

用途：结束当前接诊上下文。

完整地址：

```text
http://127.0.0.1:8081/api/consultation/stop
```

成功响应：

```json
{
  "status": "success",
  "message": "Consultation stopped"
}
```

适用场景：

1. HIS 切换患者
2. 结束当前接诊
3. 退出本次联调

### 5.7 `POST /api/patient/risks`（可选）

用途：把 HIS 当前患者风险信息推送到全医慧助（PCIE），用于风险提醒展示。

该接口不是主链路必需项，可以后补。

## 6. 推荐订阅与去重策略

推荐策略：

1. 页面初始化并握手成功后，通过 SDK 建立 `/api/consultation/events/ws` 长寿命订阅。
2. 调用 `/start`、`/assist`、`/start-voice` 后复用同一条 WebSocket，不按单次业务重复建链。
3. WebSocket 断线时由 SDK 按指数退避重连，并携带最后 `event.id` 请求补发。
4. 收到非当前患者 `consultationId` 的结果直接忽略。
5. 收到 `reference-request` 后保持订阅，直到拿到 `reference-feedback`。
6. 收到重复结果时按唯一键去重。

推荐唯一键：

```text
consultationId + resultType + requestId + timestamp
```

## 7. 引用闭环标准规则

### 7.1 判断这是一条什么回执

建议 HIS 优先按以下规则判断：

- `reference-request + diagnosis`：请求保存诊断
- `reference-request + medication`：请求保存用药
- `reference-request + examination`：请求保存检查检验
- `reference-feedback + diagnosis`：诊断保存回执
- `reference-feedback + medication`：用药保存回执
- `reference-feedback + examination`：检查检验保存回执

### 7.2 回执设计原则

1. `resultType` 负责区分“请求”还是“回执”。
2. `referenceType` 负责区分“诊断 / 用药 / 检查”。
3. `action` 仅作为兼容旧版字段保留。
4. 新接入项目应优先使用 `referenceType`，不要只依赖 `action`。

## 8. 最小接入示例

### 8.1 启动完整问诊

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

### 8.2 订阅结果

```js
const unsubscribe = mh.subscribe((envelope) => {
  console.log(envelope.event?.type, envelope.event?.payload);
});
```

### 8.3 回执引用结果

```bash
curl -X POST 'http://127.0.0.1:8081/api/consultation/reference-feedback' \
  -H 'Content-Type: application/json' \
  -d '{
    "consultationId": "766842939207974912",
    "requestId": "ref-diagnosis-1704355203000",
    "referenceType": "diagnosis",
    "action": "diagnosis",
    "status": "success",
    "message": "PHIS 已成功保存诊断",
    "items": [
      {
        "name": "急性支气管炎",
        "code": "J20.900",
        "type": "diagnosis"
      }
    ]
  }'
```

## 9. 联调验收清单

接入完成后，至少验证以下场景：

1. `POST /api/consultation/start` 能唤起完整问诊
2. `POST /api/consultation/assist` 能进入对应灵活模式阶段
3. `GET /api/consultation/events/ws` 能推送当前患者的 `draft` 或 `record-confirmed`
4. 发起推荐诊断 / 用药 / 检查引用时能先收到 `reference-request`
5. PHIS 调用 `POST /api/consultation/reference-feedback` 后，`GET /api/consultation/events/ws` 能继续推送 `reference-feedback`
6. 切换患者后不会把上一位患者的结果误回填到当前医生站
7. 语音接诊结果也能走同一条 `/result` 通道回写

## 10. 联调注意事项

1. 当前真实联调参考页是 `pcie/web_project/public/mock-his.html`。
2. `consultationId` 当前不是独立就诊流水，HIS 必须防止同患者旧结果误命中当前就诊。
3. `/assist` 每次调用都会清空上一次结果通道，不要复用旧状态。
4. `reference-feedback` 只接受与“当前最新待处理引用请求”匹配的回执。
5. 当前页面恢复依赖同一运行期内的前端内存状态，不代表重启后仍可恢复。
6. 全医慧助（PCIE）内所有推荐结果本质上都是医生确认前草稿，HIS / PHIS 仍应保留最终校验和保存逻辑。

## 11. 出站方向：HIS 厂商适配器

第 1-10 节描述的是 **HIS → 全医慧助（PCIE）**（入站）的标准接口；本节描述
**全医慧助（PCIE）→ HIS**（出站）的对接方式：从 HIS 拉取诊断/药品/检查目录、字典、详情、库存校验。

### 11.1 设计目标

不同 HIS 厂商的私有接口形态差异极大，但全医慧助（PCIE）业务层关心的能力是**有限且收敛**的：

- 同步标准诊断目录（中央 ICD）
- 同步机构维度的药品 / 检查 / 检验目录
- 拉取频次 / 用药途径 / 执行科室 / 药房等可选字典
- 按需拉取项目详情、药品详情、库存校验

把这些能力抽到一个 vendor-neutral 接口 [`HisAdapter`](src/services/his/HisAdapter.ts) 后：

1. **解耦**：业务层（`medicalData.ts` / `VoiceConsultationNew.vue`）只面向 `HisAdapter` 编程，
   不再 import `hisService.ts` 内部任何方法
2. **可插拔**：新厂商只需实现该接口并 `registerHisAdapterFactory(vendor, factory)` 即可；
   通过 `setActiveHisVendor(vendor)` 或 `VITE_HIS_VENDOR` 环境变量切换
3. **故障隔离**：未握手 / 未拿到 token 时 `getHisAdapter()` 返回 `null`，调用方按"未就绪"处理

### 11.2 接口契约

定义见 [src/services/his/HisAdapter.ts](src/services/his/HisAdapter.ts)。共 20 个方法，分 6 组：

| 组 | 方法 | 用途 |
| :--- | :--- | :--- |
| 会话 | `updateContext(ctx)` / `getDefaultExecDeptId()` | 刷新角色科室上下文，提供默认执行科室 |
| 目录 | `fetchDiagnosisCatalog()` / `fetchInstitutionMedicalItemsCatalog(orgCode)` / `fetchInstitutionMedicineCatalog(orgCode)` / `fetchMedicineStoreIds(orgCode)` | 同步标准库与机构目录 |
| 字典 | `fetchFrequencyDictionary()` / `fetchMedicineUsageDictionary()` / `fetchExecutionDepartments()` / `fetchAvailablePharmacies()` | 提供编辑器可选项 |
| 详情 | `fetchMedicalItemDetail(idCli)` / `fetchMedicalItemPartOptions(idCli)` / `fetchMedicineProDetail(id, idSto)` / `checkMedicineInventoryEnough(items)` | 用户编辑/下达时按需调用 |
| 患者 | `fetchPatientInfo(patientId)` / `fetchPatientHistory(patientId)` | 接诊时补齐患者基础信息、过敏史与就诊历史 |
| 住院上下文 | `fetchInpatientDiagnoses(query)` / `fetchInpatientOrders(query)` / `fetchInpatientTemperatureChart(query)` / `fetchInpatientRegistration(query)` | 按指定患者和住院就诊锚点拉取住院诊断、医嘱、体温单和登记信息 |

### 11.3 默认实现：PhisHisAdapter

[src/services/his/PhisHisAdapter.ts](src/services/his/PhisHisAdapter.ts) 是当前默认实现，
内部包装 [src/services/hisService.ts](src/services/hisService.ts) 的 `HisService` 类
（即"国卫 PHIS / 院端 HIS"私有接口形态）。

token 与 baseUrl 仍由 `useEventListeners` 在 SDK handshake 完成后注入，方式不变；
新增的只是上层从 `HisService` 类直接调用变成走 `HisAdapter` 接口。

### 11.4 接入新厂商的最少工作量

1. 新建 `src/services/his/<Vendor>HisAdapter.ts`，实现 `HisAdapter` 接口
2. 把厂商私有的 baseUrl / 鉴权方式 / 接口路径全部封装在 adapter 内部
3. 在某个启动钩子里执行：

```ts
import { registerHisAdapterFactory, setActiveHisVendor } from '@/services/his';

registerHisAdapterFactory('myHis', () => new MyHisAdapter(/* deps */));
setActiveHisVendor('myHis');
```

或在 `.env`（构建期）/ localStorage（运行期）中设置 `VITE_HIS_VENDOR=myHis` / `HIS_VENDOR=myHis`。

业务层无需任何改动。

> **参考实现**：[src/services/his/MockHisAdapter.ts](src/services/his/MockHisAdapter.ts) 是不连接任何后端的最小完整实现，
> 同时已在 registry 中预注册（`vendor='mock'`）。本地 demo 或反向验证抽象层是否够用时，
> 直接在控制台执行 `localStorage.HIS_VENDOR='mock'` 后刷新即可切换。

### 11.5 已知限制

- 全部业务出站接口均已 vendor-neutral：
  * 详情：`MedicalItemDetail` / `MedicineDetail`
  * 目录：`DiagnosisCatalogEntry` / `MedicineCatalogEntry` / `MedicalItemCatalogEntry`
  * 字典：`DictionaryEntry`
  * 库存校验：`InventoryCheckRequest` / `InventoryCheckResult`
  * 患者与住院上下文：`HisPatientInfo` / `HisPatientHistory` / `HisInpatientDiagnosis` / `HisInpatientOrder` / `HisInpatientTemperatureChart` / `HisInpatientRegistrationInfo`
  原始 PHIS 字段仅通过返回值的 `raw` / `properties` 透传下游使用，业务通用代码不依赖。
- `PharmacyOption` 仍保留 `idDept` / `idSto` PHIS 字段。药房体系本身是双层标识（部门与库房），其他厂商接入时可再考虑抽象。
- 写回 HIS 暂不在适配器范围内：当前所有结果回写都走“前端经 invoke → Tauri → WebSocket `/api/consultation/events/ws`
  → HIS 订阅接收”模式（详见第 5-7 节），无 `writeBack(record)` 类的同步出站调用。
  若未来某厂商需要主动 PUSH 回 HIS，可作为 `HisAdapter` 的 optional 方法扩展。

### 11.6 中性 DTO 字段对照表（PHIS → 通用）

#### `MedicineDetail`

| 通用字段 | PHIS 字段 | 说明 |
| :--- | :--- | :--- |
| `productId` | `idMedPro` | 药品商品级 ID |
| `productName` | `naMedPro` | 商品名 |
| `medicineId` | `idMed` | 药品基础 ID |
| `medicineName` | `naMed` | 通用名 |
| `active` | `fgActive !== '0'` | 是否可发药 |
| `specSale` / `unitSale` / `dose` / `spec` | 同名 | 规格/单位/剂量 |
| `doseUnit` | `unitDose` ?? `unitPre` | 制剂单位 |
| `defaultSingleDose` | `dftDoseOnce` | 默认单次剂量 |
| `defaultFrequency` | `dftFreq` | 默认频次 |
| `defaultRoute` | `dftUsage` | 默认用药途径 |
| `storeId` | `idSto` | 药房 ID |
| `needsSkinTest` | `fgSkintest === '1'` | 是否需要皮试 |
| `raw` | 整个 PHIS body | 厂商透传 |

#### `MedicalItemDetail`

| 通用字段 | PHIS 字段 |
| :--- | :--- |
| `itemId` | `idCli` |
| `itemName` | `naCli` |
| `unit` | `unit` |
| `executingDeptId` | `idDeptExec` |
| `raw` | 整个 PHIS body |

#### `DictionaryEntry`

| 通用字段 | PHIS 字段 |
| :--- | :--- |
| `key` / `text` | 同名 |
| `py` / `wb` / `mcode` | 同名 |
| `properties` | PHIS 其它字段（如频次的 `execCount`）透传 |

#### `InventoryCheckRequest` / `InventoryCheckResult`

| 通用字段 | PHIS 字段 | 说明 |
| :--- | :--- | :--- |
| `productId` | `idMedPro` | 药品商品级 ID |
| `storeId` | `idSto` | 药房 ID |
| `medicineName` | `naMed` | 药品名 |
| `quantity` | `amount` | 申请数量 |
| `unitPrice` | `priceSale` | 单价 |
| `businessType` | `sdFrzBiz` | `outpatient`=`'1'` / `inpatient`=`'2'` / `emergency`=`'3'` |
| `result.code` | 同名 | 200=充足 |
| `result.message` | `msg` | 提示文本 |

#### `DiagnosisCatalogEntry` / `MedicineCatalogEntry` / `MedicalItemCatalogEntry`

| 通用字段 | 说明 |
| :--- | :--- |
| `id` / `code` / `name` / `keywords` / `spec` / `category` | 全厂商通用语义字段 |
| `raw` | PHIS 私有字段 `idSrv` / `naSrv` / `sdSrv` / `idDeptExec` / `fgCheckOrd` / `fgSkintest` / `idPart` / `jsonField` 透传 |

#### 住院上下文 DTO

| DTO | 核心字段 | 说明 |
| :--- | :--- | :--- |
| `HisInpatientQuery` | 可选 `patientId` + `admissionId / inpatientVisitId / encounterId / inpatientNo / wardId` | 所有住院上下文查询的标准入参；`admissionId` 对应 PHIS `idAdsn`，表示患者单次住院主键；调用方至少提供 `patientId` 或一个住院锚点 |
| `HisInpatientDiagnosis` | `id / code / name / diagnosisType / diagnosedAt / isPrimary / doctorName / deptName / raw` | 指定患者住院诊断；PHIS 诊断从住院登记信息 `diagList` 派生，`idDie` 为空表示该诊断类型尚未录入具体诊断信息，此时仍保留诊断类型行 |
| `HisInpatientOrder` | `orderId / groupId / name / orderType / status / startTime / stopTime / dose / frequency / route / quantity / unit / doctorName / deptName / raw` | 指定患者住院医嘱；PHIS 组内 `ords[]` 会展平成多条医嘱，并通过 `groupId/raw.rawGroup` 保留同组开立关系 |
| `HisInpatientTemperatureChart` | `patientId / inpatientVisitId / records / raw` | 指定患者住院体温单；单条 `records` 包含体温、脉搏、心率、呼吸、血压、血氧、出入量、体重等可选生命体征字段 |
| `HisInpatientRegistrationInfo` | `patientId / name / gender / ageText / inpatientVisitId / inpatientNo / admissionTime / clinicalTime / admissionDiagnosis / dischargeDiagnosis / allergyText / diagnoses / raw` | 指定患者住院登记信息；同时承载 PHIS `diagList` 映射后的诊断列表 |

#### PHIS：住院登记信息获取

| 项 | 内容 |
| :--- | :--- |
| 服务地址 | `api/phis.hiHosAdsnService/getPatientByIdAdsn` |
| 标准方法 | `HisAdapter.fetchInpatientRegistration({ admissionId })` |
| 关键入参 | `admissionId` 映射为 PHIS `idAdsn`，请求体直接传 `[idAdsn]` |
| 诊断来源 | `HisAdapter.fetchInpatientDiagnoses({ admissionId })` 不再调用独立 PHIS 诊断服务，而是复用本接口返回的 `diagList` |
| 后续用途 | 作为住院电子病历生成主上下文，提供患者基础信息、住院号、入院时间、入院/出院诊断、过敏史和住院诊断列表 |

请求示例：

```json
["69660377a5e9230bbcdc850f"]
```

返回映射：

| 中性字段 | PHIS 字段 |
| :--- | :--- |
| `patientId` | `idPi` |
| `name` / `gender` / `birthday` / `ageText` | `naPi` / `sdSexText` / `birthday` / `age` |
| `inpatientVisitId` / `inpatientNo` / `medicalRecordNo` | `idAdsn` / `cdHos` / `cdFile` |
| `admissionTime` / `clinicalTime` | `dtInHos` / `dtClinical` |
| `admissionDiagnosis` / `admissionDiagnosisCode` | `hosDiag` / `sdHosDiag` |
| `dischargeDiagnosis` / `dischargeDiagnosisCode` | `odsDiag` / `sdOdsDiag` |
| `allergyText` / `allergyItems` | `sdAllergyText` / `sdAllergyList` |
| `isSevere` / `isTransfer` / `isGestation` | `fgSevere` / `isTransfer` / `fgGestation` |
| `diagnoses` | `diagList[]` 映射为 `HisInpatientDiagnosis[]` |
| `raw` | 整个 PHIS 登记 body |

#### PHIS：住院医嘱获取

| 项 | 内容 |
| :--- | :--- |
| 服务地址 | `api/phis.hiHosOrderService/queryOrdGroupList` |
| 标准方法 | `HisAdapter.fetchInpatientOrders({ admissionId })` |
| 关键入参 | `admissionId` 映射为 PHIS `idAdsn`；`sdType`、`sdClassify`、`hiHosOrderStatus`、`fgNurse`、`authority` 由 adapter 固定封装 |
| 后续用途 | 作为住院电子病历生成上下文，结合大模型和 HIS 业务数据生成出入院记录 / 病程记录 |

请求示例：

```json
[{
  "start": 0,
  "limit": 100,
  "params": {
    "idAdsn": "69660377a5e9230bbcdc850f",
    "sdType": "",
    "sdClassify": "99",
    "hiHosOrderStatus": "today",
    "fgNurse": "1",
    "authority": "1"
  }
}]
```

返回映射：

| 中性字段 | PHIS 字段 |
| :--- | :--- |
| `name` | `ords[].naOrd`，即开立的医嘱内容 |
| `groupId` | 同一 `items[]` 分组生成稳定组号；同组 `ords` 表示同一组开立 |
| `status` | 优先取组级 `hiHosOrderStatusText`，缺失时取 `hiHosOrderStatus` |
| `raw` | 单条 `ord` + 组级状态 / 组序号；保留原始组信息供后续住院病历生成使用 |

#### PHIS：住院体温单数据获取

| 项 | 内容 |
| :--- | :--- |
| 服务地址 | `api/phis.hiHosSurveyService/getSurveyTestTimeLine` |
| 标准方法 | `HisAdapter.fetchInpatientTemperatureChart({ admissionId })` |
| 关键入参 | `admissionId` 映射为 PHIS `idAdsn` |
| 后续用途 | 提取体温、血压、呼吸、血氧等生命体征，作为出入院记录 / 病程记录中的客观病情依据 |

请求示例：

```json
[{
  "params": {
    "idAdsn": "69660377a5e9230bbcdc850f"
  }
}]
```

返回映射：

| 中性字段 | PHIS 字段 / 提取规则 |
| :--- | :--- |
| `recordTime` | `dtSurvey` 日期 + `dtSdStr` 时间；缺失时回退 `dtSurvey / recordTime / dtRecord` |
| `temperature` | `temp`，转为数值，单位摄氏度 |
| `temperatureType` | `tempType` |
| `dateText` / `timeText` | `dateStr` / `dtSdStr` |
| `level` | `level` |
| `isRetest` / `retestTemperature` | `fgRetest === '1'` / `tempRetest` |
| `bloodPressureSystolic` / `bloodPressureDiastolic` | 从 `detail` 中提取“收缩压(mmHg)” / “舒张压(mmHg)” |
| `respiration` | 从 `detail` 中提取“呼吸(次/分)” |
| `spo2` | 从 `detail` 中提取“血氧饱和度(%)” |
| `detailText` | `detail` 原文，保留给大模型理解其它未结构化生命体征 |
