import { regionalGet, regionalPost } from '@services/regionalClient';

export interface KnowledgeCollection {
  id: string;
  name: string;
  releaseVersion: string;
  retrievalVersion: string;
  documentCount: number;
}

export interface KnowledgeCollectionsResponse {
  enabled: boolean;
  collections: KnowledgeCollection[];
}

export interface KnowledgeEvidence {
  chunkId: string;
  sourceId: string;
  title: string;
  sourceVersion: string;
  contentSha256: string;
  content: string;
  score: number;
  matchType: string;
}

export interface KnowledgeSearchRequest {
  collectionId: string;
  query: string;
  releaseVersion: string;
  limit?: number;
}

export interface KnowledgeSearchResponse {
  provider: 'weknora';
  collection: KnowledgeCollection;
  query: string;
  manifestSha256: string;
  retrievedAt: string;
  results: KnowledgeEvidence[];
}

export function listKnowledgeCollections(): Promise<KnowledgeCollectionsResponse> {
  return regionalGet('/v1/knowledge/collections');
}

export function searchKnowledge(request: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
  // Build the declared contract explicitly; caller objects cannot forward credentials or scope fields.
  return regionalPost('/v1/knowledge/search', {
    collectionId: request.collectionId,
    query: request.query,
    releaseVersion: request.releaseVersion,
    limit: request.limit ?? 5,
  });
}
