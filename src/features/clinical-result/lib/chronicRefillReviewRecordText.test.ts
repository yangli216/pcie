import { describe, expect, it } from 'vitest';
import {
  normalizeChronicRefillHistoryOfPresentIllness,
  normalizeChronicRefillReviewRecordText,
} from './chronicRefillReviewRecordText';

describe('chronic refill review record text', () => {
  it.each([
    '仍按近期方案服药',
    '近期用药方案已有调整',
    '近期已停用原用药方案',
    '近期血压控制平稳',
    '近期存在相关不适',
    '近期无明显相关不适及药物不良反应',
    '近期血压130/80mmHg',
  ])('keeps a concise confirmed state: %s', (text) => {
    expect(normalizeChronicRefillReviewRecordText(text)).toBe(text);
  });

  it.each([
    '规律服用苯磺酸氨氯地平片、盐酸二甲双胍片',
    '服用阿卡波糖片50mg，每日三次，每次一片，共2盒',
    '原方案每日三次，每次一片',
    '原方案 BID',
    '规律服用阿司匹林',
    '已停用缬沙坦',
    '剂量未调整，疗程30天',
    '皮下注射胰岛素',
    '当前有效库存支持继续治疗',
  ])('does not write prescription details: %s', (text) => {
    expect(normalizeChronicRefillReviewRecordText(text)).toBe('');
  });

  it('removes prescription details appended after the refill purpose', () => {
    expect(normalizeChronicRefillHistoryOfPresentIllness(
      '患者既往确诊2型糖尿病、高血压2级。今复诊配药：◎厄贝沙坦片口服1天共1盒、盐酸二甲双胍片口服30天共3瓶。',
    )).toBe('患者既往确诊2型糖尿病、高血压2级。今复诊配药。');
  });

  it('keeps a refill purpose when no prescription detail follows it', () => {
    const text = '患者既往确诊高血压。今复诊配药：近期血压控制平稳。';
    expect(normalizeChronicRefillHistoryOfPresentIllness(text)).toBe(text);
  });

  it('uses known names even when the text omits the dosage form', () => {
    expect(normalizeChronicRefillReviewRecordText('规律服用缬沙坦', ['☆缬沙坦(代文)/80mg'])).toBe('');
  });

  it('does not salvage a partial causal or negative statement', () => {
    expect(normalizeChronicRefillReviewRecordText('停用苯磺酸氨氯地平片后无头晕，但血压波动')).toBe('');
  });
});
