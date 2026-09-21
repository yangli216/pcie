import { describe, expect, it } from 'vitest';
import { assessDiagnosisCatalogMatch, type DiagnosisCatalogCandidate } from './diagnosisCatalogMatch';

function item(name: string, code: string): DiagnosisCatalogCandidate {
  return { id: `id-${code}`, name, code };
}

describe('assessDiagnosisCatalogMatch', () => {
  it('prefers a generic compatible item and excludes an acute/chronic conflict despite ICD affinity', () => {
    const result = assessDiagnosisCatalogMatch({
      queryName: '急性胃肠炎',
      icdCode: 'K52.905',
      catalog: [
        item('胃肠炎', 'A09.901'),
        item('慢性胃肠炎', 'K52.909'),
        item('急性胃炎', 'K29.701'),
        item('急性肠炎', 'K52.902'),
      ],
    });

    expect(result.status).toBe('compatible');
    expect(result.matchedItem).toBeNull();
    expect(result.suggestedMatchItem?.name).toBe('胃肠炎');
    expect(result.alternatives.map((candidate) => candidate.name)).toContain('急性胃炎');
    expect(result.alternatives.map((candidate) => candidate.name)).toContain('急性肠炎');
  });

  it('returns an exact diagnosis when the acute catalog entry exists', () => {
    const result = assessDiagnosisCatalogMatch({
      queryName: '急性胃肠炎',
      icdCode: 'K52.905',
      catalog: [item('急性胃肠炎', 'K52.905'), item('慢性胃肠炎', 'K52.909')],
    });

    expect(result.status).toBe('exact');
    expect(result.matchedItem?.name).toBe('急性胃肠炎');
  });

  it.each([
    ['急性胃肠炎', '慢性胃肠炎'],
    ['左侧膝关节炎', '右侧膝关节炎'],
    ['双侧结膜炎', '左侧结膜炎'],
    ['1型糖尿病', '2型糖尿病'],
    ['原发性高血压', '继发性高血压'],
  ])('hard rejects conflicting modifiers: %s -> %s', (queryName, targetName) => {
    const result = assessDiagnosisCatalogMatch({
      queryName,
      catalog: [item(targetName, 'K00.001')],
    });

    expect(result.status).toBe('conflict');
    expect(result.matchedItem).toBeNull();
    expect(result.suggestedMatchItem).toBeNull();
  });

  it('does not narrow a neutral diagnosis to an acute or chronic item', () => {
    const result = assessDiagnosisCatalogMatch({
      queryName: '胃肠炎',
      catalog: [item('慢性胃肠炎', 'K52.909'), item('急性胃肠炎', 'K52.905')],
    });

    expect(result.status).toBe('ambiguous');
    expect(result.matchedItem).toBeNull();
  });

  it('does not let an exact but semantically conflicting AI code overwrite the AI name', () => {
    const result = assessDiagnosisCatalogMatch({
      queryName: '急性胃肠炎',
      icdCode: 'K52.909',
      catalog: [item('慢性胃肠炎', 'K52.909'), item('胃肠炎', 'A09.901')],
    });

    expect(result.status).toBe('compatible');
    expect(result.suggestedMatchItem?.name).toBe('胃肠炎');
  });

  it('does not treat anatomy narrowing as a compatible match', () => {
    const result = assessDiagnosisCatalogMatch({
      queryName: '急性胃肠炎',
      catalog: [item('急性胃炎', 'K29.701'), item('急性肠炎', 'K52.902')],
    });

    expect(result.status).toBe('ambiguous');
    expect(result.suggestedMatchItem).toBeNull();
  });
});

describe('diagnosis catalog performance regressions', () => {
  it('finds exact names in a 34,846-row catalog without reading fuzzy keywords', () => {
    const catalog = Array.from({ length: 34_846 }, (_, index) => ({
      id: String(index), code: `Z${index}`, name: `目录条目${index}`,
      get keywords(): string[] { throw new Error('Exact matches must not score fuzzy keywords'); },
    }));
    catalog[catalog.length - 1].name = '急性上呼吸道感染';
    const result = assessDiagnosisCatalogMatch({ queryName: ' 急性 上呼吸道感染 ', catalog });
    expect(result.matchedItem).toBe(catalog[catalog.length - 1]);
    expect(result.status).toBe('exact');
  });

  it('preserves ICD affinity and stable catalog order for duplicate exact names', () => {
    const catalog = [item('胃肠炎', 'K52.1'), item('胃肠炎', 'A09.1'), item('胃肠炎', 'A09.2')];
    expect(assessDiagnosisCatalogMatch({ queryName: '胃肠炎', icdCode: 'A09.9', catalog }).matchedItem).toBe(catalog[1]);
    expect(assessDiagnosisCatalogMatch({ queryName: '胃肠炎', catalog }).matchedItem).toBe(catalog[0]);
    expect(assessDiagnosisCatalogMatch({ queryName: ' a09.2 ', catalog }).matchedItem).toBe(catalog[2]);
  });

  it('keeps only the best five compatible candidates, including late ICD matches', () => {
    const catalog = Array.from({ length: 12 }, (_, index) => item('胃肠炎', `K52.${index}`));
    catalog.push(item('胃肠炎', 'A09.1'));
    const result = assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', icdCode: 'A09.9', catalog });
    expect(result.status).toBe('ambiguous');
    expect(result.alternatives).toEqual([catalog[12], ...catalog.slice(0, 4)]);
  });

  it('preserves keyword scoring, Chinese tie order and conflict exclusion', () => {
    const catalog = ['丙', '乙', '丁', '甲', '戊', '己', '庚'].map((name, i) => ({
      ...item(name, `A09.${i}`), keywords: ['急性胃肠炎'],
    }));
    const conflict = { ...item('慢性胃肠炎', 'A09.9'), keywords: ['急性胃肠炎'] };
    const result = assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog: [...catalog, conflict] });
    expect(result.status).toBe('ambiguous');
    expect(result.alternatives).toEqual([...catalog].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).slice(0, 5));
  });

  it('refreshes prepared semantics after name edits and reads current code/keywords', () => {
    const candidate = { ...item('胃肠炎', 'A09.1'), keywords: [] as string[] };
    const catalog = [candidate];
    expect(assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog }).status).toBe('compatible');
    candidate.name = '慢性胃肠炎';
    expect(assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog }).status).toBe('conflict');
    candidate.name = '急性胃肠炎';
    expect(assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog }).matchedItem).toBe(candidate);
    candidate.name = '其他疾病';
    candidate.keywords.push('急性胃肠炎');
    candidate.code = 'K52.9';
    expect(assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog }).alternatives).toEqual([candidate]);
    expect(assessDiagnosisCatalogMatch({ queryName: 'K52.9', catalog }).matchedItem).toBe(candidate);
    expect(assessDiagnosisCatalogMatch({ queryName: '急性胃肠炎', catalog: [] }).status).toBe('unmatched');
  });
});
