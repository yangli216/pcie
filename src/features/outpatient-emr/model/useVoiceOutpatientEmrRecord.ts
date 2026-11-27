import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import { buildOutpatientEmrFieldRules, resolveOutpatientEmrFieldPromptProfiles } from '../lib/outpatientEmrPromptGenerator';
import { analyzeOutpatientEmrFields } from '../api/outpatientEmrService';
import { isSameOutpatientEmrAnalysisRequestSnapshot } from '../lib/outpatientEmrRequestIdentity';
import { isAdministrativeTemplateSlot } from '../lib/outpatientEmrPromptGenerator';
import { OutpatientEmrError } from '../lib/outpatientEmrTemplate';
import { isDirectOutpatientEmrTextField } from '../lib/outpatientEmrWriteback';
import {
  buildOutpatientEmrDocument,
  describeOutpatientEmrNarrative,
  parseOutpatientEmrNarrative,
  outpatientEmrChapterTextField,
  isVoiceOutpatientEmrFieldPlaceholder,
  renderOutpatientEmrNarrativeSections,
  renderVoiceOutpatientEmrChapter,
} from '../lib/outpatientEmrNarrative';
import { isVoiceOutpatientEmrFieldBound } from '../lib/outpatientEmrDraftSource';
import { resolveOutpatientEmrFinalDictionaryItem } from '../lib/outpatientEmrDictionary';
import { patchVoiceRecordFieldEdit } from '../lib/voiceOutpatientEmrFieldEdit';
import { describeOutpatientTemplateReferences, getPreparedVoiceOutpatientTemplate, matchesVoiceOutpatientRecognitionTemplate } from '../lib/voiceOutpatientEmrRecognition';
import { buildVoiceOutpatientEmrPatientInput } from '../lib/voiceOutpatientEmr';
import {
  voiceOutpatientEmrDraftCache, type ReviewedVoiceSections, type VoiceOutpatientEmrReviewSnapshot,
  clearVoiceOutpatientEmrRecordDraftCache,
} from '../lib/voiceOutpatientEmrDraftCache';
export { clearVoiceOutpatientEmrRecordDraftCache } from '../lib/voiceOutpatientEmrDraftCache';
import type {
  OutpatientEmrAnalysisRequest,
  OutpatientEmrFieldValueSource,
  OutpatientEmrPreparedWritebackPayload,
  OutpatientEmrRecordContext,
  OutpatientEmrRecordField,
  OutpatientEmrTemplateField,
  OutpatientEmrTemplateParseResult,
  VoiceOutpatientEmrDocument,
  VoiceOutpatientEmrInitialDraft,
  VoiceOutpatientEmrStartContext,
} from '../types';
import {
  useOutpatientEmrAnalysis, withOutpatientEmrDoctorEdits,
  type OutpatientEmrAnalysisDependencies,
} from './useOutpatientEmrAnalysis';
import { useVoiceOutpatientEmrTemplateSource } from './useVoiceOutpatientEmrTemplateSource';
import { useVoiceOutpatientEmrSupplements, type VoiceOutpatientEmrSupplements } from './useVoiceOutpatientEmrSupplements';

export interface VoiceOutpatientEmrRecordOptions {
  context: Ref<VoiceOutpatientEmrStartContext | null>;
  patient: Ref<AppPatient | null | undefined>;
  recordContext: Ref<OutpatientEmrRecordContext | null>;
  enabled: Ref<boolean>;
  awaitingFeedback?: Readonly<Ref<boolean>>;
  initialDraft?: Readonly<Ref<VoiceOutpatientEmrInitialDraft | null | undefined>>;
  getLegacyRecord?: () => Readonly<Partial<Record<OutpatientEmrRecordField, string>>> | undefined;
  document?: Readonly<Ref<VoiceOutpatientEmrDocument | undefined>>;
  streaming?: Readonly<Ref<boolean>>;
  awaitInitialDraft?: Readonly<Ref<boolean>>;
  supplements?: Readonly<Ref<VoiceOutpatientEmrSupplements>>;
}

/** Owns the current voice result's template draft; the result page owns submission. */
export function useVoiceOutpatientEmrRecord(
  options: VoiceOutpatientEmrRecordOptions,
  dependencies: OutpatientEmrAnalysisDependencies = {},
) {
  const templateSource = useVoiceOutpatientEmrTemplateSource(options.context, options.patient, dependencies.normalizeTemplateSource);
  const analyzeFields = dependencies.analyzeFields ?? analyzeOutpatientEmrFields;
  const analysis = useOutpatientEmrAnalysis({
    ...dependencies,
    isFieldInWriteback: (field, value, source) => isVoiceOutpatientEmrFieldBound(field, value, source)
      && !isVoiceOutpatientEmrFieldPlaceholder(field, value, fieldPlaceholders.value.get(field.id)),
    getPreparedVoiceTemplate: dependencies.getPreparedVoiceTemplate ?? ((request) => {
      const context = templateSource.matchingContext.value;
      return context ? getPreparedVoiceOutpatientTemplate(context, request) : undefined;
    }),
    analyzeFields: (input) => {
      const doctorTemplateEdits = modelFields(input.fields).filter((field) => field.source === 'doctor');
      return analyzeFields({
        ...input,
        request: withOutpatientEmrDoctorEdits(input.request, doctorTemplateEdits),
        templateNarrative: describeOutpatientEmrNarrative(narrativeSections.value, [
          input.request.patient?.name, input.request.patient?.idPi, input.request.visitId,
        ]),
      });
    },
    normalizeTemplateSource: async () => {
      const source = templateSource.prepared.value;
      if (!source) throw new OutpatientEmrError('TEMPLATE_PAIR_MISMATCH', '当前就诊的模板尚未就绪。');
      return source;
    },
  });
  let pendingDoctorEdits: Record<string, string> | null = null;
  let pendingEditFields: OutpatientEmrTemplateField[] = [];
  let cacheEpoch = voiceOutpatientEmrDraftCache.epoch;
  let revision = 0;
  let restoreScheduled = false;
  let appliedInitialDraft = '';
  let pendingReviewedEdits: { owner: VoiceOutpatientEmrStartContext; values: ReviewedVoiceSections } | null = null;
  const reviewedSections = shallowRef<ReviewedVoiceSections>({});
  const sectionRuns = new Map<string, AbortController>();
  const sectionError = computed(() => Object.values(reviewedSections.value).find(edit => edit.error)?.error);
  const initialDraftKey = computed(() => JSON.stringify(options.initialDraft?.value ?? null));
  const currentRequest = computed<OutpatientEmrAnalysisRequest | null>(() => {
    const context = templateSource.matchingContext.value;
    const patient = options.patient.value;
    const recordContext = options.recordContext.value ?? (options.initialDraft?.value || options.awaitInitialDraft?.value ? {} : null);
    if (
      !options.enabled.value
      || !context
      || !recordContext
      || !templateSource.prepared.value
    ) return null;

    return {
      ...context.template,
      visitId: context.visitId,
      targetFieldIds: [...context.template.targetFieldIds],
      // Freeze the clinical input so a later reactive edit cannot mutate an
      // in-flight request or make a stale analysis appear current.
      recordContext: JSON.parse(JSON.stringify(recordContext)) as OutpatientEmrRecordContext,
      patient: buildVoiceOutpatientEmrPatientInput({
        idPi: patient?.idPi || patient?.patientId,
        name: patient?.naPi || patient?.patientName,
        sdSexText: patient?.sdSexText || patient?.genderText,
        ageText: patient?.ageText,
      }),
    };
  });

  // Background diagnosis/treatment refreshes can finish while HIS saves a record-only batch.
  // Keep the submitted draft editable on failure; fresh changes after feedback start a new analysis.
  const deferredClinicalRequest = shallowRef<OutpatientEmrAnalysisRequest | null>(null);
  const isCurrent = computed(() => Boolean(
    currentRequest.value
    && analysis.request.value
    && isSameOutpatientEmrAnalysisRequestSnapshot(
      deferredClinicalRequest.value ?? analysis.request.value,
      currentRequest.value,
    ),
  ));
  const canSubmit = computed(() => isCurrent.value && analysis.canSubmit.value);
  const waitingForInitialDraft = computed(() => Boolean(currentRequest.value && options.awaitInitialDraft?.value
    && !options.initialDraft?.value && !analysis.request.value));
  const canRetry = computed(() => waitingForInitialDraft.value || Boolean(templateSource.error.value)
    || (isCurrent.value && analysis.canRetry.value));
  const narrativeSections = computed(() => {
    const template = analysis.template.value;
    return template ? parseOutpatientEmrNarrative(template.sanitizedHtml, template.targetFields) : [];
  });
  const preparedTemplate = computed(() => {
    const context = templateSource.matchingContext.value;
    if (!context) return;
    // Preparing the stream and finishing it share the same approved instance.
    const document = options.document?.value;
    return analysis.template.value ?? (document && getPreparedVoiceOutpatientTemplate(context)?.template);
  });
  const sourceChapters = computed(() => preparedTemplate.value
    ? buildOutpatientEmrDocument(preparedTemplate.value, false, templateSource.prepared.value?.templateDefinition) : []);
  const fieldPlaceholders = computed(() => new Map(sourceChapters.value.flatMap(chapter =>
    chapter.fields.map(slot => [slot.field.id, slot.placeholder] as const))));
  const streamDocument = computed(() => {
    const context = templateSource.matchingContext.value;
    const document = options.document?.value;
    const policy = preparedTemplate.value?.fieldPolicy;
    if (policy && (document?.snapshotId !== preparedTemplate.value?.snapshotId
      || document?.policyRevision !== policy.revision || document?.ruleSetVersion !== policy.ruleSetVersion)) return;
    return context && analysis.analysisErrorCode.value !== 'REQUEST_ID_CONFLICT' && matchesVoiceOutpatientRecognitionTemplate(document, context,
      analysis.templateHash.value || getPreparedVoiceOutpatientTemplate(context)?.templateHash || options.initialDraft?.value?.templateHash)
      ? document : undefined;
  });
  const chapterKey = (id: string) => JSON.stringify(['article', id]);
  const boundValues = analysis.writebackFieldValues;
  const chapterRows = computed(() => {
    const streamed = streamDocument.value;
    const session = templateSource.matchingContext.value;
    const initial = options.initialDraft?.value;
    const waitingForLeaves = ['idle', 'analyzing'].includes(analysis.analysisStatus.value);
    const active = preparedTemplate.value;
    const initialMatches = initial && active?.fieldPolicy && initial.snapshotId === active.snapshotId
      && initial.policyRevision === active.fieldPolicy.revision
      && initial.ruleSetVersion === active.fieldPolicy.ruleSetVersion;
    const initialValues = waitingForLeaves && session && initialMatches && matchesVoiceOutpatientRecognitionTemplate(initial, session,
      analysis.templateHash.value || getPreparedVoiceOutpatientTemplate(session)?.templateHash)
      ? Object.fromEntries(active.targetFields.filter(field => field.aiSuitable && Object.prototype.hasOwnProperty.call(initial.fieldValues, field.id))
        .map(field => [field.id, initial.fieldValues[field.id]])) : {};
    const incoming = new Map(streamed?.chapters.map(chapter => [chapter.chapterId, chapter]));
    const chapters = preparedTemplate.value ? sourceChapters.value : (streamed?.chapters ?? []).map(chapter => ({
      id: chapter.chapterId, title: chapter.title, fields: [], sections: [],
    }));
    return chapters.map(chapter => {
      const generated = incoming.get(chapter.id);
      const edit = reviewedSections.value[chapterKey(chapter.id)];
      const fields = chapter.fields.filter(item => item.editable).map(item => item.field);
      const fieldIds = preparedTemplate.value ? fields.map(field => field.id)
        : generated?.editableFieldIds ?? generated?.fieldIds.filter(id => streamed?.targetFieldIds.includes(id)) ?? [];
      const recordFields = [...new Set(fields.flatMap(field => field.recordField ? [field.recordField] : []))];
      const direct = outpatientEmrChapterTextField(chapter);
      const legacyRecordText = !streamed && direct?.aiSuitable && direct.recordField && analysis.fieldValueSources.value[direct.id] !== 'doctor'
        && sourceChapters.value.filter(item => item.fields.some(slot => slot.editable && slot.field.recordField === direct.recordField)).length === 1
        ? options.getLegacyRecord?.()?.[direct.recordField] : undefined;
      const legacyValue = direct && legacyRecordText?.trim()
        && !isVoiceOutpatientEmrFieldPlaceholder(direct, legacyRecordText, fieldPlaceholders.value.get(direct.id))
        && !Object.prototype.hasOwnProperty.call(options.initialDraft?.value?.fieldValues ?? {}, direct.id)
        ? legacyRecordText : undefined;
      const directText = direct ? boundValues.value[direct.id] ?? legacyValue : undefined;
      const values = direct && directText !== undefined ? { ...boundValues.value, [direct.id]: directText } : boundValues.value;
      const rendered = renderVoiceOutpatientEmrChapter(chapter, { ...initialValues, ...values });
      // Only a live recognition document has already been projected from this stream's leaves.
      // Persisted documents may still contain prose from the earlier chapter-text protocol.
      const reviewedText = edit && !edit.fieldEditOnly && !edit.supplement
        && !(direct && isVoiceOutpatientEmrFieldPlaceholder(direct, edit.text, fieldPlaceholders.value.get(direct.id)))
        ? edit.text : undefined;
      const text = reviewedText
        ?? (options.streaming?.value && generated ? generated.text : rendered);
      const boundFieldIds = fields.filter(field => (
        field.id === direct?.id && Boolean(directText?.trim())
        || Object.prototype.hasOwnProperty.call(boundValues.value, field.id)
      )).map(field => field.id);
      return { key: chapter.id, label: chapter.title, text, fieldIds, fields, recordFields, direct, directText, boundFieldIds,
        reviewed: Boolean(edit && !edit.fieldEditOnly && !edit.supplement),
        displayFields: chapter.fields.map(slot => slot.field),
        hasHiddenFields: chapter.fields.some(slot => slot.field.visible === false),
        sections: chapter.sections, available: boundFieldIds.length > 0 };
    });
  });

  useVoiceOutpatientEmrSupplements({
    owner: () => analysis.request.value,
    ready: () => isCurrent.value && analysis.analysisStatus.value === 'ready'
      && !options.streaming?.value && !options.awaitingFeedback?.value,
    chapters: () => chapterRows.value,
    source: () => options.supplements?.value,
    // Preserve the existing, resolved direct paragraph when binding a candidate.
    // In particular, a restored result may still supply that paragraph separately.
    values: () => ({ ...analysis.fieldValues.value, ...Object.fromEntries(chapterRows.value.flatMap(row =>
      row.direct && row.directText !== undefined ? [[row.direct.id, row.directText]] : [])) }),
    sources: () => analysis.fieldValueSources.value,
    isEdited: id => {
      if (analysis.isIndividuallyEdited(id)) return true;
      const row = chapterRows.value.find(chapter => chapter.fieldIds.includes(id));
      const edit = row && reviewedSections.value[chapterKey(row.key)];
      return Boolean(edit && !edit.fieldEditOnly && !edit.supplement);
    },
    apply: analysis.replaceReviewedSectionValues,
  });

  const reviewFieldSections = computed(() => [
    ...sourceChapters.value.flatMap(chapter => chapter.sections.map(section => ({
      ...section, directField: outpatientEmrChapterTextField(chapter) ?? null,
    }))),
    ...narrativeSections.value.filter(section => section.fallback),
  ]);
  const recordFieldValues = computed(() => {
    const values: Partial<Record<OutpatientEmrRecordField, string>> = {};
    for (const key of new Set(narrativeSections.value.flatMap(section => section.recordField ? [section.recordField] : []))) {
      const sections = narrativeSections.value.filter(section => section.recordField === key);
      const body = renderOutpatientEmrNarrativeSections(sections, analysis.fieldValues.value)
        .map(part => part.text).join('');
      if (body.trim()) {
        values[key] = body;
      } else if ((sections.length && reviewedSections.value[key]?.text.trim() === '')
        || sections.flatMap(section => section.fields).some(field =>
        !field.dictionaryItems.length && analysis.fieldValueSources.value[field.id] === 'doctor'
        && !analysis.fieldValues.value[field.id]?.trim())) {
        values[key] = '';
      }
    }
    return values;
  });

  function reset(): void {
    stopSectionRuns();
    reviewedSections.value = {};
    revision += 1;
    restoreScheduled = false;
    deferredClinicalRequest.value = null;
    pendingDoctorEdits = null;
    pendingEditFields = [];
    appliedInitialDraft = '';
    pendingReviewedEdits = null;
    clearVoiceOutpatientEmrRecordDraftCache();
    cacheEpoch = voiceOutpatientEmrDraftCache.epoch;
    analysis.reset();
  }

  function collectDoctorEdits(): Record<string, string> {
    return {
      ...pendingDoctorEdits,
      ...Object.fromEntries(Object.entries(analysis.fieldValueSources.value)
        .filter(([id, source]) => source === 'doctor' && analysis.isIndividuallyEdited(id))
        .map(([fieldId]) => [fieldId, analysis.fieldValues.value[fieldId]])),
    };
  }

  function modelFields(fields: OutpatientEmrTemplateField[]): Array<{
    id: string; name: string; recordField: OutpatientEmrRecordField | null; articleName: string;
    value: string; source: OutpatientEmrFieldValueSource; dictionaryItems?: OutpatientEmrTemplateField['dictionaryItems'];
  }> {
    const edits = collectDoctorEdits();
    return fields.filter(field => !isAdministrativeTemplateSlot(field.id, field.name, [
      field.articleId, field.articleTemplateId, field.articleDefinitionName, field.articleName,
    ])).map(({ id, name, recordField, articleName, dictionaryItems }) => {
      const edited = Object.prototype.hasOwnProperty.call(edits, id);
      return {
        id, name, recordField, articleName, ...(dictionaryItems.length ? { dictionaryItems } : {}),
        value: edited ? edits[id] : analysis.fieldValues.value[id] ?? '',
        source: edited ? 'doctor' : analysis.fieldValueSources.value[id] ?? 'empty',
      };
    });
  }

  function getModelDraft() {
    if (!isCurrent.value) return [];
    if (analysis.targetFields.value.length) return modelFields(analysis.targetFields.value);
    // A selection change can restart parsing before the doctor submits a supplement.
    // Pending edits here already belong to the same patient, visit and template.
    return modelFields(pendingEditFields).filter(field => field.source === 'doctor');
  }

  function getSupplementChapters() {
    const modelIds = new Set(analysis.targetFields.value.filter(f => f.aiSuitable).map(f => f.id));
    return chapterRows.value.filter(row => row.fieldIds.length).map(row => ({
      chapterId: row.key, title: row.label, text: row.text, fieldIds: row.fields.map(field => field.id),
      narrative: describeOutpatientEmrNarrative(row.sections, [analysis.request.value?.patient?.name,
        analysis.request.value?.patient?.idPi, analysis.request.value?.visitId]),
      editableFieldIds: row.fieldIds.filter(id => modelIds.has(id)),
      directTextFieldId: row.direct && modelIds.has(row.direct.id) ? row.direct.id : undefined,
      recordField: row.sections.length === 1 ? row.sections[0].recordField : null,
    }));
  }

  function supplementEvidence(parsed: OutpatientEmrTemplateParseResult) {
    const request = analysis.request.value;
    if (!request) return {};
    const definition = templateSource.prepared.value?.templateDefinition ?? request.templateDefinition;
    return {
      templateReferenceChapters: describeOutpatientTemplateReferences(parsed, definition,
        [request.patient?.name, request.patient?.idPi, request.visitId]),
      templateSourceNotes: parsed.templateSourceNotes,
    };
  }

  function supplementRules() {
    const fields = analysis.targetFields.value.filter(f => f.aiSuitable);
    return buildOutpatientEmrFieldRules(resolveOutpatientEmrFieldPromptProfiles(fields), fields).join('\n');
  }

  function applySupplementPatch(fields: OutpatientEmrTemplateField[], values: Readonly<Record<string, string | null>>): void {
    const targets = fields.filter(field => field.aiSuitable && typeof values[field.id] === 'string' && !analysis.isIndividuallyEdited(field.id));
    analysis.replaceReviewedSectionValues(targets.filter(field => values[field.id] !== ''), values);
    // An explicit clear is a writable empty text. An unknown value leaves the original slot alone.
    analysis.replaceReviewedSectionValues(targets.filter(field => values[field.id] === ''), {}, true);
  }

  function supplementTargets(row: (typeof chapterRows.value)[number], values: Readonly<Record<string, string | null>>) {
    return row.fields.filter(field => {
      if (!field.aiSuitable || !row.fieldIds.includes(field.id) || !Object.prototype.hasOwnProperty.call(values, field.id)
        || analysis.isIndividuallyEdited(field.id)) return false;
      const value = values[field.id];
      return typeof value === 'string' && !isVoiceOutpatientEmrFieldPlaceholder(field, value, fieldPlaceholders.value.get(field.id))
        && (!field.dictionaryItems.length || !value || Boolean(resolveOutpatientEmrFinalDictionaryItem(field, value)));
    });
  }

  /** Diagnosis and treatment use the prospective record before their successful refresh commits the patch. */
  function previewSupplementRecord(values: Readonly<Record<string, string | null>>) {
    const rows = chapterRows.value.map(row => ({ row, changes: supplementTargets(row, values) }));
    const keys = new Set(rows.flatMap(({ changes }) => changes.flatMap(field => field.recordField ? [field.recordField] : [])));
    const projected: Partial<Record<OutpatientEmrRecordField, string>> = {};
    for (const key of keys) {
      projected[key] = rows.filter(({ row }) => row.recordFields.includes(key)).map(({ row, changes }) => {
        if (!changes.length && row.recordFields.length === 1) return row.text;
        const chapter = sourceChapters.value.find(item => item.id === row.key);
        if (!chapter) return '';
        const patched = { ...boundValues.value, ...Object.fromEntries(changes.map(field => [field.id, values[field.id]])) };
        return renderVoiceOutpatientEmrChapter(chapter, Object.fromEntries(row.fields
          .filter(field => field.recordField === key).map(field => [field.id, patched[field.id]])));
      }).filter(Boolean).join('\n');
    }
    return projected;
  }

  function applySupplementFields(values: Readonly<Record<string, string | null>>): void {
    for (const row of chapterRows.value) {
      const targets = supplementTargets(row, values);
      if (!targets.length) continue;
      const key = chapterKey(row.key);
      sectionRuns.get(key)?.abort();
      sectionRuns.delete(key);
      const leaves = Object.fromEntries(targets.map(field => [field.id, values[field.id]]));
      applySupplementPatch(targets, leaves);
      reviewedSections.value = { ...reviewedSections.value, [key]: {
        chapterId: row.key, supplement: true, text: '',
        snapshotId: analysis.template.value?.snapshotId, policyRevision: analysis.template.value?.fieldPolicy?.revision, ruleSetVersion: analysis.template.value?.fieldPolicy?.ruleSetVersion,
        values: { ...reviewedSections.value[key]?.values, ...leaves },
      } };
    }
  }

  const pendingSnapshot = shallowRef<{ owner: VoiceOutpatientEmrStartContext; snapshot: VoiceOutpatientEmrReviewSnapshot }>();
  const reviewSnapshot = computed<VoiceOutpatientEmrReviewSnapshot | undefined>(() => {
    const request = analysis.request.value;
    if (!request || !analysis.templateHash.value || !isCurrent.value) return;
    const chapters = Object.values(reviewedSections.value).filter(edit => edit.chapterId !== undefined);
    const fieldEdits = collectDoctorEdits();
    if (!chapters.length && !Object.keys(fieldEdits).length) return;
    return { visitId: request.visitId, requestId: request.requestId, templateId: request.templateId,
      templateHash: analysis.templateHash.value, snapshotId: analysis.template.value?.snapshotId, policyRevision: analysis.template.value?.fieldPolicy?.revision, ruleSetVersion: analysis.template.value?.fieldPolicy?.ruleSetVersion, targetFieldIds: [...request.targetFieldIds], chapters, fieldEdits };
  });

  function restoreReviewSnapshot(snapshot?: VoiceOutpatientEmrReviewSnapshot): void {
    const owner = templateSource.matchingContext.value;
    if (snapshot && owner && matchesVoiceOutpatientRecognitionTemplate(snapshot, owner)) pendingSnapshot.value = { owner, snapshot };
  }

  watch([pendingSnapshot, () => analysis.analysisStatus.value, isCurrent, () => templateSource.matchingContext.value], () => {
    const pending = pendingSnapshot.value;
    if (!pending) return;
    if (pending.owner !== templateSource.matchingContext.value) { pendingSnapshot.value = undefined; return; }
    if (!analysis.template.value || !isCurrent.value || analysis.analysisStatus.value === 'analyzing') return;
    pendingSnapshot.value = undefined;
    const { snapshot } = pending;
    if (!matchesVoiceOutpatientRecognitionTemplate(snapshot, pending.owner, analysis.templateHash.value)) return;
    for (const { id } of analysis.targetFields.value) {
      const value = snapshot.fieldEdits?.[id];
      if (typeof value === 'string' && !analysis.isIndividuallyEdited(id)) analysis.updateFieldValue(id, value);
    }
    for (const edit of Array.isArray(snapshot.chapters) ? snapshot.chapters : []) {
      if (!edit || typeof edit.text !== 'string' || typeof edit.chapterId !== 'string'
        || !chapterRows.value.some(row => row.key === edit.chapterId && row.fieldIds.length)) continue;
      const key = chapterKey(edit.chapterId);
      if (reviewedSections.value[key]) continue;
      const samePolicy = snapshot.snapshotId === analysis.template.value.snapshotId
        && snapshot.policyRevision === analysis.template.value.fieldPolicy?.revision
        && snapshot.ruleSetVersion === analysis.template.value.fieldPolicy?.ruleSetVersion;
      if (edit.supplement && !samePolicy) continue;
      reviewedSections.value = { ...reviewedSections.value, [key]: samePolicy ? edit : { ...edit, values: undefined } };
      void syncReviewedSection(key, 'restore');
    }
  });

  function stopSectionRuns(): void {
    for (const run of sectionRuns.values()) run.abort();
    sectionRuns.clear();
  }

  async function syncReviewedSection(key: string, mode: 'edit' | 'restore' | 'retry' = 'edit'): Promise<boolean> {
    const edit = reviewedSections.value[key];
    const request = currentRequest.value;
    if (!edit || edit.fieldEditOnly || !request || !analysis.template.value) return false;
    sectionRuns.get(key)?.abort();
    sectionRuns.delete(key);
    const chapter = edit.chapterId === undefined ? undefined : sourceChapters.value.find(item => item.id === edit.chapterId);
    if (edit.chapterId !== undefined && !chapter) return false;
    const sections = chapter?.sections ?? narrativeSections.value.filter(section => section.recordField === key);
    const fields = chapter ? chapter.fields.filter(item => item.editable).map(item => item.field)
      : analysis.targetFields.value.filter(field => field.recordField === key);
    const policy = analysis.template.value.fieldPolicy;
    const samePolicy = edit.snapshotId === analysis.template.value.snapshotId
      && edit.policyRevision === policy?.revision && edit.ruleSetVersion === policy?.ruleSetVersion;
    if (edit.supplement) {
      if (!samePolicy) {
        const retained = { ...reviewedSections.value };
        delete retained[key];
        reviewedSections.value = retained;
        return true;
      }
      applySupplementPatch(fields.filter(field => field.aiSuitable), edit.values ?? {});
      return true;
    }
    const direct = chapter ? fields.filter(field => outpatientEmrChapterTextField(chapter)?.id === field.id)
      : fields.filter(isDirectOutpatientEmrTextField);
    const compound = fields.filter(field => !direct.includes(field));
    const editable = mode === 'restore' ? fields.filter(field => !analysis.isIndividuallyEdited(field.id)) : fields;
    if (!edit.text.trim()) {
      analysis.replaceReviewedSectionValues(editable, {}, true);
      return true;
    }
    for (const field of editable.filter(field => direct.includes(field))) analysis.updateFieldValue(field.id, edit.text);
    const targets = compound.filter(field => field.aiSuitable && !analysis.isIndividuallyEdited(field.id));
    if (!compound.some(field => !analysis.isIndividuallyEdited(field.id))) return true;
    if (samePolicy && (edit.values || (edit.error && mode !== 'retry'))) {
      analysis.replaceReviewedSectionValues(targets, edit.values ?? {});
      return !edit.error;
    }
    // Remove superseded facts before starting the request. Early confirmation and
    // failures may still submit the reviewed paragraph, but never its old leaves.
    analysis.replaceReviewedSectionValues(targets.filter(f => !['structured', 'his'].includes(analysis.fieldValueSources.value[f.id])), {});
    reviewedSections.value = { ...reviewedSections.value, [key]: { chapterId: edit.chapterId, text: edit.text } };
    const run = new AbortController();
    sectionRuns.set(key, run);
    try {
      const refreshed = await analysis.refreshPolicyForModel(() => !run.signal.aborted && sectionRuns.get(key) === run);
      if (!refreshed || run.signal.aborted) return false;
      const originalIds = new Set(fields.map(f => f.id));
      const allowed = refreshed.targetFields.filter(f => originalIds.has(f.id) && f.aiSuitable && !analysis.isIndividuallyEdited(f.id) && !direct.some(d => d.id === f.id));
      if (!allowed.length) return true;
      const identifiers = [request.patient?.name, request.patient?.idPi, request.visitId];
      const definition = templateSource.prepared.value?.templateDefinition ?? request.templateDefinition;
      const doctors = modelFields(refreshed.targetFields).filter(field => field.source === 'doctor');
      const result = await analyzeFields({
        templateSourceNotes: refreshed.templateSourceNotes,
        templateReferenceChapters: describeOutpatientTemplateReferences(refreshed, definition, identifiers, allowed),
        request: withOutpatientEmrDoctorEdits({ ...request, targetFieldIds: allowed.map(field => field.id),
          recordContext: { ...request.recordContext, reviewedSection: chapter?.title ?? key, ...(chapter ? { chapterId: chapter.id } : {}), recordText: edit.text } }, doctors),
        fields: allowed, reviewedSectionOnly: true,
        templateNarrative: describeOutpatientEmrNarrative(sections,
          [request.patient?.name, request.patient?.idPi, request.visitId]),
        signal: run.signal,
      });
      if (run.signal.aborted || sectionRuns.get(key) !== run
        || refreshed.snapshotId !== analysis.template.value?.snapshotId
        || refreshed.fieldPolicy?.revision !== analysis.template.value?.fieldPolicy?.revision
        || refreshed.fieldPolicy?.ruleSetVersion !== analysis.template.value?.fieldPolicy?.ruleSetVersion) return false;
      analysis.replaceReviewedSectionValues(allowed.filter(f => !analysis.isIndividuallyEdited(f.id)), result);
      reviewedSections.value = { ...reviewedSections.value, [key]: { ...reviewedSections.value[key], values: result,
        snapshotId: refreshed.snapshotId, policyRevision: refreshed.fieldPolicy?.revision, ruleSetVersion: refreshed.fieldPolicy?.ruleSetVersion } };
      return true;
    } catch (cause) {
      if (run.signal.aborted || sectionRuns.get(key) !== run) return false;
      const reason = cause instanceof Error ? cause.message : String(cause);
      reviewedSections.value = { ...reviewedSections.value, [key]: { ...reviewedSections.value[key], snapshotId: analysis.template.value?.snapshotId, policyRevision: analysis.template.value?.fieldPolicy?.revision,
        ruleSetVersion: analysis.template.value?.fieldPolicy?.ruleSetVersion, error: '病历修订后的模板字段更新失败：' + reason } };
      return false;
    } finally {
      if (sectionRuns.get(key) === run) sectionRuns.delete(key);
    }
  }

  function saveSectionEdit(key: string, edit: ReviewedVoiceSections[string]): void {
    const owner = templateSource.matchingContext.value;
    if (!owner || options.awaitingFeedback?.value) return;
    if (!analysis.template.value || !isCurrent.value) {
      if (pendingReviewedEdits?.owner !== owner) pendingReviewedEdits = { owner, values: {} };
      pendingReviewedEdits.values[key] = edit;
      return;
    }
    reviewedSections.value = { ...reviewedSections.value, [key]: edit };
    void syncReviewedSection(key);
  }

  function updateReviewedRecordField(key: OutpatientEmrRecordField, value: string): void {
    saveSectionEdit(key, { text: value });
  }

  function updateChapterText(id: string, text: string): void {
    if (!chapterRows.value.some(row => row.key === id && row.fieldIds.length)) return;
    saveSectionEdit(chapterKey(id), { chapterId: id, text });
  }

  function updateChapterField(id: string, value: string): void {
    const row = chapterRows.value.find(item => item.fieldIds.includes(id));
    const section = row?.sections.find(item => item.fields.some(field => field.id === id));
    const oldValues = boundValues.value;
    analysis.updateFieldValue(id, value);
    if (!row || !section) return;
    const key = chapterKey(row.key);
    const edit = reviewedSections.value[key];
    if (!edit || edit.fieldEditOnly || edit.supplement) return;

    let text = row.text;
    if (row.direct?.id === id) {
      text = value;
    } else if (!row.text.trim() || renderOutpatientEmrNarrativeSections(row.sections, oldValues).map(part => part.text).join('') === row.text) {
      text = renderOutpatientEmrNarrativeSections(row.sections, boundValues.value).map(part => part.text).join('');
    } else {
      text = patchVoiceRecordFieldEdit(row.text, section, oldValues, id, value);
    }
    reviewedSections.value = { ...reviewedSections.value, [key]: {
      ...edit, chapterId: row.key, text, fieldEditOnly: edit?.fieldEditOnly ?? !edit,
    } };

  }

  watch(analysis.fieldValueSources, () => {
    if ((!pendingDoctorEdits && !pendingReviewedEdits) || !analysis.template.value || restoreScheduled) return;
    const activeRevision = revision;
    restoreScheduled = true;
    // Let the shared controller finish clearing its initial edited-field set.
    // This microtask runs before its awaited model response can be applied.
    queueMicrotask(() => {
      if (revision !== activeRevision) return;
      restoreScheduled = false;
      const edits = pendingDoctorEdits;
      pendingDoctorEdits = null;
      if (!isCurrent.value) return;
      Object.entries(edits || {}).forEach(([fieldId, value]) => {
        if (analysis.fieldValueSources.value[fieldId] !== 'doctor') {
          analysis.updateFieldValue(fieldId, value);
        }
      });
      for (const key of Object.keys(reviewedSections.value)) {
        if (!sectionRuns.has(key)) void syncReviewedSection(key, 'restore');
      }
      const queued = pendingReviewedEdits;
      pendingReviewedEdits = null;
      if (queued && queued.owner === templateSource.matchingContext.value) {
        for (const [key, edit] of Object.entries(queued.values)) saveSectionEdit(key, edit);
      }
    });
  }, { flush: 'sync' });

  watch([currentRequest, initialDraftKey, () => options.awaitInitialDraft?.value], ([nextRequest, draftKey, waiting]) => {
    const initialDraft = options.initialDraft?.value ?? undefined;
    if (!nextRequest && !analysis.request.value) {
      // A remounted result page restores its ordinary voice refs after setup.
      // Keep the one cache entry until those refs form a comparable request.
      analysis.reset();
      return;
    }
    if (
      nextRequest
      && analysis.request.value
      && draftKey === appliedInitialDraft
      && isSameOutpatientEmrAnalysisRequestSnapshot(analysis.request.value, nextRequest)
    ) {
      deferredClinicalRequest.value = null;
      return;
    }

    const previousRequest = analysis.request.value;
    const sameSession = nextRequest && previousRequest
      && isSameOutpatientEmrAnalysisRequestSnapshot({
        ...previousRequest,
        recordContext: nextRequest.recordContext,
      }, nextRequest);
    if (sameSession && (options.awaitingFeedback?.value || (initialDraft && appliedInitialDraft === draftKey))) {
      deferredClinicalRequest.value = nextRequest;
      return;
    }
    if (waiting && !initialDraft && !sameSession) {
      if (analysis.request.value) reset();
      return;
    }
    const cache = nextRequest && voiceOutpatientEmrDraftCache.draft
      && isSameOutpatientEmrAnalysisRequestSnapshot(voiceOutpatientEmrDraftCache.draft.request, nextRequest)
      ? voiceOutpatientEmrDraftCache.draft : null;
    const preservedEdits = sameSession ? collectDoctorEdits() : cache?.values ?? null;
    const previousFields = analysis.targetFields.value.length ? analysis.targetFields.value : pendingEditFields;
    const preservedFields = sameSession ? previousFields : cache?.fields ?? [];
    // Clinical/selection updates are new analysis rounds under the same HIS
    // request. Disabling or replacing the session clears all retained edits.
    const reviewedEdits = pendingReviewedEdits?.owner === templateSource.matchingContext.value && nextRequest ? pendingReviewedEdits : null;
    const sections = sameSession ? reviewedSections.value : cache?.reviewedSections ?? {};
    reset();
    reviewedSections.value = sections;
    pendingReviewedEdits = reviewedEdits;
    appliedInitialDraft = draftKey;
    pendingDoctorEdits = preservedEdits;
    pendingEditFields = preservedFields;
    if (nextRequest) void analysis.start(nextRequest, initialDraft);
  }, { immediate: true, flush: 'sync' });

  onScopeDispose(() => {
    const request = currentRequest.value;
    const values = collectDoctorEdits();
    voiceOutpatientEmrDraftCache.draft = cacheEpoch === voiceOutpatientEmrDraftCache.epoch
      && request && isCurrent.value && (Object.keys(values).length > 0 || Object.keys(reviewedSections.value).length > 0)
      ? { request, values, reviewedSections: reviewedSections.value, fields: analysis.targetFields.value.length ? analysis.targetFields.value : pendingEditFields }
      : null;
    stopSectionRuns();
    pendingDoctorEdits = null;
    revision += 1;
    analysis.reset();
  });

  async function retry(): Promise<boolean> {
    if (!canRetry.value) return false;
    const failedSections = Object.keys(reviewedSections.value).filter(key => reviewedSections.value[key].error);
    if (failedSections.length) {
      return (await Promise.all(failedSections.map(key => syncReviewedSection(key, 'retry')))).every(Boolean);
    }
    if (templateSource.error.value) {
      templateSource.retry();
      return true;
    }
    if (waitingForInitialDraft.value && currentRequest.value) {
      appliedInitialDraft = initialDraftKey.value;
      return analysis.start(currentRequest.value);
    }
    if (deferredClinicalRequest.value) {
      const latest = deferredClinicalRequest.value;
      const edits = collectDoctorEdits();
      const fields = analysis.targetFields.value;
      const sections = reviewedSections.value;
      reset();
      reviewedSections.value = sections;
      appliedInitialDraft = initialDraftKey.value;
      pendingDoctorEdits = edits;
      pendingEditFields = fields;
      return analysis.start(latest);
    }
    if (Object.keys(reviewedSections.value).length) pendingDoctorEdits = collectDoctorEdits();
    return analysis.retry();
  }

  function buildConfirmedPayload(
    basePayload: OutpatientEmrPreparedWritebackPayload | null = null,
    reviewedRecord?: Readonly<Partial<Record<OutpatientEmrRecordField, string>>>,
    selectedFields?: { ids: ReadonlySet<string>; directText: Readonly<Record<string, string>> },
  ) {
    if (!canSubmit.value) return null;
    const payload = analysis.buildConfirmedPayload(basePayload, selectedFields ? reviewedRecord : recordFieldValues.value, reviewedRecord, selectedFields);
    if (!payload || !basePayload || selectedFields) return payload;

    const selectedRecordFields = new Set(basePayload.writebackScope.recordFields);
    const excludedIds = new Set(analysis.targetFields.value.flatMap((field) => (
      field.recordField && !selectedRecordFields.has(field.recordField) ? [field.id] : []
    )));
    const selectedMetadata = payload.templateMetadata.fields.filter((field) => !excludedIds.has(field.id));
    const retainSelected = <T>(values: Record<string, T>): Record<string, T> => (
      Object.fromEntries(Object.entries(values).filter(([id]) => !excludedIds.has(id)))
    );
    return {
      ...payload,
      templateMetadata: {
        ...payload.templateMetadata,
        fields: selectedMetadata,
      },
      fieldValues: retainSelected(payload.fieldValues),
      dictionarySelections: retainSelected(payload.dictionarySelections),
      emrFieldValues: retainSelected(payload.emrFieldValues),
    };
  }

  return {
    ...analysis,
    analysisErrorCode: computed(() => templateSource.error.value instanceof OutpatientEmrError
      ? templateSource.error.value.code : analysis.analysisErrorCode.value),
    analysisErrorMessage: computed(() => templateSource.error.value?.message || sectionError.value || analysis.analysisErrorMessage.value),
    analysisStatus: computed(() => templateSource.error.value || sectionError.value ? 'error' : analysis.analysisStatus.value),
    canSubmit,
    canRetry,
    narrativeSections,
    recordFieldValues,
    chapterRows,
    reviewSnapshot,
    restoreReviewSnapshot,
    reviewFieldSections,
    updateChapterText,
    updateChapterField,
    getModelDraft,
    getSupplementChapters, supplementEvidence, supplementRules,
    previewSupplementRecord,
    applySupplementFields,
    updateReviewedRecordField,
    stopGenerationForWriteback() { stopSectionRuns(); analysis.stopGenerationForWriteback(); },
    retry,
    buildConfirmedPayload,
    reset,
  };
}

export type VoiceOutpatientEmrRecord = ReturnType<typeof useVoiceOutpatientEmrRecord>;
