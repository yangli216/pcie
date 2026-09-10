export type PhisMedicineOrderServiceCode = '11' | '12';

function normalizeCode(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** PHIS HiBdMed.sdMed: 1=西药、2=中成药；orderList.sdSrv 使用对应的 11/12。 */
export function mapPhisMedicineTypeToServiceCode(
  sdMed: unknown,
): PhisMedicineOrderServiceCode | '' {
  const normalized = normalizeCode(sdMed);
  if (normalized === '1') return '11';
  if (normalized === '2') return '12';
  return '';
}

export function resolvePhisMedicineServiceCode(input: {
  sdMed?: unknown;
  sdSrv?: unknown;
}): string {
  const mappedType = mapPhisMedicineTypeToServiceCode(input.sdMed);
  if (mappedType) return mappedType;

  const explicitServiceCode = normalizeCode(input.sdSrv);
  return mapPhisMedicineTypeToServiceCode(explicitServiceCode) || explicitServiceCode;
}
