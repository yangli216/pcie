export interface DrugInstructionSection {
  heading: string;
  content: string;
}

/** Only identify line headings; keep every character of the source text. */
export function drugInstructionSections(summary: string): DrugInstructionSection[] {
  const headings = [...summary.matchAll(/^【[^【】\r\n]+】[ \t]*\r?/gm)];
  if (!headings.length) return summary ? [{ heading: '', content: summary }] : [];
  const sections: DrugInstructionSection[] = [];
  const first = headings[0]!;
  if (first.index! > 0) sections.push({ heading: '', content: summary.slice(0, first.index) });
  headings.forEach((heading, index) => {
    sections.push({
      heading: heading[0],
      content: summary.slice(heading.index! + heading[0].length, headings[index + 1]?.index ?? summary.length),
    });
  });
  return sections;
}

export function isDrugUsageSection(section: DrugInstructionSection): boolean {
  return /用法\s*(?:与|及|和)?\s*用量|用量\s*(?:与|及|和)?\s*用法/.test(section.heading);
}
