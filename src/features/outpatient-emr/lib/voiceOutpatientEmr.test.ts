import { describe, expect, it } from 'vitest';
import type { OutpatientEmrPreparedWritebackPayload } from '../types';
import {
  buildVoiceOutpatientEmrRecordContext,
  isPreparedOutpatientEmrWritebackPayload,
  resolveVoiceOutpatientEmrStartContext,
  summarizeOutpatientEmrCombinedWriteback,
} from './voiceOutpatientEmr';

const template = {
  templateId: 'TPL-001',
  templateName: '门诊模板',
  templateHtml: '  <section data-id="chief"></section>  ',
  templateDefinition: '  [{"ID":"chief"}]  ',
  targetFieldIds: ['chief'],
  requestId: 'REQ-001',
};

const preparedPayload: OutpatientEmrPreparedWritebackPayload = {
  consultationId: 'VIS-001',
  timestamp: 123,
  resultType: 'record-confirmed',
  requestId: 'REQ-001',
  referenceType: 'batch',
  action: 'batch',
  referenceStatus: 'pending',
  referenceMessage: '等待 HIS 回执',
  outpatientRecord: {
    schemaVersion: 'outpatient-record.v1',
    chiefComplaint: '咳嗽三天',
    historyOfPresentIllness: '受凉后咳嗽，伴少量白痰。',
  },
  diagList: [{
    idTet: 'PRIVATE-TET',
    idDiag: 'PRIVATE-DIAG-ID',
    naDiag: '急性上呼吸道感染',
    cdIcd10: 'J06.900',
    fgMain: '1',
    sdDiagText: '西医诊断',
  }],
  orderList: [{
    idSrv: 'PRIVATE-SERVICE-ID',
    idDeptExec: 'PRIVATE-DEPT-ID',
    sdSrv: '11',
    naSrv: '复方氨酚烷胺胶囊',
    doseOnce: '1',
    unitDose: '粒',
    takeDays: 3,
    amount: 1,
  }],
  treatmentPlan: '口服复方氨酚烷胺胶囊。',
  writebackScope: {
    recordFields: ['chiefComplaint', 'historyOfPresentIllness'],
    includeDiagnosis: true,
    orderTypes: ['medicine'],
  },
};

describe('voice outpatient EMR start contract', () => {
  it('accepts the exact six-field template and preserves both source strings', () => {
    expect(resolveVoiceOutpatientEmrStartContext({
      idPi: 'P001',
      idVis: 'VIS-001',
      outpatientEmr: template,
    })).toEqual({
      kind: 'ready',
      context: {
        visitId: 'VIS-001',
        template,
      },
    });
  });

  it('rejects missing visit identity, unknown fields, whitespace and duplicate targets', () => {
    expect(resolveVoiceOutpatientEmrStartContext({ outpatientEmr: template }))
      .toEqual(expect.objectContaining({ kind: 'invalid' }));
    expect(resolveVoiceOutpatientEmrStartContext({
      idVis: 'VIS-001',
      outpatientEmr: { ...template, unsupported: true },
    })).toEqual(expect.objectContaining({ kind: 'invalid' }));
    expect(resolveVoiceOutpatientEmrStartContext({
      idVis: 'VIS-001',
      outpatientEmr: { ...template, requestId: ' REQ-001' },
    })).toEqual(expect.objectContaining({ kind: 'invalid' }));
    expect(resolveVoiceOutpatientEmrStartContext({
      idVis: 'VIS-001',
      outpatientEmr: { ...template, targetFieldIds: ['chief', 'chief'] },
    })).toEqual(expect.objectContaining({ kind: 'invalid' }));
  });
});

describe('voice outpatient EMR prepared result', () => {
  it('builds clinical context without PHIS private primary keys', () => {
    const context = buildVoiceOutpatientEmrRecordContext(preparedPayload);
    const serialized = JSON.stringify(context);

    expect(context).toEqual({
      recordText: '主诉：咳嗽三天\n现病史：受凉后咳嗽，伴少量白痰。',
      sections: {
        chiefComplaint: '咳嗽三天',
        historyOfPresentIllness: '受凉后咳嗽，伴少量白痰。',
      },
      structuredFacts: {
        diagnoses: [{
          name: '急性上呼吸道感染',
          code: 'J06.900',
          category: '西医诊断',
          primary: '是',
        }],
        orders: [{
          type: '用药',
          name: '复方氨酚烷胺胶囊',
          dose: '1粒',
          days: 3,
          amount: 1,
        }],
        treatmentPlan: '口服复方氨酚烷胺胶囊。',
      },
    });
    expect(serialized).not.toContain('PRIVATE-TET');
    expect(serialized).not.toContain('PRIVATE-DIAG-ID');
    expect(serialized).not.toContain('PRIVATE-SERVICE-ID');
    expect(serialized).not.toContain('PRIVATE-DEPT-ID');
  });

  it('validates identity and summarizes the doctor-selected scope', () => {
    expect(isPreparedOutpatientEmrWritebackPayload(
      preparedPayload,
      'VIS-001',
      'REQ-001',
    )).toBe(true);
    expect(isPreparedOutpatientEmrWritebackPayload(
      preparedPayload,
      'VIS-OTHER',
      'REQ-001',
    )).toBe(false);
    expect(summarizeOutpatientEmrCombinedWriteback(preparedPayload)).toEqual({
      recordFieldCount: 2,
      diagnosisCount: 1,
      orderCount: 1,
    });
  });

  it('preserves confirmed history positives and collected vital signs as structured evidence', () => {
    const context = buildVoiceOutpatientEmrRecordContext({
      ...preparedPayload,
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
      physicalExamVitalSigns: {
        schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
        items: [{
          slotKey: 'temperature',
          value: '36.5',
          unit: '℃',
          marker: '{36.5}',
        }],
      },
    });

    expect(context.structuredFacts).toEqual(expect.objectContaining({
      historyTemplateChanges: {
        schemaVersion: 'outpatient-record-template-changes.v1',
        items: [{
          field: 'pastMedicalHistory',
          slotKey: 'hypertensionHistory',
          fromValue: '否认',
          toValue: '有',
        }],
      },
      physicalExamVitalSigns: {
        schemaVersion: 'outpatient-record-physical-exam-vitals.v1',
        items: [{ slotKey: 'temperature', value: '36.5' }],
      },
    }));
  });
});
