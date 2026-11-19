import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/regionalClient',()=>({getRegionalConnectionConfig:()=>({baseUrl:'https://test',orgCode:'org',deviceCode:'dev'}),regionalPost:vi.fn()}));
import { createInpatientLogOutbox, type InpatientLogStorage, type PendingInpatientLog } from './inpatientEmrLogOutbox';
import { createRegionalRequestError } from '@/services/regional/errors';
import type { InpatientLogSnapshot } from './inpatientEmrLogTypes';
class MemoryStorage implements InpatientLogStorage {
  items=new Map<string,PendingInpatientLog>(); fail=false;
  async all(){return [...this.items.values()]}
  async put(e:PendingInpatientLog){if(this.fail)throw new Error('full');this.items.set(e.key,e)}
  async remove(k:string){this.items.delete(k)}
}
const snapshot=(id:string,seq=1)=>({eventId:id,sequence:seq,generationStartedAt:1,generationId:'round'} as InpatientLogSnapshot);
const stops:Array<()=>void>=[];
afterEach(()=>{stops.splice(0).forEach(stop=>stop());vi.restoreAllMocks()});
function setup(storage:MemoryStorage,post:(s:InpatientLogSnapshot)=>Promise<unknown>,scope=()=> 'scope'){
 const outbox=createInpatientLogOutbox(storage,post,scope);stops.push(outbox.stop);return outbox;
}
describe('durable inpatient log upload',()=>{
 it('does not clear a missing-event warning by pretending a queue retry recovered it',async()=>{
  const storage=new MemoryStorage();const outbox=setup(storage,vi.fn(async()=>({})));
  outbox.reportMissing();await outbox.flush();expect(outbox.state.unrecorded).toBe(1);expect(outbox.state.error).toContain('无法自动补传');
 });
 it('retains a failed upload and restores it in a new instance without changing event ids',async()=>{
  const storage=new MemoryStorage();const post=vi.fn().mockRejectedValue(new Error('offline'));const first=setup(storage,post);
  await first.enqueue(snapshot('event1'),'scope');await first.flush();
  expect(storage.items.size).toBe(1);expect(first.state.error).toBeTruthy();first.stop();
  const success=vi.fn(async()=>({idLog:'id'}));const restored=setup(storage,success);await restored.flush();
  expect(success).toHaveBeenCalledWith(snapshot('event1'));expect(storage.items.size).toBe(0);expect(restored.state.pending).toBe(0);
 });
 it('does not send old-environment events to a different server/organization',async()=>{
  const storage=new MemoryStorage();const post=vi.fn(async()=>({}));const outbox=setup(storage,post,()=> 'new-scope');
  await outbox.enqueue(snapshot('event'),'old-scope');await outbox.flush();expect(post).not.toHaveBeenCalled();expect(storage.items.size).toBe(1);
 });
 it('can persist the next event while a network upload is blocked',async()=>{
  const storage=new MemoryStorage();let finish!:()=>void;const post=vi.fn(()=>new Promise<void>(r=>{finish=r}));const outbox=setup(storage,post);
  await outbox.enqueue(snapshot('one'),'scope');await vi.waitFor(()=>expect(post).toHaveBeenCalled());
  await outbox.enqueue(snapshot('two',2),'scope');expect(storage.items.size).toBe(2);
  finish();await outbox.flush();expect(storage.items.size).toBe(1);
 });
 it('keeps storage failures in memory and retries after storage recovers',async()=>{
  const storage=new MemoryStorage();storage.fail=true;const post=vi.fn(async()=>({}));const outbox=setup(storage,post);
  await outbox.enqueue(snapshot('one'),'scope');await outbox.flush();expect(outbox.state.error).toBeTruthy();expect(post).not.toHaveBeenCalled();
  storage.fail=false;await outbox.flush();expect(post).toHaveBeenCalledTimes(1);expect(outbox.state.pending).toBe(0);
 });
 it('keeps a rejected generation ordered while an independent generation drains and retries the original events', async () => {
  const storage = new MemoryStorage();
  const events = [snapshot('old-start'), snapshot('old-end', 2),
    { ...snapshot('new-start'), generationId: 'new', generationStartedAt: 2 }];
  for (const event of events) {
    await storage.put({ key: `scope/${event.eventId}`, scope: 'scope', snapshot: event, bytes: 100 });
  }
  const requestId = '2ac77e30-d717-40be-b954-6f03b036df57';
  const rejection = createRegionalRequestError({ code: 'BIZ-001', message: 'private clinical details' }, 'failed', 400, requestId);
  const post = vi.fn(async (_s: InpatientLogSnapshot) => ({})).mockRejectedValueOnce(rejection);
  const outbox = setup(storage, post);
  await outbox.flush();
  expect(post.mock.calls.map(([event]) => event.eventId)).toEqual(['old-start', 'new-start']);
  expect(outbox.state).toMatchObject({ uploading: false, pending: 2 });
  expect(outbox.state.error).toContain('HTTP 400');
  expect(outbox.state.error).toContain(requestId);
  expect(outbox.state.error).not.toContain('private');
  await outbox.flush();
  expect(post.mock.calls.slice(2).map(([event]) => event)).toEqual(events.slice(0, 2));
  expect(outbox.state).toMatchObject({ pending: 0, error: '' });
 });
 it('stops a flush on connection failure without trying the other generations', async () => {
  const storage = new MemoryStorage();
  for (const id of ['first', 'second']) {
    await storage.put({ key: id, scope: 'scope', snapshot: { ...snapshot(id), generationId: id }, bytes: 100 });
  }
  const post = vi.fn().mockRejectedValue(Object.assign(new Error('超时'), { name: 'TimeoutError' }));
  const outbox = setup(storage, post);
  await outbox.flush();
  expect(post).toHaveBeenCalledTimes(1);
  expect(outbox.state).toMatchObject({ pending: 2, uploading: false });
  expect(outbox.state.error).toContain('超时');
  expect(outbox.state.error).not.toContain('未落盘');
 });
 it('drains stored events even when the oldest in-memory event cannot fit until space is freed', async () => {
  const storage = new MemoryStorage();
  const large = { ...snapshot('durable'), generationId: 'later', generationStartedAt: 2 };
  await storage.put({ key: 'scope/durable', scope: 'scope', snapshot: large, bytes: 8 * 1024 * 1024 });
  const post = vi.fn(async (_event: InpatientLogSnapshot) => ({}));
  const outbox = setup(storage, post);
  const oldest = snapshot('in-memory');
  await outbox.enqueue(oldest, 'scope');
  await outbox.flush();
  expect(post.mock.calls.map(([event]) => event)).toEqual([large]);
  expect(outbox.state).toMatchObject({ pending: 1, uploading: false });
  expect(outbox.state.error).toContain('未落盘');
  await outbox.flush();
  expect(post.mock.calls[1]).toEqual([oldest]);
  expect(outbox.state).toMatchObject({ pending: 0, error: '' });
 });
 it('replays the same confirmed event after a local delete failure, then stops automatic retry when empty', async () => {
  vi.useFakeTimers();
  try {
   const storage = new MemoryStorage();
   const event = snapshot('awaiting-delete');
   const key = `scope/${event.eventId}`;
   await storage.put({ key, scope: 'scope', snapshot: event, bytes: 100 });
   vi.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('database unavailable'));
   const post = vi.fn(async (_event: InpatientLogSnapshot) => ({}));
   const outbox = setup(storage, post);
   await outbox.flush();
   expect(storage.items.get(key)?.snapshot).toEqual(event);
   expect(outbox.state.uploading).toBe(false);
   await vi.advanceTimersByTimeAsync(29_999);
   expect(post).toHaveBeenCalledTimes(1);
   await vi.advanceTimersByTimeAsync(1);
   expect(post.mock.calls).toEqual([[event], [event]]);
   expect(outbox.state).toMatchObject({ pending: 0, uploading: false, error: '' });
   await vi.advanceTimersByTimeAsync(120_000);
   expect(post).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
 });
 it('does not send a memory event when the connection scope changes while recovering persistence', async () => {
  const storage = new MemoryStorage();
  storage.fail = true;
  let scope = 'scope';
  const post = vi.fn(async () => ({}));
  const outbox = setup(storage, post, () => scope);
  const event = snapshot('local-failure');
  await outbox.enqueue(event, scope);
  await outbox.flush();
  storage.fail = false;
  const put = storage.put.bind(storage);
  vi.spyOn(storage, 'put').mockImplementation(async entry => { await put(entry); scope = 'other'; });
  await outbox.flush();
  expect(post).not.toHaveBeenCalled();
  expect(storage.items.get('scope/local-failure')?.snapshot).toEqual(event);
  scope = 'scope';
  await outbox.flush();
  expect(post).toHaveBeenCalledOnce();
 });
 it('does not evict queued events on overflow or upload oversized bodies',async()=>{
  const storage=new MemoryStorage();const post=vi.fn(async()=>({}));const outbox=setup(storage,post);
  const large={...snapshot('big'),message:'x'.repeat(1048576)};await outbox.enqueue(large,'scope');await outbox.flush();
  expect(outbox.state.error).toBeTruthy();expect(post).not.toHaveBeenCalled();expect(outbox.state.pending).toBe(1);
 });
});
