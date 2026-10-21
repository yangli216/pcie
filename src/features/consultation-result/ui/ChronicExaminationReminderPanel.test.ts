// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from 'vue';
import Panel from './ChronicExaminationReminderPanel.vue';
import type { ChronicExaminationReminders } from '@features/clinical-result/clinicalResultContract';
let app: App | undefined;
afterEach(() => { app?.unmount(); document.body.innerHTML = ''; });
function render(patch: Partial<ChronicExaminationReminders> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  app = createApp(Panel, { reminders: { sourceStatus: 'ready', catalogStatus: 'ready', historyStatus: 'complete',
    regionalHistoryStatus: 'not_connected', items: [], ...patch } });
  app.mount(host); return host;
}
describe('chronic examination scope and status display', () => {
  it('always names PHIS, 90 days and the disconnected regional source', () => {
    const host = render();
    expect(host.textContent).toContain('PHIS 近90天');
    expect(host.textContent).toContain('健康大脑全区查询未接入');
    expect(host.textContent).toContain('未查到不代表未检查');
    expect(host.textContent).toContain('本次未返回推荐项目');
  });
  it('shows failures as unavailable and history as incomplete, without saying no examination was done', () => {
    const host = render({ sourceStatus: 'unavailable', catalogStatus: 'unavailable', historyStatus: 'partial' });
    expect(host.textContent).toContain('本次未取得推荐清单');
    expect(host.textContent).toContain('目录读取失败');
    expect(host.textContent).toContain('PHIS 历史查询不完整');
    expect(host.textContent).not.toContain('本次未返回推荐项目');
  });
  it('renders upstream names and history as text and labels the date as application time', () => {
    const unsafe = '<img src=x onerror="window.unsafe=1">';
    const host = render({ items: [{ name: unsafe, matchStatus: 'ambiguous', recentReports: [{ name: unsafe, requestedAt: '2026-10-18', visitTime: 1 }] }] });
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain(unsafe);
    expect(host.textContent).toContain('院内同名项目不唯一');
    expect(host.textContent).toContain('申请时间：2026-10-18');
  });
});
