import {
  readFirstString,
  type AvailableMedicineInventoryCatalogItem,
  type ClinicalResultTreatment,
} from '@features/clinical-result';
import { medicalDataService } from '@/services/medicalData';
import type { HisHistoricalMedication, HisVisitRecord } from '@/services/his/types';
import { buildRecentPrescriptionHistory } from './chronicRefillMedicationHistory';

export interface ParsedMedication {
  dosage?: string;
  dosageUnit?: string;
  frequency?: string;
  route?: string;
  days?: string;
  totalQty?: string;
  totalUnit?: string;
}

export interface ChronicRefillMedicineRecommendation {
  name: string;
  spec?: string;
  targetDose?: string;
  targetDoseUnit?: string;
  dosage?: string;
  dosageUnit?: string;
  frequency?: string;
  frequencyKey?: string;
  route?: string;
  routeKey?: string;
  usage?: string;
  days?: string;
  totalQty?: string;
  totalUnit?: string;
  reason?: string;
}

export type ChronicRefillMedicineInput = string | ChronicRefillMedicineRecommendation;

export interface BuildChronicRefillTreatmentsOptions {
  historicalMedications?: string[];
  historicalMedicationOrders?: HisHistoricalMedication[];
  prescriptionHistoryVisits?: HisVisitRecord[];
}

export function parseHistoricalMedication(medicationText: string): ParsedMedication {
  const result: ParsedMedication = {};
  if (!medicationText) return result;

  const text = medicationText.trim();

  // 1. 每次剂量与单位
  // 优先匹配类似 "一次1.5粒"、"每次 2片"、"首剂 2片" 这种明确的剂量描述
  const doseMatch = text.match(/(?:一次|每次)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)?/u);
  if (doseMatch) {
    result.dosage = doseMatch[1];
    if (doseMatch[2]) {
      const possibleUnit = doseMatch[2].trim();
      const nonUnits = [
        '口服', '外用', '吸入', '一日', '每天', '一次', '一日一次', '一日二次', '一日三次', '一日四次',
        '一日1次', '一日2次', '一日3次', '一日4次', 'qd', 'bid', 'tid', 'qid'
      ];
      if (!nonUnits.some(nu => possibleUnit.includes(nu))) {
        result.dosageUnit = possibleUnit;
      }
    }
  }

  // 2. 频次
  // 例如 "一日3次"、"每日2次"、"qd" 等
  const freqMatch = text.match(/(一日\s*\d+\s*次|每日\s*\d+\s*次|一天\s*\d+\s*次|qd|bid|tid|qid|qn|prn)/iu);
  if (freqMatch) {
    result.frequency = freqMatch[1].trim();
  } else {
    const cnFreqMatch = text.match(/(一日一次|一日两次|一日三次|一日四次|每日一次|每日两次|每日三次|每日四次)/u);
    if (cnFreqMatch) {
      result.frequency = cnFreqMatch[1];
    }
  }

  // 3. 用药途径/给药方法
  // 例如 "口服"、"外用"、"吸入"、"舌下含服" 等
  const routeMatch = text.match(/(口服|外用|吸入|皮下注射|肌肉注射|静脉注射|静脉滴注|舌下含服|塞肛|纳肛|喷雾)/u);
  if (routeMatch) {
    result.route = routeMatch[1];
  }

  // 4. 天数
  // 例如 "30天"、"14天"
  const daysMatch = text.match(/(\d+)\s*天/u);
  if (daysMatch) {
    result.days = daysMatch[1];
  }

  // 5. 总量和总量单位
  // 例如 "共2盒"、"总量 3瓶" 或者末尾的 "2盒"
  const totalMatch = text.match(/(?:总量|共|发药|给)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z\u4e00-\u9fa5]+)?/u);
  if (totalMatch) {
    result.totalQty = totalMatch[1];
    if (totalMatch[2]) {
      result.totalUnit = totalMatch[2].trim();
    }
  } else {
    // 末尾兜底匹配，例如 "阿莫西林胶囊 ... 2盒"
    const trailingTotalMatch = text.match(/(\d+(?:\.\d+)?)\s*(盒|瓶|袋|支|包|贴|罐|片|粒|丸)$/u);
    if (trailingTotalMatch) {
      result.totalQty = trailingTotalMatch[1];
      result.totalUnit = trailingTotalMatch[2];
    }
  }

  return result;
}

function normalizeMedicineName(value: string): string {
  return value
    .replace(/^[\s☆★*·•]+/u, '')
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
    .replace(/[\s,，、;；:：\-_/]/gu, '')
    .toLowerCase();
}

function normalizeMedicineAttribute(value: string | undefined): string {
  return (value || '')
    .replace(/[\s,，、;；:：\-_/（）()]/gu, '')
    .toLowerCase();
}

function removeRedundantUnmatchedMedicineTreatments(
  treatments: ClinicalResultTreatment[],
): ClinicalResultTreatment[] {
  const matchedMedicineNames = new Set(
    treatments
      .filter((item) => Boolean(item.matchedItem))
      .map((item) => normalizeMedicineName(item.matchedItem?.name || item.name))
      .filter(Boolean),
  );
  if (matchedMedicineNames.size === 0) return treatments;

  return treatments.filter((item) => (
    Boolean(item.matchedItem)
    || !matchedMedicineNames.has(normalizeMedicineName(item.name))
  ));
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildClinicalRecommendationReason(
  modelReason: string,
  medicineName: string,
  hasHistoricalMedication: boolean,
): string {
  const containsPrescriptionArithmetic = /(?:\d+(?:\.\d+)?\s*(?:mg|g|ml|ug|μg|片|粒|支|袋|盒|瓶|天|次)|每次|单次|每日|每天|一日|疗程|总量|共需|包装|换算)/iu
    .test(modelReason);
  if (modelReason && !containsPrescriptionArithmetic) return modelReason;
  return hasHistoricalMedication
    ? `历史处方包含${medicineName}，当前药房存在同品同规格库存；续方前请结合本次病情、依从性和禁忌证确认`
    : `结合慢病诊断、历史用药和当前库存推荐${medicineName}；使用前请由医生确认适应证和禁忌证`;
}

function getMedicineInputName(input: ChronicRefillMedicineInput): string {
  return typeof input === 'string' ? input.trim() : readText(input.name);
}

function findHistoricalMedication(
  medicineName: string,
  historicalMedications: string[],
): string {
  const normalizedName = normalizeMedicineName(medicineName);
  if (!normalizedName) return '';
  return historicalMedications.find((item) => {
    const normalizedHistory = normalizeMedicineName(item);
    return normalizedHistory === normalizedName
      || normalizedHistory.includes(normalizedName)
      || normalizedName.includes(normalizedHistory);
  }) || '';
}

function findHistoricalMedicationOrder(
  medicineName: string,
  historicalMedicationOrders: HisHistoricalMedication[],
  productId?: string,
): HisHistoricalMedication | null {
  if (productId) {
    const productMatches = historicalMedicationOrders.filter((item) => item.productId === productId);
    if (productMatches.length === 1) return productMatches[0];
  }

  const normalizedName = normalizeMedicineName(medicineName);
  if (!normalizedName) return null;
  const nameMatches = historicalMedicationOrders.filter((item) => (
    normalizeMedicineName(item.name) === normalizedName
  ));
  return nameMatches.length === 1 ? nameMatches[0] : null;
}

function findInventoryMatch(
  medication: string,
  inventory: AvailableMedicineInventoryCatalogItem[],
  options: {
    historicalOrder?: HisHistoricalMedication | null;
    preferredSpec?: string;
  } = {},
): AvailableMedicineInventoryCatalogItem | null {
  const normalizedMedication = normalizeMedicineName(medication);
  if (!normalizedMedication) return null;

  const historicalProductId = readText(options.historicalOrder?.productId);
  if (historicalProductId) {
    return inventory.find((item) => item.productId === historicalProductId) || null;
  }

  const exactCandidates = inventory.filter(
    (item) => normalizeMedicineName(item.productName) === normalizedMedication,
  );
  const candidates = exactCandidates.length > 0
    ? exactCandidates
    : inventory.filter((item) => {
      const normalizedInventoryName = normalizeMedicineName(item.productName);
      return normalizedInventoryName.length >= 4
        && normalizedMedication.length >= 4
        && (
          normalizedMedication.includes(normalizedInventoryName)
          || normalizedInventoryName.includes(normalizedMedication)
        );
    });
  if (candidates.length === 0) return null;

  const expectedManufacturer = normalizeMedicineAttribute(options.historicalOrder?.manufacturer);
  const expectedSpec = normalizeMedicineAttribute(options.historicalOrder?.spec || options.preferredSpec);
  if (expectedManufacturer) {
    const manufacturerMatches = candidates.filter(
      (item) => normalizeMedicineAttribute(item.manufacturer) === expectedManufacturer,
    );
    const manufacturerAndSpecMatches = expectedSpec
      ? manufacturerMatches.filter((item) => normalizeMedicineAttribute(item.spec) === expectedSpec)
      : manufacturerMatches;
    if (manufacturerAndSpecMatches.length === 1) return manufacturerAndSpecMatches[0];
    if (manufacturerMatches.length === 1) return manufacturerMatches[0];
    return null;
  }

  if (expectedSpec) {
    const specMatches = candidates.filter(
      (item) => normalizeMedicineAttribute(item.spec) === expectedSpec,
    );
    if (specMatches.length === 1) return specMatches[0];
  }

  return candidates.length === 1 ? candidates[0] : null;
}

export function buildChronicRefillInventoryTreatments(
  medicationInputs: ChronicRefillMedicineInput[],
  inventory: AvailableMedicineInventoryCatalogItem[],
  standardizeMedicineName: (value: string) => string = (value) => value,
  options: BuildChronicRefillTreatmentsOptions = {},
): ClinicalResultTreatment[] {
  const seen = new Set<string>();
  const treatments: ClinicalResultTreatment[] = [];
  const historicalMedications = options.historicalMedications
    || medicationInputs.filter((item): item is string => typeof item === 'string');
  const historicalMedicationOrders = options.historicalMedicationOrders || [];
  const prescriptionHistoryVisits = options.prescriptionHistoryVisits || [];

  medicationInputs.forEach((input) => {
    const medicineName = getMedicineInputName(input);
    if (!medicineName) return;
    const recommendation = typeof input === 'string' ? null : input;
    const historicalMedication = findHistoricalMedication(medicineName, historicalMedications);
    const historicalMedicationOrderByName = findHistoricalMedicationOrder(
      medicineName,
      historicalMedicationOrders,
    );
    const matched = findInventoryMatch(medicineName, inventory, {
      historicalOrder: historicalMedicationOrderByName,
      preferredSpec: recommendation?.spec,
    });
    if (!matched) {
      const standardName = standardizeMedicineName(medicineName).trim();
      const fallbackKey = `fallback:${normalizeMedicineName(standardName)}`;
      if (!standardName || seen.has(fallbackKey)) return;
      seen.add(fallbackKey);
      const evidenceMedication = historicalMedicationOrderByName?.name || historicalMedication || medicineName;
      const hasHistoricalMedication = Boolean(historicalMedicationOrderByName || historicalMedication);
      treatments.push({
        type: 'medicine',
        name: standardName,
        text: '当前有效库存无同品或合适等效药，保留规范通用名供医生参考',
        evidenceText: `历史用药：${evidenceMedication}；当前有效库存未匹配`,
        sourceType: hasHistoricalMedication ? 'explicit' : 'inferred',
        matchStatus: 'unmatched',
        selected: false,
        reason: '院内无库存参考，不能直接回写处方',
        matchedItem: null,
        recentPrescriptionHistory: buildRecentPrescriptionHistory(
          { name: standardName },
          prescriptionHistoryVisits,
        ),
      });
      return;
    }
    if (seen.has(matched.productId)) return;
    seen.add(matched.productId);

    // 对接本地院内标准药品目录数据
    const dictMatch = medicalDataService.matchMedicine(matched.productName);
    const historicalMedicationOrder = findHistoricalMedicationOrder(
      medicineName,
      historicalMedicationOrders,
      matched.productId,
    ) || historicalMedicationOrderByName;
    const hasHistoricalMedication = Boolean(historicalMedicationOrder || historicalMedication);
    const evidenceMedication = historicalMedicationOrder?.name || historicalMedication || medicineName;
    const currentManufacturerText = matched.manufacturer ? `（${matched.manufacturer}）` : '';
    const evidenceText = hasHistoricalMedication
      ? `历史用药：${evidenceMedication}；当前药房同品${currentManufacturerText}有效库存可用`
      : `模型结合慢病诊断与当前库存推荐：${medicineName}`;
    const parsed = parseHistoricalMedication(historicalMedication);

    // 历史明确处方保留为事实；模型只提供目标临床剂量，PHIS 一次剂量由统一定稿流水线换算。
    const historicalDose = readText(historicalMedicationOrder?.dose) || parsed.dosage || '';
    const historicalDoseUnit = readText(historicalMedicationOrder?.doseUnit) || parsed.dosageUnit || '';
    const targetDose = historicalDose ? '' : readText(recommendation?.targetDose);
    const targetDoseUnit = historicalDose ? '' : readText(recommendation?.targetDoseUnit);
    const dosage = historicalDose;
    const dosageUnit = historicalDoseUnit;

    const frequency = readText(historicalMedicationOrder?.frequency)
      || parsed.frequency
      || readText(recommendation?.frequency)
      || readFirstString(dictMatch?.raw, ['dftFreq']);
    const frequencyKey = readText(historicalMedicationOrder?.frequencyKey)
      || (parsed.frequency ? '' : readText(recommendation?.frequencyKey));
    const route = readText(historicalMedicationOrder?.route)
      || parsed.route
      || readText(recommendation?.route)
      || readText(recommendation?.usage)
      || readFirstString(dictMatch?.raw, ['dftUsage']);
    const routeKey = readText(historicalMedicationOrder?.routeKey)
      || (parsed.route ? '' : readText(recommendation?.routeKey));

    // 天数只接受可靠关联的结构化历史处方或旧文本中的明确值；模型 days 不进入权威处方。
    const days = readText(historicalMedicationOrder?.days) || parsed.days || '';
    const totalQty = readText(historicalMedicationOrder?.totalQty) || parsed.totalQty || '';
    const totalUnit = readText(historicalMedicationOrder?.totalUnit) || parsed.totalUnit || '';
    const hasCompletePrescription = Boolean(
      dosage && dosageUnit && frequency && route && days && totalQty && totalUnit,
    );
    const clinicalReason = buildClinicalRecommendationReason(
      readText(recommendation?.reason),
      matched.productName,
      hasHistoricalMedication,
    );

    treatments.push({
      type: 'medicine',
      name: matched.productName,
      spec: matched.spec || '',
      text: `历史慢病处方药品，当前可用库存${matched.availableQuantity}${matched.unit || ''}`,
      evidenceText,
      sourceType: hasHistoricalMedication ? 'explicit' : 'inferred',
      matchStatus: 'exact',
      selected: hasCompletePrescription,
      reason: clinicalReason,
      targetDose,
      targetDoseUnit,
      dosage,
      dosageUnit,
      frequency,
      frequencyKey,
      route,
      routeKey,
      days,
      totalQty,
      totalUnit,
      recentPrescriptionHistory: buildRecentPrescriptionHistory(
        { name: matched.productName, productId: matched.productId },
        prescriptionHistoryVisits,
      ),
      matchedItem: {
        id: matched.productId,
        name: matched.productName,
        spec: matched.spec,
        manufacturer: matched.manufacturer,
        storeIds: matched.storeIds,
        raw: {
          idMedPro: matched.productId,
          storeIds: matched.storeIds,
          ...(dictMatch?.raw || {}), // 合并完整的字典属性，供后续 normalize 使用
        },
      },
    });
  });

  return removeRedundantUnmatchedMedicineTreatments(treatments);
}
