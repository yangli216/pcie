import type { KnowledgeCollection, KnowledgeSearchResponse } from '../api/knowledgeRetrieval';

export const collection: KnowledgeCollection = {
  id: 'synthetic', name: '合成资料集', releaseVersion: 'synthetic-v1',
  retrievalVersion: 'weknora-v0.8.2-synthetic', documentCount: 1,
};
export const secondCollection: KnowledgeCollection = { ...collection, id: 'second', name: '第二资料集' };
export function result(selected = collection, content = '合成工程资料，非医学结论。'): KnowledgeSearchResponse {
  return {
    provider: 'weknora', collection: selected, query: '合成资料', manifestSha256: 'a'.repeat(64),
    retrievedAt: '2026-09-30T00:00:00Z', results: [{ chunkId: 'SYNTHETIC-CHUNK', sourceId: 'SYNTHETIC-SOURCE',
      title: '合成工程资料', sourceVersion: 'source-v1', contentSha256: 'b'.repeat(64), content, score: 0.9, matchType: 'vector' }],
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
