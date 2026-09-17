import { describe, expect, it } from 'vitest';
import { completeGeneratedPrecautions } from './precautionsFollowUp';
import { buildDiagnosisScopedPrecautions, buildOutpatientRecord } from './outpatientRecord';
import { buildClinicalResultIntentRecordSnapshot } from '../consultation-result/model/useClinicalResultIntentReset';

describe('generated precautions follow-up', () => {
  it.each(['急性上呼吸道感染', '急性胃肠炎', '皮疹', '头痛'])('adds a three-day review for %s', (name) => {
    const text = buildDiagnosisScopedPrecautions({ chiefComplaint: '', historyOfPresentIllness: '', diagnosisNames: [name] });
    expect(text).toContain('建议3天内复诊，暂予对症处理。');
    expect(text).toContain('若症状无缓解或加重，请及时就诊或上级医院就诊。');
  });

  it.each(['原发性高血压', '2型糖尿病', '甲状腺功能减退', '慢性肾脏病'])('adds a monthly review for %s', (name) => {
    const text = buildDiagnosisScopedPrecautions({ chiefComplaint: '', historyOfPresentIllness: '', diagnosisNames: [name] });
    expect(text).toContain('建议1个月内复诊，复查相关指标。');
    expect(text).not.toContain('对症处理');
  });

  it('keeps the earlier ordinary review for mixed acute and chronic diagnoses', () => {
    expect(completeGeneratedPrecautions('清淡饮食。', ['高血压', '急性胃肠炎'], true)).toContain('建议3天内复诊');
  });

  it.each(['建议2天后复诊。', '建议一周内复诊。', '建议明日复诊。', '复诊时间：1个月。', '建议立即前往上级医院就诊。'])('preserves explicit disposition: %s', (text) => {
    expect(completeGeneratedPrecautions(text, ['高血压'])).toBe(text);
  });

  it('keeps conditional safety advice and adds an unconditional review without duplication', () => {
    const advice = '如出现胸闷加重，应立即就医。';
    const text = completeGeneratedPrecautions(advice, ['高血压']);
    expect(text).toBe(`建议1个月内复诊，复查相关指标。${advice}`);
    expect(completeGeneratedPrecautions(text, ['高血压'])).toBe(text);
  });

  it('keeps specific wound-care arrangements', () => {
    const text = buildDiagnosisScopedPrecautions({ chiefComplaint: '', historyOfPresentIllness: '', diagnosisNames: ['右手外伤'] });
    expect(text).toContain('按医嘱复诊换药');
    expect(text).not.toContain('3天内');
  });

  it('completes AI education for the chronic channel even for diagnoses outside local rules', () => {
    const snapshot = buildClinicalResultIntentRecordSnapshot({ healthEducation: '遵医嘱规律用药。', diagnoses: [{ name: '痛风缓解期' }] }, true);
    expect(snapshot.precautions).toBe('建议1个月内复诊，复查相关指标。遵医嘱规律用药。');
    const empty = buildClinicalResultIntentRecordSnapshot({ diagnoses: [{ name: '痛风缓解期' }] }, true);
    expect(empty.precautions).toContain('建议1个月内复诊');
  });

  it('preserves supplied doctor text in the record builder used by writeback', () => {
    const record = buildOutpatientRecord({ chiefComplaint: '', historyOfPresentIllness: '', diagnosisNames: ['高血压'], precautions: '记录家庭血压。' });
    expect(record.precautions).toBe('记录家庭血压。');
  });
});
