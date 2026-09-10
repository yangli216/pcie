import type { TreatmentRecommendation } from '@/types/consultation';
import {
  inferExecCountFromFrequencyText,
  parsePositiveNumber,
} from '@/utils/medicalDictionaryHelpers';
import {
  formatDoseCount,
  resolveDoseCountPerAdministration,
} from '@/utils/treatmentInference';
import { readFirstString } from './recordConfirmedPayload';

interface MedicinePackageSpec {
  dose: string;
  doseUnit: string;
  unitSaleFactor: number;
  baseUnit: string;
  saleUnit: string;
}

export interface MedicineQuantityCalculation {
  doseCountPerAdministration: number;
  execCountPerDay: number;
  days: number;
  requiredBaseUnitCount: number;
  unitSaleFactor: number;
  packageCount: number;
  dispensedBaseUnitCount: number;
  baseUnit: string;
  saleUnit: string;
  currentPackageCount: number | null;
  totalConsistent: boolean | null;
}

export interface MedicineDispensingQuantity {
  packageCount: number;
  saleUnit: string;
  source: 'calculated' | 'single-package-fallback';
  calculation: MedicineQuantityCalculation | null;
}

export interface CalculateMedicineQuantityOptions {
  execCount?: number | null;
}

function getMatchedRaw(
  rec: Partial<TreatmentRecommendation>,
): Record<string, unknown> | undefined {
  const raw = (rec.matchedItem as { raw?: unknown } | undefined)?.raw;
  return raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
}

function parsePackageSpec(value: string): MedicinePackageSpec | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const matched = normalized.match(
    /(\d+(?:\.\d+)?)\s*(mg|g|ug|μg|ml)\s*[*x×]\s*(\d+(?:\.\d+)?)\s*([^/／*\s]+)(?:[/／]\s*([^\s]+))?/iu,
  );
  const unitSaleFactor = parsePositiveNumber(matched?.[3]);
  if (!matched?.[1] || !matched[2] || !unitSaleFactor || !matched[4]) return null;
  return {
    dose: matched[1],
    doseUnit: matched[2],
    unitSaleFactor,
    baseUnit: matched[4],
    saleUnit: matched[5] || '',
  };
}

function roundQuantity(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(4).replace(/0+$/u, '').replace(/\.$/u, '');
}

export function calculateMedicineQuantity(
  rec: Partial<TreatmentRecommendation>,
  options: CalculateMedicineQuantityOptions = {},
): MedicineQuantityCalculation | null {
  if ((rec.type || 'medicine') !== 'medicine') return null;

  const raw = getMatchedRaw(rec);
  const spec = rec.spec
    || (rec.matchedItem as { spec?: string } | undefined)?.spec
    || readFirstString(raw, ['specSale', 'spec']);
  const parsedSpec = parsePackageSpec(spec || '');
  const dosage = (rec.dosage || '').trim();
  const dosageUnit = (rec.dosageUnit || '').trim();
  const unitDose = readFirstString(raw, ['dose']) || parsedSpec?.dose || '';
  const unitDoseUnit = readFirstString(raw, ['unitDose'])
    || parsedSpec?.doseUnit
    || dosageUnit;
  const days = parsePositiveNumber(rec.days);
  const execCount = options.execCount
    ?? inferExecCountFromFrequencyText(rec.frequency)
    ?? inferExecCountFromFrequencyText(rec.frequencyKey);
  const doseCount = resolveDoseCountPerAdministration(
    dosage,
    dosageUnit,
    unitDose,
    unitDoseUnit,
  );
  const baseUnit = parsedSpec?.baseUnit
    || readFirstString(raw, ['unitPre'])
    || '制剂单位';
  const saleUnit = readFirstString(raw, ['unitSale'])
    || parsedSpec?.saleUnit
    || (rec.totalUnit || '').trim()
    || '包装';
  const isSplitDispensing = Boolean(saleUnit && baseUnit && saleUnit === baseUnit);
  const rawUnitSaleFactor = parsePositiveNumber(readFirstString(raw, ['unitSaleFactor']))
    || parsedSpec?.unitSaleFactor
    || null;
  const effectiveUnitSaleFactor = isSplitDispensing ? 1 : (rawUnitSaleFactor || null);

  if (!days || !effectiveUnitSaleFactor || !execCount || !doseCount || doseCount <= 0) return null;

  // 对标 PHIS CalcUtils.js: 周期总执行次数 Math.ceil(execCount * days) 向上取整（至少执行 1 次）
  const totalExecCount = Math.ceil(execCount * days);
  const requiredBaseUnitCount = roundQuantity(doseCount * totalExecCount);
  const packageCount = Math.ceil(requiredBaseUnitCount / effectiveUnitSaleFactor);
  if (!Number.isFinite(packageCount) || packageCount <= 0) return null;

  const currentPackageCount = parsePositiveNumber(rec.totalQty);
  const comparesPackageTotal = Boolean(
    currentPackageCount
    && (!rec.totalUnit || rec.totalUnit === saleUnit),
  );

  return {
    doseCountPerAdministration: roundQuantity(doseCount),
    execCountPerDay: roundQuantity(execCount),
    days,
    requiredBaseUnitCount,
    unitSaleFactor: effectiveUnitSaleFactor,
    packageCount,
    dispensedBaseUnitCount: roundQuantity(packageCount * effectiveUnitSaleFactor),
    baseUnit,
    saleUnit,
    currentPackageCount,
    totalConsistent: comparesPackageTotal
      ? Math.abs((currentPackageCount as number) - packageCount) < 0.0001
      : null,
  };
}

/**
 * 解析最终发药包装数。能精确换算时使用公式结果；对于“必要时”等无法折算
 * 固定每日次数的处方，仅在核心处方字段和销售包装单位均完整时兜底为 1 个包装。
 */
export function resolveMedicineDispensingQuantity(
  rec: Partial<TreatmentRecommendation>,
  options: CalculateMedicineQuantityOptions = {},
): MedicineDispensingQuantity | null {
  const calculation = calculateMedicineQuantity(rec, options);
  if (calculation) {
    return {
      packageCount: calculation.packageCount,
      saleUnit: calculation.saleUnit,
      source: 'calculated',
      calculation,
    };
  }

  if ((rec.type || 'medicine') !== 'medicine') return null;
  const raw = getMatchedRaw(rec);
  const spec = rec.spec
    || (rec.matchedItem as { spec?: string } | undefined)?.spec
    || readFirstString(raw, ['specSale', 'spec']);
  const parsedSpec = parsePackageSpec(spec || '');
  const execCount = options.execCount
    ?? inferExecCountFromFrequencyText(rec.frequency)
    ?? inferExecCountFromFrequencyText(rec.frequencyKey);
  if (execCount !== null) return null;
  const frequencyValue = (rec.frequency || rec.frequencyKey || '').trim();
  const saleUnit = readFirstString(raw, ['unitSale'])
    || (rec.totalUnit || '').trim()
    || parsedSpec?.saleUnit
    || '';
  const hasCompleteFallbackBasis = Boolean(
    parsePositiveNumber(rec.dosage)
    && (rec.dosageUnit || '').trim()
    && frequencyValue
    && parsePositiveNumber(rec.days)
    && saleUnit,
  );
  if (!hasCompleteFallbackBasis) return null;

  return {
    packageCount: 1,
    saleUnit,
    source: 'single-package-fallback',
    calculation: null,
  };
}

export function buildMedicineQuantityExplanation(
  rec: Partial<TreatmentRecommendation>,
): string {
  const dispensingQuantity = resolveMedicineDispensingQuantity(rec);
  if (!dispensingQuantity) return '';
  if (dispensingQuantity.source === 'single-package-fallback') {
    const frequency = (rec.frequency || rec.frequencyKey || '').trim();
    return `当前频次“${frequency}”无法精确换算包装总量，暂按1${dispensingQuantity.saleUnit}发药，请医生确认。`;
  }
  const calculation = dispensingQuantity.calculation as MedicineQuantityCalculation;

  const dosageText = `${rec.dosage || ''}${rec.dosageUnit || ''}`;
  const formula = [
    `处方换算：单次${dosageText}（${formatDoseCount(calculation.doseCountPerAdministration)}${calculation.baseUnit}）`,
    `每日${formatQuantity(calculation.execCountPerDay)}次`,
    `${formatQuantity(calculation.days)}天`,
  ].join(' × ');
  const requiredText = `${formula} = ${formatQuantity(calculation.requiredBaseUnitCount)}${calculation.baseUnit}`;
  const isSplitPackageExplanation = calculation.saleUnit === calculation.baseUnit || calculation.unitSaleFactor === 1;
  const packageText = isSplitPackageExplanation
    ? `共${formatQuantity(calculation.packageCount)}${calculation.saleUnit}`
    : calculation.dispensedBaseUnitCount === calculation.requiredBaseUnitCount
      ? `${formatQuantity(calculation.unitSaleFactor)}${calculation.baseUnit}/${calculation.saleUnit}，共${formatQuantity(calculation.packageCount)}${calculation.saleUnit}`
      : `${formatQuantity(calculation.unitSaleFactor)}${calculation.baseUnit}/${calculation.saleUnit}，需${formatQuantity(calculation.packageCount)}${calculation.saleUnit}（实际发${formatQuantity(calculation.dispensedBaseUnitCount)}${calculation.baseUnit}）`;
  if (calculation.totalConsistent === false && calculation.currentPackageCount) {
    return `${requiredText}；${packageText}。当前填写${formatQuantity(calculation.currentPackageCount)}${calculation.saleUnit}，请医生确认。`;
  }
  return `${requiredText}；${packageText}。`;
}
