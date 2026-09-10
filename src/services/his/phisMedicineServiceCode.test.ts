import { describe, expect, it } from 'vitest';
import {
  mapPhisMedicineTypeToServiceCode,
  resolvePhisMedicineServiceCode,
} from './phisMedicineServiceCode';

describe('PHIS medicine service code', () => {
  it('maps HiBdMed.sdMed to the order service code', () => {
    expect(mapPhisMedicineTypeToServiceCode('1')).toBe('11');
    expect(mapPhisMedicineTypeToServiceCode('2')).toBe('12');
    expect(mapPhisMedicineTypeToServiceCode(2)).toBe('12');
  });

  it('uses sdMed as the source of truth over a stale cached sdSrv', () => {
    expect(resolvePhisMedicineServiceCode({ sdMed: '2', sdSrv: '11' })).toBe('12');
    expect(resolvePhisMedicineServiceCode({ sdMed: '1', sdSrv: '12' })).toBe('11');
  });

  it('supports legacy data that stored sdMed directly in sdSrv', () => {
    expect(resolvePhisMedicineServiceCode({ sdSrv: '1' })).toBe('11');
    expect(resolvePhisMedicineServiceCode({ sdSrv: '2' })).toBe('12');
    expect(resolvePhisMedicineServiceCode({ sdSrv: '11' })).toBe('11');
    expect(resolvePhisMedicineServiceCode({ sdSrv: '12' })).toBe('12');
  });
});
