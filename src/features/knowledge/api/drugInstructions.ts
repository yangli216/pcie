import { regionalGet, regionalPost } from '@services/regionalClient';

export interface DrugInstructionItem {
  productId: string;
  productName: string;
  genericName: string;
  drugSpec: string;
  producer: string;
  drugForm: string;
  category: string;
}

export interface DrugInstructionDetail extends DrugInstructionItem {
  summary: string;
  createDate: string;
}

export interface DrugInstructionSearchRequest {
  keyword: string;
  current?: number;
  size?: number;
}

export interface DrugInstructionSearchResponse {
  current: number;
  size: number;
  hasMore: boolean;
  records: DrugInstructionItem[];
}

export function searchDrugInstructions(request: DrugInstructionSearchRequest): Promise<DrugInstructionSearchResponse> {
  return regionalPost('/v1/knowledge/drug-instructions/search', {
    keyword: request.keyword,
    current: request.current ?? 1,
    size: request.size ?? 20,
  });
}

export function getDrugInstruction(productId: string): Promise<DrugInstructionDetail> {
  return regionalGet(`/v1/knowledge/drug-instructions/${encodeURIComponent(productId)}`);
}
