import { describe, expect, it } from 'vitest';
import { buildPatientContext, getPatientContextMaritalReproductiveHistory, getPatientContextMenstrualHistory } from '@/utils/patientContext';
import { buildRecordConfirmedPayload, type RecordConfirmedWritebackField } from './recordConfirmedPayload';
import { buildOutpatientRecord } from './outpatientRecord';
import { findConflictingOutpatientEmrRecordFieldMapping, resolveOutpatientEmrFieldMapping } from '../outpatient-emr/lib/outpatientEmrFieldMapping';

describe('independent female history generation and writeback', () => {
  it('extracts adjacent HIS sections and isolates a new patient', () => {
    const female = buildPatientContext({ payload: {
      patientId: 'female', gender: '女性',
      currentOutpatientRecordText: '个人史：无特殊。\n月经史：周期28天，经期5天。\n婚育史：已婚已育；目前未孕。\n家族史：无特殊。',
    } });
    expect(getPatientContextMenstrualHistory(female)).toBe('周期28天，经期5天');
    expect(getPatientContextMaritalReproductiveHistory(female)).toBe('已婚已育；目前未孕');
    const next = buildPatientContext({ existing: female, payload: { patientId: 'new-patient' } });
    expect(getPatientContextMaritalReproductiveHistory(next)).toBe('');
    expect(getPatientContextMenstrualHistory(next)).toBe('');
    const blank = buildPatientContext({ payload: { patientId: 'blank', maritalReproductiveHistory: '{婚育状况}，{怀孕标志}怀孕，{其他}' } });
    expect(getPatientContextMaritalReproductiveHistory(blank)).toBe('');
  });

  const record = { chiefComplaint: '复诊', historyOfPresentIllness: '今复诊。', pastMedicalHistory: '', menstrualHistory: '周期28天，经期5天。', maritalReproductiveHistory: '已婚已育；目前未孕；孕2产1。' };
  function payload(fields: RecordConfirmedWritebackField[], gender = '女性') {
    return buildRecordConfirmedPayload({
      ...record, consultationId: 'visit', patientGender: gender, diagList: [], orderList: [],
      writebackScope: { recordFields: fields, includeDiagnosis: false, orderTypes: [] },
    });
  }

  it('writes independent text fields and explicit select codes in one payload', () => {
    const result = payload(['menstrualHistory', 'maritalReproductiveHistory']);
    expect(result.outpatientRecord).toEqual({ schemaVersion: 'outpatient-record.v1', menstrualHistory: record.menstrualHistory, maritalReproductiveHistory: record.maritalReproductiveHistory });
    expect(result.emrFieldValues).toEqual({ 月经史文本: record.menstrualHistory, 婚育史文本: record.maritalReproductiveHistory, 婚育状况: '3', 怀孕标志: '0' });
    expect(result.orderList).toEqual([]);
  });

  it('does not leak the unselected field or dictionary values', () => {
    expect(payload(['menstrualHistory'])).not.toHaveProperty('maritalReproductiveHistory');
    expect(payload(['menstrualHistory']).emrFieldValues).toEqual({ 月经史文本: record.menstrualHistory });
    expect(payload(['maritalReproductiveHistory'])).not.toHaveProperty('menstrualHistory');
    expect(payload(['menstrualHistory', 'maritalReproductiveHistory'], '男性').emrFieldValues).toEqual({});
    const blank = buildOutpatientRecord({ chiefComplaint: '复诊', historyOfPresentIllness: '', patientGender: '女性' });
    expect(blank).not.toHaveProperty('menstrualHistory');
    expect(blank).not.toHaveProperty('maritalReproductiveHistory');
  });

  it('maps the supplied mixed dictionary/text article without conflicting ownership', () => {
    const fields = ['婚育状况', '怀孕标志', '婚育史文本'].map((id) => ({
      id, articleId: '婚育史', ...resolveOutpatientEmrFieldMapping({ fieldId: id, fieldName: id, articleId: '婚育史' }),
    }));
    expect(fields.every((field) => field.recordField === 'maritalReproductiveHistory' && field.projectionMode === 'section-compose')).toBe(true);
    expect(findConflictingOutpatientEmrRecordFieldMapping(fields)).toBeNull();
  });
});
