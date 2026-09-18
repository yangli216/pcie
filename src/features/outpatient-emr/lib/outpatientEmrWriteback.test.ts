// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrTemplateField,
} from '../types';
import {
  buildOutpatientEmrRecordConfirmedPayload,
  hashOutpatientEmrTemplate,
  normalizeOutpatientEmrModelValues,
} from './outpatientEmrWriteback';

const fields: OutpatientEmrTemplateField[] = [
  {
    id: 'personalHistory',
    name: '个人史',
    type: 'text',
    articleTemplateId: 'article-personal-history',
    articleId: '个人史',
    articleName: '个人史',
    articleDefinitionName: '个人史',
    readonly: false,
    aiSuitable: true,
    baselineValue: '模板个人史',
    baselineDictionaryValue: '',
    dictionaryItems: [],
    recordField: 'personalHistory',
    mappingSource: 'canonical-id',
    projectionMode: 'direct',
  },
  {
    id: 'familyHistory',
    name: '家族史',
    type: 'text',
    articleTemplateId: 'article-family-history',
    articleId: '家族史',
    articleName: '家族史',
    articleDefinitionName: '家族史',
    readonly: false,
    aiSuitable: true,
    baselineValue: '模板家族史',
    baselineDictionaryValue: '',
    dictionaryItems: [],
    recordField: 'familyHistory',
    mappingSource: 'canonical-id',
    projectionMode: 'direct',
  },
];

const request: OutpatientEmrAnalysisRequest = {
  visitId: 'VIS-001',
  templateId: 'TPL-001',
  templateName: '门诊通用病历',
  templateHtml: '<div>secret html</div>',
  templateDefinition: '[{"NAME":"secret definition"}]',
  targetFieldIds: ['personalHistory', 'familyHistory'],
  recordContext: { recordText: 'secret context' },
  requestId: 'REQ-001',
};

describe('outpatient EMR model output normalization', () => {
  it('rejects a non-object model result instead of replacing it with template baselines', () => {
    expect(() => normalizeOutpatientEmrModelValues('not-an-object', fields))
      .toThrowError(/必须是模板字段 JSON 对象/);
  });

  it('drops unknown/non-string values and retains baselines for empty values', () => {
    expect(normalizeOutpatientEmrModelValues({
      personalHistory: '  已戒烟2年。  ',
      familyHistory: [],
      outside: '不得返回',
    }, fields)).toEqual({
      personalHistory: '已戒烟2年。',
      familyHistory: '模板家族史',
    });

    expect(normalizeOutpatientEmrModelValues({
      personalHistory: '   ',
      familyHistory: '',
    }, fields)).toEqual({
      personalHistory: '模板个人史',
      familyHistory: '模板家族史',
    });
  });

  it('canonicalizes explicit dictionary codes or labels without inheriting template selections', () => {
    const constrainedFields: OutpatientEmrTemplateField[] = [{
      id: '肝炎史标志',
      name: '肝炎史标志',
      type: 'select',
      articleTemplateId: 'article-past-history',
      articleId: '既往史',
      articleName: '既往史',
      articleDefinitionName: '既往史',
      readonly: false,
      aiSuitable: true,
      baselineValue: '否认',
      baselineDictionaryValue: '0',
      dictionaryItems: [
        { value: '0', text: '否认' },
        { value: '1', text: '患有' },
      ],
      recordField: 'pastMedicalHistory',
      mappingSource: 'deterministic-article',
      projectionMode: 'section-compose',
    }, {
      id: '月经规则标志',
      name: '月经规则标志',
      type: 'select',
      articleTemplateId: 'article-menstrual-history',
      articleId: '月经史',
      articleName: '月经史',
      articleDefinitionName: '月经史',
      readonly: false,
      aiSuitable: true,
      baselineValue: '平时月经规则',
      baselineDictionaryValue: '1',
      dictionaryItems: [
        { value: '1', text: '平时月经规则' },
        { value: '2', text: '月经不规则' },
      ],
      recordField: 'menstrualHistory',
      mappingSource: 'deterministic-article',
      projectionMode: 'section-compose',
    }];

    expect(() => normalizeOutpatientEmrModelValues({
      肝炎史标志: '模型自造值',
    }, constrainedFields)).toThrowError(/缺少字典字段 月经规则标志/);
    expect(normalizeOutpatientEmrModelValues({
      肝炎史标志: '模型自造值',
      月经规则标志: '',
    }, constrainedFields)).toEqual({
      肝炎史标志: '',
      月经规则标志: '',
    });
    expect(normalizeOutpatientEmrModelValues({
      肝炎史标志: '1',
      月经规则标志: '2',
    }, constrainedFields)).toEqual({
      肝炎史标志: '患有',
      月经规则标志: '月经不规则',
    });
  });
});

describe('outpatient EMR writeback payload', () => {
  it('hashes both exact UTF-8 sources into one ordered template-pair identity', async () => {
    await expect(hashOutpatientEmrTemplate('abc', 'def')).resolves.toBe(
      'ef0f131b2e53f51707ac30274574fa4842175941469261498a0a2eafb33f1e28',
    );
  });

  it('returns only scoped plain field parameters and template identity', () => {
    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'raw-template-hash',
      fields,
      fieldValues: {
        personalHistory: '医生确认个人史',
        familyHistory: '模板家族史',
        outside: '不得泄漏',
      },
      timestamp: 123,
    });

    expect(payload).toEqual({
      consultationId: 'VIS-001',
      visitId: 'VIS-001',
      timestamp: 123,
      resultType: 'record-confirmed',
      requestId: 'REQ-001',
      referenceType: 'batch',
      action: 'batch',
      referenceStatus: 'pending',
      referenceMessage: '等待 HIS 完成门诊模板参数回填并回执',
      emrType: 'outpatient-emr',
      templateMetadata: {
        schemaVersion: 'outpatient-emr-template-pair.v1',
        templateId: 'TPL-001',
        templateName: '门诊通用病历',
        templateHash: 'raw-template-hash',
        fields: [
          {
            id: 'personalHistory',
            name: '个人史',
            type: 'text',
            articleTemplateId: 'article-personal-history',
            articleId: '个人史',
            articleName: '个人史',
            articleDefinitionName: '个人史',
            dictionaryItems: [],
            recordField: 'personalHistory',
            mappingSource: 'canonical-id',
            projectionMode: 'direct',
          },
          {
            id: 'familyHistory',
            name: '家族史',
            type: 'text',
            articleTemplateId: 'article-family-history',
            articleId: '家族史',
            articleName: '家族史',
            articleDefinitionName: '家族史',
            dictionaryItems: [],
            recordField: 'familyHistory',
            mappingSource: 'canonical-id',
            projectionMode: 'direct',
          },
        ],
      },
      fieldValues: {
        personalHistory: '医生确认个人史',
        familyHistory: '模板家族史',
      },
      dictionarySelections: {},
      emrFieldValues: {
        personalHistory: '医生确认个人史',
        familyHistory: '模板家族史',
      },
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        personalHistory: '医生确认个人史',
        familyHistory: '模板家族史',
      },
      writebackScope: {
        recordFields: ['personalHistory', 'familyHistory'],
        includeDiagnosis: false,
        orderTypes: [],
      },
      orderList: [],
    });
    expect(JSON.stringify(payload)).not.toContain('secret html');
    expect(JSON.stringify(payload)).not.toContain('secret definition');
    expect(JSON.stringify(payload)).not.toContain('secret context');
    expect(JSON.stringify(payload)).not.toContain('outside');
  });

  it('keeps unmapped fields in fieldValues without inventing a fixed projection', () => {
    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: [{
        id: 'specialtySupplement',
        name: '专科补充描述',
        type: 'text',
        articleTemplateId: 'article-specialty-exam',
        articleId: '专科检查',
        articleName: '专科检查',
        articleDefinitionName: '专科检查',
        readonly: false,
        aiSuitable: true,
        baselineValue: '',
        baselineDictionaryValue: '',
        dictionaryItems: [],
        recordField: null,
        mappingSource: 'unmapped',
        projectionMode: null,
      }],
      fieldValues: { specialtySupplement: '双肺呼吸音粗。' },
      timestamp: 123,
    });

    expect(payload.fieldValues).toEqual({ specialtySupplement: '双肺呼吸音粗。' });
    expect(payload.dictionarySelections).toEqual({});
    expect(payload).not.toHaveProperty('outpatientRecord');
    expect(payload.writebackScope).toEqual({
      recordFields: [],
      includeDiagnosis: false,
      orderTypes: [],
    });
  });

  it('merges dynamic template values with one doctor-selected voice writeback without widening scope', () => {
    const baseWritebackPayload: OutpatientEmrPreparedWritebackPayload = {
      consultationId: 'VIS-001',
      timestamp: 100,
      resultType: 'record-confirmed',
      requestId: 'REQ-001',
      referenceType: 'batch',
      action: 'batch',
      referenceStatus: 'pending',
      referenceMessage: '等待 HIS 完成已选内容回写并回执。',
      outpatientRecord: {
        schemaVersion: 'outpatient-record.v1',
        personalHistory: '语音确认个人史',
      },
      diagList: [{
        idDiag: 'DIAG-001',
        naDiag: '急性上呼吸道感染',
        cdIcd10: 'J06.900',
        fgMain: '1',
      }],
      orderList: [{
        idSrv: 'MED-001',
        naSrv: '复方氨酚烷胺胶囊',
        sdSrv: '11',
        amount: 1,
      }],
      treatmentPlan: '用药：复方氨酚烷胺胶囊。',
      emrFieldValues: {
        个人史文本: '语音确认个人史',
        高血压病史标志: '1',
      },
      recordTemplateChanges: { stale: true },
      writebackScope: {
        recordFields: ['personalHistory'],
        includeDiagnosis: true,
        orderTypes: ['medicine'],
      },
    };
    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields,
      fieldValues: {
        personalHistory: '模板确认个人史',
        familyHistory: '模板确认家族史',
      },
      timestamp: 200,
      baseWritebackPayload,
    });

    expect(payload.timestamp).toBe(200);
    expect(payload.requestId).toBe('REQ-001');
    expect(payload.referenceMessage).toBe('等待 HIS 完成动态模板及已选诊疗内容回写并回执');
    expect(payload.fieldValues).toEqual({
      personalHistory: '模板确认个人史',
      familyHistory: '模板确认家族史',
    });
    expect(payload.emrFieldValues).toEqual({
      个人史文本: '语音确认个人史',
      高血压病史标志: '1',
      personalHistory: '模板确认个人史',
      familyHistory: '模板确认家族史',
    });
    expect(payload.outpatientRecord).toEqual({
      schemaVersion: 'outpatient-record.v1',
      personalHistory: '模板确认个人史',
    });
    expect(payload.writebackScope).toEqual({
      recordFields: ['personalHistory'],
      includeDiagnosis: true,
      orderTypes: ['medicine'],
    });
    expect(payload.diagList).toEqual(baseWritebackPayload.diagList);
    expect(payload.orderList).toEqual(baseWritebackPayload.orderList);
    expect(payload).not.toHaveProperty('recordTemplateChanges');
    expect(payload.outpatientRecord).not.toHaveProperty('familyHistory');
  });

  it('fails closed if a caller bypasses parsing with duplicate standard mappings', () => {
    expect(() => buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: [
        fields[0],
        { ...fields[0], id: 'personalHistoryDuplicate' },
      ],
      fieldValues: {},
      timestamp: 123,
    })).toThrowError(/多个模板字段对同一标准字段 personalHistory 形成歧义/);
  });

  it('projects multiple structured fields from one article into one fixed record section', () => {
    const sectionFields: OutpatientEmrTemplateField[] = [
      {
        id: '肝炎史标志',
        name: '肝炎史标志',
        type: 'select',
        articleTemplateId: 'article-past-history',
        articleId: '既往史',
        articleName: '既往史',
        articleDefinitionName: '既往史',
        readonly: false,
        aiSuitable: true,
        baselineValue: '否认',
        baselineDictionaryValue: '0',
        dictionaryItems: [
          { value: '0', text: '否认' },
          { value: '1', text: '患有' },
        ],
        recordField: 'pastMedicalHistory',
        mappingSource: 'deterministic-article',
        projectionMode: 'section-compose',
      },
      {
        id: '高血压病史补充',
        name: '高血压病史补充',
        type: 'text',
        articleTemplateId: 'article-past-history',
        articleId: '既往史',
        articleName: '既往史',
        articleDefinitionName: '既往史',
        readonly: false,
        aiSuitable: true,
        baselineValue: '',
        baselineDictionaryValue: '',
        dictionaryItems: [],
        recordField: 'pastMedicalHistory',
        mappingSource: 'deterministic-article',
        projectionMode: 'section-compose',
      },
    ];

    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: sectionFields,
      fieldValues: {
        肝炎史标志: '否认',
        高血压病史补充: '高血压 5 年，规律服药',
      },
      timestamp: 123,
    });

    expect(payload.outpatientRecord?.pastMedicalHistory).toBe(
      '肝炎史：否认；高血压病史补充：高血压 5 年，规律服药',
    );
    expect(payload.writebackScope.recordFields).toEqual(['pastMedicalHistory']);
    expect(payload.dictionarySelections).toEqual({
      肝炎史标志: { value: '0', text: '否认' },
    });
    expect(payload.emrFieldValues).toEqual({
      肝炎史标志: '0',
      高血压病史补充: '高血压 5 年，规律服药',
    });
  });

  it('rejects an empty or out-of-dictionary final value instead of returning an invalid parameter', () => {
    const dictionaryField: OutpatientEmrTemplateField = {
      id: '婚育状况',
      name: '婚育状况',
      type: 'select',
      articleTemplateId: 'article-marriage-history',
      articleId: '婚育史',
      articleName: '婚育史',
      articleDefinitionName: '婚育史',
      readonly: false,
      aiSuitable: true,
      baselineValue: '',
      baselineDictionaryValue: '',
      dictionaryItems: [
        { value: '1', text: '未婚未育' },
        { value: '2', text: '已婚未育' },
        { value: '3', text: '已婚已育' },
      ],
      recordField: null,
      mappingSource: 'unmapped',
      projectionMode: null,
    };

    expect(() => buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: [dictionaryField],
      fieldValues: { 婚育状况: '' },
      timestamp: 123,
    })).toThrowError(/必须选择一个已有字典项/);

    expect(() => buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: [dictionaryField],
      fieldValues: { 婚育状况: '模型自造值' },
      timestamp: 123,
    })).toThrowError(/必须选择一个已有字典项/);

    expect(() => buildOutpatientEmrRecordConfirmedPayload({
      request,
      templateHash: 'hash',
      fields: [{
        ...dictionaryField,
        baselineValue: '未婚未育',
        baselineDictionaryValue: '1',
      }],
      fieldValues: {},
      timestamp: 123,
    })).toThrowError(/医生最终值缺少模板字段/);
  });

  it('honors the renderer target list without reinterpreting patient gender', () => {
    const menstrualField: OutpatientEmrTemplateField = {
      id: '月经规则标志',
      name: '月经规则标志',
      type: 'select',
      articleTemplateId: 'article-menstrual-history',
      articleId: '月经史',
      articleName: '月经史',
      articleDefinitionName: '月经史',
      readonly: false,
      aiSuitable: true,
      baselineValue: '平时月经规则',
      baselineDictionaryValue: '1',
      dictionaryItems: [
        { value: '1', text: '平时月经规则' },
        { value: '2', text: '月经不规则' },
      ],
      recordField: 'menstrualHistory',
      mappingSource: 'deterministic-article',
      projectionMode: 'section-compose',
    };
    const payload = buildOutpatientEmrRecordConfirmedPayload({
      request: {
        ...request,
        patient: { sdSexText: '男性' },
      },
      templateHash: 'hash',
      fields: [menstrualField],
      fieldValues: { 月经规则标志: '平时月经规则' },
      timestamp: 123,
    });

    expect(payload.fieldValues).toEqual({ 月经规则标志: '平时月经规则' });
    expect(payload.dictionarySelections).toEqual({
      月经规则标志: { value: '1', text: '平时月经规则' },
    });
    expect(payload.outpatientRecord).toEqual({
      schemaVersion: 'outpatient-record.v1',
      menstrualHistory: '月经规则：平时月经规则',
    });
    expect(payload.writebackScope.recordFields).toEqual(['menstrualHistory']);
  });
});
