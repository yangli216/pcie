// 核查项只能增量写入状态事实；不能把药品列表再次搬入现病史。
// 污染片段整体舍弃，避免删掉药名后留下剂量或改变否定/因果语义。
const PRESCRIPTION_DETAIL_PATTERN = /口服|注射|静滴|外用|规格|剂量|频次|疗程|总量|库存|推荐药品|建议使用|拟继续|后续治疗方案|[\u4e00-\u9fff]{2,}(?:片|胶囊|颗粒|滴丸|口服液|注射液)|胰岛素|(?:\d+(?:\.\d+)?|[一二三四五六七八九十半]+)\s*(?:μg|ug|mg|g|ml|毫克|微克|克|毫升|片|粒|支|盒|瓶|袋|丸|单位)|每(?:次|日|天|晚|周)|\b(?:qd|bid|tid|qid|qn|qod|prn|q\d+h)\b/iu;
// 目录无可续方项时仍拦截“服用阿司匹林”等省略剂型的药名；通用状态可保留。
const NAMED_MEDICATION_ACTION_PATTERN = /(?:服用|停用|加用|换用)\s*(?!(?:原(?:有)?(?:用药)?方案|近期方案|药物|药品|降压药物|降糖药物)(?:[，,。；;\s]|$))[^，,。；;\s]+/u;

function containsPrescriptionDetail(value: string, medicationNames: string[] = []): boolean {
  const compactText = value.replace(/\s+/gu, '');
  const containsKnownMedicine = medicationNames.some((name) => {
    const normalizedName = name
      .replace(/^[\s☆★*·•]+/u, '')
      .split(/[（(\/／|｜\d]/u)[0]
      .replace(/\s+/gu, '');
    return normalizedName.length > 1 && compactText.includes(normalizedName);
  });
  return containsKnownMedicine
    || PRESCRIPTION_DETAIL_PATTERN.test(value)
    || NAMED_MEDICATION_ACTION_PATTERN.test(value);
}

export function normalizeChronicRefillReviewRecordText(
  value: string,
  medicationNames: string[] = [],
): string {
  const text = value.trim();
  return !text || containsPrescriptionDetail(text, medicationNames) ? '' : text;
}

/**
 * 清理慢病复诊现病史中绕过结构化核查、直接拼接在“复诊配药”后的处方明细。
 * 只在确认存在处方描述时收敛到诊断/复诊目的，避免误删普通复诊事实。
 */
export function normalizeChronicRefillHistoryOfPresentIllness(value: string): string {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!text) return '';

  const markerPattern = /((?:今|本次)?复诊(?:配药|续方)|(?:今|本次)?续方配药)\s*[：:]/u;
  const marker = markerPattern.exec(text);
  if (!marker) return text;

  const suffixStart = marker.index + marker[0].length;
  const suffix = text.slice(suffixStart).trim();
  if (!containsPrescriptionDetail(suffix)) return text;

  const prefix = text.slice(0, marker.index)
    .replace(/[，,。；;：:\s]+$/u, '')
    .trim();
  const purpose = marker[1].trim();
  return `${prefix ? `${prefix}。` : ''}${purpose}。`;
}
