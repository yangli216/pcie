import {
  DEFAULT_FAMILY_HISTORY_TEMPLATE,
  DEFAULT_HEALTH_EXAM_PAST_MEDICAL_HISTORY_TEMPLATE,
  DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE,
  DEFAULT_PERSONAL_HISTORY_TEMPLATE,
  resolveHistoryRecordTemplate,
} from './historyRecordTemplates';
import { buildPhysicalExamWithVitalTemplate } from './physicalExamVitalTemplate';
import { completeGeneratedPrecautions } from './precautionsFollowUp';

export const OUTPATIENT_RECORD_SCHEMA_VERSION = 'outpatient-record.v1' as const;

export type OutpatientRecordScenario =
  | 'health_exam'
  | 'chronic_refill'
  | 'external_procedure'
  | 'wound_care'
  | 'respiratory'
  | 'gastrointestinal'
  | 'skin_allergy'
  | 'local_inflammation'
  | 'general';

export interface OutpatientRecord {
  schemaVersion: typeof OUTPATIENT_RECORD_SCHEMA_VERSION;
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  personalHistory: string;
  menstrualHistory?: string;
  familyHistory: string;
  physicalExam: string;
  precautions: string;
}

export interface BuildOutpatientRecordInput {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory?: string;
  allergyHistory?: string;
  personalHistory?: string;
  menstrualHistory?: string;
  familyHistory?: string;
  physicalExam?: string;
  precautions?: string;
  vitals?: string;
  diagnosisNames?: readonly string[];
  patientGender?: string;
  chronicFollowUp?: boolean;
}

export interface OutpatientRecordQualityIssue {
  severity: 'warning' | 'error';
  field: keyof OutpatientRecord | 'diagList';
  message: string;
}

const EMPTY_RECORD_VALUES = new Set([
  '',
  '无',
  '无。',
  '无特殊',
  '无特殊。',
  '暂无',
  '暂无。',
  '未提供',
  '未提供。',
  '未记录',
  '未记录。',
  '未提供既往史。',
  '未提供既往病史。',
  '未见明确既往史记录。',
]);

function normalizeText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/[{}]/gu, '')
    .replace(/\s+/gu, '')
    .replace(/([，。；、])+/gu, '$1')
    .trim();
}

function normalizeFreeText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripFieldLabel(value: string, labels: string[]): string {
  let next = value.trim();
  for (const label of labels) {
    next = next.replace(new RegExp(`^${label}[：:]?`, 'u'), '').trim();
  }
  return next;
}

function isMeaningfulRecordText(value: string): boolean {
  return !EMPTY_RECORD_VALUES.has(value.trim());
}

function joinedContext(input: BuildOutpatientRecordInput): string {
  return [
    input.chiefComplaint,
    input.historyOfPresentIllness,
    ...(input.diagnosisNames || []),
  ].map((item) => normalizeText(item)).join(' ');
}

export function detectOutpatientRecordScenario(input: BuildOutpatientRecordInput): OutpatientRecordScenario {
  const text = joinedContext(input);

  if (/健康证|务工|体检|查体|健康查体/u.test(text)) return 'health_exam';
  if (/外配药|雾化|注射/u.test(text)) return 'external_procedure';
  if (/复诊配药|续方|慢病|高血压|糖尿病|高脂血症|甲减|甲状腺功能减退/u.test(text)) return 'chronic_refill';
  if (/术后|清创|缝合|换药|烫伤|外伤|砸伤|伤口|创面|挫伤/u.test(text)) return 'wound_care';
  if (/咳|咽|痰|鼻塞|流涕|支气管|上呼吸道/u.test(text)) return 'respiratory';
  if (/腹泻|腹痛|呕吐|胃肠|腹部/u.test(text)) return 'gastrointestinal';
  if (/瘙痒|皮疹|荨麻疹|过敏性皮炎/u.test(text)) return 'skin_allergy';
  if (/红肿|甲沟炎|痛风|关节炎|关节痛/u.test(text)) return 'local_inflammation';

  return 'general';
}

function buildPastMedicalHistory(
  input: BuildOutpatientRecordInput,
  scenario: OutpatientRecordScenario,
): string {
  const provided = stripFieldLabel(normalizeFreeText(input.pastMedicalHistory), ['既往史']);
  const allergyHistory = stripFieldLabel(normalizeFreeText(input.allergyHistory), ['过敏史']);
  if (isMeaningfulRecordText(provided)) {
    return resolveHistoryRecordTemplate(
      'pastMedicalHistory',
      [provided, allergyHistory].filter(Boolean).join('；'),
      provided,
    );
  }

  const template = scenario === 'health_exam'
    ? DEFAULT_HEALTH_EXAM_PAST_MEDICAL_HISTORY_TEMPLATE
    : DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE;
  const explicitPastHistoryContext = normalizeFreeText(input.historyOfPresentIllness)
    .split(/[。；;\n]+/u)
    .filter((clause) => /既往|病史|患有|确诊|长期|多年/u.test(clause))
    .join('；');
  return resolveHistoryRecordTemplate(
    'pastMedicalHistory',
    [explicitPastHistoryContext, allergyHistory].filter(Boolean).join('；'),
    template,
  );
}

function buildPersonalHistory(input: BuildOutpatientRecordInput): string {
  const provided = stripFieldLabel(normalizeFreeText(input.personalHistory), ['个人史']);
  return isMeaningfulRecordText(provided)
    ? resolveHistoryRecordTemplate('personalHistory', provided, provided)
    : DEFAULT_PERSONAL_HISTORY_TEMPLATE;
}

function isExplicitMaleGender(value: unknown): boolean {
  const normalized = normalizeFreeText(value).toLowerCase();
  return normalized === 'm'
    || normalized === '1'
    || normalized === 'male'
    || normalized.startsWith('男');
}

function buildMenstrualHistory(input: BuildOutpatientRecordInput): string {
  if (isExplicitMaleGender(input.patientGender)) {
    return '';
  }

  const provided = stripFieldLabel(normalizeFreeText(input.menstrualHistory), ['月经史']);
  return isMeaningfulRecordText(provided) ? provided : '';
}

function buildFamilyHistory(input: BuildOutpatientRecordInput): string {
  const provided = stripFieldLabel(normalizeFreeText(input.familyHistory), ['家族史']);
  return isMeaningfulRecordText(provided)
    ? resolveHistoryRecordTemplate('familyHistory', provided, provided)
    : DEFAULT_FAMILY_HISTORY_TEMPLATE;
}

function buildPhysicalExam(
  input: BuildOutpatientRecordInput,
  _scenario: OutpatientRecordScenario,
): string {
  const provided = stripFieldLabel(normalizeFreeText(input.physicalExam), ['体格检查', '查体']);
  // T/P/R/BP 是 PHIS 固定字段槽位。未采集时保留具名占位符，不把占位符
  // 解释为测量事实；已有查体正文只移除重复的生命体征片段后接在模板后。
  return buildPhysicalExamWithVitalTemplate({
    physicalExam: isMeaningfulRecordText(provided) ? provided : '',
    vitals: input.vitals,
    measurementContext: (input.diagnosisNames || []).join('；'),
  });
}

interface HealthPrescriptionRule {
  key: string;
  name: string;
  pattern: RegExp;
  rules: string[];
}

const HEALTH_PRESCRIPTION_RULES: HealthPrescriptionRule[] = [
  {
    key: 'hypertension',
    name: '高血压',
    pattern: /高血压|血压高/u,
    rules: [
      '少吃咸菜、腌制食品，每日食盐量不超过5克。',
      '多吃新鲜蔬菜、水果和豆类等富钾食物，少吃肥肉、动物内脏等高脂肪食物。',
      '遵医嘱坚持长期药物治疗，不要自行停药或调整药物。',
      '定期监测血压，复查血糖、血脂和肝肾功能。'
    ]
  },
  {
    key: 'diabetes',
    name: '糖尿病',
    pattern: /糖尿病|血糖高|糖耐量/u,
    rules: [
      '控制总热量摄入，少食多餐，多吃粗粮和蔬菜，限制精制糖和高糖水果。',
      '遵医嘱规律服药或注射胰岛素，切勿擅自停药或更改剂量。',
      '每天监测血糖，注意防范低血糖（随身携带糖果，出现心慌出冷汗时及时食用）。',
      '注意足部清洁与防伤，保暖防燥，防止糖尿病足。',
      '定期复查糖化血红蛋白、肾功能和眼底检查。'
    ]
  },
  {
    key: 'hyperlipidemia',
    name: '高脂血症',
    pattern: /高脂血症|血脂异常|高胆固醇|甘油三酯/u,
    rules: [
      '限制高胆固醇食物（蛋黄、动物内脏）和高脂肪食物的摄入，少吃油炸食品。',
      '多吃富含膳食纤维的粗粮和蔬菜，坚持适度有氧运动（如快走、慢跑）。',
      '遵医嘱规律服用调脂药，注意观察是否有肌肉酸痛等不良反应。',
      '定期监测血脂、肝功能 and 肌酸激酶指标。'
    ]
  },
  {
    key: 'coronary_heart_disease',
    name: '冠心病',
    pattern: /冠心病|心肌缺血|心绞痛/u,
    rules: [
      '低盐低脂饮食，少食多餐，避免暴饮暴食和用力排便。',
      '随身携带硝酸甘油等急救药品，注意防寒保暖，避免情绪激动。',
      '遵医嘱规律服用抗血小板、降脂及改善心肌供血药物。',
      '若出现胸痛、胸闷加重且休息或含服硝酸甘油不缓解，应立即就医。'
    ]
  },
  {
    key: 'gout',
    name: '痛风',
    pattern: /痛风|高尿酸/u,
    rules: [
      '严格限制饮酒（尤其是啤酒）及高糖饮料，每日饮水量保持在2000毫升以上。',
      '限制高嘌呤食物的摄入（红肉、海鲜、动物内脏、浓肉汤）。',
      '遵医嘱规律服用降尿酸药物，定期监测血尿酸和肾功能。',
      '急性发作期注意患肢抬高休息，避免热敷和剧烈运动。'
    ]
  },
  {
    key: 'respiratory',
    name: '呼吸道感染',
    pattern: /感冒|上呼吸道感染|支气管炎|咳嗽|咽喉炎|扁桃体炎/u,
    rules: [
      '多喝温开水，保持室内空气流通和适宜的湿度。',
      '饮食清淡易消化，保证充足睡眠和休息，避免过度劳累。',
      '遵医嘱合理服药，若有开立抗生素需严格按医嘱足量足疗程。',
      '注意观察体温和咳嗽情况，若持续高热超过3天或气促应及时复诊。'
    ]
  },
  {
    key: 'gastrointestinal',
    name: '消化道疾病',
    pattern: /胃肠炎|肠胃炎|腹泻|呕吐|胃痛|消化不良|胃炎/u,
    rules: [
      '饮食清淡易消化，急性期可食稀粥、面条，忌食生冷、油腻和辛辣刺激性食物。',
      '适量补充温水或电解质水防止脱水，注意饮食卫生和餐具消毒。',
      '遵医嘱规律服用胃肠药，切勿自行盲目使用止泻药或抗生素。',
      '若出现精神萎靡、口渴尿少、大便带血或持续高热，应立即复诊。'
    ]
  },
  {
    key: 'orthopedic',
    name: '关节及骨骼疾病',
    pattern: /颈椎病|腰椎|骨关节炎|关节痛|骨质疏松/u,
    rules: [
      '避免长时间低头、久坐、久站，每45-60分钟起身活动，避免弯腰负重。',
      '局部防寒保暖，使用高度适中的护颈枕，硬度适中的床垫。',
      '急性期注意关节休息制动，缓解期在指导下进行康复锻炼。',
      '遵医嘱服用消炎镇痛药物或贴敷膏药，必要时进行物理治疗。'
    ]
  }
];

function buildPrecautions(
  input: BuildOutpatientRecordInput,
  scenario: OutpatientRecordScenario,
): string {
  const provided = stripFieldLabel(normalizeFreeText(input.precautions), ['注意事项']);
  if (isMeaningfulRecordText(provided)) {
    return provided;
  }

  const diagnosisNamesText = (input.diagnosisNames || []).join('、');

  const matchedRules: string[][] = [];
  for (const rule of HEALTH_PRESCRIPTION_RULES) {
    if (rule.pattern.test(diagnosisNamesText)) {
      matchedRules.push(rule.rules);
    }
  }

  if (matchedRules.length > 0) {
    const combined: string[] = [];
    const maxStatements = 6;
    let round = 0;
    while (combined.length < maxStatements) {
      let addedInThisRound = false;
      for (const rules of matchedRules) {
        if (round < rules.length) {
          combined.push(rules[round]);
          addedInThisRound = true;
          if (combined.length >= maxStatements) {
            break;
          }
        }
      }
      if (!addedInThisRound) {
        break;
      }
      round++;
    }
    return completeGeneratedPrecautions(
      combined.map((text, index) => `${index + 1}.${text}`).join(''),
      input.diagnosisNames || [],
      input.chronicFollowUp,
    );
  }

  switch (scenario) {
    case 'health_exam':
      return '完善相关检查，如有异常2周内复诊，必要时上级医院进一步检查治疗。';
    case 'external_procedure':
      return '告知病情，如有不适，建议上级医院复诊。';
    case 'wound_care':
      return '伤口禁止沾水，按医嘱复诊换药，必要时上级医院进一步检查治疗。';
    default:
      return completeGeneratedPrecautions('', input.diagnosisNames || [], input.chronicFollowUp);
  }
}

/**
 * 只使用医生当前已选正式诊断重建注意事项。
 *
 * 这个入口故意忽略上游 `precautions`、主诉和现病史，避免初始 AI
 * 多诊断文案或症状语义把未选/待鉴别疾病的健康教育重新带回。
 */
export function buildDiagnosisScopedPrecautions(
  input: BuildOutpatientRecordInput,
): string {
  const diagnosisNames = Array.from(new Set(
    (input.diagnosisNames || [])
      .map((item) => normalizeFreeText(item))
      .filter(Boolean),
  ));
  const scopedInput: BuildOutpatientRecordInput = {
    chiefComplaint: '',
    historyOfPresentIllness: '',
    diagnosisNames,
    chronicFollowUp: input.chronicFollowUp,
  };

  return buildPrecautions(scopedInput, detectOutpatientRecordScenario(scopedInput));
}

export function buildOutpatientRecord(input: BuildOutpatientRecordInput): OutpatientRecord {
  const scenario = detectOutpatientRecordScenario(input);
  const chiefComplaint = normalizeFreeText(input.chiefComplaint);
  const historyOfPresentIllness = normalizeFreeText(input.historyOfPresentIllness);

  const menstrualHistory = buildMenstrualHistory(input);

  return {
    schemaVersion: OUTPATIENT_RECORD_SCHEMA_VERSION,
    chiefComplaint,
    historyOfPresentIllness,
    pastMedicalHistory: buildPastMedicalHistory(input, scenario),
    personalHistory: buildPersonalHistory(input),
    ...(menstrualHistory ? { menstrualHistory } : {}),
    familyHistory: buildFamilyHistory(input),
    physicalExam: buildPhysicalExam(input, scenario),
    precautions: buildPrecautions(input, scenario),
  };
}

function containsDeniedDisease(text: string, disease: string): boolean {
  const compact = normalizeText(text);
  return compact.includes(`否认${disease}病史`) || compact.includes(`否认${disease}`);
}

export function validateOutpatientRecord(
  record: OutpatientRecord,
  input: Pick<BuildOutpatientRecordInput, 'diagnosisNames' | 'chiefComplaint' | 'historyOfPresentIllness'>,
): OutpatientRecordQualityIssue[] {
  const issues: OutpatientRecordQualityIssue[] = [];

  ([
    ['chiefComplaint', record.chiefComplaint],
    ['historyOfPresentIllness', record.historyOfPresentIllness],
    ['pastMedicalHistory', record.pastMedicalHistory],
    ['personalHistory', record.personalHistory],
    ['familyHistory', record.familyHistory],
    ['physicalExam', record.physicalExam],
    ['precautions', record.precautions],
  ] as Array<[keyof OutpatientRecord, string]>).forEach(([field, value]) => {
    if (!value.trim()) {
      issues.push({ severity: 'warning', field, message: '完整门诊病历字段为空，请医生补充确认。' });
    }
  });

  const recordAsLoose = record as OutpatientRecord & { diagnosisText?: unknown };
  if (typeof recordAsLoose.diagnosisText !== 'undefined') {
    issues.push({
      severity: 'error',
      field: 'diagList',
      message: 'outpatientRecord 不应包含 diagnosisText，病历诊断行应由 HIS 根据 diagList 生成。',
    });
  }

  const complaintAndHistory = normalizeText(`${input.chiefComplaint}${input.historyOfPresentIllness}`);
  const physicalExam = normalizeText(record.physicalExam);
  if ((complaintAndHistory.includes('右') && physicalExam.includes('左') && !physicalExam.includes('右'))
    || (complaintAndHistory.includes('左') && physicalExam.includes('右') && !physicalExam.includes('左'))) {
    issues.push({
      severity: 'warning',
      field: 'physicalExam',
      message: '主诉/现病史与体格检查左右部位可能不一致，请医生复核。',
    });
  }

  const diagnosisContext = normalizeText((input.diagnosisNames || []).join('、'));
  [
    ['高血压', '高血压'],
    ['糖尿病', '糖尿病'],
    ['甲状腺功能减退', '甲状腺功能减退'],
    ['甲减', '甲减'],
  ].forEach(([diagnosisKeyword, disease]) => {
    if (diagnosisContext.includes(diagnosisKeyword) && containsDeniedDisease(record.pastMedicalHistory, disease)) {
      issues.push({
        severity: 'error',
        field: 'pastMedicalHistory',
        message: `既往史与当前诊断“${diagnosisKeyword}”存在矛盾，请医生复核。`,
      });
    }
  });

  return issues;
}
