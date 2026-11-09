import { describe, expect, it, vi } from 'vitest';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import { useSymptomConsultationFinalWriteback } from './useSymptomConsultationFinalWriteback';

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const diagnosis = {
  name: '上呼吸道感染',
  code: 'J06.900',
  rate: '高',
  rationale: '符合当前症状',
} satisfies Diagnosis;

const labItem = {
  type: 'lab_test',
  name: '血常规',
  reason: '辅助判断感染',
  selected: true,
  matchedItem: {
    id: 'LAB-1',
    name: '血常规',
    sdSrv: '41',
    mutualRecognitionCode: 'MUTUAL-1',
  },
} satisfies TreatmentRecommendation;

function createController(onSuccess = vi.fn()) {
  return useSymptomConsultationFinalWriteback({
    resolveConsultationId: () => 'visit-1',
    canSubmit: () => true,
    getSelectedDiagnosis: () => diagnosis,
    getPatientTetId: () => 'tenant-1',
    getRecord: () => ({ chiefComplaint: '发热1天', historyOfPresentIllness: '患者发热1天。' }),
    getPastMedicalHistory: () => '既往体健。',
    runPreflight: async () => ({ ready: true, selected: [labItem] }),
    orderItemResolvers: {
      getServiceCode: (item) => item.matchedItem?.sdSrv || '',
      getServiceId: (item) => item.matchedItem?.id || '',
      getServiceName: (item) => item.name,
      getExecDeptId: () => 'DEPT-1',
      getPartId: () => '',
      getJsonField: () => '{}',
    },
    notify: vi.fn(),
    formatError: () => '发送失败',
    onSuccess,
  });
}

describe('useSymptomConsultationFinalWriteback', () => {
  it('registers the request before dispatch and submits exam/lab orders without a recognition code', async () => {
    let resolveInvoke!: () => void;
    invokeMock.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveInvoke = resolve; }));
    const controller = createController();

    const submitPromise = controller.submit();
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce());
    const result = invokeMock.mock.calls[0][1].result as Record<string, any>;

    expect(controller.pendingRequestId.value).toBe(result.requestId);
    // 白云已移除互认决策流程：orderList 不透传目录真实互认编码
    expect(result.orderList[0].mutualRecognitionCode).toBe('');

    resolveInvoke();
    await submitPromise;
  });

  it('keeps waiting on a pending feedback without finalizing (no decision dialog anymore)', async () => {
    // 白云已移除互认决策：宿主历史 pending 是中间态，保持 busy/requestId 关联等待真实终态
    invokeMock.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    const controller = createController(onSuccess);
    await controller.submit();
    const requestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({
      requestId,
      status: 'pending',
    } as never);

    expect(controller.busy.value).toBe(true);
    expect(controller.pendingRequestId.value).toBe(requestId);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('blocks resubmit while waiting after a pending feedback (handler-level guard, C8)', async () => {
    // 症状路径 pending 后不得再次 submit 得到新 requestId，引出重复开立
    invokeMock.mockResolvedValue(undefined);
    const controller = createController();
    await controller.submit();
    const requestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({ requestId, status: 'pending' } as never);
    await controller.submit();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(controller.pendingRequestId.value).toBe(requestId);
  });

  it('accepts a late real success for the same requestId after pending and finalizes exactly once (C8)', async () => {
    invokeMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const controller = createController(onSuccess);
    await controller.submit();
    const requestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({ requestId, status: 'pending' } as never);
    controller.finalizeFeedback({ requestId, status: 'success' });
    expect(controller.busy.value).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith('visit-1');

    // 相同终态重复不重复收尾
    controller.finalizeFeedback({ requestId, status: 'success' });
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('accepts a late real failed for the same requestId after pending and allows a fresh submit', async () => {
    invokeMock.mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const controller = createController(onSuccess);
    await controller.submit();
    const firstRequestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({ requestId: firstRequestId, status: 'pending' } as never);
    controller.finalizeFeedback({ requestId: firstRequestId, status: 'failed' });
    expect(controller.busy.value).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();

    // 真实终态后允许重新提交，新请求隔离旧 ID（requestId 取 Date.now()，跨毫秒保证不同）
    await new Promise((resolve) => setTimeout(resolve, 3));
    await controller.submit();
    expect(invokeMock).toHaveBeenCalledTimes(2);
    const secondRequestId = controller.pendingRequestId.value;
    expect(secondRequestId).not.toBe(firstRequestId);
    controller.finalizeFeedback({ requestId: firstRequestId, status: 'success' });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('finishes only after a matching final success feedback', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    const controller = createController(onSuccess);
    await controller.submit();
    const requestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({ requestId: 'other', status: 'success' });
    expect(controller.busy.value).toBe(true);
    controller.finalizeFeedback({ requestId, status: 'success' });

    expect(controller.busy.value).toBe(false);
    expect(onSuccess).toHaveBeenCalledWith('visit-1');
  });

  it('keeps a real failed feedback non-successful', async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    const onSuccess = vi.fn();
    const controller = createController(onSuccess);
    await controller.submit();
    const requestId = controller.pendingRequestId.value;

    controller.finalizeFeedback({ requestId, status: 'failed' });

    expect(controller.busy.value).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
