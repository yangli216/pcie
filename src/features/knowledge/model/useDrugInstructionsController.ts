import { computed, onScopeDispose, readonly, shallowRef } from 'vue';
import {
  getDrugInstruction, searchDrugInstructions,
  type DrugInstructionDetail, type DrugInstructionItem, type DrugInstructionSearchRequest,
  type DrugInstructionSearchResponse,
} from '../api/drugInstructions';
import { drugInstructionSections } from '../lib/drugInstructionSections';

interface Dependencies {
  search: (request: DrugInstructionSearchRequest) => Promise<DrugInstructionSearchResponse>;
  detail: (productId: string) => Promise<DrugInstructionDetail>;
}

function errorMessage(reason: unknown, fallback: string): string {
  const error = reason as { code?: string; requestId?: string } | null;
  const message = error?.code === 'DRUG_INSTRUCTIONS_UNAVAILABLE' ? '药品说明书服务暂不可用，请稍后重试或联系管理员。'
    : error?.code === 'DRUG_INSTRUCTION_NOT_FOUND' ? '未找到该药品说明书，请重新检索。' : fallback;
  return error?.requestId ? `${message} 请求ID：${error.requestId}` : message;
}

export function useDrugInstructionsController(dependencies: Dependencies = {
  search: searchDrugInstructions, detail: getDrugInstruction,
}) {
  const response = shallowRef<DrugInstructionSearchResponse | null>(null);
  const detail = shallowRef<DrugInstructionDetail | null>(null);
  const selectedId = shallowRef('');
  const searching = shallowRef(false);
  const loadingDetail = shallowRef(false);
  const searchError = shallowRef('');
  const detailError = shallowRef('');
  const activeKeyword = shallowRef('');
  let searchEpoch = 0, detailEpoch = 0, disposed = false;
  onScopeDispose(() => { disposed = true; searchEpoch += 1; detailEpoch += 1; });

  function clearDetail() {
    detailEpoch += 1;
    detail.value = null;
    selectedId.value = '';
    detailError.value = '';
    loadingDetail.value = false;
  }

  async function search(keyword: string, current = 1) {
    if (disposed) return;
    const text = keyword.trim();
    const token = ++searchEpoch;
    detailEpoch += 1;
    response.value = null;
    detail.value = null;
    selectedId.value = '';
    searchError.value = '';
    detailError.value = '';
    loadingDetail.value = false;
    searching.value = false;
    if (!text || text.length > 128) {
      searchError.value = '请输入不超过128字符的药品名称、通用名或拼音。';
      return;
    }
    activeKeyword.value = text;
    searching.value = true;
    try {
      const result = await dependencies.search({ keyword: text, current, size: 20 });
      if (!disposed && token === searchEpoch) response.value = result;
    } catch (reason) {
      if (!disposed && token === searchEpoch) searchError.value = errorMessage(reason, '药品检索失败，请重试。');
    } finally {
      if (!disposed && token === searchEpoch) searching.value = false;
    }
  }

  async function select(item: DrugInstructionItem) {
    if (disposed) return;
    const token = ++detailEpoch;
    selectedId.value = item.productId;
    detail.value = null;
    detailError.value = '';
    loadingDetail.value = true;
    try {
      const result = await dependencies.detail(item.productId);
      if (disposed || token !== detailEpoch) return;
      if (result.productId !== item.productId) {
        detailError.value = '药品信息不匹配，请重新检索。';
        return;
      }
      detail.value = result;
    } catch (reason) {
      if (!disposed && token === detailEpoch) detailError.value = errorMessage(reason, '用药说明加载失败，请重试。');
    } finally {
      if (!disposed && token === detailEpoch) loadingDetail.value = false;
    }
  }

  function changePage(current: number) {
    if (searching.value || current < 1 || current > 1000) return;
    return search(activeKeyword.value, current);
  }

  function retryDetail() {
    const item = response.value?.records.find(record => record.productId === selectedId.value);
    if (item) return select(item);
  }

  return {
    response: readonly(response), detail: readonly(detail), selectedId: readonly(selectedId),
    searching: readonly(searching), loadingDetail: readonly(loadingDetail),
    searchError: readonly(searchError), detailError: readonly(detailError),
    sections: computed(() => drugInstructionSections(detail.value?.summary ?? '')),
    search, select, changePage, retryDetail, clearDetail,
  };
}
