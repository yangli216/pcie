import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { publicHealthBridge } from './publicHealthBridge';
import { buildConfirmation } from '../lib/publicHealthContract';
import { testRequest, testResult, testTime, testUuid, testValues } from '../testFixtures';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.mocked(invoke).mockReset(); });

function confirmation() {
  const request = testRequest();
  return buildConfirmation(request, testResult(request), testValues(request), ['check_plan', 'medication_guidance', 'lifestyle_guidance'], testUuid(9), testTime);
}

describe('public health confirmation service boundary', () => {
  it('passes a clean patient confirmation unchanged to the native task identity gate', async () => {
    const payload = confirmation(); vi.mocked(invoke).mockResolvedValue({ status: 'accepted' });
    await expect(publicHealthBridge.confirm(testUuid(50), payload)).resolves.toEqual({ status: 'accepted' });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith('confirm_public_health_result', { bridgeSessionId: testUuid(50), payload });
  });
  it.each(['制定依据\n资料如下', '请医生核对资料。', '证据：来源报告'])('rejects a direct service call with internal content before native invoke: %s', content => {
    const payload = confirmation(); payload.items[0].value = content;
    return expect(publicHealthBridge.confirm(testUuid(50), payload)).rejects.toThrow('内部说明').then(() => {
      expect(invoke).not.toHaveBeenCalled();
    });
  });
  it('rejects doctor metadata in either confirmation or target items before native invoke', async () => {
    const payload = confirmation();
    await expect(publicHealthBridge.confirm(testUuid(50), { ...payload, warnings: [{ message: '医生提醒' }] } as never)).rejects.toThrow('附加字段');
    Object.assign(payload.items[0], { doctorNotes: ['医生提醒'] });
    await expect(publicHealthBridge.confirm(testUuid(50), payload)).rejects.toThrow('回写范围');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('rejects invalid identity or section range in a direct service call', async () => {
    const payload = confirmation(); payload.recordVersion = '';
    await expect(publicHealthBridge.confirm(testUuid(50), payload)).rejects.toThrow('不一致');
    payload.recordVersion = '7'; payload.items[0].sourceSections = ['exercise_plan'];
    await expect(publicHealthBridge.confirm(testUuid(50), payload)).rejects.toThrow('回写范围');
    expect(invoke).not.toHaveBeenCalled();
  });
});
