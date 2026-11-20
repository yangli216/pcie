import type { ChatMessage, LLMConfigOverride } from '@services/llm';
import type { ClinicalResultChannel } from './clinicalResultContract';
import {
  normalizeGeneratedClinicalRecordNarrative,
  type ClinicalRecordNarrativeField,
} from './clinicalRecordNarrativeQuality';

export interface ClinicalResultRegenerationRecord {
  chiefComplaint: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string;
  personalHistory: string;
  menstrualHistory: string;
  maritalReproductiveHistory?: string;
  familyHistory: string;
  physicalExam: string;
  precautions: string;
}

export interface ClinicalResultRegenerationChapter {
  chapterId: string;
  title: string;
  text: string;
  fieldIds: readonly string[];
  editableFieldIds?: readonly string[];
  directTextFieldId?: string;
  narrative?: unknown;
  recordField?: keyof ClinicalResultRegenerationRecord | null;
}

interface RegeneratedClinicalResult extends ClinicalResultRegenerationRecord {
  templateFieldValues?: Record<string, string>;
}

export interface BuildClinicalResultRegenerationRequestInput {
  channel: ClinicalResultChannel;
  patient: {
    name?: string;
    gender?: string;
    age?: string;
  };
  currentRecord: ClinicalResultRegenerationRecord;
  templateFieldRules?: string;
  templateReferenceChapters?: ReturnType<typeof import('@features/outpatient-emr/lib/voiceOutpatientEmrRecognition').describeOutpatientTemplateReferences>;
  templateSourceNotes?: import('@features/outpatient-emr/types').OutpatientEmrTemplateSourceNote[];
  templateFields?: ReadonlyArray<{
    id: string;
    name?: string;
    articleName?: string;
    dictionaryItems?: ReadonlyArray<{ value: string; text: string }>;
    recordField?: string | null;
    value: string;
    source: string;
  }>;
  templateChapters?: readonly ClinicalResultRegenerationChapter[];
  doctorSupplement: string;
  consultationId?: string;
}

export interface ClinicalResultRegenerationRequestSpec {
  messages: ChatMessage[];
  config: LLMConfigOverride;
}

const SYSTEM_PROMPT = [
  '你是基层全科门诊医生的病历重写助手。',
  '医生补充信息的事实优先级高于当前草稿；若存在明确纠正，应替换冲突旧内容。',
  '不得编造补充信息和当前草稿中都未出现的症状、检查结果、诊断、治疗或体征。',
  '不得把“医生补充”“补充信息”等过程性措辞写进病例正文。',
  '不得将“待医生补充完善、待医生核实、建议询问、信息不足、未提供相关信息”等工作流提示当作病历内容。',
  '只输出 JSON，不要输出 Markdown、解释、免责声明或多余文字。',
].join('\n');

const USER_INSTRUCTIONS = [
  '重写要求：',
  '1. 主诉保持简短，表达主要问题与持续时间。',
  '2. 现病史按时间线整合起病、演变、伴随症状、关键阴性和已明确诊疗经过。',
  '3. 未被补充信息影响的有效内容应保留，不得因重写而丢失。',
  '4. 既往史、个人史、家族史、体格检查、注意事项仅在有依据时更新；没有新依据则保留原值。',
  '4.1 月经史仅适用于女性且14≤周岁年龄<60的患者，只能使用医生补充或当前病历中的明确内容；其余患者或无依据时输出空字符串，不得默认生成“月经规律”。',
  '4.2 月经史 menstrualHistory 与婚育史 maritalReproductiveHistory 仅适用于女性且14≤周岁年龄<60的患者；其余患者均留空。婚育史与月经史独立，仅记录明确婚育状况、当前妊娠状态和生育事实；不得根据年龄、月经或既往孕产次数推断已婚已育、未孕或已孕。未知留空。',
  '5. 不在病例字段中输出诊断建议、药品推荐或模型分析过程。',
  '6. 输出全部字段：chiefComplaint、historyOfPresentIllness、pastMedicalHistory、personalHistory、menstrualHistory、maritalReproductiveHistory、familyHistory、physicalExam、precautions。',
].join('\n');

export function buildClinicalResultRegenerationRequest(
  input: BuildClinicalResultRegenerationRequestInput,
): ClinicalResultRegenerationRequestSpec {
  const doctorSupplement = input.doctorSupplement.trim();
  if (!doctorSupplement) {
    throw new Error('请先填写或录入补充信息');
  }

  const hasTemplate = input.templateChapters !== undefined;
  const system = [
    SYSTEM_PROMPT,
    hasTemplate
      ? '依据 templateChapters 的实际章节、固定句式及各填空位置，结合医生本次补充更新模板字段。'
      : '结合当前病例草稿与医生刚补充的本次就诊事实，重新生成完整病例正文。字段没有有效临床内容时输出空字符串。',
  ];
  if (hasTemplate && input.templateFieldRules) system.push(input.templateFieldRules);
  if (input.templateFields?.length) {
    system.push('当前模板字段另列于 templateFields。source=unmentioned-default 表示问诊未提及时采用的书写默认值，不能据此写出患者明确否认、查体正常或检查阴性。结合字段含义使用有病例依据的事实。source=doctor 是医生对该字段的最新修订，空字符串表示医生已清空；正文草稿有冲突时按医生修订及本轮补充重写。');
  }
  if (hasTemplate) {
    system.push('只输出 {"templateFieldValues":{}} 结构的 JSON。以原始控件 ID 为键，仅更新 editableFieldIds 中有本次病例依据且受补充影响的控件。模板另设单位槽或已印单位时，数值槽只填数量。独立时长描述要保留单位。字典只选已提供的合法编码或文字。全文控件可填正文，局部填空按该控件的含义填写。');
    system.push('保留未受影响的值和医生修订。无依据时省略该键，不得将模板默认、字段名称、输入提示或全部候选项当作已证实事实。只有医生明确要求清除字段时才返回空字符串。没有可更新的字段时返回空对象作为 templateFieldValues。');
  }

  return {
    messages: [
      { role: 'system', content: system.join('\n') },
      {
        role: 'user',
        content: [
          hasTemplate ? '请按当前模板填入受本轮补充影响的控件。' : USER_INSTRUCTIONS,
          '输入数据如下：',
          JSON.stringify({
            channel: input.channel,
            patient: hasTemplate ? { gender: input.patient.gender, age: input.patient.age } : input.patient,
            currentRecord: input.currentRecord,
            ...(input.templateFields?.length ? { templateFields: input.templateFields } : {}),
            ...(input.templateReferenceChapters?.length ? { templateReferenceChapters: input.templateReferenceChapters } : {}),
            ...(input.templateSourceNotes?.length ? { templateSourceNotes: input.templateSourceNotes } : {}),
            ...(hasTemplate ? { templateChapters: input.templateChapters } : {}),
            doctorSupplement,
          }, null, 2),
        ].join('\n\n'),
      },
    ],
    config: {
      configProfile: 'fast',
      traceContext: {
        scene: 'clinical-result-regeneration',
        sourceModule: `${input.channel}_consultation_result`,
        operationModule: 'consultation-result',
        operationAction: 'regenerate_with_supplement',
        title: '问诊结果补充信息重新生成',
        consultationId: input.consultationId,
      },
    },
  };
}

function readField(
  value: Record<string, unknown>,
  key: keyof ClinicalResultRegenerationRecord,
  fallback: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== 'string') return fallback;
  const field = key as ClinicalRecordNarrativeField;
  const normalized = normalizeGeneratedClinicalRecordNarrative(candidate, field);
  if (!normalized.text && candidate.trim() && normalized.issues.length > 0) {
    return fallback;
  }
  return normalized.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readRegeneratedTemplateFields(
  record: Record<string, unknown>, chapters: readonly ClinicalResultRegenerationChapter[],
  templateFields: readonly { id: string }[],
): Record<string, string> {
  const authorized = new Set(templateFields.map(field => field.id));
  const writable = new Set(chapters.flatMap(chapter => (
    chapter.editableFieldIds ?? chapter.fieldIds.filter(id => authorized.has(id))
  )));
  if (Object.prototype.hasOwnProperty.call(record, 'templateFieldValues')) {
    if (!isRecord(record.templateFieldValues)) throw new Error('重新生成结果的模板字段格式无效');
    return Object.fromEntries(Object.entries(record.templateFieldValues)
      .filter((entry): entry is [string, string] => writable.has(entry[0]) && typeof entry[1] === 'string')
      .map(([id, text]) => [id, text.replace(/\r\n?/gu, '\n').trim()]));
  }

  // A legacy paragraph can supply only a verified whole-chapter text control.
  const byChapter = Object.prototype.hasOwnProperty.call(record, 'chapterTexts');
  const source = byChapter ? record.chapterTexts : record;
  if (!isRecord(source)) throw new Error('重新生成结果的模板章节格式无效');
  const entries: [string, string][] = [];
  for (const chapter of chapters) {
    const id = chapter.directTextFieldId;
    if (!id || !writable.has(id)) continue;
    const key = byChapter ? chapter.chapterId : chapter.recordField;
    if (!key || !Object.prototype.hasOwnProperty.call(source, key)) continue;
    if (!byChapter && chapters.some(other => other !== chapter && other.recordField === key)) continue;
    const text = source[key];
    if (typeof text !== 'string') continue;
    const normalized = normalizeGeneratedClinicalRecordNarrative(text, chapter.recordField ?? undefined);
    if (text.trim() && !normalized.text && normalized.issues.length) continue;
    entries.push([id, normalized.issues.length ? normalized.text : text.replace(/\r\n?/gu, '\n').trim()]);
  }
  if (!entries.length) throw new Error('重新生成结果缺少当前模板的填空值，请重试。');
  return Object.fromEntries(entries);
}

export function normalizeClinicalResultRegenerationOutput(
  value: unknown,
  fallback: ClinicalResultRegenerationRecord,
  templateChapters?: readonly ClinicalResultRegenerationChapter[],
  templateFields: readonly { id: string }[] = [],
): RegeneratedClinicalResult {
  if (!isRecord(value)) {
    throw new Error('重新生成的病例不是有效 JSON 对象');
  }

  const record = value;
  if (templateChapters) {
    // The caller projects updated slots into the clinical context before refreshing recommendations.
    return { ...fallback, templateFieldValues: readRegeneratedTemplateFields(record, templateChapters, templateFields) };
  }
  const result: ClinicalResultRegenerationRecord = {
    chiefComplaint: readField(record, 'chiefComplaint', fallback.chiefComplaint),
    historyOfPresentIllness: readField(record, 'historyOfPresentIllness', fallback.historyOfPresentIllness),
    pastMedicalHistory: readField(record, 'pastMedicalHistory', fallback.pastMedicalHistory),
    personalHistory: readField(record, 'personalHistory', fallback.personalHistory),
    menstrualHistory: readField(record, 'menstrualHistory', fallback.menstrualHistory),
    maritalReproductiveHistory: readField(record, 'maritalReproductiveHistory', fallback.maritalReproductiveHistory || ''),
    familyHistory: readField(record, 'familyHistory', fallback.familyHistory),
    physicalExam: readField(record, 'physicalExam', fallback.physicalExam),
    precautions: readField(record, 'precautions', fallback.precautions),
  };

  if (!result.chiefComplaint || !result.historyOfPresentIllness) {
    throw new Error('重新生成的病例缺少主诉或现病史');
  }

  return result;
}
