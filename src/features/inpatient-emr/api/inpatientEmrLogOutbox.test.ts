import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/regionalClient',()=>({getRegionalConnectionConfig:()=>({baseUrl:'https://test',orgCode:'org',deviceCode:'dev'}),regionalPost:vi.fn()}));
import { createInpatientLogOutbox, type InpatientLogStorage, type PendingInpatientLog } from './inpatientEmrLogOutbox';
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
 it('does not evict queued events on overflow or upload oversized bodies',async()=>{
  const storage=new MemoryStorage();const post=vi.fn(async()=>({}));const outbox=setup(storage,post);
  const large={...snapshot('big'),message:'x'.repeat(1048576)};await outbox.enqueue(large,'scope');await outbox.flush();
  expect(outbox.state.error).toBeTruthy();expect(post).not.toHaveBeenCalled();expect(outbox.state.pending).toBe(1);
 });
});
