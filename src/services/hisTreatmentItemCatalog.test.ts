import { describe, expect, it } from 'vitest';
import { mapCliCategory, normalizeTreatmentCatalogItems } from './hisTreatmentItemCatalog';

describe('mapCliCategory', () => {
  it('prefers the category text, then the sdCli code, and defaults to treatment', () => {
    expect(mapCliCategory('检验项目', '9')).toBe('检验');
    expect(mapCliCategory('影像检查', '')).toBe('检查');
    expect(mapCliCategory('护理', '1')).toBe('治疗');
    expect(mapCliCategory('', '1')).toBe('检查');
    expect(mapCliCategory(undefined, '2')).toBe('检验');
    expect(mapCliCategory(undefined, undefined)).toBe('治疗');
  });
});

describe('normalizeTreatmentCatalogItems', () => {
  it('keeps active treatment items with writeback fields and drops exam/lab, inactive, unnamed and duplicate rows', () => {
    const result = normalizeTreatmentCatalogItems([
      {
        id: 'SRV-1', idCli: 'CLI-1', naCli: ' 雾化吸入 ', sdCliText: '治疗', py: 'wh', naCstmg: '雾化',
        idDeptExec: 'DEPT-1', idPart: 'PART-1', idLisCategory: 'LIS-1', fgCombination: '1',
      },
      { id: 'SRV-1', naCli: '重复项', sdCliText: '治疗' },
      { id: 'SRV-2', naCli: '血常规', sdCliText: '检验' },
      { id: 'SRV-3', naCli: '胸片', sdCli: '1' },
      { id: 'SRV-4', naCli: '停用治疗', fgActive: '0' },
      { id: 'SRV-5', naCli: '   ' },
      { idCli: 'CLI-6', naCli: '换药', sdSrv: '52', jsonField: '{"x":1}', fgCheckOrd: '0' },
    ]);

    expect(result.map((item) => item.id)).toEqual(['SRV-1', 'CLI-6']);
    expect(result[0]).toMatchObject({
      id: 'SRV-1',
      code: 'CLI-1',
      name: '雾化吸入',
      category: '治疗',
      keywords: ['wh', '雾化', '治疗'],
      idSrv: 'SRV-1',
      naSrv: '雾化吸入',
      sdSrv: '51',
      idDeptExec: 'DEPT-1',
      idPart: 'PART-1',
      jsonField: '{"idLisCategory":"LIS-1","fgCombination":"1"}',
      fgCheckOrd: '1',
    });
    expect(result[1]).toMatchObject({ code: 'CLI-6', sdSrv: '52', jsonField: '{"x":1}', fgCheckOrd: '0' });
  });
});
