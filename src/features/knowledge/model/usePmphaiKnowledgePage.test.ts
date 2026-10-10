import { describe, expect, it, vi } from 'vitest';
vi.mock('@services/pmphai', () => ({ isPMPHAIConfigured: vi.fn(), pmphaiService: { getPageUrl: vi.fn() } }));
import { usePmphaiKnowledgePage } from './usePmphaiKnowledgePage';
import { deferred } from '../testing/fixtures';

function create() {
  const deps = { configured: vi.fn(() => true), getUrl: vi.fn(async (): Promise<string | null> => 'https://synthetic.invalid/page'), open: vi.fn(async () => {}) };
  return { deps, page: usePmphaiKnowledgePage(deps) };
}
describe('PMPHAI workbench page', () => {
  it('opens only a server-issued HTTP page once per pending action', async () => {
    const { deps, page } = create(); const pending = deferred<string | null>(); deps.getUrl.mockReturnValueOnce(pending.promise);
    const task = page.open(); await page.open(); expect(deps.getUrl).toHaveBeenCalledTimes(1); expect(page.opening.value).toBe(true);
    pending.resolve('https://synthetic.invalid/page'); await task; expect(deps.open).toHaveBeenCalledWith('https://synthetic.invalid/page'); expect(page.opening.value).toBe(false);
  });
  it('disabled configuration does not request a page', async () => {
    const { deps, page } = create(); deps.configured.mockReturnValue(false); await page.open(); expect(deps.getUrl).not.toHaveBeenCalled();
  });
  it.each([null, '', 'javascript:alert(1)', 'file:///private/secret'])('rejects invalid page URL %s', async value => {
    const { deps, page } = create(); deps.getUrl.mockResolvedValue(value); await page.open(); expect(deps.open).not.toHaveBeenCalled(); expect(page.error.value).toContain('暂时无法打开');
  });
  it('reports safe errors and allows retry', async () => {
    const { deps, page } = create(); deps.getUrl.mockRejectedValueOnce(new Error('private token')); await page.open(); expect(page.error.value).not.toContain('token');
    await page.open(); expect(deps.open).toHaveBeenCalledTimes(1); expect(page.error.value).toBe('');
  });
  it('does not open a late page after leaving the workbench', async () => {
    const { deps, page } = create(); const pending = deferred<string | null>(); deps.getUrl.mockReturnValueOnce(pending.promise);
    const task = page.open(); page.dispose(); pending.resolve('https://synthetic.invalid/page'); await task; await page.open();
    expect(deps.open).not.toHaveBeenCalled(); expect(page.opening.value).toBe(false);
  });
});
