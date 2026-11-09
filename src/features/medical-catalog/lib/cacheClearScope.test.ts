import { describe, expect, it } from 'vitest';
import { resolveCacheClearScope } from './cacheClearScope';

describe('resolveCacheClearScope', () => {
  it('clears every scope when org, tenant and store are all blank', () => {
    expect(resolveCacheClearScope({ catalogType: 'all', orgCode: ' ', tenantId: '', storeId: '' })).toEqual({
      ok: true,
      options: { catalogType: 'all', allScopes: true },
      scopeLabel: '所有机构',
    });
  });

  it('requires tenant together with org so the current tenant is never mixed in', () => {
    const result = resolveCacheClearScope({ catalogType: 'items', orgCode: 'ORG-1', tenantId: '', storeId: '' });
    expect(result.ok).toBe(false);
  });

  it('rejects tenant or store without org', () => {
    expect(resolveCacheClearScope({ catalogType: 'medicines', orgCode: '', tenantId: 'T-1', storeId: '' }).ok).toBe(false);
    expect(resolveCacheClearScope({ catalogType: 'medicines', orgCode: '', tenantId: '', storeId: 'S-1' }).ok).toBe(false);
  });

  it('only accepts a store for the medicine catalog', () => {
    const result = resolveCacheClearScope({ catalogType: 'all', orgCode: 'ORG-1', tenantId: 'T-1', storeId: 'S-1' });
    expect(result.ok).toBe(false);
  });

  it('passes a trimmed explicit org, tenant and store scope', () => {
    expect(resolveCacheClearScope({ catalogType: 'medicines', orgCode: ' ORG-1 ', tenantId: ' T-1', storeId: 'S-1 ' })).toEqual({
      ok: true,
      options: { catalogType: 'medicines', orgCode: 'ORG-1', tenantId: 'T-1', storeId: 'S-1' },
      scopeLabel: '机构：ORG-1，租户：T-1，药房：S-1',
    });
  });
});
