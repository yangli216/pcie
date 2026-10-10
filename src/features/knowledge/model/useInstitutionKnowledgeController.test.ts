import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/knowledgeRetrieval', () => ({ listKnowledgeCollections: vi.fn(), searchKnowledge: vi.fn() }));
import type { KnowledgeCollectionsResponse, KnowledgeSearchResponse } from '../api/knowledgeRetrieval';
import { useInstitutionKnowledgeController } from './useInstitutionKnowledgeController';
import { collection, secondCollection, result, deferred } from '../testing/fixtures';

function create() {
  const deps = { list: vi.fn(async (): Promise<KnowledgeCollectionsResponse> => ({ enabled: true, collections: [collection, secondCollection] })), search: vi.fn(async (): Promise<KnowledgeSearchResponse> => result()) };
  return { deps, controller: useInstitutionKnowledgeController(deps) };
}
describe('institution knowledge controller', () => {
  it('uses only the selected approved collection version and trims the query', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); await controller.search('  合成资料  ');
    expect(deps.search).toHaveBeenCalledWith({ collectionId: collection.id, releaseVersion: collection.releaseVersion, query: '合成资料', limit: 5 });
    expect(controller.response.value?.results[0]?.sourceVersion).toBe('source-v1');
    expect(controller.searching.value).toBe(false);
  });
  it('blocks search when disabled, unapproved, loading or invalid', async () => {
    const { deps, controller } = create(); await controller.search('合成'); expect(deps.search).not.toHaveBeenCalled();
    await controller.loadCollections(); await controller.search('   '); await controller.search('字'.repeat(2001)); expect(deps.search).not.toHaveBeenCalled();
    deps.list.mockResolvedValue({ enabled: false, collections: [collection] }); await controller.loadCollections();
    expect(controller.collections.value).toEqual([]); expect(controller.canSearch.value).toBe(false);
    deps.list.mockResolvedValue({ enabled: true, collections: [] }); await controller.loadCollections(); await controller.search('合成'); expect(deps.search).not.toHaveBeenCalled();
  });
  it('keeps a real zero-hit response distinct from retrieval failure and clears old results', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); deps.search.mockResolvedValue({ ...result(), results: [] }); await controller.search('合成');
    expect(controller.response.value?.results).toEqual([]); expect(controller.error.value).toBe('');
    deps.search.mockRejectedValue(new Error('secret provider message')); await controller.search('合成');
    expect(controller.response.value).toBeNull(); expect(controller.error.value).toContain('暂时失败'); expect(controller.error.value).not.toContain('secret');
  });
  it.each([
    ['KNOWLEDGE_NOT_READY', '已批准资料'], ['KNOWLEDGE_VERSION_CHANGED', '版本已更新'], ['KNOWLEDGE_CONTENT_CHANGED', '内容已变化'],
  ])('shows actionable safe feedback for %s', async (code, message) => {
    const { deps, controller } = create(); await controller.loadCollections(); deps.search.mockRejectedValue({ code, message: 'private raw error' });
    await controller.search('合成'); expect(controller.error.value).toContain(message); expect(controller.response.value).toBeNull();
  });
  it('ignores an old search after selecting another collection and permits a new search', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); const old = deferred<KnowledgeSearchResponse>(); deps.search.mockReturnValueOnce(old.promise);
    const pending = controller.search('旧问题'); controller.selectCollection(secondCollection.id);
    deps.search.mockResolvedValue(result(secondCollection)); await controller.search('新问题'); old.resolve(result()); await pending;
    expect(controller.response.value?.collection.id).toBe(secondCollection.id); expect(controller.searching.value).toBe(false);
  });
  it('refresh invalidates an old search and a later refresh supersedes a pending catalog load', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); const search = deferred<KnowledgeSearchResponse>(); deps.search.mockReturnValueOnce(search.promise);
    const pendingSearch = controller.search('合成'); const oldList = deferred<KnowledgeCollectionsResponse>(); deps.list.mockReturnValueOnce(oldList.promise);
    const pendingList = controller.loadCollections(); controller.selectCollection(secondCollection.id);
    deps.list.mockResolvedValue({ enabled: true, collections: [secondCollection] }); await controller.loadCollections();
    oldList.resolve({ enabled: true, collections: [collection] }); search.resolve(result()); await Promise.all([pendingList, pendingSearch]);
    expect(controller.collectionId.value).toBe(secondCollection.id); expect(controller.response.value).toBeNull(); expect(controller.loading.value).toBe(false);
  });
  it('mismatched returned collection or version cannot be displayed', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); deps.search.mockResolvedValue(result(secondCollection)); await controller.search('合成');
    expect(controller.response.value).toBeNull(); expect(controller.error.value).toContain('集合已变化');
    deps.search.mockResolvedValue(result({ ...collection, releaseVersion: 'new-version' })); await controller.search('合成'); expect(controller.response.value).toBeNull();
  });
  it('unmount disposal prevents late search results, errors and future actions', async () => {
    const { deps, controller } = create(); await controller.loadCollections(); const pending = deferred<KnowledgeSearchResponse>(); deps.search.mockReturnValueOnce(pending.promise);
    const task = controller.search('合成'); controller.dispose(); pending.reject(new Error('late')); await task;
    expect(controller.response.value).toBeNull(); expect(controller.error.value).toBe(''); expect(controller.searching.value).toBe(false);
    await controller.loadCollections(); await controller.search('合成'); expect(deps.list).toHaveBeenCalledTimes(1); expect(deps.search).toHaveBeenCalledTimes(1);
  });
  it('catalog failure is recoverable and late loading cannot change a disposed controller', async () => {
    const { deps, controller } = create(); deps.list.mockRejectedValueOnce(new Error('private')); await controller.loadCollections(); expect(controller.error.value).toContain('暂时无法加载');
    await controller.loadCollections(); expect(controller.error.value).toBe('');
    const pending = deferred<KnowledgeCollectionsResponse>(); deps.list.mockReturnValueOnce(pending.promise); const task = controller.loadCollections(); controller.dispose();
    pending.resolve({ enabled: true, collections: [collection] }); await task; expect(controller.collections.value).toEqual([]); expect(controller.loading.value).toBe(false);
  });
});
