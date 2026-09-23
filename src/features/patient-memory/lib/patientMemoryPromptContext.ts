import type { PatientMemoryBrief, PatientMemoryFactItem } from '@entities/patient-memory';

function clean(value: unknown, maxLength = 120): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\r\n]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function factLabel(item: PatientMemoryFactItem, namesOnly = false): string {
  const name = clean(namesOnly ? item.name || item.code : item.name || item.valueText || item.code || '待核实');
  if (namesOnly) return name;
  const detail = item.valueText && item.name ? clean(item.valueText, 100) : '';
  return detail ? `${name}（${detail}）` : name;
}

function normalizedFactKey(value: string): string {
  return clean(value, 2_000).replace(/[\s☆★*·•⊙（）()，,；;:：/\\-]/gu, '').toLowerCase();
}

function joinFacts(
  items: PatientMemoryFactItem[],
  limit: number,
  options: { knownText?: string; namesOnly?: boolean } = {},
): string {
  const knownKey = normalizedFactKey(options.knownText || '');
  return items
    .filter((item) => item.status !== 'inactive' && item.status !== 'disputed')
    .filter((item) => {
      const nameKey = normalizedFactKey(clean(
        options.namesOnly ? item.name || item.code : item.name || item.valueText || item.code,
      ));
      return !nameKey || !knownKey.includes(nameKey);
    })
    .slice(0, limit)
    .map((item) => factLabel(item, options.namesOnly))
    .filter(Boolean)
    .join('；');
}

export interface PatientMemoryPromptContextOptions {
  knownAllergyText?: string;
  knownConditionText?: string;
  knownMedicationText?: string;
}

/**
 * 把服务端患者记忆压缩为 LLM 可消费的“核对线索”。
 * 长期记忆永远不自动升级为本次就诊事实，医生本次陈述和确认优先。
 */
export function buildPatientMemoryPromptContext(
  brief: PatientMemoryBrief | null | undefined,
  options: PatientMemoryPromptContextOptions = {},
): string {
  if (!brief) return '';
  const allergies = joinFacts(brief.allergies, 8, { knownText: options.knownAllergyText });
  const conditions = joinFacts(
    brief.chronicConditions.length > 0 ? brief.chronicConditions : brief.recentDiagnoses,
    6,
    { knownText: options.knownConditionText },
  );
  const medications = joinFacts(brief.recentMedications, 6, {
    knownText: options.knownMedicationText,
    namesOnly: true,
  });
  if (!allergies && !conditions && !medications) return '';

  const lines = [
    '【患者长期记忆｜仅作本次核对线索】',
    '以下内容来自既往HIS记录或人工治理，不等同于本次就诊事实。仅在医生本次语音明确印证时写入当前病历；若与本次陈述冲突，以本次陈述为准并提示核实，不得自行推断“仍在服药”“病情稳定”或“无不适”。',
  ];
  if (brief.qualityStatus === 'conflicted' || brief.conflictCount > 0) {
    lines.push('记忆质量：存在未消解冲突，所有相关内容均须显式核实。');
  }
  if (allergies) lines.push(`既往过敏线索：${allergies}`);
  if (conditions) lines.push(`既往诊断/慢病线索：${conditions}`);
  if (medications) lines.push(`既往用药线索：${medications}`);
  return lines.join('\n');
}
