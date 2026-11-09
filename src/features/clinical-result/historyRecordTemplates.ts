export type HistoryRecordTemplateField = 'pastMedicalHistory' | 'personalHistory' | 'familyHistory';

export const HISTORY_RECORD_TEMPLATE_CHANGE_SCHEMA_VERSION = 'outpatient-record-template-changes.v1' as const;

export interface HistoryRecordTemplateSlotChange {
  field: HistoryRecordTemplateField;
  slotKey: string;
  fromValue: '否认';
  toValue: '有';
  templateMarker: string;
  replacementMarker: string;
}

export interface HistoryRecordTemplateChanges {
  schemaVersion: typeof HISTORY_RECORD_TEMPLATE_CHANGE_SCHEMA_VERSION;
  items: HistoryRecordTemplateSlotChange[];
}

export interface HistoryRecordTemplateSlotValue {
  field: HistoryRecordTemplateField;
  slotKey: string;
  value: '体健' | '否认' | '有';
}

interface HistoryRecordTemplateSlot {
  key: string;
  field: HistoryRecordTemplateField;
  label: string;
  aliases: readonly string[];
  defaultValue: '体健' | '否认';
}

export const DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE = '平素{体健}；{否认}肝炎史，{否认}结核史，{否认}疟疾史，{否认}其他传染病史；{否认}高血压病史；{否认}糖尿病史；{否认}心脏病史；{否认}脑血管病史；{否认}肺部疾病史；{否认}肾脏疾病史；{否认}其他重大疾病史；{否认}手术史；{否认}外伤史；{否认}输血史；{否认}食品、药品过敏史。';
export const DEFAULT_HEALTH_EXAM_PAST_MEDICAL_HISTORY_TEMPLATE = DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE;
export const CHRONIC_PAST_MEDICAL_HISTORY_NEGATIVE_TEMPLATE = '{否认}肝炎史，{否认}结核史，{否认}其他重大传染病史；{否认}手术史、{否认}输血史及{否认}药品过敏史。';
export const DEFAULT_PERSONAL_HISTORY_TEMPLATE = '{否认}外地久居史，{否认}疫水疫源接触史，{否认}牧区、矿山、高氟区、低碘区居住史，{否认}化学性物质、粉尘、放射性物质、有毒物质接触史，{否认}吸毒史，{否认}吸烟史，{否认}饮酒史，{否认}药物嗜好史，{否认}冶游史。';
export const DEFAULT_FAMILY_HISTORY_TEMPLATE = '{否认}家族重大遗传病史，{否认}家族肿瘤病史，{否认}家族传染病史，{否认}家族精神病史。';

const HISTORY_RECORD_TEMPLATE_SLOTS: readonly HistoryRecordTemplateSlot[] = [
  { key: 'healthStatus', field: 'pastMedicalHistory', label: '平素', aliases: [], defaultValue: '体健' },
  { key: 'hepatitisHistory', field: 'pastMedicalHistory', label: '肝炎史', aliases: ['肝炎'], defaultValue: '否认' },
  { key: 'tuberculosisHistory', field: 'pastMedicalHistory', label: '结核史', aliases: ['结核'], defaultValue: '否认' },
  { key: 'malariaHistory', field: 'pastMedicalHistory', label: '疟疾史', aliases: ['疟疾'], defaultValue: '否认' },
  { key: 'otherInfectiousDiseaseHistory', field: 'pastMedicalHistory', label: '其他传染病史', aliases: ['其他传染病', '传染病史'], defaultValue: '否认' },
  { key: 'hypertensionHistory', field: 'pastMedicalHistory', label: '高血压病史', aliases: ['高血压'], defaultValue: '否认' },
  { key: 'diabetesHistory', field: 'pastMedicalHistory', label: '糖尿病史', aliases: ['糖尿病'], defaultValue: '否认' },
  { key: 'heartDiseaseHistory', field: 'pastMedicalHistory', label: '心脏病史', aliases: ['心脏病', '冠心病'], defaultValue: '否认' },
  { key: 'cerebrovascularDiseaseHistory', field: 'pastMedicalHistory', label: '脑血管病史', aliases: ['脑血管病', '脑梗死', '脑卒中', '脑出血'], defaultValue: '否认' },
  { key: 'lungDiseaseHistory', field: 'pastMedicalHistory', label: '肺部疾病史', aliases: ['肺部疾病', '慢阻肺', '肺气肿', '哮喘'], defaultValue: '否认' },
  { key: 'kidneyDiseaseHistory', field: 'pastMedicalHistory', label: '肾脏疾病史', aliases: ['肾脏疾病', '肾病', '肾炎', '肾功能不全'], defaultValue: '否认' },
  { key: 'otherMajorDiseaseHistory', field: 'pastMedicalHistory', label: '其他重大疾病史', aliases: ['其他重大疾病', '重大疾病史'], defaultValue: '否认' },
  { key: 'surgeryHistory', field: 'pastMedicalHistory', label: '手术史', aliases: ['手术'], defaultValue: '否认' },
  { key: 'traumaHistory', field: 'pastMedicalHistory', label: '外伤史', aliases: ['外伤'], defaultValue: '否认' },
  { key: 'transfusionHistory', field: 'pastMedicalHistory', label: '输血史', aliases: ['输血'], defaultValue: '否认' },
  { key: 'foodDrugAllergyHistory', field: 'pastMedicalHistory', label: '食品、药品过敏史', aliases: ['食品过敏', '食物过敏', '药品过敏', '药物过敏', '过敏史', '过敏'], defaultValue: '否认' },
  { key: 'longTermResidenceHistory', field: 'personalHistory', label: '外地久居史', aliases: ['外地久居'], defaultValue: '否认' },
  { key: 'epidemicWaterExposureHistory', field: 'personalHistory', label: '疫水疫源接触史', aliases: ['疫水接触', '疫源接触'], defaultValue: '否认' },
  { key: 'specialRegionResidenceHistory', field: 'personalHistory', label: '牧区、矿山、高氟区、低碘区居住史', aliases: ['牧区居住', '矿山居住', '高氟区居住', '低碘区居住'], defaultValue: '否认' },
  { key: 'occupationalHazardExposureHistory', field: 'personalHistory', label: '化学性物质、粉尘、放射性物质、有毒物质接触史', aliases: ['化学性物质接触', '粉尘接触', '放射性物质接触', '有毒物质接触', '职业暴露'], defaultValue: '否认' },
  { key: 'drugAbuseHistory', field: 'personalHistory', label: '吸毒史', aliases: ['吸毒'], defaultValue: '否认' },
  { key: 'smokingHistory', field: 'personalHistory', label: '吸烟史', aliases: ['吸烟', '烟龄'], defaultValue: '否认' },
  { key: 'drinkingHistory', field: 'personalHistory', label: '饮酒史', aliases: ['饮酒', '酒龄'], defaultValue: '否认' },
  { key: 'drugPreferenceHistory', field: 'personalHistory', label: '药物嗜好史', aliases: ['药物嗜好'], defaultValue: '否认' },
  { key: 'sexualExposureHistory', field: 'personalHistory', label: '冶游史', aliases: ['冶游'], defaultValue: '否认' },
  { key: 'familyHereditaryDiseaseHistory', field: 'familyHistory', label: '家族重大遗传病史', aliases: ['家族遗传病', '遗传病家族史'], defaultValue: '否认' },
  { key: 'familyTumorHistory', field: 'familyHistory', label: '家族肿瘤病史', aliases: ['家族肿瘤', '肿瘤家族史'], defaultValue: '否认' },
  { key: 'familyInfectiousDiseaseHistory', field: 'familyHistory', label: '家族传染病史', aliases: ['家族传染病', '传染病家族史'], defaultValue: '否认' },
  { key: 'familyMentalDiseaseHistory', field: 'familyHistory', label: '家族精神病史', aliases: ['家族精神病', '精神病家族史'], defaultValue: '否认' },
] as const;

const DEFAULT_TEMPLATE_BY_FIELD: Record<HistoryRecordTemplateField, string> = {
  pastMedicalHistory: DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE,
  personalHistory: DEFAULT_PERSONAL_HISTORY_TEMPLATE,
  familyHistory: DEFAULT_FAMILY_HISTORY_TEMPLATE,
};

function normalizeTemplateText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

function getFieldSlots(field: HistoryRecordTemplateField): readonly HistoryRecordTemplateSlot[] {
  return HISTORY_RECORD_TEMPLATE_SLOTS.filter((slot) => slot.field === field);
}

function splitContextClauses(value: string): string[] {
  return value
    .replace(/\r?\n/gu, '；')
    .split(/[。；;！？!?]/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasNegationBeforeAlias(clause: string, alias: string): boolean {
  const aliasIndex = clause.indexOf(alias);
  if (aliasIndex < 0) return false;
  const prefix = clause.slice(0, aliasIndex);
  const negativeMatches = Array.from(prefix.matchAll(/否认|没有|无|未患|未有|不详|不清楚|未知|未明确|排除/gu));
  const positiveMatches = Array.from(prefix.matchAll(/患有|曾患|确诊|有/gu));
  const negativeMatch = negativeMatches[negativeMatches.length - 1];
  const positiveMatch = positiveMatches[positiveMatches.length - 1];
  return (negativeMatch?.index ?? -1) > (positiveMatch?.index ?? -1);
}

type PersonalHabitKey = 'smokingHistory' | 'drinkingHistory';
type PersonalHabitValue = '有' | '否认';
type PersonalHabitSubject = 'patient' | 'other';

const PERSONAL_HABIT_SUBJECT_PATTERN = /(?:父亲|母亲|其父|其母|父母|家属|亲属|家人|丈夫|妻子|配偶|儿子|女儿|兄弟|姐妹|哥哥|姐姐|弟弟|妹妹|同事|室友|朋友|医生|护士|他人|有人)(?:本人)?|患者本人|患者|病人|患儿|本人/gu;

function findPersonalHabitSubjects(value: string): Array<{
  subject: PersonalHabitSubject;
  start: number;
  end: number;
}> {
  const subjects: ReturnType<typeof findPersonalHabitSubjects> = [];
  for (const match of value.matchAll(PERSONAL_HABIT_SUBJECT_PATTERN)) {
    const subject = /^(?:患者本人|患者|病人|患儿|本人)$/u.test(match[0]) ? 'patient' : 'other';
    const previous = subjects[subjects.length - 1];
    if (previous && /^\s*(?:和|与|及|、|跟|同)\s*$/u.test(value.slice(previous.end, match.index))) {
      // A coordinated subject containing the patient still states their fact.
      previous.subject = previous.subject === 'patient' || subject === 'patient' ? 'patient' : 'other';
      previous.end = match.index! + match[0].length;
    } else {
      subjects.push({ subject, start: match.index!, end: match.index! + match[0].length });
    }
  }
  return subjects;
}

function isPersonalHabitSlot(slot: HistoryRecordTemplateSlot): slot is HistoryRecordTemplateSlot & { key: PersonalHabitKey } {
  return slot.field === 'personalHistory' && (slot.key === 'smokingHistory' || slot.key === 'drinkingHistory');
}

/**
 * Read each habit locally, without carrying a negation across commas/contrasts.
 * A coordinated group (否认吸烟、饮酒史) shares its qualifier; unknown or
 * contradictory statements are deliberately not projected as a patient fact.
 * Explicit subject changes delimit statements; relatives and passive exposure
 * cannot add or cancel the patient's active habit. This is a bounded local
 * projection, not a rewrite or a general clinical-language interpreter.
 * Other history slots retain their existing customer-template rules.
 */
function collectPersonalHabitValues(value: string): Partial<Record<PersonalHabitKey, PersonalHabitValue>> {
  const mentions: Record<PersonalHabitKey, Set<PersonalHabitValue | undefined>> = {
    smokingHistory: new Set(),
    drinkingHistory: new Set(),
  };
  const clauses = stripHistoryRecordTemplateMarkers(value).split(
    /[，,。；;！？!?\n]|但是|但|然而|不过|\s*[/／]\s*(?=(?:吸烟(?:史)?|烟龄|饮酒(?:史)?|酒龄)\s*[：:])/u,
  );
  let subject: PersonalHabitSubject = 'patient';
  clauses.forEach((clause) => {
    const groups = Array.from(clause.matchAll(
      /(?:吸烟(?:史)?|烟龄|饮酒(?:史)?|酒龄)(?:\s*[、及和与]\s*(?:吸烟(?:史)?|烟龄|饮酒(?:史)?|酒龄))*/gu,
    ));
    groups.forEach((group, index) => {
      const previous = groups[index - 1];
      const before = clause.slice(previous ? previous.index! + previous[0].length : 0, group.index);
      const subjects = findPersonalHabitSubjects(before);
      const explicitSubject = subjects[subjects.length - 1];
      if (explicitSubject) subject = explicitSubject.subject;
      if (subject !== 'patient') return;
      // Keep a reporter's uncertainty for the first statement; after a prior
      // habit, an explicit new subject starts a separate statement instead.
      const prefix = (explicitSubject && previous ? before.slice(explicitSubject.end) : before)
        .replace(PERSONAL_HABIT_SUBJECT_PATTERN, '');
      const after = clause.slice(group.index! + group[0].length, groups[index + 1]?.index);
      // A following subject's status/qualifier cannot change this statement.
      const suffix = after.slice(0, findPersonalHabitSubjects(after)[0]?.start);
      // An exposure mention is neither an active habit nor its denial. Ignore
      // only this mention, preserving any explicit active history elsewhere.
      if (/被动(?:性)?\s*$/u.test(prefix)) return;
      const context = prefix + suffix;
      let polarity: PersonalHabitValue | undefined;
      if (/不详|不明|不清楚|未知|未明确|未询问|未问|未提及|未提供|未记录|不确定|待核实|待确认|不能排除|不排除|无法确定|是否|有无|不是不|并非不|可能|疑似|或许|也许/u.test(context)) {
        polarity = undefined;
      } else if (
        /(?:否认有?|没有|从不|从未|未曾|未有|不曾|无|未|不)\s*$/u.test(prefix)
        || /^\s*[：:]?\s*(?:否认|没有|无)\s*$/u.test(suffix)
      ) {
        polarity = '否认';
      } else if (!prefix.trim() && !suffix.trim() && /史$|龄$/u.test(group[0])) {
        polarity = undefined;
      } else {
        polarity = '有';
      }
      if (/吸烟|烟龄/u.test(group[0])) mentions.smokingHistory.add(polarity);
      if (/饮酒|酒龄/u.test(group[0])) mentions.drinkingHistory.add(polarity);
    });
  });
  const values: Partial<Record<PersonalHabitKey, PersonalHabitValue>> = {};
  (Object.keys(mentions) as PersonalHabitKey[]).forEach((key) => {
    if (mentions[key].size !== 1) return;
    const [value] = mentions[key];
    if (value) values[key] = value;
  });
  return values;
}

function hasExplicitPositiveMention(context: string, slot: HistoryRecordTemplateSlot): boolean {
  if (isPersonalHabitSlot(slot)) return collectPersonalHabitValues(context)[slot.key] === '有';
  const aliases = [slot.label, ...slot.aliases];
  return splitContextClauses(context).some((clause) => aliases.some((alias) => (
    clause.includes(alias) && !hasNegationBeforeAlias(clause, alias)
  )));
}

function replaceSlotValue(value: string, slot: HistoryRecordTemplateSlot): string {
  const markedDefault = `{${slot.defaultValue}}${slot.label}`;
  const markedCurrent = `{有}${slot.label}`;
  if (value.includes(markedCurrent)) return value;
  if (value.includes(markedDefault)) return value.replace(markedDefault, markedCurrent);

  const plainDefault = `${slot.defaultValue}${slot.label}`;
  return value.includes(plainDefault)
    ? value.replace(plainDefault, markedCurrent)
    : value;
}

export function getDefaultHistoryRecordTemplate(field: HistoryRecordTemplateField): string {
  return DEFAULT_TEMPLATE_BY_FIELD[field];
}

export function stripHistoryRecordTemplateMarkers(value: string): string {
  return value.replace(/\{(体健|否认|有)\}/gu, '$1');
}

export function isHistoryRecordTemplate(
  field: string,
  value: string,
): field is HistoryRecordTemplateField {
  if (field !== 'pastMedicalHistory' && field !== 'personalHistory' && field !== 'familyHistory') {
    return false;
  }
  const normalized = normalizeTemplateText(stripHistoryRecordTemplateMarkers(value));
  if (!normalized) return false;
  const slots = getFieldSlots(field).filter((slot) => slot.defaultValue === '否认');
  const matchedLabels = slots.filter((slot) => normalized.includes(slot.label)).length;
  return matchedLabels >= Math.max(2, Math.ceil(slots.length * 0.75));
}

/**
 * Applies only explicit history facts to the fixed customer template. Free text
 * without a recognizable positive slot is preserved to avoid losing detail.
 */
export function resolveHistoryRecordTemplate(
  field: HistoryRecordTemplateField,
  explicitContext: string,
  currentValue = '',
): string {
  const normalizedCurrent = normalizeTemplateText(currentValue);
  const positiveSlots = getFieldSlots(field)
    .filter((slot) => slot.defaultValue === '否认')
    .filter((slot) => hasExplicitPositiveMention(explicitContext, slot));
  const usesTemplate = isHistoryRecordTemplate(field, normalizedCurrent);

  if (normalizedCurrent && !usesTemplate && (field === 'personalHistory' || positiveSlots.length === 0)) {
    return normalizedCurrent;
  }

  let resolved = usesTemplate ? normalizedCurrent : getDefaultHistoryRecordTemplate(field);
  positiveSlots.forEach((slot) => {
    resolved = replaceSlotValue(resolved, slot);
  });
  return resolved;
}

export function collectHistoryRecordTemplateChanges(
  record: Partial<Record<HistoryRecordTemplateField, string>>,
  includedFields: readonly HistoryRecordTemplateField[] = [
    'pastMedicalHistory',
    'personalHistory',
    'familyHistory',
  ],
): HistoryRecordTemplateChanges | undefined {
  const included = new Set(includedFields);
  const items: HistoryRecordTemplateSlotChange[] = [];

  (Object.keys(record) as HistoryRecordTemplateField[]).forEach((field) => {
    if (!included.has(field)) return;
    const value = record[field] || '';
    if (!isHistoryRecordTemplate(field, value)) return;
    const personalHabits = field === 'personalHistory' ? collectPersonalHabitValues(value) : {};
    getFieldSlots(field)
      .filter((slot) => slot.defaultValue === '否认')
      .filter((slot) => isPersonalHabitSlot(slot)
        ? personalHabits[slot.key] === '有'
        : value.includes(`{有}${slot.label}`) || stripHistoryRecordTemplateMarkers(value).includes(`有${slot.label}`))
      .forEach((slot) => {
        items.push({
          field,
          slotKey: slot.key,
          fromValue: '否认',
          toValue: '有',
          templateMarker: `{否认}${slot.label}`,
          replacementMarker: `{有}${slot.label}`,
        });
      });
  });

  return items.length > 0
    ? { schemaVersion: HISTORY_RECORD_TEMPLATE_CHANGE_SCHEMA_VERSION, items }
    : undefined;
}

export function collectHistoryRecordTemplateSlotValues(
  record: Partial<Record<HistoryRecordTemplateField, string>>,
  includedFields: readonly HistoryRecordTemplateField[] = [
    'pastMedicalHistory',
    'personalHistory',
    'familyHistory',
  ],
): HistoryRecordTemplateSlotValue[] {
  const included = new Set(includedFields);
  const values: HistoryRecordTemplateSlotValue[] = [];

  (Object.keys(record) as HistoryRecordTemplateField[]).forEach((field) => {
    if (!included.has(field)) return;
    const source = record[field] || '';
    if (field === 'personalHistory') {
      const habits = collectPersonalHabitValues(source);
      (Object.keys(habits) as PersonalHabitKey[]).forEach((slotKey) => {
        const value = habits[slotKey];
        if (value) values.push({ field, slotKey, value });
      });
    }
    if (!isHistoryRecordTemplate(field, source)) return;
    const normalized = stripHistoryRecordTemplateMarkers(source);

    getFieldSlots(field).forEach((slot) => {
      if (isPersonalHabitSlot(slot)) return;
      if (slot.defaultValue === '体健') {
        if (source.includes(`${slot.label}{体健}`) || normalized.includes(`${slot.label}体健`)) {
          values.push({ field, slotKey: slot.key, value: '体健' });
        }
        return;
      }
      if (source.includes(`{有}${slot.label}`) || normalized.includes(`有${slot.label}`)) {
        values.push({ field, slotKey: slot.key, value: '有' });
      } else if (
        source.includes(`{否认}${slot.label}`)
        || normalized.includes(`否认${slot.label}`)
      ) {
        values.push({ field, slotKey: slot.key, value: '否认' });
      }
    });
  });

  return values;
}
