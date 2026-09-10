import { describe, expect, it } from 'vitest';
import {
  buildMedicineQuantityExplanation,
  calculateMedicineQuantity,
  resolveMedicineDispensingQuantity,
} from './clinicalResultMedicineQuantity';

describe('clinicalResultMedicineQuantity', () => {
  it('calculates dose units and package total from the final prescription fields', () => {
    const rec = {
      type: 'medicine' as const,
      name: '盐酸二甲双胍片',
      reason: '历史处方续方',
      spec: '0.25g*60片/瓶',
      dosage: '0.5',
      dosageUnit: 'g',
      frequency: '每天三次',
      frequencyKey: 'TID',
      days: '30',
      totalQty: '3',
      totalUnit: '瓶',
    };

    expect(calculateMedicineQuantity(rec)).toMatchObject({
      doseCountPerAdministration: 2,
      execCountPerDay: 3,
      requiredBaseUnitCount: 180,
      unitSaleFactor: 60,
      packageCount: 3,
      dispensedBaseUnitCount: 180,
      totalConsistent: true,
    });
    expect(buildMedicineQuantityExplanation(rec)).toBe(
      '处方换算：单次0.5g（2片） × 每日3次 × 30天 = 180片；60片/瓶，共3瓶。',
    );
  });

  it('shows the rounded dispensing amount and flags a different current package total', () => {
    const explanation = buildMedicineQuantityExplanation({
      type: 'medicine',
      name: '测试药品',
      reason: '测试',
      spec: '10mg*14片/盒',
      dosage: '10',
      dosageUnit: 'mg',
      frequencyKey: 'BID',
      days: '10',
      totalQty: '1',
      totalUnit: '盒',
    });

    expect(explanation).toBe(
      '处方换算：单次10mg（1片） × 每日2次 × 10天 = 20片；14片/盒，需2盒（实际发28片）。当前填写1盒，请医生确认。',
    );
  });

  it('uses HIS dose and sale-unit metadata when display spec is unavailable', () => {
    const calculation = calculateMedicineQuantity({
      type: 'medicine',
      name: '盐酸二甲双胍片',
      reason: '历史处方续方',
      dosage: '0.5',
      dosageUnit: 'g',
      frequencyKey: 'TID',
      days: '30',
      totalQty: '180',
      totalUnit: '片',
      matchedItem: {
        raw: {
          dose: '0.25',
          unitDose: 'g',
          unitPre: '片',
          unitSaleFactor: '60',
          unitSale: '瓶',
        },
      },
    });

    expect(calculation).toMatchObject({
      requiredBaseUnitCount: 180,
      packageCount: 3,
      baseUnit: '片',
      saleUnit: '瓶',
      totalConsistent: null,
    });
  });

  it('does not fabricate an explanation when core prescription fields are missing', () => {
    expect(buildMedicineQuantityExplanation({
      type: 'medicine',
      name: '测试药品',
      reason: '测试',
      spec: '10mg*14片/盒',
      dosage: '10',
      dosageUnit: 'mg',
    })).toBe('');
  });

  it('falls back to one sale package when a valid frequency cannot be quantified', () => {
    const rec = {
      type: 'medicine' as const,
      name: '布洛芬缓释胶囊',
      reason: '必要时止痛',
      spec: '0.3g*24粒/盒',
      dosage: '0.3',
      dosageUnit: 'g',
      frequency: '必要时',
      frequencyKey: 'PRN',
      days: '3',
      totalQty: '',
      totalUnit: '盒',
    };

    expect(calculateMedicineQuantity(rec)).toBeNull();
    expect(resolveMedicineDispensingQuantity(rec)).toEqual({
      packageCount: 1,
      saleUnit: '盒',
      source: 'single-package-fallback',
      calculation: null,
    });
    expect(buildMedicineQuantityExplanation(rec)).toBe(
      '当前频次“必要时”无法精确换算包装总量，暂按1盒发药，请医生确认。',
    );
  });

  it('handles retail split dispensing when saleUnit matches baseUnit (e.g. 24片/盒 sold by 片)', () => {
    const rec = {
      type: 'medicine' as const,
      name: '阿莫西林胶囊',
      reason: '抗感染',
      spec: '0.25g*24片/盒',
      dosage: '0.25',
      dosageUnit: 'g',
      frequencyKey: 'TID',
      days: '7',
      totalUnit: '片',
      matchedItem: {
        raw: {
          dose: '0.25',
          unitDose: 'g',
          unitPre: '片',
          unitSale: '片',
        },
      },
    };

    const calculation = calculateMedicineQuantity(rec);
    expect(calculation).toMatchObject({
      doseCountPerAdministration: 1,
      execCountPerDay: 3,
      days: 7,
      requiredBaseUnitCount: 21,
      unitSaleFactor: 1,
      packageCount: 21,
      dispensedBaseUnitCount: 21,
      baseUnit: '片',
      saleUnit: '片',
    });

    const dispensing = resolveMedicineDispensingQuantity(rec);
    expect(dispensing).toEqual({
      packageCount: 21,
      saleUnit: '片',
      source: 'calculated',
      calculation,
    });

    expect(buildMedicineQuantityExplanation(rec)).toBe(
      '处方换算：单次0.25g（1片） × 每日3次 × 7天 = 21片；共21片。',
    );
  });

  it('accurately calculates Estazolam 2mg QHS 7 days split dispensing as 14 tablets', () => {
    const rec = {
      type: 'medicine' as const,
      name: '☆艾司唑仑片',
      spec: '1mg*20片/盒',
      dosage: '2',
      dosageUnit: 'mg',
      frequency: '一天一次(睡前)(QHS)',
      frequencyKey: 'QHS',
      days: '7',
      totalUnit: '片',
      matchedItem: {
        raw: {
          dose: '1',
          unitDose: 'mg',
          unitPre: '片',
          unitSale: '片',
          specSale: '1mg*20片/盒',
        },
      },
    };

    const calculation = calculateMedicineQuantity(rec);
    expect(calculation).toMatchObject({
      doseCountPerAdministration: 2,
      execCountPerDay: 1,
      days: 7,
      requiredBaseUnitCount: 14,
      unitSaleFactor: 1,
      packageCount: 14,
      dispensedBaseUnitCount: 14,
      baseUnit: '片',
      saleUnit: '片',
    });

    const dispensing = resolveMedicineDispensingQuantity(rec);
    expect(dispensing).toEqual({
      packageCount: 14,
      saleUnit: '片',
      source: 'calculated',
      calculation,
    });

    expect(buildMedicineQuantityExplanation(rec)).toBe(
      '处方换算：单次2mg（2片） × 每日1次 × 7天 = 14片；共14片。',
    );
  });
});
