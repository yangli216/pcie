import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/regionalClient', () => ({ getDeviceCode: vi.fn(async () => 'device'), getRegionalConnectionConfig: () => ({baseUrl:'https://server', orgCode:'org', deviceCode:'device'}), regionalPost: vi.fn() }));
vi.mock('./inpatientEmrLogOutbox', () => ({ enqueueInpatientLog: vi.fn(), inpatientLogScope: () => 'server-org-device' }));
import { createInpatientLogSession } from './inpatientEmrLog';
import { setFeedbackActor, clearFeedbackActor } from '@/services/feedbackContext';
import type { InpatientLogSnapshot } from './inpatientEmrLogTypes';
import type { InpatientEmrGenerationRequest, InpatientEmrGenerationResult } from '../types';
const request: InpatientEmrGenerationRequest = {admissionId:'admission-1',templateId:'tpl',templateName:'首次病程',htmlContent:'<b>template</b>',recordTime:'2026-10-01',doctorSupplement:'医生原始补充',patient:{idPi:'patient',ageText:'6月'}};
function result(): InpatientEmrGenerationResult {
  return {request, context:{documentContext:{recordTime:'2026-10-01'},registration:{patientId:'patient',ageText:'6月'},aiContext:{raw:{secret:'RAW_SECRET'},orders:{summary:'本次医嘱摘要'}},outpatientRecord:{plainText:'引用正文'}},
    template:{fields:[{id:'f1',name:'病程',article:'正文',rule:{source:'ai'}},{id:'f2',name:'姓名',rule:{source:'his_or_system'}}]},
    fieldValues:{f1:'AI原稿',f2:'患者姓名'},initialFieldValues:{f1:'AI原稿',f2:'患者姓名'}, evidenceSummary:{hisContext:{status:'used'},outpatientRecord:{status:'used'}}} as unknown as InpatientEmrGenerationResult;
}
describe('inpatient business log snapshots', () => {
  beforeEach(() => clearFeedbackActor());
  it('freezes actor, original template and generated/final values while keeping source provenance', async () => {
    setFeedbackActor({doctorId:'d1',doctorName:'原医生',hisOrgId:'h1',orgName:'原机构'});
    const events: InpatientLogSnapshot[]=[];
    const session=await createInpatientLogSession(request, async snapshot=>{events.push(snapshot)});
    setFeedbackActor({doctorName:'后续医生'});
    const generated=result();
    await session.record('started'); await session.record('generated', generated);
    generated.fieldValues={f1:'医生修改稿',f2:'患者姓名'};
    generated.request={...request,requestId:'write-1'};
    await session.record('writeback_requested',generated,undefined,generated.fieldValues);
    generated.fieldValues.f1='发送后变化';
    await session.record('writeback_success',generated);
    expect(events[3]).toMatchObject({doctorName:'原医生',orgName:'原机构',patientAge:'6月',status:'writeback_success',requestId:'write-1'});
    expect(events[3].fields[0]).toMatchObject({generatedValue:'AI原稿',finalValue:'医生修改稿'});
    expect(events[3].fields[1].source).toBe('his_or_system');
    expect(events[3].sources.map(s=>s.text)).toEqual(['医生原始补充','本次医嘱摘要','引用正文']);
    expect(JSON.stringify(events)).not.toContain('RAW_SECRET');
    expect(events[0].templateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(events.map(e=>e.sequence)).toEqual([1,2,3,4]);
    expect(new Set(events.map(e=>e.eventId)).size).toBe(4);
    await session.record('abandoned',generated); expect(events).toHaveLength(4);
  });
  it('gives repeated generation of the same document distinct UUIDs and keeps missing identity missing', async () => {
    const events: InpatientLogSnapshot[]=[]; const enqueue=async (s:InpatientLogSnapshot)=>{events.push(s)};
    const first=await createInpatientLogSession(request,enqueue); const second=await createInpatientLogSession(request,enqueue);
    await first.record('generation_failed'); await second.record('started');
    expect(first.generationId).not.toBe(second.generationId);
    expect(events[0].doctorName).toBeUndefined(); expect(events[0].fields).toEqual([]);
  });
});
