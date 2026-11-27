import type { OutpatientEmrRecordField, OutpatientEmrTemplateField, OutpatientEmrTemplateParseResult } from '../types';
import { resolveOutpatientEmrFinalDictionaryItem } from './outpatientEmrDictionary';
import { readFieldSourceText } from './outpatientEmrTemplate';
import { isTemplateObject, readOutpatientEmrChapters } from './outpatientEmrTemplateDefinition';
import { isAdministrativeTemplateSlot, isOutpatientEmrDurationField, resolveOutpatientEmrFieldPromptProfile } from './outpatientEmrPromptGenerator';

type TextPart = { kind: 'text'; text: string };
type Slot = { kind: 'field'; field: OutpatientEmrTemplateField };
type SourcePart = TextPart | Slot;
type ScannedPart = SourcePart | { kind: 'missing' };

export type OutpatientEmrNarrativePart = TextPart | (Slot & { text: string });
export interface OutpatientEmrNarrativeClause {
  parts: SourcePart[];
  separator: string;
}

export interface OutpatientEmrNarrativeSection {
  key: string;
  title: string;
  recordField: OutpatientEmrRecordField | null;
  fields: OutpatientEmrTemplateField[];
  directField: OutpatientEmrTemplateField | null;
  fallback?: boolean;
  clauses: OutpatientEmrNarrativeClause[];
}

export interface OutpatientEmrDocumentChapter {
  /** Original data-id of the rendered HIS article. Titles and standard record mappings are not unique. */
  id: string;
  title: string;
  fields: { field: OutpatientEmrTemplateField; editable: boolean; placeholder?: string }[];
  sections: OutpatientEmrNarrativeSection[];
  /** Present only in the model's source-reading pass, never used to derive writable targets. */
  referenceSlots?: Array<{ id: string; name: string; htmlText: string; readonly: boolean }>;
}

function chapterBodyNameMatches(field: OutpatientEmrTemplateField, titles: readonly string[]): boolean {
  const normalize = (label: string) => label.trim().replace(/^(?:请输入|请填写)\s*/u, '').replace(/[：:]$/u, '').trim();
  const names = new Set(titles.filter(Boolean).map(normalize));
  return [field.name, field.id].some(label => {
    const name = normalize(label);
    return names.has(name) || names.has(name.replace(/(?:结果文本|文本|全文|正文|内容|详情|描述)$/u, ''))
      || ['全文', '章节正文', '正文'].includes(name);
  });
}

/** Input instructions name the control, not another clinical paragraph. */
export function outpatientEmrChapterFieldTitle(field: OutpatientEmrTemplateField, title: string): string {
  return ['text', 'textarea'].includes(field.type.toLowerCase()) && !field.dictionaryItems.length
    && resolveOutpatientEmrFieldPromptProfile(field).shape === 'narrative'
    && chapterBodyNameMatches(field, [title, field.articleId, field.articleDefinitionName])
    ? title : field.name || title;
}

/** A bare input can be a duration, a measurement or a detail. Only a named full-body
 * text slot in its own clause can safely receive reviewed chapter prose verbatim. */
export function outpatientEmrChapterTextField(chapter: OutpatientEmrDocumentChapter): OutpatientEmrTemplateField | undefined {
  const fields = chapter.fields.filter(slot => slot.editable).map(slot => slot.field);
  const titles = [chapter.title, ...fields.flatMap(field => [field.articleId, field.articleDefinitionName])];
  const candidates = fields.filter(field => {
    if (!['text', 'textarea'].includes(field.type) || field.dictionaryItems.length
      || [field.name, field.id].some(label => /(?:时间|时长|日期|多久)$/u.test(label))
      || resolveOutpatientEmrFieldPromptProfile(field, fields).shape !== 'narrative') return false;
    return chapterBodyNameMatches(field, titles) && chapter.sections.some(section => section.clauses.some(clause => !clause.separator
      && clause.parts.length === 1 && clause.parts[0].kind === 'field' && clause.parts[0].field.id === field.id));
  });
  return candidates.length === 1 ? candidates[0] : undefined;
}

interface DocumentScan {
  fields: ReadonlyMap<string, OutpatientEmrTemplateField>;
  chapters: OutpatientEmrDocumentChapter[];
  includeReferenceSlots: boolean;
}

const IGNORE = 'header,footer,nav,button,script,style,template,h1,h2,h3,h4,h5,h6,.tag-article-title,.tag-marker,.placeholder,[hidden],[aria-hidden="true"]';
const BLOCK = 'p,div,li,tr,td,th,section,.fragment';
const SLOT = '[data-id][data-type]';
const SEPARATOR = /([，,；;。！？!?]+)/u;

function hidden(element: HTMLElement): boolean {
  return element.matches(IGNORE) || element.style.display === 'none' || element.style.visibility === 'hidden';
}

function fieldLabel(field: OutpatientEmrTemplateField): string {
  return (field.name || field.id).replace(/标志$/u, '') || field.name || field.id;
}

// A pair joined by a slash has a shared unit only when the template supplies it after both slots.
function sharedPairUnit(parts: ScannedPart[]): string {
  const slots = parts.map((part, index) => part.kind === 'text' ? -1 : index).filter(index => index >= 0);
  if (slots.length !== 2) return '';
  const between = parts.slice(slots[0] + 1, slots[1]).map(part => part.kind === 'text' ? part.text : '').join('').trim();
  const suffix = parts.slice(slots[1] + 1).map(part => part.kind === 'text' ? part.text : '').join('').trim();
  return between === '/' && /^(?:[a-zA-Zμµ℃℉%][a-zA-Zμµ℃℉%²³0-9/^·]*|次\/分)$/u.test(suffix) ? suffix : '';
}

function labelAndSlot(field: OutpatientEmrTemplateField, unit = ''): SourcePart[] {
  return [
    { kind: 'text', text: fieldLabel(field) + '：' },
    { kind: 'field', field },
    ...(unit ? [{ kind: 'text' as const, text: unit }] : []),
  ];
}

function articleTitle(article: HTMLElement): string {
  const heading = [...article.querySelectorAll<HTMLElement>('.tag-article-title')].find(element => {
    if (element.closest('[data-article]') !== article) return false;
    for (let current: HTMLElement | null = element; current && current !== article; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true'
        || current.style.display === 'none' || current.style.visibility === 'hidden') return false;
    }
    return true;
  });
  if (heading) {
    const label = heading.cloneNode(true) as HTMLElement;
    label.querySelectorAll<HTMLElement>('*').forEach(child => {
      if (hidden(child) || child.matches(SLOT)) child.remove();
    });
    const title = label.textContent?.replace(/\s+/gu, ' ').trim().replace(/[：:]$/u, '').trim();
    if (title) return title;
  }
  return (article.dataset.name || article.dataset.article || article.dataset.id || '').trim();
}

/** Reads the structure from the current rendered instance. Slot nodes are atomic:
 * markers, placeholder text, patient values and dictionary captions inside them are never copied. */
export function parseOutpatientEmrNarrative(
  sanitizedHtml: string, targetFields: readonly OutpatientEmrTemplateField[],
): OutpatientEmrNarrativeSection[] {
  return scanNarrative(sanitizedHtml, targetFields);
}

/** A chapter belongs to the rendered HIS instance, even when it has no standard mapping or shares one. */
export function buildOutpatientEmrDocument(
  parsed: OutpatientEmrTemplateParseResult, includeReferenceSlots = false, templateDefinition?: string,
): OutpatientEmrDocumentChapter[] {
  const chapters: OutpatientEmrDocumentChapter[] = [];
  scanNarrative(parsed.sanitizedHtml, parsed.targetFields, {
    fields: new Map(parsed.fields.map(field => [field.id, field])),
    chapters, includeReferenceSlots,
  });
  if (templateDefinition) {
    const declared = new Map<string, string>();
    for (const article of readOutpatientEmrChapters(templateDefinition).filter(isTemplateObject)) {
      for (const leaf of Array.isArray(article.eles) ? article.eles.filter(isTemplateObject) : []) {
        if (typeof leaf.DEFAULTVALUE === 'string' && leaf.DEFAULTVALUE.trim()) {
          declared.set(JSON.stringify([article.ID, leaf.ID]), leaf.DEFAULTVALUE.trim());
        }
      }
    }
    for (const chapter of chapters) {
      for (const slot of chapter.fields) {
        const defaultValue = declared.get(JSON.stringify([chapter.id, slot.field.id]));
        if (!slot.placeholder && defaultValue && (defaultValue === slot.field.name || defaultValue === slot.field.id
          || /^(?:请(?:在此|输入|选择|补录|填写|录入)|如(?:有|需).*(?:输入|填写)|此处.*(?:同步|录入)|内容包括|\{[^{}]+\}$)/u.test(defaultValue))) {
          slot.placeholder = defaultValue;
        }
      }
    }
  }
  return chapters;
}

function scanNarrative(
  sanitizedHtml: string, targetFields: readonly OutpatientEmrTemplateField[], documentScan?: DocumentScan,
): OutpatientEmrNarrativeSection[] {
  if ((!targetFields.length && !documentScan) || typeof document === 'undefined') return [];
  const template = document.createElement('template');
  template.innerHTML = sanitizedHtml;
  const targets = new Map(targetFields.map(field => [field.id, field]));
  const sections = new Map<string, OutpatientEmrNarrativeSection>();
  const seenFields = new Set<string>();

  const articles = [...template.content.querySelectorAll<HTMLElement>('[data-article]')];
  const articleIds = new Set<string>();
  const ambiguousArticles = new Set<string>();
  if (documentScan) {
    for (const article of articles) {
      const id = article.dataset.id;
      if (!id) continue;
      if (articleIds.has(id)) ambiguousArticles.add(id);
      articleIds.add(id);
    }
  }
  for (const article of articles) {
    let ancestor: HTMLElement | null = article;
    while (ancestor && !hidden(ancestor)) ancestor = ancestor.parentElement;
    if (ancestor) continue;
    const articleTemplateId = article.dataset.id || '';
    if (documentScan && (!articleTemplateId || ambiguousArticles.has(articleTemplateId)
      || isAdministrativeTemplateSlot('', '', [articleTemplateId, article.dataset.article, article.dataset.name]))) continue;
    const chapter: OutpatientEmrDocumentChapter | undefined = documentScan
      ? { id: articleTemplateId, title: articleTitle(article), fields: [], sections: [] } : undefined;
    let parts: ScannedPart[] = [];
    let attachedGuidance: OutpatientEmrNarrativeClause | undefined;

    function sectionFor(field: OutpatientEmrTemplateField): OutpatientEmrNarrativeSection {
      const key = chapter ? chapter.id : JSON.stringify([field.articleTemplateId, field.recordField]);
      let section = sections.get(key);
      if (!section) {
        section = {
          key, title: chapter?.title || field.articleName || field.articleDefinitionName || field.articleId,
          recordField: field.recordField, fields: [], directField: null, clauses: [],
        };
        sections.set(key, section);
        chapter?.sections.push(section);
      } else if (chapter && section.recordField !== field.recordField) {
        section.recordField = null;
      }
      return section;
    }

    function flush(separator = '') {
      const slots = parts.filter((part): part is Slot => part.kind === 'field');
      if (slots.length) {
        const section = sectionFor(slots[0].field);
        attachedGuidance = undefined;
        const mixed = !chapter && slots.some(slot => slot.field.recordField !== section.recordField);
        if (mixed || parts.some(part => part.kind === 'missing')) {
          // A hidden dependency or a different mapped paragraph can change the meaning of a clause.
          const unit = sharedPairUnit(parts);
          for (const slot of slots) sectionFor(slot.field).clauses.push({ parts: labelAndSlot(slot.field, unit), separator });
        } else {
          const kept = parts.filter((part): part is SourcePart => part.kind !== 'missing');
          if (kept[0]?.kind === 'text') {
            let first = kept[0].text.trimStart();
            for (const title of [section.title, slots[0].field.articleDefinitionName, slots[0].field.articleId]) {
              if (title && first.startsWith(title) && /^[：:]/u.test(first.slice(title.length))) {
                first = first.slice(title.length + 1).trimStart();
                break;
              }
            }
            kept[0] = { kind: 'text', text: first };
          }
          const last = kept[kept.length - 1];
          if (last?.kind === 'text') last.text = last.text.trimEnd();
          const clause = { parts: kept.filter(part => part.kind !== 'text' || part.text), separator };
          section.clauses.push(clause);
          if (section.recordField === 'precautions' && last?.kind === 'text' && last.text.trim()) attachedGuidance = clause;
        }
      } else if (attachedGuidance && /^[，,；;]+$/u.test(attachedGuidance.separator)
        && parts.length && parts.every(part => part.kind === 'text')) {
        // A continuous instruction after a populated advice slot can contain commas.
        // Keep it within the same sentence and DOM block, never copy standalone findings.
        attachedGuidance.parts.push({ kind: 'text', text: attachedGuidance.separator }, ...parts);
        attachedGuidance.separator = separator;
      } else {
        attachedGuidance = undefined;
      }
      parts = [];
    }

    function scan(node: Node): void {
      if (node.nodeType === 3) {
        const raw = node.textContent || '';
        if (!raw.trim() && /[\r\n\t]/u.test(raw)) return;
        raw.replace(/\s+/gu, ' ').split(SEPARATOR).forEach((text, index) => {
          if (index % 2) flush(text);
          else if (text) parts.push({ kind: 'text', text });
        });
        return;
      }
      if (node.nodeType !== 1) return;
      const element = node as HTMLElement;
      if (hidden(element)) return;
      if (element.matches('[data-article]')) {
        flush();
        return;
      }
      if (element.matches(SLOT)) {
        if (element.dataset.type?.toLowerCase() === 'import') return;
        const id = element.dataset.id || '';
        const field = targets.get(id);
        const metadata = field ?? documentScan?.fields.get(id);
        const paired = metadata && metadata.articleTemplateId === articleTemplateId
          && metadata.type === element.dataset.type
          && !isAdministrativeTemplateSlot(metadata.id, metadata.name, [metadata.articleId, metadata.articleTemplateId,
            metadata.articleName, metadata.articleDefinitionName]);
        const editable = Boolean(paired && field && !field.readonly && element.dataset.readonly !== 'true');
        if (chapter && paired && !chapter.fields.some(item => item.field.id === id)) {
          const placeholder = element.querySelector('.placeholder')?.textContent?.trim();
          chapter.fields.push({ field: metadata, editable, ...(placeholder ? { placeholder } : {}) });
        }
        if (chapter && documentScan?.includeReferenceSlots && !editable
          && !isAdministrativeTemplateSlot(id, element.dataset.name || '', [articleTemplateId, article.dataset.name, article.dataset.article])) {
          (chapter.referenceSlots ??= []).push({ id, name: element.dataset.name || id, htmlText: readFieldSourceText(element, true),
            readonly: element.dataset.readonly === 'true' });
        }
        const slot = editable ? field : documentScan?.includeReferenceSlots && paired ? metadata : undefined;
        if (!slot || seenFields.has(id)) {
          parts.push({ kind: 'missing' });
        } else {
          seenFields.add(slot.id);
          sectionFor(slot).fields.push(slot);
          parts.push({ kind: 'field', field: slot });
        }
        return;
      }
      const block = element.matches(BLOCK);
      if (block || element.tagName === 'BR') flush();
      element.childNodes.forEach(scan);
      if (block) flush();
    }

    article.childNodes.forEach(scan);
    flush();
    if (documentScan && chapter && (chapter.fields.length || !article.querySelector(SLOT))) {
      documentScan.chapters.push(chapter);
    }
  }
  const parsed = [...sections.values()];
  // The clinical sentence omits paper furniture. A legitimately writable header or an
  // unbound slot still needs its own doctor-reviewed editor and its original writeback ID.
  for (const field of targetFields) {
    if (field.readonly || seenFields.has(field.id)) continue;
    seenFields.add(field.id);
    parsed.push({
      key: JSON.stringify(['field', field.articleTemplateId, field.id]), title: field.name || field.id,
      recordField: field.recordField, fields: [field], directField: null, fallback: true,
      clauses: [{ parts: [{ kind: 'field', field }], separator: '' }],
    });
  }
  for (const section of parsed) {
    const field = section.fields[0];
    const parts = section.clauses[0]?.parts || [];
    if (section.fields.length === 1 && section.clauses.length === 1 && parts.length === 1
      && !section.clauses[0].separator && parts[0].kind === 'field' && field.dictionaryItems.length === 0
      && ['text', 'textarea'].includes(field.type.toLowerCase())
      && (field.projectionMode !== 'section-compose' || field.name === section.title
        || (chapterBodyNameMatches(field, [section.title]) && resolveOutpatientEmrFieldPromptProfile(field, section.fields).shape === 'narrative'))) {
      section.directField = field;
    }
  }
  return parsed;
}

function templateParts(section: OutpatientEmrNarrativeSection, clause: OutpatientEmrNarrativeClause): SourcePart[] {
  if (clause.parts.some(part => part.kind === 'text' && part.text.trim())) return clause.parts;
  const slots = clause.parts.filter((part): part is Slot => part.kind === 'field');
  if (slots.length === 2) {
    const [symptom, duration] = slots.map(slot => slot.field);
    const chief = [symptom.articleId, symptom.articleName, symptom.articleDefinitionName].some(title => /^(?:主诉|chiefComplaint)$/iu.test(title));
    if (chief && /症状|主诉|chiefComplaint|chiefSymptom|symptom/iu.test(symptom.name + symptom.id)
      && isOutpatientEmrDurationField(duration)) return clause.parts;
  }
  // Other bare controls need their field labels to make each value intelligible.
  if (clause.parts.length === 1) {
    const part = clause.parts[0];
    if (part.kind === 'field' && (section.directField === part.field || part.field.projectionMode === 'direct' || fieldLabel(part.field) === section.title)) return [part];
  }
  return clause.parts.flatMap((part, index) => part.kind === 'field'
    ? [...(index ? [{ kind: 'text' as const, text: '；' }] : []), ...labelAndSlot(part.field)] : []);
}

export function renderOutpatientEmrNarrative(
  section: OutpatientEmrNarrativeSection, values: Readonly<Record<string, string>>,
): OutpatientEmrNarrativePart[] {
  function valueFor(field: OutpatientEmrTemplateField): string {
    return Object.prototype.hasOwnProperty.call(values, field.id) ? values[field.id] : '';
  }
  const result: OutpatientEmrNarrativePart[] = [];
  let separator = '';
  for (const clause of section.clauses) {
    const source = templateParts(section, clause);
    const present = source.filter((part): part is Slot => part.kind === 'field' && Boolean(valueFor(part.field).trim()));
    if (!present.length) continue;
    // An empty suffix may be dropped if the remaining literal already names the
    // subject of its flag (e.g. “否认肝炎史”). Otherwise show each known value with its label.
    const suffix = source[source.length - 1];
    const literal = source[source.length - 2];
    const flag = source[source.length - 3];
    const completeFlag = suffix?.kind === 'field' && !valueFor(suffix.field).trim()
      && /(?:补充|备注|说明)$/u.test(suffix.field.name) && flag?.kind === 'field' && flag.field.dictionaryItems.length
      && literal?.kind === 'text' && literal.text.trim() === fieldLabel(flag.field);
    const available = completeFlag ? source.slice(0, -1) : source;
    const incomplete = available.some(part => part.kind === 'field' && !valueFor(part.field).trim());
    const unit = incomplete ? sharedPairUnit(source) : '';
    const visible: SourcePart[] = incomplete
      ? present.flatMap((slot, index) => [...(index ? [{ kind: 'text' as const, text: '；' }] : []), ...labelAndSlot(slot.field, unit)])
      : available;
    const previousText = result[result.length - 1]?.text || '';
    if (result.length && !/[。！？!?；;，,]$/u.test(previousText)) {
      result.push({ kind: 'text', text: separator || '；' });
    }
    for (const part of visible) {
      if (part.kind === 'text') result.push(part);
      else {
        const value = valueFor(part.field);
        const text = part.field.dictionaryItems.length
          ? resolveOutpatientEmrFinalDictionaryItem(part.field, value)?.text ?? value : value;
        result.push({ ...part, text });
      }
    }
    separator = clause.separator;
  }
  if (/^[。！？!?]+$/u.test(separator) && !/[。！？!?]$/u.test(result[result.length - 1]?.text || '')) {
    result.push({ kind: 'text', text: separator });
  }
  return result;
}

export function renderOutpatientEmrNarrativeSections(
  sections: readonly OutpatientEmrNarrativeSection[], values: Readonly<Record<string, string>>,
): OutpatientEmrNarrativePart[] {
  const result: OutpatientEmrNarrativePart[] = [];
  for (const section of sections) {
    const parts = renderOutpatientEmrNarrative(section, values);
    if (!parts.length) continue;
    if (result.length) result.push({ kind: 'text', text: '\n' });
    result.push(...parts);
  }
  return result;
}

/** A dictionary may legitimately contain a word also used in the paper as a hint. */
export function isVoiceOutpatientEmrFieldPlaceholder(
  field: OutpatientEmrTemplateField, value: unknown, placeholder?: string,
): boolean {
  if (typeof value !== 'string' || !value.trim() || resolveOutpatientEmrFinalDictionaryItem(field, value)) return false;
  const text = value.trim();
  const unwrapped = text.replace(/^\{([^{}]+)\}$/u, '$1');
  const hint = placeholder?.trim();
  if (hint && unwrapped === hint) return true;
  if (['请输入', '请选择'].includes(text)) return true;
  return [field.id, field.name].some(label => {
    if (unwrapped === label && (text !== unwrapped || /(?:文本|正文|时长|时间|日期|单位|编码|标志|说明|详情)$/u.test(label)
      || (field.projectionMode === 'direct' && [field.articleId, field.articleName, field.articleDefinitionName].includes(label)
        && ['请输入', '请选择'].some(prefix => hint === prefix + label)))) return true;
    return text === '请输入' + label || text === '请选择' + label;
  });
}

export function renderVoiceOutpatientEmrChapter(
  chapter: OutpatientEmrDocumentChapter, rawValues: Readonly<Record<string, string | null | undefined>>,
): string {
  const values: Record<string, string> = Object.create(null);
  for (const { field, editable, placeholder } of chapter.fields) {
    if (!editable || !Object.prototype.hasOwnProperty.call(rawValues, field.id)) continue;
    const value = rawValues[field.id];
    if (typeof value !== 'string' || isVoiceOutpatientEmrFieldPlaceholder(field, value, placeholder)) continue;
    if (field.dictionaryItems.length && !resolveOutpatientEmrFinalDictionaryItem(field, value)) continue;
    values[field.id] = value;
  }
  return renderOutpatientEmrNarrativeSections(chapter.sections, values).map(part => part.text).join('');
}

/** Additional model context describes grammar and exact authorized slot identities, never current values. */
export function describeOutpatientEmrNarrative(
  sections: readonly OutpatientEmrNarrativeSection[],
  identifiers: readonly (string | undefined)[] = [],
) {
  // HIS renderers may have substituted the patient identity into an otherwise fixed clinical phrase.
  const privateText = identifiers.filter((value): value is string => !!value?.trim()).sort((a, b) => b.length - a.length);
  const redact = (value: string) => privateText.reduce((text, token) => text.split(token).join('〔已隐去〕'), value);
  return sections.filter(section => !section.fallback).map(section => ({
    title: redact(section.title),
    recordField: section.recordField,
    clauses: section.clauses.map(clause => [
      ...templateParts(section, clause).map(part => part.kind === 'text' ? { kind: 'text' as const, text: redact(part.text) } : {
        kind: 'field' as const, id: part.field.id, name: redact(part.field.name),
      }),
      ...(clause.separator ? [{ kind: 'text' as const, text: clause.separator }] : []),
    ]),
  }));
}
