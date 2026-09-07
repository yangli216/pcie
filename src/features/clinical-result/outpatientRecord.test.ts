import { describe, expect, it } from 'vitest';
import {
  buildDiagnosisScopedPrecautions,
  buildOutpatientRecord,
  OUTPATIENT_RECORD_SCHEMA_VERSION,
  type OutpatientRecord,
  validateOutpatientRecord,
} from './outpatientRecord';
import {
  buildRecordConfirmedPayload,
  resolveRecordConfirmedPrescriptionAttributes,
} from './recordConfirmedPayload';
import { mergeClinicalRecordSuggestionIntoText } from './clinicalRecordAnnotation';
import type { ClinicalRecordFactSuggestion } from './clinicalRecordFactConfirmation';
import {
  collectHistoryRecordTemplateChanges,
  resolveHistoryRecordTemplate,
  stripHistoryRecordTemplateMarkers,
} from './historyRecordTemplates';

describe('outpatientRecord', () => {
  it('prefills standard history templates and named vital-sign slots without inventing values', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '办理健康证查体',
      historyOfPresentIllness: '患者自诉无发热、咳嗽、腹痛等不适。',
      diagnosisNames: [],
    });

    expect(record.schemaVersion).toBe(OUTPATIENT_RECORD_SCHEMA_VERSION);
    expect(record.pastMedicalHistory).toContain('{否认}高血压病史');
    expect(record.personalHistory).toContain('{否认}吸烟史');
    expect(record.familyHistory).toContain('{否认}家族重大遗传病史');
    expect(record.physicalExam).toBe(
      'T:{体温}℃ P:{脉搏}次/分 R:{呼吸}次/分 Bp:{收缩压}/{舒张压}mmHg。',
    );
    expect(record.physicalExam).not.toMatch(/\{\d/u);
    expect(record).not.toHaveProperty('diagnosisText');
  });

  it('does not deny chronic disease history when diagList contains chronic diagnoses', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '高血压复诊配药',
      historyOfPresentIllness: '患者既往高血压多年，规律服药，今来续方。',
      diagnosisNames: ['原发性高血压'],
    });

    expect(record.pastMedicalHistory).toContain('{有}高血压病史');
    expect(record.pastMedicalHistory).not.toContain('{否认}高血压病史');
    expect(record.pastMedicalHistory).toContain('{否认}手术史');
    expect(validateOutpatientRecord(record, {
      chiefComplaint: '高血压复诊配药',
      historyOfPresentIllness: '患者既往高血压多年，规律服药，今来续方。',
      diagnosisNames: ['原发性高血压'],
    })).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', field: 'pastMedicalHistory' }),
    ]));
  });

  it('changes only explicitly positive fixed-template slots', () => {
    const pastHistory = resolveHistoryRecordTemplate(
      'pastMedicalHistory',
      '既往有高血压病史10年，否认糖尿病史。',
    );

    expect(pastHistory).toContain('{有}高血压病史');
    expect(pastHistory).toContain('{否认}糖尿病史');
    expect(pastHistory).toContain('{否认}心脏病史');
    expect(stripHistoryRecordTemplateMarkers(pastHistory)).toContain('有高血压病史');
    expect(collectHistoryRecordTemplateChanges({ pastMedicalHistory: pastHistory })).toEqual({
      schemaVersion: 'outpatient-record-template-changes.v1',
      items: [expect.objectContaining({
        field: 'pastMedicalHistory',
        slotKey: 'hypertensionHistory',
        fromValue: '否认',
        toValue: '有',
      })],
    });
  });

  it('keeps grouped negative history slots negative while honoring a later explicit positive', () => {
    const pastHistory = resolveHistoryRecordTemplate(
      'pastMedicalHistory',
      '否认高血压、糖尿病史，但确诊有心脏病史。',
    );

    expect(pastHistory).toContain('{否认}高血压病史');
    expect(pastHistory).toContain('{否认}糖尿病史');
    expect(pastHistory).toContain('{有}心脏病史');
  });

  it('maps an explicit standalone allergy history into the fixed past-history slot', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者咳嗽3天。',
      allergyHistory: '青霉素过敏。',
      diagnosisNames: ['急性上呼吸道感染'],
    });

    expect(record.pastMedicalHistory).toContain('{有}食品、药品过敏史');
    expect(collectHistoryRecordTemplateChanges(record)).toEqual(expect.objectContaining({
      items: [expect.objectContaining({ slotKey: 'foodDrugAllergyHistory' })],
    }));
  });

  it('keeps explicit menstrual history only for a non-male patient without inventing defaults', () => {
    const femaleRecord = buildOutpatientRecord({
      chiefComplaint: '下腹不适2天',
      historyOfPresentIllness: '患者下腹不适2天。',
      menstrualHistory: '月经史：周期28天，经期5天，末次月经2026-08-05。',
      patientGender: '女性',
    });
    const maleRecord = buildOutpatientRecord({
      chiefComplaint: '腹痛2天',
      historyOfPresentIllness: '患者腹痛2天。',
      menstrualHistory: '不应保留',
      patientGender: '男性',
    });

    expect(femaleRecord.menstrualHistory).toBe('周期28天，经期5天，末次月经2026-08-05。');
    expect(maleRecord).not.toHaveProperty('menstrualHistory');
    expect(buildOutpatientRecord({
      chiefComplaint: '头痛1天',
      historyOfPresentIllness: '患者头痛1天。',
      patientGender: '女性',
    })).not.toHaveProperty('menstrualHistory');
  });

  it('flags diagnosisText leakage and left-right mismatch risks', () => {
    const record = {
      ...buildOutpatientRecord({
        chiefComplaint: '右膝外伤疼痛1天',
        historyOfPresentIllness: '患者右膝外伤后疼痛，活动受限。',
        diagnosisNames: ['右膝挫伤'],
      }),
      physicalExam: '左膝局部压痛，活动受限。',
      diagnosisText: '右膝挫伤',
    } as OutpatientRecord;

    const issues = validateOutpatientRecord(record, {
      chiefComplaint: '右膝外伤疼痛1天',
      historyOfPresentIllness: '患者右膝外伤后疼痛，活动受限。',
      diagnosisNames: ['右膝挫伤'],
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', field: 'diagList' }),
      expect.objectContaining({ severity: 'warning', field: 'physicalExam' }),
    ]));
  });

  it('generates customized health prescriptions based on specific diagnoses', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '多饮多食多尿1个月',
      historyOfPresentIllness: '患者1个月前出现多饮多食多尿，伴体重下降。',
      diagnosisNames: ['II型糖尿病'],
    });

    expect(record.precautions).toContain('控制总热量摄入');
    expect(record.precautions).toContain('每天监测血糖');
  });

  it('merges health prescriptions using round-robin logic and respects safety limits', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '头晕1周，伴口渴多饮',
      historyOfPresentIllness: '患者既往高血压多年，最近出现口渴多饮。',
      diagnosisNames: ['原发性高血压', 'II型糖尿病'],
    });

    // 验证高血压和糖尿病的两项最核心建议被合理提取
    expect(record.precautions).toContain('少吃咸菜'); // 高血压第1项
    expect(record.precautions).toContain('控制总热量摄入'); // 糖尿病第1项
    expect(record.precautions).toContain('多吃新鲜蔬菜'); // 高血压第2项
    expect(record.precautions).toContain('遵医嘱规律服药'); // 糖尿病第2项
    
    // 验证合并后的总条数限制（共6条）
    const countMatches = (record.precautions.match(/\d\./g) || []).length;
    expect(countMatches).toBe(6);
  });

  it('does not mismatch digestive advice due to negative gastrointestinal symptoms in history text when no digestive diagnosis exists', () => {
    const record = buildOutpatientRecord({
      chiefComplaint: '发热伴咽痛1天',
      historyOfPresentIllness: '患者受凉后发热，伴咽痛。无流涕，无腹痛及腹泻。',
      diagnosisNames: ['急性上呼吸道感染'],
    });

    // 应该只匹配到呼吸道感染的注意事项，不应该出现消化道的条款
    expect(record.precautions).toContain('多喝温开水');
    expect(record.precautions).not.toContain('胃肠药');
    expect(record.precautions).not.toContain('电解质水');
  });

  it('rebuilds scoped precautions without reusing unselected diagnosis content', () => {
    const precautions = buildDiagnosisScopedPrecautions({
      chiefComplaint: '腹痛伴尿频',
      historyOfPresentIllness: '初始候选曾包含膀胱炎。',
      precautions: '膀胱炎患者应注意多饮水并监测尿路症状。',
      diagnosisNames: ['输尿管结石'],
    });

    expect(precautions).not.toContain('膀胱炎');
    expect(precautions).not.toContain('尿路症状');
  });

  it('uses only the selected diagnosis rules when rebuilding scoped precautions', () => {
    const precautions = buildDiagnosisScopedPrecautions({
      chiefComplaint: '发热伴腹泻',
      historyOfPresentIllness: '同时存在呼吸道和消化道症状。',
      diagnosisNames: ['急性上呼吸道感染'],
    });

    expect(precautions).toContain('多喝温开水');
    expect(precautions).not.toContain('胃肠药');
    expect(precautions).not.toContain('电解质水');
  });
});

describe('buildRecordConfirmedPayload outpatientRecord', () => {
  it('includes a merged AI record segment in one-click writeback when its field is selected', () => {
    const suggestion: ClinicalRecordFactSuggestion = {
      id: 'ai-check-chest-pain',
      field: 'historyOfPresentIllness',
      question: '是否伴胸痛？',
      negativeRecordText: '否认胸痛',
      rationale: '核查急性冠脉事件风险',
      priority: 'critical',
      status: 'pending',
    };
    const historyOfPresentIllness = mergeClinicalRecordSuggestionIntoText(
      '患者胸闷1天。',
      suggestion,
    );
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-ai-writeback',
      chiefComplaint: '胸闷1天',
      historyOfPresentIllness,
      pastMedicalHistory: '平素体健。',
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['historyOfPresentIllness'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(payload.historyOfPresentIllness).toBe('患者胸闷1天。否认胸痛。');
    expect(payload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
      historyOfPresentIllness: '患者胸闷1天。否认胸痛。',
    });
  });

  it('adds a full outpatientRecord while keeping diagnosis source in diagList', () => {
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-1',
      requestId: 'request-1',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者3天前受凉后出现咳嗽，偶有咳痰。',
      pastMedicalHistory: '平素体健',
      outpatientRecord: {
        personalHistory: '个人史：否认吸烟史，否认饮酒史。',
        physicalExam: '双肺呼吸音清，未闻及干湿啰音。',
        precautions: '注意休息，必要时复诊。',
      },
      diagList: [
        {
          idDiag: 'D-URI',
          naDiag: '急性上呼吸道感染',
          fgMain: '1',
        },
      ],
      orderList: [],
    });

    const outpatientRecord = payload.outpatientRecord as OutpatientRecord;

    expect(outpatientRecord.schemaVersion).toBe(OUTPATIENT_RECORD_SCHEMA_VERSION);
    expect(outpatientRecord.personalHistory).toBe('否认吸烟史，否认饮酒史。');
    expect(outpatientRecord.physicalExam).toBe(
      'T:{体温}℃ P:{脉搏}次/分 R:{呼吸}次/分 Bp:{收缩压}/{舒张压}mmHg。双肺呼吸音清，未闻及干湿啰音。',
    );
    expect(outpatientRecord.precautions).toBe('注意休息，必要时复诊。');
    expect(payload.precautions).toBe('注意休息，必要时复诊。');
    expect(outpatientRecord).not.toHaveProperty('diagnosisText');
    expect(payload.diagList).toEqual([
      expect.objectContaining({
        idDiag: 'D-URI',
        naDiag: '急性上呼吸道感染',
      }),
    ]);
  });

  it('keeps generated precautions in both the PHIS compatibility field and outpatientRecord', () => {
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-2',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '患者受凉后出现咳嗽。',
      pastMedicalHistory: '平素体健',
      diagList: [],
      orderList: [],
    });

    const outpatientRecord = payload.outpatientRecord as OutpatientRecord;

    expect(outpatientRecord.precautions).toBeTruthy();
    expect(payload.precautions).toBe(outpatientRecord.precautions);
  });

  it('omits unselected record fields and diagnosis while returning an empty order list', () => {
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-partial',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '受凉后出现咳嗽。',
      pastMedicalHistory: '平素体健。',
      outpatientRecord: {
        personalHistory: '否认吸烟史。',
        physicalExam: '双肺呼吸音清。',
        precautions: '注意休息。',
      },
      diagList: [{ idDiag: 'D-1', naDiag: '急性上呼吸道感染' }],
      orderList: [{ idSrv: 'M-1', naSrv: '药品A' }],
      treatmentPlan: '用药：药品A',
      writebackScope: {
        recordFields: ['historyOfPresentIllness', 'personalHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(payload.writebackScope).toEqual({
      recordFields: ['historyOfPresentIllness', 'personalHistory'],
      includeDiagnosis: false,
      orderTypes: [],
    });
    expect(payload).not.toHaveProperty('chiefComplaint');
    expect(payload.historyOfPresentIllness).toBe('受凉后出现咳嗽。');
    expect(payload).not.toHaveProperty('pastMedicalHistory');
    expect(payload).not.toHaveProperty('familyHistory');
    expect(payload).not.toHaveProperty('precautions');
    expect(payload).not.toHaveProperty('diagList');
    expect(payload.orderList).toEqual([]);
    expect(payload).not.toHaveProperty('treatmentPlan');
    expect(payload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
      historyOfPresentIllness: '受凉后出现咳嗽。',
      personalHistory: '否认吸烟史。',
    });
  });

  it('keeps the top-level precautions compatibility field only when selected', () => {
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-precautions',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '受凉后出现咳嗽。',
      pastMedicalHistory: '平素体健。',
      precautions: '注意休息。',
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['precautions'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(payload.precautions).toBe('注意休息。');
    expect(payload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
      precautions: '注意休息。',
    });
  });

  it('writes selected female menstrual history to both compatibility locations and omits it for males', () => {
    const femalePayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-menstrual-history',
      chiefComplaint: '下腹不适2天',
      historyOfPresentIllness: '患者下腹不适2天。',
      pastMedicalHistory: '平素体健。',
      menstrualHistory: '周期28天，经期5天，末次月经2026-08-05。',
      patientGender: '女性',
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['menstrualHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });
    const malePayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-male-menstrual-history',
      chiefComplaint: '腹痛2天',
      historyOfPresentIllness: '患者腹痛2天。',
      pastMedicalHistory: '平素体健。',
      menstrualHistory: '不应保留',
      patientGender: '男性',
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['menstrualHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(femalePayload.menstrualHistory).toBe('周期28天，经期5天，末次月经2026-08-05。');
    expect(femalePayload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
      menstrualHistory: '周期28天，经期5天，末次月经2026-08-05。',
    });
    expect(malePayload).not.toHaveProperty('menstrualHistory');
    expect(malePayload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
    });
  });

  it('writes plain history text plus scoped structured template changes', () => {
    const pastMedicalHistory = resolveHistoryRecordTemplate(
      'pastMedicalHistory',
      '患者既往有高血压病史，否认糖尿病史。',
    );
    const personalHistory = resolveHistoryRecordTemplate(
      'personalHistory',
      '吸烟20年。',
    );
    const payload = buildRecordConfirmedPayload({
      consultationId: 'consultation-template-slots',
      chiefComplaint: '头晕1天',
      historyOfPresentIllness: '患者头晕1天。',
      pastMedicalHistory,
      outpatientRecord: { pastMedicalHistory, personalHistory },
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['pastMedicalHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(payload.pastMedicalHistory).toContain('有高血压病史');
    expect(payload.pastMedicalHistory).not.toContain('{');
    expect(payload.outpatientRecord).toEqual(expect.objectContaining({
      pastMedicalHistory: expect.not.stringContaining('{'),
    }));
    expect(payload.recordTemplateChanges).toEqual({
      schemaVersion: 'outpatient-record-template-changes.v1',
      items: [expect.objectContaining({
        field: 'pastMedicalHistory',
        slotKey: 'hypertensionHistory',
        replacementMarker: '{有}高血压病史',
      })],
    });
  });

  it('writes independently marked vital signs only when physical examination is selected', () => {
    const selectedPayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-vital-slots',
      chiefComplaint: '头晕1天',
      historyOfPresentIllness: '患者头晕1天。',
      pastMedicalHistory: '平素体健。',
      outpatientRecord: {
        physicalExam: 'T:{36.6}℃ P:{76}次/分 R:{18}次/分 Bp:{128}/{82}mmHg。神志清。',
      },
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['physicalExam'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });
    const unselectedPayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-vital-slots-unselected',
      chiefComplaint: '头晕1天',
      historyOfPresentIllness: '患者头晕1天。',
      pastMedicalHistory: '平素体健。',
      outpatientRecord: {
        physicalExam: 'T:{36.6}℃ P:{76}次/分 R:{18}次/分 Bp:{128}/{82}mmHg。',
      },
      diagList: [],
      orderList: [],
      writebackScope: {
        recordFields: ['chiefComplaint'],
        includeDiagnosis: false,
        orderTypes: [],
      },
    });

    expect(selectedPayload.outpatientRecord).toEqual({
      schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
      physicalExam: 'T:{36.6}℃ P:{76}次/分 R:{18}次/分 Bp:{128}/{82}mmHg。神志清。',
    });
    expect(selectedPayload.physicalExamVitalSigns).toEqual({
      schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
      items: [
        { slotKey: 'temperature', value: '36.6', unit: '℃', marker: '{36.6}' },
        { slotKey: 'pulse', value: '76', unit: '次/分', marker: '{76}' },
        { slotKey: 'respiration', value: '18', unit: '次/分', marker: '{18}' },
        { slotKey: 'systolicBloodPressure', value: '128', unit: 'mmHg', marker: '{128}' },
        { slotKey: 'diastolicBloodPressure', value: '82', unit: 'mmHg', marker: '{82}' },
      ],
    });
    expect(unselectedPayload).not.toHaveProperty('physicalExamVitalSigns');
  });

  it('carries the neutral chronic long-term prescription attribute only when requested', () => {
    const medicineOrders = [{ sdSrv: '11', idSrv: 'MED-1', naSrv: '氨氯地平片' }];
    const chronicPayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-chronic-refill',
      chiefComplaint: '高血压复诊配药',
      historyOfPresentIllness: '既往高血压，本次复诊续方。',
      pastMedicalHistory: '有高血压病史。',
      diagList: [{ idDiag: 'D-HYPERTENSION', naDiag: '高血压病', fgMain: '1' }],
      orderList: medicineOrders,
      prescriptionAttributes: resolveRecordConfirmedPrescriptionAttributes(
        'chronic-refill',
        medicineOrders,
        { signed: true },
      ),
    });
    const ordinaryPayload = buildRecordConfirmedPayload({
      consultationId: 'consultation-ordinary',
      chiefComplaint: '咳嗽3天',
      historyOfPresentIllness: '受凉后咳嗽。',
      pastMedicalHistory: '平素体健。',
      diagList: [],
      orderList: [{ sdSrv: '11', idSrv: 'MED-2', naSrv: '药品B' }],
    });

    expect(chronicPayload.prescriptionAttributes).toEqual({ chronicLongTerm: true });
    expect(ordinaryPayload).not.toHaveProperty('prescriptionAttributes');
    expect(resolveRecordConfirmedPrescriptionAttributes('voice', medicineOrders, { signed: true })).toBeUndefined();
    expect(resolveRecordConfirmedPrescriptionAttributes('symptom', medicineOrders, { signed: true })).toBeUndefined();
    expect(resolveRecordConfirmedPrescriptionAttributes('chronic-refill', [], { signed: true })).toBeUndefined();
    expect(resolveRecordConfirmedPrescriptionAttributes('chronic-refill', medicineOrders, { signed: false })).toBeUndefined();
    expect(resolveRecordConfirmedPrescriptionAttributes('chronic-refill', medicineOrders)).toBeUndefined();
  });
});
