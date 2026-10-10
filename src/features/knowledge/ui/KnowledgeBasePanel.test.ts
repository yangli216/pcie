// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
vi.mock('../api/knowledgeRetrieval', () => ({ listKnowledgeCollections: vi.fn(), searchKnowledge: vi.fn() }));
vi.mock('@services/pmphai', () => ({ isPMPHAIConfigured: vi.fn(() => false), pmphaiService: { getPageUrl: vi.fn() } }));
import { listKnowledgeCollections, searchKnowledge } from '../api/knowledgeRetrieval';
import { collection, result, deferred } from '../testing/fixtures';
import KnowledgeBasePanel from './KnowledgeBasePanel.vue';

let app: App | undefined;
let host: HTMLDivElement;
async function settle() { for (let i = 0; i < 5; i += 1) { await Promise.resolve(); await nextTick(); } }
function mount(onClose = vi.fn()) {
  host = document.createElement('div'); document.body.append(host);
  app = createApp(KnowledgeBasePanel, { onClose }); app.mount(host);
  return onClose;
}
function submit(query: string) {
  const input = host.querySelector('input')!; input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listKnowledgeCollections).mockResolvedValue({ enabled: true, collections: [collection] });
  vi.mocked(searchKnowledge).mockResolvedValue(result());
});
afterEach(() => { app?.unmount(); app = undefined; host?.remove(); });
describe('knowledge workbench production components', () => {
  it('searches from the rendered form and shows trusted source versions with the original text', async () => {
    mount(); await settle(); submit('合成资料'); await settle();
    expect(searchKnowledge).toHaveBeenCalledWith({ collectionId: collection.id, releaseVersion: collection.releaseVersion, query: '合成资料', limit: 5 });
    expect(host.textContent).toContain('合成工程资料，非医学结论。'); expect(host.textContent).toContain('source-v1'); expect(host.textContent).toContain(collection.releaseVersion);
    expect(host.querySelector('article')?.textContent).toContain('SYNTHETIC-SOURCE');
  });
  it('renders document HTML as plain text without active elements or event handlers', async () => {
    const untrusted = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
    vi.mocked(searchKnowledge).mockResolvedValue(result(collection, untrusted)); mount(); await settle(); submit('合成'); await settle();
    expect(host.querySelector('.evidence-content')?.textContent).toBe(untrusted);
    expect(host.querySelector('.evidence-content img')).toBeNull(); expect(host.querySelector('.evidence-content script')).toBeNull();
  });
  it('shows zero matches independently of a retriable failure', async () => {
    vi.mocked(searchKnowledge).mockResolvedValueOnce({ ...result(), results: [] }); mount(); await settle(); submit('合成'); await settle();
    expect(host.textContent).toContain('未找到匹配资料'); expect(host.querySelector('[role="alert"]')).toBeNull();
    vi.mocked(searchKnowledge).mockRejectedValueOnce({ code: 'KNOWLEDGE_CONTENT_CHANGED' }); submit('合成'); await settle();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('内容已变化'); expect(host.textContent).not.toContain('未找到匹配资料');
  });
  it('disabled and unpublished institutions expose no sample search results', async () => {
    vi.mocked(listKnowledgeCollections).mockResolvedValueOnce({ enabled: false, collections: [] }); mount(); await settle();
    expect(host.textContent).toContain('未启用资料检索'); expect(host.querySelector('form')).toBeNull(); expect(host.querySelector('article')).toBeNull();
    vi.mocked(listKnowledgeCollections).mockResolvedValueOnce({ enabled: true, collections: [] });
    host.querySelector<HTMLButtonElement>('.refresh-button')!.click(); await settle();
    expect(host.textContent).toContain('尚无已发布的知识资料');
  });
  it('source switching removes an in-flight result and preserves the separate PMPHAI entry', async () => {
    const pending = deferred<ReturnType<typeof result>>(); vi.mocked(searchKnowledge).mockReturnValueOnce(pending.promise);
    mount(); await settle(); submit('合成'); await settle();
    host.querySelectorAll<HTMLButtonElement>('.source-navigation button')[1]!.click(); await settle();
    expect(host.textContent).toContain('当前机构未启用人卫知识服务');
    pending.resolve(result()); await settle(); expect(host.querySelector('article')).toBeNull();
    host.querySelectorAll<HTMLButtonElement>('.source-navigation button')[0]!.click(); await settle();
    expect(host.querySelector('form')).not.toBeNull(); expect(host.querySelector('article')).toBeNull();
  });
  it('the existing close event still closes the workbench', async () => {
    const onClose = mount(); await settle(); host.querySelector<HTMLButtonElement>('[aria-label="关闭知识库"]')!.click();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
