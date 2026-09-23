import { describe, expect, it, vi } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';

vi.mock('@/services/medicalData', () => ({
  medicalDataService: { getAllItems: vi.fn(() => []) },
}));

import {
  buildInstitutionAuxiliaryCatalogContext,
  mapAuxiliaryCatalogRecommendations,
} from './institutionAuxiliaryCatalog';

const normalize = (item: Partial<TreatmentRecommendation>) => item as TreatmentRecommendation;

describe('institutionAuxiliaryCatalog', () => {
  const context = buildInstitutionAuxiliaryCatalogContext([
    { id: 'exam-1', code: 'EX1', name: '胸部正位片', category: '检查' },
    { id: 'lab-1', code: 'LAB1', name: '血常规', category: '检验', jsonField: '{"fgCombination":true}' },
  ]);

  it('builds compact separated catalog references', () => {
    expect(context.promptContext).toContain('E001|胸部正位片');
    expect(context.promptContext).not.toContain('E001|胸部正位片|单项|通用');
    expect(context.promptContext).toContain('L001|血常规|组合');
  });

  it('reads explicit combination fields without serializing the complete vendor payload', () => {
    const toJSON = vi.fn(() => { throw new Error('raw payload must not be serialized'); });
    const rawContext = buildInstitutionAuxiliaryCatalogContext([{
      id: 'lab-raw',
      code: 'LAB-RAW',
      name: '生化项目',
      category: '检验',
      raw: { fgCombination: '1', nestedPayload: { toJSON } },
    }], ['lab_test']);

    expect(rawContext.promptContext).toContain('L001|生化项目|组合');
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('accepts only valid references in the requested category', () => {
    const result = mapAuxiliaryCatalogRecommendations({
      exams: [{
        catalogRef: 'E001',
        reason: '排查肺部感染',
        goal: '明确肺部感染证据',
        goalGroup: '感染病灶评估',
        goalGroupPurpose: '定位感染病灶并评估范围',
        necessity: 'core',
      }],
      labTests: [{ catalogRef: 'E001' }, {
        catalogRef: 'L001',
        reason: '评估感染证据',
        goal: '评估感染及血细胞变化',
        goalGroup: '感染与炎症评估',
        goalGroupPurpose: '判断感染证据并评估炎症程度',
        necessity: 'supplementary',
      }],
    }, context, ['exam', 'lab_test'], normalize);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.matchedItem?.id)).toEqual(['exam-1', 'lab-1']);
    expect(result.every((item) => item.selected === false)).toBe(true);
    expect(result[0]).toMatchObject({
      goal: '明确肺部感染证据',
      goalGroup: '感染病灶评估',
      goalGroupPurpose: '定位感染病灶并评估范围',
      necessity: 'core',
    });
    expect(result[1]?.necessity).toBe('supplementary');
  });

  it('drops catalog-backed responses when clinical purpose metadata is incomplete', () => {
    const result = mapAuxiliaryCatalogRecommendations({
      exams: [{
        catalogRef: 'E001',
        reason: '排查肺部感染',
        goal: '明确肺部感染证据',
        goalGroup: '',
        goalGroupPurpose: '定位感染病灶并评估范围',
        necessity: 'core',
      }],
      labTests: [{
        catalogRef: 'L999',
        reason: '评估感染证据',
        goal: '评估感染',
        goalGroup: '感染评估',
        goalGroupPurpose: '辅助判断感染',
        necessity: 'core',
      }],
    }, context, ['exam', 'lab_test'], normalize);

    expect(result).toEqual([]);
  });

  it('places restricted free-program items behind general items and labels their eligibility constraint', () => {
    const restrictedContext = buildInstitutionAuxiliaryCatalogContext([
      { id: 'free', code: 'FREE', name: '血常规（五分类）（免费）', category: '检验', restricted: true, restrictionReason: '仅适用于特定人群' },
      { id: 'general', code: 'GENERAL', name: '血常规（五分类）', category: '检验' },
    ], ['lab_test'], { includeRestricted: true });

    expect(restrictedContext.entries.map((entry) => entry.item.id)).toEqual(['general', 'free']);
    expect(restrictedContext.promptContext).toContain('L002|血常规（五分类）（免费）|受限：仅适用于特定人群');
  });

  it('excludes restricted items from automatic recommendation unless eligibility is explicit', () => {
    const restrictedContext = buildInstitutionAuxiliaryCatalogContext([
      { id: 'free', code: 'FREE', name: '血常规（五分类）（免费）', category: '检验', restricted: true },
      { id: 'general', code: 'GENERAL', name: '血常规（五分类）', category: '检验' },
    ], ['lab_test']);

    expect(restrictedContext.entries.map((entry) => entry.item.id)).toEqual(['general']);
  });
});
