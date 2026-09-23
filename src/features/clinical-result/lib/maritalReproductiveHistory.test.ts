import { describe, expect, it } from 'vitest';
import { buildMaritalReproductiveHistoryFieldValues, normalizeFemaleHistoryText } from './maritalReproductiveHistory';

describe('marital reproductive history PHIS dictionary mapping', () => {
  it.each([
    ['未婚未育', '1'], ['已婚未育', '2'], ['已婚已育', '3'], ['未婚已育', '4'], ['离异', '5'],
  ])('maps only the explicit status %s', (text, code) => {
    expect(buildMaritalReproductiveHistoryFieldValues(`${text}；目前未孕；孕2产1`)).toEqual({ 婚育状况: code, 怀孕标志: '0' });
  });

  it.each(['已婚', '已育', '孕2产1', '去年怀孕', '已绝经', '月经规律', '可能怀孕', '否认未孕', '{怀孕标志}怀孕'])('does not infer status from %s', (text) => {
    expect(buildMaritalReproductiveHistoryFieldValues(text)).toEqual({});
  });

  it('preserves positive pregnancy and omits conflicting status', () => {
    expect(buildMaritalReproductiveHistoryFieldValues('已婚未育；目前妊娠12周')).toEqual({ 婚育状况: '2', 怀孕标志: '1' });
    expect(buildMaritalReproductiveHistoryFieldValues('未孕；已孕；已婚已育；离异')).toEqual({});
  });

  it('drops unfilled template slots without manufacturing pregnancy', () => {
    expect(normalizeFemaleHistoryText('{婚育状况}，{怀孕标志}怀孕，{其他}')).toBe('');
    expect(normalizeFemaleHistoryText('已婚已育，{怀孕标志}怀孕，{其他}')).toBe('已婚已育');
    expect(normalizeFemaleHistoryText('周期28天，经期5天。')).toBe('周期28天，经期5天。');
  });
});
