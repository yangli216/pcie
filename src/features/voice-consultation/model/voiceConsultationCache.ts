import type { AppPatient } from '@/types/appState';
import { getPatientContextAnchorId } from '@/utils/patientContext';
import type { VoiceIntentResult } from './useVoiceIntentRecognition';

export interface VoiceConsultationCacheEntry {
  consultationId: string;
  transcribedText: string;
  intentResult: VoiceIntentResult;
  /**
   * 用户在编辑器中产生的最新快照。包含 fetchAITreatment 之后落到 treatments 上的
   * 标准化条目、医生手工编辑过的病历文本、当前选中的诊断等。恢复时会在 LLM
   * intentResult 应用之后再叠加此快照，以避免重新调用 fetchAITreatment。
   */
  editorSnapshot?: VoiceEditorSnapshot;
  savedAt: number;
}

/**
 * 语音问诊编辑器快照。所有字段都是 optional，便于增量更新。
 *
 * 这里只关心整张语音病历恢复时需要的字段。结构选择 unknown[] 而不是引入
 * `TreatmentRecommendation`、`Diagnosis` 类型，是为了避免 composable 反向依赖
 * 组件或更上层模块；恢复端在使用前会做 narrowing。
 */
export interface VoiceEditorSnapshot {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  pastMedicalHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  familyHistory?: string;
  physicalExam?: string;
  precautions?: string;
  /** 病历 AI 阅读提示。 */
  factSuggestions?: unknown[];
  /** 医生纳入的待鉴别方向及显式转为正式诊断的状态。 */
  differentialDiagnosisDirection?: unknown;
  /** 医生本次选择的部分回写范围。 */
  writebackScope?: unknown;
  /** TreatmentRecommendation[] 形态 */
  treatments?: unknown[];
  /** Diagnosis[] 形态 */
  diagnoses?: unknown[];
  /** 当前选中的诊断身份键（用于跳过 fetchAITreatment） */
  selectedDiagnosisIdentity?: string | null;
  /** 当前已纳入的全部正式诊断身份键。 */
  selectedDiagnosisIdentities?: string[];
  /** 上一次 fetchAITreatment 完成时对应的诊断键 */
  treatmentDiagnosisKey?: string;
  /** 快照写入时间，用于将来扩展更细粒度的失效策略 */
  updatedAt?: number;
}

// V3 起历史/风险共病退出诊断建议，并保留症状性工作诊断角色。不恢复 V1/V2，避免旧快照重新带回。
const VOICE_CONSULTATION_CACHE_PREFIX = 'VOICE_CONSULTATION_CACHE_V3';

export function resolveVoiceConsultationId(patient: AppPatient | null | undefined): string {
  return getPatientContextAnchorId(patient) || 'unknown';
}

export function getVoiceConsultationCacheKey(consultationId: string): string {
  return `${VOICE_CONSULTATION_CACHE_PREFIX}:${consultationId}`;
}

function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate();
}

export function loadVoiceConsultationCacheEntry(consultationId: string): VoiceConsultationCacheEntry | null {
  try {
    const raw = localStorage.getItem(getVoiceConsultationCacheKey(consultationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceConsultationCacheEntry;
    if (!parsed?.intentResult || !parsed.transcribedText) return null;
    if (typeof parsed.savedAt === 'number' && !isSameLocalDay(parsed.savedAt, Date.now())) {
      // 跨自然日失效，主动清除
      try {
        localStorage.removeItem(getVoiceConsultationCacheKey(consultationId));
      } catch (cleanupErr) {
        console.warn('[VoiceConsultation] Failed to evict expired cache:', consultationId, cleanupErr);
      }
      console.log('[VoiceConsultation] Cache expired (cross-day), evicted', { consultationId });
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('[VoiceConsultation] Failed to read cache:', consultationId, error);
    return null;
  }
}

export function persistVoiceConsultationCacheEntry(entry: VoiceConsultationCacheEntry): void {
  try {
    localStorage.setItem(
      getVoiceConsultationCacheKey(entry.consultationId),
      JSON.stringify(entry),
    );
  } catch (error) {
    console.warn('[VoiceConsultation] Failed to persist cache:', entry.consultationId, error);
  }
}

export function clearVoiceConsultationCacheById(consultationId?: string): void {
  if (!consultationId) {
    return;
  }

  try {
    localStorage.removeItem(getVoiceConsultationCacheKey(consultationId));
    console.log('[VoiceConsultation] Cache cleared', { consultationId });
  } catch (error) {
    console.warn('[VoiceConsultation] Failed to clear cache:', consultationId, error);
  }
}

export function clearVoiceConsultationCache(patient?: AppPatient | null): void {
  const consultationId = resolveVoiceConsultationId(patient);
  if (!consultationId || consultationId === 'unknown') {
    return;
  }

  clearVoiceConsultationCacheById(consultationId);
}

export function hasVoiceConsultationCache(patient?: AppPatient | null): boolean {
  const consultationId = resolveVoiceConsultationId(patient);
  if (!consultationId || consultationId === 'unknown') {
    return false;
  }

  // 通过 loadVoiceConsultationCacheEntry 读取（其内部包含跨自然日失效检查与清理）
  return loadVoiceConsultationCacheEntry(consultationId) !== null;
}

/**
 * 将编辑器最新的语音病历快照写回缓存。
 *
 * 同一就诊在恢复后，编辑/补全的诊疗方案、诊断、病历文本会通过这里增量写回，
 * 下次再次恢复时就能跳过 LLM 治疗推荐流程，整张病历从缓存直接恢复。
 *
 * @param patient 当前患者
 * @param snapshot 增量快照（合并到 editorSnapshot 上）
 */
export function updateVoiceConsultationCache(
  patient: AppPatient | null | undefined,
  snapshot: VoiceEditorSnapshot,
): void {
  const consultationId = resolveVoiceConsultationId(patient);
  if (!consultationId || consultationId === 'unknown') {
    return;
  }
  const existing = loadVoiceConsultationCacheEntry(consultationId);
  if (!existing) {
    // 还没有 base entry（比如纯打开未经历过 LLM）就不主动建；恢复链路本身依赖原始 LLM 结果
    return;
  }
  const merged: VoiceConsultationCacheEntry = {
    ...existing,
    editorSnapshot: {
      ...(existing.editorSnapshot || {}),
      ...snapshot,
      updatedAt: Date.now(),
    },
    savedAt: Date.now(),
  };
  persistVoiceConsultationCacheEntry(merged);
}

/**
 * 读取语音问诊编辑器快照（已经过跨自然日失效检查）。
 */
export function getVoiceConsultationEditorSnapshot(
  patient: AppPatient | null | undefined,
): VoiceEditorSnapshot | null {
  const consultationId = resolveVoiceConsultationId(patient);
  if (!consultationId || consultationId === 'unknown') return null;
  const entry = loadVoiceConsultationCacheEntry(consultationId);
  return entry?.editorSnapshot ?? null;
}
