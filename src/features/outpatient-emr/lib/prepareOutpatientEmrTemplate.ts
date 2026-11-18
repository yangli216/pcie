import type { OutpatientEmrTemplateSource } from '../api/outpatientEmrTemplateDecodeService';
import type { persistOutpatientEmrTemplateSnapshot, resolveOutpatientEmrTemplateSnapshot } from '../api/outpatientEmrTemplateSnapshotService';
import { OutpatientEmrError, type parseOutpatientEmrTemplate, type restoreOutpatientEmrTemplateFromSnapshot } from './outpatientEmrTemplate';
import type { hashOutpatientEmrTemplate } from './outpatientEmrWriteback';
import type { OutpatientEmrAnalysisRequest, OutpatientEmrTemplateParseResult } from '../types';

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
    if (!resolution.parseResult) {
      throw new OutpatientEmrError('TEMPLATE_SNAPSHOT_FAILED', '历史模板解析命中但缺少完整字段快照，尚未启动模型分析。');
    }
    const template = deps.restoreTemplateFromSnapshot(
      source.templateHtml, resolution.parseResult.fields, request.targetFieldIds, source.templateDefinition,
    );
    return { source, template, templateHash };
  }
  const template = deps.parseTemplate(source.templateHtml, source.templateDefinition, request.targetFieldIds);
  if (!isCurrent()) return;
  try {
    await deps.persistTemplateSnapshot({ request, template, templateHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OutpatientEmrError('TEMPLATE_SNAPSHOT_FAILED', `新模板解析登记失败，尚未启动模型分析：${message}`);
  }
  return isCurrent() ? { source, template, templateHash } : undefined;
}
