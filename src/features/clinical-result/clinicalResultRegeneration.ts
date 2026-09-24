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

export interface BuildClinicalResultRegenerationRequestInput {
  channel: ClinicalResultChannel;
  patient: {
    name?: string;
    gender?: string;
    age?: string;
  };
  currentRecord: ClinicalResultRegenerationRecord;
  doctorSupplement: string;
  consultationId?: string;
}

export interface ClinicalResultRegenerationRequestSpec {
  messages: ChatMessage[];
  config: LLMConfigOverride;
}

const SYSTEM_PROMPT = [
  '你是基层全科门诊医生的病历重写助手。',
  '任务：结合当前病例草稿与医生刚补充的本次就诊事实，重新生成完整病例正文。',
  '医生补充信息的事实优先级高于当前草稿；若存在明确纠正，应替换冲突旧内容。',
  '不得编造补充信息和当前草稿中都未出现的症状、检查结果、诊断、治疗或体征。',
  '不得把“医生补充”“补充信息”等过程性措辞写进病例正文。',
  '字段没有有效临床内容时输出空字符串，不得写“待医生补充完善、待医生核实、建议询问、信息不足、未提供相关信息”等工作流提示。',
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

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          USER_INSTRUCTIONS,
          '输入数据如下：',
          JSON.stringify({
            channel: input.channel,
            patient: input.patient,
            currentRecord: input.currentRecord,
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

export function normalizeClinicalResultRegenerationOutput(
  value: unknown,
  fallback: ClinicalResultRegenerationRecord,
): ClinicalResultRegenerationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('重新生成的病例不是有效 JSON 对象');
  }

  const record = value as Record<string, unknown>;
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
