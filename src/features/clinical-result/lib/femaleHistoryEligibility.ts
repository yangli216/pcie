export const FEMALE_HISTORY_MIN_AGE_YEARS = 14;
export const FEMALE_HISTORY_MAX_AGE_YEARS_EXCLUSIVE = 60;

export interface FemaleHistoryEligibilityInput {
  gender?: unknown;
  ageText?: unknown;
  ageYears?: unknown;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isFemaleGender(value: unknown): boolean {
  const normalized = normalizeText(value).toLowerCase();
  return normalized === 'f'
    || normalized === '2'
    || normalized === 'female'
    || normalized.startsWith('女');
}

export function resolveFemaleHistoryAgeYears(input: Pick<FemaleHistoryEligibilityInput, 'ageText' | 'ageYears'>): number | undefined {
  const ageText = normalizeText(input.ageText);
  const explicitYear = ageText.match(/(\d+(?:\.\d+)?)\s*(?:周?岁)/u);
  if (explicitYear) {
    const value = Number(explicitYear[1]);
    return Number.isFinite(value) ? value : undefined;
  }

  // 完整年龄文本声明月龄/日龄时，不能把同名数值字段误当作周岁。
  if (/(?:个?月|天|日)/u.test(ageText)) return undefined;

  const normalizedAgeYears = normalizeText(input.ageYears);
  if (!normalizedAgeYears) return undefined;
  const ageYears = Number(normalizedAgeYears);
  return Number.isFinite(ageYears) ? ageYears : undefined;
}

export function isFemaleHistoryEligible(input: FemaleHistoryEligibilityInput): boolean {
  if (!isFemaleGender(input.gender)) return false;
  const ageYears = resolveFemaleHistoryAgeYears(input);
  return ageYears !== undefined
    && ageYears >= FEMALE_HISTORY_MIN_AGE_YEARS
    && ageYears < FEMALE_HISTORY_MAX_AGE_YEARS_EXCLUSIVE;
}
