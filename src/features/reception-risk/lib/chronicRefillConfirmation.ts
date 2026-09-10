import type { ChronicRefillCandidate } from './chronicRefillAssessment';
import type {
  ChronicRefillReviewConfidence,
  ChronicRefillReviewEvidence,
  ChronicRefillReviewItem,
  ChronicRefillReviewOption,
  ChronicRefillReviewPlan,
} from '@/types/consultation';

export type ChronicRefillConfirmationConfidence = ChronicRefillReviewConfidence;
export type ChronicRefillConfirmationEvidence = ChronicRefillReviewEvidence;
export type ChronicRefillConfirmationOption = ChronicRefillReviewOption;
export type ChronicRefillConfirmationItem = ChronicRefillReviewItem;
export type ChronicRefillConfirmationPlan = ChronicRefillReviewPlan;

export interface ChronicRefillConfirmedAnswer {
  itemId: string;
  question: string;
  value: string;
  label: string;
  recordText: string;
  confidence: ChronicRefillConfirmationConfidence;
  evidence: ChronicRefillConfirmationEvidence;
  basis: string;
}

export interface ChronicRefillConfirmationContext {
  supplementText?: string;
  answers: ChronicRefillConfirmedAnswer[];
}

type RawConfirmationOption = Partial<ChronicRefillConfirmationOption>;
type RawConfirmationItem = Partial<Omit<ChronicRefillConfirmationItem, 'options'>> & {
  options?: RawConfirmationOption[];
};

export interface RawChronicRefillConfirmationPlan {
  summary?: string;
  items?: RawConfirmationItem[];
}

const UNKNOWN_VALUE_PATTERN = /(?:unknown|unconfirmed|待确认|暂未|未询问|不清楚)/iu;
const FORBIDDEN_RECORD_PATTERN = /(?:当前(?:有效)?库存|库存内|推荐药品|建议使用|拟继续|后续治疗方案)/u;
const DEMOGRAPHIC_RECORD_PATTERN = /(?:男性|女性|男|女)[，,\s]*\d+岁|\d+岁/u;

function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[{}]/gu, '').replace(/\s+/gu, ' ').trim()
    : '';
}

function cleanRecordText(value: unknown): string {
  const text = cleanText(value)
    .replace(/^患者/u, '')
    .replace(/[。；，,;]+$/u, '')
    .trim();
  if (
    !text
    || UNKNOWN_VALUE_PATTERN.test(text)
    || FORBIDDEN_RECORD_PATTERN.test(text)
    || DEMOGRAPHIC_RECORD_PATTERN.test(text)
  ) {
    return '';
  }
  return text;
}

function normalizeMedicineNarrativeName(value: string): string {
  return cleanText(value)
    .replace(/^[\s☆★*·•]+/u, '')
    .replace(/[（(][^）)]*[）)]/gu, '')
    .split(/[\/|]/u)[0]
    .replace(/\s+\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋).*$/iu, '')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function getChronicRefillNarrativeMedicationNames(
  candidate: ChronicRefillCandidate,
): string[] {
  return Array.from(new Set(
    candidate.medications
      .map(normalizeMedicineNarrativeName)
      .filter(Boolean),
  ));
}

function simplifyKnownMedicationDetails(
  value: string,
  candidate: ChronicRefillCandidate,
): string {
  let result = value;
  candidate.medications.forEach((medication) => {
    const name = normalizeMedicineNarrativeName(medication);
    if (name && result.includes(medication)) {
      result = result.split(medication).join(name);
    }
    if (name) {
      const detailedMentionPattern = new RegExp(
        `${escapeRegExp(name)}(?:[（(][^）)]*[）)])?(?:[\\/／\\s]*\\d+(?:\\.\\d+)?\\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)(?:[*×x]\\d+(?:\\.\\d+)?\\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋))?(?:[\\/／](?:盒|瓶|袋))?)?(?:[（(][^）)]*[）)])?`,
        'giu',
      );
      result = result.replace(detailedMentionPattern, name);
    }
  });
  return result.replace(/[☆★]/gu, '').replace(/\s+/gu, ' ').trim();
}

export function normalizeChronicRefillSupplementRecordText(
  value: unknown,
  candidate: ChronicRefillCandidate,
): string {
  const text = cleanRecordText(value);
  return text ? simplifyKnownMedicationDetails(text, candidate) : '';
}

function normalizeConfidence(value: unknown): ChronicRefillConfirmationConfidence {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}

function normalizeEvidence(value: unknown): ChronicRefillConfirmationEvidence {
  return value === 'current-explicit'
    || value === 'historical-consistent'
    || value === 'model-inference'
    || value === 'unknown'
    ? value
    : 'unknown';
}

function createGenericFallbackPlan(candidate: ChronicRefillCandidate): ChronicRefillConfirmationPlan {
  const diagnosisText = candidate.diagnoses.join('、');
  const medicationText = getChronicRefillNarrativeMedicationNames(candidate).join('、');
  return {
    summary: `请确认${diagnosisText}本次复诊配药的关键信息`,
    items: [
      {
        id: 'current-medication',
        question: '目前用药是否仍按近期方案执行？',
        description: medicationText
          ? `近期历史处方：${medicationText}`
          : '未取得可确认的近期处方，请按本次问诊选择',
        options: medicationText
          ? [
            { value: 'continued', label: '仍按近期方案服用', recordText: `规律服用${medicationText}` },
            { value: 'partial', label: '部分药品已调整', recordText: '近期用药方案已有调整', treatmentReviewRequired: true },
            { value: 'stopped', label: '已经停用', recordText: '近期已停用原用药方案', treatmentReviewRequired: true },
            { value: 'unknown', label: '暂未确认', recordText: '' },
          ]
          : [
            { value: 'no-history', label: '无可沿用历史方案', recordText: '' },
            { value: 'unknown', label: '暂未确认', recordText: '' },
          ],
        recommendedValue: medicationText ? 'continued' : 'unknown',
        confidence: medicationText ? 'medium' : 'low',
        evidence: medicationText ? 'historical-consistent' : 'unknown',
        basis: medicationText ? '基于近期历史处方推荐，需医生确认当前仍在服用' : '当前缺少历史用药事实',
        priority: 'critical',
      },
      {
        id: 'control-status',
        question: '近期病情或监测指标控制情况如何？',
        description: '请选择本次问诊已经确认的状态',
        options: [
          { value: 'stable', label: '控制平稳', recordText: '近期病情及相关监测指标控制平稳' },
          { value: 'fluctuating', label: '存在波动', recordText: '近期病情或相关监测指标存在波动', treatmentReviewRequired: true },
          { value: 'poor', label: '控制欠佳', recordText: '近期病情或相关监测指标控制欠佳', treatmentReviewRequired: true },
          { value: 'unknown', label: '暂未评估', recordText: '' },
        ],
        recommendedValue: 'unknown',
        confidence: 'low',
        evidence: 'unknown',
        basis: '历史处方不能证明本次控制情况',
        priority: 'critical',
      },
      {
        id: 'current-symptoms',
        question: '近期是否存在与本次慢病相关的不适或药物反应？',
        description: '没有本次问诊证据时请选择暂未询问',
        options: [
          { value: 'none', label: '无明显相关不适', recordText: '近期无明显相关不适及药物不良反应' },
          { value: 'present', label: '存在相关不适', recordText: '近期存在相关不适', treatmentReviewRequired: true },
          { value: 'unknown', label: '暂未询问', recordText: '' },
        ],
        recommendedValue: 'unknown',
        confidence: 'low',
        evidence: 'unknown',
        basis: '未发现可作为本次阴性症状的明确记录',
        priority: 'critical',
      },
    ],
  };
}

export function normalizeChronicRefillConfirmationPlan(
  raw: RawChronicRefillConfirmationPlan | null | undefined,
  candidate: ChronicRefillCandidate,
): ChronicRefillConfirmationPlan {
  const normalizedItems = (raw?.items || []).slice(0, 5).flatMap((rawItem, index) => {
    const question = cleanText(rawItem.question);
    const options = (rawItem.options || []).slice(0, 4).flatMap((option, optionIndex) => {
      const label = cleanText(option.label);
      if (!label) return [];
      const value = cleanText(option.value) || `option-${optionIndex + 1}`;
      return [{
        value,
        label,
        recordText: cleanRecordText(option.recordText),
        treatmentReviewRequired: option.treatmentReviewRequired === true,
      }];
    });
    if (!question || options.length < 2) return [];

    const requestedRecommendedValue = cleanText(rawItem.recommendedValue);
    const recommendedValue = options.some((option) => option.value === requestedRecommendedValue)
      ? requestedRecommendedValue
      : options[0].value;
    return [{
      id: cleanText(rawItem.id) || `confirmation-${index + 1}`,
      question,
      description: cleanText(rawItem.description),
      options,
      recommendedValue,
      confidence: normalizeConfidence(rawItem.confidence),
      evidence: normalizeEvidence(rawItem.evidence),
      basis: cleanText(rawItem.basis) || '模型根据当前复诊上下文生成',
      priority: rawItem.priority === 'general' ? 'general' : 'critical',
    } satisfies ChronicRefillConfirmationItem];
  });

  if (normalizedItems.length < 3) {
    return createGenericFallbackPlan(candidate);
  }

  return {
    summary: cleanText(raw?.summary) || `请确认${candidate.diagnoses.join('、')}复诊配药信息`,
    items: normalizedItems,
  };
}

export function buildConfirmedAnswers(
  plan: ChronicRefillConfirmationPlan,
  selections: Record<string, string>,
): ChronicRefillConfirmedAnswer[] {
  return plan.items.flatMap((item) => {
    const selectedValue = selections[item.id] || item.recommendedValue;
    const option = item.options.find((candidate) => candidate.value === selectedValue);
    if (!option) return [];
    return [{
      itemId: item.id,
      question: item.question,
      value: option.value,
      label: option.label,
      recordText: cleanRecordText(option.recordText),
      confidence: item.confidence,
      evidence: item.evidence,
      basis: item.basis,
    }];
  });
}

export function buildConfirmedChronicRefillNarrative(
  candidate: ChronicRefillCandidate,
  confirmation?: ChronicRefillConfirmationContext,
  supplementRecordText = '',
): { chiefComplaint: string; historyOfPresentIllness: string } {
  const diagnosisText = candidate.diagnoses.join('、');
  const fragments = Array.from(new Set(
    [
      ...(confirmation?.answers || []).map((answer) => answer.recordText),
      supplementRecordText || confirmation?.supplementText || '',
    ]
      .map((value) => normalizeChronicRefillSupplementRecordText(value, candidate))
      .filter(Boolean),
  ));

  const historyParts = [
    `患者既往确诊${diagnosisText}`,
    ...fragments,
    '今复诊配药',
  ];

  return {
    chiefComplaint: `${diagnosisText}复诊配药`,
    historyOfPresentIllness: `${historyParts.join('，')}。`,
  };
}
