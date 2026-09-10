import { describe, expect, it } from 'vitest';
import type { Diagnosis, TreatmentRecommendation } from '@/types/consultation';
import {
  buildClinicalResultTreatmentRecommendationsFromRaw,
  mapClinicalResultAiDiagnoses,
} from './clinicalResultAiMapping';

function normalize(rec: Partial<TreatmentRecommendation>): TreatmentRecommendation {
  return {
    type: rec.type || 'medicine',
    name: rec.name || '',
    reason: rec.reason || '',
    ...rec,
  } as TreatmentRecommendation;
}

describe('clinical result AI treatment mapping', () => {
  it('discards model package totals while retaining the clinical target dose', () => {
    const [result] = buildClinicalResultTreatmentRecommendationsFromRaw({
      rawRecommendations: [{
        type: 'medicine',
        name: '盐酸二甲双胍片',
        targetDose: '500',
        targetDoseUnit: 'mg',
        totalQty: '99',
        totalUnit: '瓶',
      }],
      type: 'medicine',
      match: () => ({ matchStatus: 'unmatched' }),
      normalize,
    });

    expect(result).toMatchObject({
      targetDose: '500',
      targetDoseUnit: 'mg',
      totalQty: '',
      totalUnit: '',
      totalManualEdited: false,
    });
  });
});

describe('clinical result AI diagnosis mapping', () => {
  it('keeps a compatible catalog item unbound while preserving the AI diagnosis name', () => {
    const [result] = mapClinicalResultAiDiagnoses({
      rawDiagnoses: [{
        name: '急性胃肠炎',
        code: 'K52.905',
        rate: '85%',
        rationale: '急性腹泻伴呕吐',
      } satisfies Diagnosis],
      assessDiagnosis: () => ({
        status: 'compatible',
        matchedItem: null,
        suggestedMatchItem: { id: 'diag-a09', code: 'A09.901', name: '胃肠炎' },
        alternatives: [],
        reason: '标准项省略急性修饰词',
      }),
      clearUnmatchedId: true,
    });

    expect(result).toMatchObject({
      id: undefined,
      name: '胃肠炎',
      code: 'A09.901',
      originalName: '急性胃肠炎',
      catalogMatchStatus: 'compatible',
      suggestedMatchItem: { id: 'diag-a09' },
    });
  });

  it('does not overwrite the AI diagnosis for a conflict assessment', () => {
    const [result] = mapClinicalResultAiDiagnoses({
      rawDiagnoses: [{
        name: '急性胃肠炎',
        code: 'K52.905',
        rate: '85%',
        rationale: '急性腹泻伴呕吐',
      } satisfies Diagnosis],
      assessDiagnosis: () => ({
        status: 'conflict',
        matchedItem: null,
        suggestedMatchItem: null,
        alternatives: [{ id: 'diag-k52', code: 'K52.909', name: '慢性胃肠炎' }],
        reason: '急慢性冲突',
      }),
      clearUnmatchedId: true,
    });

    expect(result).toMatchObject({
      id: undefined,
      name: '急性胃肠炎',
      code: 'K52.905',
      catalogMatchStatus: 'conflict',
    });
  });
});
