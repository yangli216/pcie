import { describe, expect, it, vi } from 'vitest';
import { buildChronicExaminationReminders } from './chronicExaminationReminders';
import { initClinicalTreatments } from '@features/clinical-result/clinicalResultInitialization';
import { buildOrderListItem, buildRecordConfirmedPayload, getOrderJsonField, getOrderMutualRecognitionCode } from '@features/clinical-result/recordConfirmedPayload';
import type { TreatmentRecommendation } from '@/types/consultation';
import type { MedicalItem } from '@/services/medicalData';

const now = new Date(2026, 9, 20, 12).getTime();
const day = 86400000;
const lab: MedicalItem = { id: 'lab', idSrv: 'srv-lab', code: 'LAB', name: '血脂', category: '检验',
  sdSrv: '41', idDeptExec: 'dept', jsonField: '{"idLisCategory":"lis","fgCombination":"0"}', mutualRecognitionCode: 'recognition', raw: { idLisCategory: 'lis' } };
const exam: MedicalItem = { id: 'exam', idSrv: 'srv-exam', code: 'EXAM', name: '心电图', category: '检查', sdSrv: '31', idPart: 'part', idDeptExec: 'dept' };
const recommendation = (name: string, subItems: string[] = []) => ({ name, subItems, description: '' });
function build(overrides: Partial<Parameters<typeof buildChronicExaminationReminders>[0]> = {}) {
  return buildChronicExaminationReminders({ recommendations: [recommendation('血脂')], catalog: [lab, exam], visits: [],
    currentVisitId: 'current', sourceStatus: 'ready', catalogStatus: 'ready', historyStatus: 'complete', now, ...overrides });
}

describe('chronic examination reminders', () => {
  it('retains the live catalog service identity, combination and recognition without selecting', () => {
    const result = build();
    expect(result.treatments[0]).toMatchObject({ type: 'labTest', selected: false, matchedItem: {
      id: 'lab', idSrv: 'srv-lab', jsonField: lab.jsonField, mutualRecognitionCode: 'recognition', raw: lab.raw,
    } });
    expect(result.reminders).toMatchObject({ regionalHistoryStatus: 'not_connected', historyStatus: 'complete' });
  });
  it('uses all returned visits, excludes current and outside-window visits, and never treats reported as a repeat ban', () => {
    const result = build({ visits: [
      { visitId: 'other-disease', visitTime: now - 2 * day, diagnoses: ['其他疾病'], reportedApplications: [
        { applicationId: 'a', name: '血脂', type: 'lab', status: 'reported', requestedAt: '2026-10-18' }] },
      { visitId: 'current', visitTime: now, reportedApplications: [{ applicationId: 'b', name: '血脂', type: 'lab', status: 'reported' }] },
      { visitId: 'old', visitTime: now - 91 * day, reportedApplications: [{ applicationId: 'c', name: '血脂', type: 'lab', status: 'reported' }] },
      { visitId: 'wrong-type', visitTime: now - day, reportedApplications: [{ applicationId: 'd', name: '血脂', type: 'exam', status: 'reported' }] },
    ] });
    expect(result.reminders.items[0].recentReports).toHaveLength(1);
    expect(result.reminders.items[0].recentReports[0].requestedAt).toBe('2026-10-18');
    expect(result.treatments).toHaveLength(1);
    expect(result.treatments[0].selected).toBe(false);
  });
  it('does not split groups, match by substrings, choose ambiguous names or admit restricted catalog items', () => {
    expect(build({ recommendations: [recommendation('血脂组合', ['血脂', '心电图'])] }).treatments).toEqual([]);
    expect(build({ catalog: [lab, { ...lab, id: 'second' }] }).reminders.items[0].matchStatus).toBe('ambiguous');
    expect(build({ catalog: [{ ...lab, restricted: true }] }).treatments).toEqual([]);
    expect(build({ catalog: [{ ...lab, name: '血脂四项' }] }).treatments).toEqual([]);
  });
  it('blocks a unique unverified combination rather than creating an order', () => {
    const result = build({ catalog: [{ ...lab, jsonField: '{"fgCombination":"2"}' }] });
    expect(result.treatments).toEqual([]);
    expect(result.reminders.items[0]).toMatchObject({ matchStatus: 'ambiguous', matchIssue: 'unverified_group' });
  });
  it('uses only the approved name family for historical reports and retains type/visit boundaries', () => {
    const result = build({ recommendations: [recommendation('同型半胱氨酸')],
      catalog: [{ ...lab, name: '血同型半胱氨酸测定' }], visits: [
        { visitId: 'prior', visitTime: now - day, reportedApplications: [
          { applicationId: 'good', name: '血同型半胱氨酸测定', type: 'lab', status: 'reported' },
          { applicationId: 'wrong-type', name: '同型半胱氨酸', type: 'exam', status: 'reported' },
          { applicationId: 'expanded', name: '血同型半胱氨酸测定（免费）', type: 'lab', status: 'reported' },
        ] },
      ] });
    expect(result.treatments[0]).toMatchObject({ name: '血同型半胱氨酸测定', selected: false });
    expect(result.reminders.items[0].recentReports.map(item => item.name)).toEqual(['血同型半胱氨酸测定']);
  });
  it('deduplicates approved concepts while retaining live catalog identity and default selection', () => {
    const result = build({ recommendations: [recommendation('同型半胱氨酸'), recommendation('血同型半胱氨酸测定')],
      catalog: [{ ...lab, name: '血同型半胱氨酸测定' }] });
    expect(result.reminders.items).toHaveLength(1);
    expect(result.treatments).toHaveLength(1);
    expect(result.treatments[0]).toMatchObject({ selected: false, matchedItem: { idSrv: lab.idSrv,
      jsonField: lab.jsonField, mutualRecognitionCode: lab.mutualRecognitionCode } });
  });
  it('never loses an unverified group child while deduplicating approved names', () => {
    const result = build({ recommendations: [recommendation('同型半胱氨酸', ['血糖']), recommendation('血同型半胱氨酸测定')],
      catalog: [{ ...lab, name: '血同型半胱氨酸测定' }] });
    expect(result.treatments).toEqual([]);
    expect(result.reminders.items[0].matchIssue).toBe('unverified_group');
  });
  it('writes only the explicitly selected approved aliases with their actual live IDs', () => {
    const result = build({ recommendations: [recommendation('糖化血红蛋白'), recommendation('同型半胱氨酸'), recommendation('心电图')],
      catalog: [
        { ...lab, id: 'hba', idSrv: 'srv-hba', name: '糖化血红蛋白测定' },
        { ...lab, id: 'hcy', idSrv: 'srv-hcy', name: '血同型半胱氨酸测定' },
        { ...exam, name: '常规心电图检查' },
      ] });
    const initialized = initClinicalTreatments(result.treatments, { assessCatalogMatch: vi.fn(), inferFrequency: () => '',
      inferRoute: () => '', normalize: value => value as TreatmentRecommendation, buildReason: () => '', shouldAutoSelect: () => true });
    expect(initialized).toHaveLength(3); expect(initialized.every(item => !item.selected)).toBe(true);
    initialized[0].selected = true; initialized[2].selected = true;
    const orders = initialized.filter(item => item.selected).map(item => buildOrderListItem(item, {
      getServiceId: rec => rec.matchedItem.idSrv, getServiceCode: rec => rec.matchedItem.sdSrv,
      getServiceName: rec => rec.matchedItem.name, getExecDeptId: rec => rec.matchedItem.idDeptExec,
      getPartId: rec => rec.matchedItem.idPart || '', getJsonField: getOrderJsonField,
    }));
    expect(orders.map(order => order.idSrv)).toEqual(['srv-hba', 'srv-exam']);
    expect(orders[0]).toMatchObject({ jsonField: lab.jsonField, mutualRecognitionCode: 'recognition' });
    expect(orders[1]).toMatchObject({ idPart: 'part', idDeptExec: 'dept' });
  });
  it('deduplicates recommendations without duplicating orders', () => {
    expect(build({ recommendations: [recommendation('血脂'), recommendation(' 血脂 ')] }).treatments).toHaveLength(1);
  });
  it('keeps source failure, valid empty, catalog failure and incomplete history distinguishable', () => {
    expect(build({ recommendations: [], sourceStatus: 'unavailable' }).reminders.sourceStatus).toBe('unavailable');
    expect(build({ recommendations: [] }).reminders.sourceStatus).toBe('ready');
    const failed = build({ catalogStatus: 'unavailable', historyStatus: 'partial' });
    expect(failed.treatments).toEqual([]);
    expect(failed.reminders).toMatchObject({ catalogStatus: 'unavailable', historyStatus: 'partial' });
    expect(failed.reminders.items[0].recentReports).toEqual([]);
  });
  it('uses existing initialization and sends only doctor-selected orders together with selected record fields', () => {
    const result = build({ recommendations: [recommendation('血脂'), recommendation('心电图')] });
    const assess = vi.fn();
    const initialized = initClinicalTreatments(result.treatments, { assessCatalogMatch: assess, inferFrequency: () => '',
      inferRoute: () => '', normalize: (value) => value as TreatmentRecommendation, buildReason: () => '', shouldAutoSelect: () => true });
    expect(initialized.every((item) => !item.selected)).toBe(true);
    expect(assess).not.toHaveBeenCalled();
    initialized[0].selected = true;
    const orders = initialized.filter((item) => item.selected).map((item) => buildOrderListItem(item, {
      getServiceId: (rec) => rec.matchedItem.idSrv, getServiceCode: (rec) => rec.matchedItem.sdSrv,
      getServiceName: (rec) => rec.matchedItem.name, getExecDeptId: (rec) => rec.matchedItem.idDeptExec,
      getPartId: (rec) => rec.matchedItem.idPart || '', getJsonField: getOrderJsonField,
    }));
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ idSrv: 'srv-lab', idDeptExec: 'dept', jsonField: lab.jsonField, mutualRecognitionCode: 'recognition' });
    expect(getOrderMutualRecognitionCode(initialized[1])).toBe('');
    const payload = buildRecordConfirmedPayload({ consultationId: 'current', requestId: 'one-batch',
      chiefComplaint: '高血压复诊配药', historyOfPresentIllness: '医生确认的随访内容', pastMedicalHistory: '',
      diagList: [], orderList: orders, extra: { referenceType: 'batch', action: 'batch', referenceStatus: 'pending' }, precautions: '医生编辑的监测建议',
      writebackScope: { recordFields: ['historyOfPresentIllness', 'precautions'], includeDiagnosis: false, orderTypes: ['lab_test'] } });
    expect(payload).toMatchObject({ resultType: 'record-confirmed', requestId: 'one-batch', referenceType: 'batch',
      orderList: orders, outpatientRecord: { historyOfPresentIllness: '医生确认的随访内容', precautions: '医生编辑的监测建议' } });
    expect(payload).not.toHaveProperty('diagList');
    expect(payload).not.toHaveProperty('chronicExaminationReminders');
  });
});
