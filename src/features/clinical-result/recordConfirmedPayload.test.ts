import { describe, expect, it } from 'vitest';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import {
  buildOrderListItem,
  getOrderServiceCode,
  getStandardDiagnosisId,
  type OrderItemResolvers,
} from './recordConfirmedPayload';

const resolvers: OrderItemResolvers = {
  getServiceCode: (item) => item.matchedItem?.sdSrv || '',
  getServiceId: (item) => item.matchedItem?.id || '',
  getServiceName: (item) => item.matchedItem?.name || item.name,
  getExecDeptId: () => 'DEPT-1',
  getPartId: () => 'PART-1',
  getJsonField: () => '{"fgCombination":"1"}',
};

describe('record confirmed medicine service code', () => {
  it('uses hydrated sdMed=2 over a stale cached medicine sdSrv=11', () => {
    const item = {
      type: 'medicine',
      name: '速效救心丸',
      reason: '对症治疗',
      matchedItem: {
        id: 'MED-1',
        name: '速效救心丸',
        sdSrv: '11',
        raw: { sdMed: '2' },
      },
    } satisfies TreatmentRecommendation;

    expect(getOrderServiceCode(item)).toBe('12');
    expect(buildOrderListItem(item, {
      ...resolvers,
      getServiceCode: getOrderServiceCode,
    })).toHaveProperty('sdSrv', '12');
  });

  it('keeps the compatibility default when no medicine classification is available', () => {
    const item = {
      type: 'medicine',
      name: '未分类药品',
      reason: '对症治疗',
      matchedItem: { id: 'MED-2', name: '未分类药品' },
    } satisfies TreatmentRecommendation;

    expect(getOrderServiceCode(item)).toBe('11');
  });
});

describe('record confirmed mutual recognition code', () => {
  it('keeps the live lab jsonField including idLisCategory in orderList', () => {
    const item = {
      type: 'lab_test',
      name: '血常规',
      reason: '辅助判断感染',
      matchedItem: {
        id: 'LAB-1',
        name: '血常规',
        sdSrv: '41',
        jsonField: '{"idLisCategory":"LIS-CATEGORY-1","fgCombination":"1"}',
      },
    } satisfies TreatmentRecommendation;
    const liveCatalogResolvers: OrderItemResolvers = {
      ...resolvers,
      getJsonField: (recommendation) => recommendation.matchedItem?.jsonField || '',
    };

    expect(buildOrderListItem(item, liveCatalogResolvers)).toMatchObject({
      idSrv: 'LAB-1',
      sdSrv: '41',
      jsonField: '{"idLisCategory":"LIS-CATEGORY-1","fgCombination":"1"}',
    });
  });

  it('keeps the code for examination and lab items', () => {
    const item = {
      type: 'lab_test',
      name: '血常规',
      reason: '辅助判断感染',
      matchedItem: {
        id: 'LAB-1',
        name: '血常规',
        sdSrv: '41',
        raw: { mutualRecognitionCode: 'B32R1WZZZ-00' },
      },
    } satisfies TreatmentRecommendation;

    expect(buildOrderListItem(item, resolvers)).toMatchObject({
      idSrv: 'LAB-1',
      sdSrv: '41',
      mutualRecognitionCode: 'B32R1WZZZ-00',
    });
  });

  it('writes an empty string when a check item does not participate in recognition', () => {
    const item = {
      type: 'exam',
      name: '胸部CT',
      reason: '辅助判断',
      matchedItem: { id: 'EXAM-1', name: '胸部CT', sdSrv: '31' },
    } satisfies TreatmentRecommendation;

    expect(buildOrderListItem(item, resolvers)).toHaveProperty('mutualRecognitionCode', '');
  });

  it('does not add the field to procedure items', () => {
    const item = {
      type: 'procedure',
      name: '雾化吸入',
      reason: '对症处理',
      totalQty: '1',
      matchedItem: { id: 'PROC-1', name: '雾化吸入', sdSrv: '21' },
    } satisfies TreatmentRecommendation;

    expect(buildOrderListItem(item, resolvers)).not.toHaveProperty('mutualRecognitionCode');
  });
});

describe('record confirmed diagnosis catalog guard', () => {
  it('does not treat a stale id on a compatible diagnosis as a standard diagnosis id', () => {
    const diagnosis = {
      id: 'stale-ai-id',
      code: 'A09.901',
      name: '胃肠炎',
      rate: '高置信',
      rationale: '',
      catalogMatchStatus: 'compatible',
      suggestedMatchItem: { id: 'diag-a09', code: 'A09.901', name: '胃肠炎' },
    } satisfies Diagnosis;

    expect(getStandardDiagnosisId(diagnosis)).toBe('');
  });
});
