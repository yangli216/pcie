// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import CurrentInformationMedication from './CurrentInformationMedication.vue';
import type { CurrentInformationMedicationAssessment } from '../../clinical-result/currentInformationMedication';

describe('CurrentInformationMedication', () => {
  it('exposes one action, disables repeat clicks, and renders deferred medicines without selection controls', async () => {
    const onRequest = vi.fn();
    const state = reactive({
      disabled: false, pending: false, reason: '原建议先检查', error: '',
      assessment: null as CurrentInformationMedicationAssessment | null,
    });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ render: () => h(CurrentInformationMedication, { ...state, onRequest }) });
    app.mount(host);
    try {
      const button = host.querySelector('button')!;
      expect(button.textContent).toContain('基于现有信息推荐用药');
      button.click(); expect(onRequest).toHaveBeenCalledTimes(1);
      state.disabled = true; state.pending = true; await nextTick();
      button.click(); expect(onRequest).toHaveBeenCalledTimes(1);
      expect(button.textContent).toContain('正在评估');
      state.disabled = false; state.pending = false;
      state.assessment = { summary: '暂无可推荐药品', disposition: 'medication_options', deferred: [{ name: '药品A', reason: '缺少肾功能结果' }] };
      await nextTick();
      expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无可推荐药品');
      expect(host.querySelector('details')?.textContent).toContain('缺少肾功能结果');
      expect(host.querySelectorAll('input')).toHaveLength(0);
      expect(host.querySelectorAll('button')).toHaveLength(1);
      state.error = '评估失败，原方案已保留'; await nextTick();
      expect(host.querySelector('[role="status"]')?.textContent).toContain('评估失败');
    } finally { app.unmount(); host.remove(); }
  });
});
