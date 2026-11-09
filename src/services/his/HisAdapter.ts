/**
 * HIS 厂商适配器接口（vendor-neutral）
 *
 * 这是医诺浮球与"具体 HIS 厂商接口"之间的契约层。任何新厂商对接，只要
 * 实现本接口并通过 `registerHisAdapter` 注册即可，无需改动业务调用方。
 *
 * 当前默认实现：`PhisHisAdapter`（包装 `HisService` 类，对应 PHIS / 国卫 PHIS 形态）。
 *
 * 设计原则：
 * 1. **业务方法粒度**：一个方法 = 一个业务用例（拉诊断目录 / 拉药品目录 / 校验库存…），
 *    不暴露原始 HTTP 路径或 PHIS 风格的 `body/items` 包装结构。
 * 2. **入参 / 返回结构中性化**：调用方只面向 `his/types.ts` 中的中性 DTO 编程；
 *    厂商私有字段一律通过 `raw` 透传，业务通用代码不读 `raw`。
 * 3. **失败语义统一**：方法以 `Promise.reject(Error)` 抛错，调用方按 `Error` 处理；
 *    具体厂商在实现内部把私有错误码翻译成业务异常。
 * 4. **认证上下文**：通过 `updateContext` 刷新；adapter 自身不感知 token 来源（HIS 网页端
 *    SDK handshake / 区域化模式 JWT 都走同一个入口）。
 *
 * 调用方应优先使用 `getHisAdapter()` 而不是直接 new HisService / new SomeVendorAdapter。
 */

import type { HisServiceContext, PharmacyOption } from '../hisService';
import type {
  DiagnosisCatalogEntry,
  AvailableMedicineInventoryItem,
  DictionaryEntry,
  HisContextScope,
  InventoryCheckRequest,
  InventoryCheckResult,
  MedicalItemCatalogEntry,
  MedicalItemDetail,
  MedicalItemPartOption,
  MedicineCatalogEntry,
  MedicineDetail,
  HisPatientInfo,
  HisPatientHistory,
  HisPatientHistoryQuery,
  HisOutpatientVisit,
  HisOutpatientVisitHistoryQuery,
  HisOutpatientMedicalRecordDocument,
  HisOutpatientMedicalRecord,
  HisOutpatientFollowUpContext,
  HisOutpatientFollowUpContextQuery,
  HisOutpatientFollowUpReportResults,
  HisOutpatientFollowUpReportResultsQuery,
  HisInpatientEmrContextPackage,
  HisInpatientEmrContextQuery,
} from './types';

export type { HisServiceContext, PharmacyOption };
export type {
  DiagnosisCatalogEntry,
  AvailableMedicineInventoryItem,
  DictionaryEntry,
  HisContextScope,
  InventoryCheckRequest,
  InventoryCheckResult,
  MedicalItemCatalogEntry,
  MedicalItemDetail,
  MedicalItemPartOption,
  MedicineCatalogEntry,
  MedicineDetail,
  HisPatientInfo,
  HisPatientHistory,
  HisPatientHistoryQuery,
  HisOutpatientVisit,
  HisOutpatientVisitHistoryQuery,
  HisOutpatientMedicalRecordDocument,
  HisOutpatientMedicalRecord,
  HisOutpatientFollowUpContext,
  HisOutpatientFollowUpContextQuery,
  HisOutpatientFollowUpReportResults,
  HisOutpatientFollowUpReportResultsQuery,
  HisInpatientDiagnosis,
  HisInpatientOrder,
  HisInpatientEmrContextPackage,
  HisInpatientEmrContextPolicy,
  HisInpatientEmrContextQuery,
  HisInpatientQuery,
  HisInpatientRegistrationInfo,
  HisInpatientTemperatureChart,
} from './types';

/**
 * HIS 适配器接口
 *
 * 所有方法均为异步；实现需保证：在 token / baseUrl 缺失时同步抛错，而不是返回空数组，
 * 以便调用方的"未初始化"分支能命中（见 VoiceConsultationNew 的 fetchXxxOptions 模式）。
 */
export interface HisAdapter {
  /** 厂商标识，仅用于日志/调试，不参与业务路由 */
  readonly vendor: string;

  // ---- 上下文与会话 ----

  /** 刷新登录用户/角色相关的上下文（如执行科室列表） */
  updateContext(context: HisServiceContext): void;

  /** 当前登录用户的默认执行科室 ID（用于检查/检验项默认填充） */
  getDefaultExecDeptId(): string;

  /** 当前机构与租户，用于隔离持久化缓存。 */
  getContextScope(): HisContextScope;

  // ---- 目录同步：用于本地标准库匹配（中央 / 机构两层） ----

  /** 全机构通用：标准诊断（ICD）目录 */
  fetchDiagnosisCatalog(): Promise<DiagnosisCatalogEntry[]>;

  /** 机构维度：当前可开立的检查/检验目录（接诊级实时事实，不写入缓存） */
  fetchInstitutionMedicalItemsCatalog(orgCode: string): Promise<MedicalItemCatalogEntry[]>;

  /** 机构维度：治疗/处置等非检查检验诊疗项目目录（按机构 + 租户写入缓存） */
  fetchInstitutionTreatmentItemsCatalog(): Promise<MedicalItemCatalogEntry[]>;

  /** 机构维度：药品目录 */
  fetchInstitutionMedicineCatalog(orgCode: string): Promise<MedicineCatalogEntry[]>;

  /** 机构维度：药房（药库）storeId 列表；优先复用当前可用发药药房，若为空再回退到药房目录 */
  fetchMedicineStoreIds(orgCode: string): Promise<string[]>;

  // ---- 字典与可选项（语音问诊编辑器使用） ----

  /** 频次字典（每日 X 次 / Q12H 等） */
  fetchFrequencyDictionary(): Promise<DictionaryEntry[]>;

  /** 用药途径 / 给药方式字典 */
  fetchMedicineUsageDictionary(): Promise<DictionaryEntry[]>;

  /** 当前用户可见的执行科室字典 */
  fetchExecutionDepartments(): Promise<DictionaryEntry[]>;

  /** 当前用户可见的药房选项（含 idDept / idSto） */
  fetchAvailablePharmacies(): Promise<PharmacyOption[]>;

  /** 获取指定发药药房的有效库存目录；同药品多批次由 adapter 合并。 */
  fetchAvailableMedicineInventory(storeId: string): Promise<AvailableMedicineInventoryItem[]>;

  // ---- 详情按需拉取 ----

  /**
   * 检查/检验/处置项详情。厂商实现须将私有响应映射为 vendor-neutral 的
   * `MedicalItemDetail`。原始响应体仍可通过返回值的 `raw` 访问。
   */
  fetchMedicalItemDetail(itemId: string): Promise<MedicalItemDetail | null>;

  /** 检查项目部位 / 方式候选。仅检查项目需要，检验 / 处置可返回空数组。 */
  fetchMedicalItemPartOptions(itemId: string): Promise<MedicalItemPartOption[]>;

  /**
   * 药品详情（按药房维度）。同上，返回 vendor-neutral 的 `MedicineDetail`。
   */
  fetchMedicineProDetail(productId: string, storeId: string): Promise<MedicineDetail | null>;

  /** 处方下达前的库存校验 */
  checkMedicineInventoryEnough(items: InventoryCheckRequest[]): Promise<InventoryCheckResult>;

  // ---- 接诊与患者信息 ----

  /**
   * 拉取患者基本信息（用于接诊时初始化上下文）
   */
  fetchPatientInfo(patientId: string): Promise<HisPatientInfo | null>;

  /**
   * 拉取患者就诊历史（用于完善本地记忆系统）
   * @param patientId 患者ID
   * @returns 就诊历史，若无历史或不支持则返回 null，调用方按无记录处理
   */
  fetchPatientHistory(
    patientId: string,
    query?: HisPatientHistoryQuery,
  ): Promise<HisPatientHistory | null>;

  /** 获取门诊复诊所需的历史病历纯文本和已报告检验检查结果。兼容旧 PHIS 聚合入口。 */
  fetchOutpatientFollowUpContext(
    query: HisOutpatientFollowUpContextQuery,
  ): Promise<HisOutpatientFollowUpContext | null>;

  /** 获取报告回诊所需的本次已出 LIS/PACS 报告结果；本次病历文本由接诊链路提供。 */
  fetchOutpatientFollowUpReportResults(
    query: HisOutpatientFollowUpReportResultsQuery,
  ): Promise<HisOutpatientFollowUpReportResults | null>;

  // ---- 住院上下文 ----

  /**
   * 住院病历 AI 生成唯一上下文入口：按本次病历书写场景返回已裁剪、已摘要的 AI 上下文包。
   *
   * 新 HIS 厂商必须实现本方法；业务层不再回退到登记/医嘱/体温单等旧粒度接口。
   */
  fetchInpatientEmrContext(query: HisInpatientEmrContextQuery): Promise<HisInpatientEmrContextPackage | null>;

  /**
   * 根据患者 ID 获取门诊就诊历史列表（仅限门急诊）。
   *
   * 入院记录引用场景默认按时间范围查询并过滤为“有诊断 + 有病历文书”的可用就诊。
   */
  fetchOutpatientVisitHistory(
    patientId: string,
    query?: number | HisOutpatientVisitHistoryQuery,
  ): Promise<HisOutpatientVisit[]>;

  /**
   * 根据门诊就诊 ID 获取该次门急诊病历文书列表。
   *
   * PHIS 当前只提供文书列表；正文内容接口后续补充后再映射为完整病历详情。
   */
  fetchOutpatientMedicalRecordDocuments(visitId: string): Promise<HisOutpatientMedicalRecordDocument[]>;

  /**
   * 根据就诊 ID 获取门急诊病历 HTML 内容
   */
  fetchOutpatientMedicalRecord(visitId: string): Promise<HisOutpatientMedicalRecord | null>;
}
