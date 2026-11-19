import {
  PHYSICAL_EXAM_GUIDANCE_PROMPT,
  VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT,
} from '@features/clinical-result/lib/physicalExamGuidance';

/** Transport order; event payloads remain untouched while mandatory runtime rules are appended separately. */
export const VOICE_INTENT_STREAM_ORDER = [
  'record_core', 'history_context', 'diagnoses', 'recommendation_plan',
  'record_suggestions', 'explicit_orders', 'record_extra', 'done',
] as const;

export const VOICE_DIAGNOSIS_CATALOG_STANDARD = '国家医保 ICD-10 2.0';

const VOICE_DIAGNOSIS_CATALOG_RULE = `诊断标准目录=${VOICE_DIAGNOSIS_CATALOG_STANDARD}：`
  + '西医正式诊断、待鉴别方向和症状性工作诊断的名称与编码只能使用该版本；'
  + '不得混用 ICD-11、WHO 原版 ICD-10、其他国家临床修订版或机构自定义编码。'
  + '无法确定该版本编码时 code 留空，禁止猜测或编造。';

function compactPhysicalExamGuidance(system: string): string {
  if (system.includes(VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT)) return system;
  if (system.includes(PHYSICAL_EXAM_GUIDANCE_PROMPT)) {
    return system.replace(PHYSICAL_EXAM_GUIDANCE_PROMPT, VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT);
  }
  const start = system.indexOf('【按本次就诊组织查体】');
  const diagnosisRules = start >= 0 ? system.indexOf('\n诊断规则：', start) : -1;
  if (start >= 0 && diagnosisRules > start) {
    return `${system.slice(0, start)}${VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT}${system.slice(diagnosisRules)}`;
  }
  return `${system}\n\n${VOICE_PHYSICAL_EXAM_EXTENSION_PROMPT}`;
}

function templateChapterInstructions(fieldRules: string): string {
  return '\n【当前门诊模板病历】chapters 给出本次 HIS 模板的临床章节顺序和原始句式。依据完整转写、既有病历和其他输入，将本次有依据的内容填写到各章原始可写字段。按 chapterId 区分同名或同类章节。'
    + '在 record_core 前逐章逐行输出 {"event":"template_chapter","data":{"chapterId":"模板提供的原始章节ID","fieldValues":{"本章可写字段的原始ID":"病例支持的字段值"}}}。每章返回该章完整字段补丁，缺少依据时使用空对象、空值或按字段规则返回 null。'
    + '仅给 writable 字段填值。时间、数值、单位、字典与局部描述分别填到对应控件；等价的全文控件可以填完整叙述。章节正文由客户端依模板和字段值生成，禁止另写 text 段落。标准病历分区仍为诊疗提供完整事实。'
    + '按本章原句检查相邻控件：若模板已印单位或另有单位槽，数量槽只填数量。例如“[时长][单位]前”分别填“2”和“个月”；独立的时长或全文控件可保留完整的“2个月”。'
    + 'referenceSlots 是本章只读或未选字段的原始资料。htmlText 为本次 HIS 显示文字，definitionValues 为定义中的 TEXT/VALUE，可能是已填病例、编码或模板预设。结合转写、来源和其他病例资料判断，冲突并列保留；只读和未选字段不进入回写。'
    + 'record_suggestions 中的每项带对应 chapterId 和其临床语义 field。待核 AI 候选、空白、模板占位和预置正常项均非确认事实。'
    + '同轮 record_extra.data.templateFieldValues 可补充尚未提供的字段。字典只用合法编码或显示文本。以下规则适用于两处字段值，null 仅用于 unmentionedDefault 约定。\n' + fieldRules;
}

export function applyVoiceIntentStreamProtocol(system: string, templateFieldRules?: string): string {
  const compactSystem = compactPhysicalExamGuidance(system);
  const lines = compactSystem.split('\n');
  // Hosted prompts may still contain the old example. Only reorder a complete,
  // contiguous schema block; never reconstruct or discard its original fields.
  for (let start = 0; start <= lines.length - VOICE_INTENT_STREAM_ORDER.length; start++) {
    if (!lines[start].trimStart().startsWith('{')) continue;
    const example = lines.slice(start, start + VOICE_INTENT_STREAM_ORDER.length);
    try {
      const events = example.map(line => JSON.parse(line)?.event);
      if (!VOICE_INTENT_STREAM_ORDER.every(event => events.includes(event))) continue;
      lines.splice(start, example.length, ...VOICE_INTENT_STREAM_ORDER.map(event => example[events.indexOf(event)]));
      start += example.length - 1;
    } catch { /* Non-example prose is preserved verbatim. */ }
  }
  return `${lines.join('\n')}\n\n【运行协议 voice-intent.v1.8】`
    + `只输出NDJSON，顺序=${templateFieldRules === undefined ? '' : 'template_chapter*>'}${VOICE_INTENT_STREAM_ORDER.join('>')}；本段顺序优先于旧说明。`
    + '基于完整输入判断后逐段发送，不省略分区；AI候选不是已核实诊断或治疗依据。'
    + VOICE_DIAGNOSIS_CATALOG_RULE
    + (templateFieldRules === undefined ? '' : templateChapterInstructions(templateFieldRules));
}
