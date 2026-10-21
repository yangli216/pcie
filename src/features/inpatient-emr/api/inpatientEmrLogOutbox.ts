import { reactive } from 'vue';
import { getRegionalConnectionConfig, regionalPost } from '@/services/regionalClient';
import type { InpatientLogSnapshot } from './inpatientEmrLogTypes';

export interface PendingInpatientLog { key: string; scope: string; snapshot: InpatientLogSnapshot; bytes: number }
export interface InpatientLogStorage {
  all(): Promise<PendingInpatientLog[]>;
  put(event: PendingInpatientLog): Promise<void>;
  remove(key: string): Promise<void>;
}
export function inpatientLogScope(): string {
  const config = getRegionalConnectionConfig();
  return JSON.stringify([config.baseUrl.replace(/\/+$/, ''), config.orgCode, config.deviceCode]);
}

class IndexedDbLogStorage implements InpatientLogStorage {
  private database?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    if (!this.database) this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pcie-inpatient-log-outbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('events', { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('日志本地存储不可用'));
      request.onblocked = () => reject(new Error('日志本地存储被占用'));
    }).catch(error => { this.database = undefined; throw error; });
    return this.database;
  }
  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', mode);
      const request = operation(tx.objectStore('events'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () => reject(new Error('日志本地存储操作失败'));
    });
  }
  all() { return this.transaction('readonly', store => store.getAll()) as Promise<PendingInpatientLog[]>; }
  async put(event: PendingInpatientLog) { await this.transaction('readwrite', store => store.put(event)); }
  async remove(key: string) { await this.transaction('readwrite', store => store.delete(key)); }
}

export function createInpatientLogOutbox(storage: InpatientLogStorage,
  post: (snapshot: InpatientLogSnapshot) => Promise<unknown>, currentScope: () => string) {
  const state = reactive({ pending: 0, error: '', uploading: false, unrecorded: 0 });
  const memory = new Map<string, PendingInpatientLog>();
  const missingMessage = () => state.unrecorded ? `有${state.unrecorded}次住院日志未能创建，无法自动补传，请联系管理员。` : '';
  let work = Promise.resolve();
  let sending: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  const serialize = (action: () => Promise<void>) => {
    const result = work.then(action); work = result.catch(() => undefined); return result;
  };
  async function persist(entry: PendingInpatientLog) {
    const existing = (await storage.all()).filter(item => item.key !== entry.key);
    if (entry.bytes > 1048576 || existing.length >= 100 || existing.reduce((sum, item) => sum + item.bytes, entry.bytes) > 8 * 1024 * 1024)
      throw new Error('日志待传队列超限');
    await storage.put(entry);
  }
  async function load(): Promise<PendingInpatientLog[]> {
    const entries = await storage.all();
    const map = new Map(entries.map(entry => [entry.key, entry]));
    for (const [key, value] of memory) map.set(key, value);
    return [...map.values()];
  }
  function schedule() {
    if (retryTimer) clearTimeout(retryTimer);
    if (state.pending > 0 || (state.error && !state.unrecorded)) retryTimer = setTimeout(() => { retryTimer = undefined; void flush(); }, 30000);
  }
  async function flush(): Promise<void> {
    if (sending) return sending;
    sending = (async () => {
      await work;
      state.uploading = true;
      try {
        const scope = currentScope();
        const entries = (await load()).filter(entry => entry.scope === scope)
          .sort((a, b) => a.snapshot.generationStartedAt - b.snapshot.generationStartedAt || a.snapshot.sequence - b.snapshot.sequence);
        state.pending = entries.length;
        state.error = missingMessage();
        for (const entry of entries) {
          if (currentScope() !== scope) break;
          // Retry in-memory storage failures before transmitting; acknowledgement is the only deletion path.
          if (memory.has(entry.key)) {
            await serialize(async () => { await persist(entry); memory.delete(entry.key); });
          }
          await post(entry.snapshot);
          await serialize(async () => {
            await storage.remove(entry.key);
            state.pending = (await load()).filter(item => item.scope === currentScope()).length;
          });
        }
      } catch {
        state.error = '住院日志尚未完成补传，请重试；未落盘的记录需保持客户端运行。';
      } finally { state.uploading = false; }
    })().finally(() => { sending = null; schedule(); });
    return sending;
  }
  async function enqueue(snapshot: InpatientLogSnapshot, scope: string): Promise<void> {
    await serialize(async () => {
      const copy = JSON.parse(JSON.stringify(snapshot)) as InpatientLogSnapshot;
      const entry = { key: `${scope}/${copy.eventId}`, scope, snapshot: copy, bytes: new TextEncoder().encode(JSON.stringify(copy)).length };
      memory.set(entry.key, entry);
      try {
        await persist(entry); memory.delete(entry.key);
        state.error = missingMessage();
      } catch { state.error = '住院日志未能写入本地待传队列，请保持客户端运行并重试。'; }
      try { state.pending = (await load()).filter(item => item.scope === currentScope()).length; }
      catch { state.pending = [...memory.values()].filter(item => item.scope === currentScope()).length; }
    });
    void flush();
  }
  return { state, enqueue, flush, reportMissing: () => { state.unrecorded++; state.error = missingMessage(); }, stop: () => { if (retryTimer) clearTimeout(retryTimer); retryTimer = undefined; } };
}
const outbox = createInpatientLogOutbox(new IndexedDbLogStorage(), async snapshot => {
  const acknowledgement = await regionalPost<{ idLog: string }>('/v1/client/user-logs/inpatient-emr/events', snapshot);
  if (!acknowledgement?.idLog) throw new Error('住院日志确认响应缺失');
}, inpatientLogScope);
export const inpatientLogUpload = outbox.state;
export const enqueueInpatientLog = outbox.enqueue;
export const retryInpatientLogs = outbox.flush;

export function reportInpatientLogFailure() { outbox.reportMissing(); }
