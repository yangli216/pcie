import { describe, expect, it } from 'vitest';
import {
  buildPhysicalExamWithVitalTemplate,
  collectPhysicalExamVitalSigns,
  DEFAULT_PHYSICAL_EXAM_VITAL_TEMPLATE,
  extractPhysicalExamVitalValues,
  stripPhysicalExamVitalNarrative,
} from './physicalExamVitalTemplate';

describe('physicalExamVitalTemplate', () => {
  it('keeps named T/P/R/BP placeholders when no measured value exists', () => {
    expect(buildPhysicalExamWithVitalTemplate({})).toBe(DEFAULT_PHYSICAL_EXAM_VITAL_TEMPLATE);
    expect(collectPhysicalExamVitalSigns(DEFAULT_PHYSICAL_EXAM_VITAL_TEMPLATE)).toBeUndefined();
  });

  it('extracts explicit dialogue values into independent slots', () => {
    const dialogue = '医生：体温36.7度，脉搏每分钟82次，呼吸18次/分，血压128/76。';
    expect(extractPhysicalExamVitalValues(dialogue)).toEqual({
      temperature: '36.7',
      pulse: '82',
      respiration: '18',
      systolicBloodPressure: '128',
      diastolicBloodPressure: '76',
    });
    expect(buildPhysicalExamWithVitalTemplate({ vitals: dialogue })).toBe(
      'T:{36.7}℃ P:{82}次/分 R:{18}次/分 Bp:{128}/{76}mmHg。',
    );
  });

  it('preserves examination narrative without duplicating natural-language vitals', () => {
    expect(buildPhysicalExamWithVitalTemplate({
      physicalExam: '体温37.2℃，心率90次/分，血压130/80mmHg。咽部充血。',
      vitals: '呼吸20次/分',
    })).toBe('T:{37.2}℃ P:{90}次/分 R:{20}次/分 Bp:{130}/{80}mmHg。咽部充血。');
  });

  it('strips fixed vital signs in both combined and named formats', () => {
    expect(stripPhysicalExamVitalNarrative(
      'T:36.5℃ P:76次/分 R:18次/分 Bp:128/82mmHg。收缩压：128mmHg，舒张压：82mmHg。双肺呼吸音粗。',
    )).toBe('双肺呼吸音粗。');
  });

  it('returns only filled slots as writeback metadata', () => {
    expect(collectPhysicalExamVitalSigns(
      'T:{36.5}℃ P:{脉搏}次/分 R:{18}次/分 Bp:{120}/{80}mmHg。',
    )).toEqual({
      schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
      items: [
        { slotKey: 'temperature', value: '36.5', unit: '℃', marker: '{36.5}' },
        { slotKey: 'respiration', value: '18', unit: '次/分', marker: '{18}' },
        { slotKey: 'systolicBloodPressure', value: '120', unit: 'mmHg', marker: '{120}' },
        { slotKey: 'diastolicBloodPressure', value: '80', unit: 'mmHg', marker: '{80}' },
      ],
    });
  });
});
