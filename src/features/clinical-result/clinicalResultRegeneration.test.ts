import { describe, expect, it } from 'vitest';
import {
  buildClinicalResultRegenerationRequest,
  normalizeClinicalResultRegenerationOutput,
  type ClinicalResultRegenerationRecord,
} from './clinicalResultRegeneration';

const currentRecord: ClinicalResultRegenerationRecord = {
  chiefComplaint: '咳嗽3天',
  historyOfPresentIllness: '3天前出现咳嗽，无发热。',
  pastMedicalHistory: '否认高血压病史。',
  personalHistory: '无特殊。',
  menstrualHistory: '周期28天，经期5天。',
  maritalReproductiveHistory: '已婚已育；未孕。',
  familyHistory: '无特殊。',
  physicalExam: '咽部稍红。',
  precautions: '病情加重及时复诊。',
};

describe('clinical result regeneration', () => {
  it('builds a traceable rewrite request from the current record and doctor supplement', () => {
    const spec = buildClinicalResultRegenerationRequest({
      channel: 'symptom',
      patient: { name: '患者甲', gender: '女', age: '38岁' },
      currentRecord,
      doctorSupplement: '  患者补充昨晚发热，最高38.6℃。  ',
      consultationId: 'consultation-1',
    });

    expect(spec.messages[0]?.content).toContain('医生补充信息的事实优先级高于当前草稿');
    expect(spec.messages[1]?.content).toContain('患者补充昨晚发热，最高38.6℃。');
    expect(spec.messages[1]?.content).toContain('咳嗽3天');
    expect(spec.messages[0]?.content).toContain('不得编造');
    expect(spec.messages[1]?.content).toContain('月经史仅适用于女性患者');
    expect(spec.config.traceContext).toMatchObject({
      scene: 'clinical-result-regeneration',
      sourceModule: 'symptom_consultation_result',
      operationAction: 'regenerate_with_supplement',
      consultationId: 'consultation-1',
    });
  });

  it('rejects an empty doctor supplement before sending a request', () => {
    expect(() => buildClinicalResultRegenerationRequest({
      channel: 'voice',
      patient: {},
      currentRecord,
      doctorSupplement: '   ',
    })).toThrow('请先填写或录入补充信息');
  });

  it('keeps unaffected fallback fields when the model omits optional fields', () => {
    const normalized = normalizeClinicalResultRegenerationOutput({
      chiefComplaint: '咳嗽伴发热3天',
      historyOfPresentIllness: '3天前出现咳嗽，昨晚发热，最高38.6℃。',
      physicalExam: '咽部充血。',
    }, currentRecord);

    expect(normalized).toEqual({
      ...currentRecord,
      chiefComplaint: '咳嗽伴发热3天',
      historyOfPresentIllness: '3天前出现咳嗽，昨晚发热，最高38.6℃。',
      physicalExam: '咽部充血。',
    });
  });

  it('cleans workflow prompts and repeated sentences from regenerated fields', () => {
    const normalized = normalizeClinicalResultRegenerationOutput({
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者咳嗽3天，其他情况待医生补充完善。否认发热。否认发热。',
      pastMedicalHistory: '待医生核实。',
    }, currentRecord);

    expect(normalized.historyOfPresentIllness).toBe('患者咳嗽3天。否认发热。');
    expect(normalized.pastMedicalHistory).toBe(currentRecord.pastMedicalHistory);
  });

  it('rejects malformed output instead of replacing the working result', () => {
    expect(() => normalizeClinicalResultRegenerationOutput([], currentRecord))
      .toThrow('重新生成的病例不是有效 JSON 对象');
  });
});
