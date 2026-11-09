// @vitest-environment jsdom
// 引入 @features/clinical-result barrel 会连带加载 services/regional → updatePolicy 顶层 localStorage，
// 与 useClinicalRecordFactConfirmation.test 等既有用例一致，本文件使用 jsdom 环境。
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import type { ExecDeptOption } from '@/utils/medicalDictionaryHelpers';
import { useTreatmentPlanWriteback } from './useTreatmentPlanWriteback';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));
vi.mock('@/services/his', () => ({ getHisAdapter: () => undefined }));
vi.mock('@/services/recommendationPreferenceTracker', () => ({
  trackFinalRecommendationPreferences: vi.fn(),
}));

const diagnosis = {
  id: 'DIA-STD-1',
  name: '上呼吸道感染',
  code: 'J06.900',
  rate: '高',
  rationale: '符合当前症状',
} satisfies Diagnosis;

// 合成检验项目：目录带真实互认编码，普通提交不得透传
const labItem = {
  type: 'lab_test',
  name: '血常规',
  reason: '辅助判断感染',
  selected: true,
  execDept: 'DEPT-1',
  insuranceType: '1',
  matchedItem: {
    id: 'LAB-1',
    idCli: 'LAB-1',
    name: '血常规',
    sdSrv: '41',
    jsonField: '{"idLisCategory":"CAT-1"}',
    mutualRecognitionCode: 'MUTUAL-1',
  },
} satisfies TreatmentRecommendation;

const patient = { visitId: 'visit-1', patientName: '测试患者' } as unknown as AppPatient;

function createWriteback(notify = vi.fn()) {
  const writeback = useTreatmentPlanWriteback({
    patient: ref(patient),
    diagnosis: ref(diagnosis),
    treatments: ref([labItem]),
    recordContext: ref({
      chiefComplaint: '发热1天',
      historyOfPresentIllness: '患者发热1天。',
      pastMedicalHistory: '既往体健。',
      allergyHistory: '',
      diagnosisText: '上呼吸道感染',
      followUpEvidence: '',
      isFollowUp: false,
    }),
    execDeptOptions: ref([] as ExecDeptOption[]),
    normalizeTreatment: (rec) => rec as TreatmentRecommendation,
    findFrequencyOptionByValue: () => undefined,
    findRouteOptionByValue: () => undefined,
    getDefaultPharmacyOption: () => undefined,
    findMatchedPharmacyOption: () => undefined,
    ensureMedicineSelectable: async () => true,
    checkMedicineInventoryEnough: async () => true,
    hydrateMedicalItemDetail: async () => undefined,
    hasRequiredPharmacy: () => true,
    hasRequiredExecDept: () => true,
    hasRequiredBodySite: () => true,
    notify,
  });
  return { writeback, notify };
}

describe('useTreatmentPlanWriteback pending identity semantics', () => {
  it('submits selected exam/lab orders once without a recognition code', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const { writeback } = createWriteback();

    const submitted = await writeback.submit();


    expect(submitted).toBe(true);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    const result = invokeMock.mock.calls[0][1].result as Record<string, any>;
    // 白云已移除互认决策流程：orderList 不透传目录真实互认编码
    expect(result.orderList[0].mutualRecognitionCode).toBe('');
    expect(writeback.writebackStatus.waitingWritebackFeedback.value).toBe(true);
    expect(writeback.writebackStatus.pendingWritebackRequestId.value).toBe(result.requestId);
  });

  it('blocks resubmit while waiting after a pending feedback (handler-level guard)', async () => {
    // 独立治疗方案 pending 等待期不得发出新请求，引出重复开立
    invokeMock.mockResolvedValue(undefined);
    const { writeback, notify } = createWriteback();

    await writeback.submit();
    const requestId = writeback.writebackStatus.pendingWritebackRequestId.value;
    writeback.writebackStatus.applyWritebackFeedback({ requestId, status: 'pending' });

    const second = await writeback.submit();

    expect(second).toBe(false);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(writeback.writebackStatus.pendingWritebackRequestId.value).toBe(requestId);
    expect(writeback.writebackStatus.waitingWritebackFeedback.value).toBe(true);
    expect(writeback.writebackStatus.isWritebackBusy.value).toBe(true);
    expect(notify).toHaveBeenCalledWith('HIS 正在处理本次回写，请等待结果回执。', 'info');
  });

  it('accepts a late real success for the same requestId after pending and allows a fresh submit', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { writeback } = createWriteback();

    await writeback.submit();
    const firstRequestId = writeback.writebackStatus.pendingWritebackRequestId.value;
    writeback.writebackStatus.applyWritebackFeedback({ requestId: firstRequestId, status: 'pending' });
    writeback.writebackStatus.applyWritebackFeedback({ requestId: firstRequestId, status: 'success' });

    expect(writeback.writebackStatus.waitingWritebackFeedback.value).toBe(false);
    expect(writeback.writebackStatus.pendingWritebackRequestId.value).toBe('');

    // requestId 取 Date.now()，跨毫秒保证新请求 ID 不同
    await new Promise((resolve) => setTimeout(resolve, 3));
    await writeback.submit();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    const secondRequestId = writeback.writebackStatus.pendingWritebackRequestId.value;
    expect(secondRequestId).not.toBe(firstRequestId);

    // 旧请求迟到的终态不得覆盖新请求
    writeback.writebackStatus.applyWritebackFeedback({ requestId: firstRequestId, status: 'failed' });
    expect(writeback.writebackStatus.waitingWritebackFeedback.value).toBe(true);
    expect(writeback.writebackStatus.pendingWritebackRequestId.value).toBe(secondRequestId);
  });

  it('accepts a late real failed for the same requestId after pending without faking success', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { writeback } = createWriteback();

    await writeback.submit();
    const requestId = writeback.writebackStatus.pendingWritebackRequestId.value;
    writeback.writebackStatus.applyWritebackFeedback({ requestId, status: 'pending' });
    writeback.writebackStatus.applyWritebackFeedback({ requestId, status: 'failed', message: 'HIS 保存失败' });

    expect(writeback.writebackStatus.waitingWritebackFeedback.value).toBe(false);
    expect(writeback.writebackStatus.writebackBannerTone.value).toBe('error');
    expect(writeback.writebackStatus.writebackBannerText.value).toBe('HIS 保存失败');
  });
});
