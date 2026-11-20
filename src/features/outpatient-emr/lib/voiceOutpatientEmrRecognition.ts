import { toRaw } from 'vue';
import { prepareOutpatientEmrTemplate, type PreparedOutpatientEmrTemplate } from './prepareOutpatientEmrTemplate';
import type {
  OutpatientEmrAnalysisRequest, OutpatientEmrTemplateField, OutpatientEmrTemplateParseResult,
  VoiceOutpatientEmrDocument, VoiceOutpatientEmrInitialDraft, VoiceOutpatientEmrStartContext,
} from '../types';
import { buildOutpatientEmrDocument, describeOutpatientEmrNarrative, isVoiceOutpatientEmrFieldPlaceholder, outpatientEmrChapterTextField, renderVoiceOutpatientEmrChapter } from './outpatientEmrNarrative';
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

export function describeVoiceChapters(
  chapters: ReturnType<typeof buildOutpatientEmrDocument>, definition: string, identifiers: readonly (string | undefined)[],
  sourceNotes: NonNullable<ReturnType<typeof parseOutpatientEmrTemplate>['templateSourceNotes']> = [],
) {
  const notedFields = new Set(sourceNotes.map(note => note.fieldId));
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
    return typeof input === 'string' ? redact(input) : { raw: redact(JSON.stringify(input, (key, value) => /^(?:idPi|naPi|patientId|patientName|visitId|idVis|身份证号|患者姓名)$/i.test(key) ? '〔已隐去〕' : value)) };
  }
  return chapters.map(chapter => ({
    chapterId: chapter.id, title: redact(chapter.title),
    fields: chapter.fields.map(({ field, editable }) => ({ id: field.id, name: redact(field.name), writable: editable })),
    narrative: describeOutpatientEmrNarrative(chapter.sections, identifiers),
    referenceSlots: (chapter.referenceSlots ?? []).flatMap(slot => {
      // Unpaired requested slots already carry attributed, de-identified evidence in templateSourceNotes.
      if (notedFields.has(slot.id)) return [];
      const sources = definitionSlots.get(JSON.stringify([chapter.id, slot.id])) ?? [];
      if (sources.some(leaf => leaf.HIDDEN === true || leaf.HIDDEN === 'true'
        || isAdministrativeTemplateSlot(slot.id, String(leaf.NAME ?? ''), [chapter.id, chapter.title]))) return [];
      return [{ id: slot.id, name: redact(slot.name), readonly: slot.readonly, htmlText: redact(slot.htmlText),
        definitionValues: sources.map(leaf => ({ text: sourceValue(leaf.TEXT), value: sourceValue(leaf.VALUE) })),
      }];
    }),
  }));
}

/** Source values are available as evidence even when this round may not write their controls. */
export function describeOutpatientTemplateReferences(
  parsed: OutpatientEmrTemplateParseResult, definition: string, identifiers: readonly (string | undefined)[],
  writable = parsed.targetFields.filter(field => field.aiSuitable),
) {
  return describeVoiceChapters(buildOutpatientEmrDocument({ ...parsed, targetFields: writable }, true),
    definition, identifiers, parsed.templateSourceNotes);
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
  let prepared: PreparedOutpatientEmrTemplate | undefined;
  const { templateId, requestId, targetFieldIds, templateHtml, templateDefinition } = context.template;
  const request = { ...context.template, visitId: context.visitId, recordContext: {}, targetFieldIds: [...targetFieldIds] };
  {
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
  const identity = { visitId: request.visitId, templateId, requestId, templateHash, targetFieldIds: request.targetFieldIds,
    policyRevision: parsed.fieldPolicy?.revision, ruleSetVersion: parsed.fieldPolicy?.ruleSetVersion };
  if (!matchesVoiceOutpatientRecognitionTemplate(identity, context)
    || templateHtml !== context.template.templateHtml || templateDefinition !== context.template.templateDefinition) return;
  boundTemplates.set(toRaw(context), { prepared, identity, templateHtml, templateDefinition });
  const modelFields = parsed.targetFields.filter(field => field.aiSuitable);
  const modelTemplate = { ...parsed, targetFields: modelFields };
  const chapters = buildOutpatientEmrDocument(modelTemplate, false, prepared.source.templateDefinition);
  const profiles = resolveOutpatientEmrFieldPromptProfiles(modelFields);
  return {
    identity: { ...identity, targetFieldIds: [...identity.targetFieldIds] },
    fields: modelFields, chapters,
    fieldRules: buildOutpatientEmrFieldRules(profiles, modelFields).join('\n'),
    promptData: {
      fields: buildOutpatientEmrPromptFields(modelFields, profiles),
      chapters: describeOutpatientTemplateReferences(parsed, prepared.source.templateDefinition, identifiers, modelFields),
      ...(parsed.templateSourceNotes?.length ? { templateSourceNotes: parsed.templateSourceNotes } : {}),
    },
  };
}

/** The confirmed field map and source document grammar are the only inputs to the displayed chapters. */
export function buildVoiceOutpatientEmrDocument(
  template: VoiceOutpatientRecognitionTemplate, fieldValues: Readonly<Record<string, string | null>> = {},
): VoiceOutpatientEmrDocument {
  return {
    ...template.identity, targetFieldIds: [...template.identity.targetFieldIds],
    chapters: template.chapters.map(chapter => ({
      chapterId: chapter.id, title: chapter.title,
      fieldIds: chapter.fields.map(slot => slot.field.id),
      editableFieldIds: chapter.fields.filter(slot => slot.editable).map(slot => slot.field.id),
      text: renderVoiceOutpatientEmrChapter(chapter, fieldValues),
    })),
  };
}

export function buildVoiceOutpatientEmrInitialDraft(
  template: VoiceOutpatientRecognitionTemplate,
  raw: unknown,
  byChapter?: Readonly<Record<string, Record<string, unknown>>>,
  legacyTexts?: Readonly<Record<string, string>>,
): VoiceOutpatientEmrInitialDraft {
  const values = new Map(Object.entries(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}));
  for (const chapter of template.chapters) {
    const patch = byChapter && Object.prototype.hasOwnProperty.call(byChapter, chapter.id) ? byChapter[chapter.id] : undefined;
    const legacyText = legacyTexts && Object.prototype.hasOwnProperty.call(legacyTexts, chapter.id) ? legacyTexts[chapter.id] : undefined;
    const whole = typeof legacyText === 'string' && legacyText.trim() && chapter.fields.length === 1
      ? outpatientEmrChapterTextField(chapter) : undefined;
    for (const { field, editable, placeholder } of chapter.fields) {
      if (!editable) continue;
      if (patch && Object.prototype.hasOwnProperty.call(patch, field.id)) values.set(field.id, patch[field.id]);
      if (!values.has(field.id) && whole?.id === field.id) values.set(field.id, legacyText);
      if (isVoiceOutpatientEmrFieldPlaceholder(field, values.get(field.id), placeholder)) values.delete(field.id);
    }
  }
  const present = template.fields.filter(field => values.has(field.id));
  const fieldValues = normalizeOutpatientEmrModelValues(Object.fromEntries(values), present);
  for (const field of template.promptData.fields) {
    if (field.topic === 'administrative' && Object.prototype.hasOwnProperty.call(fieldValues, field.id)) fieldValues[field.id] = '';
  }
  return { ...template.identity, targetFieldIds: [...template.identity.targetFieldIds], fieldValues };
}

/** Build both snapshots from the same approved leaves during streaming, at completion, and on cache restore. */
export function buildVoiceOutpatientEmrDraftAndDocument(
  template: VoiceOutpatientRecognitionTemplate,
  raw: unknown,
  byChapter?: Readonly<Record<string, Record<string, unknown>>>,
  legacyTexts?: Readonly<Record<string, string>>,
) {
  const voiceTemplateDraft = buildVoiceOutpatientEmrInitialDraft(template, raw, byChapter, legacyTexts);
  return { voiceTemplateDraft, voiceTemplateDocument: buildVoiceOutpatientEmrDocument(template, voiceTemplateDraft.fieldValues) };
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
