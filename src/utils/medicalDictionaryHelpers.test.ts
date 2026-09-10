import { describe, expect, it } from 'vitest';
import {
  calcFreqDayExec,
  createUsageOption,
  inferExecCountFromFrequencyText,
} from './medicalDictionaryHelpers';

describe('medicalDictionaryHelpers', () => {
  describe('calcFreqDayExec (PHIS CalcUtils.js 对标算法)', () => {
    it('calculates daily frequency (天/日) correctly', () => {
      // 每天 1 次 (QD, QHS 等)
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '2', gapCycle: 1, execCount: 1 } })).toBe(1);
      // 每天 2 次 (BID)
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '2', gapCycle: 1, execCount: 2 } })).toBe(2);
      // 每天 3 次 (TID)
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '2', gapCycle: 1, execCount: 3 } })).toBe(3);
      // 隔日 1 次 (QOD): gapCycle=2, execCount=1
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '2', gapCycle: 2, execCount: 1 } })).toBe(0.5);
    });

    it('calculates weekly frequency (星期) correctly (sdFreqCycle === 1)', () => {
      // 每周 1 次 (QW)
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '1', gapCycle: 1, execCount: 1 } })).toBeCloseTo(1 / 7);
      // 每 2 周 1 次: gapCycle=2, execCount=1 -> 1 / 14
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '1', gapCycle: 2, execCount: 1 } })).toBeCloseTo(1 / 14);
      // 每周 2 次 (BIW)
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '1', gapCycle: 1, execCount: 2 } })).toBeCloseTo(2 / 7);
    });

    it('calculates hourly frequency (小时) correctly (sdFreqCycle === 3)', () => {
      // 每 12 小时一次 (Q12H): gapCycle=12, execCount=1 -> 1 * (24 / 12) = 2
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '3', gapCycle: 12, execCount: 1 } })).toBe(2);
      // 每 8 小时一次 (Q8H): gapCycle=8, execCount=1 -> 1 * (24 / 8) = 3
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '3', gapCycle: 8, execCount: 1 } })).toBe(3);
      // 每 6 小时一次 (Q6H): gapCycle=6, execCount=1 -> 1 * (24 / 6) = 4
      expect(calcFreqDayExec({ properties: { sdFreqCycle: '3', gapCycle: 6, execCount: 1 } })).toBe(4);
    });

    it('returns null when properties or execCount are missing', () => {
      expect(calcFreqDayExec(null)).toBeNull();
      expect(calcFreqDayExec({})).toBeNull();
      expect(calcFreqDayExec({ properties: {} })).toBeNull();
    });
  });

  describe('createUsageOption with calcFreqDayExec', () => {
    it('sets execCount from PHIS properties using calcFreqDayExec', () => {
      const option = createUsageOption({
        key: 'Q12H',
        text: '每12小时一次',
        properties: { sdFreqCycle: '3', gapCycle: 12, execCount: 1 },
      });
      expect(option.execCount).toBe(2);
    });
  });

  describe('inferExecCountFromFrequencyText', () => {
    it('accurately parses QHS and bedtime sleep frequencies', () => {
      expect(inferExecCountFromFrequencyText('一天一次(睡前)(QHS)')).toBe(1);
      expect(inferExecCountFromFrequencyText('QHS')).toBe(1);
      expect(inferExecCountFromFrequencyText('睡前一次')).toBe(1);
      expect(inferExecCountFromFrequencyText('每晚睡前')).toBe(1);
      expect(inferExecCountFromFrequencyText('每晚一次(QN)')).toBe(1);
    });

    it('parses variations of once-daily frequencies', () => {
      expect(inferExecCountFromFrequencyText('qd')).toBe(1);
      expect(inferExecCountFromFrequencyText('QD(口服)')).toBe(1);
      expect(inferExecCountFromFrequencyText('每天一次')).toBe(1);
      expect(inferExecCountFromFrequencyText('每日一次')).toBe(1);
      expect(inferExecCountFromFrequencyText('一天一次')).toBe(1);
      expect(inferExecCountFromFrequencyText('1天1次')).toBe(1);
    });

    it('parses multiple times daily with chinese and arabic numbers', () => {
      expect(inferExecCountFromFrequencyText('bid')).toBe(2);
      expect(inferExecCountFromFrequencyText('一天两次')).toBe(2);
      expect(inferExecCountFromFrequencyText('1天2次')).toBe(2);
      expect(inferExecCountFromFrequencyText('每天2次')).toBe(2);

      expect(inferExecCountFromFrequencyText('tid')).toBe(3);
      expect(inferExecCountFromFrequencyText('一天三次')).toBe(3);
      expect(inferExecCountFromFrequencyText('1天3次')).toBe(3);

      expect(inferExecCountFromFrequencyText('qid')).toBe(4);
      expect(inferExecCountFromFrequencyText('一天四次')).toBe(4);
    });

    it('parses hourly frequencies', () => {
      expect(inferExecCountFromFrequencyText('q12h')).toBe(2);
      expect(inferExecCountFromFrequencyText('Q8H')).toBe(3);
      expect(inferExecCountFromFrequencyText('每6小时一次')).toBe(4);
    });

    it('parses alternate day and weekly frequencies', () => {
      expect(inferExecCountFromFrequencyText('qod')).toBe(0.5);
      expect(inferExecCountFromFrequencyText('隔日一次')).toBe(0.5);
      expect(inferExecCountFromFrequencyText('qw')).toBeCloseTo(1 / 7);
      expect(inferExecCountFromFrequencyText('每周一次')).toBeCloseTo(1 / 7);
      expect(inferExecCountFromFrequencyText('biw')).toBeCloseTo(2 / 7);
      expect(inferExecCountFromFrequencyText('每周两次')).toBeCloseTo(2 / 7);
    });
  });
});
