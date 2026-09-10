import { describe, expect, it } from 'vitest';
import { normalizeOutpatientFollowUpRecordText } from './outpatientFollowUpRecord';

describe('normalizeOutpatientFollowUpRecordText', () => {
  const recordText = [
    '个人史：否认吸烟、饮酒史。',
    '月经史：{}',
    '婚育史：{}，{}怀孕，{}',
    '家族史：否认家族遗传病史。',
  ].join('\n');

  it.each(['M', '1', '男性'])('removes female-specific template lines for male gender %s', (gender) => {
    expect(normalizeOutpatientFollowUpRecordText(recordText, gender)).toBe([
      '个人史：否认吸烟、饮酒史。',
      '家族史：否认家族遗传病史。',
    ].join('\n'));
  });

  it('recognizes HIS male gender codes and CRLF records', () => {
    expect(normalizeOutpatientFollowUpRecordText(recordText.replace(/\n/gu, '\r\n'), '1'))
      .not.toMatch(/月经史|婚育史/u);
  });

  it('preserves the original record for female patients', () => {
    expect(normalizeOutpatientFollowUpRecordText(recordText, 'F')).toBe(recordText);
  });

  it('preserves the original record when patient gender is unknown', () => {
    expect(normalizeOutpatientFollowUpRecordText(recordText, '')).toBe(recordText);
  });
});
