// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeOutpatientEmrFields } from '@features/outpatient-emr/api/outpatientEmrService';
import { buildEditableOutpatientEmrPreviewHtml } from '@features/outpatient-emr/lib/outpatientEmrTemplate';
import { useOutpatientEmrAnalysis } from '@features/outpatient-emr/model/useOutpatientEmrAnalysis';
import type { OutpatientEmrAnalysisRequest } from '@features/outpatient-emr/types';
import { deliverToOutpatientSdk } from './outpatientSdkHarness';
// Exact serialized admin/device exchange from OutpatientEmrTemplateSnapshotServiceTest.
import wire from './fixtures/emr-field-visibility-wire.json';

const boundary = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/services/regionalClient', () => ({ regionalPost: boundary.post }));
const request: OutpatientEmrAnalysisRequest = {
  templateId: wire.request.templateId, templateName: wire.request.templateName,
  templateHtml: wire.request.templateHtml, templateDefinition: wire.request.templateDefinition,
  visitId: 'SYN-VISIBILITY-VISIT', requestId: 'SYN-VISIBILITY-REQUEST', targetFieldIds: ['chiefComplaint'],
  recordContext: { recordText: '合成资料：咳嗽3天' },
};

beforeEach(() => { boundary.post.mockReset(); });

describe('admin field visibility → device → render → SDK', () => {
  it.each([true, false])('retains hidden fields in generation and writeback (cache hit=%s)', async hit => {
    boundary.post.mockImplementation((path, body) => {
      expect(body.supportsFieldVisibility).toBe(true);
      expect(body.templateHash).toBe(wire.request.templateHash);
      if (path.endsWith('/resolve')) return hit ? wire.resolved : {
        schemaVersion: 'outpatient-emr-template-pair-resolution.v2', cacheHit: false,
        id: null, templateId: request.templateId, templateHash: body.templateHash,
        parseResult: null, fieldPolicy: null, receivedAt: null,
      };
      expect(path).toBe('/v1/client/outpatient-emr/templates/snapshots');
      expect(body.parseResult.fields[0]).not.toHaveProperty('visible');
      return wire.registered;
    });
    const model = vi.fn().mockResolvedValue('{"chiefComplaint":"咳嗽3天"}');
    const analysis = useOutpatientEmrAnalysis({ analyzeFields: input => analyzeOutpatientEmrFields(input, { chatFast: model }) });
    await expect(analysis.start(request)).resolves.toBe(true);
    expect(analysis.targetFields.value[0]).toMatchObject({ id: 'chiefComplaint', visible: false, aiSuitable: true });
    expect(model).toHaveBeenCalledOnce();
    expect(model.mock.calls[0][0][1].content).toContain('合成资料：咳嗽3天');
    expect(model.mock.calls[0][0][1].content).toContain('chiefComplaint');
    expect(analysis.fieldValues.value.chiefComplaint).toBe('咳嗽3天');
    const template = analysis.template.value!;
    const preview = buildEditableOutpatientEmrPreviewHtml(template.sanitizedHtml, template.targetFields, analysis.fieldValues.value);
    expect(preview).not.toContain('data-id="chiefComplaint"');
    expect(preview).not.toContain('咳嗽3天');
    expect(template.sanitizedHtml).toContain('chiefComplaint');
    const payload = analysis.buildConfirmedPayload()!;
    expect(payload.fieldValues.chiefComplaint).toBe('咳嗽3天');
    await expect(deliverToOutpatientSdk(request, payload)).resolves.toEqual(payload);
  });

  it('keeps the display setting when generation is disabled', async () => {
    boundary.post.mockResolvedValue(wire.disabled);
    const model = vi.fn();
    const analysis = useOutpatientEmrAnalysis({ analyzeFields: model });
    await expect(analysis.start(request)).resolves.toBe(true);
    expect(analysis.template.value?.fields[0]).toMatchObject({ visible: false, aiSuitable: false });
    expect(model).not.toHaveBeenCalled();
  });
});
