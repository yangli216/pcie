// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
vi.mock('../api/drugInstructions', () => ({ searchDrugInstructions: vi.fn(), getDrugInstruction: vi.fn() }));
import { searchDrugInstructions, getDrugInstruction, type DrugInstructionDetail } from '../api/drugInstructions';
import DrugInstructionsPanel from './DrugInstructionsPanel.vue';
import { deferred } from '../testing/fixtures';

const a = { productId: 'A', productName: '合成药', genericName: '', drugSpec: '1g', producer: '合成甲厂', drugForm: '片剂', category: '' };
const b = { ...a, productId: 'B', drugSpec: '2g', producer: '合成乙厂' };
const page = { current: 1, size: 20, hasMore: true, records: [a, b] };
let app: App | undefined, host: HTMLDivElement;
async function settle() { for (let i = 0; i < 6; i += 1) { await Promise.resolve(); await nextTick(); } }
async function search(query = '合成药') {
  const input = host.querySelector('input')!;
  input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
}
function select(index: number) { host.querySelectorAll<HTMLButtonElement>('.drug-candidate')[index]!.click(); }
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchDrugInstructions).mockResolvedValue(page);
  vi.mocked(getDrugInstruction).mockResolvedValue({ ...a, summary: '【用法用量】\r\n合成用量\r\n【禁忌】\r\n合成禁忌', createDate: '' });
  host = document.createElement('div'); document.body.append(host);
  app = createApp(DrugInstructionsPanel); app.mount(host);
});
afterEach(() => { app?.unmount(); app = undefined; host.remove(); });

describe('drug instruction reader', () => {
  it('lets doctors distinguish candidates and read full long text safely', async () => {
    const summary = '【用法用量】\r\n合成用量\r\n【注意事项】\r\n<img src=x onerror=alert(1)><script>alert(1)</script>' + '完整末尾'.repeat(10000);
    vi.mocked(getDrugInstruction).mockResolvedValue({ ...b, summary, createDate: '' });
    await search();
    expect(host.textContent).toContain('合成甲厂'); expect(host.textContent).toContain('合成乙厂');
    expect(host.querySelector('article')).toBeNull();
    select(1); await settle();
    expect(getDrugInstruction).toHaveBeenCalledWith('B');
    expect(host.querySelector('article')!.textContent).toContain('2g');
    const rendered = [...host.querySelectorAll('.drug-section')].map(section =>
      (section.querySelector('h4')?.textContent ?? '') + section.querySelector('.drug-summary')!.textContent).join('');
    expect(rendered).toBe(summary);
    expect(host.querySelector('article img, article script')).toBeNull();
    expect(host.querySelector('.drug-section--usage')!.textContent).toContain('合成用量');
  });

  it('keeps zero hits separate from a failure and supports retry through the search form', async () => {
    vi.mocked(searchDrugInstructions).mockResolvedValueOnce({ ...page, records: [], hasMore: false });
    await search(); expect(host.textContent).toContain('未找到匹配药品');
    vi.mocked(searchDrugInstructions).mockRejectedValueOnce({ code: 'DRUG_INSTRUCTIONS_UNAVAILABLE', requestId: 'synthetic-request' });
    await search(); expect(host.querySelector('[role="alert"]')!.textContent).toContain('synthetic-request');
    expect(host.textContent).not.toContain('未找到匹配药品');
    await search(); expect(host.querySelectorAll('.drug-candidate')).toHaveLength(2);
  });

  it('reports empty summary independently of missing drug and retries detail errors', async () => {
    vi.mocked(getDrugInstruction).mockRejectedValueOnce({ code: 'DRUG_INSTRUCTION_NOT_FOUND' });
    await search(); select(0); await settle();
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('未找到该药品说明书');
    vi.mocked(getDrugInstruction).mockResolvedValueOnce({ ...a, summary: '', createDate: '' });
    host.querySelector<HTMLButtonElement>('.drug-detail button')!.click(); await settle();
    expect(host.textContent).toContain('暂无用药说明'); expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('discards a late detail after another drug is selected or a search is restarted', async () => {
    const late = deferred<DrugInstructionDetail>();
    vi.mocked(getDrugInstruction).mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce({ ...b, summary: '乙药正文', createDate: '' });
    await search(); select(0); await settle(); select(1); await settle();
    late.resolve({ ...a, summary: '过期甲药正文', createDate: '' }); await settle();
    expect(host.querySelector('article')!.textContent).toContain('乙药正文');
    expect(host.textContent).not.toContain('过期甲药正文');
    const next = deferred<DrugInstructionDetail>();
    vi.mocked(getDrugInstruction).mockReturnValueOnce(next.promise); select(0); await settle();
    await search('新查询'); next.resolve({ ...a, summary: '旧查询正文', createDate: '' }); await settle();
    expect(host.querySelector('article')).toBeNull();
  });

  it('discards a late search after a newer search and ignores results after unmount', async () => {
    const old = deferred<typeof page>();
    vi.mocked(searchDrugInstructions).mockReturnValueOnce(old.promise);
    await search('旧查询');
    // A form submission can happen programmatically while the submit button is disabled.
    await search('新查询');
    old.resolve({ ...page, records: [{ ...a, productName: '过期药名' }] }); await settle();
    expect(host.textContent).not.toContain('过期药名');
    const late = deferred<DrugInstructionDetail>();
    vi.mocked(getDrugInstruction).mockReturnValueOnce(late.promise); select(0); await settle();
    app!.unmount(); app = undefined;
    late.resolve({ ...a, summary: '卸载后正文', createDate: '' }); await settle();
    expect(host.textContent).toBe('');
  });

  it('pages using the submitted keyword and clears the previous detail', async () => {
    await search(); select(0); await settle();
    vi.mocked(searchDrugInstructions).mockResolvedValueOnce({ ...page, current: 2, hasMore: false });
    host.querySelectorAll<HTMLButtonElement>('.drug-pagination button')[1]!.click(); await settle();
    expect(searchDrugInstructions).toHaveBeenLastCalledWith({ keyword: '合成药', current: 2, size: 20 });
    expect(host.querySelector('article')).toBeNull();
    expect(host.querySelectorAll<HTMLButtonElement>('.drug-pagination button')[1]!.disabled).toBe(true);
  });
});
