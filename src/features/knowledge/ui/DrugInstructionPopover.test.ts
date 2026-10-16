// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
vi.mock('../api/drugInstructions', () => ({ searchDrugInstructions: vi.fn(), getDrugInstruction: vi.fn() }));
import { getDrugInstruction, type DrugInstructionDetail } from '../api/drugInstructions';
import DrugInstructionPopover from './DrugInstructionPopover.vue';
import TreatmentRecommendationCard from '../../consultation-result/ui/TreatmentRecommendationCard.vue';
import { deferred } from '../testing/fixtures';

const record: DrugInstructionDetail = { productId: 'bound-id', productName: '合成药品', genericName: '',
  drugSpec: '合成规格', producer: '合成厂家', drugForm: '', category: '', createDate: '',
  summary: '【药品名称】\r\n合成资料\r\n【用法用量】\r\n合成用量原文\r\n【注意事项】\r\n合成警示' };
let app: App, host: HTMLDivElement;
let props: { productId: string; productName: string; patientAgeText?: string };
let cardToggle: ReturnType<typeof vi.fn>;
async function settle() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }
function trigger() { return host.querySelector<HTMLButtonElement>('.instruction-trigger')!; }
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]'); }
async function open() { trigger().click(); await settle(); }
beforeEach(() => {
  vi.mocked(getDrugInstruction).mockReset().mockResolvedValue(record);
  props = reactive({ productId: record.productId, productName: record.productName });
  cardToggle = vi.fn();
  host = document.createElement('div'); document.body.append(host);
  app = createApp({ render: () => h('article', { onClick: cardToggle }, [h(DrugInstructionPopover, props)]) });
  app.mount(host);
});
afterEach(() => { app.unmount(); host.remove(); vi.restoreAllMocks(); });

describe('drug instruction card popover', () => {
  it('shows child use above unchanged usage and reacts to patient age without requesting again', async () => {
    const summary = record.summary + '\r\n【儿童用药】\r\n6–17岁相关原文，6岁以下尚无资料。';
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary });
    props.patientAgeText = '8岁';
    await open();
    const headings = () => [...dialog()!.querySelectorAll('.instruction-usage h4')].map(el => el.textContent);
    expect(headings()).toEqual(['【儿童用药】', '【用法用量】']);
    expect(dialog()!.querySelector('.instruction-usage p')!.textContent).toBe('\n6–17岁相关原文，6岁以下尚无资料。');
    expect(dialog()!.querySelectorAll('.instruction-usage p')[1]!.textContent).toBe('\n合成用量原文\r\n');
    expect([...dialog()!.querySelectorAll('.instruction-chapter')].map(section =>
      (section.querySelector('h4')?.textContent ?? '') + section.querySelector('p')!.textContent).join('')).toBe(summary);
    for (const age of ['18岁', '', '8']) {
      props.patientAgeText = age; await settle();
      expect(headings()).toEqual(['【用法用量】']);
    }
    props.patientAgeText = '6个月'; await settle();
    expect(headings()).toEqual(['【儿童用药】', '【用法用量】']);
    expect(getDrugInstruction).toHaveBeenCalledExactlyOnceWith(record.productId);
    expect(cardToggle).not.toHaveBeenCalled();
  });

  it.each(['\r\n【儿童用药】\r\n ', '\r\n【注意事项】儿童用药请遵医嘱。'])
  ('keeps the current display when no nonempty child chapter exists (%s)', async tail => {
    props.patientAgeText = '8岁';
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary: record.summary + tail });
    await open();
    expect([...dialog()!.querySelectorAll('.instruction-usage h4')].map(el => el.textContent)).toEqual(['【用法用量】']);
  });

  it('keeps the full-source fallback when a child chapter exists without a usage chapter', async () => {
    props.patientAgeText = '8岁';
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary: '【儿童用药】尚未明确。' });
    await open();
    expect(dialog()!.querySelector('.instruction-usage')!.textContent).toContain('尚未明确。');
    expect(dialog()!.textContent).toContain('原文未单列');
    expect(dialog()!.querySelector('details')!.open).toBe(true);
  });

  it.each(['default', 'worklist'])('integrates in the actual %s card usage row without changing selection', async layout => {
    app.unmount();
    app = createApp({ render: () => h(TreatmentRecommendationCard, {
      rec: { type: 'medicine', name: '合成药品', reason: '' }, selected: true,
      inlineSummary: '合成用药行', layoutVariant: layout as 'default' | 'worklist', onToggle: cardToggle,
    }, { 'summary-action': () => h(DrugInstructionPopover, props) }) });
    app.mount(host);
    expect(host.querySelector('.medicine-usage-row')!.textContent).toContain('合成用药行');
    expect(host.querySelector('.medicine-usage-row .instruction-trigger')).not.toBeNull();
    await open();
    expect(getDrugInstruction).toHaveBeenCalledWith('bound-id');
    expect(cardToggle).not.toHaveBeenCalled();
    expect(host.querySelector('article.selected')).not.toBeNull();
  });

  it('loads only on click by the bound ID, prioritizes usage and never toggles the card', async () => {
    expect(getDrugInstruction).not.toHaveBeenCalled();
    await open();
    expect(getDrugInstruction).toHaveBeenCalledExactlyOnceWith('bound-id');
    expect(cardToggle).not.toHaveBeenCalled();
    expect(dialog()!.textContent).toContain('合成规格 · 合成厂家');
    expect(dialog()!.querySelector('.instruction-usage')!.textContent).toContain('合成用量原文');
    expect(dialog()!.querySelector('details')!.open).toBe(false);
    const chapters = dialog()!.querySelectorAll('.instruction-chapter');
    expect([...chapters].map(section => (section.querySelector('h4')?.textContent ?? '')
      + section.querySelector('p')!.textContent).join('')).toBe(record.summary);
  });

  it('provides focus, Escape dismissal and focus return without bubbling Escape to the page', async () => {
    await open();
    expect(document.activeElement).toBe(dialog());
    const parentEscape = vi.fn(); document.addEventListener('keydown', parentEscape);
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle(); document.removeEventListener('keydown', parentEscape);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(parentEscape).not.toHaveBeenCalled();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses on outside interaction without moving focus from the clicked control', async () => {
    await open();
    const outside = document.createElement('input'); document.body.append(outside);
    outside.focus(); outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('dismisses when keyboard focus leaves the popover, without stealing that focus', async () => {
    await open();
    const outside = document.createElement('button'); document.body.append(outside);
    outside.focus(); await settle();
    expect(dialog()).toBeNull(); expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('discards closed requests and old drug responses, including while a new lookup is pending', async () => {
    const late = deferred<DrugInstructionDetail>();
    vi.mocked(getDrugInstruction).mockReturnValueOnce(late.promise);
    await open(); expect(dialog()!.textContent).toContain('正在加载');
    dialog()!.querySelector<HTMLButtonElement>('.instruction-close')!.click(); await settle();
    const fresh = deferred<DrugInstructionDetail>();
    vi.mocked(getDrugInstruction).mockReturnValueOnce(fresh.promise);
    props.productId = 'second-id'; await settle(); await open();
    late.resolve({ ...record, summary: '过期说明书' }); await settle();
    expect(dialog()!.textContent).not.toContain('过期说明书');
    expect(dialog()!.textContent).toContain('正在加载');
    fresh.resolve({ ...record, productId: 'second-id', summary: '新药说明书' }); await settle();
    expect(dialog()!.textContent).toContain('新药说明书');
    props.productId = 'third-id'; await settle(); expect(dialog()).toBeNull();
  });

  it('distinguishes 404, service error, empty summary and missing usage, and permits retry', async () => {
    vi.mocked(getDrugInstruction).mockRejectedValueOnce({ code: 'DRUG_INSTRUCTION_NOT_FOUND' });
    await open(); expect(dialog()!.textContent).toContain('未找到该药品说明书');
    vi.mocked(getDrugInstruction).mockRejectedValueOnce({ code: 'DRUG_INSTRUCTIONS_UNAVAILABLE', requestId: 'safe-id' });
    dialog()!.querySelector<HTMLButtonElement>('.instruction-retry')!.click(); await settle();
    expect(dialog()!.textContent).toContain('服务暂不可用'); expect(dialog()!.textContent).toContain('safe-id');
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary: '' });
    dialog()!.querySelector<HTMLButtonElement>('.instruction-retry')!.click(); await settle();
    expect(dialog()!.textContent).toContain('暂无用药说明');
    trigger().click(); await settle();
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary: '未分章的完整原文' });
    await open(); expect(dialog()!.textContent).toContain('原文未单列');
    expect(dialog()!.querySelector('details')!.open).toBe(true);
    expect(dialog()!.textContent).toContain('未分章的完整原文');
  });

  it('keeps long usage intact, renders HTML as text and refuses a mismatched product response', async () => {
    const text = '<img src=x onerror=alert(1)>' + '原文末尾'.repeat(5000);
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, summary: `【用法用量】${text}` });
    await open();
    expect(dialog()!.querySelector('.instruction-usage p')!.textContent).toBe(text);
    expect(dialog()!.querySelector('img, script')).toBeNull();
    trigger().click(); await settle();
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...record, productId: 'wrong', summary: '其他药正文' });
    await open(); expect(dialog()!.textContent).toContain('药品信息不匹配');
    expect(dialog()!.textContent).not.toContain('其他药正文');
  });

  it('never requests a missing product ID', async () => {
    props.productId = ' '; await settle();
    expect(trigger().disabled).toBe(true); trigger().click(); await settle();
    expect(trigger().title).toContain('先匹配院内药品');
    expect(getDrugInstruction).not.toHaveBeenCalled(); expect(dialog()).toBeNull();
  });

  it('clamps near viewport edges and repositions on scroll/resize', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('instruction-trigger')
        ? { left: 1000, top: 700, bottom: 720, width: 40, height: 20 } as DOMRect
        : { left: 0, top: 0, bottom: 400, width: 500, height: 400 } as DOMRect;
    });
    await open();
    const popup = dialog()!;
    expect(parseFloat(popup.style.left)).toBeLessThanOrEqual(window.innerWidth - 500 - 12);
    expect(parseFloat(popup.style.top) + 400).toBeLessThanOrEqual(window.innerHeight - 12);
    window.dispatchEvent(new Event('resize')); document.dispatchEvent(new Event('scroll'));
    expect(parseFloat(popup.style.top)).toBeGreaterThanOrEqual(12);
  });
});
