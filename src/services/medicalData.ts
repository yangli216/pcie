import { invoke } from '@tauri-apps/api/core';
import { getHisAdapter, type HisAdapter } from './his';
import type {
  DiagnosisCatalogEntry,
  MedicalItemCatalogEntry,
  MedicineCatalogEntry,
} from './his';
import { regionalGet } from './regionalClient';
import {
  adjustRestrictedMedicalItemScore,
  explicitlyRequestsRestrictedMedicalItem,
  isRestrictedMedicalCatalogItem,
} from './medicalCatalogPolicy';
import {
  assessDiagnosisCatalogMatch,
  type DiagnosisCatalogAssessment,
} from './diagnosisCatalogMatch';

export interface DiagnosisItem {
  id: string;
  code: string;
  name: string;
  keywords?: string[];
}

export interface TCMDiagnosisItem {
  id: string;
  code: string;
  name: string;
  keywords?: string[];
}

export interface TCMSyndromeItem {
  id: string;
  code: string;
  name: string;
  keywords?: string[];
}

export interface TCMTreatmentItem {
  id: string;
  code: string;
  name: string;
  keywords?: string[];
}

export interface MedicineItem {
  id: string;
  name: string;
  spec: string;
  idSrv?: string;
  naSrv?: string;
  sdSrv?: string;
  idDeptExec?: string;
  fgCheckOrd?: string;
  fgSkintest?: string;
  /** 该药品在哪些发药药房（idSto）目录中出现。为空表示未标注药房，不参与药品匹配 */
  storeIds?: string[];
  raw?: Record<string, unknown>;
}

export interface MedicalItem {
  id: string;
  code: string;
  name: string;
  category: string;
  keywords?: string[];
  idSrv?: string;
  naSrv?: string;
  sdSrv?: string;
  idDeptExec?: string;
  idPart?: string;
  jsonField?: string;
  fgCheckOrd?: string;
  unitPrice?: number;
  restricted?: boolean;
  restrictionReason?: string;
  /** 检验检查互认编码；空字符串表示该项目不参与互认。 */
  mutualRecognitionCode?: string;
  raw?: Record<string, unknown>;
}

export interface MedicalCatalog {
  diagnoses: DiagnosisItem[];
  tcmDiagnoses: TCMDiagnosisItem[];
  tcmSyndromes: TCMSyndromeItem[];
  tcmTreatments: TCMTreatmentItem[];
  medicines: MedicineItem[];
  items: MedicalItem[];
}

export interface Icd10CategoryInfo {
  key: string;
  range: string;
  title: string;
  order: number;
}

export interface MedicalCatalogContext {
  orgCode?: string | null;
  tenantId?: string | null;
}

interface MedicalCatalogSnapshot {
  diagnoses: DiagnosisItem[];
  diagnosisSyncedAt?: number | null;
  items: MedicalItem[];
  itemSyncDate?: string | null;
  medicines: MedicineItem[];
  medicineSyncDate?: string | null;
}

export interface MedicalCatalogDebugState {
  dbPath: string;
  diagnosisCount: number;
  itemCount: number;
  medicineCount: number;
  syncStates: Array<{
    catalogType: string;
    orgCode: string;
    tenantId?: string | null;
    storeId?: string | null;
    lastSyncAt: number;
    syncDate?: string | null;
    rowCount: number;
  }>;
}

export interface MedicalCatalogClearOptions {
  catalogType?: 'all' | 'diagnoses' | 'items' | 'medicines';
  orgCode?: string;
  tenantId?: string;
  storeId?: string;
}

interface MedicalCatalogSyncOptions {
  force?: boolean;
}

export interface MedicalCatalogClearResult {
  diagnosisRows: number;
  itemRows: number;
  medicineRows: number;
  syncStateRows: number;
}

interface MatchVariant {
  normalized: string;
  weight: number;
  normalizedRoutineAlias: string;
}

interface ScoredCandidate<T> {
  item: T;
  score: number;
  primaryScore: number;
}

interface RoutineMatchDescriptor {
  alias: string;
  classificationRank: number | null;
  hasClassification: boolean;
}

function isExamOrLabItem(item: Pick<MedicalItem, 'category'>): boolean {
  return item.category === '检查' || item.category === '检验';
}

export type CatalogMatchStatus = 'exact' | 'probable' | 'unmatched';

export interface CatalogMatchAssessment<T> {
  status: CatalogMatchStatus;
  candidate: T | null;
  confidence: number;
}

const ICD10_CATEGORY_GROUPS: Icd10CategoryInfo[] = [
  { key: 'A00-B99', range: 'A00-B99', title: '某些传染病和寄生虫病', order: 1 },
  { key: 'C00-D48', range: 'C00-D48', title: '肿瘤', order: 2 },
  { key: 'D50-D89', range: 'D50-D89', title: '血液和造血器官疾病及某些涉及免疫机制的疾患', order: 3 },
  { key: 'E00-E90', range: 'E00-E90', title: '内分泌、营养和代谢疾病', order: 4 },
  { key: 'F00-F99', range: 'F00-F99', title: '精神和行为障碍', order: 5 },
  { key: 'G00-G99', range: 'G00-G99', title: '神经系统疾病', order: 6 },
  { key: 'H00-H59', range: 'H00-H59', title: '眼和附器疾病', order: 7 },
  { key: 'H60-H95', range: 'H60-H95', title: '耳和乳突疾病', order: 8 },
  { key: 'I00-I99', range: 'I00-I99', title: '循环系统疾病', order: 9 },
  { key: 'J00-J99', range: 'J00-J99', title: '呼吸系统疾病', order: 10 },
  { key: 'K00-K93', range: 'K00-K93', title: '消化系统疾病', order: 11 },
  { key: 'L00-L99', range: 'L00-L99', title: '皮肤和皮下组织疾病', order: 12 },
  { key: 'M00-M99', range: 'M00-M99', title: '肌肉骨骼系统和结缔组织疾病', order: 13 },
  { key: 'N00-N99', range: 'N00-N99', title: '泌尿生殖系统疾病', order: 14 },
  { key: 'O00-O99', range: 'O00-O99', title: '妊娠、分娩和产褥期', order: 15 },
  { key: 'P00-P96', range: 'P00-P96', title: '起源于围生期的某些情况', order: 16 },
  { key: 'Q00-Q99', range: 'Q00-Q99', title: '先天性畸形、变形和染色体异常', order: 17 },
  { key: 'R00-R99', range: 'R00-R99', title: '症状、体征和临床与实验室异常所见，不可归类在他处者', order: 18 },
  { key: 'S00-T98', range: 'S00-T98', title: '损伤、中毒和外因的某些其他后果', order: 19 },
  { key: 'V01-Y98', range: 'V01-Y98', title: '疾病和死亡的外因', order: 20 },
  { key: 'Z00-Z99', range: 'Z00-Z99', title: '影响健康状态和与保健机构接触的因素', order: 21 },
  { key: 'U00-U99', range: 'U00-U99', title: '用于特殊目的的编码', order: 22 }
];

/**
 * 从规格字符串中提取有效成分含量并归一化为 mg。
 * 示例: "0.25g" → 250, "10mg" → 10, "500ug" → 0.5, "250mg/5ml" → 250, "0.25g*24粒/盒" → 250
 * 无法识别时返回 null。
 */
function extractSpecStrengthMg(spec: string | undefined | null): number | null {
  if (!spec) return null;
  const normalized = spec.trim();
  if (!normalized) return null;

  // 匹配常见规格模式: "0.25g", "10mg", "500ug", "250mg/5ml", "0.25g*24粒/盒", "0.5g/粒"
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(g|mg|ug|μg|毫克|克|微克)/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  if (isNaN(value) || value <= 0) return null;

  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'g':
    case '克':
      return value * 1000;
    case 'mg':
    case '毫克':
      return value;
    case 'ug':
    case 'μg':
    case '微克':
      return value / 1000;
    default:
      return null;
  }
}

class MedicalDataService {
  private static readonly PROBABLE_MATCH_THRESHOLD = 0.86;
  private static readonly PROBABLE_MATCH_MARGIN = 0.08;
  private static readonly DATA_CACHE_KEY = 'REGIONAL_MEDICAL_DATA_CACHE';
  private static readonly DATA_VERSION_KEY = 'REGIONAL_MEDICAL_DATA_VERSION';

  private catalog: MedicalCatalog;
  private currentOrgCode: string | null = null;
  private currentTenantId: string | null = null;
  private localSyncPromise: Promise<void> | null = null;
  private availableExamLabCache: { key: string; items: MedicalItem[] } | null = null;
  private availableExamLabPromise: Promise<MedicalItem[]> | null = null;
  private availableExamLabPromiseKey = '';
  private availableExamLabGeneration = 0;
  private availableExamLabReceptionKey = '';
  private activeMedicineStoreIds: Set<string> | null = null;
  /** 仅匹配这些有真实库存的药品 productId；null 表示不启用过滤 */
  private activeInStockProductIds: Set<string> | null = null;

  constructor() {
    this.catalog = {
      diagnoses: [],
      tcmDiagnoses: [],
      tcmSyndromes: [],
      tcmTreatments: [],
      medicines: [],
      items: []
    };

    this.restoreFromCache();
  }

  private parseKeywords(str?: string): string[] | undefined {
    if (!str) return undefined;
    return str.split('|').map(s => s.trim()).filter(Boolean);
  }

  private parseCSV(content: string): Record<string, string>[] {
    const lines = content.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = this.parseCSVLine(lines[0]);
    const result: Record<string, string>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = this.parseCSVLine(line);
      // Allow for some leniency in trailing commas or missing fields
      const obj: Record<string, string> = {};
      headers.forEach((header, index) => {
        obj[header] = values[index] || '';
      });
      result.push(obj);
    }
    return result;
  }

  private parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (inQuote) {
        if (char === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            // Escaped quote
            current += '"';
            i++;
          } else {
            inQuote = false;
          }
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuote = true;
        } else if (char === ',') {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current.trim());
    return result;
  }

  private normalizeScopeValue(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private buildCatalogScopePayload(storeIds?: string[] | null): {
    orgCode?: string;
    tenantId?: string;
    storeIds?: string[];
  } {
    const payload: {
      orgCode?: string;
      tenantId?: string;
      storeIds?: string[];
    } = {};

    if (this.currentOrgCode) {
      payload.orgCode = this.currentOrgCode;
    }
    if (this.currentTenantId) {
      payload.tenantId = this.currentTenantId;
    }

    const normalizedStoreIds = this.normalizeStoreIds(storeIds);
    if (normalizedStoreIds.length > 0) {
      payload.storeIds = normalizedStoreIds;
    }

    return payload;
  }

  private getTodayTag(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private resetOrgScopedCatalogs(): void {
    this.catalog.items = [];
    this.catalog.medicines = [];
  }

  private async loadPersistedCatalogSnapshot(): Promise<MedicalCatalogSnapshot | null> {
    try {
      return await invoke<MedicalCatalogSnapshot>('load_medical_catalog_snapshot', this.buildCatalogScopePayload());
    } catch {
      console.warn('[MedicalData] Failed to load SQLite catalog snapshot');
      return null;
    }
  }

  private applyPersistedCatalogSnapshot(snapshot: MedicalCatalogSnapshot | null): void {
    if (!snapshot) {
      return;
    }

    if (snapshot.diagnoses.length > 0) {
      this.catalog.diagnoses = this.normalizeDiagnosisItems(snapshot.diagnoses);
      console.log('[MedicalData] Diagnosis cache restored from SQLite', {
        itemCount: snapshot.diagnoses.length,
      });
    }

    const currentReceptionItems = this.catalog.items.filter(isExamOrLabItem);
    this.resetOrgScopedCatalogs();

    if (!this.currentOrgCode) {
      return;
    }

    const persistedItems = this.normalizeMedicalItems(snapshot.items).filter((item) => !isExamOrLabItem(item));
    this.catalog.items = [...currentReceptionItems, ...persistedItems];
    if (persistedItems.length > 0) {
      console.log('[MedicalData] Non-exam/lab item cache restored from SQLite', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        itemCount: persistedItems.length,
        hasSyncDate: Boolean(snapshot.itemSyncDate),
      });
    }

    if (snapshot.medicines.length > 0) {
      this.catalog.medicines = this.normalizeMedicineItems(snapshot.medicines);
      console.log('[MedicalData] Medicine cache restored from SQLite', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        itemCount: snapshot.medicines.length,
        hasSyncDate: Boolean(snapshot.medicineSyncDate),
      });
    }
  }

  private async persistDiagnosisCatalog(items: DiagnosisItem[]): Promise<void> {
    await invoke('replace_diagnosis_catalog', { items });
    console.log('[MedicalData] Diagnosis catalog persisted to SQLite', {
      itemCount: items.length,
    });
  }

  private async persistMedicalItemCatalog(
    orgCode: string,
    tenantId: string | null,
    items: MedicalItem[],
    syncDate: string
  ): Promise<void> {
    const persistableItems = items.filter((item) => !isExamOrLabItem(item));
    await invoke('replace_org_medical_item_catalog', {
      orgCode,
      tenantId,
      items: persistableItems,
      syncDate,
    });
    console.log('[MedicalData] Non-exam/lab items persisted to SQLite', {
      hasOrgCode: Boolean(orgCode),
      hasTenantId: Boolean(tenantId),
      itemCount: persistableItems.length,
      hasSyncDate: Boolean(syncDate),
    });
  }

  private async persistMedicineCatalog(
    orgCode: string,
    tenantId: string | null,
    storeIds: string[] | null | undefined,
    items: MedicineItem[],
    syncDate: string
  ): Promise<void> {
    // 后端仅读 id/code/name/spec/storeIds，显式裁剪减小 IPC payload
    const payload = items.map((item) => ({
      id: item.id,
      code: undefined as string | undefined,
      name: item.name,
      spec: item.spec,
      storeIds: Array.isArray(item.storeIds) ? Array.from(new Set(item.storeIds.filter(Boolean))) : [],
    }));
    await invoke('replace_org_medicine_catalog', {
      orgCode,
      tenantId,
      storeIds: this.normalizeStoreIds(storeIds),
      items: payload,
      syncDate,
    });
    console.log('[MedicalData] Medicine catalog persisted to SQLite', {
      hasOrgCode: Boolean(orgCode),
      hasTenantId: Boolean(tenantId),
      storeCount: this.normalizeStoreIds(storeIds).length,
      itemCount: items.length,
      hasSyncDate: Boolean(syncDate),
    });
  }

  public getAllDiagnoses(): DiagnosisItem[] {
    return this.catalog.diagnoses;
  }

  public getAllTCMDiagnoses(): TCMDiagnosisItem[] {
    return this.catalog.tcmDiagnoses;
  }

  public getAllTCMSyndromes(): TCMSyndromeItem[] {
    return this.catalog.tcmSyndromes;
  }

  public getAllTCMTreatments(): TCMTreatmentItem[] {
    return this.catalog.tcmTreatments;
  }

  public getAllMedicines(): MedicineItem[] {
    return this.catalog.medicines;
  }

  public getAllItems(): MedicalItem[] {
    return this.catalog.items;
  }

  public getCatalogContext(): Required<MedicalCatalogContext> {
    return {
      orgCode: this.currentOrgCode,
      tenantId: this.currentTenantId,
    };
  }

  public getAllIcd10CategoryGroups(): Icd10CategoryInfo[] {
    return [...ICD10_CATEGORY_GROUPS];
  }

  public async setCatalogContext(
    context: MedicalCatalogContext,
    options: MedicalCatalogSyncOptions = {}
  ): Promise<void> {
    const nextOrgCode = this.normalizeScopeValue(context.orgCode);
    const nextTenantId = this.normalizeScopeValue(context.tenantId);
    const orgChanged = nextOrgCode !== this.currentOrgCode;
    const tenantChanged = nextTenantId !== this.currentTenantId;
    console.log('[MedicalData] setCatalogContext', {
      hadOrgCode: Boolean(this.currentOrgCode),
      hadTenantId: Boolean(this.currentTenantId),
      hasOrgCode: Boolean(nextOrgCode),
      hasTenantId: Boolean(nextTenantId),
      orgChanged,
      tenantChanged,
    });

    this.currentOrgCode = nextOrgCode;
    this.currentTenantId = nextTenantId;

    if (orgChanged || tenantChanged) {
      this.clearAvailableExamLabItems();
      this.resetOrgScopedCatalogs();
    }

    await this.ensureLocalCatalogsSynced(options);
  }

  /**
   * 直接查询当前 PHIS 用户上下文可开立的检查/检验项目。
   * 不使用持久化目录；缓存键包含默认科室，并只在当前接诊生命周期内复用。
   */
  public async fetchAvailableExamLabItems(options: { force?: boolean } = {}): Promise<MedicalItem[]> {
    const hisService = getHisAdapter();
    if (!hisService) {
      throw new Error('HIS 尚未初始化，无法查询可用检验检查目录');
    }
    const scope = hisService.getContextScope();
    const orgCode = scope.orgCode?.trim() || this.currentOrgCode || '';
    const tenantId = scope.tenantId?.trim() || this.currentTenantId || '';
    const deptId = hisService.getDefaultExecDeptId().trim();
    const cacheKey = `${orgCode}|${tenantId}|${deptId}`;
    if (!options.force
      && this.availableExamLabCache?.key === cacheKey) {
      return [...this.availableExamLabCache.items];
    }
    if (this.availableExamLabPromise && this.availableExamLabPromiseKey === cacheKey) {
      return this.availableExamLabPromise;
    }

    // 新接口失败时也不能回退到机构通用项目，否则会把“存在”误当成“当前可开立”。
    this.catalog.items = this.catalog.items.filter((item) => !isExamOrLabItem(item));
    this.availableExamLabCache = null;
    const requestGeneration = this.availableExamLabGeneration;
    this.availableExamLabPromiseKey = cacheKey;
    const requestPromise = (async () => {
      const items = this.normalizeMedicalItems(
        await hisService.fetchInstitutionMedicalItemsCatalog(orgCode),
      ).filter(isExamOrLabItem);
      if (requestGeneration !== this.availableExamLabGeneration) {
        return [];
      }
      this.catalog.items = [
        ...this.catalog.items.filter((item) => !isExamOrLabItem(item)),
        ...items,
      ];
      this.availableExamLabCache = { key: cacheKey, items };
      return [...items];
    })();
    this.availableExamLabPromise = requestPromise;
    return requestPromise.finally(() => {
      if (this.availableExamLabPromise === requestPromise) {
        this.availableExamLabPromise = null;
        this.availableExamLabPromiseKey = '';
      }
    });
  }

  /** 开始一次新的接诊目录生命周期：丢弃上一接诊结果并强制获取当前可开立目录。 */
  public beginAvailableExamLabReception(receptionKey = ''): Promise<MedicalItem[]> {
    const normalizedReceptionKey = receptionKey.trim();
    if (normalizedReceptionKey
      && normalizedReceptionKey === this.availableExamLabReceptionKey
      && (this.availableExamLabCache || this.availableExamLabPromise)) {
      return this.fetchAvailableExamLabItems();
    }
    this.clearAvailableExamLabItems();
    this.availableExamLabReceptionKey = normalizedReceptionKey;
    return this.fetchAvailableExamLabItems({ force: true });
  }

  /** 结束接诊或 HIS scope 变化时清除检查检验内存目录，并使迟到响应失效。 */
  public clearAvailableExamLabItems(): void {
    this.availableExamLabGeneration += 1;
    this.availableExamLabCache = null;
    this.availableExamLabPromise = null;
    this.availableExamLabPromiseKey = '';
    this.availableExamLabReceptionKey = '';
    this.catalog.items = this.catalog.items.filter((item) => !isExamOrLabItem(item));
  }

  public async ensureLocalCatalogsSynced(options: MedicalCatalogSyncOptions = {}): Promise<void> {
    const forceSync = options.force === true;

    const snapshot = await this.loadPersistedCatalogSnapshot();
    this.applyPersistedCatalogSnapshot(snapshot);

    if (!forceSync) {
      console.log('[MedicalData] Local HIS catalog sync skipped in server-managed mode');
      return;
    }

    const hisService = getHisAdapter();
    if (!hisService) {
      if (forceSync) {
        throw new Error('未检测到有效的 HIS 握手上下文，请先从 HIS 页面发起一次有效握手后再强制同步');
      }
      console.warn('[MedicalData] HisAdapter not ready, skip local catalog sync');
      return;
    }

    if (forceSync && !this.currentOrgCode) {
      throw new Error('缺少有效的握手机构上下文，请先完成 HIS 握手后再强制同步');
    }

    if (!this.localSyncPromise) {
      console.log('[MedicalData] Start local catalog sync', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        forceSync,
      });
      this.localSyncPromise = this.syncLocalCatalogs(hisService, snapshot, options).finally(() => {
        console.log('[MedicalData] Local catalog sync finished', {
          hasOrgCode: Boolean(this.currentOrgCode),
          hasTenantId: Boolean(this.currentTenantId),
          forceSync,
        });
        this.localSyncPromise = null;
      });
    } else {
      console.log('[MedicalData] Reuse in-flight local catalog sync', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        forceSync,
      });
    }

    await this.localSyncPromise;
  }

  public async getDebugState(): Promise<MedicalCatalogDebugState> {
    return invoke<MedicalCatalogDebugState>('get_medical_catalog_debug_state');
  }

  public async clearDebugCache(options: MedicalCatalogClearOptions = {}): Promise<MedicalCatalogClearResult> {
    const normalizedOrgCode = this.normalizeScopeValue(options.orgCode ?? this.currentOrgCode);
    const normalizedTenantId = this.normalizeScopeValue(options.tenantId ?? this.currentTenantId);
    const normalizedStoreId = this.normalizeScopeValue(options.storeId);
    const result = await invoke<MedicalCatalogClearResult>('clear_medical_catalog_cache', {
      catalogType: options.catalogType ?? 'all',
      orgCode: normalizedOrgCode ?? undefined,
      tenantId: normalizedTenantId ?? undefined,
      storeId: normalizedStoreId ?? undefined,
    });

    if (!options.catalogType || options.catalogType === 'all' || options.catalogType === 'diagnoses') {
      this.catalog.diagnoses = [];
    }
    if (!options.catalogType || options.catalogType === 'all' || options.catalogType === 'items') {
      this.catalog.items = [];
    }
    if (!options.catalogType || options.catalogType === 'all' || options.catalogType === 'medicines') {
      this.catalog.medicines = [];
    }

    return result;
  }

  /**
   * Assess an AI diagnosis against the current HIS catalog without silently
   * accepting modifier conflicts or broader/narrower disease names.
   */
  public assessDiagnosisMatch(
    queryName: string,
    context?: { icdCode?: string },
  ): DiagnosisCatalogAssessment<DiagnosisItem> {
    return assessDiagnosisCatalogMatch({
      queryName,
      icdCode: context?.icdCode,
      catalog: this.catalog.diagnoses,
    });
  }

  /**
   * Compatibility wrapper for callers that can only represent a safe automatic
   * match. Near matches must use assessDiagnosisMatch and explicit confirmation.
   */
  public matchDiagnosis(query: string, context?: { icdCode?: string }): DiagnosisItem | null {
    const assessment = this.assessDiagnosisMatch(query, context);
    return assessment.status === 'exact' ? assessment.matchedItem : null;
  }

  /**
   * Get related diagnoses by ICD10 code prefix
   * @param code ICD10 code
   */
  public getRelatedDiagnoses(code: string): DiagnosisItem[] {
    if (!code) return [];
    // Use the first 3 characters as the prefix (e.g. "J06" from "J06.9")
    // If the code is shorter than 3 chars, use it as is.
    const prefix = code.split('.')[0];
    if (!prefix) return [];

    return this.catalog.diagnoses.filter(d => d.code.startsWith(prefix));
  }

  public extractIcd10CategoryCode(code: string): string | null {
    if (!code) return null;
    const normalized = code.trim().toUpperCase();
    const match = normalized.match(/[A-Z][0-9]{2}/);
    return match ? match[0] : null;
  }

  public getIcd10CategoryInfo(code: string): Icd10CategoryInfo | null {
    const categoryCode = this.extractIcd10CategoryCode(code);
    if (!categoryCode) return null;

    return ICD10_CATEGORY_GROUPS.find(group => {
      const [start, end] = group.range.split('-');
      return this.isIcd10CategoryInRange(categoryCode, start, end);
    }) || null;
  }

  /**
   * Find best matching TCM diagnosis
   * @param query AI output string (e.g., "感冒 - 风寒束表证" or "感冒")
   */
  public matchTCMDiagnosis(query: string): TCMDiagnosisItem | null {
    if (!query) return null;
    const normalizedQuery = query.trim().toLowerCase();

    // Extract disease name from "disease - syndrome" format
    // e.g., "感冒 - 风寒束表证" -> "感冒"
    const diseaseName = normalizedQuery.split('-')[0].trim();

    // 1. Exact match (name or code)
    const exact = this.catalog.tcmDiagnoses.find(d =>
      d.name.toLowerCase() === normalizedQuery ||
      d.name.toLowerCase() === diseaseName ||
      d.code.toLowerCase() === normalizedQuery
    );
    if (exact) return exact;

    // 2. Code prefix match
    const codeMatches = this.catalog.tcmDiagnoses.filter(d =>
      d.code.toLowerCase().startsWith(normalizedQuery)
    );

    if (codeMatches.length > 0) {
      codeMatches.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
      return codeMatches[0];
    }

    // 3. Best fuzzy match
    let bestMatch: TCMDiagnosisItem | null = null;
    let maxScore = 0;

    for (const item of this.catalog.tcmDiagnoses) {
      // Try matching both full query and disease name
      const fullScore = this.calculateScore(normalizedQuery, item.name, item.keywords);
      const diseaseScore = this.calculateScore(diseaseName, item.name, item.keywords);
      const score = Math.max(fullScore, diseaseScore);

      if (score > maxScore) {
        maxScore = score;
        bestMatch = item;
      }
    }

    // Threshold for acceptance
    return maxScore > 0.3 ? bestMatch : null;
  }

  /**
   * Get related TCM diagnoses by code prefix
   * @param code TCM diagnosis code (e.g., "A01.01.01")
   */
  public getRelatedTCMDiagnoses(code: string): TCMDiagnosisItem[] {
    if (!code) return [];
    // Use the first two segments as prefix (e.g., "A01.01" from "A01.01.01")
    const parts = code.split('.');
    const prefix = parts.slice(0, Math.max(2, parts.length - 1)).join('.');
    if (!prefix) return [];

    return this.catalog.tcmDiagnoses.filter(d => d.code.startsWith(prefix));
  }

  /**
   * Find best matching medicine
   * @param query AI output string
   */
  public matchMedicine(query: string, aliases?: string[]): MedicineItem | null {
    return this.matchMedicineByVariants(query, aliases);
  }

  /**
  * 设定当前可用的发药药房集合（idSto），用于把药品匹配限定到这些药房的目录范围内。
   * 传入空数组或 null 表示当前没有可用药房，不使用 CSV 药品兜底。
   */
  public setActivePharmacyStoreIds(storeIds: string[] | null | undefined): void {
    const normalized = this.normalizeStoreIds(storeIds);
    if (normalized.length === 0) {
      this.activeMedicineStoreIds = new Set();
      return;
    }
    this.activeMedicineStoreIds = new Set(normalized);
  }

  /**
   * 设定当前拥有真实库存（availableQuantity > 0）的药品 productId 范围。
   * 传入 null 或 undefined 表示不启用该过滤（如系统初始化或单机故障时）。
   */
  public setActiveInStockProductIds(productIds: string[] | null | undefined): void {
    if (!productIds) {
      this.activeInStockProductIds = null;
      return;
    }
    this.activeInStockProductIds = new Set(
      productIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    );
  }

  private normalizeStoreIds(storeIds: string[] | null | undefined): string[] {
    if (!storeIds || storeIds.length === 0) {
      return [];
    }

    return Array.from(new Set(
      storeIds
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value): value is string => Boolean(value))
    ));
  }

  public async ensureMedicineCatalogForStoreIds(
    storeIds: string[] | null | undefined,
    hisService?: HisAdapter | null
  ): Promise<void> {
    const normalizedStoreIds = this.normalizeStoreIds(storeIds);
    this.setActivePharmacyStoreIds(normalizedStoreIds);

    if (normalizedStoreIds.length === 0) {
      return;
    }

    const today = this.getTodayTag();
    let snapshot: MedicalCatalogSnapshot | null = null;

    console.log('[MedicalData] Ensure medicine catalog for active pharmacy storeIds', {
      hasOrgCode: Boolean(this.currentOrgCode),
      hasTenantId: Boolean(this.currentTenantId),
      storeCount: normalizedStoreIds.length,
    });

    try {
      snapshot = await invoke<MedicalCatalogSnapshot>('load_medical_catalog_snapshot', this.buildCatalogScopePayload(normalizedStoreIds));
    } catch {
      console.warn('[MedicalData] Failed to load pharmacy-scoped medicine cache', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
      });
    }

    if (snapshot?.medicines.length) {
      this.catalog.medicines = this.normalizeMedicineItems(snapshot.medicines);
      console.log('[MedicalData] Medicine cache restored by active pharmacy storeIds', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
        itemCount: snapshot.medicines.length,
        hasSyncDate: Boolean(snapshot.medicineSyncDate),
      });
    }

    if (snapshot?.medicines.length && snapshot.medicineSyncDate === today) {
      return;
    }

    if (!snapshot?.medicines.length) {
      console.warn('[MedicalData] Pharmacy-scoped medicine cache is empty, refreshing from HIS', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
      });
    }

    const adapter = hisService ?? getHisAdapter();
    if (!adapter) {
      return;
    }

    try {
      const medicines = this.normalizeMedicineItems(await adapter.fetchInstitutionMedicineCatalog(this.currentOrgCode || ''));
      if (!medicines.length) {
        console.warn('[MedicalData] Medicine catalog refresh returned empty result for active pharmacies', {
          hasOrgCode: Boolean(this.currentOrgCode),
          hasTenantId: Boolean(this.currentTenantId),
          storeCount: normalizedStoreIds.length,
        });
        return;
      }

      this.catalog.medicines = medicines;
      await this.persistMedicineCatalog(this.currentOrgCode || '', this.currentTenantId, normalizedStoreIds, medicines, today);
      console.log('[MedicalData] Medicine catalog refreshed by active pharmacy storeIds', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
        itemCount: medicines.length,
      });
    } catch {
      console.warn('[MedicalData] Failed to refresh medicine catalog for active pharmacies; cached catalog remains in use', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
      });
    }
  }

  /** 当前匹配可见的药品列表：按 activeMedicineStoreIds 与 item.storeIds 取交集；item.storeIds 为空不参与药品匹配 */
  public getMatchableMedicines(): MedicineItem[] {
    const scopedMedicines = this.catalog.medicines.filter((item) => Array.isArray(item.storeIds) && item.storeIds.length > 0);
    const active = this.activeMedicineStoreIds;
    if (active === null) {
      return scopedMedicines;
    }
    if (active.size === 0) {
      return [];
    }
    if (scopedMedicines.length === 0) {
      console.warn('[MedicalData] Active pharmacy scope is set but no scoped medicine catalog is loaded; medicine matching returns empty result', {
        activeStoreCount: active.size,
        medicineCount: this.catalog.medicines.length,
      });
      return [];
    }
    const filtered = scopedMedicines.filter((item) => item.storeIds?.some((idSto) => active.has(idSto)));
    if (this.activeInStockProductIds !== null) {
      return filtered.filter((item) => this.activeInStockProductIds!.has(item.id));
    }
    return filtered;
  }

  public searchMedicines(query: string, aliases?: string[], limit = 8): MedicineItem[] {
    return this.searchMedicinesByVariants(query, aliases, limit);
  }

  public assessMedicineMatch(query: string, aliases?: string[], spec?: string): CatalogMatchAssessment<MedicineItem> {
    return this.assessMedicineByVariants(query, aliases, spec);
  }

  /**
   * Find best matching examination/lab item
   * @param query AI output string
   */
  public matchItem(query: string): MedicalItem | null {
    return this.matchMedicalItemByVariants(this.catalog.items, query);
  }

  /**
   * Find best matching examination item (imaging/device: X-ray, CT, B-ultrasound, ECG, etc.)
   * Only matches items with category === '检查'
   */
  public matchExamItem(query: string, aliases?: string[]): MedicalItem | null {
    return this.matchItemByCategory(query, '检查', aliases);
  }

  public searchExamItems(query: string, aliases?: string[], limit = 8): MedicalItem[] {
    return this.searchItemsByCategory(query, '检查', aliases, limit);
  }

  public assessExamItemMatch(query: string, aliases?: string[]): CatalogMatchAssessment<MedicalItem> {
    return this.assessItemByCategory(query, '检查', aliases);
  }

  /**
   * Find best matching lab test item (blood test, urine test, biochemistry, etc.)
   * Only matches items with category === '检验'
   */
  public matchLabTestItem(query: string, aliases?: string[]): MedicalItem | null {
    return this.matchItemByCategory(query, '检验', aliases);
  }

  public searchLabTestItems(query: string, aliases?: string[], limit = 8): MedicalItem[] {
    return this.searchItemsByCategory(query, '检验', aliases, limit);
  }

  public assessLabTestItemMatch(query: string, aliases?: string[]): CatalogMatchAssessment<MedicalItem> {
    return this.assessItemByCategory(query, '检验', aliases);
  }

  /**
   * Find best matching procedure item (dressing change, suture removal, nebulization, etc.)
   * Only matches items with category === '治疗'
   */
  public matchProcedureItem(query: string, aliases?: string[]): MedicalItem | null {
    return this.matchItemByCategory(query, '治疗', aliases);
  }

  public searchProcedureItems(query: string, aliases?: string[], limit = 8): MedicalItem[] {
    return this.searchItemsByCategory(query, '治疗', aliases, limit);
  }

  public assessProcedureItemMatch(query: string, aliases?: string[]): CatalogMatchAssessment<MedicalItem> {
    return this.assessItemByCategory(query, '治疗', aliases);
  }

  private matchItemByCategory(query: string, category: string, aliases?: string[]): MedicalItem | null {
    if (!query) return null;
    const filtered = this.catalog.items.filter(i => i.category === category);
    return this.matchMedicalItemByVariants(filtered, query, aliases);
  }

  private searchItemsByCategory(query: string, category: string, aliases?: string[], limit = 8): MedicalItem[] {
    if (!query) return [];
    const filtered = this.catalog.items.filter(i => i.category === category);
    return this.searchMedicalItemsByVariants(filtered, query, aliases, limit);
  }

  private assessItemByCategory(query: string, category: string, aliases?: string[]): CatalogMatchAssessment<MedicalItem> {
    if (!query) {
      return { status: 'unmatched', candidate: null, confidence: 0 };
    }

    const filtered = this.catalog.items.filter(i => i.category === category);
    return this.assessMedicalItemByVariants(filtered, query, aliases);
  }

  private matchMedicineByVariants(query: string, aliases?: string[]): MedicineItem | null {
    const top = this.collectScoredMedicineCandidates(query, aliases, 1)[0];
    return top && top.score > 0.3 ? top.item : null;
  }

  private searchMedicinesByVariants(query: string, aliases?: string[], limit = 8): MedicineItem[] {
    return this.collectScoredMedicineCandidates(query, aliases, limit)
      .slice(0, limit)
      .map((candidate) => candidate.item);
  }

  private assessMedicineByVariants(query: string, aliases?: string[], spec?: string): CatalogMatchAssessment<MedicineItem> {
    const exact = this.findExactMedicineMatch(query, spec);
    if (exact) {
      return { status: 'exact', candidate: exact, confidence: 1 };
    }

    const ranked = this.collectScoredMedicineCandidates(query, aliases, 2, spec);
    const top = ranked[0];
    const second = ranked[1];

    if (top && top.score >= MedicalDataService.PROBABLE_MATCH_THRESHOLD) {
      const margin = second ? top.score - second.score : 1;
      if (margin >= MedicalDataService.PROBABLE_MATCH_MARGIN) {
        return {
          status: 'probable',
          candidate: top.item,
          confidence: Number(top.score.toFixed(3)),
        };
      }
    }

    return { status: 'unmatched', candidate: null, confidence: 0 };
  }

  private matchMedicalItemByVariants(items: MedicalItem[], query: string, aliases?: string[]): MedicalItem | null {
    const top = this.collectScoredMedicalItemCandidates(items, query, aliases, 1)[0];
    return top && top.score > 0.3 ? top.item : null;
  }

  private searchMedicalItemsByVariants(items: MedicalItem[], query: string, aliases?: string[], limit = 8): MedicalItem[] {
    return this.collectScoredMedicalItemCandidates(items, query, aliases, limit)
      .slice(0, limit)
      .map((candidate) => candidate.item);
  }

  private assessMedicalItemByVariants(items: MedicalItem[], query: string, aliases?: string[]): CatalogMatchAssessment<MedicalItem> {
    const exact = this.findExactMedicalItemMatch(items, query);
    if (exact) {
      return { status: 'exact', candidate: exact, confidence: 1 };
    }

    const ranked = this.collectScoredMedicalItemCandidates(items, query, aliases, 2);
    const top = ranked[0];
    const second = ranked[1];

    if (top && top.score >= MedicalDataService.PROBABLE_MATCH_THRESHOLD) {
      const margin = second ? top.score - second.score : 1;
      if (margin >= MedicalDataService.PROBABLE_MATCH_MARGIN || this.shouldAllowRoutineProbableMatch(query, top, second)) {
        return {
          status: 'probable',
          candidate: top.item,
          confidence: Number(top.score.toFixed(3)),
        };
      }
    }

    return { status: 'unmatched', candidate: null, confidence: 0 };
  }

  private collectScoredMedicineCandidates(query: string, aliases?: string[], limit = Number.POSITIVE_INFINITY, spec?: string): Array<ScoredCandidate<MedicineItem>> {
    const variants = this.buildMatchVariants(query, aliases);
    if (variants.length === 0) {
      return [];
    }

    const querySpecMg = extractSpecStrengthMg(spec);
    const primaryVariant = variants[0];
    const medicineCandidates: Array<ScoredCandidate<MedicineItem>> = [];

    for (const item of this.getMatchableMedicines()) {
      const primaryNameScore = this.calculateScore(primaryVariant.normalized, item.name);
      const primaryFullNameScore = this.calculateScore(primaryVariant.normalized, `${item.name} ${item.spec}`);
      const primaryScore = Math.max(primaryNameScore, primaryFullNameScore);

      if (primaryScore < 0.2) {
        continue;
      }

      let score = primaryScore;

      for (const variant of variants.slice(1)) {
        const nameScore = this.calculateScore(variant.normalized, item.name) * variant.weight;
        const fullNameScore = this.calculateScore(variant.normalized, `${item.name} ${item.spec}`) * variant.weight;
        score = Math.max(score, nameScore, fullNameScore);
      }

      // 规格加权：同名候选中，规格含量匹配的加分
      if (querySpecMg !== null && score >= 0.5) {
        const itemSpecMg = extractSpecStrengthMg(item.spec);
        if (itemSpecMg !== null && Math.abs(querySpecMg - itemSpecMg) < 0.01) {
          score = Math.min(score + 0.15, 1.0);
        }
      }

      medicineCandidates.push({ item, score, primaryScore });
    }

    return medicineCandidates
      .sort((left, right) => right.score - left.score || right.primaryScore - left.primaryScore || left.item.name.localeCompare(right.item.name))
      .slice(0, limit);
  }

  private collectScoredMedicalItemCandidates(items: MedicalItem[], query: string, aliases?: string[], limit = Number.POSITIVE_INFINITY): Array<ScoredCandidate<MedicalItem>> {
    const variants = this.buildMatchVariants(query, aliases);
    if (variants.length === 0) {
      return [];
    }

    const primaryVariant = variants[0];
    const candidates: Array<ScoredCandidate<MedicalItem>> = [];

    for (const item of items) {
      let primaryScore = Math.max(
        this.calculateScore(primaryVariant.normalized, item.name, item.keywords),
        this.normalizeRoutineItemAlias(item.name) === primaryVariant.normalizedRoutineAlias ? 0.99 : 0,
      );

      if (primaryScore < 0.2) {
        continue;
      }

      let score = primaryScore;

      for (const variant of variants.slice(1)) {
        const baseScore = this.calculateScore(variant.normalized, item.name, item.keywords) * variant.weight;
        const routineAliasScore = this.normalizeRoutineItemAlias(item.name) === variant.normalizedRoutineAlias
          ? Math.min(0.94, primaryScore + 0.08) * variant.weight
          : 0;
        score = Math.max(score, baseScore, routineAliasScore);
      }

      primaryScore = adjustRestrictedMedicalItemScore(primaryScore, item, primaryVariant.normalized);
      score = adjustRestrictedMedicalItemScore(score, item, primaryVariant.normalized);

      candidates.push({ item, score, primaryScore });
    }

    return candidates
      .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        if (Math.abs(scoreDelta) > 0.0001) {
          return scoreDelta;
        }

        const primaryDelta = right.primaryScore - left.primaryScore;
        if (Math.abs(primaryDelta) > 0.0001) {
          return primaryDelta;
        }

        const routinePriorityDelta = this.compareRoutineCandidatePriority(left.item, right.item, primaryVariant.normalizedRoutineAlias);
        if (routinePriorityDelta !== 0) {
          return routinePriorityDelta;
        }

        return left.item.name.localeCompare(right.item.name);
      })
      .slice(0, limit);
  }

  private buildMatchVariants(query: string, aliases?: string[]): MatchVariant[] {
    const rawValues = [query, ...(aliases || [])]
      .map((item) => item?.trim())
      .filter(Boolean) as string[];

    const seen = new Set<string>();
    const variants: MatchVariant[] = [];

    rawValues.forEach((value, index) => {
      const normalized = value.toLowerCase();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);

      variants.push({
        normalized,
        weight: index === 0 ? 1 : Math.max(0.72, 0.92 - ((index - 1) * 0.08)),
        normalizedRoutineAlias: this.normalizeRoutineItemAlias(value),
      });
    });

    return variants;
  }

  private normalizeRoutineItemAlias(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/\s+/gu, '')
      .replace(/[—–－-]/gu, '')
      .replace(/[()（）\[\]【】]/gu, '')
      .replace(/免费$/u, '')
      .replace(/[一二三四五六七八九十\d]+分类$/u, '')
      .replace(/[a-z]+$/u, '')
      .replace(/^常规/u, '')
      .replace(/(检查|检验|检测|测定|项目)$/u, '');
  }

  private describeRoutineMatch(value: string): RoutineMatchDescriptor {
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/\s+/gu, '')
      .replace(/[()（）\[\]【】]/gu, '');
    const classificationMatch = normalized.match(/([一二三四五六七八九十\d]+)分类/u);
    return {
      alias: this.normalizeRoutineItemAlias(value),
      classificationRank: this.parseChineseNumberToken(classificationMatch?.[1]),
      hasClassification: Boolean(classificationMatch),
    };
  }

  private parseChineseNumberToken(value?: string): number | null {
    if (!value) {
      return null;
    }

    if (/^\d+$/u.test(value)) {
      return Number.parseInt(value, 10);
    }

    const digitMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };

    if (value === '十') {
      return 10;
    }

    if (value.startsWith('十')) {
      const tail = digitMap[value.slice(1)] || 0;
      return 10 + tail;
    }

    if (value.endsWith('十')) {
      const head = digitMap[value.slice(0, -1)] || 1;
      return head * 10;
    }

    const tenIndex = value.indexOf('十');
    if (tenIndex > 0) {
      const head = digitMap[value.slice(0, tenIndex)] || 1;
      const tail = digitMap[value.slice(tenIndex + 1)] || 0;
      return (head * 10) + tail;
    }

    return digitMap[value] ?? null;
  }

  private compareRoutineCandidatePriority(left: MedicalItem, right: MedicalItem, queryAlias: string): number {
    if (!queryAlias) {
      return 0;
    }

    const leftRoutine = this.describeRoutineMatch(left.name);
    const rightRoutine = this.describeRoutineMatch(right.name);

    if (leftRoutine.alias !== queryAlias || rightRoutine.alias !== queryAlias) {
      return 0;
    }

    if (leftRoutine.hasClassification !== rightRoutine.hasClassification) {
      return leftRoutine.hasClassification ? -1 : 1;
    }

    if (leftRoutine.classificationRank !== null && rightRoutine.classificationRank !== null && leftRoutine.classificationRank !== rightRoutine.classificationRank) {
      return leftRoutine.classificationRank - rightRoutine.classificationRank;
    }

    const leftIsFree = /免费/u.test(left.name);
    const rightIsFree = /免费/u.test(right.name);
    if (leftIsFree !== rightIsFree) {
      return leftIsFree ? 1 : -1;
    }

    return 0;
  }

  private shouldAllowRoutineProbableMatch(
    query: string,
    top: ScoredCandidate<MedicalItem>,
    second?: ScoredCandidate<MedicalItem>,
  ): boolean {
    const queryRoutine = this.describeRoutineMatch(query);
    if (!queryRoutine.alias || queryRoutine.hasClassification) {
      return false;
    }

    const topRoutine = this.describeRoutineMatch(top.item.name);
    if (topRoutine.alias !== queryRoutine.alias || !topRoutine.hasClassification) {
      return false;
    }

    if (!second) {
      return true;
    }

    const secondRoutine = this.describeRoutineMatch(second.item.name);
    if (secondRoutine.alias !== queryRoutine.alias) {
      return false;
    }

    return this.compareRoutineCandidatePriority(top.item, second.item, queryRoutine.alias) < 0;
  }

  private normalizeExactMatchText(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[\s\-_()（）[\]【】,，.。/\\]/gu, '');
  }

  private findExactMedicineMatch(query: string, spec?: string): MedicineItem | null {
    const normalizedQuery = this.normalizeExactMatchText(query);
    if (!normalizedQuery) {
      return null;
    }

    const exactMatches = this.getMatchableMedicines().filter((item) => this.normalizeExactMatchText(item.name) === normalizedQuery);
    if (exactMatches.length === 0) {
      return null;
    }

    const querySpecMg = extractSpecStrengthMg(spec);
    if (querySpecMg !== null) {
      const specMatched = exactMatches.find((item) => {
        const itemSpecMg = extractSpecStrengthMg(item.spec);
        return itemSpecMg !== null && Math.abs(querySpecMg - itemSpecMg) < 0.01;
      });
      return specMatched || null;
    }

    return exactMatches.length === 1 ? exactMatches[0] : null;
  }

  private findExactMedicalItemMatch(items: MedicalItem[], query: string): MedicalItem | null {
    const normalizedQuery = this.normalizeExactMatchText(query);
    if (!normalizedQuery) {
      return null;
    }

    return items.find((item) => (
      (!isRestrictedMedicalCatalogItem(item) || explicitlyRequestsRestrictedMedicalItem(query))
      && (this.normalizeExactMatchText(item.name) === normalizedQuery || item.code.trim().toLowerCase() === query.trim().toLowerCase())
    )) || null;
  }

  /**
   * Find best matching TCM syndrome
   * @param query AI output string (e.g., "风寒束表证" or "表虚证")
   */
  public matchTCMSyndrome(query: string): TCMSyndromeItem | null {
    if (!query) return null;
    const normalizedQuery = query.trim().toLowerCase();

    // 1. Exact match (name or code)
    const exact = this.catalog.tcmSyndromes.find(s =>
      s.name.toLowerCase() === normalizedQuery ||
      s.code.toLowerCase() === normalizedQuery
    );
    if (exact) return exact;

    // 2. Code prefix match
    const codeMatches = this.catalog.tcmSyndromes.filter(s =>
      s.code.toLowerCase().startsWith(normalizedQuery)
    );

    if (codeMatches.length > 0) {
      codeMatches.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
      return codeMatches[0];
    }

    // 3. Best fuzzy match
    let bestMatch: TCMSyndromeItem | null = null;
    let maxScore = 0;

    for (const item of this.catalog.tcmSyndromes) {
      const score = this.calculateScore(normalizedQuery, item.name, item.keywords);

      if (score > maxScore) {
        maxScore = score;
        bestMatch = item;
      }
    }

    // Threshold for acceptance
    return maxScore > 0.3 ? bestMatch : null;
  }

  /**
   * Find best matching TCM treatment
   * @param query AI output string (e.g., "疏风解表" or "辛温解表法")
   */
  public matchTCMTreatment(query: string): TCMTreatmentItem | null {
    if (!query) return null;
    const normalizedQuery = query.trim().toLowerCase();

    // 1. Exact match (name or code)
    const exact = this.catalog.tcmTreatments.find(t =>
      t.name.toLowerCase() === normalizedQuery ||
      t.code.toLowerCase() === normalizedQuery
    );
    if (exact) return exact;

    // 2. Code prefix match
    const codeMatches = this.catalog.tcmTreatments.filter(t =>
      t.code.toLowerCase().startsWith(normalizedQuery)
    );

    if (codeMatches.length > 0) {
      codeMatches.sort((a, b) => a.code.length - b.code.length || a.code.localeCompare(b.code));
      return codeMatches[0];
    }

    // 3. Best fuzzy match
    let bestMatch: TCMTreatmentItem | null = null;
    let maxScore = 0;

    for (const item of this.catalog.tcmTreatments) {
      const score = this.calculateScore(normalizedQuery, item.name, item.keywords);

      if (score > maxScore) {
        maxScore = score;
        bestMatch = item;
      }
    }

    // Threshold for acceptance
    return maxScore > 0.3 ? bestMatch : null;
  }

  /**
   * Calculate similarity score (0-1)
   * Uses simple character overlap / Jaccard-like approach
   */
  private calculateScore(query: string, target: string, keywords?: string[]): number {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    let score = 0;

    if (t.includes(q)) {
      const ratio = q.length / t.length;
      score = ratio >= 0.4 ? 0.9 : 0.9 * ratio;
    } else if (q.includes(t)) {
      const ratio = t.length / q.length;
      if (ratio >= 0.5) score = 0.8;
      else if (ratio >= 0.33) score = 0.65;
      else score = ratio * 1.5;
    } else {
      let keywordMatched = false;
      if (keywords) {
        let bestKeywordScore = 0;
        for (const k of keywords) {
          if (k.length < 2) continue;
          const kl = k.toLowerCase();
          if (q.includes(kl)) {
            const ratio = kl.length / q.length;
            const s = ratio >= 0.4 ? 0.85 : 0.85 * ratio;
            bestKeywordScore = Math.max(bestKeywordScore, s);
            keywordMatched = true;
          }
        }
        if (keywordMatched) {
          score = bestKeywordScore;
        }
      }

      if (!keywordMatched) {
        const qSet = new Set(q.split(''));
        const tSet = new Set(t.split(''));
        let intersection = 0;
        for (const char of qSet) {
          if (tSet.has(char)) intersection++;
        }

        const union = qSet.size + tSet.size - intersection;
        const rawJaccard = union === 0 ? 0 : intersection / union;
        const lengthRatio = tSet.size / qSet.size;
        const penalty = lengthRatio < 0.4 ? lengthRatio : 1;
        score = rawJaccard * penalty;
      }
    }

    // Apply lateralization (left/right/bilateral) mismatch penalties
    const qLeft = q.includes('左');
    const qRight = q.includes('右');
    const qBilateral = q.includes('双') || q.includes('两');

    const tLeft = t.includes('左');
    const tRight = t.includes('右');
    const tBilateral = t.includes('双') || t.includes('两');

    if (tBilateral && !qBilateral) score *= 0.5;
    if (tLeft && !qLeft) score *= 0.5;
    if (tRight && !qRight) score *= 0.5;

    if (qBilateral && !tBilateral) score *= 0.5;
    if (qLeft && !tLeft) score *= 0.5;
    if (qRight && !tRight) score *= 0.5;

    return score;
  }

  private isIcd10CategoryInRange(categoryCode: string, start: string, end: string): boolean {
    const currentValue = this.toIcd10Ordinal(categoryCode);
    const startValue = this.toIcd10Ordinal(start);
    const endValue = this.toIcd10Ordinal(end);

    if (currentValue == null || startValue == null || endValue == null) {
      return false;
    }

    return currentValue >= startValue && currentValue <= endValue;
  }

  private toIcd10Ordinal(categoryCode: string): number | null {
    const match = categoryCode.toUpperCase().match(/^([A-Z])([0-9]{2})$/);
    if (!match) return null;

    const letterValue = match[1].charCodeAt(0) - 65;
    const numberValue = Number.parseInt(match[2], 10);
    return (letterValue * 100) + numberValue;
  }

  private normalizeKeywords(keywords?: string[] | string): string[] | undefined {
    if (Array.isArray(keywords)) {
      return keywords.map(item => item.trim()).filter(Boolean);
    }
    return this.parseKeywords(keywords);
  }

  private normalizeDiagnosisItems(items: Array<Partial<DiagnosisItem> | DiagnosisCatalogEntry>): DiagnosisItem[] {
    const normalized: DiagnosisItem[] = [];

    items.forEach((item, index) => {
      const name = item.name?.trim();
      const code = item.code?.trim() || '';
      if (!name || name.length < 2) {
        return;
      }

      const rawKeywords = this.normalizeKeywords(item.keywords);
      const keywords = rawKeywords?.filter(k => k.length >= 2);

      normalized.push({
        id: item.id?.toString().trim() || code || `${index + 1}`,
        code,
        name,
        keywords: keywords?.length ? keywords : undefined
      });
    });

    return normalized;
  }

  private normalizeTCMItems(
    items: Array<Partial<TCMDiagnosisItem> | Partial<TCMSyndromeItem> | Partial<TCMTreatmentItem>>
  ): TCMDiagnosisItem[] {
    const normalized: TCMDiagnosisItem[] = [];

    items.forEach((item, index) => {
      const name = item.name?.trim();
      if (!name) {
        return;
      }

      normalized.push({
        id: item.id?.toString().trim() || item.code?.toString().trim() || `${index + 1}`,
        code: item.code?.toString().trim() || '',
        name,
        keywords: this.normalizeKeywords(item.keywords),
      });
    });

    return normalized;
  }

  private normalizeMedicineItems(items: Array<Partial<MedicineItem> | MedicineCatalogEntry>): MedicineItem[] {
    const normalized: MedicineItem[] = [];

    items.forEach((item, index) => {
      const name = item.name?.trim();
      if (!name) {
        return;
      }

      // 兼容两种来源：
      // 1. 持久化 snapshot（带 idSrv/naSrv 的 partial MedicineItem）
      // 2. HIS adapter / 区域化映射（中性 entry，厂商字段透传在 raw）
      const partial = item as Partial<MedicineItem>;
      const entry = item as MedicineCatalogEntry;
      const raw = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<string, unknown>;
      const readRawString = (key: string) => {
        const v = raw[key];
        return typeof v === 'string' ? v.trim() : '';
      };
      const collectStoreIds = (...sources: unknown[]): string[] => {
        const values: string[] = [];
        const append = (source: unknown) => {
          if (Array.isArray(source)) {
            source.forEach(append);
            return;
          }
          if (typeof source !== 'string' && typeof source !== 'number') {
            return;
          }
          String(source)
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .forEach((value) => values.push(value));
        };

        sources.forEach(append);
        return Array.from(new Set(values));
      };
      const storeIds = collectStoreIds(
        partial.storeIds,
        entry.storeIds,
        raw.storeIds,
        raw.storeId,
        raw.idSto,
      );

      normalized.push({
        id: item.id?.toString().trim() || `${index + 1}`,
        name,
        spec: item.spec?.trim() || '',
        idSrv: partial.idSrv?.toString().trim() || readRawString('idSrv') || item.id?.toString().trim() || `${index + 1}`,
        naSrv: partial.naSrv?.toString().trim() || readRawString('naSrv') || name,
        sdSrv: partial.sdSrv?.toString().trim() || readRawString('sdSrv') || '11',
        idDeptExec: partial.idDeptExec?.toString().trim() || readRawString('idDeptExec') || '',
        fgCheckOrd: partial.fgCheckOrd?.toString().trim() || readRawString('fgCheckOrd') || '1',
        fgSkintest: partial.fgSkintest?.toString().trim() || readRawString('fgSkintest') || '0',
        storeIds,
        raw: item.raw && typeof item.raw === 'object' ? item.raw : undefined,
      });
    });

    return normalized;
  }

  private normalizeMedicalItems(items: Array<Partial<MedicalItem> | MedicalItemCatalogEntry>): MedicalItem[] {
    const normalized: MedicalItem[] = [];

    items.forEach((item, index) => {
      const name = item.name?.trim();
      if (!name) {
        return;
      }

      const partial = item as Partial<MedicalItem>;
      const entry = item as MedicalItemCatalogEntry;
      const raw = (item.raw && typeof item.raw === 'object' ? item.raw : {}) as Record<string, unknown>;
      const readRawString = (key: string) => {
        const v = raw[key];
        return typeof v === 'string' ? v.trim() : '';
      };
      const rawPrice = raw.priceSale;
      const unitPrice = typeof partial.unitPrice === 'number'
        ? partial.unitPrice
        : typeof entry.unitPrice === 'number'
          ? entry.unitPrice
          : typeof rawPrice === 'number' ? rawPrice : undefined;
      const rawRestricted = raw.restricted;

      normalized.push({
        id: item.id?.toString().trim() || `${index + 1}`,
        code: item.code?.toString().trim() || item.id?.toString().trim() || name,
        name,
        category: item.category?.trim() || '其他',
        keywords: this.normalizeKeywords(item.keywords),
        idSrv: partial.idSrv?.toString().trim() || readRawString('idSrv') || item.id?.toString().trim() || `${index + 1}`,
        naSrv: partial.naSrv?.toString().trim() || readRawString('naSrv') || name,
        sdSrv: partial.sdSrv?.toString().trim() || readRawString('sdSrv') || '',
        idDeptExec: partial.idDeptExec?.toString().trim() || readRawString('idDeptExec') || '',
        idPart: partial.idPart?.toString().trim() || readRawString('idPart') || '',
        jsonField: partial.jsonField?.toString().trim() || readRawString('jsonField') || '',
        fgCheckOrd: partial.fgCheckOrd?.toString().trim() || readRawString('fgCheckOrd') || '1',
        unitPrice,
        restricted: partial.restricted === true || entry.restricted === true || rawRestricted === true || rawRestricted === '1',
        restrictionReason: partial.restrictionReason?.trim()
          || entry.restrictionReason?.trim()
          || readRawString('restrictionReason')
          || '',
        mutualRecognitionCode: partial.mutualRecognitionCode?.trim()
          || entry.mutualRecognitionCode?.trim()
          || readRawString('mutualRecognitionCode')
          || '',
        raw: item.raw && typeof item.raw === 'object' ? item.raw : undefined,
      });
    });

    return normalized;
  }

  private async syncLocalCatalogs(
    hisService: HisAdapter,
    snapshot: MedicalCatalogSnapshot | null,
    options: MedicalCatalogSyncOptions = {}
  ): Promise<void> {
    const forceSync = options.force === true;
    await this.syncGlobalDiagnosesIfNeeded(hisService, snapshot, forceSync);

    if (!this.currentOrgCode) {
      console.warn('[MedicalData] Skip org-scoped catalog sync because orgCode is missing');
      return;
    }

    const orgCode = this.currentOrgCode;
    await Promise.allSettled([
      this.syncInstitutionItemsIfNeeded(hisService, orgCode, snapshot, forceSync),
      this.syncInstitutionMedicinesIfNeeded(hisService, orgCode, snapshot, forceSync),
      this.syncActivePharmacyStoreIds(hisService),
    ]);
  }

  /**
   * 提前同步当前可用的发药药房，写入匹配端 active store 集合。
   *
  * 必须在任何 LLM 触发的药品匹配之前完成；否则匹配端会因为缺少 active scope 而返回空候选。
   */
  private async syncActivePharmacyStoreIds(hisService: HisAdapter): Promise<void> {
    try {
      const pharmacies = await hisService.fetchAvailablePharmacies();
      const storeIds = pharmacies.length > 0
        ? pharmacies
            .map((option) => (typeof option.idSto === 'string' ? option.idSto.trim() : ''))
            .filter((value): value is string => Boolean(value))
        : await hisService.fetchMedicineStoreIds(this.currentOrgCode || '');
      this.setActivePharmacyStoreIds(storeIds);
      console.log('[MedicalData] Active pharmacy storeIds synced for matching', {
        hasOrgCode: Boolean(this.currentOrgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: storeIds.length,
        pharmacyCount: pharmacies.length,
      });
    } catch {
      console.warn('[MedicalData] Failed to sync active pharmacy storeIds, medicine matching will return empty candidates');
      this.setActivePharmacyStoreIds(null);
    }
  }

  private async syncGlobalDiagnosesIfNeeded(
    hisService: HisAdapter,
    snapshot: MedicalCatalogSnapshot | null,
    forceSync = false
  ): Promise<void> {
    if (!forceSync && snapshot?.diagnoses.length) {
      console.log('[MedicalData] Skip diagnosis sync, cache hit', {
        itemCount: snapshot.diagnoses.length,
        hasSyncedAt: Boolean(snapshot.diagnosisSyncedAt),
      });
      return;
    }

    try {
      console.log('[MedicalData] Fetch diagnosis catalog from HIS');
      const diagnoses = this.normalizeDiagnosisItems(await hisService.fetchDiagnosisCatalog());
      if (!diagnoses.length) {
        console.warn('[MedicalData] Diagnosis catalog returned empty result');
        return;
      }

      this.catalog.diagnoses = diagnoses;
      await this.persistDiagnosisCatalog(diagnoses);
      console.log('[MedicalData] Diagnosis catalog synced', {
        itemCount: diagnoses.length,
      });
    } catch {
      console.warn('[MedicalData] Failed to sync diagnosis catalog from HIS, keep current cache');
    }
  }

  private async syncInstitutionItemsIfNeeded(
    hisService: HisAdapter,
    orgCode: string,
    snapshot: MedicalCatalogSnapshot | null,
    forceSync = false
  ): Promise<void> {
    const today = this.getTodayTag();
    if (!forceSync && snapshot?.items.length && snapshot.itemSyncDate === today) {
      console.log('[MedicalData] Skip medical items sync, same-day SQLite cache hit', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        itemCount: snapshot.items.length,
        hasSyncDate: Boolean(snapshot.itemSyncDate),
      });
      return;
    }

    try {
      console.log('[MedicalData] Fetch medical items catalog from HIS', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        hasCache: Boolean(snapshot?.items.length),
        hasCacheDate: Boolean(snapshot?.itemSyncDate),
      });
      const items = this.normalizeMedicalItems(await hisService.fetchInstitutionMedicalItemsCatalog(orgCode));
      const persistableItems = items.filter((item) => !isExamOrLabItem(item));
      if (!items.length) {
        console.warn('[MedicalData] Medical items catalog returned empty result', {
          hasOrgCode: Boolean(orgCode),
        });
        return;
      }

      this.catalog.items = [
        ...this.catalog.items.filter(isExamOrLabItem),
        ...persistableItems,
      ];
      await this.persistMedicalItemCatalog(orgCode, this.currentTenantId, persistableItems, today);
      console.log('[MedicalData] Non-exam/lab items synced', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        itemCount: persistableItems.length,
      });
    } catch {
      console.warn('[MedicalData] Failed to sync medical items for current organization, keep current cache', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
      });
    }
  }

  private async syncInstitutionMedicinesIfNeeded(
    hisService: HisAdapter,
    orgCode: string,
    snapshot: MedicalCatalogSnapshot | null,
    forceSync = false
  ): Promise<void> {
    const today = this.getTodayTag();

    // 获取当前机构的西药房 storeId 列表，以此作为缓存键（按药房缓存）
    let storeIds: string[];
    try {
      storeIds = await hisService.fetchMedicineStoreIds(orgCode);
    } catch {
      console.warn('[MedicalData] Failed to fetch medicine store IDs, fallback to org-tenant-scoped cache', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
      });
      storeIds = [];
    }

    const normalizedStoreIds = this.normalizeStoreIds(storeIds);

    let pharmacySnapshot: MedicalCatalogSnapshot | null = null;
    if (normalizedStoreIds.length > 0) {
      try {
        pharmacySnapshot = await invoke<MedicalCatalogSnapshot>('load_medical_catalog_snapshot', this.buildCatalogScopePayload(normalizedStoreIds));
      } catch {
        pharmacySnapshot = null;
      }
    } else {
      pharmacySnapshot = snapshot;
    }

    // 先将已缓存的药品目录加载到内存（网络请求完成前先提供可用数据）
    if (pharmacySnapshot?.medicines.length) {
      this.catalog.medicines = this.normalizeMedicineItems(pharmacySnapshot.medicines);
    }

    if (!forceSync && pharmacySnapshot?.medicines.length && pharmacySnapshot.medicineSyncDate === today) {
      console.log('[MedicalData] Skip medicine sync, same-day pharmacy-scoped SQLite cache hit', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
        itemCount: pharmacySnapshot.medicines.length,
        hasSyncDate: Boolean(pharmacySnapshot.medicineSyncDate),
      });
      return;
    }

    try {
      console.log('[MedicalData] Fetch medicine catalog from HIS', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
        hasCache: Boolean(pharmacySnapshot?.medicines.length),
        hasCacheDate: Boolean(pharmacySnapshot?.medicineSyncDate),
      });
      const medicines = this.normalizeMedicineItems(await hisService.fetchInstitutionMedicineCatalog(orgCode));
      if (!medicines.length) {
        console.warn('[MedicalData] Medicine catalog returned empty result', {
          hasOrgCode: Boolean(orgCode),
          hasTenantId: Boolean(this.currentTenantId),
          storeCount: normalizedStoreIds.length,
        });
        return;
      }

      this.catalog.medicines = medicines;
      await this.persistMedicineCatalog(orgCode, this.currentTenantId, normalizedStoreIds, medicines, today);
      console.log('[MedicalData] Medicine catalog synced', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
        itemCount: medicines.length,
      });
    } catch {
      console.warn('[MedicalData] Failed to sync medicines for current organization, cached pharmacy-scoped catalog remains in use', {
        hasOrgCode: Boolean(orgCode),
        hasTenantId: Boolean(this.currentTenantId),
        storeCount: normalizedStoreIds.length,
      });
    }
  }

  // ─── 区域化远程数据同步 ────────────────────────────────────────────────

  /**
   * 从 core-service 增量同步医学数据包
   * 服务端按机构管理数据，返回 CSV 格式数据
   */
  async syncRemoteData(): Promise<void> {
    try {
      const currentVersion = localStorage.getItem(MedicalDataService.DATA_VERSION_KEY) || '0';
      const resp = await regionalGet<{
        version: string;
        diagnoses?: string;
        medicines?: string;
        items?: string;
        tcmDiagnoses?: string;
        tcmSyndromes?: string;
        tcmTreatments?: string;
      }>(`/v1/client/mappings/delta?version=${encodeURIComponent(currentVersion)}`);

      let updated = false;

      if (resp.diagnoses) {
        this.catalog.diagnoses = this.loadDiagnosesFromRaw(resp.diagnoses);
        updated = true;
      }
      if (resp.medicines) {
        this.catalog.medicines = this.loadMedicinesFromRaw(resp.medicines);
        updated = true;
      }
      if (resp.items) {
        this.catalog.items = [
          ...this.catalog.items.filter(isExamOrLabItem),
          ...this.loadItemsFromRaw(resp.items).filter((item) => !isExamOrLabItem(item)),
        ];
        updated = true;
      }
      if (resp.tcmDiagnoses) {
        this.catalog.tcmDiagnoses = this.loadTCMItemsFromRaw(resp.tcmDiagnoses);
        updated = true;
      }
      if (resp.tcmSyndromes) {
        this.catalog.tcmSyndromes = this.loadTCMItemsFromRaw(resp.tcmSyndromes);
        updated = true;
      }
      if (resp.tcmTreatments) {
        this.catalog.tcmTreatments = this.loadTCMItemsFromRaw(resp.tcmTreatments);
        updated = true;
      }

      if (updated) {
        // 检查检验是接诊级实时事实，不进入离线 mappings 缓存。
        localStorage.setItem(MedicalDataService.DATA_CACHE_KEY, JSON.stringify({
          ...this.catalog,
          items: this.catalog.items.filter((item) => !isExamOrLabItem(item)),
        }));
        localStorage.setItem(MedicalDataService.DATA_VERSION_KEY, resp.version);
        console.log('[MedicalData] Remote data sync finished', {
          hasVersion: Boolean(resp.version),
        });
      }
    } catch {
      console.warn('[MedicalData] Remote sync failed, using local data');
      // 尝试从 localStorage 恢复缓存
      this.restoreFromCache();
    }
  }

  private restoreFromCache(): void {
    try {
      const cached = localStorage.getItem(MedicalDataService.DATA_CACHE_KEY);
      if (cached) {
        const data = JSON.parse(cached) as MedicalCatalog;
        const hasCatalogData = Boolean(
          data.diagnoses?.length
          || data.tcmDiagnoses?.length
          || data.tcmSyndromes?.length
          || data.tcmTreatments?.length
          || data.items?.length
          || data.medicines?.length
        );
        if (hasCatalogData) {
          this.catalog = {
            diagnoses: this.normalizeDiagnosisItems(data.diagnoses || []),
            tcmDiagnoses: this.normalizeTCMItems(data.tcmDiagnoses || []),
            tcmSyndromes: this.normalizeTCMItems(data.tcmSyndromes || []),
            tcmTreatments: this.normalizeTCMItems(data.tcmTreatments || []),
            items: [
              ...this.catalog.items.filter(isExamOrLabItem),
              ...this.normalizeMedicalItems(data.items || []).filter((item) => !isExamOrLabItem(item)),
            ],
            medicines: this.normalizeMedicineItems(data.medicines || []),
          };
          console.log('[MedicalData] Restored from cache');
        }
      }
    } catch { /* ignore */ }
  }

  private loadDiagnosesFromRaw(raw: string): DiagnosisItem[] {
    return this.normalizeDiagnosisItems(this.parseCSV(raw));
  }

  private loadMedicinesFromRaw(raw: string): MedicineItem[] {
    return this.normalizeMedicineItems(this.parseCSV(raw));
  }

  private loadItemsFromRaw(raw: string): MedicalItem[] {
    return this.normalizeMedicalItems(this.parseCSV(raw));
  }

  private loadTCMItemsFromRaw(raw: string): TCMDiagnosisItem[] {
    const records = this.parseCSV(raw);
    return records.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      keywords: this.parseKeywords(r.keywords)
    }));
  }
}

export const medicalDataService = new MedicalDataService();
