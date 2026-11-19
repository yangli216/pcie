import { computed, ref } from 'vue';
import { state, content } from './fixtures';
export function useInpatientEmrGeneration() {
  const result = ref<any>(null);
  const isGenerating = ref(false);
  const isWritingBack = ref(false);
  const errorMessage = ref('');
  const writebackStatus = ref('idle');
  const writebackMessage = ref('');
  const steps = ref<any[]>([]);
  const pendingWritebackRequestId = ref('');
  const titles = ['获取住院上下文', '整理诊疗摘要', '整理病历依据', '解析病历', 'AI 生成'];
  async function start(request: any) {
    await Promise.resolve();
    isGenerating.value = state.value === 'generating';
    errorMessage.value = state.value === 'error' ? '生成过程中连接中断，已保留当前草稿，可补充要点后重新生成。' : '';
    writebackStatus.value = state.value === 'pending' ? 'pending' : 'idle';
    pendingWritebackRequestId.value = state.value === 'pending' ? request.requestId : '';
    writebackMessage.value = state.value === 'pending' ? '已发送，等待 HIS 回执' : '';
    steps.value = ['patient','orders','temperature','template','generate'].map((key, index) => ({ key, title: titles[index], description: '', detail: ['已获取本次住院合成资料', '诊断及医嘱资料已整理', '已使用医生补充要点', '识别到 6 个可生成字段', '已生成病历草稿，请核对'][index], status: index === 4 && state.value === 'generating' ? 'running' : index === 4 && state.value === 'error' ? 'error' : 'done' }));
    const fields = Object.keys(content).map(id => ({ id, name:id, type:'text', readonly:false, key:false, meaning:`${id}：结合本次病历资料生成，待医生核对。`, aiSuitable:true, rule:{ source:'ai', promptIntent:'病历正文', constraints:['只使用已提供的合成资料。'] } }));
    const source = (detail:string, extra = {}) => ({ title: detail, status:'used', detail, ...extra });
    result.value = { request, template: { cacheKey:'SYN', cacheHit:true, fields }, context:{ documentContext:{ templateId:request.templateId, templateName:request.templateName, recordType:'病程记录', recordTime:request.recordTime, recordDate:'2026-11-17' }, doctorSupplement:request.doctorSupplement, registration:null, orders:[], temperatureChart:null }, fieldValues:{ ...content }, initialFieldValues:{ ...content }, trace:{ traceId:'SYN-TRACE', startedAt:0, stages:[{key:'hisContext', title:'获取住院上下文', status:'success', durationMs:120, detail:'合成上下文'}, {key:'aiGenerate', title:'AI 生成', status:'success', durationMs:1800, detail:'合成生成结果'}] }, evidenceSummary:{ hisContext:source('已取得住院登记与合成诊疗资料', { meta:{ orderCount:3, labCount:1, examCount:1 } }), outpatientRecord:source('本次未引用历史门诊'), doctorSupplement:source('已使用医生补充要点'), template:source('解析当前病程模板，共 6 个生成字段'), aiGeneration:source('合成草稿已生成，等待医生确认') }, generatedAt:Date.now() };
  }
  return { result, isGenerating, isWritingBack, errorMessage, writebackStatus, writebackMessage, steps, pendingWritebackRequestId, activeStepKey:computed(()=>isGenerating.value?'generate':''), completedStepCount:computed(()=>steps.value.filter(x=>x.status==='done').length), start, updateFieldValue(id:string, value:string) { if(result.value) result.value.fieldValues[id]=value; }, async writeBack(){ writebackStatus.value='pending'; writebackMessage.value='已发送，等待 HIS 回执（合成）'; return true; }, applyReferenceFeedback(){return 'ignored';}, async abandon(){result.value=null;return true;}, reset(){ result.value=null;steps.value=[]; } };
}
