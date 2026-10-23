import { describe, expect, it } from 'vitest';
import type { MedicalItem } from '@/services/medicalData';
import { matchChronicExaminationCatalog as match } from './chronicExaminationCatalogMatch';
const single = (name: string, patch: Partial<MedicalItem> = {}): MedicalItem => ({
  id: 'live-id', code: 'live-code', idSrv: 'live-srv', name, category: '检验',
  jsonField: '{"fgCombination":"0","idLisCategory":"live-lis"}', ...patch,
});
const recommendation = (name: string, subItems: string[] = []) => ({ name, subItems });

describe('approved chronic examination full-name relationships', () => {
  it.each([
    ['糖化血红蛋白', '糖化血红蛋白测定', '检验'],
    ['同型半胱氨酸', '血同型半胱氨酸测定', '检验'],
    ['心电图', '常规心电图检查', '检查'],
    ['常规心电图', '常规心电图检查费', '检查'],
  ])('matches %s to only the unique current live %s', (source, target, category) => {
    const item = single(target, { category, idPart: category === '检查' ? 'live-part' : '' });
    expect(match(recommendation(source), [item])).toEqual({ status: 'matched', item });
    expect(match(recommendation(source), [])).toEqual({ status: 'unmatched' });
    expect(match(recommendation(source), [single('unrelated', { id: 'another-org' })])).toEqual({ status: 'unmatched' });
  });
  it('checks original name and aliases together instead of choosing the exact-name first', () => {
    expect(match(recommendation('糖化血红蛋白'), [single('糖化血红蛋白'), single('糖化血红蛋白测定', { id: 'other' })]))
      .toMatchObject({ status: 'ambiguous', issue: 'multiple_items' });
    expect(match(recommendation('同型半胱氨酸'), [single('同型半胱氨酸', { jsonField: '{"fgCombination":"2"}' }), single('血同型半胱氨酸测定')]))
      .toMatchObject({ status: 'ambiguous', issue: 'multiple_items' });
  });
  it.each(['1', '2', 'unknown', null, true])('does not resolve an unverified group flag %s', flag => {
    expect(match(recommendation('糖化血红蛋白'), [single('糖化血红蛋白测定', { jsonField: JSON.stringify({ fgCombination: flag }) })]))
      .toMatchObject({ status: 'ambiguous', issue: 'unverified_group' });
  });
  it('requires explicit non-group metadata for approved lab names and rejects conflicting/malformed metadata', () => {
    for (const patch of [
      { jsonField: '' }, { jsonField: 'broken-json' }, { jsonField: '[]' },
      { raw: { fgCombination: '2' } }, { raw: { jsonField: '{"fgCombination":"1"}' } },
      { raw: { fgCombinationText: '组套' } },
    ]) expect(match(recommendation('同型半胱氨酸'), [single('血同型半胱氨酸测定', patch)]))
      .toMatchObject({ status: 'ambiguous', issue: 'unverified_group' });
    expect(match(recommendation('同型半胱氨酸'), [single('血同型半胱氨酸测定', { jsonField: '', raw: { fgCombination: false } })]).status).toBe('matched');
  });
  it('does not discard unresolved or decorated parts to manufacture uniqueness', () => {
    const item = single('常规心电图检查', { category: '检查' });
    expect(match(recommendation('心电图'), [{ ...item, raw: { fgPart: '1' } }]))
      .toMatchObject({ status: 'ambiguous', issue: 'unverified_part' });
    expect(match(recommendation('心电图'), [{ ...item, idPart: 'p1', raw: { idPart: 'p2' } }]).status).toBe('ambiguous');
    expect(match(recommendation('心电图'), [item, { ...item, id: 'part', idPart: 'p', name: '常规心电图检查（扩展）', naSrv: item.name }]))
      .toMatchObject({ status: 'ambiguous', issue: 'multiple_items' });
    expect(match(recommendation('心电图'), [{ ...item, name: '常规心电图检查（扩展）', naSrv: item.name }]).status).toBe('ambiguous');
  });
  it('rejects wrong categories, restricted items, unapproved qualifiers and recommendation sub-items outside the concept', () => {
    expect(match(recommendation('糖化血红蛋白'), [single('糖化血红蛋白测定', { category: '检查' })]).status).toBe('unmatched');
    expect(match(recommendation('糖化血红蛋白'), [single('糖化血红蛋白测定', { restricted: true })]).status).toBe('unmatched');
    for (const name of ['糖化血红蛋白测定（生育）', '(POCT)糖化血红蛋白测定', '糖化血红蛋白（免费）']) {
      expect(match(recommendation('糖化血红蛋白'), [single(name)]).status).toBe('unmatched');
    }
    for (const name of ['动态心电图', '24小时动态心电图', '常规心电图检查费-频谱心电图（扩展）']) {
      expect(match(recommendation('心电图'), [single(name, { category: '检查' })]).status).toBe('unmatched');
    }
    expect(match(recommendation('糖化血红蛋白', ['糖化血红蛋白', '血糖']), [single('糖化血红蛋白测定')]).status).toBe('ambiguous');
  });
  it('keeps all other recommendations on exact full names, never adding general fuzzy or insurance-code matching', () => {
    expect(match(recommendation('血脂'), [single('血脂四项')]).status).toBe('unmatched');
    expect(match(recommendation('尿肾功能'), [single('尿微量白蛋白测定')]).status).toBe('unmatched');
    expect(match(recommendation('颈动脉B超'), [single('彩色多普勒超声检查', { category: '检查', idPart: 'neck' })]).status).toBe('unmatched');
  });
});
