import { describe, expect, it } from 'vitest';
import { drugInstructionSections } from './drugInstructionSections';
import { prioritizedDrugInstructionSections } from './drugInstructionPresentation';

const summary = '【用法用量】\r\n标准原文\r\n【儿童用药】\r\n6–17岁见用法用量，6岁以下尚无资料。\r\n【注意事项】\r\n请置于儿童不能接触处。';
const sections = drugInstructionSections(summary);

describe('drug instruction population reading order', () => {
  it.each(['0岁', '8岁', '17岁', '17.9岁', '8周岁', '6个月', '2月龄', '20天', '7日龄',
    '1岁2个月5天', '1周岁2月3日', '17岁11个月30天', '8Y', '6M', '20D'])
  ('prioritizes the entire child chapter for explicit child age %s', age => {
    const result = prioritizedDrugInstructionSections(sections, age);
    expect(result).toEqual([sections[1], sections[0]]);
    expect(result[0]!.content).toContain('6岁以下尚无资料');
    expect(sections.map(section => section.heading + section.content).join('')).toBe(summary);
  });

  it.each(['', '未知', '8', '-1岁', '约8岁', '8岁或18岁', '18岁', '65岁', '18岁1个月',
    '216个月', '6570天', '200个月3000天', 'Infinity岁'])
  ('keeps standard usage for adult or uncertain age %s', age => {
    expect(prioritizedDrugInstructionSections(sections, age)).toEqual([sections[0]]);
  });

  it('requires a nonempty dedicated child heading and preserves no-data and cross-reference text', () => {
    for (const content of ['尚未明确。', '参见【用法用量】。', '本品不推荐儿童使用。']) {
      const source = drugInstructionSections(`【用法用量】标准用量\n【儿童用药】${content}`);
      expect(prioritizedDrugInstructionSections(source, '8岁')).toEqual([source[1], source[0]]);
    }
    for (const tail of ['【儿童用药】\r\n  ', '【注意事项】儿童遵医嘱。', '【老年用药】儿童不能接触。']) {
      const source = drugInstructionSections(`【用法用量】标准用量\n${tail}`);
      expect(prioritizedDrugInstructionSections(source, '8岁')).toEqual([source[0]]);
    }
  });
});
