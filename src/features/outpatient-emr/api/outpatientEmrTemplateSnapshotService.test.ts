import { syntheticFieldPolicy, syntheticReceipt } from '@/test/template-parsing/outpatientFieldPolicyFixture';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrTemplateParseResult,
} from '../types';
import {
  buildOutpatientEmrTemplateSnapshotResolveRequest,
  buildOutpatientEmrTemplateSnapshotRequest,
  persistOutpatientEmrTemplateSnapshot,
  resolveOutpatientEmrTemplateSnapshot,
} from './outpatientEmrTemplateSnapshotService';

const regionalMocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock('@/services/regionalClient', () => ({
  regionalPost: regionalMocks.post,
}));

const request: OutpatientEmrAnalysisRequest = {
  visitId: 'VIS-001',
  templateId: 'TPL-001',
  templateName: '门诊模板',
  templateHtml: '<section data-id="article-chief" data-article="主诉" data-name="主诉">咳嗽</section>',
  templateDefinition: '[{"ID":"article-chief","NAME":"主诉","ARTICLE":"主诉","eles":[]}]',
  targetFieldIds: ['chiefComplaint'],
  recordContext: { recordText: '患者咳嗽3天。' },
  patient: { idPi: 'PATIENT-001', name: '测试患者' },
  requestId: 'REQ-001',
};

const template: OutpatientEmrTemplateParseResult = {
  sanitizedHtml: '<div data-id="chiefComplaint" data-type="text">咳嗽</div>',
  fields: [
    {
      id: 'chiefComplaint',
      name: '主诉',
      type: 'text',
      articleTemplateId: 'article-chief',
      articleId: 'chiefComplaint',
      articleName: '主诉',
      articleDefinitionName: '主诉',
      readonly: false,
      aiSuitable: true,
      baselineValue: '咳嗽',
      baselineDictionaryValue: '',
      dictionaryItems: [],
      recordField: 'chiefComplaint',
      mappingSource: 'canonical-id',
      projectionMode: 'direct',
    },
    {
      id: 'headerName',
      name: '姓名',
      type: 'text',
      articleTemplateId: 'article-header',
      articleId: 'header',
      articleName: '页眉',
      articleDefinitionName: '页眉',
      readonly: true,
      aiSuitable: false,
      baselineValue: '',
      baselineDictionaryValue: '',
      dictionaryItems: [],
      recordField: null,
      mappingSource: 'unmapped',
      projectionMode: null,
    },
  ],
  targetFields: [],
};

describe('outpatientEmrTemplateSnapshotService', () => {
  beforeEach(() => {
    regionalMocks.post.mockReset();
  });

  it('builds a template-only snapshot with all parsed fields', () => {
    const payload = buildOutpatientEmrTemplateSnapshotRequest({
      request,
      template,
      templateHash: 'a'.repeat(64),
    });

    expect(payload.parseResult.fields).toHaveLength(2);
    expect(payload).toEqual(expect.objectContaining({
      schemaVersion: 'outpatient-emr-template-pair-snapshot.v2',
      templateId: 'TPL-001',
      templateHtml: request.templateHtml,
      templateDefinition: request.templateDefinition,
    }));
    expect(payload).not.toHaveProperty('visitId');
    expect(payload).not.toHaveProperty('requestId');
    expect(payload).not.toHaveProperty('patient');
    expect(payload).not.toHaveProperty('recordContext');
    expect(payload).not.toHaveProperty('fieldValues');
  });

  it('uses the signed regional client endpoint', async () => {
    regionalMocks.post.mockResolvedValueOnce({
      ...syntheticReceipt({ request, template, templateHash: 'a'.repeat(64) }),
      id: 'snapshot-1',
      templateHash: 'a'.repeat(64),
      deduplicated: false,
      receivedAt: 1,
    });

    await persistOutpatientEmrTemplateSnapshot({
      request,
      template,
      templateHash: 'a'.repeat(64),
    });

    expect(regionalMocks.post).toHaveBeenCalledWith(
      '/v1/client/outpatient-emr/templates/snapshots',
      expect.objectContaining({
        schemaVersion: 'outpatient-emr-template-pair-snapshot.v2',
        templateId: 'TPL-001',
      }),
    );
  });

  it('resolves an exact historical parse snapshot through the signed endpoint', async () => {
    const templateHash = 'b'.repeat(64);
    const parseResult = buildOutpatientEmrTemplateSnapshotRequest({
      request,
      template,
      templateHash,
    }).parseResult;
    regionalMocks.post.mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
      cacheHit: true, fieldPolicy: syntheticFieldPolicy(template.fields),
      id: 'snapshot-history',
      templateId: request.templateId,
      templateHash,
      parseResult,
      receivedAt: 2,
    });

    const result = await resolveOutpatientEmrTemplateSnapshot({
      templateId: request.templateId,
      templateHash,
    });

    expect(buildOutpatientEmrTemplateSnapshotResolveRequest({
      templateId: request.templateId,
      templateHash,
    })).toEqual({
      schemaVersion: 'outpatient-emr-template-pair-resolve.v2',
      templateId: request.templateId,
      templateHash,
    });
    expect(regionalMocks.post).toHaveBeenCalledWith(
      '/v1/client/outpatient-emr/templates/snapshots/resolve',
      {
        schemaVersion: 'outpatient-emr-template-pair-resolve.v2',
        templateId: request.templateId,
        templateHash,
      },
    );
    expect(result.cacheHit).toBe(true);
    expect(result.parseResult?.fields).toHaveLength(2);
  });

  it('identifies legacy servers on both resolve and registration', async () => {
    const templateHash = 'b'.repeat(64);
    regionalMocks.post.mockResolvedValueOnce({ schemaVersion: 'outpatient-emr-template-pair-resolution.v1' })
      .mockResolvedValueOnce({ schemaVersion: 'outpatient-emr-template-pair-receipt.v1' });
    await expect(resolveOutpatientEmrTemplateSnapshot({ templateId: request.templateId, templateHash })).rejects.toThrow('请先升级 PCIE Server');
    await expect(persistOutpatientEmrTemplateSnapshot({ request, template, templateHash })).rejects.toThrow('请先升级 PCIE Server');
  });

  it('accepts a server manual-override mapping on a historical hit', async () => {
    const templateHash = 'd'.repeat(64);
    const parseResult = buildOutpatientEmrTemplateSnapshotRequest({
      request,
      template,
      templateHash,
    }).parseResult;
    parseResult.fields[0] = {
      ...parseResult.fields[0],
      recordField: 'historyOfPresentIllness',
      mappingSource: 'manual-override',
      projectionMode: 'section-compose',
    };
    regionalMocks.post.mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
      cacheHit: true, fieldPolicy: syntheticFieldPolicy(template.fields),
      id: 'snapshot-manual',
      templateId: request.templateId,
      templateHash,
      parseResult,
      receivedAt: 4,
    });

    const result = await resolveOutpatientEmrTemplateSnapshot({
      templateId: request.templateId,
      templateHash,
    });

    expect(result.parseResult?.fields[0]).toEqual(expect.objectContaining({
      recordField: 'historyOfPresentIllness',
      mappingSource: 'manual-override',
      projectionMode: 'section-compose',
    }));
  });

  it('preserves independent historical fields alongside malformed or ambiguous metadata', async () => {
    const templateHash = 'a'.repeat(64);
    const [valid, ambiguous] = buildOutpatientEmrTemplateSnapshotRequest({ request, template, templateHash }).parseResult.fields;
    regionalMocks.post.mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
      cacheHit: true, fieldPolicy: syntheticFieldPolicy(template.fields), id: 'snapshot-partial', templateId: request.templateId, templateHash, receivedAt: 8,
      parseResult: {
        schemaVersion: 'outpatient-emr-template-pair.v1',
        fields: [valid, ambiguous, { id: ambiguous.id, readonly: 'broken' }, null],
      },
    });
    const resolved = await resolveOutpatientEmrTemplateSnapshot({ templateId: request.templateId, templateHash });
    expect(resolved.parseResult?.fields).toEqual([valid]);
  });

  it('never registers a manual-override mapping into the immutable automatic parse', () => {
    expect(() => buildOutpatientEmrTemplateSnapshotRequest({
      request,
      template: {
        ...template,
        fields: [{ ...template.fields[0], mappingSource: 'manual-override' }, template.fields[1]],
      },
      templateHash: 'e'.repeat(64),
    })).toThrow('人工映射不能登记');
  });

  it('returns only an explicit miss and rejects malformed historical responses', async () => {
    const templateHash = 'c'.repeat(64);
    regionalMocks.post.mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
      cacheHit: false,
      fieldPolicy: null, id: null,
      templateId: request.templateId,
      templateHash,
      parseResult: null,
      receivedAt: null,
    });

    await expect(resolveOutpatientEmrTemplateSnapshot({
      templateId: request.templateId,
      templateHash,
    })).resolves.toEqual(expect.objectContaining({
      cacheHit: false,
      parseResult: null,
    }));

    regionalMocks.post.mockResolvedValueOnce({
      schemaVersion: 'outpatient-emr-template-pair-resolution.v2',
      cacheHit: true, fieldPolicy: syntheticFieldPolicy(template.fields),
      id: 'snapshot-broken',
      templateId: request.templateId,
      templateHash,
      parseResult: null,
      receivedAt: 3,
    });

    await expect(resolveOutpatientEmrTemplateSnapshot({
      templateId: request.templateId,
      templateHash,
    })).rejects.toThrow('parseResult');
  });
});
