/**
 * 语音问诊业务逻辑 Composable
 *
 * 管理语音问诊的完整流程，包括：
 * - 语音识别处理
 * - 意图识别与结构化提取
 * - 结果确认与提交
 * - 错误处理
 *
 * @module composables/useVoiceConsultation
 */

import { nextTick, ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { trackClick, trackError, trackRecommendationAction } from '@services/operationTracker';
import type { AppPatient } from '@/types/appState';
import type { PatientMemoryBrief } from '@entities/patient-memory';
import { buildPatientMemoryPromptContext } from '@features/patient-memory/lib/patientMemoryPromptContext';
import {
  clearVoiceConsultationCacheById,
  hasVoiceConsultationCache,
  loadVoiceConsultationCacheEntry,
  persistVoiceConsultationCacheEntry,
  resolveVoiceConsultationId,
  useVoiceIntentRecognition,
  voiceTimingTracker,
  type VoiceConsultationCacheEntry,
} from '@features/voice-consultation';
import {
  cloneClinicalResultInput,
  formatPhysicalExamVitalTemplate,
  isFemaleHistoryEligible,
  type ClinicalResultInput,
} from '@features/clinical-result';
import { submitConsultationUserLog } from '@services/consultationUserLog';
import {
  getPatientContextAllergyHistory,
  getPatientContextAgeText,
  getPatientContextCurrentMedicationHistory,
  getPatientContextFamilyHistory,
  getPatientContextGenderText,
  getPatientContextMenstrualHistory,
  getPatientContextMaritalReproductiveHistory,
  getPatientContextPastMedicalHistory,
  getPatientContextPersonalHistory,
} from '@/utils/patientContext';
import { formatUserFacingError } from '@shared/lib/errorMessages';
import { useGeneratedClinicalResultSession } from '@features/consultation-result/model/useGeneratedClinicalResultSession';

export {
  clearVoiceConsultationCache,
  getVoiceConsultationEditorSnapshot,
  hasVoiceConsultationCache,
  updateVoiceConsultationCache,
} from '@features/voice-consultation';
export type { VoiceEditorSnapshot } from '@features/voice-consultation';

/**
 * 语音问诊配置参数
 */
export interface VoiceConsultationOptions {
  /** 当前患者信息 */
  currentPatient: Ref<AppPatient | null>;
  /** 服务端纵向患者记忆；只作为本次问诊核对线索。 */
  patientMemoryBrief?: Ref<PatientMemoryBrief | null>;
  /** Toast 提示函数 */
  showToast: (msg: string, type?: 'success' | 'error' | 'info', duration?: number) => void;
  /** 打开共享语音结果页 */
  openVoiceConsultation: () => Promise<void>;
  /** 工作模式 API */
  workMode: {
    exitWork: (sessionStatus?: 'completed' | 'cancelled' | 'error') => Promise<void>;
  };
}

function getCurrentPatientVitalSource(patient: AppPatient | null): string {
  const vitalSigns = patient?.currentVitalSigns || patient?.clinical?.currentVitalSigns;
  if (!vitalSigns) return '';
  return formatPhysicalExamVitalTemplate({
    ...(typeof vitalSigns.temperature === 'number' ? { temperature: String(vitalSigns.temperature) } : {}),
    ...(typeof vitalSigns.pulseRate === 'number'
      ? { pulse: String(vitalSigns.pulseRate) }
      : typeof vitalSigns.heartRate === 'number'
        ? { pulse: String(vitalSigns.heartRate) }
        : {}),
    ...(typeof vitalSigns.respiratoryRate === 'number'
      ? { respiration: String(vitalSigns.respiratoryRate) }
      : {}),
    ...(typeof vitalSigns.systolicBloodPressure === 'number'
      ? { systolicBloodPressure: String(vitalSigns.systolicBloodPressure) }
      : {}),
    ...(typeof vitalSigns.diastolicBloodPressure === 'number'
      ? { diastolicBloodPressure: String(vitalSigns.diastolicBloodPressure) }
      : {}),
  });
}

/**
 * 语音问诊业务逻辑 Composable
 *
 * @param options - 配置参数
 * @returns 语音问诊 API
 *
 * @example
 * ```typescript
 * const voiceConsultation = useVoiceConsultation({
 *   currentPatient,
 *   showToast,
 *   openVoiceConsultation,
 *   workMode,
 * });
 *
 * // 处理语音停止事件
 * await voiceConsultation.handleVoiceStop(audioBlob, transcribedText);
 *
 * // 确认并提交病历
 * await voiceConsultation.handleResultConfirm(record);
 * ```
 */
export function useVoiceConsultation(options: VoiceConsultationOptions) {
  const {
    currentPatient,
    showToast,
    openVoiceConsultation,
    workMode,
  } = options;

  const { exitWork } = workMode;

  const intentRecognition = useVoiceIntentRecognition();
  const intentResult = ref<ClinicalResultInput | null>(null);
  /**
   * 当前 intentResult 的来源。
   * - 'llm'：本次刚刚由 LLM 解析的全新结果，不应叠加 editorSnapshot
   *   （快照属于上一次会话编辑痕迹，否则会污染新会话的诊断/治疗对应关系）
   * - 'cache'：从同就诊缓存恢复，需要叠加 editorSnapshot 还原医生编辑现场
   */
  const intentSource = ref<'llm' | 'cache' | null>(null);
  const isProcessingVoice = ref(false);
  let processingToken = 0;
  let invalidateGeneratedClinicalResultSession: () => void = () => undefined;

  /**
   * 当前语音问诊轮次 ID。
   * 每次开始新一轮语音问诊（handleVoiceStop）时生成新 UUID，
   * 贯穿该轮所有用户日志提交（speech → firstSnapshot → finalSnapshot/abandoned）。
   * cancelVoiceResult / resetVoiceSessionState 时清空。
   */
  const consultationRoundId = ref<string | null>(null);

  function currentConsultationId(): string {
    return resolveVoiceConsultationId(currentPatient.value);
  }

  function withConsultationId(extra?: Record<string, unknown>): Record<string, unknown> {
    return { consultationId: currentConsultationId(), ...extra };
  }

  function readCache(consultationId: string): VoiceConsultationCacheEntry | null {
    return loadVoiceConsultationCacheEntry(consultationId);
  }

  function writeCache(entry: VoiceConsultationCacheEntry): void {
    persistVoiceConsultationCacheEntry(entry);
    console.log('[VoiceConsultation] Cache persisted', {
      consultationId: entry.consultationId,
      savedAt: entry.savedAt,
      transcriptionLength: entry.transcribedText.length,
    });
  }

  function clearCache(consultationId?: string): void {
    if (!consultationId) {
      return;
    }
    clearVoiceConsultationCacheById(consultationId);
  }

  function createStreamingClinicalResult(message = '正在整理语音病历'): ClinicalResultInput {
    return {
      chiefComplaint: '',
      historyOfPresentIllness: '',
      pastMedicalHistory: '',
      allergyHistory: '',
      currentMedicationHistory: '',
      familyHistory: '',
      symptoms: [],
      negativeSymptoms: [],
      diagnoses: [],
      treatments: [],
      treatmentPlan: '',
      healthEducation: '',
      recommendationPolicy: {
        autoFetchTreatments: false,
        allowTreatmentRefresh: false,
        allowedTreatmentTypes: [],
      },
      generation: {
        status: 'streaming',
        readySections: [],
        message,
      },
    };
  }

  async function openStreamingClinicalResult(): Promise<void> {
    invalidateGeneratedClinicalResultSession();
    intentSource.value = 'llm';
    intentResult.value = createStreamingClinicalResult();
    try {
      await openVoiceConsultation();
    } catch (error) {
      console.error('[VoiceConsultation] Failed to open streaming result page:', error);
    }
  }

  async function showClinicalResult(result: ClinicalResultInput, source: 'llm' | 'cache'): Promise<void> {
    invalidateGeneratedClinicalResultSession();
    intentSource.value = source;
    intentResult.value = cloneClinicalResultInput(result);

    try {
      await openVoiceConsultation();
    } catch (e) {
      console.error('[VoiceConsultation] Failed to enter preferred voice-consultation size:', e);
    }

    console.log('[VoiceConsultation] Intent result applied', { source });
  }

  async function showGeneratedClinicalResult(result: ClinicalResultInput): Promise<void> {
    const sessionId = await generatedClinicalResultSession.begin({
      channel: result.channel || 'voice',
      stage: 'finalizing-result',
      message: '正在整理结果',
    });
    generatedClinicalResultSession.complete(sessionId, result);
  }

  // ========== 语音处理 ==========

  /**
   * 处理语音停止事件
   *
   * 流程：
   * 1. 调用意图识别处理转写文本
   * 2. 保存意图识别结果
   * 3. 切换到语音问诊视图并调整窗口大小
   *
   * @param audioBlob - 录音音频数据（当前未使用）
   * @param transcribedText - 转写后的文本
   */
  /**
   * 写入取消/错误结果到后端，使 SDK 轮询能检测到终止信号
   */
  async function writeCancelledResult(reason: string): Promise<void> {
    try {
      await invoke('complete_consultation', {
        result: {
          consultationId: resolveVoiceConsultationId(currentPatient.value),
          timestamp: Date.now(),
          resultType: 'cancelled',
          requestId: `voice-cancelled-${Date.now()}`,
          reason,
        },
      });
      console.log('[VoiceConsultation] Cancelled result written to backend:', reason);
    } catch (e) {
      console.error('[VoiceConsultation] Failed to write cancelled result:', e);
    }
  }

  function resetVoiceSessionState(): void {
    invalidateGeneratedClinicalResultSession();
    processingToken += 1;
    isProcessingVoice.value = false;
    intentResult.value = null;
    intentSource.value = null;
    intentRecognition.clearTranscripts();
    consultationRoundId.value = null;
  }

  const generatedClinicalResultSession = useGeneratedClinicalResultSession({
    intentResult,
    intentSource,
    consultationRoundId,
    resetCurrentSession: resetVoiceSessionState,
    openResultView: openVoiceConsultation,
    cloneResult: cloneClinicalResultInput,
    onOpenError: (error) => {
      console.error('[VoiceConsultation] Failed to open generated result page:', error);
      showToast('无法打开结果页面，请稍后重试', 'error');
    },
  });
  invalidateGeneratedClinicalResultSession = generatedClinicalResultSession.invalidate;

  async function resumeCachedVoiceResult(): Promise<boolean> {
    const consultationId = resolveVoiceConsultationId(currentPatient.value);
    const cached = readCache(consultationId);

    if (!cached) {
      console.log('[VoiceConsultation] No cached voice result found', { consultationId });
      return false;
    }

    await showClinicalResult(cached.intentResult, 'cache');
    showToast('已恢复上次未提交的语音病例解析结果', 'info');
    console.log('[VoiceConsultation] Restored cached voice result', {
      consultationId,
      savedAt: cached.savedAt,
    });
    return true;
  }

  async function handleVoiceStop(audioBlob: Blob, transcribedText: string): Promise<void> {
    console.log('[VoiceConsultation] handleVoiceStop received blob:', audioBlob?.size, 'bytes');
    console.log('[VoiceConsultation] Transcribed text:', transcribedText);

    if (!transcribedText?.trim()) {
      showToast('未识别到有效语音内容', 'error');
      return;
    }

    const currentToken = processingToken + 1;
    processingToken = currentToken;
    let timing: ReturnType<typeof voiceTimingTracker.start> | undefined;
    try {
      const normalizedText = transcribedText.trim();
      const consultationId = resolveVoiceConsultationId(currentPatient.value);
      consultationRoundId.value = crypto.randomUUID();
      const roundId = consultationRoundId.value;
      timing = voiceTimingTracker.start(roundId);
      void submitConsultationUserLog({
        consultationId,
        consultationRoundId: roundId,
        consultationType: 'voice',
        patient: currentPatient.value,
        speech: {
          text: normalizedText,
          audioBlob,
          mimeType: audioBlob?.type || 'audio/wav',
        },
      });
      const cached = readCache(consultationId);
      if (cached?.transcribedText === normalizedText) {
        console.log('[VoiceConsultation] Cache hit, skip LLM parsing', {
          consultationId,
          transcriptionLength: normalizedText.length,
        });
        isProcessingVoice.value = false;
        await showClinicalResult(cached.intentResult, 'cache');
        timing.finish('cached');
        return;
      }

      // 先进入共享结果页并展示分区骨架，后续 M1 流式事件逐块填充，避免医生停留在整页 loading。
      await openStreamingClinicalResult();
      // 必须等 voice-interaction 组件完成卸载后再切 processing。
      // 否则 VoiceCapsule 的 processing watcher 会补发一次胶囊 resize transition，
      // 与结果页导航竞争并把视图切回录音完成页。
      await nextTick();
      if (currentToken !== processingToken) return;
      isProcessingVoice.value = true;

      timing.mark('window_and_skeleton_ready');
      intentRecognition.clearTranscripts();
      intentRecognition.addTranscript(transcribedText);
      const patient = currentPatient.value;
      const patientAllergyHistory = getPatientContextAllergyHistory(patient) || '';
      const patientPastMedicalHistory = getPatientContextPastMedicalHistory(patient) || '';
      const patientMedicationHistory = getPatientContextCurrentMedicationHistory(patient) || '';
      const includeFemaleHistory = isFemaleHistoryEligible({
        gender: getPatientContextGenderText(patient),
        ageText: getPatientContextAgeText(patient),
        ageYears: patient?.ageYears ?? patient?.demographics?.ageYears,
      });
      const result = await intentRecognition.processTranscript(transcribedText, {
        consultationId,
        timing,
        memoryContext: buildPatientMemoryPromptContext(options.patientMemoryBrief?.value, {
          knownAllergyText: patientAllergyHistory,
          knownConditionText: patientPastMedicalHistory,
          knownMedicationText: patientMedicationHistory,
        }),
        patientContext: {
          pastMedicalHistory: patientPastMedicalHistory || null,
          allergyHistory: patientAllergyHistory || null,
          currentMedicationHistory: patientMedicationHistory || null,
          personalHistory: getPatientContextPersonalHistory(patient) || null,
          menstrualHistory: includeFemaleHistory ? getPatientContextMenstrualHistory(patient) || null : null,
          maritalReproductiveHistory: includeFemaleHistory
            ? getPatientContextMaritalReproductiveHistory(patient) || null
            : null,
          familyHistory: getPatientContextFamilyHistory(patient) || null,
          gender: getPatientContextGenderText(patient) || null,
          ageText: getPatientContextAgeText(patient) || null,
          vitals: getCurrentPatientVitalSource(patient) || null,
        },
        onProgress: ({ result: partialResult }) => {
          if (currentToken !== processingToken) return;
          intentSource.value = 'llm';
          intentResult.value = cloneClinicalResultInput(partialResult);
        },
      });

      if (currentToken !== processingToken) {
        return;
      }

      if (!result) {
        timing.finish('failed');
        isProcessingVoice.value = false;
        const errMsg = intentRecognition.processingError.value || '意图识别失败';
        showToast(errMsg, 'error');
        await writeCancelledResult(errMsg);
        setTimeout(() => {
          if (currentToken === processingToken) {
            exitWork('error');
          }
        }, 2000);
        return;
      }

      isProcessingVoice.value = false;
      writeCache({
        consultationId,
        transcribedText: normalizedText,
        intentResult: result,
        savedAt: Date.now(),
      });
      intentSource.value = 'llm';
      intentResult.value = cloneClinicalResultInput(result);

      console.log('[VoiceConsultation] Intent recognition completed successfully');
    } catch (err: unknown) {
      if (currentToken !== processingToken) {
        return;
      }

      timing?.finish('failed');
      isProcessingVoice.value = false;
      console.error('[VoiceConsultation] Processing failed:', err);
      trackError('voice_processing_failed', err, withConsultationId());
      const errMessage = formatUserFacingError(err, { fallback: '语音处理失败，请稍后重试。' });
      showToast(`处理失败: ${errMessage}`, 'error');
      await writeCancelledResult(`处理失败: ${errMessage}`);
      setTimeout(() => {
        if (currentToken === processingToken) {
          exitWork('error');
        }
      }, 2000);
    }
  }

  /**
   * 处理语音错误
   *
   * @param err - 错误信息
   */
  async function handleVoiceError(err: unknown): Promise<void> {
    resetVoiceSessionState();
    clearCache(resolveVoiceConsultationId(currentPatient.value));
    trackError('voice_recording_error', err, withConsultationId());
    const errMessage = formatUserFacingError(err, { fallback: '录音出错，请检查麦克风权限后重试。' });
    showToast(`录音出错: ${errMessage}`, 'error');
    await writeCancelledResult(`录音出错: ${errMessage}`);
    exitWork('error');
  }

  /**
   * 医生在音频审核态主动放弃本轮语音问诊。
   * 这里只负责业务状态与取消结果，返回患者胶囊由 App 的统一窗口出口编排。
   */
  async function abandonVoiceCapture(): Promise<void> {
    trackClick('voice_recording_abandon', withConsultationId());
    resetVoiceSessionState();
    clearCache(resolveVoiceConsultationId(currentPatient.value));
    await writeCancelledResult('用户主动放弃语音问诊采集');
  }

  // ========== 结果处理 ==========

  /**
   * 取消病历结果
   */
  async function cancelVoiceResult(): Promise<void> {
    trackClick('voice_result_cancel', withConsultationId());
    trackRecommendationAction('record', 'voice-record', 'rejected');
    resetVoiceSessionState();
    clearCache(resolveVoiceConsultationId(currentPatient.value));
    await writeCancelledResult('用户取消语音问诊结果');
    await exitWork('cancelled');
  }

  // ========== 导出 ==========

  return {
    intentResult,
    intentSource,
    isProcessingVoice,
    consultationRoundId,
    resetVoiceSessionState,
    beginGeneratedClinicalResult: generatedClinicalResultSession.begin,
    completeGeneratedClinicalResult: generatedClinicalResultSession.complete,
    failGeneratedClinicalResult: generatedClinicalResultSession.fail,
    updateGeneratedClinicalResultPartial: generatedClinicalResultSession.updatePartial,
    updateGeneratedClinicalResultProgress: generatedClinicalResultSession.updateProgress,
    showGeneratedClinicalResult,
    resumeCachedVoiceResult,
    hasCachedVoiceResult: (patient?: AppPatient | null) => hasVoiceConsultationCache(patient ?? currentPatient.value),
    handleVoiceStop,
    handleVoiceError,
    abandonVoiceCapture,
    cancelVoiceResult,
  };
}
