const MARITAL_STATUS_CODES: Readonly<Record<string, string>> = {
  未婚未育: '1',
  已婚未育: '2',
  已婚已育: '3',
  未婚已育: '4',
  离异: '5',
};

/** 模板空槽不是病史事实，尤其不能把“{怀孕标志}怀孕”当成已孕。 */
export function normalizeFemaleHistoryText(value: string): string {
  if (!/[{\[【](?:婚育状况|怀孕标志|其他|月经|初潮|经期|经量|周期|末次月经)/u.test(value)
    && !/^(?:婚育状况|怀孕标志|其他|月经史|婚育史|未提供|未记录|不详|未知)$/u.test(value.trim())) return value.trim();
  return value.split(/[，,；;。\n]/u)
    .map((part) => part.trim())
    .filter((part) => part && !/[{\[【](?:婚育状况|怀孕标志|其他|月经[^}\]】]*|初潮[^}\]】]*|经期|经量|周期|末次月经)[}\]】]/u.test(part))
    .filter((part) => !/^(?:婚育状况|怀孕标志|其他|月经史|婚育史|未提供|未记录|不详|未知)$/u.test(part))
    .join('；');
}

/** 只转换明确、无冲突的字典值，不以月经、婚育或历史孕产次数推断妊娠。 */
export function buildMaritalReproductiveHistoryFieldValues(value: string): Record<string, string> {
  const clauses = value.split(/[，,；;。\n]/u).map((part) => part.trim());
  const maritalCodes = new Set<string>();
  const pregnancyCodes = new Set<string>();
  clauses.forEach((clause) => {
    const marital = clause.replace(/^(?:婚育状况|婚育史)\s*[：:]\s*/u, '');
    if (MARITAL_STATUS_CODES[marital]) maritalCodes.add(MARITAL_STATUS_CODES[marital]);
    const pregnancy = clause.replace(/^(?:怀孕标志|当前妊娠状态)\s*[：:]\s*/u, '');
    if (/^(?:(?:目前|当前|本次|现)\s*)?(?:未孕|未怀孕|未妊娠|否认怀孕|否认妊娠)$/u.test(pregnancy)
      || /^怀孕标志\s*[：:]\s*否$/u.test(clause)) pregnancyCodes.add('0');
    if (/^(?:(?:目前|当前|本次|现)\s*)?(?:已孕|已怀孕|已妊娠|怀孕|妊娠)(?:\s*\d+(?:\+\d+)?\s*周)?$/u.test(pregnancy)
      || /^怀孕标志\s*[：:]\s*是$/u.test(clause)) pregnancyCodes.add('1');
  });
  return {
    ...(maritalCodes.size === 1 ? { 婚育状况: [...maritalCodes][0] } : {}),
    ...(pregnancyCodes.size === 1 ? { 怀孕标志: [...pregnancyCodes][0] } : {}),
  };
}
