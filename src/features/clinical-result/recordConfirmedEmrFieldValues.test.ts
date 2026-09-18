import { describe, expect, it } from 'vitest';
import { buildRecordConfirmedEmrFieldValues } from './recordConfirmedEmrFieldValues';

describe('buildRecordConfirmedEmrFieldValues', () => {
  it('builds one flat PHIS data-id map with dictionary codes for all fixed history slots', () => {
    const values = buildRecordConfirmedEmrFieldValues({
      record: {
        chiefComplaint: '头晕1天',
        historyOfPresentIllness: '患者头晕1天。',
        pastMedicalHistory: '平素体健；有高血压病史。',
        personalHistory: '否认吸烟史。',
        familyHistory: '有家族重大遗传病史。',
        physicalExam: 'T:36.6℃，血压128/82mmHg。',
      },
      selectedRecordFields: new Set([
        'chiefComplaint',
        'historyOfPresentIllness',
        'pastMedicalHistory',
        'personalHistory',
        'familyHistory',
        'physicalExam',
      ]),
      recordTemplateChanges: {
        schemaVersion: 'outpatient-record-template-changes.v1',
        items: [{
          field: 'pastMedicalHistory',
          slotKey: 'hypertensionHistory',
          fromValue: '否认',
          toValue: '有',
          templateMarker: '{否认}高血压病史',
          replacementMarker: '{有}高血压病史',
        }],
      },
      historyTemplateValues: [
        { field: 'pastMedicalHistory', slotKey: 'healthStatus', value: '体健' },
        { field: 'pastMedicalHistory', slotKey: 'hepatitisHistory', value: '否认' },
        { field: 'pastMedicalHistory', slotKey: 'hypertensionHistory', value: '有' },
        { field: 'pastMedicalHistory', slotKey: 'diabetesHistory', value: '否认' },
        { field: 'personalHistory', slotKey: 'smokingHistory', value: '否认' },
        { field: 'familyHistory', slotKey: 'familyHereditaryDiseaseHistory', value: '有' },
      ],
      physicalExamVitalSigns: {
        schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
        items: [
          { slotKey: 'temperature', value: '36.6', unit: '℃', marker: '{36.6}' },
          { slotKey: 'systolicBloodPressure', value: '128', unit: 'mmHg', marker: '{128}' },
          { slotKey: 'diastolicBloodPressure', value: '82', unit: 'mmHg', marker: '{82}' },
        ],
      },
    });

    expect(values).toEqual({
      主诉: '头晕1天',
      主诉文本: '头晕1天',
      门诊现病史文本: '患者头晕1天。',
      现病史文本: '患者头晕1天。',
      现病史: '患者头晕1天。',
      既往史文本: '平素体健；有高血压病史。',
      个人史文本: '否认吸烟史。',
      家族史文本: '有家族重大遗传病史。',
      体格检查: 'T:36.6℃，血压128/82mmHg。',
      平素: '1',
      肝炎史标志: '0',
      高血压病史标志: '1',
      糖尿病史标志: '0',
      吸烟史标志: '0',
      家族病史标志: '1',
      体温: '36.6',
      收缩压: '128',
      舒张压: '82',
    });
  });

  it('omits every unselected field and an empty menstrual history', () => {
    expect(buildRecordConfirmedEmrFieldValues({
      record: {
        chiefComplaint: '咳嗽',
        personalHistory: '否认吸烟史。',
        menstrualHistory: '',
      },
      selectedRecordFields: new Set(['personalHistory', 'menstrualHistory']),
    })).toEqual({
      个人史文本: '否认吸烟史。',
    });
  });
});
