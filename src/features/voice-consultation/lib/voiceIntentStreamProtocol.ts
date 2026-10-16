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

export function applyVoiceIntentStreamProtocol(system: string): string {
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
    + `只输出NDJSON，顺序=${VOICE_INTENT_STREAM_ORDER.join('>')}；本段顺序优先于旧说明。`
    + '基于完整输入判断后逐段发送，不省略分区；AI候选不是已核实诊断或治疗依据。'
    + VOICE_DIAGNOSIS_CATALOG_RULE;
}
