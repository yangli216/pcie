import { PHYSICAL_EXAM_GUIDANCE_PROMPT } from './lib/physicalExamGuidance';
import type { ChatMessage, LLMConfigOverride } from '@/services/llm';
import type { Diagnosis } from '@/types/consultation';
import { parseLLMJson } from './clinicalResultLlmJsonParser';
import {
  collectHistoryRecordTemplateChanges,
  isHistoryRecordTemplate,
  stripHistoryRecordTemplateMarkers,
} from './historyRecordTemplates';
import {
  isNegativeClinicalStatementCovered,
  normalizeGeneratedClinicalRecordNarrative,
} from './clinicalRecordNarrativeQuality';

export type ClinicalRecordFactField =
  | 'historyOfPresentIllness'
  | 'pastMedicalHistory'
  | 'personalHistory'
  | 'familyHistory'
  | 'physicalExam';

export type ClinicalRecordFactSource = 'record-explicit' | 'structured-answer' | 'template-context';
export type ClinicalRecordFactPolarity = 'positive' | 'negative';
export type ClinicalRecordFactPriority = 'critical' | 'general';
export type ClinicalRecordFactStatus = 'pending' | 'dismissed';

export interface ClinicalRecordFactRecord {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  personalHistory: string;
  familyHistory: string;
  physicalExam: string;
}

export interface ClinicalRecordExplicitFact {
  id: string;
  field: ClinicalRecordFactField;
  text: string;
  source: ClinicalRecordFactSource;
  polarity: ClinicalRecordFactPolarity;
}

export interface ClinicalRecordFactSuggestion {
  id: string;
  field: ClinicalRecordFactField;
  question: string;
  negativeRecordText: string;
  rationale: string;
  priority: ClinicalRecordFactPriority;
  status: ClinicalRecordFactStatus;
}

export interface ClinicalRecordFactSuggestionResponse {
  items?: Array<Partial<Omit<ClinicalRecordFactSuggestion, 'id' | 'status'>>>;
}

export interface BuildClinicalRecordFactSuggestionRequestInput {
  channel: string;
  consultationId?: string;
  patient: { gender?: string; age?: string };
  record: ClinicalRecordFactRecord;
  diagnoses: readonly Pick<Diagnosis, 'name' | 'rate' | 'rationale'>[];
  explicitFacts: ClinicalRecordExplicitFact[];
}

export interface ClinicalRecordFactSuggestionRequestSpec {
  messages: ChatMessage[];
  config: LLMConfigOverride;
}

const FACT_FIELDS: ClinicalRecordFactField[] = [
  'historyOfPresentIllness',
  'pastMedicalHistory',
  'personalHistory',
  'familyHistory',
  'physicalExam',
];

const FIELD_LABELS: Record<ClinicalRecordFactField, string> = {
  historyOfPresentIllness: '现病史',
  pastMedicalHistory: '既往史',
  personalHistory: '个人史',
  familyHistory: '家族史',
  physicalExam: '体格检查',
};

const NEGATIVE_CLAUSE_PATTERN = /(?:否认|无|未见|不伴|未及|未闻及|未触及|未引出|未发现)[^，。；！？!?]{1,80}/gu;
const GENERIC_NEGATIVE_VALUES = new Set(['无', '无特殊', '无异常', '未见异常', '否认', '阴性']);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
}

function normalizeComparable(value: string): string {
  return value.replace(/[\s，。；、：:！？!?（）()]/gu, '');
}

function stableFactId(field: ClinicalRecordFactField, text: string, index: number): string {
  const compact = normalizeComparable(text).slice(0, 24);
  return `${field}-${index}-${compact || 'fact'}`;
}

function extractNegativeClauses(value: string): string[] {
  const clauses = value
    .split(/[。；;\n]+/u)
    .flatMap((sentence) => sentence.match(NEGATIVE_CLAUSE_PATTERN) || [])
    .map((item) => item.replace(/^(?:患者|自诉|诉|查体)/u, '').trim())
    .filter((item) => item && !GENERIC_NEGATIVE_VALUES.has(item.replace(/[。；;]$/u, '')));
  return Array.from(new Set(clauses));
}

export function getClinicalRecordFactFieldLabel(field: ClinicalRecordFactField): string {
  return FIELD_LABELS[field];
}

export function extractExplicitClinicalRecordFacts(
  record: ClinicalRecordFactRecord,
  negativeSymptoms: readonly string[] = [],
  positiveSymptoms: readonly string[] = [],
): ClinicalRecordExplicitFact[] {
  const facts: ClinicalRecordExplicitFact[] = [];
  const seen = new Set<string>();

  for (const field of FACT_FIELDS) {
    if (field === 'pastMedicalHistory' || field === 'personalHistory' || field === 'familyHistory') {
      const templateChanges = collectHistoryRecordTemplateChanges({ [field]: record[field] }, [field]);
      templateChanges?.items.forEach((change, index) => {
        const text = record[field].includes(change.replacementMarker)
          ? change.replacementMarker
          : stripHistoryRecordTemplateMarkers(change.replacementMarker);
        const comparable = `${field}:${normalizeComparable(text)}`;
        if (seen.has(comparable)) return;
        seen.add(comparable);
        facts.push({
          id: stableFactId(field, `${change.slotKey}-${text}`, index),
          field,
          text,
          source: 'template-context',
          polarity: 'positive',
        });
      });
    }
    if (isHistoryRecordTemplate(field, record[field])) continue;
    extractNegativeClauses(record[field]).forEach((text, index) => {
      const comparable = `${field}:${normalizeComparable(text)}`;
      if (seen.has(comparable)) return;
      seen.add(comparable);
      facts.push({
        id: stableFactId(field, text, index),
        field,
        text,
        source: 'record-explicit',
        polarity: 'negative',
      });
    });
  }

  negativeSymptoms
    .map((item) => normalizeText(item).replace(/^(?:否认|无|未见|不伴)/u, ''))
    .filter((item) => item && !GENERIC_NEGATIVE_VALUES.has(item))
    .forEach((symptom, index) => {
      const text = `无${symptom}`;
      const comparable = `historyOfPresentIllness:${normalizeComparable(text)}`;
      if (seen.has(comparable)) return;
      seen.add(comparable);
      facts.push({
        id: stableFactId('historyOfPresentIllness', text, index),
        field: 'historyOfPresentIllness',
        text,
        source: 'structured-answer',
        polarity: 'negative',
      });
    });

  const negativeClauses = extractNegativeClauses(record.historyOfPresentIllness)
    .map((item) => normalizeComparable(item));
  positiveSymptoms
    .map((item) => normalizeText(item))
    .filter((item) => item && record.historyOfPresentIllness.includes(item))
    .filter((item) => {
      const comparable = normalizeComparable(item);
      return !negativeClauses.some((clause) => clause.includes(comparable));
    })
    .forEach((symptom, index) => {
      const comparable = `historyOfPresentIllness:${normalizeComparable(symptom)}`;
      if (seen.has(comparable)) return;
      seen.add(comparable);
      facts.push({
        id: stableFactId('historyOfPresentIllness', symptom, index),
        field: 'historyOfPresentIllness',
        text: symptom,
        source: 'structured-answer',
        polarity: 'positive',
      });
    });

  return facts;
}

export function buildClinicalRecordFactSuggestionRequest(
  input: BuildClinicalRecordFactSuggestionRequestInput,
): ClinicalRecordFactSuggestionRequestSpec {
  const system = [
    '你是基层全科门诊的病历阴性内容核查助手。',
    '请识别两类候选：一是与当前主诉、病史或正式诊断相关的必要问诊/查体，二是门诊病历书写完整性通常需要核查的阴性或正常内容。',
    '即使输入中没有明确问诊依据，也允许生成规范的候选阴性表述；这些内容会作为带 AI 来源标记的可编辑病历草稿进入正文并随所选字段回写，不得描述成问诊已经明确的事实。',
    '既往史、个人史、家族史可能已经带有标准预制模板；只挑出与当前诊断高度相关或影响安全判断的少量条目核查，不要把整段模板全部设为待核查。',
    '不要重复输入中已经明确的阴性事实，不要生成与当前病例无关的大段全套模板，每个字段只保留最有价值的少量候选。',
    'critical 只用于急危重症排除、关键过敏或用药禁忌、重大鉴别风险；其他均为 general。',
    '只输出 JSON，不要输出 Markdown 或解释。',
  ].join('\n');
  const instructions = [
    '输出格式：{"items":[{"field":"historyOfPresentIllness|pastMedicalHistory|personalHistory|familyHistory|physicalExam","question":"医生要核查的具体问题","negativeRecordText":"医生确认无异常后可直接写入的规范阴性表述","rationale":"病例相关性或病历书写要求","priority":"critical|general"}]}。',
    PHYSICAL_EXAM_GUIDANCE_PROMPT,
    '没有需要补充的项目时返回 {"items":[]}。',
    'negativeRecordText 必须是医生确认后可成立的简短、规范临床阴性或正常表述，不得写“对话中未提及、问诊中未说明、资料中未记录、建议询问、待确认、考虑”等来源或过程措辞，来源标记由界面单独展示。',
    '如果要核查的阴性内容已经存在于 record 模板或正文，negativeRecordText 优先复制其中能够唯一定位的原句或最短连续片段，界面会在原句上标记，不得另写同义重复句。',
    '空的个人史、家族史或体格检查可以按当前病例和门诊书写要求生成少量候选；体格检查候选不得暗示已经实际完成查体。',
  ].join('\n');

  return {
    messages: [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [instructions, JSON.stringify({
          patient: input.patient,
          record: input.record,
          diagnoses: input.diagnoses,
          explicitFacts: input.explicitFacts.map((item) => ({
            field: item.field,
            text: item.text,
          })),
        }, null, 2)].join('\n\n'),
      },
    ],
    config: {
      configProfile: 'fast',
      traceContext: {
        scene: 'clinical-record-fact-confirmation',
        sourceModule: `${input.channel}_consultation_result`,
        operationModule: 'consultation-result',
        operationAction: 'generate_record_fact_suggestions',
        title: '生成病历候选阴性内容',
        consultationId: input.consultationId,
      },
    },
  };
}

function isFactField(value: unknown): value is ClinicalRecordFactField {
  return typeof value === 'string' && FACT_FIELDS.includes(value as ClinicalRecordFactField);
}

function normalizePriority(value: unknown): ClinicalRecordFactPriority {
  return value === 'critical' ? 'critical' : 'general';
}

export function normalizeClinicalRecordFactSuggestions(
  response: string | ClinicalRecordFactSuggestionResponse,
  explicitFacts: readonly ClinicalRecordExplicitFact[] = [],
): ClinicalRecordFactSuggestion[] {
  const parsed = typeof response === 'string'
    ? parseLLMJson<ClinicalRecordFactSuggestionResponse>(response)
    : response;
  if (!Array.isArray(parsed?.items)) return [];

  const explicitCorpusByField = explicitFacts.reduce<Record<ClinicalRecordFactField, string[]>>((acc, item) => {
    acc[item.field].push(item.text);
    return acc;
  }, {
    historyOfPresentIllness: [],
    pastMedicalHistory: [],
    personalHistory: [],
    familyHistory: [],
    physicalExam: [],
  });
  const seen = new Set<string>();
  let examCount = 0;
  let otherCount = 0;
  return parsed.items
    .map((item, index): ClinicalRecordFactSuggestion | null => {
      const field = item.field;
      const question = normalizeText(item.question);
      if (
        !isFactField(field)
        || !question
      ) return null;
      const negativeRecordText = normalizeGeneratedClinicalRecordNarrative(
        normalizeText(item.negativeRecordText),
        field,
      ).text;
      if (
        !negativeRecordText
        || GENERIC_NEGATIVE_VALUES.has(negativeRecordText.replace(/[。；;]$/u, ''))
      ) return null;
      const key = `${field}:${normalizeComparable(question)}`;
      if (seen.has(key)) return null;
      const proposedComparable = normalizeComparable(negativeRecordText);
      const explicitCorpus = explicitCorpusByField[field];
      if (
        explicitCorpus.some((fact) => {
          const comparable = normalizeComparable(fact);
          return comparable === proposedComparable
            || comparable.includes(proposedComparable)
            || proposedComparable.includes(comparable);
        })
        || isNegativeClinicalStatementCovered(explicitCorpus.join('。'), negativeRecordText)
      ) {
        return null;
      }
      seen.add(key);
      return {
        id: stableFactId(field, question, index),
        field,
        question,
        negativeRecordText,
        rationale: normalizeText(item.rationale),
        priority: normalizePriority(item.priority),
        status: 'pending',
      };
    })
    .filter((item): item is ClinicalRecordFactSuggestion => Boolean(item))
    .filter((item) => item.field === 'physicalExam' ? ++examCount <= 24 : ++otherCount <= 8);
}
