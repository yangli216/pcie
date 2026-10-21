import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({generate:vi.fn(),invoke:vi.fn(),sessions:[] as Array<{terminal:boolean;record:ReturnType<typeof vi.fn>}>}));
vi.mock('../api/inpatientEmrService',()=>({generateInpatientEmrPreviewStream:mocks.generate}));
vi.mock('@tauri-apps/api/core',()=>({invoke:mocks.invoke}));
vi.mock('./inpatientEmrTraceLog',()=>({recordInpatientEmrTraceLog:vi.fn(),recordInpatientEmrFailureTraceLog:vi.fn()}));
vi.mock('../api/inpatientEmrLogOutbox',()=>({retryInpatientLogs:vi.fn(),reportInpatientLogFailure:vi.fn()}));
vi.mock('../api/inpatientEmrLog',()=>({createInpatientLogSession:vi.fn(async()=>{
 const session={generationId:'round-'+mocks.sessions.length,terminal:false,record:vi.fn(async(type:string)=>{if(['abandoned','superseded','writeback_success'].includes(type))session.terminal=true})};mocks.sessions.push(session);return session;
})}));
import { useInpatientEmrGeneration } from './useInpatientEmrGeneration';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult } from '../types';
const request=(admissionId='a1'):InpatientEmrGenerationRequest=>({admissionId,templateId:'t1',templateName:'日常病程',htmlContent:'<p/>',requestId:'req-'+admissionId});
function generated(req=request(),status='used'):InpatientEmrGenerationResult{return {request:req,fieldValues:{f:'AI'},initialFieldValues:{f:'AI'},emrContent:'AI',htmlContent:'<p>AI</p>',context:{},template:{fields:[{id:'f',aiSuitable:true}]},trace:{traceId:'trace',startedAt:1,stages:[]},evidenceSummary:{aiGeneration:{status}},generatedAt:1} as unknown as InpatientEmrGenerationResult}
beforeEach(()=>{mocks.sessions.length=0;mocks.generate.mockReset();mocks.invoke.mockReset();mocks.generate.mockImplementation(async req=>generated(req));mocks.invoke.mockResolvedValue(undefined)});
describe('inpatient log lifecycle',()=>{
 it('keeps dispatch pending and accepts only exact pending admission/request feedback',async()=>{
  const model=useInpatientEmrGeneration();await model.start(request());await model.writeBack();expect(model.writebackStatus.value).toBe('pending');
  for(const payload of [{status:'success'},{status:'success',consultationId:'other',requestId:'req-a1'},{status:'success',consultationId:'a1',requestId:'old'}])
   expect(model.applyReferenceFeedback(payload as Parameters<typeof model.applyReferenceFeedback>[0])).toBeNull();
  expect(await model.abandon()).toBe(false);await model.start(request());expect(mocks.generate).toHaveBeenCalledTimes(1);
  expect(model.applyReferenceFeedback({status:'success',consultationId:'a1',requestId:'req-a1'})).toBe('success');expect(model.writebackStatus.value).toBe('success');
  expect(model.applyReferenceFeedback({status:'failed',consultationId:'a1',requestId:'req-a1'})).toBeNull();
 });
 it('freezes the final sent values and allows retry after a failed callback',async()=>{
  const model=useInpatientEmrGeneration();await model.start(request());model.updateFieldValue('f','医生稿');await model.writeBack();model.updateFieldValue('f','发送后修改');
  expect(model.applyReferenceFeedback({status:'failed',consultationId:'a1',requestId:'req-a1'})).toBe('failed');
  const failure=mocks.sessions[0].record.mock.calls.find(call=>call[0]==='writeback_failed');
  expect((failure?.[1] as InpatientEmrGenerationResult).fieldValues.f).toBe('医生稿');
  await model.writeBack();expect(mocks.invoke).toHaveBeenCalledTimes(2);
  expect(model.pendingWritebackRequestId.value).not.toBe('req-a1');
  expect(model.applyReferenceFeedback({status:'success',consultationId:'a1',requestId:'req-a1'})).toBeNull();
 });
 it('does not regress when feedback arrives before dispatch invocation resolves',async()=>{
  const model=useInpatientEmrGeneration();await model.start(request());
  mocks.invoke.mockImplementation(async()=>{model.applyReferenceFeedback({status:'success',consultationId:'a1',requestId:'req-a1'})});
  await model.writeBack();expect(model.writebackStatus.value).toBe('success');
 });
 it('records explicit abandonment and gives regeneration a separate session',async()=>{
  const model=useInpatientEmrGeneration();await model.start(request());await model.start(request());
  expect(mocks.sessions[0].record).toHaveBeenCalledWith('superseded',expect.anything(),undefined,{f:'AI'});
  expect(await model.abandon()).toBe(true);expect(mocks.sessions[1].record).toHaveBeenCalledWith('abandoned',expect.anything(),undefined,{f:'AI'});expect(model.result.value).toBeNull();
 });
 it('ignores late streaming results and callbacks after a new patient starts',async()=>{
  let finish!:(r:InpatientEmrGenerationResult)=>void;let partial!:(r:InpatientEmrGenerationResult)=>void;
  mocks.generate.mockImplementationOnce((_request,_progress,onPartial)=>{partial=onPartial;return new Promise(r=>{finish=r})});
  const model=useInpatientEmrGeneration();const first=model.start(request('old'));await vi.waitFor(()=>expect(mocks.generate).toHaveBeenCalledTimes(1));
  await model.start(request('new'));partial(generated(request('old')));finish(generated(request('old')));await first;
  expect(model.result.value?.request.admissionId).toBe('new');expect(model.isGenerating.value).toBe(false);
  expect(model.applyReferenceFeedback({status:'success',consultationId:'old',requestId:'req-old'})).toBeNull();
 });
 it.each([['waiting','waiting'],['failed','fallback'],['used','generated']])('records %s distinctly',async(status,event)=>{
  mocks.generate.mockResolvedValue(generated(request(),status));const model=useInpatientEmrGeneration();await model.start(request());expect(mocks.sessions[0].record).toHaveBeenCalledWith(event,expect.anything());
 });
 it('records generation and dispatch failures without claiming success',async()=>{
  mocks.generate.mockRejectedValueOnce(new Error('upstream'));const model=useInpatientEmrGeneration();await model.start(request());expect(mocks.sessions[0].record).toHaveBeenCalledWith('generation_failed',null,'住院病历生成失败');
  await model.start(request());mocks.invoke.mockRejectedValueOnce(new Error('dispatch'));expect(await model.writeBack()).toBe(false);expect(model.writebackStatus.value).toBe('error');
 });
});
