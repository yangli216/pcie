import type { ClinicalRecordFactRecord, ClinicalRecordFactSuggestion } from '../clinicalRecordFactConfirmation';

type ExamModule = 'general' | 'respiratory' | 'cardiac' | 'abdominal' | 'edema' | 'foot' | 'neurologic';
interface ExamItem {
  key: string;
  modules: ExamModule[];
  text: string;
  topic: RegExp;
  critical?: boolean;
}

/** Editable template candidates, never measured/confirmed examination evidence. */
export const PHYSICAL_EXAM_ITEMS: readonly ExamItem[] = [
  { key: 'consciousness', modules: ['general'], text: '神清', topic: /神清|意识|神志|昏迷|嗜睡|谵妄/u },
  { key: 'mental-state', modules: ['general'], text: '精神佳', topic: /精神|萎靡/u },
  { key: 'tonsils', modules: ['respiratory'], text: '扁桃体无肿大', topic: /扁桃体/u },
  { key: 'face', modules: ['edema'], text: '面部无浮肿', topic: /(?:面部|颜面|眼睑).{0,8}(?:肿|水肿)/u },
  { key: 'respiratory-movement', modules: ['respiratory'], text: '呼吸运动双侧对称', topic: /呼吸运动|呼吸.{0,5}(?:困难|费力)|三凹征/u },
  { key: 'breath-sounds', modules: ['respiratory', 'cardiac'], text: '双肺呼吸音粗', topic: /呼吸音/u },
  { key: 'rales', modules: ['respiratory', 'cardiac'], text: '未闻及干湿性啰音', topic: /啰音|罗音|哮鸣音/u },
  { key: 'rhythm', modules: ['cardiac'], text: '心律齐', topic: /心律|心率不齐|房颤/u },
  { key: 'murmur', modules: ['cardiac'], text: '未闻及心脏病理性杂音', topic: /杂音/u },
  { key: 'abdomen-shape', modules: ['abdominal'], text: '腹平软', topic: /腹.{0,4}(?:平|软|硬|隆起|膨隆)|肌紧张|板状腹/u },
  { key: 'tenderness', modules: ['abdominal'], text: '腹部无压痛', topic: /压痛/u },
  { key: 'bowel', modules: ['abdominal'], text: '肠鸣音正常', topic: /肠鸣音/u },
  { key: 'liver-spleen', modules: ['abdominal'], text: '肝脾肋下未及', topic: /肝脾|肝大|脾大|(?:肝|脾).{0,8}肋下/u },
  { key: 'leg-edema', modules: ['edema', 'cardiac', 'foot'], text: '双下肢无水肿', topic: /(?:腿|足|下肢|踝).{0,8}(?:水肿|浮肿|肿胀)|水肿/u },
  { key: 'foot-pulse', modules: ['foot'], text: '双足背动脉搏动可触及', topic: /足背动脉|足部.{0,5}(?:脉搏|搏动)/u },
  { key: 'foot-skin', modules: ['foot'], text: '双足皮肤完整，无破溃', topic: /足.{0,8}(?:皮肤|溃疡|破溃)|糖尿病足/u },
  { key: 'pupils', modules: ['neurologic'], text: '双侧瞳孔等大等圆，对光反射灵敏', topic: /瞳孔|对光反射/u, critical: true },
  { key: 'limb-strength', modules: ['neurologic'], text: '四肢肌力正常', topic: /肌力|偏瘫|肢体无力|肢体乏力/u, critical: true },
];

function positiveContext(value: string): string {
  return value.split(/[，。；;\n]/u).filter((clause) => !/(?:否认|无|未见|不伴|既往|病史|长期患|曾患)/u.test(clause)).join('；');
}

export function selectPhysicalExamModules(input: Pick<ClinicalRecordFactRecord, 'chiefComplaint' | 'historyOfPresentIllness'>, diagnosisNames: readonly string[]): ExamModule[] {
  const context = [positiveContext(input.chiefComplaint), positiveContext(input.historyOfPresentIllness), ...diagnosisNames].join('；');
  if (!context.trim().replace(/；/gu, '')) return [];
  const modules = new Set<ExamModule>(['general']);
  if (/咳嗽|咳痰|咽痛|发热|上呼吸道|支气管|肺炎|哮喘|呼吸困难|气促/u.test(context)) modules.add('respiratory');
  if (/高血压|心脏|冠心病|心衰|心力衰竭|胸痛|胸闷|心悸|心慌|气促/u.test(context)) modules.add('cardiac');
  if (/腹痛|腹泻|腹胀|呕吐|恶心|便秘|胃炎|肠炎|消化|肝病|肝炎/u.test(context)) modules.add('abdominal');
  if (/水肿|浮肿|肾病|肾炎|肾功能/u.test(context)) modules.add('edema');
  if (/糖尿病|糖尿病足|足部|下肢缺血/u.test(context)) modules.add('foot');
  if (/头痛|头晕|眩晕|肢体无力|肢体乏力|偏瘫|麻木|卒中/u.test(context)) modules.add('neurologic');
  return [...modules];
}

export const PHYSICAL_EXAM_GUIDANCE_PROMPT = [
  '【按本次就诊组织查体】先保留本次明确查体及异常体征，再从基础项目中选择与主诉、现病史及已选正式诊断相关的项目，最后补充不能遗漏的重点专科查体。历史共病不能单独触发整套查体。',
  `基础项目库（均为未核实的书写候选）：${PHYSICAL_EXAM_ITEMS.map((item) => item.text).join('；')}。`,
  '按医生确认的书写习惯，肺部默认候选使用“双肺呼吸音粗”；该默认用语不代表正常或已实际听诊。已有明确呼吸音清、粗、减弱等结果时原样保留，不补默认候选，不覆盖医生修改。神清与意识清楚不重复，删除笼统的“腹无特殊”“神经系统检查阴性”。',
  '呼吸道优先一般情况、咽部、呼吸运动、肺部听诊；高血压优先心肺及下肢水肿；糖尿病优先足部皮肤、足背动脉及水肿；腹痛优先腹部并按部位补反跳痛/肌紧张等；有神经症状再补针对性神经查体。',
  '身高、体重、腰围、血氧等数值只能来自本次明确测量，不能写默认正常数值；缺失数值仅保留具名占位（例如血氧饱和度:{血氧饱和度}%）。',
  '查体候选独立于其他字段最多24个紧凑项目，其他字段合计最多8项；不凑数。每个候选只描述一个可独立调整的项目，question写具体核查点；严重程度/重要鉴别相关项目用critical。',
  'physicalExam只写本次明确查体；未明确的模板补充（含默认“双肺呼吸音粗”）写入候选列表并由界面标记AI，不得当作诊断、排除危险疾病或用药安全性的已核实依据。',
].join('\n');

export const VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT = [
  '【语音查体增量】基础查体候选由客户端依据本次病历和正式诊断补齐，模型不得重复输出通用神志、精神、扁桃体、呼吸、心脏、腹部、下肢水肿、足部、瞳孔或肌力正常候选。',
  'record_suggestions中的physicalExam最多4项，只补基础库之外、与本次主诉或正式诊断直接相关且不能遗漏的专科查体；每项只描述一个核查点，不写测量值，不把候选作为诊断、排除危险疾病或用药安全性的已核实依据。',
  'record_extra.physicalExam只写本次明确查体与生命体征；已有明确正常或异常结果原样保留，不得用候选覆盖。',
].join('\n');

/** Conservative: if the current record already describes the same exam item,
 * never append a competing template finding (including synonyms and laterality). */
export function canAppendPhysicalExamCandidate(candidate: string, explicitText: string): boolean {
  if (/神经系统检查阴性|腹无特殊/u.test(candidate)) return false;
  if (/呼吸音粗/u.test(candidate) && !/^双肺呼吸音粗[。；]?$/u.test(candidate)) return false;
  if (/\d+(?:\.\d+)?\s*(?:℃|°C|次|mmHg|cm|kg|%|级|分)/iu.test(candidate)) return false;
  const topics = PHYSICAL_EXAM_ITEMS.filter((item) => item.topic.test(candidate));
  if (topics.some((item) => item.topic.test(explicitText))) return false;
  // Extension items share the same conflict gate, even when not in the baseline.
  const extensionTopics = [/反跳痛/u, /肌紧张|板状腹/u, /病理征|巴宾斯基|Babinski/iu, /感觉|麻木/u, /血氧|SpO2/iu, /咽.{0,4}(?:红|充血)/u];
  return !extensionTopics.some((topic) => topic.test(candidate) && topic.test(explicitText));
}

export function completePhysicalExamSuggestions(
  record: ClinicalRecordFactRecord,
  diagnosisNames: readonly string[],
  incoming: readonly ClinicalRecordFactSuggestion[],
): ClinicalRecordFactSuggestion[] {
  const modules = selectPhysicalExamModules(record, diagnosisNames);
  const explicitText = [record.physicalExam, record.historyOfPresentIllness].join('；');
  const baseline: ClinicalRecordFactSuggestion[] = PHYSICAL_EXAM_ITEMS
    .filter((item) => item.modules.some((module) => modules.includes(module)))
    .map((item) => ({
      id: `physical-exam-${item.key}`, field: 'physicalExam', question: `请核对：${item.text}？`,
      negativeRecordText: item.text, rationale: '根据本次就诊匹配的基础查体项目',
      priority: item.critical ? 'critical' : 'general', status: 'pending',
    }));
  // Model extensions may add specificity. Baseline fills only uncovered items.
  const candidates = [...incoming.filter((item) => item.field === 'physicalExam'
    // A generic model normal finding must not replace the physician-agreed default.
    && !/^双肺呼吸音清(?:晰)?[。；]?$/u.test(item.negativeRecordText)), ...baseline];
  const accepted: ClinicalRecordFactSuggestion[] = [];
  let corpus = explicitText;
  for (const candidate of candidates) {
    const knownItem = PHYSICAL_EXAM_ITEMS.find((item) => item.text === candidate.negativeRecordText.replace(/[。；]$/u, ''));
    if (knownItem && !knownItem.modules.some((module) => modules.includes(module))) continue;
    if (candidate.status !== 'pending' || !canAppendPhysicalExamCandidate(candidate.negativeRecordText, corpus)) continue;
    if (corpus.includes(candidate.negativeRecordText)) continue;
    accepted.push(candidate);
    corpus += `；${candidate.negativeRecordText}`;
  }
  const order = (item: ClinicalRecordFactSuggestion) => {
    const index = PHYSICAL_EXAM_ITEMS.findIndex((entry) => entry.topic.test(item.negativeRecordText));
    return index < 0 ? PHYSICAL_EXAM_ITEMS.length : index;
  };
  return [...incoming.filter((item) => item.field !== 'physicalExam'), ...accepted.slice(0, 24).sort((a, b) => order(a) - order(b))];
}
