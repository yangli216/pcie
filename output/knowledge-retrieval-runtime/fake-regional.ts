import type { KnowledgeCollection, KnowledgeSearchRequest } from '../../src/features/knowledge/api/knowledgeRetrieval';
import type { DrugInstructionSearchRequest } from '../../src/features/knowledge/api/drugInstructions';

const collection: KnowledgeCollection = {
  id: 'synthetic', name: '工程接入验证资料（合成）', releaseVersion: 'synthetic-v1',
  retrievalVersion: 'weknora-v0.8.2-synthetic', documentCount: 1,
};

export async function regionalGet(path: string) {
  if (path.startsWith('/v1/knowledge/drug-instructions/')) {
    const id = path.split('/').pop();
    return { ...drugs.find(item => item.productId === id), summary: '【药品名称】\r\n合成药品，仅用于工程预览\r\n【用法用量】\r\n此处是合成说明文字，不构成医学建议。\r\n【禁忌】\r\n合成测试章节，请勿用于临床。\r\n【注意事项】\r\n' + '用于检查长文换行、滚动和章节跳转的合成内容。'.repeat(30), createDate: '' };
  }
  if (path !== '/v1/knowledge/collections') throw new Error('Unexpected preview request');
  return { enabled: true, collections: [collection] };
}

export async function regionalPost(path: string, request: KnowledgeSearchRequest | DrugInstructionSearchRequest) {
  if (path === '/v1/knowledge/drug-instructions/search') {
    const query = request as DrugInstructionSearchRequest;
    if (query.keyword === '失败') throw { code: 'DRUG_INSTRUCTIONS_UNAVAILABLE' };
    return { current: query.current, size: query.size, hasMore: false, records: query.keyword === '零命中' ? [] : drugs };
  }
  if (path !== '/v1/knowledge/search') throw new Error('Unexpected preview request');
  const query = request as KnowledgeSearchRequest;
  await new Promise(resolve => setTimeout(resolve, 250));
  if (query.query === '失败') throw { code: 'KNOWLEDGE_UPSTREAM_UNAVAILABLE' };
  if (query.query === '内容变化') throw { code: 'KNOWLEDGE_CONTENT_CHANGED' };
  return {
    provider: 'weknora', collection, query: query.query, manifestSha256: 'a'.repeat(64),
    retrievedAt: new Date().toISOString(), results: query.query === '零命中' ? [] : [{
      chunkId: 'SYNTHETIC-CHUNK', sourceId: 'SYNTHETIC-SOURCE', title: '合成工程资料',
      sourceVersion: 'source-v1', contentSha256: 'b'.repeat(64), score: 0.9, matchType: 'vector',
      content: '用于验证知识库检索契约。\n此处为合成资料，不构成医学意见。',
    }],
  };
}

const drugs = [
  { productId: 'synthetic-A', productName: '合成药品（工程预览）', genericName: '', drugSpec: '合成规格甲', producer: '合成厂家甲', drugForm: '合成剂型', category: '' },
  { productId: 'synthetic-B', productName: '合成药品（工程预览）', genericName: '', drugSpec: '合成规格乙', producer: '合成厂家乙', drugForm: '合成剂型', category: '' },
];
