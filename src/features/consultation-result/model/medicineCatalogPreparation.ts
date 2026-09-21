import type { HisAdapter } from '@/services/his';

/** Only coalesce active preparation; freshness and retry belong to the catalog service. */
export function createMedicineCatalogPreparation(
  load: (storeIds: string[], adapter: HisAdapter) => Promise<void>,
) {
  const inFlight = new Map<string, Promise<void>>();

  return (storeIds: string[], adapter: HisAdapter): Promise<void> => {
    const stores = [...new Set(storeIds.map((id) => id.trim()).filter(Boolean))].sort();
    const scope = adapter.getContextScope();
    const key = JSON.stringify([adapter.vendor, scope.orgCode, scope.tenantId, stores]);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const request = Promise.resolve()
      .then(() => load(stores, adapter))
      .finally(() => { inFlight.delete(key); });
    inFlight.set(key, request);
    return request;
  };
}
