import { computed, readonly, shallowRef } from 'vue';
import {
  listKnowledgeCollections, searchKnowledge,
  type KnowledgeCollection, type KnowledgeCollectionsResponse,
  type KnowledgeSearchRequest, type KnowledgeSearchResponse,
} from '../api/knowledgeRetrieval';

export interface InstitutionKnowledgeDependencies {
  list: () => Promise<KnowledgeCollectionsResponse>;
  search: (request: KnowledgeSearchRequest) => Promise<KnowledgeSearchResponse>;
}

export function useInstitutionKnowledgeController(dependencies: InstitutionKnowledgeDependencies = {
  list: listKnowledgeCollections, search: searchKnowledge,
}) {
  const collections = shallowRef<KnowledgeCollection[]>([]);
  const collectionId = shallowRef('');
  const enabled = shallowRef(false);
  const loading = shallowRef(false);
  const searching = shallowRef(false);
  const error = shallowRef('');
  const response = shallowRef<KnowledgeSearchResponse | null>(null);
  const selectedCollection = computed(() => collections.value.find(item => item.id === collectionId.value));
  const canSearch = computed(() => enabled.value && !!selectedCollection.value && !loading.value && !searching.value);
  let epoch = 0;
  let disposed = false;

  function invalidate() {
    epoch += 1;
    searching.value = false;
    response.value = null;
    error.value = '';
  }

  function selectCollection(id: string) {
    if (disposed || loading.value) return;
    invalidate();
    collectionId.value = collections.value.some(item => item.id === id) ? id : '';
  }

  async function loadCollections() {
    if (disposed) return;
    invalidate();
    const token = epoch;
    loading.value = true;
    enabled.value = false;
    collections.value = [];
    try {
      const result = await dependencies.list();
      if (disposed || token !== epoch) return;
      enabled.value = result.enabled;
      collections.value = result.enabled ? result.collections : [];
      if (!collections.value.some(item => item.id === collectionId.value)) collectionId.value = collections.value[0]?.id ?? '';
    } catch {
      if (!disposed && token === epoch) error.value = '知识集合暂时无法加载，请重试或联系管理员。';
    } finally {
      if (!disposed && token === epoch) loading.value = false;
    }
  }

  async function search(query: string) {
    if (disposed || !canSearch.value || !selectedCollection.value) return;
    const text = query.trim();
    if (!text || query.length > 2000) {
      error.value = '请输入不超过2000字符的检索内容。';
      return;
    }
    invalidate();
    const token = epoch, collection = selectedCollection.value;
    searching.value = true;
    try {
      const result = await dependencies.search({ collectionId: collection.id, releaseVersion: collection.releaseVersion, query: text, limit: 5 });
      if (disposed || token !== epoch) return;
      if (result.collection.id !== collection.id || result.collection.releaseVersion !== collection.releaseVersion) {
        error.value = '知识集合已变化，请刷新后重新检索。';
        return;
      }
      response.value = result;
    } catch (reason) {
      if (disposed || token !== epoch) return;
      const code = reason && typeof reason === 'object' && 'code' in reason ? String(reason.code) : '';
      const messages: Record<string, string> = {
        KNOWLEDGE_NOT_READY: '当前机构尚无可用的已批准资料，请联系管理员。',
        KNOWLEDGE_VERSION_CHANGED: '知识版本已更新，请刷新集合后重新检索。',
        KNOWLEDGE_CONTENT_CHANGED: '知识资料内容已变化，请联系管理员核对并发布新版本。',
      };
      error.value = messages[code] ?? '知识检索暂时失败，请重试或联系管理员。';
    } finally {
      if (!disposed && token === epoch) searching.value = false;
    }
  }

  function dispose() {
    disposed = true;
    invalidate();
    loading.value = false;
  }

  return {
    collections: readonly(collections), collectionId: readonly(collectionId), enabled: readonly(enabled),
    loading: readonly(loading), searching: readonly(searching), error: readonly(error), response: readonly(response),
    selectedCollection, canSearch, loadCollections, selectCollection, search, dispose,
  };
}
