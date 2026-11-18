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
  return '\n【当前门诊模板病历】本次结果页的病历由 chapters 逐章组成。按提供的章序、实际句式、字段名称及语义，将本次临床资料写入对应章节。自定义、同名或同类的章节按各自 chapterId 分别书写；模板外资料可供诊疗分析，不要另创显示章节。'
    + '在 record_core 前按章节顺序逐行输出 {"event":"template_chapter","data":{"chapterId":"模板提供的原始章节ID","text":"该章完整临床正文"}}。一章一行，包括无依据时的空字符串。标准病历分区另供诊疗及兼容映射使用；显示正文完全按模板临床章节和证据组织。无相应事实的标准字段可为空。'
    + 'referenceSlots 是本章只读或未选字段的原始资料。htmlText 为本次 HIS 显示文字，definitionValues 为定义中的 TEXT/VALUE，可能是已填病例、编码或模板预设。结合转写、来源和其他病例资料判断，冲突并列保留；不把这些字段加入回写，也不把空白或预置正常项认定为确诊事实。'
    + 'record_suggestions 中的每项带对应 chapterId 和其临床语义 field。正文中不得把尚待核对的 AI 候选写成已证实事实。'
    + '在 record_extra.data.templateFieldValues 以字段原始 ID 给出各实际可写字段值，与该章正文一致。字典用合法编码或显示文本。只有受本次资料支持的事实可用于书写。模板句式、示例、默认值并非患者事实。'
    + '\n以下字段规则仅约束 templateFieldValues，缺少依据时可省略字段，null 仅用于 unmentionedDefault 约定。\n' + fieldRules;
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
