import { renderOutpatientEmrNarrative, type OutpatientEmrNarrativePart, type OutpatientEmrNarrativeSection } from './outpatientEmrNarrative';

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// The main exam may keep an individual template value in literal braces.
function patternFor(part: OutpatientEmrNarrativePart): string {
  const literal = escapePattern(part.text);
  return part.kind === 'field' ? `(?:\\{${literal}\\}|${literal})` : literal;
}

function embeddedValue(before: string, match: string, after: string): boolean {
  const bare = match.replace(/[{}]/gu, '');
  return (/^\d/u.test(bare) && /[\d.+\-]$/u.test(before))
    || (/\d$/u.test(bare) && /^(?:\d|\.\d)/u.test(after))
    || (/^[a-z]/iu.test(bare) && /[a-z]$/iu.test(before))
    || (/[a-z]$/iu.test(bare) && /^[a-z]/iu.test(after))
    || (/^(?:有|无|否认)/u.test(bare) && /(?:没|无|未|未见|不|否认|并非)$/u.test(before));
}

/** A reviewed leaf can change the existing prose only where its old clinical phrase identifies it. */
export function patchVoiceRecordFieldEdit(
  recordText: string, chapter: OutpatientEmrNarrativeSection, values: Readonly<Record<string, string>>,
  fieldId: string, nextValue: string,
): string {
  if (chapter.fallback || !recordText || !nextValue.trim()) return recordText;
  const clause = chapter.clauses.find(item => item.parts.some(part => part.kind === 'field' && part.field.id === fieldId));
  if (!clause) return recordText;
  // Punctuation between clauses belongs to the original main paragraph.
  const section = { ...chapter, clauses: [{ ...clause, separator: '' }] };
  const parts = renderOutpatientEmrNarrative(section, values);
  const index = parts.findIndex(part => part.kind === 'field' && part.field.id === fieldId);
  const next = renderOutpatientEmrNarrative(section, { ...values, [fieldId]: nextValue })
    .find(part => part.kind === 'field' && part.field.id === fieldId);
  if (index < 0 || !next || parts[index].text === next.text) return recordText;
  const oldText = parts[index].text;
  if (chapter.directField?.id === fieldId && recordText === oldText) return next.text;

  // Compare the full clause first. The main narrative may omit the template's opening
  // or closing words, but neighboring slots (e.g. a denominator or time unit) stay together.
  const firstSlot = parts.findIndex(part => part.kind === 'field');
  const lastSlot = parts.reduce((last, part, i) => part.kind === 'field' ? i : last, -1);
  const missingPartner = firstSlot === lastSlot && clause.parts.filter(part => part.kind === 'field').length > 1;
  // Distinct leaves can use the same unit or wording even if their values currently differ.
  const slotMarker = '\u0000';
  const siblingPhrases = chapter.clauses.filter(item => item !== clause).flatMap(item => {
    const sibling = renderOutpatientEmrNarrative({ ...chapter, clauses: [item] }, values);
    return sibling.filter(part => part.kind === 'field').map(slot =>
      sibling.map(part => part === slot ? slotMarker : part.text).join(''));
  });
  const ranges = [
    [[0, parts.length]],
    [[firstSlot, parts.length], [0, lastSlot + 1]],
    [[firstSlot, lastSlot + 1]],
  ];
  for (const alternatives of ranges) {
    const offsets = new Set<number>();
    for (const [start, end] of alternatives) {
      const anchor = parts.slice(start, end);
      const context = anchor.filter(part => part !== parts[index]).map(part => part.text).join('');
      if (!/[\p{L}\p{N}℃℉%]/u.test(context)) continue;
      const prefix = parts.slice(start, index).map(patternFor).join('');
      const suffix = parts.slice(index + 1, end).map(patternFor).join('');
      const pattern = new RegExp(`(${prefix})(${patternFor(parts[index])})${suffix}`, 'gu');
      if (missingPartner && (start > 0 || end < parts.length)) continue;
      const phrase = anchor.map(part => part === parts[index] ? slotMarker : part.text).join('');
      if (siblingPhrases.some(text => text.includes(phrase))) continue;
      for (const match of recordText.matchAll(pattern)) {
        const position = match.index!;
        if (embeddedValue(recordText.slice(0, position), match[0], recordText.slice(position + match[0].length))) continue;
        offsets.add(position + match[1].length + (match[2] === oldText ? 0 : 1));
      }
    }
    if (offsets.size > 1) return recordText;
    if (offsets.size === 1) {
      const [offset] = offsets;
      return recordText.slice(0, offset) + next.text + recordText.slice(offset + oldText.length);
    }
  }
  return recordText;
}
