import type { HisMedicalItemCatalogItem } from './hisService';

/** PHIS `queryHiBdCliOrgList` 单条机构诊疗项目（只列出本客户端使用的字段）。 */
export interface HiBdCliOrgItem {
  id?: string;
  idCli?: string;
  naCli?: string;
  sdCli?: string;
  sdCliText?: string;
  py?: string;
  fgActive?: string;
  naCstmg?: string;
  sdSrv?: string;
  idDeptExec?: string;
  idPart?: string;
  jsonField?: string;
  fgCheckOrd?: string;
  idLisCategory?: string;
  fgCombination?: string;
}

export interface HiBdCliOrgListBody {
  start?: number;
  limit?: number;
  total?: number;
  items?: HiBdCliOrgItem[];
}

/** 与 bfd4b04 之前的机构诊疗目录映射保持一致：文本优先，其次 sdCli 编码，其余归为“治疗”。 */
export function mapCliCategory(sdCliText?: string, sdCli?: string): string {
  const text = sdCliText?.trim();
  if (text) {
    if (text.includes('检验')) return '检验';
    if (text.includes('检查')) return '检查';
    return '治疗';
  }
  if (sdCli?.trim() === '1') return '检查';
  if (sdCli?.trim() === '2') return '检验';
  return '治疗';
}

function buildJsonField(idLisCategory?: string, fgCombination?: string): string {
  const payload: Record<string, string> = {};
  if (idLisCategory) payload.idLisCategory = idLisCategory;
  if (fgCombination) payload.fgCombination = fgCombination;
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : '';
}

/**
 * 把 PHIS 机构诊疗目录转换为“治疗 / 处置”类诊疗项目。
 * 停用项、无名称项和检查 / 检验项一律丢弃：检查检验只来自接诊级实时目录，不得由此写入缓存。
 */
export function normalizeTreatmentCatalogItems(items: HiBdCliOrgItem[]): HisMedicalItemCatalogItem[] {
  const normalized = new Map<string, HisMedicalItemCatalogItem>();
  items.forEach((item) => {
    if (item.fgActive === '0') return;
    const name = item.naCli?.trim() || '';
    if (!name) return;
    const sdCliText = item.sdCliText?.trim() || '';
    const category = mapCliCategory(sdCliText, item.sdCli);
    if (category === '检查' || category === '检验') return;

    const id = item.id?.trim() || item.idCli?.trim() || name;
    if (normalized.has(id)) return;
    const keywords = Array.from(new Set(
      [item.py?.trim(), item.naCstmg?.trim(), sdCliText].filter((part): part is string => Boolean(part)),
    ));
    normalized.set(id, {
      id,
      code: item.idCli?.trim() || id,
      name,
      category,
      keywords: keywords.length > 0 ? keywords : undefined,
      idSrv: id,
      naSrv: name,
      sdSrv: item.sdSrv?.trim() || '51',
      idDeptExec: item.idDeptExec?.trim() || '',
      idPart: item.idPart?.trim() || '',
      jsonField: item.jsonField?.trim() || buildJsonField(item.idLisCategory?.trim(), item.fgCombination?.trim()),
      fgCheckOrd: item.fgCheckOrd?.trim() || '1',
      raw: item as unknown as Record<string, unknown>,
    });
  });
  return Array.from(normalized.values());
}
