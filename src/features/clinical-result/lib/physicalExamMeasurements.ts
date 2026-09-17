/** Text-only anthropometry. Does not extend the PHIS five-slot vital contract. */
export function buildPhysicalExamMeasurements(detail: string, source: string, context: string): string {
  const relevant = /高血压|糖尿病|肥胖|体重|营养|代谢|体检/u.test(context);
  const definitions = [
    { label: '身高', unit: 'cm' }, { label: '体重', unit: 'kg' }, { label: '腰围', unit: 'cm' },
  ];
  let remainder = detail;
  const slots: string[] = [];
  for (const { label, unit } of definitions) {
    const pattern = new RegExp(`${label}\\s*[:：]?\\s*\\{?([0-9]+(?:\\.[0-9]+)?|${label})\\}?\\s*${unit}`, 'giu');
    const matches = [...`${source}；${detail}`.matchAll(pattern)];
    const measuredMatches = matches.filter((match) => Number(match[1]) > 0);
    const measured = measuredMatches[measuredMatches.length - 1]?.[1];
    if (!relevant && !matches.length) continue;
    slots.push(`${label}:{${measured || label}}${unit}`);
    remainder = remainder.replace(pattern, '').replace(/^[\s，,；;。]+/u, '');
  }
  remainder = remainder.replace(/([，,；;。])(?:\s*[，,；;。])+/gu, '$1').trim();
  return `${slots.length ? `${slots.join('，')}。` : ''}${remainder}`;
}
