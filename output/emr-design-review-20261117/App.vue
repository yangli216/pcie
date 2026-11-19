<script setup lang="ts">
import { computed, ref } from 'vue';
import InpatientEmrPage from '@features/inpatient-emr/ui/InpatientEmrPage.vue';
import OutpatientEmrPage from '@features/outpatient-emr/ui/OutpatientEmrPage.vue';
import { state, inpatientRequest, outpatientRequest } from './fixtures';
const page=ref('inpatient'), width=ref(1280), version=ref(0);
const key=computed(()=>`${page.value}-${state.value}-${version.value}`);
const message=ref('');
</script>
<template>
  <div class="review-toolbar">
    <strong>PCIE 病历界面对照</strong><span class="synthetic">合成资料 · 无真实服务</span>
    <label>页面 <select v-model="page" aria-label="页面"><option value="inpatient">住院病历生成</option><option value="outpatient">门诊病历</option></select></label>
    <label>状态 <select v-model="state" aria-label="状态"><option value="ready">生成完成</option><option value="generating">生成中</option><option value="error">失败</option><option value="pending">等待 HIS 回执</option><option value="empty">空态</option></select></label>
    <label>宽度 <select v-model="width" aria-label="宽度"><option :value="640">640</option><option :value="1024">1024</option><option :value="1280">1280</option></select></label>
    <button @click="version++;message=''">重置</button><span>{{ message }}</span>
  </div>
  <div class="preview-frame" :style="{width:width+'px'}">
    <InpatientEmrPage v-if="page==='inpatient'" :key="key" :request="state==='empty'?null:inpatientRequest" @cancel="message='已放弃本次合成生成'" @close="message='已触发收起（合成预览）'" />
    <OutpatientEmrPage v-else :key="key" :request="state==='empty'?null:outpatientRequest" @cancel="message='已放弃本次合成分析'" @close="message='已触发收起（合成预览）'" />
  </div>
</template>
<style>
*{box-sizing:border-box}html,body,#app{margin:0;height:100vh;min-height:0;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}#app{display:flex;flex-direction:column;overflow:hidden}body{background:#dce3ec;color:#172033}.review-toolbar{min-height:58px;display:flex;flex-shrink:0;align-items:center;gap:16px;padding:10px 16px;background:#fff;border-bottom:1px solid #cbd5e1;font-size:12px;flex-wrap:wrap}.review-toolbar label{display:flex;align-items:center;gap:5px}.review-toolbar select,.review-toolbar button{font:inherit;padding:5px 8px;border:1px solid #cbd5e1;border-radius:5px;background:#fff;color:#334155}.synthetic{color:#a16207}.preview-frame{flex:1;min-height:0;height:auto;max-width:100%;margin:10px auto;background:#fff;box-shadow:0 10px 40px #17203322;overflow:hidden;container-type:inline-size}
</style>
