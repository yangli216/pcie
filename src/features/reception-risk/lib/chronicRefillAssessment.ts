import type {
  HisHistoricalDiagnosis,
  HisHistoricalMedication,
  HisPatientHistory,
  HisVisitRecord,
} from '@/services/his/types';
import {
  buildChronicRefillCandidateKey,
  buildChronicRefillMedicationAttributionItems,
  getAutoIncludedChronicRefillMedicationAttributions,
  normalizeChronicRefillMedicationAttributions,
  selectAttributedChronicRefillVisitMedications,
  type ChronicRefillMedicationAttributionItem,
} from './chronicRefillMedicationAttribution';

export interface ChronicRefillCandidate {
  diagnosis: string;
  /** Preserved clinical diagnosis names used by the record and writeback flow. */
  diagnoses: string[];
  /** 同患者完整已知慢病，仅用于既往史，不受本次配药范围裁剪。 */
  historicalDiagnoses?: string[];
  /** Normalized chronic groups used only for eligibility and routing. */
  diagnosisGroups: string[];
  medications: string[];
  /** 按最近就诊优先保留的同药结构化历史处方。 */
  medicationOrders?: HisHistoricalMedication[];
  chronicVisitCount: number;
  chronicVisits: HisVisitRecord[];
  /** 医保周期核查使用的完整查询窗口，不受本次慢病选择范围裁剪。 */
  prescriptionHistoryVisits?: HisVisitRecord[];
  diagnosisEvidenceText: string;
  medicationEvidenceText: string;
  evidenceText: string;
  /** 供医生确认本次复诊范围的慢病选项。 */
  conditions?: ChronicRefillConditionOption[];
  /** 同次多慢病、HIS 无处方诊断关联时的药品辅助归类候选。 */
  medicationAttributions?: ChronicRefillMedicationAttributionItem[];
}

export interface ChronicRefillConditionOption {
  /** 以稳定慢病分组作为选择标识，不替代临床诊断名称。 */
  id: string;
  diagnosis: string;
  diagnosisGroup: string;
  hasMedicationEvidence: boolean;
  /** direct 可按单一慢病就诊安全归属；shared 来自同次多慢病就诊。 */
  medicationEvidenceScope?: 'direct' | 'shared' | 'none';
}

export interface CurrentEncounterIntentContext {
  chiefComplaint?: string;
  historyOfPresentIllness?: string;
  diagnosis?: string;
}

interface ChronicDiagnosisGroup {
  name: string;
  keywords: string[];
  icdPrefixes: string[];
}

const CHRONIC_DIAGNOSIS_GROUPS: ChronicDiagnosisGroup[] = [
  { name: '高血压', keywords: ['高血压'], icdPrefixes: ['I10', 'I11', 'I12', 'I13', 'I15'] },
  { name: '糖尿病', keywords: ['糖尿病'], icdPrefixes: ['E10', 'E11', 'E12', 'E13', 'E14'] },
  {
    name: '冠心病',
    keywords: ['冠心病', '冠状动脉粥样硬化性心脏病', '慢性缺血性心脏病', '心绞痛'],
    icdPrefixes: ['I20', 'I25'],
  },
  { name: '血脂异常', keywords: ['高脂血症', '血脂异常', '高胆固醇血症'], icdPrefixes: ['E78'] },
  {
    name: '慢性阻塞性肺疾病',
    keywords: ['慢性阻塞性肺疾病', '慢阻肺', '慢性支气管炎', '肺气肿'],
    icdPrefixes: ['J41', 'J42', 'J43', 'J44'],
  },
  { name: '支气管哮喘', keywords: ['支气管哮喘', '哮喘'], icdPrefixes: ['J45'] },
  { name: '心房颤动', keywords: ['心房颤动', '房颤'], icdPrefixes: ['I48'] },
  { name: '慢性心力衰竭', keywords: ['慢性心力衰竭', '心力衰竭', '心衰'], icdPrefixes: ['I50'] },
  { name: '甲状腺功能减退', keywords: ['甲状腺功能减退', '甲减'], icdPrefixes: ['E03'] },
  { name: '甲状腺功能亢进', keywords: ['甲状腺功能亢进', '甲亢'], icdPrefixes: ['E05'] },
  { name: '高尿酸血症', keywords: ['高尿酸血症', '痛风'], icdPrefixes: ['E79', 'M10'] },
  { name: '癫痫', keywords: ['癫痫'], icdPrefixes: ['G40'] },
  { name: '帕金森病', keywords: ['帕金森病', '帕金森综合征'], icdPrefixes: ['G20', 'G21'] },
  { name: '慢性肾脏病', keywords: ['慢性肾脏病', '慢性肾功能不全', '慢性肾衰竭'], icdPrefixes: ['N18'] },
  { name: '脑血管病后遗症', keywords: ['脑卒中后遗症', '脑梗死后遗症', '脑出血后遗症'], icdPrefixes: ['I69'] },
  { name: '前列腺增生', keywords: ['前列腺增生'], icdPrefixes: ['N40'] },
  { name: '骨质疏松', keywords: ['骨质疏松'], icdPrefixes: ['M80', 'M81', 'M82'] },
  { name: '慢性病毒性肝炎', keywords: ['慢性病毒性肝炎', '慢性乙型肝炎', '慢性丙型肝炎'], icdPrefixes: ['B18'] },
  { name: '类风湿关节炎', keywords: ['类风湿关节炎'], icdPrefixes: ['M05', 'M06'] },
  { name: '认知障碍', keywords: ['阿尔茨海默病', '老年性痴呆', '血管性痴呆'], icdPrefixes: ['F00', 'F01', 'F02', 'F03', 'G30'] },
  { name: '慢性胃炎', keywords: ['慢性胃炎', '萎缩性胃炎'], icdPrefixes: ['K29.4', 'K29.5'] },
  { name: '胃食管反流病', keywords: ['胃食管反流病', '反流性食管炎'], icdPrefixes: ['K21'] },
];

interface ChronicDiagnosisMatch {
  diagnosisName: string;
  groupName: string;
  isSpecific: boolean;
}

const ACUTE_DIAGNOSIS_KEYWORDS = [
  '急性',
  '危象',
  '失代偿',
  '发作期',
  '上呼吸道感染',
  '肺炎',
  '外伤',
  '骨折',
];

const GENERIC_CHRONIC_INDICATORS = [
  '慢性',
  '后遗症',
  '陈旧性',
  '长期',
];

const GENERIC_CHRONIC_EXCLUSIONS = [
  ...ACUTE_DIAGNOSIS_KEYWORDS,
  '恶性',
  '肿瘤',
  '癌',
  '白血病',
  '淋巴瘤',
  '感染',
  '结核',
  '术后',
  '手术后',
  '围手术期',
  '移植',
  '妊娠',
  '产后',
];

const REPORT_FOLLOW_UP_PATTERNS = [
  /(?:携|带|拿).{0,8}(?:报告|检查结果|检验结果|化验结果|影像结果)/u,
  /(?:复诊|回诊|回来|再诊).{0,10}(?:报告|结果|检查|检验|化验|影像)/u,
  /(?:报告|检查结果|检验结果|化验结果|影像结果).{0,10}(?:复诊|回诊|回来|解读|查看|复核)/u,
  /(?:看|查看|解读|复核).{0,6}(?:报告|检查结果|检验结果|化验结果|影像结果)/u,
  /(?:检查|检验|化验|影像)结果(?:已出|出来)/u,
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

export function isReportFollowUpIntent(
  context: CurrentEncounterIntentContext | null | undefined,
): boolean {
  const encounterText = [
    context?.chiefComplaint,
    context?.historyOfPresentIllness,
    context?.diagnosis,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('；');
  if (!encounterText) return false;

  return REPORT_FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(encounterText));
}

function normalizeIcdCode(value: string | undefined): string {
  return (value || '').replace(/\s+/g, '').toUpperCase();
}

function hasVisitMedicationEvidence(visit: HisVisitRecord): boolean {
  return Boolean(
    visit.medicationOrders?.some((medication) => Boolean(medication.name?.trim()))
    || visit.medications?.some((medication) => Boolean(medication?.trim())),
  );
}

function getVisitDiagnosisEntries(visit: HisVisitRecord): HisHistoricalDiagnosis[] {
  const diagnoses = new Map<string, HisHistoricalDiagnosis>();
  (visit.diagnosisEntries || []).forEach((diagnosis) => {
    const name = diagnosis.name?.trim();
    if (!name) return;
    diagnoses.set(normalizeText(name), {
      name,
      ...(diagnosis.code?.trim() ? { code: diagnosis.code.trim() } : {}),
    });
  });
  (visit.diagnoses || []).forEach((diagnosis) => {
    const name = diagnosis?.trim();
    if (!name) return;
    const key = normalizeText(name);
    if (!diagnoses.has(key)) diagnoses.set(key, { name });
  });
  return Array.from(diagnoses.values());
}

function findChronicDiagnosis(
  diagnosis: HisHistoricalDiagnosis,
  allowGenericFallback: boolean,
): ChronicDiagnosisMatch | null {
  const value = diagnosis.name;
  const normalized = normalizeText(value);
  if (!normalized || ACUTE_DIAGNOSIS_KEYWORDS.some((keyword) => normalized.includes(normalizeText(keyword)))) {
    return null;
  }
  const normalizedCode = normalizeIcdCode(diagnosis.code);
  const group = CHRONIC_DIAGNOSIS_GROUPS.find((item) => (
    item.keywords.some((keyword) => normalized.includes(normalizeText(keyword)))
    || item.icdPrefixes.some((prefix) => normalizedCode.startsWith(prefix))
  ));
  if (group) {
    return {
      diagnosisName: value.trim(),
      groupName: group.name,
      isSpecific: !group.keywords.some((keyword) => normalized === normalizeText(keyword)),
    };
  }

  const isGenericChronic = allowGenericFallback
    && GENERIC_CHRONIC_INDICATORS.some((keyword) => normalized.includes(normalizeText(keyword)))
    && !GENERIC_CHRONIC_EXCLUSIONS.some((keyword) => normalized.includes(normalizeText(keyword)));
  if (!isGenericChronic) return null;

  return {
    diagnosisName: value.trim(),
    groupName: value.trim(),
    isSpecific: true,
  };
}

function normalizeMedicationName(value: string): string {
  return value
    .replace(/^[\s☆★*·•]+/u, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:mg|g|ml|片|粒|支|盒|瓶|袋)/gi, '')
    .replace(/\s+/g, '')
    .trim();
}

function orderedVisits(history: HisPatientHistory | null | undefined): HisVisitRecord[] {
  return [...(history?.visits || [])]
    .sort((left, right) => right.visitTime - left.visitTime);
}

function getVisitChronicMatches(visit: HisVisitRecord): ChronicDiagnosisMatch[] {
  const allowGenericFallback = hasVisitMedicationEvidence(visit);
  return getVisitDiagnosisEntries(visit)
    .map((diagnosis) => findChronicDiagnosis(diagnosis, allowGenericFallback))
    .filter((item): item is ChronicDiagnosisMatch => Boolean(item));
}

function collectMedicationEvidence(visits: HisVisitRecord[]): {
  medications: string[];
  medicationOrders?: HisHistoricalMedication[];
} {
  const medications = new Map<string, string>();
  const medicationOrders = new Map<string, HisHistoricalMedication>();
  visits.forEach((visit) => {
    (visit.medicationOrders || []).forEach((medication) => {
      const normalized = normalizeMedicationName(medication.name);
      if (!normalized || medicationOrders.has(normalized)) return;
      medicationOrders.set(normalized, medication);
    });
    (visit.medications || []).forEach((medication) => {
      const normalized = normalizeMedicationName(medication);
      if (!normalized || medications.has(normalized)) return;
      medications.set(normalized, medication.trim());
    });
  });

  const normalizedOrders = Array.from(medicationOrders.values()).slice(0, 8);
  return {
    medications: Array.from(medications.values()).slice(0, 8),
    medicationOrders: normalizedOrders.length > 0 ? normalizedOrders : undefined,
  };
}

export function getChronicRefillConditionOptions(
  candidate: ChronicRefillCandidate,
): ChronicRefillConditionOption[] {
  if (candidate.conditions?.length) return candidate.conditions;
  return candidate.diagnoses.map((diagnosis, index) => ({
    id: candidate.diagnosisGroups[index] || diagnosis,
    diagnosis,
    diagnosisGroup: candidate.diagnosisGroups[index] || diagnosis,
    hasMedicationEvidence: candidate.medications.length > 0,
    medicationEvidenceScope: candidate.medications.length > 0 ? 'direct' : 'none',
  }));
}

/**
 * 按医生确认的慢病范围裁剪后续病历与用药上下文。
 * 同次就诊含多个慢病且处方无法归属时，部分选择先移除歧义药品，交给同一次病历流归类。
 */
export function scopeChronicRefillCandidate(
  candidate: ChronicRefillCandidate,
  selectedConditionIds: string[],
): ChronicRefillCandidate | null {
  const options = getChronicRefillConditionOptions(candidate);
  const selectedIds = new Set(selectedConditionIds);
  const selectedConditions = options.filter((condition) => selectedIds.has(condition.id));
  if (selectedConditions.length === 0) return null;

  const selectedGroups = new Set(selectedConditions.map((condition) => condition.diagnosisGroup));
  const visitMatches = new Map<HisVisitRecord, ChronicDiagnosisMatch[]>();
  const relatedVisits = candidate.chronicVisits.filter((visit) => {
    const matches = getVisitChronicMatches(visit);
    visitMatches.set(visit, matches);
    return matches.some((match) => selectedGroups.has(match.groupName));
  });
  const chronicVisits = relatedVisits.map((visit) => {
    const matches = visitMatches.get(visit) || [];
    const groups = new Set((visitMatches.get(visit) || []).map((match) => match.groupName));
    const canInheritMedication = groups.size > 0
      && Array.from(groups).every((group) => selectedGroups.has(group));
    const selectedDiagnosisNames = matches
      .filter((match) => selectedGroups.has(match.groupName))
      .map((match) => match.diagnosisName);
    return {
      ...visit,
      diagnoses: Array.from(new Set(selectedDiagnosisNames)),
      diagnosisEntries: visit.diagnosisEntries?.filter((diagnosis) => {
        const match = findChronicDiagnosis(diagnosis, hasVisitMedicationEvidence(visit));
        return Boolean(match && selectedGroups.has(match.groupName));
      }),
      medications: canInheritMedication ? visit.medications : undefined,
      medicationOrders: canInheritMedication ? visit.medicationOrders : undefined,
    };
  });
  const selectedAllConditions = options.every((condition) => selectedIds.has(condition.id));
  const medicationEvidence = chronicVisits.length > 0
    ? collectMedicationEvidence(chronicVisits)
    : {
      medications: selectedAllConditions ? candidate.medications : [],
      medicationOrders: selectedAllConditions ? candidate.medicationOrders : undefined,
    };
  const diagnoses = selectedConditions.map((condition) => condition.diagnosis);
  const diagnosisGroups = selectedConditions.map((condition) => condition.diagnosisGroup);
  const diagnosisEvidenceText = `近期历史就诊记录有“${diagnoses.join('、')}”诊断`;
  const medicationEvidenceText = medicationEvidence.medications.length > 0
    ? `历史用药记录：${medicationEvidence.medications.join('、')}`
    : '未获取到可确认的历史用药记录';

  const relatedVisitKeys = new Set(relatedVisits.map((visit) => (
    visit.visitId?.trim() || String(visit.visitTime)
  )));
  const medicationAttributions = selectedAllConditions
    ? []
    : (candidate.medicationAttributions || []).filter((item) => (
      item.candidateConditionIds.some((id) => selectedGroups.has(id))
      && relatedVisitKeys.has(item.visitId?.trim() || String(item.visitTime))
    ));

  return {
    diagnosis: diagnoses[0],
    diagnoses,
    historicalDiagnoses: [...(candidate.historicalDiagnoses || candidate.diagnoses)],
    diagnosisGroups,
    medications: medicationEvidence.medications,
    medicationOrders: medicationEvidence.medicationOrders,
    chronicVisitCount: chronicVisits.length,
    chronicVisits,
    prescriptionHistoryVisits: candidate.prescriptionHistoryVisits,
    diagnosisEvidenceText,
    medicationEvidenceText,
    evidenceText: `${diagnosisEvidenceText}；${medicationEvidenceText}`,
    conditions: selectedConditions,
    medicationAttributions,
  };
}

/**
 * 将同一次慢病生成流返回的药品归类应用到已裁剪候选。
 * 模型只能引用既有药品与慢病 ID，且仅高/中置信归入本次范围的结果会被采用。
 */
export function applyChronicRefillMedicationScope(
  candidate: ChronicRefillCandidate,
  rawScope: unknown,
): ChronicRefillCandidate {
  const items = candidate.medicationAttributions || [];
  if (items.length === 0) return candidate;

  const normalizedItems = normalizeChronicRefillMedicationAttributions(items, rawScope);
  const selectedGroups = new Set(candidate.diagnosisGroups);
  const acceptedItems = getAutoIncludedChronicRefillMedicationAttributions(
    normalizedItems,
    selectedGroups,
  );
  if (acceptedItems.length === 0) {
    return {
      ...candidate,
      medicationAttributions: normalizedItems,
    };
  }

  const chronicVisits = candidate.chronicVisits.map((visit) => {
    const attributed = selectAttributedChronicRefillVisitMedications(
      visit,
      acceptedItems,
      selectedGroups,
    );
    if (!attributed.medications?.length && !attributed.medicationOrders?.length) return visit;
    return {
      ...visit,
      medications: Array.from(new Set([
        ...(visit.medications || []),
        ...(attributed.medications || []),
      ])),
      medicationOrders: [
        ...(visit.medicationOrders || []),
        ...(attributed.medicationOrders || []),
      ],
    };
  });
  const medicationEvidence = collectMedicationEvidence(chronicVisits);
  const medicationEvidenceText = medicationEvidence.medications.length > 0
    ? `历史用药记录：${medicationEvidence.medications.join('、')}`
    : '未获取到可确认的历史用药记录';

  return {
    ...candidate,
    medications: medicationEvidence.medications,
    medicationOrders: medicationEvidence.medicationOrders,
    chronicVisits,
    medicationEvidenceText,
    evidenceText: `${candidate.diagnosisEvidenceText}；${medicationEvidenceText}`,
    medicationAttributions: normalizedItems,
  };
}

export function getChronicRefillCandidateKey(candidate: ChronicRefillCandidate): string {
  return buildChronicRefillCandidateKey(candidate.diagnosisGroups, candidate.chronicVisits);
}

export function assessChronicRefillCandidate(
  history: HisPatientHistory | null | undefined,
  currentEncounter?: CurrentEncounterIntentContext | null,
  hasFollowUpReport?: boolean,
): ChronicRefillCandidate | null {
  if (hasFollowUpReport || isReportFollowUpIntent(currentEncounter)) return null;

  const visits = orderedVisits(history);
  const diagnosisGroups: string[] = [];
  const preferredDiagnosisByGroup = new Map<string, ChronicDiagnosisMatch>();
  const visitMatches = new Map<HisVisitRecord, ChronicDiagnosisMatch[]>();
  const chronicVisits = visits.filter((visit) => {
    const visitDiagnoses = getVisitChronicMatches(visit);
    visitMatches.set(visit, visitDiagnoses);
    visitDiagnoses.forEach((diagnosis) => {
      const current = preferredDiagnosisByGroup.get(diagnosis.groupName);
      if (!current) {
        diagnosisGroups.push(diagnosis.groupName);
        preferredDiagnosisByGroup.set(diagnosis.groupName, diagnosis);
        return;
      }
      if (!current.isSpecific && diagnosis.isSpecific) {
        preferredDiagnosisByGroup.set(diagnosis.groupName, diagnosis);
      }
    });
    return visitDiagnoses.length > 0;
  });
  if (chronicVisits.length === 0) return null;

  const chronicDiagnoses = diagnosisGroups
    .map((groupName) => preferredDiagnosisByGroup.get(groupName)?.diagnosisName || groupName);

  const medicationEvidence = collectMedicationEvidence(chronicVisits);
  const chronicMedications = medicationEvidence.medications;

  const diagnosis = chronicDiagnoses[0];
  const diagnosisEvidenceText = `近期历史就诊记录有“${chronicDiagnoses.join('、')}”诊断`;
  const medicationEvidenceText = chronicMedications.length > 0
    ? `历史用药记录：${chronicMedications.join('、')}`
    : '未获取到可确认的历史用药记录';

  const conditions = diagnosisGroups.map((groupName, index) => {
    const medicationVisits = chronicVisits.filter((visit) => (
      visitMatches.get(visit)?.some((match) => match.groupName === groupName)
      && hasVisitMedicationEvidence(visit)
    ));
    const hasDirectMedicationEvidence = medicationVisits.some((visit) => (
      new Set((visitMatches.get(visit) || []).map((match) => match.groupName)).size === 1
    ));
    return {
      id: groupName,
      diagnosis: chronicDiagnoses[index],
      diagnosisGroup: groupName,
      hasMedicationEvidence: medicationVisits.length > 0,
      medicationEvidenceScope: hasDirectMedicationEvidence
        ? 'direct' as const
        : (medicationVisits.length > 0 ? 'shared' as const : 'none' as const),
    };
  });
  const medicationAttributions = chronicVisits.flatMap((visit) => {
    const visitGroups = Array.from(new Set(
      (visitMatches.get(visit) || []).map((match) => match.groupName),
    ));
    if (visitGroups.length < 2) return [];
    const visitConditions = conditions.filter((condition) => visitGroups.includes(condition.id));
    return buildChronicRefillMedicationAttributionItems(visit, visitConditions);
  });

  return {
    diagnosis,
    diagnoses: chronicDiagnoses,
    historicalDiagnoses: [...chronicDiagnoses],
    diagnosisGroups,
    medications: chronicMedications,
    medicationOrders: medicationEvidence.medicationOrders,
    chronicVisitCount: chronicVisits.length,
    chronicVisits,
    prescriptionHistoryVisits: visits,
    diagnosisEvidenceText,
    medicationEvidenceText,
    evidenceText: `${diagnosisEvidenceText}；${medicationEvidenceText}`,
    conditions,
    medicationAttributions,
  };
}
