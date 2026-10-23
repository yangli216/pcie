<script setup lang="ts">
import { computed, ref } from 'vue';
import Panel from '../../src/features/consultation-result/ui/ChronicExaminationReminderPanel.vue';
import { buildChronicExaminationReminders } from '../../src/features/reception-risk/lib/chronicExaminationReminders';
import type { MedicalItem } from '../../src/services/medicalData';
const names = ['胰岛素释放试验','尿肾功能','颈动脉B超','餐后二小时血糖','腹部B超','C肽释放试验','下肢血管B超','葡萄糖耐量试验','四肢多普勒','足背动脉搏动','血脂','周围神经检查','同型半胱氨酸','空腹血糖','心电图','眼底检查','糖化血红蛋白'];
const lab = (id: string, name: string): MedicalItem => ({ id, code: id, idSrv: `srv-${id}`, name, category: '检验', idDeptExec: 'synthetic-lab', jsonField: '{"fgCombination":"0","idLisCategory":"synthetic-lis"}' });
 const mode=ref('ready');
 const result = computed(() => {
  const catalog: MedicalItem[] = [lab('hba','糖化血红蛋白测定'),lab('hcy','血同型半胱氨酸测定'),{id:'ecg',code:'ecg',idSrv:'srv-ecg',name:'常规心电图检查',category:'检查',idDeptExec:'synthetic-ecg',idPart:'synthetic-part'}];
  if(mode.value==='ambiguous') {catalog.push({...lab('hba-group','糖化血红蛋白'),jsonField:'{"fgCombination":"2"}'}); catalog[2]={...catalog[2],idPart:'',raw:{fgPart:'1'}};}
  return buildChronicExaminationReminders({ recommendations:mode.value==='failed'?[]:names.map(name => ({name,description:'',subItems:[]})), catalog,
   visits: [{visitId:'synthetic-prior',visitTime:Date.now()-86400000,reportedApplications:[{applicationId:'synthetic-report',name:'血同型半胱氨酸测定',type:'lab',status:'reported',requestedAt:'2026-10-21'}]}],
   currentVisitId:'synthetic-current',sourceStatus:mode.value==='failed'?'unavailable':'ready',catalogStatus:'ready',historyStatus:mode.value==='failed'?'partial':'complete' });
 });

</script>
<template><main :class="{edge:mode==='edge'}"><header class="demo-toolbar"><strong>合成资料预览 · 不连接真实患者或 PHIS</strong><nav><button @click="mode='ready'">唯一匹配</button><button @click="mode='ambiguous'">组套和部位歧义</button><button @click="mode='failed'">源失败</button><button @click="mode='edge'">窗口边缘</button></nav></header><div class="columns"><section class="record"><h3>病历详情</h3><p>合成门诊病历草稿</p><p>本页仅验证提醒组件、匹配规则和浮层交互。</p></section><section class="treatment"><h3>治疗方案</h3><Panel :reminders="result.reminders"/><h4>药品</h4><div class="card">合成药品卡片</div><h4>检查 / 检验</h4><div v-for="item in result.treatments" :key="item.name" class="card"><label><input type="checkbox"/> {{item.name}}</label><small>默认未选 · 合成实时目录</small></div><p v-if="!result.treatments.length">歧义项目只保留提醒，不生成医嘱候选</p><button class="outside">其他操作</button></section></div></main></template>
<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,'PingFang SC',sans-serif;background:#f5f7fb;color:#243143;font-size:14px}.demo-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:16px;background:white;border-bottom:1px solid #dce3ee}.demo-toolbar strong{font-size:13px;color:#805b18}nav{display:flex;gap:8px}button{font:inherit;cursor:pointer;padding:5px 10px;border:1px solid #ccd6e5;border-radius:5px;background:white}.columns{display:grid;grid-template-columns:1fr 1.1fr;gap:16px;padding:20px}.record,.treatment{background:white;padding:18px;border:1px solid #e0e5ed;border-radius:10px}h3{font-size:16px;margin:0 0 16px}h4{font-size:14px}.card{border:1px solid #dbe3ef;border-radius:8px;padding:16px;margin:10px 0}.card small{display:block;color:#748295;margin:5px 0 0 22px}input{accent-color:#4169db}.outside{margin-top:16px}.edge .columns{padding-top:calc(100vh - 220px)}.edge .record{visibility:hidden}@media(max-width:700px){.columns{grid-template-columns:1fr;padding:12px}.record{display:none}.demo-toolbar{align-items:flex-start;flex-direction:column}}</style>
