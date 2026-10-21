/**
 * 全医慧助（PCIE）HIS JS SDK TypeScript 类型声明（MedHermes 为兼容类名）
 */

/** 患者信息 */
export interface PatientInfo {
  /** 患者唯一标识 */
  idPi: string;
  /** 当前就诊唯一标识；同一患者多次就诊时建议传入 */
  idVis?: string;
  /** idVis 兼容别名 */
  visitId?: string;
  /** 患者姓名 */
  naPi: string;
  /** 性别文本，如 "男性" / "女性" */
  sdSexText: string;
  /** 年龄文本，如 "30岁" */
  ageText: string;
  /** 科室 */
  department?: string;
  /** 身份证号 */
  idCard?: string;
  /** 联系电话 */
  mobilePhone?: string;
  /** 过敏史 */
  allergyHistory?: string;
  /** 主诉 */
  chiefComplaint?: string;
  /** 现病史 */
  historyOfPresentIllness?: string;
  /** 既往史 */
  pastMedicalHistory?: string;
  /** 女性患者月经史；仅在有明确内容且本次选择回写时出现 */
  menstrualHistory?: string;
  /** 当前诊断 */
  diagnosis?: string;
  /** 体征摘要 */
  vitals?: string;
}

/** 语音问诊开始前由 HIS 固定的动态门诊模板规格 */
export interface VoiceOutpatientEmrTemplateInput {
  templateId: string;
  templateName: string;
  templateHtml: string;
  templateDefinition: string;
  targetFieldIds: string[];
  requestId: string;
}

/** 携带动态门诊模板的语音问诊患者请求；必须有本次就诊 ID */
export interface VoiceOutpatientEmrPatientInfo extends PatientInfo {
  idVis: string;
  outpatientEmr: VoiceOutpatientEmrTemplateInput;
}

/** 风险项 */
export interface RiskItem {
  /** 1=红色(高危), 2=橙色(中危), 3=黄色(低危) */
  level: 1 | 2 | 3;
  /** allergy/chronic/medication/population/vital/other */
  category: string;
  /** 风险描述文本 */
  content: string;
}

/** 灵活模式动作类型 */
export type AssistAction =
  | 'record'
  | 'suggestedDx'
  | 'diffDx'
  | 'diagnosis'
  | 'differential'
  | 'medication'
  | 'examination'
  | 'lab_test'
  | 'procedure'
  | 'treatment_plan'
  | 'reminder';

/** 报告解读任务类型 */
export type ReportInterpretationTaskId = 'inspectReport' | 'checkReport';

/** 报告解读患者上下文 */
export interface ReportInterpretationPatientInfo {
  idPi?: string;
  patientId?: string;
  idVis?: string;
  visitId?: string;
  naPi?: string;
  name?: string;
  sdSexText?: string;
  gender?: string;
  ageText?: string;
  age?: string;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  diagnosis?: string;
  [key: string]: any;
}

/** 报告解读请求 */
export interface ReportInterpretationRequest {
  taskId: ReportInterpretationTaskId;
  query: string;
  requestId?: string;
  patient?: ReportInterpretationPatientInfo;
}

/** 住院病历生成患者上下文 */
export interface InpatientEmrPatientInfo {
  idPi?: string;
  patientId?: string;
  idVis?: string;
  visitId?: string;
  naPi?: string;
  name?: string;
  sdSexText?: string;
  gender?: string;
  ageText?: string;
  age?: string;
  [key: string]: any;
}

/** 住院病历 AI 上下文裁剪策略 */
export interface InpatientEmrContextPolicy {
  maxDays?: number;
  includePreviousNotes?: boolean;
  previousNoteLimit?: number;
  includeLongStaySummary?: boolean;
  labLookbackDays?: number;
  orderLookbackDays?: number;
  onlyAbnormalLabs?: boolean;
}

/** HIS 可直接传入的住院病历 AI 上下文包；详见 docs/his-inpatient-emr-ai-context-integration.md */
export interface InpatientEmrHisContext {
  documentContext?: Record<string, any>;
  patient?: Record<string, any>;
  admission?: Record<string, any>;
  diagnoses?: Array<Record<string, any>>;
  vitals?: {
    recordDateItems?: Array<Record<string, any>>;
    latestBeforeRecordDate?: Record<string, any> | null;
    summary?: string;
    [key: string]: any;
  };
  orders?: {
    active?: Array<Record<string, any>>;
    changedNearRecordDate?: Array<Record<string, any>>;
    summary?: string;
    [key: string]: any;
  };
  labs?: Record<string, any>;
  exams?: Array<Record<string, any>>;
  previousRecords?: Record<string, any>;
  consultations?: Array<Record<string, any>>;
  operations?: Array<Record<string, any>>;
  dataQuality?: Record<string, any>;
  [key: string]: any;
}

/** 住院病历生成请求 */
export interface InpatientEmrGenerationRequest {
  /** 患者单次住院登记主键，PHIS 对应 idAdsn */
  admissionId: string;
  /** 病历模板主键，后端模板缓存按该字段命中 */
  templateId: string;
  /** 模板名称，如日常病程记录 */
  templateName: string;
  /** 当前病历模板 HTML */
  htmlContent: string;
  /** 本次病程记录书写时间，如 2026-06-10 15:25；未传时桌面端使用当前系统时间 */
  recordTime?: string;
  /** 医生补充的本次病历书写要点，可由重新生成时输入或语音转写得到 */
  doctorSupplement?: string;
  /** HIS 侧上下文裁剪策略；当未直接传 hisContext 时，适配器可按此策略拉取上下文 */
  contextPolicy?: InpatientEmrContextPolicy;
  /** HIS 直接传入的 AI 上下文包；存在时桌面端优先使用该数据，避免重复拉取全量住院数据 */
  hisContext?: InpatientEmrHisContext;
  /** HIS 侧请求 ID；传入后也会作为一键回写 requestId */
  requestId?: string;
  /** 可选患者兜底信息 */
  patient?: InpatientEmrPatientInfo;
}

/** 门急诊病历模板分析所使用的临床事实包 */
export interface OutpatientEmrRecordContext {
  recordText?: string;
  sections?: Record<string, unknown>;
  conversationText?: string;
  structuredFacts?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 门急诊模板分析患者校验事实；不接受其他字段或历史别名 */
export interface OutpatientEmrPatientInput {
  idPi?: string;
  name?: string;
  sdSexText?: string;
  ageText?: string;
}

/** 门急诊病历模板单次分析请求；所有身份字段由 HIS 显式提供 */
export interface OutpatientEmrAnalysisRequest {
  /** 本次门急诊就诊唯一标识，最终直接作为 consultationId */
  visitId: string;
  /** HIS 当前选中模板的唯一标识 */
  templateId: string;
  /** HIS 当前选中模板名称 */
  templateName: string;
  /** 同一模板经正式渲染器输出的当前 HTML 实例 */
  templateHtml: string;
  /** 同一模板的顶层章节 JSON 结构定义；与 templateHtml 按稳定 ID 配对 */
  templateDefinition: string;
  /** 模板渲染器确定的当前可写字段白名单；至少一项，桌面端不会执行模板联动脚本或自动扩充 */
  targetFieldIds: string[];
  /** 本次分析所依据的严格 JSON 临床事实；SDK 拒绝 undefined、非有限数值、Date、函数和循环引用 */
  recordContext: OutpatientEmrRecordContext;
  /** 可选患者主体、性别和年龄等校验事实 */
  patient?: OutpatientEmrPatientInput;
  /** HIS 生成的稳定请求 ID；SDK 不代生成、不修剪 */
  requestId: string;
}

/** 引用回执状态 */
export type FeedbackStatus = 'success' | 'failed' | 'pending' | 'cancelled';

/** 结果类型 */
export type ResultType =
  | 'draft'
  | 'record-confirmed'
  | 'final-report'
  | 'batch'
  | 'reference-request'
  | 'reference-feedback'
  | 'cancelled';

/** 结果状态 */
export type ConsultationResultState = 'pending' | 'ready' | 'cancelled';

/** 诊断项 */
export interface DiagnosisItem {
  name: string;
  code?: string;
  isTCM?: boolean;
}

/** 药品项 */
export interface MedicationItem {
  name: string;
  spec?: string;
  usage?: string;
  idMedPro?: string;
  dosage?: string;
  dosageUnit?: string;
  totalQty?: string;
  totalUnit?: string;
  frequency?: string;
  route?: string;
  days?: string;
  pharmacy?: string;
  remark?: string;
  regulatedDisease?: string;
  insuranceType?: string;
}

/** 检查/检验/处置项 */
export interface ExamItem {
  name: string;
  idCli?: string;
  regulatedDisease?: string;
  bodySite?: string;
  totalQty?: string;
  execDept?: string;
  remark?: string;
  insuranceType?: string;
}

/** 引用项 */
export interface ReferenceItem {
  name: string;
  code?: string | null;
  type: 'diagnosis' | 'medication' | 'examination' | 'lab_test' | 'procedure';
  idCli?: string;
  isTCM?: boolean;
}

/** PHIS 检验检查互认候选项 */
export interface RecognizableItem {
  idSrv: string;
  idCli?: string;
  naSrv: string;
  naCli?: string;
  sdSrv: '31' | '41' | string;
  mutualRecognitionCode: string;
  priceSale?: number;
}

export interface MutualRecognitionDecision {
  decision: 'recognize' | 'not_recognize' | 'cancel';
  recognizedItemIds?: string[];
}

export interface RecordTemplateSlotChange {
  field: 'pastMedicalHistory' | 'personalHistory' | 'familyHistory';
  slotKey: string;
  fromValue: '否认';
  toValue: '有';
  templateMarker: string;
  replacementMarker: string;
}

export interface RecordTemplateChanges {
  schemaVersion: 'outpatient-record-template-changes.v1';
  items: RecordTemplateSlotChange[];
}

/** 问诊结果 payload */
export interface ConsultationResultPayload {
  resultType?: ResultType;
  requestId?: string;
  emrType?: string;
  admissionId?: string;
  templateName?: string;
  fieldValues?: Record<string, string>;
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  /** 女性患者月经史；仅在有明确内容且本次选择回写时出现 */
  menstrualHistory?: string;
  diagnosisList?: DiagnosisItem[];
  medications?: MedicationItem[];
  examinations?: ExamItem[];
  labTests?: ExamItem[];
  procedures?: ExamItem[];
  treatmentPlan?: string;
  medicalSummary?: string;
  /** 固定病史模板的结构化槽位变化；PHIS 按 field + slotKey 精确更新 */
  recordTemplateChanges?: RecordTemplateChanges;
  /** 引用闭环字段 */
  referenceType?: string;
  referenceStatus?: string;
  referenceMessage?: string;
  referenceItems?: ReferenceItem[];
  recognizableItems?: RecognizableItem[];
  recognitionDecision?: MutualRecognitionDecision;
}

/** 住院病历一键回写 payload */
export interface InpatientEmrWritebackPayload extends ConsultationResultPayload {
  resultType: 'record-confirmed';
  requestId: string;
  referenceType: 'batch';
  action: 'batch';
  referenceStatus: string;
  emrType: 'inpatient-emr';
  admissionId: string;
  templateName?: string;
  fieldValues: Record<string, string>;
}

export type OutpatientEmrRecordField =
  | 'chiefComplaint'
  | 'historyOfPresentIllness'
  | 'pastMedicalHistory'
  | 'personalHistory'
  | 'menstrualHistory'
  | 'familyHistory'
  | 'physicalExam'
  | 'precautions';

export type OutpatientEmrProjectionMode = 'direct' | 'section-compose';
export type OutpatientEmrWritebackOrderType = 'medicine' | 'exam' | 'lab_test' | 'procedure';

export interface OutpatientEmrDictionaryItem {
  value: string;
  text: string;
}

export interface OutpatientEmrTemplateFieldMetadata {
  id: string;
  name: string;
  type: string;
  articleTemplateId: string;
  articleId: string;
  articleName: string;
  articleDefinitionName: string;
  dictionaryItems: OutpatientEmrDictionaryItem[];
  recordField: OutpatientEmrRecordField | null;
  mappingSource:
    | 'definition-record-field'
    | 'definition-article-record-field'
    | 'canonical-id'
    | 'deterministic-alias'
    | 'deterministic-article'
    | 'unmapped';
  projectionMode: OutpatientEmrProjectionMode | null;
}

export interface OutpatientEmrTemplateMetadata {
  schemaVersion: 'outpatient-emr-template-pair.v1';
  templateId: string;
  templateName: string;
  templateHash: string;
  fields: OutpatientEmrTemplateFieldMetadata[];
}

/** 门急诊模板参数回传 payload */
export interface OutpatientEmrWritebackPayload extends ConsultationResultPayload {
  consultationId: string;
  visitId: string;
  timestamp: number;
  resultType: 'record-confirmed';
  requestId: string;
  referenceType: 'batch';
  action: 'batch';
  referenceStatus: 'pending';
  referenceMessage:
    | '等待 HIS 完成门诊模板参数回填并回执'
    | '等待 HIS 完成动态模板及已选诊疗内容回写并回执';
  emrType: 'outpatient-emr';
  templateMetadata: OutpatientEmrTemplateMetadata;
  fieldValues: Record<string, string>;
  dictionarySelections: Record<string, OutpatientEmrDictionaryItem>;
  outpatientRecord?: {
    schemaVersion: 'outpatient-record.v1';
  } & Partial<Record<OutpatientEmrRecordField, string>>;
  writebackScope: {
    recordFields: OutpatientEmrRecordField[];
    includeDiagnosis: boolean;
    orderTypes: OutpatientEmrWritebackOrderType[];
  };
  diagList?: Array<Record<string, string>>;
  orderList: Array<Record<string, string | number>>;
  treatmentPlan?: string;
}

/** 单条问诊事件 */
export interface ConsultationEvent {
  id: string;
  type: ResultType | null;
  consultationId: string;
  requestId?: string | null;
  timestamp: number;
  terminal: boolean;
  payload: ConsultationResultPayload;
}

/** consultation/events/ws 推送的事件 envelope */
export interface ConsultationEventEnvelope {
  state: ConsultationResultState;
  event: ConsultationEvent | null;
  traceId?: string;
  timestamp?: number;
  code?: string;
  message?: string;
}

/** 浏览器上下文 */
export interface BrowserContext {
  origin: string;
  href: string;
  cookie: string;
  userAgent: string;
  timestamp: number;
  sdkVersion: string;
  extra?: Record<string, any>;
}

/** SDK 构造参数 */
export type PublicHealthCapability = 'health_prescription' | 'weight_management';
export type PublicHealthScene = 'hypertension_followup' | 'diabetes_followup' | 'elderly_exam';
export type PublicHealthSectionId = 'check_plan' | 'medication_guidance' | 'lifestyle_guidance' | 'exercise_plan' | 'meal_plan';
export interface PublicHealthFactSource { system: string; recordId: string }
export interface PublicHealthObservation {
  id: string; code: string; value: string | number; unit?: string;
  observedAt: string; source: PublicHealthFactSource;
}
export interface PublicHealthWeightProfile {
  heightCm: number; weightKg: number;
  region: '东北' | '华北' | '华东' | '华中' | '华南' | '西南' | '西北';
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  heightObservationId?: string; weightObservationId?: string; contextSource?: PublicHealthFactSource;
  activityDescription?: string; dietPreferences?: string; limitations?: string;
}
export interface PublicHealthFacts {
  observations: PublicHealthObservation[];
  conditions: Array<{ code: string; name: string; status: string }>;
  medicationClasses: Array<{ code: string; name: string }>;
  lifestyle: Partial<Record<'smoking' | 'alcohol' | 'exercise' | 'diet' | 'exerciseAbility' | 'occupation', string>>;
  historySummary?: string; nextFollowUpDate?: string; weightProfile?: PublicHealthWeightProfile;
}
export interface PublicHealthPatient { name: string; sex: 'male' | 'female' | 'unknown'; ageYears: number; sexSource?: PublicHealthFactSource }
export interface PublicHealthIdentity {
  capability: PublicHealthCapability; scene: PublicHealthScene; patientId: string;
  businessRecordId: string; recordVersion: string; snapshotAt: string;
  originRequestId: string; requestId: string;
}
export interface PublicHealthTarget {
  targetFieldId: string; label: string; sourceSections: PublicHealthSectionId[];
  valueType: 'string'; mode: 'replace';
}
export interface PublicHealthRequest extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; patient: PublicHealthPatient;
  facts: PublicHealthFacts; writebackTargets: PublicHealthTarget[];
}
export interface PublicHealthConfirmed extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; writebackRequestId: string;
  items: Array<{ targetFieldId: string; sourceSections: PublicHealthSectionId[]; value: string }>;
  confirmedAt: string;
}
export interface PublicHealthFeedback extends PublicHealthIdentity {
  schemaVersion: 'public-health.v1'; generationId: string; writebackRequestId: string;
  status: 'success' | 'failed'; savedRecordVersion?: string; errorCode?: string;
  message?: string; feedbackAt: string;
}

export interface PublicHealthBridgeSession {
  status: 'ready';
  schemaVersion: 'public-health.v1';
  bridgeSessionId: string;
  publicHealthBridgeToken: string;
  expiresAt: string;
  renewUntil: string;
}

export interface MedHermesOptions {
  /** 本地桥接地址，默认 http://127.0.0.1:8081/api */
  baseUrl?: string;
  /** WebSocket 首次重连等待时间（毫秒），默认 1000，后续按指数增长 */
  wsReconnectMs?: number;
  /** WebSocket 重连退避上限（毫秒），默认 30000 */
  wsReconnectMaxMs?: number;
  /** 深度链接协议名，默认 med-hermes */
  scheme?: string;
  /** 协议拉起后等待重连时间（毫秒），默认 3000 */
  launchRetryMs?: number;
  /** HTTP 请求超时（毫秒），默认 5000 */
  timeout?: number;
  /** 自定义浏览器上下文扩展字段，公卫沿用医疗 emrAccessToken / urt */
  extra?: Record<string, any>;
  /** 公卫实例身份；省略时由 SDK 安全生成 UUID，无需配对配置 */
  publicHealth?: { sdkInstanceId?: string };
}

/** 事件类型映射 */
export interface MedHermesEvents {
  'public-health-connected': (info: { bridgeSessionId: string; expiresAt: string }) => void;
  'public-health-error': (error: Error & { code?: string }) => void;
  'public-health-result-confirmed': (payload: PublicHealthConfirmed) => void;
  'event': (event: ConsultationEventEnvelope) => void;
  'draft': (result: ConsultationResultPayload) => void;
  'final-report': (result: ConsultationResultPayload) => void;
  'batch': (result: ConsultationResultPayload) => void;
  'record-confirmed': (result: ConsultationResultPayload) => void;
  'reference-request': (result: ConsultationResultPayload) => void;
  'reference-feedback': (result: ConsultationResultPayload) => void;
  'cancelled': (event: ConsultationEventEnvelope) => void;
  'connected': (info: any) => void;
  'disconnected': () => void;
  'launching': () => void;
  'launch-failed': () => void;
  'error': (err: Error) => void;
  'subscription-start': () => void;
  'subscription-stop': () => void;
  'subscription-transport': (info: { transport: 'websocket'; state: 'connected' | 'closed' | 'error' }) => void;
}

/** 握手响应 */
export interface HandshakeResponse {
  status: string;
  version: string;
  timestamp: number;
  traceId?: string;
  publicHealth?: PublicHealthBridgeSession;
}

/** 浏览器上下文 / 调试握手参数 */
export interface HandshakeContext {
  origin?: string;
  href?: string;
  cookie?: string;
  userAgent?: string;
  timestamp?: number;
  sdkVersion?: string;
  extra?: Record<string, any>;
}

/** API 响应 */
export interface ApiResponse {
  status: string;
  consultationId?: string;
  visitId?: string;
  action?: string;
  traceId?: string;
  taskId?: ReportInterpretationTaskId;
  message?: string;
  requestId?: string;
  referenceType?: string;
  timestamp?: number;
}

export declare class MedHermes {
  static readonly VERSION: string;

  constructor(options?: MedHermesOptions);

  /** 初始化 SDK：采集浏览器上下文 + 与桌面端握手 */
  init(extra?: Record<string, any>): Promise<HandshakeResponse>;

  /** 复用医疗上下文、握手和协议拉起；仅订阅隔离的公卫结果通道 */
  initPublicHealth(extra?: Record<string, any>): Promise<PublicHealthBridgeSession>;

  /** 自动准备公卫连接后提交本次调入，返回值仅表示已受理 */
  assistPublicHealth(request: PublicHealthRequest): Promise<ApiResponse>;

  /** 反馈本实例收到的冻结保存意图的真实终态 */
  sendPublicHealthFeedback(feedback: PublicHealthFeedback): Promise<ApiResponse>;

  /** 调试模式：手动覆盖握手入参 */
  debugHandshake(overrides?: HandshakeContext): Promise<HandshakeResponse>;

  /** 仅检测桌面端桥接服务是否在线，不执行授权握手 */
  ping(): Promise<HandshakeResponse>;

  /** 启动完整问诊 */
  startConsultation(patient: PatientInfo): Promise<ApiResponse>;

  /** 灵活模式 */
  assist(patient: PatientInfo, action: AssistAction): Promise<ApiResponse>;

  /** 启动语音问诊 */
  startVoice(): Promise<ApiResponse>;
  startVoice(patient: PatientInfo): Promise<ApiResponse>;
  startVoice(patient: VoiceOutpatientEmrPatientInfo): Promise<ApiResponse>;

  /** 触发报告解读 */
  interpretReport(request: ReportInterpretationRequest): Promise<ApiResponse>;
  interpretReport(
    taskId: ReportInterpretationTaskId,
    query: string,
    patient?: ReportInterpretationPatientInfo
  ): Promise<ApiResponse>;

  /** 触发住院病历辅助生成；Promise 在医生点击一键回写并产生 record-confirmed 时 resolve */
  generateInpatientEmr(request: InpatientEmrGenerationRequest): Promise<InpatientEmrWritebackPayload>;
  generateInpatientEmr(
    admissionId: string,
    htmlContent: string,
    options: Omit<InpatientEmrGenerationRequest, 'admissionId' | 'htmlContent'>
  ): Promise<InpatientEmrWritebackPayload>;

  /** 单次分析门急诊病历模板；显式取消、请求失败或 SDK 销毁时 Promise reject */
  analyzeOutpatientEmr(request: OutpatientEmrAnalysisRequest): Promise<OutpatientEmrWritebackPayload>;

  /** 结束当前接诊 */
  stop(): Promise<ApiResponse>;

  /** 推送患者风险信息 */
  sendRisks(patient: PatientInfo, risks?: RiskItem[]): Promise<ApiResponse>;

  /** 发送 PHIS 引用回执 */
  sendFeedback(
    requestId: string,
    status: FeedbackStatus,
    message?: string,
    items?: Array<ReferenceItem | RecognizableItem>
  ): Promise<ApiResponse>;

  /** 订阅事件流，返回取消订阅函数 */
  subscribe(listener: (event: ConsultationEventEnvelope) => void): () => void;

  /** 销毁实例 */
  destroy(): void;

  /** 注册事件监听 */
  on<E extends keyof MedHermesEvents>(event: E, handler: MedHermesEvents[E]): this;

  /** 取消事件监听 */
  off<E extends keyof MedHermesEvents>(event: E, handler?: MedHermesEvents[E]): this;
}

export interface MedHermesLoaderStatus {
  online: boolean;
  sdkLoaded: boolean;
  instance: MedHermes | null;
}

export interface MedHermesLoaderApi {
  ready(fn: (mh: MedHermes | null) => void): void;
  onError(fn: (err: Error) => void): void;
  getStatus(): MedHermesLoaderStatus;
  ping(): Promise<HandshakeResponse>;
  detect(): Promise<boolean>;
  launch(): void;
  init(extra?: Record<string, any>): Promise<MedHermes>;
  startConsultation(patient: PatientInfo): Promise<ApiResponse>;
  assist(patient: PatientInfo, action: AssistAction): Promise<ApiResponse>;
  startVoice(): Promise<ApiResponse>;
  startVoice(patient: PatientInfo): Promise<ApiResponse>;
  startVoice(patient: VoiceOutpatientEmrPatientInfo): Promise<ApiResponse>;
  interpretReport(request: ReportInterpretationRequest): Promise<ApiResponse>;
  interpretReport(
    taskId: ReportInterpretationTaskId,
    query: string,
    patient?: ReportInterpretationPatientInfo
  ): Promise<ApiResponse>;
  generateInpatientEmr(request: InpatientEmrGenerationRequest): Promise<InpatientEmrWritebackPayload>;
  generateInpatientEmr(
    admissionId: string,
    htmlContent: string,
    options: Omit<InpatientEmrGenerationRequest, 'admissionId' | 'htmlContent'>
  ): Promise<InpatientEmrWritebackPayload>;
  analyzeOutpatientEmr(request: OutpatientEmrAnalysisRequest): Promise<OutpatientEmrWritebackPayload>;
  receivePatient(patientId: string, optionalInfo?: Partial<PatientInfo>): Promise<ApiResponse>;
  sendRisks(patient: PatientInfo, risks?: RiskItem[]): Promise<ApiResponse>;
  sendFeedback(
    requestId: string,
    status: FeedbackStatus,
    message?: string,
    items?: Array<ReferenceItem | RecognizableItem>
  ): Promise<ApiResponse>;
  stop(): Promise<ApiResponse>;
}

export declare const MedHermesLoader: MedHermesLoaderApi;

export default MedHermes;
