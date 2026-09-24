import { describe, expect, it } from 'vitest';
import {
  isFemaleHistoryEligible,
  resolveFemaleHistoryAgeYears,
} from './femaleHistoryEligibility';

describe('female history eligibility', () => {
  it.each([
    ['13岁', false],
    ['14岁', true],
    ['59岁', true],
    ['59岁11个月', true],
    ['60岁', false],
  ])('applies the inclusive 14 and exclusive 60 boundary for %s', (ageText, expected) => {
    expect(isFemaleHistoryEligible({ gender: '女性', ageText })).toBe(expected);
  });

  it('rejects male, month-age, day-age and unknown-age patients', () => {
    expect(isFemaleHistoryEligible({ gender: '男性', ageText: '30岁' })).toBe(false);
    expect(isFemaleHistoryEligible({ gender: '女性', ageText: '10个月', ageYears: 10 })).toBe(false);
    expect(isFemaleHistoryEligible({ gender: 'F', ageText: '20天', ageYears: 20 })).toBe(false);
    expect(isFemaleHistoryEligible({ gender: '女性' })).toBe(false);
  });

  it('uses an explicit numeric ageYears only when ageText does not declare another unit', () => {
    expect(isFemaleHistoryEligible({ gender: 'F', ageYears: 14 })).toBe(true);
    expect(isFemaleHistoryEligible({ gender: '2', ageYears: 59 })).toBe(true);
    expect(isFemaleHistoryEligible({ gender: 'female', ageYears: 60 })).toBe(false);
    expect(resolveFemaleHistoryAgeYears({ ageText: '10个月', ageYears: 35 })).toBeUndefined();
    expect(resolveFemaleHistoryAgeYears({})).toBeUndefined();
  });
});
