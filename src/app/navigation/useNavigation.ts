/**
 * 导航管理 Composable
 *
 * 统一管理应用的所有视图导航逻辑，包括：
 * - 基础导航（聊天、设置、分析等）
 * - 业务导航（问诊、语音、知识库等）
 * - 窗口尺寸自适应
 *
 * @module app/navigation/useNavigation
 */

import { type Ref } from 'vue';
import { getWindowSizeForView, type ViewType } from '@/constants/windowSizes';
import { trackViewChange } from '@/services/operationTracker';
import type { AppPatient } from '@/types/appState';
import type { useWindowTransitionCoordinator } from '@app/shell/useWindowTransitionCoordinator';

/**
 * 导航管理配置参数
 */
export interface NavigationOptions {
  /** 当前视图 */
  currentView: Ref<ViewType>;
  /** 是否处于工作模式 */
  isWorking: Ref<boolean>;
  /** 当前患者信息 */
  currentPatient: Ref<AppPatient | null>;
  /** 窗口内容与几何过渡协调器 */
  windowTransition: ReturnType<typeof useWindowTransitionCoordinator>;
  /** 工作模式 API */
  workMode: {
    enterWorkMode: (customW?: number, customH?: number) => Promise<void>;
  };
}

/**
 * 导航管理 Composable
 *
 * @param options - 配置参数
 * @returns 导航管理 API
 *
 * @example
 * ```typescript
 * const navigation = useNavigation({
 *   currentView,
 *   isWorking,
 *   currentPatient,
 *   windowTransition,
 *   workMode,
 * });
 *
 * // 导航到设置页
 * await navigation.openSettings();
 *
 * // 导航到问诊页
 * await navigation.openConsultation();
 * ```
 */
export function useNavigation(options: NavigationOptions) {
  const {
    currentView,
    isWorking,
    currentPatient,
    windowTransition,
    workMode,
  } = options;

  const { enterWorkMode } = workMode;

  async function openView(view: ViewType): Promise<void> {
    if (!isWorking.value) {
      currentView.value = view;
      await enterWorkMode();
      return;
    }

    await windowTransition.transitionToView(view);
  }

  // ========== 基础导航 ==========

  /**
   * 打开设置页
   */
  async function openSettings(): Promise<void> {
    trackViewChange(currentView.value, 'settings');
    await openView('settings');
  }

  /**
   * 打开聊天页
   */
  async function openChat(): Promise<void> {
    trackViewChange(currentView.value, 'chat');
    await openView('chat');
  }

  // ========== 业务导航 ==========

  /**
   * 打开 HIS 联调日志页
   */
  async function openHisIntegrationLog(): Promise<void> {
    trackViewChange(currentView.value, 'his-log');
    await openView('his-log');
  }


  /**
   * 打开基础数据缓存管理页
   */
  async function openMedicalCatalogCache(): Promise<void> {
    trackViewChange(currentView.value, 'medical-cache');
    await openView('medical-cache');
  }

  /**
   * 打开问诊页
   */
  async function openConsultation(): Promise<void> {
    trackViewChange(currentView.value, 'consultation', { hasPatient: !!currentPatient.value });
    await openView('consultation');
  }

  /**
   * 打开知识库页
   */
  async function openKnowledgeBase(): Promise<void> {
    trackViewChange(currentView.value, 'knowledge-base', {});
    await openView('knowledge-base');
  }

  /**
   * 打开语音问诊页
   */
  async function openVoiceConsultation(): Promise<void> {
    trackViewChange(currentView.value, 'voice-consultation', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('voice-consultation');
  }

  /**
   * 打开独立诊疗方案推荐页
   */
  async function openTreatmentPlan(): Promise<void> {
    trackViewChange(currentView.value, 'treatment-plan', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('treatment-plan');
  }

  async function openOutpatientFollowUp(): Promise<void> {
    trackViewChange(currentView.value, 'outpatient-follow-up', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('outpatient-follow-up');
  }

  async function openReportInterpretation(): Promise<void> {
    trackViewChange(currentView.value, 'report-interpretation', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('report-interpretation');
  }

  async function openPatientMemory(): Promise<void> {
    trackViewChange(currentView.value, 'patient-memory', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('patient-memory');
  }

  /**
   * 打开住院病历辅助生成页
   */
  async function openInpatientEmr(): Promise<void> {
    trackViewChange(currentView.value, 'inpatient-emr', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('inpatient-emr');
  }

  /**
   * 打开门诊病历模板分析页
   */
  async function openOutpatientEmr(): Promise<void> {
    trackViewChange(currentView.value, 'outpatient-emr', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('outpatient-emr');
  }

  async function openPublicHealth(): Promise<void> {
    trackViewChange(currentView.value, 'public-health');
    await openView('public-health');
  }

  async function openDifferentialDiagnosis(): Promise<void> {
    trackViewChange(currentView.value, 'differential-diagnosis', {
      patientId: currentPatient.value?.patientId,
    });
    await openView('differential-diagnosis');
  }

  /**
   * 开始语音交互
   */
  async function startVoiceInteraction(): Promise<void> {
    trackViewChange(currentView.value, 'voice-interaction', {
      patientId: currentPatient.value?.patientId,
    });
    const targetSize = getWindowSizeForView('voice-interaction');
    if (!isWorking.value) {
      currentView.value = 'voice-interaction';
      await enterWorkMode(targetSize.width, targetSize.height);
    } else {
      await windowTransition.transitionToView('voice-interaction', {
        size: targetSize,
        resizable: false,
        // 患者胶囊和录音胶囊都是连续小窗，避免整窗透明后 WebView 暂停帧回调。
        fade: currentView.value !== 'reception-capsule',
      });
    }
  }

  // ========== 导出 ==========

  return {
    // 基础导航
    openSettings,
    openChat,

    // 业务导航
    openHisIntegrationLog,
    openMedicalCatalogCache,
    openConsultation,
    openVoiceConsultation,
    openTreatmentPlan,
    openOutpatientFollowUp,
    openReportInterpretation,
    openPatientMemory,
    openInpatientEmr,
    openOutpatientEmr,
    openPublicHealth,
    openDifferentialDiagnosis,
    openKnowledgeBase,
    startVoiceInteraction,
  };
}
