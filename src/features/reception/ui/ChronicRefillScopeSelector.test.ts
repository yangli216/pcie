// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { ChronicRefillCandidate } from '@features/reception-risk';
import ChronicRefillScopeSelector from './ChronicRefillScopeSelector.vue';
import selectorSource from './ChronicRefillScopeSelector.vue?raw';

function createCandidate(): ChronicRefillCandidate {
  return {
    diagnosis: '2型糖尿病',
    diagnoses: ['2型糖尿病', '高血压2级'],
    diagnosisGroups: ['糖尿病', '高血压'],
    medications: ['盐酸二甲双胍片'],
    chronicVisitCount: 1,
    chronicVisits: [],
    diagnosisEvidenceText: '近期历史就诊记录有慢病诊断',
    medicationEvidenceText: '历史用药记录：盐酸二甲双胍片',
    evidenceText: '多慢病历史处方',
    conditions: [
      {
        id: '糖尿病',
        diagnosis: '2型糖尿病',
        diagnosisGroup: '糖尿病',
        hasMedicationEvidence: true,
        medicationEvidenceScope: 'shared',
      },
      {
        id: '高血压',
        diagnosis: '高血压2级',
        diagnosisGroup: '高血压',
        hasMedicationEvidence: true,
        medicationEvidenceScope: 'shared',
      },
    ],
    medicationAttributions: [{
      id: 'visit-1::metformin::0',
      visitTime: 1,
      medication: { name: '盐酸二甲双胍片' },
      source: 'structured',
      candidateConditionIds: ['糖尿病', '高血压'],
    }],
  };
}

function findButton(host: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((item) => item.textContent?.includes(text));
  if (!button) throw new Error(`未找到按钮：${text}`);
  return button;
}

describe('ChronicRefillScopeSelector', () => {
  it('uses diagnosis selection as confirmation and keeps medicine attribution silent', () => {
    expect(selectorSource).toContain(':disabled="selectedConditionIds.length === 0"');
    expect(selectorSource).toContain("emit('submit', {");
    expect(selectorSource).toContain('conditionIds: [...selectedConditionIds.value]');
    expect(selectorSource).not.toContain('medicationAttributionStatus');
    expect(selectorSource).not.toContain('submitQueued');
    expect(selectorSource).not.toContain('AI 自动识别历史用药');
    expect(selectorSource).not.toContain('正在根据所选诊断识别历史用药');
    expect(selectorSource).not.toContain('已匹配 {{');
    expect(selectorSource).not.toContain('识别暂不可用');
    expect(selectorSource).not.toContain('未找到可可靠归入所选诊断');
    expect(selectorSource).not.toContain('rcs-attribution');
    expect(selectorSource).not.toContain('confirmedMedicationAttributionIds');
    expect(selectorSource).not.toContain('toggleMedicationAttribution');
    expect(selectorSource).not.toContain('rcs-attribution-item');
    expect(selectorSource).not.toContain("from '@/services/llm'");
    expect(selectorSource).not.toContain('chatFast(');
  });

  it('submits one selected condition immediately without waiting for medication attribution', async () => {
    const onSubmit = vi.fn();
    const state = reactive({ candidate: createCandidate() });
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp({
      render: () => h(ChronicRefillScopeSelector, {
        candidate: state.candidate,
        onSubmit,
      }),
    });
    app.mount(host);

    try {
      findButton(host, '2型糖尿病').click();
      await nextTick();
      const confirmButton = findButton(host, '生成病历与核查项');
      confirmButton.click();
      await nextTick();

      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({ conditionIds: ['糖尿病'] });
      expect(confirmButton.disabled).toBe(false);
      expect(confirmButton.hasAttribute('aria-busy')).toBe(false);
    } finally {
      app.unmount();
      host.remove();
    }
  });
});
