import { describe, expect, it } from 'vitest';
import type { InpatientEmrTemplateField } from '../types';
import { parseCompleteInpatientEmrValues } from './inpatientEmrGenerationValues';

const fields: InpatientEmrTemplateField[] = [
  { id: 'basis', name: '诊断依据', type: 'text', readonly: false, key: false, meaning: '诊断依据正文', aiSuitable: true, rule: { source: 'ai', constraints: [] } },
  { id: 'diff', name: '鉴别诊断', type: 'text', readonly: false, key: false, meaning: '鉴别诊断正文', aiSuitable: true, rule: { source: 'ai', constraints: [] } },
  { id: 'patient', name: '住院号', type: 'text', readonly: true, key: false, meaning: 'HIS事实', aiSuitable: false, rule: { source: 'his_or_system', constraints: [] } },
];

describe('inpatient final response acceptance', () => {
  it('accepts exact IDs with string content, including a single outer fence and JSON escapes', () => {
    expect(parseCompleteInpatientEmrValues('\uFEFF```json\n{"basis":"合成依据\\n含\\\"引号\\\"和\\\\路径","diff":"待排方向，需核对资料"}\n```', fields))
      .toEqual({ basis: '合成依据\n含"引号"和\\路径', diff: '待排方向，需核对资料' });
  });

  it.each([
    ['missing', '{"basis":"合成依据"}'],
    ['empty', '{"basis":"合成依据","diff":"  "}'],
    ['placeholder', '{"basis":"合成依据","diff":"请输入鉴别诊断"}'],
    ['copied label', '{"basis":"诊断依据","diff":"合成鉴别"}'],
    ['null', '{"basis":"合成依据","diff":null}'],
    ['object', '{"basis":"合成依据","diff":{"text":"合成鉴别"}}'],
    ['array', '[{"basis":"合成依据","diff":"合成鉴别"}]'],
    ['unknown', '{"basis":"合成依据","diff":"合成鉴别","patient":"AI不应写入"}'],
    ['display name', '{"诊断依据":"合成依据","鉴别诊断":"合成鉴别"}'],
    ['truncated', '{"basis":"合成依据","diff":"合成鉴别'],
    ['extra text', '{"basis":"合成依据","diff":"合成鉴别"}说明'],
    ['two objects', '{"basis":"合成依据"}{"diff":"合成鉴别"}'],
    ['duplicate', '{"basis":"合成依据","basis":"另一个值","diff":"合成鉴别"}'],
    ['escaped duplicate', '{"basis":"合成依据","\\u0062asis":"另一个值","diff":"合成鉴别"}'],
  ])('rejects %s instead of declaring generation complete', (_name, response) => {
    expect(() => parseCompleteInpatientEmrValues(response, fields)).toThrow();
  });

  it('does not confuse a clinical recommendation with a whole-field input hint', () => {
    expect(parseCompleteInpatientEmrValues('{"basis":"合成依据","diff":"请补充既往影像以进一步鉴别。"}', fields).diff)
      .toBe('请补充既往影像以进一步鉴别。');
  });
});
