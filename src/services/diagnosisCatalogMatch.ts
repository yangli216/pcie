export interface DiagnosisCatalogCandidate {
  id: string;
  code: string;
  name: string;
  keywords?: string[];
}

export type DiagnosisCatalogAssessmentStatus =
  | 'exact'
  | 'compatible'
  | 'ambiguous'
  | 'conflict'
  | 'unmatched';

export interface DiagnosisCatalogAssessment<T extends DiagnosisCatalogCandidate = DiagnosisCatalogCandidate> {
  status: DiagnosisCatalogAssessmentStatus;
  matchedItem: T | null;
  suggestedMatchItem: T | null;
  alternatives: T[];
  reason: string;
}

export interface AssessDiagnosisCatalogMatchInput<T extends DiagnosisCatalogCandidate> {
  queryName: string;
  icdCode?: string;
  catalog: readonly T[];
}

type ModifierGroup = 'course' | 'laterality' | 'type' | 'etiology';

interface ModifierDefinition {
  group: ModifierGroup;
  value: string;
  patterns: RegExp[];
}

interface DiagnosisSemantics {
  normalizedName: string;
  coreName: string;
  modifiers: Partial<Record<ModifierGroup, string>>;
}

interface RankedCandidate<T extends DiagnosisCatalogCandidate> {
  item: T;
  semantics: DiagnosisSemantics;
  nameScore: number;
  icdScore: number;
  conflicts: ModifierGroup[];
  targetAddsModifiers: ModifierGroup[];
  sourceDropsModifiers: ModifierGroup[];
}

const MODIFIER_DEFINITIONS: ModifierDefinition[] = [
  { group: 'course', value: 'acute', patterns: [/急性/u] },
  { group: 'course', value: 'chronic', patterns: [/慢性/u] },
  { group: 'laterality', value: 'bilateral', patterns: [/双侧/u, /双眼/u, /双耳/u, /两侧/u] },
  { group: 'laterality', value: 'left', patterns: [/左侧/u, /左眼/u, /左耳/u, /左/u] },
  { group: 'laterality', value: 'right', patterns: [/右侧/u, /右眼/u, /右耳/u, /右/u] },
  { group: 'type', value: 'type2', patterns: [/(?:2|Ⅱ|II)型/iu] },
  { group: 'type', value: 'type1', patterns: [/(?:1|Ⅰ|I)型/iu] },
  { group: 'etiology', value: 'primary', patterns: [/原发性/u] },
  { group: 'etiology', value: 'secondary', patterns: [/继发性/u] },
];

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s\-_/（）()，,。.;；:：·]+/gu, '');
}

function parseSemantics(name: string): DiagnosisSemantics {
  const normalizedName = normalizeName(name);
  const modifiers: Partial<Record<ModifierGroup, string>> = {};
  let coreName = normalizedName;

  for (const definition of MODIFIER_DEFINITIONS) {
    if (
      !modifiers[definition.group]
      && definition.patterns.some((pattern) => pattern.test(normalizedName))
    ) {
      modifiers[definition.group] = definition.value;
      for (const pattern of definition.patterns) {
        coreName = coreName.replace(pattern, '');
      }
    }
  }

  return {
    normalizedName,
    coreName,
    modifiers,
  };
}

function compareModifiers(
  source: DiagnosisSemantics,
  target: DiagnosisSemantics,
): Pick<RankedCandidate<DiagnosisCatalogCandidate>, 'conflicts' | 'targetAddsModifiers' | 'sourceDropsModifiers'> {
  const conflicts: ModifierGroup[] = [];
  const targetAddsModifiers: ModifierGroup[] = [];
  const sourceDropsModifiers: ModifierGroup[] = [];
  const groups: ModifierGroup[] = ['course', 'laterality', 'type', 'etiology'];

  for (const group of groups) {
    const sourceValue = source.modifiers[group];
    const targetValue = target.modifiers[group];
    if (sourceValue && targetValue && sourceValue !== targetValue) {
      conflicts.push(group);
    } else if (!sourceValue && targetValue) {
      targetAddsModifiers.push(group);
    } else if (sourceValue && !targetValue) {
      sourceDropsModifiers.push(group);
    }
  }

  return { conflicts, targetAddsModifiers, sourceDropsModifiers };
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length);
  }

  const leftSet = new Set(left.split(''));
  const rightSet = new Set(right.split(''));
  let intersection = 0;
  for (const char of leftSet) {
    if (rightSet.has(char)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union ? intersection / union : 0;
}

function extractIcdCategory(value: string | undefined): string {
  return value?.trim().toUpperCase().match(/[A-Z][0-9]{2}/u)?.[0] || '';
}

function getIcdScore(sourceCode: string | undefined, targetCode: string): number {
  const sourceCategory = extractIcdCategory(sourceCode);
  const targetCategory = extractIcdCategory(targetCode);
  if (!sourceCategory || !targetCategory) return 0;
  if (sourceCategory === targetCategory) return 0.08;
  return sourceCategory[0] === targetCategory[0] ? 0.03 : 0;
}

function buildRankedCandidate<T extends DiagnosisCatalogCandidate>(
  item: T,
  source: DiagnosisSemantics,
  icdCode: string | undefined,
): RankedCandidate<T> {
  const semantics = parseSemantics(item.name);
  const modifierComparison = compareModifiers(source, semantics);
  const keywordScore = Math.max(
    0,
    ...(item.keywords || []).map((keyword) => similarity(source.normalizedName, normalizeName(keyword))),
  );
  return {
    item,
    semantics,
    nameScore: Math.max(
      similarity(source.normalizedName, semantics.normalizedName),
      keywordScore,
    ),
    icdScore: getIcdScore(icdCode, item.code),
    ...modifierComparison,
  };
}

function rankCandidates<T extends DiagnosisCatalogCandidate>(
  left: RankedCandidate<T>,
  right: RankedCandidate<T>,
): number {
  return (right.nameScore + right.icdScore) - (left.nameScore + left.icdScore)
    || left.item.name.localeCompare(right.item.name, 'zh-CN');
}

export function assessDiagnosisCatalogMatch<T extends DiagnosisCatalogCandidate>(
  input: AssessDiagnosisCatalogMatchInput<T>,
): DiagnosisCatalogAssessment<T> {
  const queryName = input.queryName.trim();
  if (!queryName) {
    return {
      status: 'unmatched',
      matchedItem: null,
      suggestedMatchItem: null,
      alternatives: [],
      reason: '诊断名称为空',
    };
  }

  const normalizedQuery = normalizeName(queryName);
  const queryIsCode = /^[a-z][0-9]{2}(?:\.[a-z0-9]+)?$/iu.test(queryName.trim());
  if (queryIsCode) {
    const codeMatch = input.catalog.find((item) => item.code.trim().toLowerCase() === queryName.trim().toLowerCase());
    return codeMatch
      ? {
          status: 'exact',
          matchedItem: codeMatch,
          suggestedMatchItem: null,
          alternatives: [],
          reason: '诊断编码精确命中标准库',
        }
      : {
          status: 'unmatched',
          matchedItem: null,
          suggestedMatchItem: null,
          alternatives: [],
          reason: '诊断编码未命中标准库',
        };
  }

  const source = parseSemantics(queryName);
  const ranked = input.catalog
    .map((item) => buildRankedCandidate(item, source, input.icdCode))
    .sort(rankCandidates);
  const exactName = ranked.find((candidate) => (
    candidate.semantics.normalizedName === normalizedQuery
    && candidate.conflicts.length === 0
  ));
  if (exactName) {
    return {
      status: 'exact',
      matchedItem: exactName.item,
      suggestedMatchItem: null,
      alternatives: [],
      reason: '诊断名称精确命中标准库',
    };
  }

  const compatible = ranked.filter((candidate) => (
    candidate.semantics.coreName === source.coreName
    && candidate.conflicts.length === 0
    && candidate.targetAddsModifiers.length === 0
    && candidate.sourceDropsModifiers.length > 0
  ));
  if (compatible.length === 1) {
    return {
      status: 'compatible',
      matchedItem: null,
      suggestedMatchItem: compatible[0].item,
      alternatives: ranked
        .filter((candidate) => (
          candidate !== compatible[0]
          && candidate.conflicts.length === 0
          && candidate.nameScore >= 0.5
        ))
        .slice(0, 5)
        .map((candidate) => candidate.item),
      reason: '标准项省略了 AI 诊断中的临床修饰词，需医生确认',
    };
  }
  if (compatible.length > 1) {
    return {
      status: 'ambiguous',
      matchedItem: null,
      suggestedMatchItem: null,
      alternatives: compatible.slice(0, 5).map((candidate) => candidate.item),
      reason: '存在多个语义兼容的标准诊断项，需医生选择',
    };
  }

  const related = ranked.filter((candidate) => (
    candidate.nameScore >= 0.45
    || candidate.semantics.coreName === source.coreName
  ));
  const nonConflictingRelated = related.filter((candidate) => candidate.conflicts.length === 0);
  if (nonConflictingRelated.length > 0) {
    return {
      status: 'ambiguous',
      matchedItem: null,
      suggestedMatchItem: null,
      alternatives: nonConflictingRelated.slice(0, 5).map((candidate) => candidate.item),
      reason: '相近标准项会改变临床修饰或核心疾病范围，不能自动匹配',
    };
  }
  if (related.some((candidate) => candidate.conflicts.length > 0)) {
    return {
      status: 'conflict',
      matchedItem: null,
      suggestedMatchItem: null,
      alternatives: related.slice(0, 5).map((candidate) => candidate.item),
      reason: '相近标准项与 AI 诊断存在临床修饰词冲突',
    };
  }

  return {
    status: 'unmatched',
    matchedItem: null,
    suggestedMatchItem: null,
    alternatives: [],
    reason: '未找到语义兼容的标准诊断项',
  };
}
