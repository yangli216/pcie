export type ClinicalRecordNarrativeField =
  | 'chiefComplaint'
  | 'historyOfPresentIllness'
  | 'pastMedicalHistory'
  | 'personalHistory'
  | 'menstrualHistory'
  | 'maritalReproductiveHistory'
  | 'familyHistory'
  | 'physicalExam'
  | 'precautions';

export type ClinicalRecordNarrativeIssueCode =
  | 'process-placeholder-removed'
  | 'duplicate-sentence-removed'
  | 'duplicate-negative-removed'
  | 'negative-positive-conflict';

export interface ClinicalRecordNarrativeQualityIssue {
  code: ClinicalRecordNarrativeIssueCode;
  field?: ClinicalRecordNarrativeField;
  text: string;
  terms?: string[];
}

export interface ClinicalRecordNarrativeQualityResult {
  text: string;
  issues: ClinicalRecordNarrativeQualityIssue[];
}

export type ClinicalTermPolarity = 'negative' | 'positive' | 'mixed' | 'unknown';

const NEGATIVE_PREFIX_PATTERN = /(?:否认|无|未诉|未见|未闻及|未触及|未扪及|未引出|未及|没有|不伴有|不伴|未伴有|未伴|未出现|未发现)/u;
const NEGATIVE_PREFIX_GLOBAL_PATTERN = /(?:否认|无|未诉|未见|未闻及|未触及|未扪及|未引出|未及|没有|不伴有|不伴|未伴有|未伴|未出现|未发现)/gu;
const POSITIVE_RESET_PATTERN = /(?:但(?:是)?|然而|(?<!不|未)伴(?:有)?|(?<!未)出现|自觉|主诉|自诉|(?<!未)诉|(?<!未)发现|查见|可见|呈|今日|目前|现有)/gu;
const SENTENCE_PATTERN = /[^。！？!?；;\n]+[。！？!?；;\n]?/gu;
const GENERIC_NEGATIVE_TERMS = new Set([
  '异常',
  '不适',
  '症状',
  '体征',
  '特殊',
  '明显异常',
  '其他症状',
  '其他不适',
]);
const PROCESS_PLACEHOLDER_PATTERNS = [
  /(?:尚?待|需(?:要)?|请)\s*(?:临床)?医生\s*(?:进一步)?\s*(?:补充(?:完善)?|完善|核实|确认|询问|评估|查体)/u,
  /(?:尚?待|需(?:要)?)\s*(?:进一步)?\s*(?:补充(?:完善)?|完善|核实|确认)(?:相关)?(?:病史|信息|内容|情况|资料)?/u,
  /(?:建议|需要)\s*(?:医生)?\s*(?:进一步)?\s*(?:询问|补充|核实|确认|完善|评估)/u,
  /(?:信息|资料|病史|内容)\s*(?:不足|不全|缺失)/u,
  /(?:未提供|暂无)\s*(?:相关|明确|详细)?\s*(?:信息|资料|病史|内容)/u,
  /(?:对话|问诊|访谈|沟通|病历|病例|(?:现有|已有|提供的?|患者)?资料)(?:中|内)?(?:尚)?未(?:提及|说明|记录|提供|获取到|了解到|采集到|问及|确认)[^，,。！？!?；;]*(?:症状|不适|病情(?:变化|波动|控制)?|控制情况|监测结果|用药情况|不良反应|临床信息)/u,
  /(?:请|需)\s*(?:结合)?\s*(?:患者)?实际情况\s*(?:补充|完善|核实|确认)/u,
];

function normalizeComparable(value: string): string {
  return value.replace(/[\s，,。；;、：:！？!?（）()]/gu, '');
}

function normalizeTerm(value: string): string {
  return value
    .replace(/^(?:患者|病人|患儿|自诉|诉|查体)\s*/u, '')
    .replace(new RegExp(`^(?:${NEGATIVE_PREFIX_PATTERN.source})+\\s*`, 'u'), '')
    .replace(/^(?:明显|相关|其他)\s*/u, '')
    .replace(/(?:等)?(?:症状|体征|表现|情况)$/u, '')
    .replace(/[\s，,。；;、：:！？!?（）()]+$/gu, '')
    .trim();
}

function isProcessPlaceholderClause(value: string): boolean {
  const compact = value.trim().replace(/\s+/gu, '');
  if (!compact) return false;
  return PROCESS_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(compact));
}

function splitSentenceParts(value: string): Array<{ body: string; terminal: string }> {
  const parts: Array<{ body: string; terminal: string }> = [];
  for (const match of value.matchAll(SENTENCE_PATTERN)) {
    const raw = match[0];
    const terminalMatch = raw.match(/[。！？!?；;\n]$/u);
    parts.push({
      body: terminalMatch ? raw.slice(0, -terminalMatch[0].length) : raw,
      terminal: terminalMatch?.[0] || '',
    });
  }
  return parts;
}

function cleanSentenceBody(value: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const retained = value
    .split(/[，,]/u)
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      if (!isProcessPlaceholderClause(item)) return true;
      removed.push(item);
      return false;
    });
  return { text: retained.join('，'), removed };
}

function lastPatternIndex(value: string, pattern: RegExp): number {
  let index = -1;
  for (const match of value.matchAll(pattern)) {
    index = match.index ?? index;
  }
  return index;
}

function getOccurrencePolarity(sentence: string, termStart: number, term: string): Exclude<ClinicalTermPolarity, 'mixed'> {
  const prefix = sentence.slice(0, termStart);
  const suffix = sentence.slice(termStart + term.length, termStart + term.length + 12);
  const lastNegativeIndex = lastPatternIndex(prefix, NEGATIVE_PREFIX_GLOBAL_PATTERN);
  const lastPositiveResetIndex = lastPatternIndex(prefix, POSITIVE_RESET_PATTERN);

  if (lastNegativeIndex >= 0 && lastPositiveResetIndex <= lastNegativeIndex) {
    if (/^(?:\d+(?:小时|天|周|月|年)|明显|加重|反复|发作)/u.test(suffix)) {
      return 'positive';
    }
    return 'negative';
  }

  return 'positive';
}

export function getClinicalTermPolarity(corpus: string, rawTerm: string): ClinicalTermPolarity {
  const term = normalizeTerm(rawTerm);
  if (!corpus || !term) return 'unknown';

  let hasNegative = false;
  let hasPositive = false;
  for (const sentenceMatch of corpus.matchAll(SENTENCE_PATTERN)) {
    const sentence = sentenceMatch[0];
    let searchFrom = 0;
    while (searchFrom < sentence.length) {
      const termStart = sentence.indexOf(term, searchFrom);
      if (termStart < 0) break;
      const polarity = getOccurrencePolarity(sentence, termStart, term);
      if (polarity === 'negative') hasNegative = true;
      if (polarity === 'positive') hasPositive = true;
      searchFrom = termStart + term.length;
    }
  }

  if (hasNegative && hasPositive) return 'mixed';
  if (hasNegative) return 'negative';
  if (hasPositive) return 'positive';
  return 'unknown';
}

export function extractNegativeClinicalTerms(statement: string): string[] {
  const firstNegative = statement.search(NEGATIVE_PREFIX_PATTERN);
  if (firstNegative < 0) return [];

  const negativeBody = statement
    .slice(firstNegative)
    .replace(new RegExp(`^(?:${NEGATIVE_PREFIX_PATTERN.source})+\\s*`, 'u'), '')
    .split(/(?:但(?:是)?|然而|伴有|出现|自觉|主诉|发现|查见|可见|呈)/u, 1)[0];

  return Array.from(new Set(
    negativeBody
      .split(/[、，,]|(?:以及|及|和|与|或)/u)
      .map(normalizeTerm)
      .filter((item) => (
        item.length >= 2
        && item.length <= 24
        && !GENERIC_NEGATIVE_TERMS.has(item)
        && !/\d/u.test(item)
      )),
  ));
}

export function isNegativeClinicalStatementCovered(corpus: string, statement: string): boolean {
  const terms = extractNegativeClinicalTerms(statement);
  return terms.length > 0 && terms.every((term) => getClinicalTermPolarity(corpus, term) === 'negative');
}

function buildNegativeSentence(terms: readonly string[], terminal = '。'): string {
  return `否认${terms.join('、')}${terminal || '。'}`;
}

function isSimpleNegativeSentence(value: string): boolean {
  const trimmed = value.trim();
  if (!new RegExp(`^(?:患者|病人|患儿)?\\s*(?:${NEGATIVE_PREFIX_PATTERN.source})`, 'u').test(trimmed)) {
    return false;
  }
  const terms = extractNegativeClinicalTerms(trimmed);
  if (terms.length === 0) return false;
  const remainder = trimmed
    .replace(/^(?:患者|病人|患儿)?\s*/u, '')
    .replace(new RegExp(`^(?:${NEGATIVE_PREFIX_PATTERN.source})+\\s*`, 'u'), '')
    .replace(/[、，,]|(?:以及|及|和|与|或)/gu, '')
    .replace(/(?:等)?(?:症状|体征|表现|情况)?[。！？!?；;]?$/u, '');
  return terms.every((term) => remainder.includes(term));
}

export function normalizeGeneratedClinicalRecordNarrative(
  value: unknown,
  field?: ClinicalRecordNarrativeField,
): ClinicalRecordNarrativeQualityResult {
  const source = typeof value === 'string' ? value.trim() : '';
  if (!source) return { text: '', issues: [] };

  const issues: ClinicalRecordNarrativeQualityIssue[] = [];
  const retained: string[] = [];
  const seen = new Set<string>();

  for (const part of splitSentenceParts(source)) {
    const cleaned = cleanSentenceBody(part.body);
    cleaned.removed.forEach((text) => issues.push({
      code: 'process-placeholder-removed',
      field,
      text,
    }));
    if (!cleaned.text) continue;

    const terminal = part.terminal || '';
    const sentence = `${cleaned.text}${terminal}`;
    const comparable = normalizeComparable(sentence);
    if (!comparable) continue;
    if (seen.has(comparable)) {
      issues.push({ code: 'duplicate-sentence-removed', field, text: sentence });
      continue;
    }

    if (retained.length > 0 && isSimpleNegativeSentence(sentence)) {
      const previousText = retained.join('');
      const terms = extractNegativeClinicalTerms(sentence);
      const coveredTerms = terms.filter((term) => getClinicalTermPolarity(previousText, term) === 'negative');
      const conflictingTerms = terms.filter((term) => {
        const polarity = getClinicalTermPolarity(previousText, term);
        return polarity === 'positive' || polarity === 'mixed';
      });
      if (conflictingTerms.length > 0) {
        issues.push({
          code: 'negative-positive-conflict',
          field,
          text: sentence,
          terms: conflictingTerms,
        });
      } else if (coveredTerms.length > 0) {
        const missingTerms = terms.filter((term) => !coveredTerms.includes(term));
        issues.push({
          code: 'duplicate-negative-removed',
          field,
          text: sentence,
          terms: coveredTerms,
        });
        if (missingTerms.length === 0) continue;
        const rewritten = buildNegativeSentence(missingTerms, terminal || '。');
        retained.push(rewritten);
        seen.add(normalizeComparable(rewritten));
        continue;
      }
    }

    retained.push(sentence);
    seen.add(comparable);
  }

  return {
    text: retained.join('').trim(),
    issues,
  };
}

export function mergeStructuredNegativeSymptoms(
  historyOfPresentIllness: string,
  negativeSymptoms: readonly string[],
): ClinicalRecordNarrativeQualityResult {
  const normalizedHistory = normalizeGeneratedClinicalRecordNarrative(
    historyOfPresentIllness,
    'historyOfPresentIllness',
  );
  const issues = [...normalizedHistory.issues];
  const uniqueTerms = Array.from(new Set(
    negativeSymptoms
      .map(normalizeTerm)
      .filter((item) => item.length >= 2 && !GENERIC_NEGATIVE_TERMS.has(item)),
  ));
  const missingTerms: string[] = [];

  for (const term of uniqueTerms) {
    const polarity = getClinicalTermPolarity(normalizedHistory.text, term);
    if (polarity === 'negative') {
      issues.push({
        code: 'duplicate-negative-removed',
        field: 'historyOfPresentIllness',
        text: term,
        terms: [term],
      });
      continue;
    }
    if (polarity === 'positive' || polarity === 'mixed') {
      issues.push({
        code: 'negative-positive-conflict',
        field: 'historyOfPresentIllness',
        text: term,
        terms: [term],
      });
      continue;
    }
    missingTerms.push(term);
  }

  if (missingTerms.length === 0) {
    return { text: normalizedHistory.text, issues };
  }

  const current = normalizedHistory.text.replace(/[\s，,；;、]+$/gu, '');
  const separator = current && !/[。！？!?]$/u.test(current) ? '。' : '';
  return {
    text: `${current}${separator}${buildNegativeSentence(missingTerms)}`,
    issues,
  };
}
