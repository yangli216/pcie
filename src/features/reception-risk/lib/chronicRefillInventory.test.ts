import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const g = globalThis as any;
  if (typeof g.localStorage === 'undefined') {
    g.localStorage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
  }
});

import { buildChronicRefillInventoryTreatments, parseHistoricalMedication } from './chronicRefillInventory';

describe('parseHistoricalMedication', () => {
  it('correctly parses various historical medication text formats', () => {
    const case1 = parseHistoricalMedication('阿司匹林肠溶片 100mg*30片 每次100mg 一日一次 口服 30天');
    expect(case1).toEqual({
      dosage: '100',
      dosageUnit: 'mg',
      frequency: '一日一次',
      route: '口服',
      days: '30',
    });

    const case2 = parseHistoricalMedication('二甲双胍片 0.5g*100片 一次1.5片 一日3次');
    expect(case2).toEqual({
      dosage: '1.5',
      dosageUnit: '片',
      frequency: '一日3次',
    });

    const case3 = parseHistoricalMedication('阿莫西林胶囊 共2盒');
    expect(case3).toEqual({
      totalQty: '2',
      totalUnit: '盒',
    });

    const case4 = parseHistoricalMedication('阿莫西林胶囊 2盒');
    expect(case4).toEqual({
      totalQty: '2',
      totalUnit: '盒',
    });
  });
});

describe('buildChronicRefillInventoryTreatments', () => {
  it('keeps only historical medicines that exist in current valid inventory and attaches properties', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '苯磺酸氨氯地平片（5mg*28片） 一次5mg 一日一次 口服 30天 共2盒',
      '厄贝沙坦片 150mg',
    ], [{
      productId: 'med-1',
      productName: '苯磺酸氨氯地平片',
      spec: '5mg*28片/盒',
      unit: '盒',
      manufacturer: '原研制药',
      availableQuantity: 12,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }]);

    expect(treatments).toHaveLength(2);
    expect(treatments[0]).toMatchObject({
      type: 'medicine',
      name: '苯磺酸氨氯地平片',
      selected: true,
      matchStatus: 'exact',
      dosage: '5',
      dosageUnit: 'mg',
      frequency: '一日一次',
      route: '口服',
      days: '30',
      totalQty: '2',
      totalUnit: '盒',
      matchedItem: {
        id: 'med-1',
        manufacturer: '原研制药',
        storeIds: ['1760'],
      },
    });
    expect(treatments[1]).toMatchObject({
      type: 'medicine',
      name: '厄贝沙坦片 150mg',
      selected: false,
      matchStatus: 'unmatched',
      matchedItem: null,
    });
  });

  it('uses the historical product id instead of the first same-name manufacturer', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '苯磺酸氨氯地平片',
    ], [{
      productId: 'med-other-factory',
      productName: '苯磺酸氨氯地平片',
      spec: '5mg*28片/盒',
      manufacturer: '其它制药',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }, {
      productId: 'med-original-factory',
      productName: '苯磺酸氨氯地平片',
      spec: '5mg*28片/盒',
      manufacturer: '原处方制药',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedicationOrders: [{
        productId: 'med-original-factory',
        name: '苯磺酸氨氯地平片',
        spec: '5mg*28片/盒',
        manufacturer: '原处方制药',
      }],
    });

    expect(treatments[0]).toMatchObject({
      name: '苯磺酸氨氯地平片',
      matchStatus: 'exact',
      matchedItem: {
        id: 'med-original-factory',
        manufacturer: '原处方制药',
      },
    });
  });

  it('does not substitute another manufacturer when the historical product is unavailable', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '苯磺酸氨氯地平片',
    ], [{
      productId: 'med-other-factory',
      productName: '苯磺酸氨氯地平片',
      spec: '5mg*28片/盒',
      manufacturer: '其它制药',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedicationOrders: [{
        productId: 'med-original-factory',
        name: '苯磺酸氨氯地平片',
        spec: '5mg*28片/盒',
        manufacturer: '原处方制药',
      }],
    });

    expect(treatments[0]).toMatchObject({
      selected: false,
      matchStatus: 'unmatched',
      matchedItem: null,
    });
  });

  it('uses historical manufacturer to disambiguate same-name inventory without a product id', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '盐酸二甲双胍片',
    ], [{
      productId: 'metformin-a',
      productName: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
      manufacturer: '甲制药',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }, {
      productId: 'metformin-b',
      productName: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
      manufacturer: '乙制药',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedicationOrders: [{
        name: '盐酸二甲双胍片',
        spec: '0.5g*60片/瓶',
        manufacturer: '乙制药',
      }],
    });

    expect(treatments[0].matchedItem).toMatchObject({
      id: 'metformin-b',
      manufacturer: '乙制药',
    });
  });

  it.each([
    ['unmatched first', [
      { name: '盐酸二甲双胍片' },
      { name: '盐酸二甲双胍片', spec: '0.25g*60片/瓶' },
    ]],
    ['matched first', [
      { name: '盐酸二甲双胍片', spec: '0.25g*60片/瓶' },
      { name: '盐酸二甲双胍片' },
    ]],
  ] as const)('removes the redundant unmatched generic-name item when an inventory item is matched (%s)', (_label, inputs) => {
    const treatments = buildChronicRefillInventoryTreatments([
      ...inputs,
      { name: '厄贝沙坦片' },
    ], [{
      productId: 'metformin-025',
      productName: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }, {
      productId: 'metformin-05',
      productName: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }]);

    expect(treatments).toHaveLength(2);
    expect(treatments[0]).toMatchObject({
      name: '盐酸二甲双胍片',
      matchStatus: 'exact',
      matchedItem: { id: 'metformin-025' },
    });
    expect(treatments[1]).toMatchObject({
      name: '厄贝沙坦片',
      matchStatus: 'unmatched',
      matchedItem: null,
    });
  });

  it('keeps distinct matched products even when they share the same normalized name', () => {
    const treatments = buildChronicRefillInventoryTreatments([{
      name: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
    }, {
      name: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
    }], [{
      productId: 'metformin-025',
      productName: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }, {
      productId: 'metformin-05',
      productName: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }]);

    expect(treatments.map((item) => item.matchedItem?.id)).toEqual([
      'metformin-025',
      'metformin-05',
    ]);
  });

  it('uses AI dose and usage hints but rejects model days when history has no duration', () => {
    const treatments = buildChronicRefillInventoryTreatments([{
      name: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      targetDose: '500',
      targetDoseUnit: 'mg',
      frequency: '每日3次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '14',
      totalQty: '2',
      totalUnit: '瓶',
      reason: '糖尿病慢病续方常规方案',
    }], [{
      productId: 'med-metformin',
      productName: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      unit: '瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedications: ['盐酸二甲双胍片（0.25g*60片/瓶）'],
    });

    expect(treatments).toHaveLength(1);
    expect(treatments[0]).toMatchObject({
      name: '盐酸二甲双胍片',
      selected: false,
      targetDose: '500',
      targetDoseUnit: 'mg',
      dosage: '',
      dosageUnit: '',
      frequency: '每日3次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '',
      totalQty: '',
      totalUnit: '',
      reason: '糖尿病慢病续方常规方案',
    });
  });

  it('replaces model arithmetic in the recommendation reason with clinical evidence', () => {
    const treatments = buildChronicRefillInventoryTreatments([{
      name: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      targetDose: '500',
      targetDoseUnit: 'mg',
      frequency: '每天三次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '30',
      totalQty: '3',
      totalUnit: '瓶',
      reason: '单次0.5g即2片，每日3次，30天共需90片',
    }], [{
      productId: 'med-metformin',
      productName: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      unit: '瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedications: ['盐酸二甲双胍片（0.25g*60片/瓶）'],
    });

    expect(treatments[0].reason).toContain('历史处方包含盐酸二甲双胍片');
    expect(treatments[0].reason).not.toContain('90片');
    expect(treatments[0]).toMatchObject({
      targetDose: '500',
      targetDoseUnit: 'mg',
      dosage: '',
      dosageUnit: '',
      frequencyKey: 'TID',
      days: '',
      totalQty: '',
      totalUnit: '',
    });
  });

  it('uses each matched presList medication duration and ignores model 90-day output', () => {
    const treatments = buildChronicRefillInventoryTreatments([{
      name: '阿卡波糖片',
      targetDose: '50',
      targetDoseUnit: 'mg',
      frequency: '每日3次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '90',
    }, {
      name: '盐酸二甲双胍片',
      targetDose: '0.25',
      targetDoseUnit: 'g',
      frequency: '每日3次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '90',
    }], [{
      productId: 'med-acarbose',
      productName: '阿卡波糖片',
      spec: '50mg*30片/盒',
      unit: '盒',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }, {
      productId: 'med-metformin',
      productName: '盐酸二甲双胍片',
      spec: '0.25g*60片/瓶',
      unit: '瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      historicalMedications: ['阿卡波糖片', '盐酸二甲双胍片'],
      historicalMedicationOrders: [{
        orderId: 'order-acarbose',
        productId: 'med-acarbose',
        name: '阿卡波糖片',
        dose: '50',
        doseUnit: 'mg',
        frequency: '每天三次',
        frequencyKey: 'TID',
        route: '口服',
        routeKey: '100',
        days: '14',
        totalQty: '2',
        totalUnit: '盒',
      }, {
        orderId: 'order-metformin',
        productId: 'med-metformin',
        name: '盐酸二甲双胍片',
        dose: '0.25',
        doseUnit: 'g',
        frequency: '每天三次',
        frequencyKey: 'TID',
        route: '口服',
        routeKey: '100',
        days: '30',
        totalQty: '2',
        totalUnit: '瓶',
      }],
    });

    expect(treatments).toEqual([
      expect.objectContaining({
        name: '阿卡波糖片',
        dosage: '50',
        dosageUnit: 'mg',
        days: '14',
        totalQty: '2',
        totalUnit: '盒',
        selected: true,
      }),
      expect.objectContaining({
        name: '盐酸二甲双胍片',
        dosage: '0.25',
        dosageUnit: 'g',
        days: '30',
        totalQty: '2',
        totalUnit: '瓶',
        selected: true,
      }),
    ]);
  });

  it('does not fabricate fixed dosage or duration when prescription fields are unavailable', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '达格列净片 10mg',
    ], [{
      productId: 'med-dapagliflozin',
      productName: '达格列净片',
      spec: '10mg*14片/盒',
      unit: '盒',
      availableQuantity: 10,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }]);

    expect(treatments[0]).toMatchObject({
      selected: false,
      dosage: '',
      dosageUnit: '',
      frequency: '',
      route: '',
      days: '',
      totalQty: '',
      totalUnit: '',
    });
  });

  it('attaches all same-drug prescriptions from the independent history window', () => {
    const treatments = buildChronicRefillInventoryTreatments([
      '盐酸二甲双胍片',
    ], [{
      productId: 'med-metformin',
      productName: '盐酸二甲双胍片',
      spec: '0.5g*60片/瓶',
      unit: '瓶',
      availableQuantity: 20,
      storeIds: ['1760'],
      storeNames: ['西药房'],
    }], undefined, {
      prescriptionHistoryVisits: [{
        visitId: 'acute-visit',
        visitTime: 200,
        diagnoses: ['普通感冒'],
        medicationOrders: [{
          orderId: 'order-2',
          productId: 'med-metformin',
          name: '盐酸二甲双胍片',
          totalQty: '2',
          totalUnit: '瓶',
        }],
      }, {
        visitId: 'chronic-visit',
        visitTime: 100,
        diagnoses: ['糖尿病'],
        medicationOrders: [{
          orderId: 'order-1',
          productId: 'med-metformin',
          name: '盐酸二甲双胍片',
          totalQty: '1',
          totalUnit: '瓶',
        }],
      }],
    });

    expect(treatments[0].recentPrescriptionHistory).toMatchObject({
      lookbackDays: 90,
      matchBasis: 'product-id',
      entries: [
        expect.objectContaining({ orderId: 'order-2', totalQty: '2' }),
        expect.objectContaining({ orderId: 'order-1', totalQty: '1' }),
      ],
    });
  });
});
