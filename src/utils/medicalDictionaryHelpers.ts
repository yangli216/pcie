/**
 * 医学字典辅助工具：频次 / 用法 / 执行科室选项的纯函数与类型
 *
 * 与 `useMedicalDictionaries` 配合使用：
 * - 此文件仅包含纯函数与类型，可在任何位置（组件、composable、services）安全 import；
 * - composable 在此基础上封装 reactive state + HIS 加载逻辑；
 * - 字典选项的本地默认列表（默认频次、默认用法）也定义在此处，便于不同入口共享同一基线。
 */

export interface UsageOption {
  key: string;
  text: string;
  py: string;
  wb: string;
  mcode: string;
  execCount?: number;
  normalizedTokens: string[];
}

export interface ExecDeptOption {
  key: string;
  text: string;
}

export function parsePositiveNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

const CHINESE_NUMBER_MAP: Record<string, number> = {
  '一': 1,
  '二': 2,
  '两': 2,
  '三': 3,
  '四': 4,
  '五': 5,
  '六': 6,
  '七': 7,
  '八': 8,
  '九': 9,
  '十': 10,
};

function parseCountFromMatch(value: string): number | null {
  const trimmed = value.trim();
  const num = parsePositiveNumber(trimmed);
  if (num !== null) return num;
  return CHINESE_NUMBER_MAP[trimmed] ?? null;
}

/**
 * 参考 PHIS CalcUtils.js 的 calcFreqDayExec 计算频次日均执行次数
 *
 * PHIS 计算规则：
 * - sdFreqCycle:
 *   - '1' (星期): execCount / (parseInt(gapCycle) * 7)
 *   - '3' (小时): execCount * (24 / gapCycle)
 *   - 其他 (天): execCount / gapCycle
 */
export function calcFreqDayExec(freq?: { properties?: Record<string, unknown> } | null): number | null {
  if (!freq?.properties || typeof freq.properties !== 'object') {
    return null;
  }
  const properties = freq.properties;
  const sdFreqCycle = String(properties['sdFreqCycle'] ?? '').trim();
  const gapCycle = parsePositiveNumber(properties['gapCycle']) ?? 1;
  const execCount = parsePositiveNumber(properties['execCount']);
  if (execCount === null) {
    return null;
  }

  if (sdFreqCycle === '1') {
    return execCount / (gapCycle * 7);
  } else if (sdFreqCycle === '3') {
    return execCount * (24 / gapCycle);
  } else {
    return execCount / gapCycle;
  }
}

export function inferExecCountFromFrequencyText(text?: string | null): number | null {
  if (!text) return null;
  const normalizedText = text.trim().toLowerCase();
  if (!normalizedText) {
    return null;
  }

  // 1. 常见西医拉丁缩写（使用词边界或非字母字符隔开，兼容 (QHS)、(TID) 等形式）
  if (/(?:^|[^\w])(qhs|qn|qam|qpm|qm|qd)(?:[^\w]|$)/i.test(normalizedText)) {
    return 1;
  }
  if (/(?:^|[^\w])bid(?:[^\w]|$)/i.test(normalizedText)) {
    return 2;
  }
  if (/(?:^|[^\w])tid(?:[^\w]|$)/i.test(normalizedText)) {
    return 3;
  }
  if (/(?:^|[^\w])qid(?:[^\w]|$)/i.test(normalizedText)) {
    return 4;
  }
  if (/(?:^|[^\w])qod(?:[^\w]|$)/i.test(normalizedText)) {
    return 0.5;
  }
  if (/(?:^|[^\w])qw(?:[^\w]|$)/i.test(normalizedText)) {
    return 1 / 7;
  }
  if (/(?:^|[^\w])biw(?:[^\w]|$)/i.test(normalizedText)) {
    return 2 / 7;
  }
  if (/(?:^|[^\w])tiw(?:[^\w]|$)/i.test(normalizedText)) {
    return 3 / 7;
  }

  // 小时频次：如 q12h, q8h, q6h, q4h, 每12小时一次
  const intervalMatch = normalizedText.match(/(?:^|[^\w])q(\d+(?:\.\d+)?)h(?:[^\w]|$)/i)
    || normalizedText.match(/每\s*(\d+(?:\.\d+)?)\s*小时/);
  if (intervalMatch?.[1]) {
    const hours = parsePositiveNumber(intervalMatch[1]);
    if (hours) {
      return 24 / hours;
    }
  }

  // 2. 常见特定临床语义词（睡前、每晚、晨服、空腹、隔日、每周等）
  if (
    normalizedText.includes('睡前')
    || normalizedText.includes('每晚')
    || normalizedText.includes('晨服')
    || normalizedText.includes('早晨一次')
    || normalizedText.includes('早晨1次')
    || normalizedText.includes('空腹一次')
    || normalizedText.includes('空腹1次')
  ) {
    return 1;
  }
  if (normalizedText.includes('隔日一次') || normalizedText.includes('隔天一次')) {
    return 0.5;
  }
  if (normalizedText.includes('每周一次') || normalizedText.includes('1周1次') || normalizedText.includes('一周一次')) {
    return 1 / 7;
  }
  if (normalizedText.includes('每周两次') || normalizedText.includes('1周2次') || normalizedText.includes('一周两次')) {
    return 2 / 7;
  }
  if (normalizedText.includes('每周三次') || normalizedText.includes('1周3次') || normalizedText.includes('一周三次')) {
    return 3 / 7;
  }

  // 3. 通用“天/日”频次正则匹配（支持汉字数字与阿拉伯数字，兼容“一天”、“每天”、“每日”、“每昼夜”）
  // 模式 A: [每|一|1][日|天]\D*([0-9]+|[一二两三四五六七八九十])\D*次
  const timesPerDayMatchA = normalizedText.match(/(?:每|一|1)\s*[日天昼夜]\D*([1-9]\d*|[一二两三四五六七八九十])\D*次/);
  if (timesPerDayMatchA?.[1]) {
    const count = parseCountFromMatch(timesPerDayMatchA[1]);
    if (count !== null) return count;
  }

  // 模式 B: ([0-9]+|[一二两三四五六七八九十])\D*次\D*(?:每|一|1)[日天昼夜]
  const timesPerDayMatchB = normalizedText.match(/([1-9]\d*|[一二两三四五六七八九十])\D*次\D*(?:每|一|1)\s*[日天昼夜]/);
  if (timesPerDayMatchB?.[1]) {
    const count = parseCountFromMatch(timesPerDayMatchB[1]);
    if (count !== null) return count;
  }

  return null;
}

export function normalizeUsageKeyword(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

export function createUsageOption(item: {
  key?: string;
  text?: string;
  py?: string;
  wb?: string;
  mcode?: string;
  properties?: Record<string, unknown>;
  execCount?: number | string;
}): UsageOption {
  const text = (item.text || '').trim();
  const py = (item.py || '').trim();
  const wb = (item.wb || '').trim();
  const mcode = (item.mcode || '').trim();
  const key = (item.key || text).trim();
  const dayExec = calcFreqDayExec(item);
  const execCount = dayExec
    ?? parsePositiveNumber(item.execCount)
    ?? inferExecCountFromFrequencyText(text)
    ?? inferExecCountFromFrequencyText(key)
    ?? undefined;

  return {
    key,
    text,
    py,
    wb,
    mcode,
    execCount,
    normalizedTokens: Array.from(new Set(
      [text, py, wb, mcode, key]
        .map(normalizeUsageKeyword)
        .filter(Boolean)
    )),
  };
}

export function dedupeUsageOptions(items: UsageOption[]): UsageOption[] {
  const unique = new Map<string, UsageOption>();

  items.forEach((item) => {
    if (!item.text) return;

    const identity = item.key || item.text;
    if (!unique.has(identity)) {
      unique.set(identity, item);
    }
  });

  return Array.from(unique.values());
}

export function dedupeExecDeptOptions(items: Array<{ key?: string; text?: string }>): ExecDeptOption[] {
  const unique = new Map<string, ExecDeptOption>();

  items.forEach((item) => {
    const key = (item.key || item.text || '').trim();
    const text = (item.text || item.key || '').trim();
    if (!key || !text || unique.has(key)) {
      return;
    }
    unique.set(key, { key, text });
  });

  return Array.from(unique.values());
}

/** 默认频次字典：HIS 字典缺失时使用 */
export const DEFAULT_FREQUENCY_OPTIONS: UsageOption[] = dedupeUsageOptions([
  createUsageOption({ key: '每天一次', text: '每天一次', execCount: 1 }),
  createUsageOption({ key: '每天两次', text: '每天两次', execCount: 2 }),
  createUsageOption({ key: '每天三次', text: '每天三次', execCount: 3 }),
  createUsageOption({ key: '隔日一次', text: '隔日一次', execCount: 0.5 }),
  createUsageOption({ key: '每周一次', text: '每周一次' }),
  createUsageOption({ key: '每周两次', text: '每周两次' }),
  createUsageOption({ key: '必要时', text: '必要时' }),
  createUsageOption({ key: '立即', text: '立即', execCount: 1 }),
]);

/** 默认用法字典：HIS 字典缺失时使用 */
export const DEFAULT_ROUTE_OPTIONS: UsageOption[] = dedupeUsageOptions([
  createUsageOption({ key: '口服', text: '口服', py: 'kf' }),
  createUsageOption({ key: '静脉注射', text: '静脉注射', py: 'jmzs' }),
  createUsageOption({ key: '肌肉注射', text: '肌肉注射', py: 'jrzs' }),
  createUsageOption({ key: '皮下注射', text: '皮下注射', py: 'pxzs' }),
  createUsageOption({ key: '外用', text: '外用', py: 'wy' }),
  createUsageOption({ key: '雾化吸入', text: '雾化吸入', py: 'whxr' }),
  createUsageOption({ key: '舌下含服', text: '舌下含服', py: 'sxhf' }),
  createUsageOption({ key: '直肠给药', text: '直肠给药', py: 'zcgy' }),
  createUsageOption({ key: '滴眼', text: '滴眼', py: 'dy' }),
]);
