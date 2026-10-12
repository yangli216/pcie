// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, h, type App } from 'vue';
import PublicHealthResultSections from './PublicHealthResultSections.vue';

let app: App | undefined;
let host: HTMLDivElement;
afterEach(() => { app?.unmount(); host?.remove(); });

describe('read-only metric provenance', () => {
  it.each([
    ['legacy-bsoft-bmi-bmr.v1', '服务端计算'], ['mock.migration-formula.v1', '工程计算'], ['runtime.migration-formula.v1', '工程计算'],
  ])('labels %s as %s', (formulaVersion, source) => {
    host = document.createElement('div'); document.body.append(host);
    app = createApp({ render: () => h(PublicHealthResultSections, {
      sections: [], values: {}, selected: [], editable: false,
      metrics: { bmi: 23.5, bmrKcalPerDay: 1301.5, formulaVersion },
    }) });
    app.mount(host);
    expect(host.querySelector(`[aria-label="${source}的只读减重指标"]`)).not.toBeNull();
    expect(host.textContent).toContain(`${source} · ${formulaVersion}`);
    expect(host.textContent).toContain('23.5'); expect(host.querySelector('input')).toBeNull();
  });
});
