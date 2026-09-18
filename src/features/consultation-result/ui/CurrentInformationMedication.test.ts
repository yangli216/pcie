// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import CurrentInformationMedication from './CurrentInformationMedication.vue';
import type { CurrentInformationMedicationAssessment } from '../../clinical-result/currentInformationMedication';
import type { CurrentInformationMedicationPhase } from '../model/useCurrentInformationMedication';

describe('CurrentInformationMedication', () => {
  it('exposes one action, disables repeat clicks, and renders deferred medicines without selection controls', async () => {
    const onRequest = vi.fn();
    const state = reactive({
      disabled: false, pending: false, phase: 'idle' as CurrentInformationMedicationPhase, reason: '原建议先检查', error: '',
      assessment: null as CurrentInformationMedicationAssessment | null,
    });
    const host = document.createElement('div'); document.body.append(host);
    const app = createApp({ render: () => h(CurrentInformationMedication, { ...state, onRequest }) });
    app.mount(host);
    try {
      const button = host.querySelector('button')!;
      expect(button.textContent).toContain('基于现有信息推荐用药');
      button.click(); expect(onRequest).toHaveBeenCalledTimes(1);
      state.disabled = true; state.pending = true; state.phase = 'assessing'; await nextTick();
      button.click(); expect(onRequest).toHaveBeenCalledTimes(1);
      expect(button.textContent).toContain('评估中');
      expect(host.querySelector('[role="status"]')?.textContent).toContain('正在结合当前病情评估用药');
      state.phase = 'finalizing';
      state.assessment = { summary: '暂无可推荐药品', disposition: 'medication_options', deferred: [{ name: '药品A', reason: '缺少肾功能结果' }] };
      await nextTick();
      expect(host.querySelector('[role="status"]')?.textContent).toContain('正在核对可开立药品与库存');
      expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无可推荐药品');
      expect(host.querySelector('details')?.textContent).toContain('缺少肾功能结果');
      expect(host.querySelectorAll('input')).toHaveLength(0);
      expect(host.querySelectorAll('button')).toHaveLength(1);
      state.disabled = false; state.pending = false; state.phase = 'failed';
      state.error = '评估失败，原方案已保留'; await nextTick();
      expect(host.querySelector('[role="status"]')?.textContent).toContain('评估失败');
      expect(host.querySelector('[role="status"]')?.textContent).toContain('暂无可推荐药品');
    } finally { app.unmount(); host.remove(); }
  });
});
