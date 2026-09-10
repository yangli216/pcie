import type { ReportFollowUpAssessment } from '@/types/reportInterpretation';

/**
 * HIS 适配器层 vendor-neutral DTO
 *
 * 这些类型是医诺浮球业务层与具体 HIS 厂商接口之间的"标准翻译目标"。任何厂商
 * 的 adapter 实现都必须把私有响应映射成下列结构后再返回给上层。
 *
 * 命名约定：
 * - 字段名使用语义化英文（productId / productName / unit / executingDeptId 等），
 *   不再泄漏 PHIS 的 `idMedPro / naMedPro / idDeptExec` 等私有标识；
 * - 凡是上层用不到、但厂商内部下达处方等场景仍需透传的字段，统一塞进 `raw`，
 *   由该厂商的下游模块按需访问，业务通用代码不要再读 `raw`；
 * - 详情类 DTO 中的 `raw` 至少包含本次详情的关键 ID（`productId / storeId` 或
 *   `itemId`），以便后续库存校验等出站调用还能拿到原始 ID。
 *
 * 已抽象（业务层只面向以下类型编程）：
 * - 详情：`MedicineDetail` / `MedicalItemDetail`
 * - 检查部位：`MedicalItemPartOption`
 * - 字典：`DictionaryEntry`
 * - 库存校验：`InventoryCheckRequest` / `InventoryCheckResult`
 * - 目录条目：`DiagnosisCatalogEntry` / `MedicineCatalogEntry` / `MedicalItemCatalogEntry`
 * - 患者与住院上下文：`HisPatientInfo` / `HisPatientHistory` / `HisInpatient*`
 *
 * 仍 PHIS 化（adapter 内部使用，不对外）：
 * - `PharmacyOption`（`idDept` / `idSto`）— 药房列表本身依赖 PHIS 双层标识
 *   （部门 id + 库房 id），新厂商需要时再抽象。
 */

// ============================================================================
// 详情
// ============================================================================

/**
 * 药品详情（按药房维度）
 *
 * 业务层用途：
 * 1. 校验是否真正可发药（`active === false` 时不允许选中）
 * 2. 回填规格 / 默认剂量、频次、用法、剂量单位
 * 3. 提供下达处方时的 `productId / storeId` 等出站标识（在 `raw` 中）
 */
export interface MedicineDetail {
  /** 药品商品级 ID（药房维度的最小可发药单元） */
  productId: string;
  /** 药品商品名（含规格 / 厂家信息的展示名） */
  productName: string;
  /** 药品基础 ID（同一药品在不同药房共享） */
  medicineId?: string;
  /** 药品通用名 */
  medicineName?: string;
  /** 本次药品商品的生产厂家 */
  manufacturer?: string;
  /** 是否处于可用状态：false 表示已停用，不能选中 */
  active: boolean;

  // ---- 规格相关 ----
  /** 销售规格（含包装数量），如 "0.25g*24片/盒" */
  specSale?: string;
  /** 销售单位，如 "盒" / "瓶" */
  unitSale?: string;
  /** 原始规格字符串（厂商若同时有 spec / specSale，此字段为 spec） */
  spec?: string;
  /** 单次给药的最小制剂单位（如 "片" / "粒" / "ml"） */
  doseUnit?: string;
  /** 单一剂量描述（如 "0.25g/片"） */
  dose?: string;

  // ---- 默认值（用于编辑器初始化） ----
  /** HIS 推荐的单次剂量 */
  defaultSingleDose?: string;
  /** HIS 推荐的频次（值映射到频次字典 key） */
  defaultFrequency?: string;
  /** HIS 推荐的给药途径（值映射到用药途径字典 key） */
  defaultRoute?: string;

  // ---- 定位字段 ----
  /** 当前详情归属的药房 storeId */
  storeId?: string;

  // ---- 业务标记 ----
  /** 是否需要皮试 */
  needsSkinTest: boolean;

  /**
   * 厂商透传：保留原始响应里所有字段，供下达处方等出站场景按厂商私有字段使用。
   * 业务通用代码不要直接读这里；只有 PHIS 路径下的处方下达模块可用。
   */
  raw: Record<string, unknown>;
}

/**
 * 检查/检验/处置项详情
 *
 * 业务层用途：拉到当前选中项的执行科室、单位、默认数量等信息回填到处方/医嘱编辑器。
 */
export interface MedicalItemDetail {
  /** 项目 ID（中央 / 机构维度的项目主键） */
  itemId: string;
  /** 项目名称 */
  itemName: string;
  /** 计价单位（如 "次" / "项"） */
  unit?: string;
  /** 默认执行科室 ID */
  executingDeptId?: string;
  /** HIS 项目详情返回的默认数量（如处置次数），用于非药品项目真实反填 */
  defaultQuantity?: number;

  /** 厂商透传 */
  raw: Record<string, unknown>;
}


/**
 * 检查部位 / 方式候选
 *
 * 业务层用途：检查项目匹配后展示可选检查部位；单候选时自动回填到 `idPart`。
 */
export interface MedicalItemPartOption {
  /** 部位方式主键，PHIS 回写时对应 `idPart` */
  partId: string;
  /** 归属检查项目 ID */
  itemId?: string;
  /** 人读展示名，如 “胸部CT” / “无部位” */
  name: string;
  /** 部位 + 方式原始组合文本 */
  partAndWay?: string;
  /** 部位 + 方式编码组合 */
  partAndWayCode?: string;
  /** PACS 类型编码 */
  pacsType?: string;
  /** PACS 类型文本 */
  pacsTypeText?: string;
  /** 部位文本 */
  partText?: string;
  /** 方式文本 */
  wayText?: string;
  /** 默认数量 */
  amount?: number;
  /** 厂商透传 */
  raw: Record<string, unknown>;
}

// ============================================================================
// 字典
// ============================================================================

/**
 * 字典条目（频次 / 用法 / 执行科室等通用形态）
 *
 * 字段语义：
 * - `key`：业务键，下达处方时回填给 HIS 的标识（如 "QD" / "PO" / 科室 id）
 * - `text`：人读文本（"每天一次" / "口服"）
 * - `py / wb / mcode`：拼音首字母 / 五笔 / 助记码（中文搜索辅助，可选）
 * - `properties`：厂商私有附加（如 PHIS 频次的 `execCount` 一日次数）
 */
export interface DictionaryEntry {
  key: string;
  text: string;
  py?: string;
  wb?: string;
  mcode?: string;
  /** 厂商透传：业务方按需读 */
  properties?: Record<string, unknown>;
}

// ============================================================================
// 库存校验
// ============================================================================

/**
 * 库存校验单条请求（中性）
 *
 * `businessType` 业务类型：
 * - `'outpatient'`（门诊处方）
 * - `'inpatient'`（住院医嘱）
 * - `'emergency'`（急诊）
 * 由 adapter 内部映射成厂商私有编码（PHIS：'1' / '2' / '3'）。
 */
export interface InventoryCheckRequest {
  /** 药品商品级 ID（同 MedicineDetail.productId） */
  productId: string;
  /** 药房 storeId */
  storeId: string;
  /** 药品名（用于 HIS 错误提示展示） */
  medicineName: string;
  /** 申请扣减数量（最小销售单位） */
  quantity: number;
  /** 单价（用于 HIS 计算金额阈值），可为 0 */
  unitPrice: number;
  /** 业务类型 */
  businessType: 'outpatient' | 'inpatient' | 'emergency';
}

/**
 * 库存校验结果（中性）
 *
 * 约定：`code === 200` 代表库存充足，其它为不足或失败，`message` 描述原因。
 */
export interface InventoryCheckResult {
  code: number;
  message: string;
}

/**
 * 当前 HIS 登录上下文的缓存隔离标识。
 */
export interface HisContextScope {
  orgCode: string;
  tenantId: string;
}

/**
 * 当前发药药房中可用于 AI 推荐约束的有效库存药品。
 *
 * 同一 `productId` 的多个批次已由 adapter 合并；业务层不接触批次级 PHIS 字段。
 */
export interface AvailableMedicineInventoryItem {
  productId: string;
  productName: string;
  spec?: string;
  unit?: string;
  manufacturer?: string;
  storeId: string;
  storeName?: string;
  availableQuantity: number;
  nearestExpiryDate?: string;
  /** 当前药房近效期有效库存批次的销售单价；仅来源于库存目录。 */
  unitPrice?: number;
  raw?: Record<string, unknown>;
}

// ============================================================================
// 目录条目
// ============================================================================

/**
 * 诊断目录条目（中性）
 *
 * 来自标准 ICD 库或 HIS 自定义诊断库，用于本地匹配和推荐诊断展示。
 */
export interface DiagnosisCatalogEntry {
  /** 诊断主键（ICD 编码或厂商私有 ID） */
  id: string;
  /** ICD-10/11 编码 */
  code?: string;
  /** 诊断名称 */
  name: string;
  /** 搜索关键词（拼音首字母或别名等） */
  keywords?: string[] | string;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

/**
 * 药品目录条目（中性）
 *
 * 业务层用途：本地匹配 + 推荐用药展示。后续处方下达时 PHIS 私有字段
 * （`idSrv` / `naSrv` / `sdSrv` / `idDeptExec` / `fgCheckOrd` / `fgSkintest`）
 * 通过 `raw` 透传，由 PhisHisAdapter / PHIS 处方下达模块读取。
 */
export interface MedicineCatalogEntry {
  id: string;
  code?: string;
  name: string;
  spec?: string;
  keywords?: string[] | string;
  /** 该药品在哪些发药药房（idSto）目录中出现。为空表示未标注药房，不参与药品匹配 */
  storeIds?: string[];
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

/**
 * 检查 / 检验 / 处置项目目录条目（中性）
 */
export interface MedicalItemCatalogEntry {
  id: string;
  code?: string;
  name: string;
  /** 项目分类（检查 / 检验 / 处置 等） */
  category?: string;
  keywords?: string[] | string;
  /** 当前机构价格，仅用于目录展示与推荐排序，不作为收费结算依据。 */
  unitPrice?: number;
  /** 免费专项、特定人群等不能作为通用首选的受限项目。 */
  restricted?: boolean;
  restrictionReason?: string;
  /** 检验检查互认编码；空字符串表示该项目不参与互认。 */
  mutualRecognitionCode?: string;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

// ============================================================================
// 患者与就诊历史
// ============================================================================

/**
 * HIS 患者基本信息（中性）
 */
export interface HisPatientInfo {
  patientId: string;
  name: string;
  gender: 'M' | 'F' | 'O';
  age?: number;
  ageText?: string;
  /** 身份证号 / 医保卡号等可选标识 */
  idNo?: string;
  mobilePhone?: string;
  insuranceType?: string;
  /** 当前是否存在可用于慢病长处方的有效签约；未知时省略。 */
  signed?: boolean;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

/**
 * 历史就诊记录单次摘要
 */
export interface HisHistoricalMedication {
  orderId?: string;
  productId?: string;
  name: string;
  spec?: string;
  /** 历史处方药品的生产厂家，仅用于可靠匹配当前同品。 */
  manufacturer?: string;
  dose?: string;
  doseUnit?: string;
  frequency?: string;
  frequencyKey?: string;
  route?: string;
  routeKey?: string;
  days?: string;
  totalQty?: string;
  totalUnit?: string;
  /** 厂商原始处方子项，仅限 Adapter 与诊断排障使用。 */
  raw?: Record<string, unknown>;
}

/** 单次门诊详情中的中性生命体征摘要。 */
export interface HisVisitVitalSigns {
  /** 收缩压，mmHg。 */
  systolicBloodPressure?: number;
  /** 舒张压，mmHg。 */
  diastolicBloodPressure?: number;
  /** 心率，次/分。 */
  heartRate?: number;
  /** 脉搏，次/分。 */
  pulseRate?: number;
  /** 呼吸，次/分。 */
  respiratoryRate?: number;
  /** 体温，℃。 */
  temperature?: number;
  /** 体温类型文本，如 体温 / 腋温 / 肛温 / 耳温。 */
  temperatureTypeText?: string;
  /** 身高，cm。 */
  heightCm?: number;
  /** 体重，kg。 */
  weightKg?: number;
  /** 腰围，cm。 */
  waistCm?: number;
  /** 是否首诊测压。 */
  firstBloodPressureMeasured?: boolean;
  /** 记录/测量时间。 */
  measuredAt?: string;
  /** 最近更新时间。 */
  updatedAt?: string;
}

/** 历史门诊诊断的中性摘要；编码当前为 HIS 提供的 ICD-10。 */
export interface HisHistoricalDiagnosis {
  name: string;
  code?: string;
}

export interface HisVisitRecord {
  /** 历史门诊就诊 ID，供后续按就诊加载报告正文。 */
  visitId?: string;
  /** 就诊时间戳 */
  visitTime: number;
  /** 就诊科室名称。 */
  deptName?: string;
  /** 主诉文本 */
  chiefComplaint?: string;
  /** 现病史 */
  presentIllness?: string;
  /** 诊断列表文本 */
  diagnoses?: string[];
  /** 同时保留临床名称与标准编码的历史诊断；业务识别优先消费此字段。 */
  diagnosisEntries?: HisHistoricalDiagnosis[];
  /** 处方药品列表文本 */
  medications?: string[];
  /** 历史处方中的中性结构化药品属性。 */
  medicationOrders?: HisHistoricalMedication[];
  /** 本次历史就诊详情中的生命体征。 */
  vitalSigns?: HisVisitVitalSigns;
  /** 本次历史就诊中已出结果的检验检查申请摘要。 */
  reportedApplications?: HisReportedApplication[];
}

export type HisReportedApplicationType = 'lab' | 'exam' | 'unknown';

export interface HisReportedApplication {
  /** 检验检查申请明细 ID。 */
  applicationId: string;
  /** 组合申请 ID，可用于同组项目聚合。 */
  applicationGroupId?: string;
  /** HIS 中的申请项目名称。 */
  name: string;
  type: HisReportedApplicationType;
  /** 当前中性契约只保存已出报告的记录。 */
  status: 'reported';
  requestedAt?: string;
}

/**
 * HIS 患者就诊历史汇总（中性）
 */
export interface HisPatientHistory {
  patientId: string;
  /** 过敏史文本列表 */
  allergyHistory?: string[];
  /** 既往史/慢性病史文本列表 */
  pastMedicalHistory?: string[];
  /** 历次就诊记录 */
  visits?: HisVisitRecord[];
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

export interface HisPatientHistoryQuery {
  /** 当前门诊就诊 ID；HIS 历史查询应排除本次诊中记录。 */
  currentVisitId?: string;
  /** 最大返回历史就诊数。 */
  limit?: number;
  /** 业务时间窗；具体 HIS Adapter 负责映射为厂商查询参数。 */
  dateRange?: [string, string];
}

/**
 * 门诊就诊历史（用于入院记录的基础选择）
 */
export interface HisOutpatientVisit {
  /** 就诊 ID */
  visitId: string;
  /** 患者 ID */
  patientId?: string;
  /** 挂号 ID */
  registrationId?: string;
  /** 门诊号 / 诊疗序号 */
  clinicNo?: string;
  /** 就诊日期，例如 2026-06-12 10:00:00 */
  visitDate: string;
  /** 就诊科室名称 */
  deptName?: string;
  /** 接诊医生 */
  doctorName?: string;
  /** 机构名称 */
  orgName?: string;
  /** 就诊状态文本，例如 诊中 / 已诊毕 */
  statusText?: string;
  /** 是否当前诊中 */
  visiting?: boolean;
  /** 诊断列表文本 */
  diagnoses?: string[];
  /** 是否存在可引用的门急诊病历文书 */
  hasMedicalRecord?: boolean;
  /** 可引用门急诊病历文书数量 */
  medicalRecordDocumentCount?: number;
  /** 主诉摘要 */
  chiefComplaint?: string;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

export interface HisOutpatientVisitHistoryQuery {
  /** 最大返回条数；PHIS 支持 -1 表示按时间范围返回全部 */
  limit?: number;
  /** 就诊时间范围，例如 ["2026-06-08 00:00:00", "2026-06-15 23:59:59"] */
  dateRange?: [string, string];
  /** true 时仅返回同时具备诊断和病历文书的就诊 */
  requireDiagnosisAndRecord?: boolean;
}

/**
 * 门急诊病历文书列表项。
 *
 * 当前 PHIS 首步只返回文书元数据；正文内容接口后续补充后，应继续映射到
 * HisOutpatientMedicalRecord 的结构化字段 / htmlContent。
 */
export interface HisOutpatientMedicalRecordDocument {
  /** 门诊病历文书 ID（PHIS: idMedrecdoc） */
  documentId: string;
  /** 归属门诊就诊 ID（PHIS: idHospital，对应门诊 idVis） */
  visitId: string;
  /** 应用 ID，PHIS 当前固定 42 */
  appId?: string;
  /** 租户 ID */
  tenantId?: string;
  /** 文书名称 */
  title: string;
  /** 文书创建时间 */
  createdAt?: string;
  /** 文书插入/保存时间 */
  insertedAt?: string;
  /** 书写标题时间 */
  titleTime?: string;
  /** 文书类型编码 */
  medType?: string;
  /** 是否已提交 */
  committed?: boolean;
  /** 是否已关闭 */
  closed?: boolean;
  /** 是否已签章 */
  sealed?: boolean;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

/**
 * 门急诊病历详情
 */
export interface HisOutpatientMedicalRecord {
  visitId: string;
  /** 当前用于预览 / AI 参考的文书 ID */
  documentId?: string;
  /** 当前用于预览 / AI 参考的文书标题 */
  documentTitle?: string;
  /** HTML 格式的完整病历；展示前必须经过共享 HTML 白名单净化，禁止直接交给 iframe/v-html */
  htmlContent: string;
  /** 从 HTML 正文中提取的纯文本，供 AI 参考 */
  plainText?: string;
  /** 当前已获取的文书列表 */
  documents?: HisOutpatientMedicalRecordDocument[];
  /** true 表示已拿到文书列表，但正文暂不可用 */
  contentPending?: boolean;
  /** 主诉 */
  chiefComplaint?: string;
  /** 现病史 */
  historyOfPresentIllness?: string;
  /** 既往史 */
  pastHistory?: string;
  /** 查体/体格检查 */
  physicalExamination?: string;
  /** 辅助检查 */
  auxiliaryExamination?: string;
  /** 初步诊断/诊断 */
  diagnosis?: string;
  /** 治疗意见/处置 */
  treatmentPlan?: string;
  /** 本次门急诊病历详情中的生命体征。 */
  vitalSigns?: HisVisitVitalSigns;
  /** 厂商透传 */
  raw?: Record<string, unknown>;
}

export interface HisOutpatientFollowUpContextQuery {
  patientId: string;
  currentVisitId: string;
  currentDiagnosis?: string;
  sourceVisitId?: string;
  contextPolicy?: {
    historyLimit?: number;
    maxLabReports?: number;
    maxExamReports?: number;
    outpatientRecordContentLimit?: number;
  };
}

export interface HisOutpatientFollowUpReportResultsQuery {
  patientId: string;
  currentVisitId: string;
  contextPolicy?: {
    maxLabReports?: number;
    maxExamReports?: number;
  };
}

export interface HisOutpatientFollowUpLabItem {
  itemId?: string;
  itemName?: string;
  result?: string;
  unit?: string;
  referenceLow?: string;
  referenceHigh?: string;
  referenceRange?: string;
  abnormalFlag?: string;
  direction?: 'normal' | 'up' | 'down' | 'positive' | 'abnormal';
  abnormal?: boolean;
}

/** 一份 LIS 报告单覆盖的已出结果申请项目。 */
export interface HisOutpatientFollowUpReportApplication {
  applicationId?: string;
  applicationName?: string;
}

export interface HisOutpatientFollowUpLabReport {
  reportId?: string;
  reportGroupId?: string;
  applicationId?: string;
  reportTime?: string;
  reportName?: string;
  /** 同一 idReportGroup 下的全部申请项目，不与报告单数量一一对应。 */
  applications?: HisOutpatientFollowUpReportApplication[];
  items?: HisOutpatientFollowUpLabItem[];
}

export interface HisOutpatientFollowUpExam {
  reportId?: string;
  applicationId?: string;
  reportTime?: string;
  examName?: string;
  finding?: string;
  conclusion?: string;
  /** PACS/检查系统提供的原报告 HTTP(S) 页面；不得作为 AI 临床正文。 */
  reportUrl?: string;
}

export interface HisOutpatientFollowUpContext {
  followUpEligible: boolean;
  source?: {
    visitId?: string;
    visitTime?: string;
    documentTitle?: string;
  };
  currentDiagnosis?: string;
  medicalRecordText?: string;
  labReports?: HisOutpatientFollowUpLabReport[];
  examReports?: HisOutpatientFollowUpExam[];
  /** 由报告解读生成、仅在本次工作台会话中保存的临床处置结论。 */
  assessment?: ReportFollowUpAssessment;
  ineligibleReason?: string | null;
}

export interface HisOutpatientFollowUpReportResults {
  followUpEligible: boolean;
  labReports?: HisOutpatientFollowUpLabReport[];
  examReports?: HisOutpatientFollowUpExam[];
  ineligibleReason?: string | null;
}

// ============================================================================
// 住院上下文
// ============================================================================

/**
 * 住院上下文查询入参（中性）
 *
 * 调用方至少提供 `patientId` 或一个住院锚点；PHIS 住院诊断接口使用
 * `admissionId` 映射 `idAdsn`（患者单次住院主键）。
 */
export interface HisInpatientQuery {
  patientId?: string;
  /** 住院就诊/住院流水主键 */
  inpatientVisitId?: string;
  /** 入院登记/单次住院主键（PHIS: idAdsn） */
  admissionId?: string;
  /** 通用 encounter/visit 锚点 */
  encounterId?: string;
  /** 住院号 */
  inpatientNo?: string;
  /** 病区/护理单元 ID */
  wardId?: string;
  /** 分页起点；默认由厂商 adapter 决定 */
  start?: number;
  /** 分页大小；默认由厂商 adapter 决定 */
  limit?: number;
  /** 厂商透传的查询扩展字段 */
  raw?: Record<string, unknown>;
}

/**
 * 住院病历 AI 上下文裁剪策略。
 *
 * HIS 可按本策略只返回与本次文书生成相关的数据，避免住院周期过长时把全量医嘱、
 * 体温单、检验检查和历史病程一次性塞给模型。
 */
export interface HisInpatientEmrContextPolicy {
  /** 默认 7：围绕 recordDate 返回近 N 天重点数据 */
  maxDays?: number;
  includePreviousNotes?: boolean;
  /** 默认 3：最近病程摘要条数 */
  previousNoteLimit?: number;
  includeLongStaySummary?: boolean;
  /** 默认 14：检验回看天数 */
  labLookbackDays?: number;
  /** 默认 7：医嘱变更回看天数 */
  orderLookbackDays?: number;
  onlyAbnormalLabs?: boolean;
}

export interface HisInpatientEmrContextQuery extends HisInpatientQuery {
  templateId?: string;
  templateName?: string;
  recordTime?: string;
  recordDate?: string;
  contextPolicy?: HisInpatientEmrContextPolicy;
}

export interface HisInpatientEmrDocumentContext {
  admissionId?: string;
  templateId?: string;
  templateName?: string;
  recordType?: string;
  recordTime?: string;
  recordDate?: string;
}

export interface HisInpatientEmrPatientSummary {
  patientId: string;
  name?: string;
  sex?: string;
  age?: string;
  birthDate?: string;
  inpatientNo?: string;
  medicalRecordNo?: string;
}

export interface HisInpatientEmrAdmissionSummary {
  admissionTime?: string;
  department?: string;
  ward?: string;
  bedNo?: string;
  attendingDoctor?: string;
  chiefDoctor?: string;
  allergyText?: string;
  chiefComplaint?: string;
  admissionCondition?: string;
  severeFlag?: boolean;
  raw?: Record<string, unknown>;
}

export interface HisInpatientEmrVitalsContext {
  /** recordDate 当日生命体征 */
  recordDateItems?: HisInpatientTemperatureRecord[];
  /** recordDate 之前最近一次生命体征 */
  latestBeforeRecordDate?: HisInpatientTemperatureRecord | null;
  /** 给 AI 使用的简短摘要，推荐 HIS 侧生成 */
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientEmrOrdersContext {
  active?: HisInpatientOrder[];
  changedNearRecordDate?: HisInpatientOrder[];
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientLabResult {
  reportTime?: string;
  groupName?: string;
  itemName?: string;
  result?: string;
  unit?: string;
  referenceRange?: string;
  abnormalFlag?: string;
  clinicalHint?: string;
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientLabReportSummary {
  reportTime?: string;
  groupName?: string;
  abnormal?: boolean;
  summary?: string;
  keyItems?: HisInpatientLabResult[];
}

export interface HisInpatientExamReport {
  examTime?: string;
  examName?: string;
  part?: string;
  finding?: string;
  conclusion?: string;
  negativePositive?: string;
  important?: boolean;
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientPreviousRecordSummary {
  recordId?: string;
  templateId?: string;
  recordTime?: string;
  createTime?: string;
  updateTime?: string;
  createUser?: string;
  recordType?: string;
  recordName?: string;
  /** 0 入院记录，1 病程，2 病案首页；病案首页不建议进入 AI 上下文 */
  medType?: string;
  /** 入院记录 / 病程记录等医生可读分类 */
  recordCategory?: string;
  status?: string;
  statusText?: string;
  signed?: boolean;
  contentAvailable?: boolean;
  /** 去除 HTML 标签和页眉后的病历正文摘录，按上下文策略截断 */
  content?: string;
  /** 入院记录等结构化病历的章节抽取结果 */
  structuredSections?: {
    chiefComplaint?: string;
    presentIllness?: string;
    pastMedicalHistory?: string;
    personalHistory?: string;
    familyHistory?: string;
    physicalExam?: string;
    specialistExam?: string;
    auxiliaryExam?: string;
    admissionDiagnosis?: string;
    treatmentPlan?: string;
  };
  /** 入院记录核心字段，供 AI 生成后续病程时优先引用 */
  chiefComplaint?: string;
  presentIllness?: string;
  title?: string;
  summary?: string;
}

export interface HisInpatientEmrPreviousRecordsContext {
  recentNotes?: HisInpatientPreviousRecordSummary[];
  longStaySummary?: string;
}

export interface HisInpatientConsultationSummary {
  consultationTime?: string;
  department?: string;
  opinion?: string;
  suggestion?: string;
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientOperationSummary {
  operationTime?: string;
  operationName?: string;
  anesthesia?: string;
  finding?: string;
  postoperativeDiagnosis?: string;
  summary?: string;
  raw?: Record<string, unknown>;
}

export interface HisInpatientEmrDataQuality {
  hasRecordDateVitals?: boolean;
  latestVitalsDate?: string;
  truncated?: boolean;
  truncatedReason?: string;
}

/**
 * 推荐给 AI 使用的住院病历上下文包。
 *
 * 该结构是 HIS 三方对接的住院病历 AI 上下文目标：摘要优先、明细适量、日期关系明确。
 * 住院病历生成只消费该聚合上下文，不再由桌面端分别拉取登记、医嘱和体温单后归一。
 */
export interface HisInpatientEmrContextPackage {
  documentContext?: HisInpatientEmrDocumentContext;
  patient?: HisInpatientEmrPatientSummary;
  admission?: HisInpatientEmrAdmissionSummary;
  diagnoses?: HisInpatientDiagnosis[];
  vitals?: HisInpatientEmrVitalsContext;
  orders?: HisInpatientEmrOrdersContext;
  labs?: {
    abnormal?: HisInpatientLabResult[];
    recentKeyResults?: HisInpatientLabReportSummary[];
    summary?: string;
  };
  exams?: HisInpatientExamReport[];
  previousRecords?: HisInpatientEmrPreviousRecordsContext;
  consultations?: HisInpatientConsultationSummary[];
  operations?: HisInpatientOperationSummary[];
  dataQuality?: HisInpatientEmrDataQuality;
  raw?: Record<string, unknown>;
}

/**
 * 指定患者住院诊断
 */
export interface HisInpatientDiagnosis {
  id: string;
  code?: string;
  name: string;
  /** 入院诊断 / 出院诊断 / 主要诊断等 */
  diagnosisType?: string;
  diagnosedAt?: string;
  isPrimary?: boolean;
  doctorName?: string;
  deptName?: string;
  raw?: Record<string, unknown>;
}

/**
 * 指定患者住院医嘱
 */
export interface HisInpatientOrder {
  orderId: string;
  groupId?: string;
  /** 医嘱基础名称，尽量不包含剂量、用法、频次等执行信息 */
  name: string;
  /** HIS 原始完整医嘱文本，可能已包含剂量、用法、频次 */
  fullText?: string;
  /** 推荐给 AI 摘要和病历生成使用的医嘱展示文本，避免再次拼接结构化字段造成重复 */
  displayText?: string;
  /** 药品 / 检查 / 检验 / 处置 / 护理等 */
  orderType?: string;
  status?: string;
  startTime?: string;
  stopTime?: string;
  dose?: string;
  frequency?: string;
  route?: string;
  quantity?: number;
  unit?: string;
  doctorName?: string;
  deptName?: string;
  raw?: Record<string, unknown>;
}

/**
 * 指定患者住院体温单单次记录
 */
export interface HisInpatientTemperatureRecord {
  recordTime: string;
  dtSurvey?: string;
  /** HIS 原始日期文本，如 06.05 */
  dateText?: string;
  /** HIS 原始时点文本，如 14:00 */
  timeText?: string;
  /** 测量等级 / 时点级别 */
  level?: string;
  /** 体温，单位摄氏度 */
  temperature?: number;
  /** 腋温 / 口温 / 肛温等 */
  temperatureType?: string;
  /** 是否复测 */
  isRetest?: boolean;
  /** 复测体温，单位摄氏度 */
  retestTemperature?: number;
  pulse?: number;
  heartRate?: number;
  respiration?: number;
  bloodPressureSystolic?: number;
  bloodPressureDiastolic?: number;
  spo2?: number;
  painScore?: number;
  intake?: number;
  output?: number;
  stoolCount?: number;
  urineVolume?: number;
  weight?: number;
  /** HIS detail 原文，保留未结构化生命体征 */
  detailText?: string;
  raw?: Record<string, unknown>;
}

/**
 * 指定患者住院体温单
 */
export interface HisInpatientTemperatureChart {
  patientId: string;
  inpatientVisitId?: string;
  records: HisInpatientTemperatureRecord[];
  todayRecords?: HisInpatientTemperatureRecord[];
  historyRecords?: HisInpatientTemperatureRecord[];
  raw?: Record<string, unknown>;
}

/**
 * 指定患者住院登记信息
 */
export interface HisInpatientRegistrationInfo {
  patientId: string;
  name?: string;
  gender?: string;
  birthday?: string;
  ageText?: string;
  inHospitalAgeText?: string;
  inpatientVisitId?: string;
  inpatientNo?: string;
  medicalRecordNo?: string;
  admissionNo?: string;
  admissionTime?: string;
  clinicalTime?: string;
  dischargeTime?: string;
  deptId?: string;
  deptName?: string;
  wardId?: string;
  wardName?: string;
  bedNo?: string;
  attendingDoctorName?: string;
  residentDoctorId?: string;
  attendingDoctorId?: string;
  chiefDoctorId?: string;
  admittingDoctorId?: string;
  nursingLevel?: string;
  admissionDiagnosis?: string;
  admissionDiagnosisCode?: string;
  dischargeDiagnosis?: string;
  dischargeDiagnosisCode?: string;
  allergyText?: string;
  allergyItems?: unknown[];
  isSevere?: boolean;
  isTransfer?: boolean;
  isGestation?: boolean;
  status?: string;
  diagnoses?: HisInpatientDiagnosis[];
  raw?: Record<string, unknown>;
}
