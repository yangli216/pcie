/**
 * 窗口尺寸常量定义
 *
 * 定义应用中所有视图的标准窗口尺寸（逻辑像素）。
 * 这些值用于窗口展开/收起动画和尺寸调整。
 *
 * @module constants/windowSizes
 */

/**
 * 窗口尺寸配置类型
 */
export interface WindowSize {
  /** 窗口宽度（逻辑像素） */
  width: number;
  /** 窗口高度（逻辑像素） */
  height: number;
}

export type VoiceInteractionWindowStage = 'recording' | 'processing' | 'stopped' | 'expanded';

export interface WindowSizeOptions {
  expanded?: boolean;
  riskCount?: number;
  hasChronicRefill?: boolean;
  chronicScopeSelecting?: boolean;
  hasFollowUp?: boolean;
  hasReportInterpretation?: boolean;
  voiceStage?: VoiceInteractionWindowStage;
}

export interface WindowSizeConstraints {
  minWidth: number;
  minHeight: number;
}

/**
 * 视图类型定义
 * 对应 App.vue 中的 currentView 状态
 */
export type ViewType =
  | 'chat'
  | 'settings'
  | 'consultation'
  | 'risk-alert'
  | 'voice-interaction'
  | 'voice-consultation'
  | 'treatment-plan'
  | 'outpatient-follow-up'
  | 'report-interpretation'
  | 'patient-memory'
  | 'inpatient-emr'
  | 'outpatient-emr'
  | 'public-health'
  | 'differential-diagnosis'
  | 'reception-capsule'
  | 'his-log'
  | 'medical-cache'
  | 'knowledge-base';

/**
 * 窗口尺寸配置集合
 *
 * 包含所有视图模式和工作模式的标准尺寸定义。
 * 物理像素 = 逻辑像素 × scaleFactor（由系统 DPI 决定）
 */
export const WINDOW_SIZES = {
  /** 悬浮球模式：160×160px 透明窗口 */
  BALL: { width: 160, height: 160 } as WindowSize,

  /** 标准工作面板：378×449px（聊天、设置等） */
  WORK: { width: 378, height: 449 } as WindowSize,

  /** 聊天窗口：420×620px，窄高比例避免欢迎区和输入区互相挤压 */
  CHAT: { width: 420, height: 620 } as WindowSize,

  /** 诊断路径：972×608px 独立 Sankey 说明窗口 */
  DIAGNOSIS_PATH: { width: 972, height: 608 } as WindowSize,

  /** 问诊页面：1120×760px 双栏工作台，给结果编辑和底部操作保留初始空间 */
  CONSULTATION: { width: 1120, height: 760 } as WindowSize,

  /** 语音胶囊录音态：360×80px 千千静听歌词风格紧凑条 */
  CAPSULE: { width: 360, height: 80 } as WindowSize,

  /** 语音胶囊处理中：360×96px */
  CAPSULE_PROCESSING: { width: 360, height: 96 } as WindowSize,

  /** 语音胶囊停录预览：360×140px */
  CAPSULE_STOPPED: { width: 360, height: 140 } as WindowSize,

  /** 语音胶囊展开编辑：360×248px */
  CAPSULE_EXPANDED: { width: 360, height: 248 } as WindowSize,

  /** 风险评估卡片：280×92px，仅展示头部（头像+姓名+状态徽章） */
  RISK_CARD: { width: 280, height: 92 } as WindowSize,

  /** 风险评估卡片单条详情基线：280×196px；更多风险按行增高 */
  RISK_CARD_EXPANDED: { width: 280, height: 196 } as WindowSize,

  /** 语音问诊页面：1080×720px */
  VOICE_CONSULTATION: { width: 1080, height: 720 } as WindowSize,

  /** 独立诊疗方案推荐：1080×720px */
  TREATMENT_PLAN: { width: 1080, height: 720 } as WindowSize,

  /** 门诊复诊工作台：1280×760px，左侧依据预览，右侧诊疗方案 */
  OUTPATIENT_FOLLOW_UP: { width: 1280, height: 760 } as WindowSize,

  /** 报告助手工作台：左侧报告时间轴，右侧报告单式解读 */
  REPORT_INTERPRETATION: { width: 1280, height: 760 } as WindowSize,

  /** 患者健康画像工作台：三栏画像摘要、病程时间线与行动建议 */
  PATIENT_MEMORY: { width: 1120, height: 760 } as WindowSize,

  /** 住院病历辅助生成：1120×760px */
  INPATIENT_EMR: { width: 1120, height: 760 } as WindowSize,

  /** 门诊病历模板分析：1120×760px */
  OUTPATIENT_EMR: { width: 1120, height: 760 } as WindowSize,

  /** 独立公卫资料核对与回写工作台 */
  PUBLIC_HEALTH: { width: 1120, height: 760 } as WindowSize,

  /** 独立鉴别诊断小窗：仅承载鉴别排查确认弹窗 */
  DIFFERENTIAL_DIAGNOSIS: { width: 360, height: 640 } as WindowSize,

  /** HIS 联调日志：980×640px */
  HIS_LOG: { width: 980, height: 640 } as WindowSize,

  /** 基础数据缓存管理：980×640px */
  MEDICAL_CACHE: { width: 980, height: 640 } as WindowSize,
} as const;

const WINDOW_SIZE_CONSTRAINTS: Partial<Record<ViewType, WindowSizeConstraints>> = {
  chat: { minWidth: WINDOW_SIZES.WORK.width, minHeight: WINDOW_SIZES.WORK.height },
  settings: { minWidth: WINDOW_SIZES.WORK.width, minHeight: WINDOW_SIZES.WORK.height },
  consultation: { minWidth: WINDOW_SIZES.CONSULTATION.width, minHeight: WINDOW_SIZES.CONSULTATION.height },
  'voice-consultation': { minWidth: 900, minHeight: 620 },
  'treatment-plan': { minWidth: 900, minHeight: 620 },
  'outpatient-follow-up': { minWidth: 1000, minHeight: 620 },
  'report-interpretation': { minWidth: 1000, minHeight: 620 },
  'patient-memory': { minWidth: 980, minHeight: 620 },
  'inpatient-emr': { minWidth: 900, minHeight: 620 },
  'outpatient-emr': { minWidth: 900, minHeight: 620 },
  'public-health': { minWidth: 900, minHeight: 620 },
  'differential-diagnosis': { minWidth: 360, minHeight: 560 },
  'his-log': { minWidth: 760, minHeight: 520 },
  'medical-cache': { minWidth: 760, minHeight: 520 },
  'knowledge-base': { minWidth: WINDOW_SIZES.WORK.width, minHeight: WINDOW_SIZES.WORK.height },
};

export function getWindowSizeConstraints(view: ViewType): WindowSizeConstraints {
  return WINDOW_SIZE_CONSTRAINTS[view] ?? {
    minWidth: WINDOW_SIZES.BALL.width,
    minHeight: WINDOW_SIZES.BALL.height,
  };
}

/** 大工作台不需要在整个透明原生窗口上持续做玻璃模糊合成。 */
export function isLargeWorkspaceView(view: ViewType): boolean {
  return getWindowSizeForView(view).width >= 900 && !isCapsuleView(view);
}

/**
 * 根据视图类型获取对应的窗口尺寸
 *
 * @param view - 视图类型
 * @returns 窗口尺寸配置 { width, height }
 *
 * @example
 * ```typescript
 * const size = getWindowSizeForView('consultation');
 * // => { width: 1120, height: 760 }
 * ```
 */
export function getReceptionCapsuleSize(options?: Pick<WindowSizeOptions, 'expanded' | 'riskCount' | 'hasChronicRefill' | 'hasFollowUp' | 'hasReportInterpretation' | 'chronicScopeSelecting'>): WindowSize {
  const expanded = options?.expanded ?? false;
  const hasReportAction = Boolean(options?.hasFollowUp || options?.hasReportInterpretation);
  const actionHeight = (Number(Boolean(options?.hasChronicRefill)) + Number(hasReportAction)) * 54;
  const chronicScopeHeight = options?.chronicScopeSelecting ? 154 : 0;
  if (!expanded) {
    return {
      width: options?.chronicScopeSelecting ? 320 : WINDOW_SIZES.RISK_CARD.width,
      height: WINDOW_SIZES.RISK_CARD.height + actionHeight + chronicScopeHeight,
    };
  }

  const riskCount = Math.max(options?.riskCount ?? 0, 1);
  const visibleRiskRows = Math.min(riskCount, 6);
  const estimatedHeight = 108 + visibleRiskRows * 52 + actionHeight + chronicScopeHeight;

  return {
    width: options?.chronicScopeSelecting ? 320 : WINDOW_SIZES.RISK_CARD.width,
    height: Math.min(
      Math.max(estimatedHeight, WINDOW_SIZES.RISK_CARD_EXPANDED.height),
      options?.chronicScopeSelecting ? 620 : 520,
    ),
  };
}

export function getVoiceInteractionWindowSize(stage: VoiceInteractionWindowStage = 'recording'): WindowSize {
  switch (stage) {
    case 'processing':
      return WINDOW_SIZES.CAPSULE_PROCESSING;
    case 'stopped':
      return WINDOW_SIZES.CAPSULE_STOPPED;
    case 'expanded':
      return WINDOW_SIZES.CAPSULE_EXPANDED;
    case 'recording':
    default:
      return WINDOW_SIZES.CAPSULE;
  }
}

export function getWindowSizeForView(view: ViewType, options?: WindowSizeOptions): WindowSize {
  switch (view) {
    case 'consultation':
      return WINDOW_SIZES.CONSULTATION;

    case 'voice-interaction':
      return getVoiceInteractionWindowSize(options?.voiceStage);

    case 'reception-capsule':
      return getReceptionCapsuleSize(options);

    case 'voice-consultation':
      return WINDOW_SIZES.VOICE_CONSULTATION;

    case 'treatment-plan':
      return WINDOW_SIZES.TREATMENT_PLAN;

    case 'outpatient-follow-up':
      return WINDOW_SIZES.OUTPATIENT_FOLLOW_UP;

    case 'report-interpretation':
      return WINDOW_SIZES.REPORT_INTERPRETATION;

    case 'patient-memory':
      return WINDOW_SIZES.PATIENT_MEMORY;

    case 'inpatient-emr':
      return WINDOW_SIZES.INPATIENT_EMR;

    case 'outpatient-emr':
      return WINDOW_SIZES.OUTPATIENT_EMR;

    case 'public-health':
      return WINDOW_SIZES.PUBLIC_HEALTH;

    case 'differential-diagnosis':
      return WINDOW_SIZES.DIFFERENTIAL_DIAGNOSIS;

    case 'his-log':
      return WINDOW_SIZES.HIS_LOG;

    case 'medical-cache':
      return WINDOW_SIZES.MEDICAL_CACHE;

    case 'chat':
      return WINDOW_SIZES.CHAT;
      
    case 'settings':
    case 'risk-alert':
    case 'knowledge-base':
    default:
      return WINDOW_SIZES.WORK;
  }
}

export function supportsPersistentWindowSize(view: ViewType): boolean {
  return view === 'chat'
    || view === 'settings'
    || view === 'consultation'
    || view === 'voice-consultation'
    || view === 'treatment-plan'
    || view === 'outpatient-follow-up'
    || view === 'report-interpretation'
    || view === 'inpatient-emr'
    || view === 'public-health'
    || view === 'outpatient-emr'
    || view === 'differential-diagnosis'
    || view === 'his-log'
    || view === 'medical-cache'
    || view === 'knowledge-base';
}

/**
 * 判断视图是否为胶囊形态
 *
 * @param view - 视图类型
 * @returns 是否为胶囊形态
 */
export function isCapsuleView(view: ViewType): boolean {
  return view === 'voice-interaction' || view === 'reception-capsule';
}

/**
 * 判断视图是否为大面板（需要更多屏幕空间）
 *
 * @param view - 视图类型
 * @returns 是否为大面板
 */
export function isLargePanelView(view: ViewType): boolean {
  return view === 'consultation'
    || view === 'his-log'
    || view === 'medical-cache'
    || view === 'voice-consultation'
    || view === 'treatment-plan'
    || view === 'outpatient-follow-up'
    || view === 'report-interpretation'
    || view === 'inpatient-emr'
    || view === 'public-health'
    || view === 'outpatient-emr';
}
