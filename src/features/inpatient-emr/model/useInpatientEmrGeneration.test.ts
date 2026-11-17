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
import { createInpatientLogSession } from '../api/inpatientEmrLog';
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
 it.each([['waiting','waiting'],['used','generated']])('records %s distinctly',async(status,event)=>{
  mocks.generate.mockResolvedValue(generated(request(),status));const model=useInpatientEmrGeneration();await model.start(request());expect(mocks.sessions[0].record).toHaveBeenCalledWith(event,expect.anything());
 });
 it('keeps failed drafts available for doctor correction without reporting a completed generation',async()=>{
  mocks.generate.mockImplementation(async(req,onProgress)=>{
   for(const key of ['patient','orders','temperature','template','generate']) onProgress({key,status:'done'});
   return generated(req,'failed');
  });
  const model=useInpatientEmrGeneration();await model.start(request());
  expect(model.result.value?.fieldValues.f).toBe('AI');
  expect(model.steps.value.find(step=>step.key==='generate')?.status).toBe('error');
  expect(model.completedStepCount.value).toBe(4);
  expect(model.errorMessage.value).toContain('未完整生成');
  expect(mocks.sessions[0].record).toHaveBeenCalledWith('generation_failed',expect.anything(),'住院病历生成失败');
  expect(mocks.sessions[0].record.mock.calls.some(call=>call[0]==='generated'||call[0]==='fallback')).toBe(false);
  model.updateFieldValue('f','医生核对后的正文');
  expect(await model.writeBack()).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('complete_consultation',expect.objectContaining({result:expect.objectContaining({fieldValues:{f:'医生核对后的正文'}})}));
 });
 it('rejects late stream updates after failure so they cannot overwrite doctor edits or the failed step',async()=>{
  let progress!:(value:{key:string;status:string})=>void;
  let partial!:(value:InpatientEmrGenerationResult)=>void;
  mocks.generate.mockImplementation(async(req,onProgress,onPartial)=>{
   progress=onProgress;partial=onPartial;onProgress({key:'generate',status:'running'});onPartial(generated(req,'failed'));throw new Error('生成未完整完成');
  });
  const model=useInpatientEmrGeneration();await model.start(request());model.updateFieldValue('f','医生稿');
  partial(generated(request()));progress({key:'generate',status:'done'});
  expect(model.result.value?.fieldValues.f).toBe('医生稿');
  expect(model.steps.value.find(step=>step.key==='generate')?.status).toBe('error');
  expect(model.errorMessage.value).toBe('生成未完整完成');
 });
 it('records generation and dispatch failures without claiming success',async()=>{
  mocks.generate.mockRejectedValueOnce(new Error('upstream'));const model=useInpatientEmrGeneration();await model.start(request());expect(mocks.sessions[0].record).toHaveBeenCalledWith('generation_failed',null,'住院病历生成失败');
  await model.start(request());mocks.invoke.mockRejectedValueOnce(new Error('dispatch'));expect(await model.writeBack()).toBe(false);expect(model.writebackStatus.value).toBe('error');
 });
});

describe('inpatient field editing guards', () => {
 it('accepts only current AI fields and preserves the AI original in the final payload', async () => {
  const preview = generated();
  preview.template.fields.push({ id: 'patientName', aiSuitable: false } as typeof preview.template.fields[number]);
  preview.fieldValues.patientName = '合成患者';
  preview.initialFieldValues.patientName = '合成患者';
  mocks.generate.mockResolvedValue(preview);
  const model = useInpatientEmrGeneration();
  model.updateFieldValue('f', '未开始前的编辑');
  expect(model.result.value).toBeNull();
  await model.start(request());
  model.updateFieldValue('unknown', '越界字段');
  model.updateFieldValue('patientName', '不能修改系统字段');
  model.updateFieldValue('f', '医生核对稿');
  expect(model.result.value?.fieldValues).toEqual({ f: '医生核对稿', patientName: '合成患者' });
  expect(model.result.value?.initialFieldValues).toEqual({ f: 'AI', patientName: '合成患者' });
  expect(await model.writeBack()).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith('complete_consultation', expect.objectContaining({
   result: expect.objectContaining({ fieldValues: { f: '医生核对稿' } }),
  }));
 });

 it('keeps a streaming partial draft read only until generation finishes', async () => {
  let finish!: (value: InpatientEmrGenerationResult) => void;
  mocks.generate.mockImplementation((req, _onProgress, onPartial) => {
   onPartial(generated(req));
   return new Promise<InpatientEmrGenerationResult>((resolve) => { finish = resolve; });
  });
  const model = useInpatientEmrGeneration();
  const running = model.start(request());
  await vi.waitFor(() => expect(model.result.value?.fieldValues.f).toBe('AI'));
  model.updateFieldValue('f', '生成时不得编辑');
  expect(model.result.value?.fieldValues.f).toBe('AI');
  finish(generated());
  await running;
  model.updateFieldValue('f', '生成完成后编辑');
  expect(model.result.value?.fieldValues.f).toBe('生成完成后编辑');
 });

 it('locks sending and pending values, then allows edits after failed HIS feedback', async () => {
  let finishDispatch!: () => void;
  mocks.invoke.mockImplementation(() => new Promise<void>((resolve) => { finishDispatch = resolve; }));
  const model = useInpatientEmrGeneration();
  await model.start(request());
  model.updateFieldValue('f', '发送前医生稿');
  const dispatch = model.writeBack();
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
  expect(model.isWritingBack.value).toBe(true);
  model.updateFieldValue('f', '发送时不得编辑');
  expect(model.result.value?.fieldValues.f).toBe('发送前医生稿');
  finishDispatch();
  await dispatch;
  expect(model.isWritingBack.value).toBe(false);
  model.updateFieldValue('f', '等待回执时不得编辑');
  expect(model.result.value?.fieldValues.f).toBe('发送前医生稿');
  expect(await model.writeBack()).toBe(false);
  expect(model.applyReferenceFeedback({ consultationId: 'a1', requestId: 'req-a1', status: 'failed' })).toBe('failed');
  model.updateFieldValue('f', '失败后调整');
  expect(model.result.value?.fieldValues.f).toBe('失败后调整');
  expect(model.result.value?.initialFieldValues.f).toBe('AI');
 });

 it('locks successful drafts and blocks duplicate dispatch even when logging is unavailable', async () => {
  vi.mocked(createInpatientLogSession).mockRejectedValueOnce(new Error('合成日志初始化失败'));
  const model = useInpatientEmrGeneration();
  await model.start(request());
  model.updateFieldValue('f', '已回填稿');
  await model.writeBack();
  expect(model.applyReferenceFeedback({ consultationId: 'a1', requestId: 'req-a1', status: 'success' })).toBe('success');
  expect(model.pendingWritebackRequestId.value).toBe('');
  model.updateFieldValue('f', '成功后不得编辑');
  expect(model.result.value?.fieldValues.f).toBe('已回填稿');
  expect(await model.writeBack()).toBe(false);
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
});
