import type { OutpatientEmrTemplateSource } from '../api/outpatientEmrTemplateDecodeService';
import type { persistOutpatientEmrTemplateSnapshot, resolveOutpatientEmrTemplateSnapshot } from '../api/outpatientEmrTemplateSnapshotService';
import { OutpatientEmrError, type parseOutpatientEmrTemplate, type restoreOutpatientEmrTemplateFromSnapshot } from './outpatientEmrTemplate';
import type { hashOutpatientEmrTemplate } from './outpatientEmrWriteback';
import type { OutpatientEmrAnalysisRequest, OutpatientEmrTemplateParseResult, OutpatientFieldPolicy } from '../types';

import { isAdministrativeTemplateSlot } from './outpatientEmrPromptGenerator';

interface PreparationDependencies {
  hashTemplate: typeof hashOutpatientEmrTemplate;
  resolveTemplateSnapshot: typeof resolveOutpatientEmrTemplateSnapshot;
  restoreTemplateFromSnapshot: typeof restoreOutpatientEmrTemplateFromSnapshot;
  parseTemplate: typeof parseOutpatientEmrTemplate;
  persistTemplateSnapshot: typeof persistOutpatientEmrTemplateSnapshot;
}

export interface PreparedOutpatientEmrTemplate {
  template: OutpatientEmrTemplateParseResult;
  source: OutpatientEmrTemplateSource;
  templateHash: string;
}

function withPolicy(template: OutpatientEmrTemplateParseResult, policy: OutpatientFieldPolicy, snapshotId: string): OutpatientEmrTemplateParseResult {
  const byId = new Map(policy.fields.map(rule => [rule.fieldId, rule]));
  const fields = template.fields.map(field => {
    const generationRule = byId.get(field.id);
    const visible = policy.fieldVisibility?.[field.id] !== false;
    const protectedSlot = isAdministrativeTemplateSlot(field.id, field.name,
      [field.articleId, field.articleTemplateId, field.articleName, field.articleDefinitionName]);
    const aiSuitable = policy.templateState === 'enabled' && !protectedSlot && !field.readonly && generationRule?.aiSuitable === true;
    if (!generationRule) {
      const policyDisposition = policy.templateState === 'enabled' ? 'unresolved' as const : 'inactive' as const;
      return { ...field, aiSuitable, visible, policyDisposition };
    }
    return { ...field, aiSuitable, visible, generationRule };
  });
  const targets = new Set(template.targetFields.map(field => field.id));
  return { ...template, fields, targetFields: fields.filter(field => targets.has(field.id)), fieldPolicy: policy, snapshotId };
}

/** Both outpatient entry points resolve approved mappings, or register a new local parse, before generation. */
export async function prepareOutpatientEmrTemplate(
  request: OutpatientEmrAnalysisRequest, source: OutpatientEmrTemplateSource,
  deps: PreparationDependencies, isCurrent: () => boolean, onHashed?: (hash: string) => void,
): Promise<PreparedOutpatientEmrTemplate | undefined> {
  const templateHash = await deps.hashTemplate(source.templateHtml, source.templateDefinition);
  if (!isCurrent()) return;
  onHashed?.(templateHash);
  let resolution: Awaited<ReturnType<typeof resolveOutpatientEmrTemplateSnapshot>>;
  try {
    resolution = await deps.resolveTemplateSnapshot({ templateId: request.templateId, templateHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OutpatientEmrError('TEMPLATE_SNAPSHOT_FAILED', `历史模板解析查询失败，尚未启动模型分析：${message}`);
  }
  if (!isCurrent()) return;
  if (resolution.cacheHit) {
    if (!resolution.id || !resolution.parseResult || !resolution.fieldPolicy) {
      throw new OutpatientEmrError('TEMPLATE_SNAPSHOT_FAILED', '历史模板解析命中但缺少完整字段快照，尚未启动模型分析。');
    }
    const template = deps.restoreTemplateFromSnapshot(
      source.templateHtml, resolution.parseResult.fields, request.targetFieldIds, source.templateDefinition,
    );
    return { source, template: withPolicy(template, resolution.fieldPolicy, resolution.id), templateHash };
  }
  const template = deps.parseTemplate(source.templateHtml, source.templateDefinition, request.targetFieldIds);
  if (!isCurrent()) return;
  try {
    const receipt = await deps.persistTemplateSnapshot({ request, template, templateHash });
    if (!isCurrent()) return;
    const registered = deps.restoreTemplateFromSnapshot(source.templateHtml, receipt.parseResult.fields, request.targetFieldIds, source.templateDefinition);
    return { source, templateHash, template: withPolicy(registered, receipt.fieldPolicy, receipt.id) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OutpatientEmrError('TEMPLATE_SNAPSHOT_FAILED', `新模板解析登记失败，尚未启动模型分析：${message}`);
  }
}
