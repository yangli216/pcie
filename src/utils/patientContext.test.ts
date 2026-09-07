import { describe, expect, it } from 'vitest';
import {
  buildPatientContext,
  extractMenstrualHistoryFromRecordText,
  getPatientContextMenstrualHistory,
  toConsultationPatient,
} from './patientContext';

describe('patientContext age precedence', () => {
  it('lets authoritative PHIS month age override a unitless reception ageNum', () => {
    const context = buildPatientContext({
      payload: {
        idPi: 'patient-infant',
        ageNum: 10,
      },
      hisInfo: {
        patientId: 'patient-infant',
        name: '婴儿',
        gender: 'F',
        ageText: '10个月',
      },
    });

    expect(context?.ageText).toBe('10个月');
    expect(context?.demographics.ageText).toBe('10个月');
    expect(context?.ageYears).toBeUndefined();
    expect(context?.age).toBe('10个月');
    expect(toConsultationPatient(context)).toMatchObject({
      ageText: '10个月',
      ageNum: undefined,
      ageUnit: undefined,
    });
  });

  it('preserves PHIS month and day units from a reception payload', () => {
    expect(buildPatientContext({
      payload: { idPi: 'patient-month', ageNum: 10, ageUnit: 'M' },
    })?.ageText).toBe('10个月');
    expect(buildPatientContext({
      payload: { idPi: 'patient-day', ageNum: 10, ageUnit: 'D' },
    })?.ageText).toBe('10天');
  });

  it('continues to derive ageYears for an explicit year unit', () => {
    const context = buildPatientContext({
      payload: { idPi: 'patient-adult', ageNum: 35, ageUnit: 'Y' },
    });

    expect(context?.ageText).toBe('35岁');
    expect(context?.ageYears).toBe(35);
  });

  it('does not guess years when the reception payload only contains a bare age number', () => {
    const context = buildPatientContext({
      payload: { idPi: 'patient-unknown-unit', age: '10' },
    });

    expect(context?.ageText).toBeUndefined();
    expect(context?.ageYears).toBeUndefined();
  });
});

describe('patientContext signing status', () => {
  it('keeps the neutral HIS signing status for chronic refill writeback', () => {
    expect(buildPatientContext({
      payload: { idPi: 'signed-patient' },
      hisInfo: {
        patientId: 'signed-patient',
        name: '已签约患者',
        gender: 'M',
        signed: true,
      },
    })?.signed).toBe(true);

    expect(buildPatientContext({
      payload: { idPi: 'unsigned-patient' },
      hisInfo: {
        patientId: 'unsigned-patient',
        name: '未签约患者',
        gender: 'M',
        signed: false,
      },
    })?.signed).toBe(false);
  });
});

describe('patientContext clinical history mapping', () => {
  it('preserves explicit personal and family history from the reception payload', () => {
    const context = buildPatientContext({
      payload: {
        idPi: 'patient-history',
        personalHistory: '吸烟20年，每日10支。',
        familyHistory: '父亲有高血压病史。',
      },
    });

    expect(context?.personalHistory).toBe('吸烟20年，每日10支。');
    expect(context?.clinical.personalHistory).toBe('吸烟20年，每日10支。');
    expect(context?.familyHistory).toBe('父亲有高血压病史。');
    expect(context?.clinical.familyHistory).toBe('父亲有高血压病史。');
  });

  it('prefers an explicit menstrual history and can recover it from the current record', () => {
    const explicit = buildPatientContext({
      payload: {
        idPi: 'female-explicit',
        sdSexText: '女性',
        menstrualHistory: '周期28天，经期5天。',
        currentOutpatientRecordText: '个人史：无特殊。\n月经史：周期30天。\n家族史：无特殊。',
      },
    });
    const fromRecord = buildPatientContext({
      payload: {
        idPi: 'female-record',
        sdSexText: '女性',
        currentOutpatientRecordText: '个人史：无特殊。\n月经史：周期30天，经期6天。\n家族史：无特殊。',
      },
    });

    expect(getPatientContextMenstrualHistory(explicit)).toBe('周期28天，经期5天。');
    expect(getPatientContextMenstrualHistory(fromRecord)).toBe('周期30天，经期6天');
    expect(extractMenstrualHistoryFromRecordText('个人史：无特殊。')).toBe('');
  });
});
