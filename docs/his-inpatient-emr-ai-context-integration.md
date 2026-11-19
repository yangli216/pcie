# 住院电子病历 AI 辅助书写 HIS 对接手册

> 适用对象：HIS / EMR 三方厂商、院端实施人员、医诺浮球对接人员。
>
> 目标：HIS 按本手册提供“本次病历书写场景”所需的住院数据，让 AI 能生成更贴近医生实际书写习惯的病程记录、查房记录、出入院记录草稿，同时避免长住院全量数据导致上下文过大。

---

## 1. 对接原则

1. **按本次文书组织数据**：所有数据都围绕 `recordTime / recordDate` 返回，而不是返回整个住院周期全量明细。
2. **摘要优先，明细适量**：能由 HIS 汇总的内容优先放入 `summary`；明细只返回最近、异常、阳性、关键变化。
3. **日期关系明确**：体温单、检验、检查、病程等必须保留原始记录时间，避免 AI 把历史数据写成“今日”。
4. **字段语义中性化**：接口使用通用字段名，厂商私有字段可放入 `raw`，本系统不会依赖 PHIS 私有字段。
5. **聚合上下文唯一入口**：住院病历 AI 生成只消费聚合后的 `hisContext`；PHIS 院端由桌面端调用 `buildContext` 获取，三方 HIS 可在触发生成时直接传入 `hisContext`。

医生引用当前患者的一次门诊就诊时，正文请求同时携带所选就诊的门诊文书、SOAP 临床字段各别名、生命体征、诊断与医嘱的原始临床值，并标明 PHIS 来源字段。数值可带单位或测量说明，同一事实的不同来源可并列。某组资料仅返回自由文本时保留原文，其他资料继续传递。患者标识、机构鉴权及厂商透传对象不作为这一门诊资料补充段的内容。

医生在住院预览中修改字段后再点“补充要点并重新生成”，下一轮模型同时收到当前字段的最新修订和补充要点。医生主动清空的字段以空字符串表示。修订限于当前任务，进入新的住院生成任务时清空。

住院模板可生成字段的可见文字与 `data-default` 属性原文分别作为模板资料送入模型，由模型结合病例判断其中的提示、已有事实及冲突。后台字段配置和辅助模型分类均按当前模板的字段 ID 独立使用。有明确配置的字段按其生成权限处理，缺少明确权限、存在重复 ID 或配置损坏的字段保留原位，其他已授权字段继续生成。医生在预览中复核后发起回写。

---

## 2. 推荐接入方式

HIS 调用桌面端 SDK 或 HTTP Bridge 触发病历生成时，建议直接传入 `hisContext`：

```js
await mh.generateInpatientEmr({
  admissionId: '69660377a5e9230bbcdc850f',
  templateId: 'emr_tpl_daily_course',
  templateName: '每日病程录',
  recordTime: '2026-06-10 15:25',
  htmlContent: '<p data-id="病程记录"><span data-id="病程记录文本">病程记录</span></p>',
  contextPolicy: {
    maxDays: 7,
    previousNoteLimit: 3,
    includePreviousNotes: true,
    includeLongStaySummary: true,
    labLookbackDays: 14,
    orderLookbackDays: 7,
    onlyAbnormalLabs: false
  },
  hisContext: {
    documentContext: {
      admissionId: '69660377a5e9230bbcdc850f',
      templateId: 'emr_tpl_daily_course',
      templateName: '每日病程录',
      recordType: '每日病程录',
      recordTime: '2026-06-10 15:25',
      recordDate: '2026-06-10'
    },
    patient: {
      patientId: '6829c705ef56b10001b6f0b1',
      name: '林娜',
      sex: '女',
      age: '35岁',
      birthDate: '1991-02-27',
      inpatientNo: '202600002',
      medicalRecordNo: 'HZ000423609'
    },
    admission: {
      admissionTime: '2026-01-13 14:50:29',
      department: '护理部',
      ward: '内科病区',
      bedNo: '1230',
      attendingDoctor: '张医生',
      chiefDoctor: '李主任',
      allergyText: '',
      chiefComplaint: '体检发现血压升高1月',
      admissionCondition: '神志清，精神可，步入病房',
      severeFlag: false
    },
    diagnoses: [
      {
        id: '69660377a5e9230bbcdc8515',
        code: 'Z00.001',
        name: '健康查体',
        diagnosisType: '入院主诊断',
        diagnosedAt: '2026-01-13 16:33:24',
        isPrimary: true
      }
    ],
    vitals: {
      recordDateItems: [],
      latestBeforeRecordDate: {
        recordTime: '2026-06-08 14:00',
        dtSurvey: '2026-06-08 00:00:00',
        temperature: 39.0,
        temperatureType: '口温',
        pulse: 98,
        respiration: 24,
        bloodPressureSystolic: 154,
        bloodPressureDiastolic: 96,
        spo2: 98
      },
      summary: '本日体温单暂无记录；最近一次体温单记录为2026-06-08 14:00，体温39.0℃，血压154/96mmHg。'
    },
    orders: {
      active: [
        {
          orderId: 'ord-001',
          name: '氯沙坦钾氢氯噻嗪片',
          fullText: '氯沙坦钾氢氯噻嗪片 1片 口服 QD',
          displayText: '氯沙坦钾氢氯噻嗪片 1片 口服 QD',
          orderType: '药品',
          status: '执行中',
          startTime: '2026-06-08 09:00'
        }
      ],
      changedNearRecordDate: [
        {
          orderId: 'ord-002',
          name: '注射用头孢呋辛钠',
          fullText: '注射用头孢呋辛钠 1.5g 静脉滴注',
          displayText: '注射用头孢呋辛钠 1.5g 静脉滴注',
          orderType: '药品',
          status: '新增',
          startTime: '2026-06-09 10:20'
        }
      ],
      summary: '目前予降压、抗感染等治疗，长期医嘱执行中。'
    },
    labs: {
      abnormal: [
        {
          reportTime: '2026-06-09 08:30',
          groupName: '血常规',
          itemName: '白细胞计数',
          result: '12.8',
          unit: '10^9/L',
          referenceRange: '3.5-9.5',
          abnormalFlag: 'H',
          clinicalHint: '白细胞升高，提示感染或炎症可能'
        }
      ],
      recentKeyResults: [
        {
          reportTime: '2026-06-09 08:30',
          groupName: '血常规',
          abnormal: true,
          summary: '白细胞12.8×10^9/L升高，中性粒细胞比例升高。',
          keyItems: [
            {
              reportTime: '2026-06-09 08:30',
              groupName: '血常规',
              itemName: '白细胞计数',
              result: '12.8',
              unit: '10^9/L',
              referenceRange: '3.5-9.5',
              abnormalFlag: 'H',
              clinicalHint: '白细胞计数结果12.8 10^9/L，异常标记：H'
            }
          ]
        }
      ],
      summary: '近14天主要异常为白细胞升高。'
    },
    exams: [
      {
        examTime: '2026-06-09 15:10',
        examName: '胸部CT',
        finding: '双肺纹理增多',
        conclusion: '考虑支气管炎改变',
        important: true
      }
    ],
    previousRecords: {
      recentNotes: [
        {
          recordTime: '2026-01-13 16:40',
          recordType: '入院记录',
          recordName: '入院记录',
          medType: '0',
          recordCategory: '入院记录',
          chiefComplaint: '体检发现血压升高1月',
          presentIllness: '患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。',
          structuredSections: {
            chiefComplaint: '体检发现血压升高1月',
            presentIllness: '患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。',
            pastMedicalHistory: '既往高血压病史，否认糖尿病史。'
          },
          summary: '入院记录；主诉：体检发现血压升高1月；现病史：患者1月前体检发现血压升高，未诉明显头晕头痛、胸闷心悸等不适。'
        },
        {
          recordTime: '2026-06-09 16:00',
          recordType: '日常病程记录',
          medType: '1',
          recordCategory: '病程记录',
          summary: '患者诉咳嗽较前减轻，无胸闷气促，继续抗感染及对症治疗。'
        }
      ],
      longStaySummary: '患者自2026-01-13入院以来，主要诊断为健康查体/血压异常观察，期间予降压、对症及相关检查，病情总体平稳。'
    },
    consultations: [],
    operations: [],
    dataQuality: {
      hasRecordDateVitals: false,
      latestVitalsDate: '2026-06-08',
      truncated: true,
      truncatedReason: '住院周期较长，仅返回近7天重点数据及长期住院摘要'
    }
  }
});
```

PHIS 院端由桌面端主动拉取上下文时，聚合服务地址为：

```text
api/phis.aiInpatientEmrContextService/buildContext
```

该 RPC 服务入参按参数数组传递，格式为：

```json
[
  {
    "admissionId": "69660377a5e9230bbcdc850f",
    "templateId": "emr_tpl_daily_course",
    "templateName": "每日病程录",
    "recordTime": "2026-06-10 15:25",
    "recordDate": "2026-06-10",
    "contextPolicy": {
      "maxDays": 7,
      "previousNoteLimit": 3,
      "includePreviousNotes": true,
      "includeLongStaySummary": true,
      "labLookbackDays": 14,
      "orderLookbackDays": 7
    }
  }
]
```

---

## 3. 请求字段说明

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `admissionId` | 是 | 患者单次住院登记主键。PHIS 对应 `idAdsn` |
| `templateId` | 是 | 病历模板主键。模板解析缓存按该字段命中 |
| `templateName` | 是 | 病历模板名称，如 `每日病程录`、`医生查床录`、`出院记录` |
| `recordTime` | 否 | 本次文书书写时间，如 `2026-06-10 15:25`；不传时使用桌面端当前时间 |
| `htmlContent` | 是 | 当前 HIS/EMR 编辑器的 HTML 模板，需包含 `data-id` |
| `contextPolicy` | 否 | 上下文裁剪策略，供 HIS 或适配器控制返回范围 |
| `hisContext` | 推荐 | 按本手册组织好的 AI 上下文包。存在时桌面端优先使用，避免重复拉取 HIS |
| `patient` | 否 | 患者兜底信息；不替代 `hisContext.patient` |
| `requestId` | 否 | HIS 请求 ID，用于回写事件和回执关联 |

---

## 4. `hisContext` 字段规范

### 4.1 `documentContext`

| 字段 | 说明 |
| --- | --- |
| `admissionId` | 单次住院主键 |
| `templateId` | 模板主键 |
| `templateName` | 模板名称 |
| `recordType` | 记录类型，优先等于模板名称 |
| `recordTime` | 本次文书书写时间 |
| `recordDate` | 本次文书书写日期，必须从 `recordTime` 派生 |

日期规则：

1. AI 生成正文时，`recordDate` 是“今日 / 本次查房日期”的唯一依据。
2. 任何早于 `recordDate` 的体温单、检验、检查、病程，都只能作为历史资料引用。
3. 若体温单最新日期早于 `recordDate`，摘要应写成“本日体温单暂无记录；最近一次体温单记录为 YYYY-MM-DD HH:mm...”，不要写“今日体温单显示”。

### 4.2 `patient`

必须提供：`patientId`。建议同时提供 `name`、`sex`、`age`、`birthDate`、`inpatientNo`、`medicalRecordNo`。`patientId` 用于桌面端在入院记录生成时继续查询患者近期门诊就诊历史，不能在上下文裁剪或字段瘦身时移除。

### 4.3 `admission`

建议提供：

| 字段 | 说明 |
| --- | --- |
| `admissionTime` | 入院时间 |
| `department` | 当前科室 |
| `ward` | 病区 |
| `bedNo` | 床号 |
| `attendingDoctor` | 管床 / 主治医生 |
| `chiefDoctor` | 上级医生 |
| `allergyText` | 过敏史文本 |
| `chiefComplaint` | 主诉，若 HIS 可提供 |
| `admissionCondition` | 入院情况 |
| `severeFlag` | 危重标记 |

### 4.4 `diagnoses`

诊断列表建议包括：`id`、`code`、`name`、`diagnosisType`、`diagnosedAt`、`isPrimary`、`doctorName`。

诊断类型建议清晰区分：门急诊诊断、入院诊断、修正诊断、出院诊断、病理诊断、损伤中毒外因等。

### 4.5 `vitals`

| 字段 | 说明 |
| --- | --- |
| `recordDateItems` | `recordDate` 当日生命体征。没有当日数据时返回空数组 |
| `latestBeforeRecordDate` | `recordDate` 之前最近一次生命体征 |
| `summary` | 推荐提供给 AI 的摘要文本 |

生命体征记录建议字段：`recordTime`、`temperature`、`temperatureType`、`pulse`、`heartRate`、`respiration`、`bloodPressureSystolic`、`bloodPressureDiastolic`、`spo2`、`weight`、`detailText`。

### 4.6 `orders`

| 字段 | 说明 |
| --- | --- |
| `active` | 当前有效医嘱 |
| `changedNearRecordDate` | `recordDate` 附近新增、停止、调整的医嘱 |
| `summary` | 治疗摘要，推荐 HIS 侧生成 |

医嘱条目建议字段：`orderId`、`groupId`、`name`、`fullText`、`displayText`、`orderType`、`status`、`startTime`、`stopTime`、`dose`、`frequency`、`route`、`quantity`、`unit`。

医嘱文本推荐规则：

- `name`：基础项目名或药品名，尽量不包含剂量、用法、频次，例如 `安博维`。
- `fullText`：HIS 原始完整医嘱文本，可包含剂量、用法、频次，例如 `安博维 150 mg 雾化吸入 每天两次(BID)`。
- `displayText`：推荐给 AI 摘要和病历生成使用的文本。若 `fullText` 已经是医生可读完整医嘱，可直接等于 `fullText`。
- `dose`、`frequency`、`route` 保留为结构化字段，用于必要时分析；当 `displayText/fullText` 已包含这些信息时，AI 生成不得再次拼接，避免重复表达。
- 本上下文包面向 AI 生成，不建议返回 `frequencyCode`、`routeCode`、`orderTypeCode` 等字典编码字段；除 `orderId/groupId` 等必要业务定位 ID 外，优先返回中文或医生可读文本。

### 4.7 `labs`

| 字段 | 说明 |
| --- | --- |
| `abnormal` | 异常检验结果 |
| `recentKeyResults` | 近期关键检验摘要，按报告 / 组合项目聚合 |
| `summary` | 检验整体摘要 |

检验条目建议字段：`reportTime`、`groupName`、`itemName`、`result`、`unit`、`referenceRange`、`abnormalFlag`、`clinicalHint`、`summary`。

`recentKeyResults` 不建议直接重复返回全量检验明细。推荐每份报告返回 `reportTime`、`groupName`、`abnormal`、`summary` 和少量 `keyItems`。`keyItems` 只保留异常项或最关键项目，字段同检验条目。面向 AI 生成时不建议返回 `applyId`、`reportId`、`reportGroupId`、`referenceLow`、`referenceHigh`、`raw` 等定位或底层字段。

### 4.8 `exams`

检查报告建议字段：`examTime`、`examName`、`finding`、`conclusion`、`important`、`summary`。

如果报告正文较长，优先返回 `conclusion` 和 `summary`，`finding` 可截断。面向 AI 生成时不建议返回申请 ID、报告 ID、报告医生、审核医生、科室、原始 raw 等对书写病历无直接帮助的字段。

### 4.9 `previousRecords`

| 字段 | 说明 |
| --- | --- |
| `recentNotes` | 最近 3 到 5 条历史病历摘要，允许包含入院记录关键病史 |
| `longStaySummary` | 长住院摘要 |

历史病历不建议全量传原文。日常病程、查房记录最需要的是“前序病情变化 + 当前治疗计划”的连续性。

`getMedContent` 或 EMR 详情返回的 `medType` 建议按以下规则处理：

| `medType` | 含义 | AI 上下文处理 |
| --- | --- | --- |
| `0` | 入院记录 | 保留，但不要只传整篇 HTML。应移除 `<header>...</header>` 和 HTML 标签，优先结构化抽取 `chiefComplaint`、`presentIllness`，并可补充 `structuredSections.pastMedicalHistory / personalHistory / familyHistory / physicalExam` |
| `1` | 病程 | 保留最近摘要或正文摘录，重点体现病情变化、查房意见、治疗计划 |
| `2` | 病案首页 | 过滤，不进入 AI 上下文。病案首页不需要 AI 生成，且对其它文书生成通常没有有效增益 |

入院记录结构化字段建议：

| 字段 | 说明 |
| --- | --- |
| `chiefComplaint` | 入院记录主诉，供后续病程生成作为核心病史背景 |
| `presentIllness` | 入院记录现病史，供后续病程生成作为核心病史背景 |
| `structuredSections` | 从结构化病历正文抽取的章节，如 `pastMedicalHistory`、`personalHistory`、`familyHistory`、`physicalExam` |
| `content` | 去标签后的正文摘录，可按长度截断；用于补充，不建议作为唯一输入 |
| `summary` | 给 AI 优先读取的简短摘要 |

### 4.10 `consultations` / `operations`

会诊建议提供：`consultationTime`、`department`、`opinion`、`suggestion`、`summary`。

手术/操作建议提供：`operationTime`、`operationName`、`anesthesia`、`finding`、`postoperativeDiagnosis`、`summary`。

### 4.11 `dataQuality`

建议提供：

| 字段 | 说明 |
| --- | --- |
| `hasRecordDateVitals` | 是否存在本次书写日期当天体温单 |
| `latestVitalsDate` | 最近一次体温单日期 |
| `truncated` | 是否做了裁剪 |
| `truncatedReason` | 裁剪原因 |

`dataQuality` 只表达上下文裁剪和关键数据是否存在，不承载调试诊断信息或缺失数据 schema。

---

## 5. 上下文大小控制建议

| 数据域 | 推荐返回范围 |
| --- | --- |
| 体温单 | 当日数据 + 当日前最近一次。不要返回整个住院周期 |
| 医嘱 | 当前有效医嘱 + 近 7 天新增/停止/调整医嘱 + 摘要 |
| 检验 | 近 14 天异常结果优先；常规项目返回最近一次和趋势摘要 |
| 检查 | 近 14 天报告；关键阳性报告可突破时间限制 |
| 历史病历 | 最近 3 到 5 条摘要；入院记录提取主诉/现病史；病案首页过滤；长住院提供 `longStaySummary` |
| 会诊/手术 | 与当前诊疗相关的关键记录摘要 |

建议默认策略：

```json
{
  "maxDays": 7,
  "previousNoteLimit": 3,
  "includePreviousNotes": true,
  "includeLongStaySummary": true,
  "labLookbackDays": 14,
  "orderLookbackDays": 7,
  "onlyAbnormalLabs": false
}
```

---

## 6. 最小可用版本

三方第一阶段至少建议提供：

1. `patient` + `admission`
2. `diagnoses`
3. `vitals.recordDateItems` + `vitals.latestBeforeRecordDate` + `vitals.summary`
4. `orders.active` + `orders.summary`
5. `previousRecords.recentNotes` 或 `previousRecords.longStaySummary`

这套数据可覆盖日常病程、医生查床录等高频文书。

若要显著提升出院记录、首次病程、复杂病例病程质量，应继续补充：

1. 异常检验结果 `labs.abnormal`
2. 关键检查报告 `exams`
3. 会诊 `consultations`
4. 手术/操作 `operations`

---

## 7. 回写结果

医生审核后点击“一键回写”，本系统通过 SDK Promise 或 `record-confirmed` 事件返回：

```json
{
  "resultType": "record-confirmed",
  "emrType": "inpatient-emr",
  "admissionId": "69660377a5e9230bbcdc850f",
  "requestId": "inpatient-emr-1704355201000",
  "fieldValues": {
    "病程记录文本": "患者今日查房..."
  }
}
```

说明：

1. `fieldValues` 只包含当前模板中标记为适合 AI 生成的 `data-id`。
2. 如果医生在预览中编辑过字段，以编辑后的内容为准。
3. 不返回 `htmlContent`，HIS 应按当前编辑器模板自行用 `data-id` 定位并回填。
4. HIS 回填完成后建议调用 `POST /api/consultation/reference-feedback` 通知结果，桌面端收到成功回执后会收起回小球。

---

## 8. 聚合上下文要求

住院病历 AI 生成不再兼容由桌面端分别调用住院登记、住院医嘱、体温单等多个明细服务后再归一的模式。HIS 对接必须满足以下任一方式：

| 方式 | 说明 |
| --- | --- |
| HIS 主动传 `hisContext` | 调用 `sdk.generateInpatientEmr` 或 `/api/inpatient/emr/generate` 时直接携带本手册定义的上下文包 |
| 桌面端拉取 PHIS `buildContext` | PHIS Adapter 调用 `api/phis.aiInpatientEmrContextService/buildContext`，入参为 `[requestMap]`，服务端一次性聚合返回本手册定义的上下文包 |

检验、检查、历史病历、会诊、手术/操作等数据也应在聚合上下文中完成裁剪和摘要。若某一类数据暂不可获取，请返回空数组或空摘要，不要让桌面端再回退调用旧明细服务。
