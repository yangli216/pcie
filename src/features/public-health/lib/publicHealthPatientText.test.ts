import { describe, expect, it } from 'vitest';
import { assertGeneratedExerciseContent, assertPatientFacingContent } from './publicHealthPatientText';

function exercise(length = 300, glyph = '练'): string {
  const bodyLength = length - 11;
  const sizes = [Math.floor(bodyLength / 3), Math.floor(bodyLength / 3), bodyLength - 2 * Math.floor(bodyLength / 3)];
  return sizes.map((size, index) => `${index + 1}. ${glyph.repeat(size - 1)}。`).join('\n');
}

describe('patient prescription content boundary', () => {
  it.each(['制定依据\n资料如下', '待医生核实事项\n需要评估', '请医生核对当前用药', '来源：机构资料', '证据：测量值', 'AI 定性分析', '适用性待核实', '不构成医疗建议', '待补充资料：用药史', '优先级：高', '资料快照：2026-10-13', '记录版本：11', '合成展示', '待医生评估', '待补充资料\n用药史', '建议如下（来源：原库）', '按安排执行。证据：原库', '## 医生提醒\n核对资料'])('rejects explicit internal content %s', text => {
    expect(() => assertPatientFacingContent(text)).toThrow('内部说明');
  });
  it.each(['按医生处方服药，不要自行停药。', '运动时若胸闷或头晕，应停止活动，必要时及时就诊。', '提醒：如出现持续不适，请联系医生。', '食材保持清洁，勿食用已变质的食物。', '蛋白质来源：鱼肉、豆类和蛋类。', '携带机构就诊卡到院。'])('retains concrete patient safety instructions %s', text => {
    expect(() => assertPatientFacingContent(text)).not.toThrow();
  });
  it('does not impose generated-exercise style on a physician edited prescription', () => {
    expect(() => assertPatientFacingContent('医生安排的日常活动说明。'.repeat(100))).not.toThrow();
  });
  it.each(['\r', '\u2028', '\u2029'])('rejects a standalone doctor heading delimited by %j', separator => {
    expect(() => assertPatientFacingContent(`按约定执行患者安排。${separator}医生提醒${separator}核对资料`)).toThrow('内部说明');
  });
});

describe('generated exercise numbering, sentences and Unicode lengths', () => {
  it.each([250, 450])('accepts the exact %i code-point boundary, including supplementary Unicode', length => {
    const text = exercise(length, '😀');
    expect(Array.from(text)).toHaveLength(length);
    expect(() => assertGeneratedExerciseContent(text)).not.toThrow();
  });
  it.each([249, 451])('rejects the %i code-point boundary', length => {
    expect(() => assertGeneratedExerciseContent(exercise(length))).toThrow('250 至 450');
  });
  it('accepts two sentences per item and ignores decimal dots and entry numbering', () => {
    const body = '每次运动 20.5 分钟，结合日常习惯安排步行和舒缓活动，逐步保持稳定的活动节奏并记录身体感受，留意呼吸和步伐变化。若出现头晕或胸闷，请停止活动并休息，持续不适应及时就诊。';
    const text = [1, 2, 3].map(index => `${index}. ${body}`).join('\n');
    expect(() => assertGeneratedExerciseContent(text)).not.toThrow();
  });
  it('accepts Chinese closing parentheses, consecutive end punctuation and a nonempty trailing sentence', () => {
    const body = `建议选择步行，${'练'.repeat(80)}？！保持平稳呼吸`;
    const text = [1, 2, 3].map(index => `${index}） ${body}`).join('\n');
    expect(() => assertGeneratedExerciseContent(text)).not.toThrow();
  });
  it('allows indentation before list numbers', () => {
    expect(() => assertGeneratedExerciseContent(exercise().replace('\n2.', '\n  2.').replace('\n3.', '\n\t3.'))).not.toThrow();
  });
  it('rejects a numbered recommendation that adds a nested bullet', () => {
    expect(() => assertGeneratedExerciseContent(exercise().replace('\n2. ', '\n- 额外活动\n2. '))).toThrow();
  });
  it.each(['\r', '\u2028', '\u2029'])('rejects a nested exercise bullet after %j', separator => {
    const text = exercise().replace('\n2. ', `${separator}- 额外活动\n2. `);
    expect(() => assertGeneratedExerciseContent(text)).toThrow('每条最多 2 句');
  });
  it.each(['。', '！', '？', '!', '?', '.'])('rejects three sentences separated by %s', punctuation => {
    const first = `散步${punctuation}记录感受${punctuation}${'练'.repeat(85)}${punctuation}`;
    const text = `1. ${first}\n2. ${'练'.repeat(85)}。\n3. ${'练'.repeat(85)}。`;
    expect(() => assertGeneratedExerciseContent(text)).toThrow('每条最多 2 句');
  });
  it.each([
    (text: string) => `运动建议\n${text}`,
    (text: string) => text.replace('2. ', '3. '),
    (text: string) => text.replace('2. ', '02. '),
    (text: string) => text.replace('3. ', '4. '),
    (text: string) => `${text}\n4. 更多活动。`,
  ])('rejects headers, reordered or extra numbered entries', change => {
    expect(() => assertGeneratedExerciseContent(change(exercise()))).toThrow();
  });
});
