import { describe, expect, it, vi } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';
import {
  hasClinicalResultTreatmentState,
  initClinicalDiagnoses,
  initClinicalTreatments,
} from './clinicalResultInitialization';

describe('clinicalResultInitialization', () => {
  it('preserves voice diagnosis evidence scope in editor snapshots', () => {
    const [result] = initClinicalDiagnoses([{
      name: '原发性高血压',
      evidenceText: '既往有高血压，本次测得血压180/110mmHg',
      clinicalRole: 'current_diagnosis',
      diagnosisKind: 'disease',
      evidenceScope: 'both',
      currentVisitEvidenceText: '本次测得血压180/110mmHg',
      confidence: 'high',
      suggestionType: 'formal',
      matchedItem: {
        id: 'diag-i10',
        code: 'I10.x00',
        name: '原发性高血压',
      },
    }], {
      buildRationale: () => '本次就诊证据充分',
    });

    expect(result).toMatchObject({
      id: 'diag-i10',
      clinicalRole: 'current_diagnosis',
      diagnosisKind: 'disease',
      evidenceScope: 'both',
      currentVisitEvidenceText: '本次测得血压180/110mmHg',
      suggestionType: 'formal',
    });
  });

  it('initializes a compatible diagnosis with the standard candidate visible but unbound', () => {
    const [result] = initClinicalDiagnoses([{
      name: '急性胃肠炎',
      code: 'K52.905',
      confidence: 'high',
      matchedItem: null,
      suggestedMatchItem: { id: 'diag-a09', code: 'A09.901', name: '胃肠炎' },
      catalogMatchStatus: 'compatible',
      catalogMatchReason: '标准项省略急性修饰词',
    }], {
      buildRationale: () => '急性腹泻伴呕吐',
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

  it('preserves an upstream contextual catalog match and its visible metadata', () => {
    const item = {
      type: 'examination' as const,
      name: 'B超',
      sourceType: 'explicit' as const,
      evidenceText: '医生：给你做个B超检查',
      reason: '医生提出B超；结合上腹部不适补全为腹部彩超',
      goal: '评估上腹部不适相关脏器情况',
      goalGroup: '腹部影像评估',
      goalGroupPurpose: '结合上腹部症状定位腹部病变线索',
      necessity: 'core' as const,
      selected: false,
      matchStatus: 'exact' as const,
      matchedItem: {
        id: 'exam-1',
        code: 'E1',
        name: '肝胆胰脾肾彩超',
      },
    };
    const assessCatalogMatch = vi.fn();

    expect(hasClinicalResultTreatmentState(item)).toBe(true);
    const [result] = initClinicalTreatments([item], {
      assessCatalogMatch,
      inferFrequency: () => '',
      inferRoute: () => '',
      normalize: (recommendation) => recommendation as TreatmentRecommendation,
      buildReason: () => '不应重建',
      shouldAutoSelect: () => true,
    });

    expect(assessCatalogMatch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      type: 'exam',
      name: '肝胆胰脾肾彩超',
      originalName: 'B超',
      sourceType: 'explicit',
      evidenceText: '医生：给你做个B超检查',
      reason: '医生提出B超；结合上腹部不适补全为腹部彩超',
      goal: '评估上腹部不适相关脏器情况',
      goalGroup: '腹部影像评估',
      goalGroupPurpose: '结合上腹部症状定位腹部病变线索',
      necessity: 'core',
      selected: false,
      matchStatus: 'exact',
      matchedItem: { id: 'exam-1' },
    });
  });
});
