import type { OutpatientRecord } from './outpatientRecord';
import { buildMaritalReproductiveHistoryFieldValues } from './lib/maritalReproductiveHistory';
import type {
  HistoryRecordTemplateChanges,
  HistoryRecordTemplateSlotValue,
} from './historyRecordTemplates';
import type { PhysicalExamVitalSigns } from './physicalExamVitalTemplate';
import type { RecordConfirmedWritebackField } from './recordConfirmedPayload';

export const HISTORY_DATA_ID_BY_SLOT: Readonly<Record<string, string>> = Object.freeze({
  healthStatus: '平素',
  hepatitisHistory: '肝炎史标志',
  tuberculosisHistory: '结核史标志',
  malariaHistory: '疟疾史标志',
  otherInfectiousDiseaseHistory: '其他传染病史标志',
  hypertensionHistory: '高血压病史标志',
  diabetesHistory: '糖尿病史标志',
  heartDiseaseHistory: '心脏病史标志',
  cerebrovascularDiseaseHistory: '脑血管病史标志',
  lungDiseaseHistory: '肺部疾病史标志',
  kidneyDiseaseHistory: '肾脏疾病史标志',
  otherMajorDiseaseHistory: '其它疾病史标志',
  surgeryHistory: '手术史标志',
  traumaHistory: '外伤史标志',
  transfusionHistory: '输血史标志',
  foodDrugAllergyHistory: '过敏史标志',
  longTermResidenceHistory: '外地久居史标志',
  epidemicWaterExposureHistory: '疫水疫源接触史标志',
  specialRegionResidenceHistory: '区居住史',
  occupationalHazardExposureHistory: '有毒物质接触标志',
  drugAbuseHistory: '吸毒史标志',
  smokingHistory: '吸烟史标志',
  drinkingHistory: '饮酒史标志',
  drugPreferenceHistory: '药物嗜好史',
  sexualExposureHistory: '冶游史标志',
  familyHereditaryDiseaseHistory: '家族病史标志',
  familyTumorHistory: '家族肿瘤病史标志',
  familyInfectiousDiseaseHistory: '家族传染病史标志',
  familyMentalDiseaseHistory: '家族精神病史标志',
});

export const PHYSICAL_EXAM_DATA_ID_BY_SLOT: Readonly<Record<string, string>> = Object.freeze({
  temperature: '体温',
  pulse: '脉搏',
  respiration: '呼吸',
  systolicBloodPressure: '收缩压',
  diastolicBloodPressure: '舒张压',
});

const RECORD_DATA_IDS: Readonly<Record<RecordConfirmedWritebackField, readonly string[]>> = {
  chiefComplaint: ['主诉', '主诉文本'],
  historyOfPresentIllness: ['门诊现病史文本', '现病史文本', '现病史'],
  pastMedicalHistory: ['既往史文本'],
  personalHistory: ['个人史文本'],
  menstrualHistory: ['月经史文本'],
  maritalReproductiveHistory: ['婚育史文本'],
  familyHistory: ['家族史文本'],
  physicalExam: ['体格检查'],
  precautions: ['注意事项文本'],
};

export interface BuildRecordConfirmedEmrFieldValuesInput {
  record: Partial<OutpatientRecord>;
  selectedRecordFields: ReadonlySet<RecordConfirmedWritebackField>;
  recordTemplateChanges?: HistoryRecordTemplateChanges;
  historyTemplateValues?: HistoryRecordTemplateSlotValue[];
  physicalExamVitalSigns?: PhysicalExamVitalSigns;
}

export function buildRecordConfirmedEmrFieldValues(
  input: BuildRecordConfirmedEmrFieldValuesInput,
): Record<string, string> {
  const values: Record<string, string> = {};

  input.selectedRecordFields.forEach((field) => {
    const value = input.record[field];
    if (typeof value !== 'string') return;
    if (['menstrualHistory', 'maritalReproductiveHistory'].includes(field) && !value.trim()) return;
    RECORD_DATA_IDS[field].forEach((dataId) => {
      values[dataId] = value;
    });
  });

  if (input.selectedRecordFields.has('maritalReproductiveHistory')) {
    Object.assign(values, buildMaritalReproductiveHistoryFieldValues(input.record.maritalReproductiveHistory || ''));
  }

  input.historyTemplateValues?.forEach((item) => {
    if (!input.selectedRecordFields.has(item.field)) return;
    const dataId = HISTORY_DATA_ID_BY_SLOT[item.slotKey];
    if (!dataId) return;
    if (item.slotKey === 'healthStatus' && item.value === '体健') {
      values[dataId] = '1';
    } else if (item.value === '有') {
      values[dataId] = '1';
    } else if (item.value === '否认') {
      values[dataId] = '0';
    }
  });

  // Keep the explicit change list as a fallback for callers that only provide
  // the historical positive evidence and not the complete fixed-template state.
  input.recordTemplateChanges?.items.forEach((item) => {
    if (
      !input.selectedRecordFields.has(item.field)
      || item.fromValue !== '否认'
      || item.toValue !== '有'
    ) return;
    const dataId = HISTORY_DATA_ID_BY_SLOT[item.slotKey];
    if (dataId) values[dataId] = '1';
  });

  if (input.selectedRecordFields.has('physicalExam')) {
    input.physicalExamVitalSigns?.items.forEach((item) => {
      const dataId = PHYSICAL_EXAM_DATA_ID_BY_SLOT[item.slotKey];
      if (dataId) values[dataId] = item.value;
    });
  }

  return values;
}
