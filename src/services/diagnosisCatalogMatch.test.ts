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
