import type { KnowledgeCollection, KnowledgeSearchRequest } from '../../src/features/knowledge/api/knowledgeRetrieval';

const collection: KnowledgeCollection = {
  id: 'synthetic', name: '工程接入验证资料（合成）', releaseVersion: 'synthetic-v1',
  retrievalVersion: 'weknora-v0.8.2-synthetic', documentCount: 1,
};

export async function regionalGet(path: string) {
  if (path !== '/v1/knowledge/collections') throw new Error('Unexpected preview request');
  return { enabled: true, collections: [collection] };
}

export async function regionalPost(path: string, request: KnowledgeSearchRequest) {
  if (path !== '/v1/knowledge/search') throw new Error('Unexpected preview request');
  await new Promise(resolve => setTimeout(resolve, 250));
  if (request.query === '失败') throw { code: 'KNOWLEDGE_UPSTREAM_UNAVAILABLE' };
  if (request.query === '内容变化') throw { code: 'KNOWLEDGE_CONTENT_CHANGED' };
  return {
    provider: 'weknora', collection, query: request.query, manifestSha256: 'a'.repeat(64),
    retrievedAt: new Date().toISOString(), results: request.query === '零命中' ? [] : [{
      chunkId: 'SYNTHETIC-CHUNK', sourceId: 'SYNTHETIC-SOURCE', title: '合成工程资料',
      sourceVersion: 'source-v1', contentSha256: 'b'.repeat(64), score: 0.9, matchType: 'vector',
      content: '用于验证知识库检索契约。\n此处为合成资料，不构成医学意见。',
    }],
  };
}
