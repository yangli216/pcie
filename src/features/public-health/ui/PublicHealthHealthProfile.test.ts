// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import PublicHealthHealthProfile from './PublicHealthHealthProfile.vue';
import { buildPublicHealthHealthProfile, type PublicHealthHealthProfile as HealthProfile } from '../lib/publicHealthHealthProfile';
import { testRequest, testTime } from '../testFixtures';

let app: App | undefined, host: HTMLDivElement;
function mount(profile: HealthProfile) {
  const current = shallowRef(profile);
  host = document.createElement('div'); document.body.append(host);
  app = createApp({ setup: () => () => h(PublicHealthHealthProfile, { profile: current.value }) });
  app.mount(host); return current;
}
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });

describe('read-only health profile', () => {
  it('shows missing information separately from normal findings and separates known risk from AI analysis', () => {
    mount(buildPublicHealthHealthProfile(testRequest()));
    expect(host.textContent).toContain('健康画像'); expect(host.textContent).toContain('只读');
    expect(host.textContent).toContain('本次调入未包含疾病与健康状况'); expect(host.textContent).toContain('本次调入未包含用药类别');
    expect(host.textContent).toContain('未提供可采用的风险分层资料');
    expect(host.querySelector('input,textarea')).toBeNull();
    expect(host.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[aria-label="调入观察的来源记录"]')).toBeNull();
  });

  it('supports keyboard expansion and safely renders source, summary and observation text', async () => {
    const request = testRequest();
    request.facts.historySummary = '<img src=x onerror=alert(1)>合成病史';
    request.facts.observations = [{ id: 'synthetic-id', code: '<svg onload=alert(1)>', value: '<script>alert(1)</script>',
      observedAt: testTime, source: { system: '<img src=x>', recordId: '<script>record</script>' } }];
    mount(buildPublicHealthHealthProfile(request));
    const button = host.querySelector('button')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await nextTick();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(button.getAttribute('aria-controls')!)).not.toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>合成病史');
    expect(host.textContent).toContain('<script>alert(1)</script>'); expect(host.textContent).toContain('<script>record</script>');
    expect(host.querySelector('img,script,svg')).toBeNull();
    expect(host.querySelector('time')!.dateTime).toBe(testTime);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); await nextTick();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[aria-label="调入观察的来源记录"]')).toBeNull();
  });

  it('refreshes known risks, observations and history from new props while displaying conflicts and future exclusions', async () => {
    const request = testRequest();
    request.facts.observations = [
      { id: 'risk', code: 'risk_level', value: '合成高风险', observedAt: testTime, source: { system: 'SYNTHETIC_PHIS', recordId: 'synthetic-record' } },
      { id: 'a', code: 'systolic_bp', value: 140, unit: 'mmHg', observedAt: testTime, source: { system: 'SYNTHETIC_PHIS', recordId: 'synthetic-record' } },
      { id: 'b', code: 'systolic_bp', value: 160, unit: 'mmHg', observedAt: testTime, source: { system: 'SYNTHETIC_EXAM', recordId: 'synthetic-report' } },
      { id: 'future', code: 'weight', value: 80, unit: 'kg', observedAt: '2026-09-30T10:00:00+08:00', source: { system: 'SYNTHETIC_PHIS', recordId: 'synthetic-record' } },
    ];
    const current = mount(buildPublicHealthHealthProfile(request));
    expect(host.textContent).toContain('已有风险等级：合成高风险');
    expect(host.textContent).toContain('1 条观察晚于本次资料快照');
    expect(host.textContent).toContain('收缩压在同一最新时点存在不同结果');
    host.querySelector('button')!.click(); await nextTick();
    expect(host.textContent).not.toContain('140 mmHg'); expect(host.textContent).not.toContain('160 mmHg');
    expect(host.textContent).not.toContain('80 kg');
    const next = structuredClone(request); next.facts.historySummary = '合成最新病史';
    next.facts.observations = [{ ...request.facts.observations[0], value: '合成低风险' }];
    current.value = buildPublicHealthHealthProfile(next); await nextTick();
    expect(host.textContent).toContain('已有风险等级：合成低风险'); expect(host.textContent).toContain('合成最新病史');
    expect(host.textContent).not.toContain('合成高风险'); expect(host.textContent).not.toContain('不同结果');
  });
});
