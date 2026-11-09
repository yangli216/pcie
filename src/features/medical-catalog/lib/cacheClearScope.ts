import type { MedicalCatalogClearOptions } from '@services/medicalData';

export type CatalogClearType = NonNullable<MedicalCatalogClearOptions['catalogType']>;

export interface CacheClearScopeInput {
  catalogType: CatalogClearType;
  orgCode: string;
  tenantId: string;
  storeId: string;
}

export type CacheClearScopeResult =
  | { ok: true; options: MedicalCatalogClearOptions; scopeLabel: string }
  | { ok: false; error: string };

/**
 * 把缓存管理面板的输入转换为清理选项。
 *
 * - 机构 / 租户 / 药房均留空：清理所选目录在所有机构范围下的缓存（allScopes）。
 * - 按机构清理：机构与租户须同时填写，缓存按机构 + 租户落库，缺一会漏删或误删。
 * - 药房只对药品生效，且须先填写机构与租户。
 */
export function resolveCacheClearScope(input: CacheClearScopeInput): CacheClearScopeResult {
  const orgCode = input.orgCode.trim();
  const tenantId = input.tenantId.trim();
  const storeId = input.storeId.trim();

  if (!orgCode && !tenantId && !storeId) {
    return {
      ok: true,
      options: { catalogType: input.catalogType, allScopes: true },
      scopeLabel: '所有机构',
    };
  }

  if (!orgCode || !tenantId) {
    return { ok: false, error: '按机构清理时请同时填写机构和租户；留空三项则清理所有机构。' };
  }

  if (storeId && input.catalogType !== 'medicines') {
    return { ok: false, error: '药房仅适用于药品目录，请清空药房或将清理范围切换为药品目录。' };
  }

  const options: MedicalCatalogClearOptions = { catalogType: input.catalogType, orgCode, tenantId };
  const parts = [`机构：${orgCode}`, `租户：${tenantId}`];
  if (storeId) {
    options.storeId = storeId;
    parts.push(`药房：${storeId}`);
  }
  return { ok: true, options, scopeLabel: parts.join('，') };
}
