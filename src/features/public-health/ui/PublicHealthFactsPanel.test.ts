// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import PublicHealthFactsPanel from './PublicHealthFactsPanel.vue';
import { testRequest } from '../testFixtures';
import type { PublicHealthRequest } from '../types';

let app: App | undefined, host: HTMLDivElement;
function mount(request: PublicHealthRequest) {
  const current = shallowRef(request);
  host = document.createElement('div'); document.body.append(host);
  app = createApp({ setup: () => () => h(PublicHealthFactsPanel, { request: current.value, disabled: false, missing: [] }) });
  app.mount(host); return current;
}
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });

describe('public health imported facts', () => {
  it('explains snapshot scope and does not turn missing records into absent disease or medication', () => {
    mount(testRequest());
    expect(host.textContent).toContain('仅展示本次调入的资料。在 PHIS 修改资料后，请重新调入。');
    expect(host.textContent).toContain('本次调入未包含疾病与健康状况');
    expect(host.textContent).toContain('本次调入未包含用药类别');
    expect(host.textContent).not.toContain('未用药');
  });

  it('shows caller condition and medication class names as text and updates on a new snapshot', async () => {
    const request = testRequest();
    request.facts.conditions = [{ code: 'synthetic-condition', name: '合成健康状况', status: '管理中' }];
    request.facts.medicationClasses = [{ code: 'synthetic-class', name: '<img src=x>合成类别' }];
    const current = mount(request);
    expect(host.textContent).toContain('合成健康状况');
    expect(host.textContent).toContain('<img src=x>合成类别');
    expect(host.querySelector('img')).toBeNull();
    const next = structuredClone(request);
    next.facts.medicationClasses = [{ code: 'synthetic-class', name: '合成用药类别' }];
    current.value = next; await nextTick();
    expect(host.textContent).toContain('合成用药类别');
    expect(host.textContent).not.toContain('<img src=x>合成类别');
    expect(host.textContent).not.toContain('本次调入未包含用药类别');
  });
});
