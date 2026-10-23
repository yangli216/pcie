// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import Panel from './ChronicExaminationReminderPanel.vue';
import type { ChronicExaminationReminders } from '@features/clinical-result/clinicalResultContract';
let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.useRealTimers(); });
function render(patch: Partial<ChronicExaminationReminders> = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const state = reactive<{ reminders: ChronicExaminationReminders }>({ reminders: {
    sourceStatus: 'ready', catalogStatus: 'ready', historyStatus: 'complete', regionalHistoryStatus: 'not_connected', items: [], ...patch,
  } });
  app = createApp({ render: () => h(Panel, { reminders: state.reminders }) }); app.mount(host);
  return { host, state, button: host.querySelector<HTMLButtonElement>('.reminder-info')! };
}
async function tick() { await nextTick(); await nextTick(); }
const item = (name: string, matchStatus: 'matched' | 'ambiguous' | 'unmatched') => ({ name, matchStatus, recentReports: [] });

describe('compact chronic examination reminders and accessible details', () => {
  it('shows counts without the fixed source banner or unmatched list in the initial DOM', () => {
    const { host, button } = render({ items: [item('糖化血红蛋白', 'matched'), item('尿肾功能', 'unmatched'), item('血脂', 'ambiguous')] });
    expect(host.textContent).toContain('可选 1 项'); expect(host.textContent).toContain('2 项待核对');
    expect(host.textContent).not.toContain('PHIS 近90天'); expect(host.textContent).not.toContain('健康大脑全区查询未接入');
    expect(host.textContent).not.toContain('尿肾功能'); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('opens on hover and remains readable while moving from trigger to the scrollable popup', async () => {
    vi.useFakeTimers();
    const { button } = render({ items: [item('尿肾功能', 'unmatched')] });
    button.dispatchEvent(new Event('pointerenter')); await tick();
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.textContent).toContain('尿肾功能'); expect(panel.textContent).toContain('未查到不代表未检查');
    expect(panel.textContent).toContain('随病历一起回写');
    expect(panel.textContent).not.toContain('PHIS 近90天'); expect(panel.textContent).not.toContain('健康大脑全区查询未接入');
    button.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(100);
    panel.dispatchEvent(new Event('pointerenter')); vi.advanceTimersByTime(200); await tick();
    expect(document.querySelector('[role="dialog"]')).toBe(panel);
    panel.dispatchEvent(new Event('pointerleave')); vi.advanceTimersByTime(160); await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('opens on keyboard focus, pins on click, and Escape closes without reopening on restored focus', async () => {
    const { button } = render({ items: [item('血脂', 'ambiguous')] });
    button.focus(); await tick(); expect(button.getAttribute('aria-expanded')).toBe('true');
    button.click(); await tick(); expect(document.activeElement?.getAttribute('role')).toBe('dialog');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(button); expect(button.getAttribute('aria-expanded')).toBe('false');
  });
  it('closes on outside interaction, result changes and unmount', async () => {
    const { button, state } = render({ items: [item('旧患者项目', 'unmatched')] });
    button.click(); await tick();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    button.click(); await tick();
    state.reminders = { ...state.reminders, items: [item('新患者项目', 'matched')] }; await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    button.click(); await tick();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('旧患者项目');
    app?.unmount(); app = undefined; expect(document.querySelector('[role="dialog"]')).toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  it('keeps failures, valid empty and incomplete history distinct without opening details', () => {
    const { host } = render({ sourceStatus: 'unavailable', catalogStatus: 'unavailable', historyStatus: 'partial' });
    expect(host.textContent).toContain('本次未取得推荐清单'); expect(host.textContent).toContain('目录读取失败');
    expect(host.textContent).toContain('PHIS 历史查询不完整'); expect(host.textContent).not.toContain('本次未返回推荐项目');
    app?.unmount(); app = undefined;
    const empty = render(); expect(empty.host.textContent).toContain('本次未返回推荐项目');
  });
  it('renders source text safely, explains group/part ambiguity, and labels report dates as application time', async () => {
    const unsafe = '<img src=x onerror="window.unsafe=1">';
    const { button } = render({ items: [
      { name: unsafe, matchStatus: 'ambiguous', matchIssue: 'unverified_group', recentReports: [{ name: unsafe, requestedAt: '2026-10-18', visitTime: 1 }] },
      { ...item('心电图', 'ambiguous'), matchIssue: 'unverified_part' },
    ] });
    button.click(); await tick();
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(panel.querySelector('img')).toBeNull(); expect(panel.textContent).toContain(unsafe);
    expect(panel.textContent).toContain('组套或单项信息未确认'); expect(panel.textContent).toContain('部位或检查方式未明确');
    const details = panel.querySelector('details')!; details.open = true;
    expect(details.textContent).toContain('申请时间：2026-10-18');
  });
  it('keeps the popup inside the viewport near the lower/right edge', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return (this.classList.contains('reminder-info')
        ? { top: 650, bottom: 676, left: 970, right: 996, width: 26, height: 26 }
        : { top: 0, bottom: 460, left: 0, right: 440, width: 440, height: 460 }) as DOMRect;
    });
    const { button } = render({ items: [item('很长的项目名称'.repeat(30), 'unmatched')] });
    button.click(); await tick();
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(12);
    expect(parseFloat(panel.style.left) + 440).toBeLessThanOrEqual(window.innerWidth - 12);
    expect(parseFloat(panel.style.top) + 460).toBeLessThanOrEqual(window.innerHeight - 12);
  });
});
