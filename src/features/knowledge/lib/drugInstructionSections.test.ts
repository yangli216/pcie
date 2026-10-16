import { describe, expect, it } from 'vitest';
import { drugInstructionSections, isDrugUsageSection } from './drugInstructionSections';

describe('drug instruction original text sections', () => {
  it('retains every character, line ending, preamble and long final section', () => {
    const summary = '前言\r\n【药品名称】  \r\n合成药\r\n【用法用量】\r\n合成内容\r\n【注意事项】\r\n' + '完整末尾'.repeat(10000);
    const sections = drugInstructionSections(summary);
    expect(sections.map(section => section.heading + section.content).join('')).toBe(summary);
    expect(sections.map(section => section.heading.trim())).toEqual(['', '【药品名称】', '【用法用量】', '【注意事项】']);
  });
  it('keeps inline brackets, HTML and unstructured source as text', () => {
    const summary = '正文【备注】不作为标题\n<img src=x onerror=alert(1)>';
    expect(drugInstructionSections(summary)).toEqual([{ heading: '', content: summary }]);
    expect(drugInstructionSections('')).toEqual([]);
  });
  it('recognizes usage headings with content on the same line without changing the original', () => {
    const summary = '【药品名称】合成资料\r\n【用法与用量】 原文剂量\r\n【注意事项】原文警示';
    const sections = drugInstructionSections(summary);
    expect(sections.map(section => section.heading + section.content).join('')).toBe(summary);
    expect(sections.filter(isDrugUsageSection)).toEqual([{ heading: '【用法与用量】 ', content: '原文剂量\r\n' }]);
    expect(isDrugUsageSection({ heading: '【用量及用法】', content: '' })).toBe(true);
    expect(isDrugUsageSection({ heading: '【注意事项】', content: '用法用量见其他章节' })).toBe(false);
  });
});
