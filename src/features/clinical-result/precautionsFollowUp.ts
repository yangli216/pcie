const ORDINARY_FOLLOW_UP = '建议3天内复诊，暂予对症处理。若症状无缓解或加重，请及时就诊或上级医院就诊。';
const CHRONIC_FOLLOW_UP = '建议1个月内复诊，复查相关指标。';

const CHRONIC_DIAGNOSIS = /慢性|慢病|高血压|糖尿病|高脂血症|血脂异常|甲减|甲状腺功能减退|冠心病|冠状动脉粥样硬化性心脏病|高尿酸血症|癫痫|帕金森|骨质疏松|前列腺增生|类风湿关节炎/u;
const ACUTE_DIAGNOSIS = /急性|急性发作|加重|危象|失代偿|酮症|昏迷/u;
const SPECIAL_DIAGNOSIS = /体检|健康查体|健康证|外配药|雾化|注射|换药|伤口|创面|术后|外伤|挫伤|烫伤/u;
const TIME = '(?:[0-9一二两三四五六七八九十半]+(?:[～~—至-][0-9一二两三四五六七八九十]+)?\\s*(?:个)?\\s*(?:小时|天|日|周|星期|月)|今天|今日|明天|明日|后天)';
const TIMED_FOLLOW_UP = new RegExp(`(?:${TIME}\\s*(?:内|后|左右)?\\s*(?:来院|到院)?\\s*(?:复诊|就诊)|(?:复诊|就诊)(?:时间)?[：:为是]?\\s*${TIME})`, 'u');

/** 只用于新生成的系统草稿；医生编辑和最终回写不得调用此补齐规则。 */
export function completeGeneratedPrecautions(
  value: string,
  diagnosisNames: readonly string[],
  chronicFollowUp = false,
): string {
  const text = value.trim();
  const diagnoses = diagnosisNames.map((name) => name.trim()).filter(Boolean);
  if (TIMED_FOLLOW_UP.test(text) || diagnoses.some((name) => SPECIAL_DIAGNOSIS.test(name))) {
    return text;
  }

  // 条件性安全提醒不是当前紧急处置，不应使常规复诊时限再次缺失。
  const hasImmediateDisposition = text.split(/[。；;\n]/u).some((sentence) =>
    !/若|如果|如有|如出现|一旦|时[，,]?|则/u.test(sentence)
    && /(?:立即|即刻|马上|尽快).{0,12}(?:就医|就诊|复诊|急诊|转诊|转院|上级医院)/u.test(sentence),
  );
  if (hasImmediateDisposition) return text;

  const chronic = !diagnoses.some((name) => ACUTE_DIAGNOSIS.test(name))
    && (chronicFollowUp || (diagnoses.length > 0 && diagnoses.every((name) => CHRONIC_DIAGNOSIS.test(name))));
  return `${chronic ? CHRONIC_FOLLOW_UP : ORDINARY_FOLLOW_UP}${text}`;
}
