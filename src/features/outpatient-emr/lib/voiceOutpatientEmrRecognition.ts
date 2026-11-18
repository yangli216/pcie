import { toRaw } from 'vue';
import { prepareOutpatientEmrTemplate, type PreparedOutpatientEmrTemplate } from './prepareOutpatientEmrTemplate';
import type {
  OutpatientEmrAnalysisRequest, OutpatientEmrTemplateField, VoiceOutpatientEmrDocument, VoiceOutpatientEmrInitialDraft, VoiceOutpatientEmrStartContext,
} from '../types';
import { buildOutpatientEmrDocument, describeOutpatientEmrNarrative, renderOutpatientEmrNarrativeSections } from './outpatientEmrNarrative';
import { buildOutpatientEmrFieldRules, buildOutpatientEmrPromptFields, isAdministrativeTemplateSlot, resolveOutpatientEmrFieldPromptProfiles } from './outpatientEmrPromptGenerator';
import { parseOutpatientEmrTemplate, restoreOutpatientEmrTemplateFromSnapshot } from './outpatientEmrTemplate';
import { isTemplateObject, readOutpatientEmrChapters } from './outpatientEmrTemplateDefinition';
import { hashOutpatientEmrTemplate, normalizeOutpatientEmrModelValues } from './outpatientEmrWriteback';

export interface VoiceOutpatientRecognitionTemplate {
  identity: Omit<VoiceOutpatientEmrInitialDraft, 'fieldValues'>;
  fields: OutpatientEmrTemplateField[];
  chapters: ReturnType<typeof buildOutpatientEmrDocument>;
  fieldRules: string;
  promptData: {
    fields: ReturnType<typeof buildOutpatientEmrPromptFields>;
    chapters: ReturnType<typeof describeVoiceChapters>;
    templateSourceNotes?: ReturnType<typeof parseOutpatientEmrTemplate>['templateSourceNotes'];
  };
}

function describeVoiceChapters(
  chapters: ReturnType<typeof buildOutpatientEmrDocument>, definition: string, identifiers: readonly (string | undefined)[],
) {
  const privateWords = identifiers.filter((word): word is string => !!word?.trim()).sort((a, b) => b.length - a.length);
  const redact = (text: string) => privateWords.reduce((value, word) => value.split(word).join('〔已隐去〕'), text);
  const definitionSlots = new Map<string, Record<string, unknown>[]>();
  for (const chapter of readOutpatientEmrChapters(definition).filter(isTemplateObject)) {
    for (const leaf of Array.isArray(chapter.eles) ? chapter.eles.filter(isTemplateObject) : []) {
      const key = JSON.stringify([chapter.ID, leaf.ID]);
      const matches = definitionSlots.get(key) ?? [];
      matches.push(leaf);
      definitionSlots.set(key, matches);
    }
  }
  // Keep malformed JSON field values as source text for this read-only context.
  function sourceValue(input: unknown) {
    if (input === undefined || input === null || typeof input === 'number' || typeof input === 'boolean') return input;
    return typeof input === 'string' ? redact(input) : { raw: redact(JSON.stringify(input)) };
  }
  return chapters.map(chapter => ({
    chapterId: chapter.id, title: redact(chapter.title),
    fields: chapter.fields.map(({ field, editable }) => ({ id: field.id, name: redact(field.name), writable: editable })),
    narrative: describeOutpatientEmrNarrative(chapter.sections, identifiers),
    referenceSlots: (chapter.referenceSlots ?? []).flatMap(slot => {
      const sources = definitionSlots.get(JSON.stringify([chapter.id, slot.id])) ?? [];
      if (sources.some(leaf => leaf.HIDDEN === true || leaf.HIDDEN === 'true'
        || isAdministrativeTemplateSlot(slot.id, String(leaf.NAME ?? ''), [chapter.id, chapter.title]))) return [];
      return [{ id: slot.id, name: redact(slot.name), readonly: slot.readonly, htmlText: redact(slot.htmlText),
        definitionValues: sources.map(leaf => ({ text: sourceValue(leaf.TEXT), value: sourceValue(leaf.VALUE) })),
      }];
    }),
  }));
}

interface CachedBoundTemplate {
  identity: Omit<VoiceOutpatientEmrInitialDraft, 'fieldValues'>;
  templateHtml: string;
  templateDefinition: string;
  prepared: PreparedOutpatientEmrTemplate;
}

const boundTemplates = new WeakMap<VoiceOutpatientEmrStartContext, CachedBoundTemplate>();

export function getPreparedVoiceOutpatientTemplate(
  context: VoiceOutpatientEmrStartContext, request?: OutpatientEmrAnalysisRequest,
): PreparedOutpatientEmrTemplate | undefined {
  const entry = boundTemplates.get(toRaw(context));
  if (!entry || !matchesVoiceOutpatientRecognitionTemplate(entry.identity, context)
    || entry.templateHtml !== context.template.templateHtml || entry.templateDefinition !== context.template.templateDefinition) return;
  if (request && (!matchesVoiceOutpatientRecognitionTemplate(entry.identity, { visitId: request.visitId, template: request })
    || entry.templateHtml !== request.templateHtml || entry.templateDefinition !== request.templateDefinition)) return;
  return entry.prepared;
}

export async function hashVoiceOutpatientRecognitionTemplate(context: VoiceOutpatientEmrStartContext): Promise<string> {
  const cached = getPreparedVoiceOutpatientTemplate(context);
  if (cached) return cached.templateHash;
  const { loadVoiceOutpatientEmrTemplateSource } = await import('../model/useVoiceOutpatientEmrTemplateSource');
  const source = await loadVoiceOutpatientEmrTemplateSource(context);
  return hashOutpatientEmrTemplate(source.templateHtml, source.templateDefinition);
}

export async function prepareVoiceOutpatientRecognitionTemplate(
  context: VoiceOutpatientEmrStartContext,
  identifiers: readonly (string | undefined)[],
  isCurrent: () => boolean,
): Promise<VoiceOutpatientRecognitionTemplate | undefined> {
  let prepared = getPreparedVoiceOutpatientTemplate(context);
  const { templateId, requestId, targetFieldIds, templateHtml, templateDefinition } = context.template;
  const request = { ...context.template, visitId: context.visitId, recordContext: {}, targetFieldIds: [...targetFieldIds] };
  if (!prepared) {
    const [{ loadVoiceOutpatientEmrTemplateSource }, snapshots] = await Promise.all([
      import('../model/useVoiceOutpatientEmrTemplateSource'), import('../api/outpatientEmrTemplateSnapshotService'),
    ]);
    if (!isCurrent()) return;
    const source = await loadVoiceOutpatientEmrTemplateSource(context);
    if (!isCurrent()) return;
    prepared = await prepareOutpatientEmrTemplate(request, source, {
      hashTemplate: hashOutpatientEmrTemplate, parseTemplate: parseOutpatientEmrTemplate,
      restoreTemplateFromSnapshot: restoreOutpatientEmrTemplateFromSnapshot,
      resolveTemplateSnapshot: snapshots.resolveOutpatientEmrTemplateSnapshot,
      persistTemplateSnapshot: snapshots.persistOutpatientEmrTemplateSnapshot,
    }, isCurrent);
  }
  if (!isCurrent() || !prepared) return;
  const { templateHash, template: parsed } = prepared;
  const identity = { visitId: request.visitId, templateId, requestId, templateHash, targetFieldIds: request.targetFieldIds };
  if (!matchesVoiceOutpatientRecognitionTemplate(identity, context)
    || templateHtml !== context.template.templateHtml || templateDefinition !== context.template.templateDefinition) return;
  boundTemplates.set(toRaw(context), { prepared, identity, templateHtml, templateDefinition });
  const chapters = buildOutpatientEmrDocument(parsed);
  const profiles = resolveOutpatientEmrFieldPromptProfiles(parsed.targetFields);
  return {
    identity: { ...identity, targetFieldIds: [...identity.targetFieldIds] },
    fields: parsed.targetFields, chapters,
    fieldRules: buildOutpatientEmrFieldRules(profiles).join('\n'),
    promptData: {
      fields: buildOutpatientEmrPromptFields(parsed.targetFields, profiles),
      chapters: describeVoiceChapters(buildOutpatientEmrDocument(parsed, true), prepared.source.templateDefinition, identifiers),
      ...(parsed.templateSourceNotes?.length ? { templateSourceNotes: parsed.templateSourceNotes } : {}),
    },
  };
}

/** Only known source IDs shape the document; the model supplies prose, never headings or order. */
export function buildVoiceOutpatientEmrDocument(
  template: VoiceOutpatientRecognitionTemplate,
  chapterTexts?: Record<string, string>,
  fieldValues?: Record<string, string | null>,
): VoiceOutpatientEmrDocument {
  const values = Object.fromEntries(Object.entries(fieldValues ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  return {
    ...template.identity, targetFieldIds: [...template.identity.targetFieldIds],
    chapters: template.chapters.map(chapter => {
      const text = chapterTexts && Object.prototype.hasOwnProperty.call(chapterTexts, chapter.id)
        ? chapterTexts[chapter.id] : undefined;
      return {
        chapterId: chapter.id, title: chapter.title,
        fieldIds: chapter.fields.map(slot => slot.field.id),
        editableFieldIds: chapter.fields.filter(slot => slot.editable).map(slot => slot.field.id),
        text: typeof text === 'string' ? text : renderOutpatientEmrNarrativeSections(chapter.sections, values).map(part => part.text).join(''),
      };
    }),
  };
}

export function buildVoiceOutpatientEmrInitialDraft(
  template: VoiceOutpatientRecognitionTemplate,
  raw: unknown,
  byChapter?: Readonly<Record<string, Record<string, unknown>>>,
): VoiceOutpatientEmrInitialDraft {
  const values = new Map(Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}));
  for (const chapter of template.chapters) {
    const patch = byChapter && Object.prototype.hasOwnProperty.call(byChapter, chapter.id) ? byChapter[chapter.id] : undefined;
    if (!patch) continue;
    for (const { field, editable } of chapter.fields) {
      if (editable && Object.prototype.hasOwnProperty.call(patch, field.id)) values.set(field.id, patch[field.id]);
    }
  }
  const present = template.fields.filter(field => values.has(field.id));
  const fieldValues = normalizeOutpatientEmrModelValues(Object.fromEntries(values), present);
  for (const field of template.promptData.fields) {
    if (field.topic === 'administrative' && Object.prototype.hasOwnProperty.call(fieldValues, field.id)) fieldValues[field.id] = '';
  }
  return { ...template.identity, targetFieldIds: [...template.identity.targetFieldIds], fieldValues };
}

export function matchesVoiceOutpatientRecognitionTemplate(
  draft: Omit<VoiceOutpatientEmrInitialDraft, 'fieldValues'> | undefined,
  context: VoiceOutpatientEmrStartContext,
  templateHash?: string,
): boolean {
  return Boolean(draft && draft.visitId === context.visitId && draft.requestId === context.template.requestId
    && draft.templateId === context.template.templateId && (!templateHash || draft.templateHash === templateHash)
    && Array.isArray(draft.targetFieldIds) && draft.targetFieldIds.length === context.template.targetFieldIds.length
    && draft.targetFieldIds.every((id, index) => id === context.template.targetFieldIds[index]));
}
