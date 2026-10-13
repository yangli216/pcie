<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { PatientHeader } from '@entities/patient';
import PublicHealthFactsPanel from './PublicHealthFactsPanel.vue';
import PublicHealthFactsDialog from './PublicHealthFactsDialog.vue';
import PublicHealthResultSections from './PublicHealthResultSections.vue';
import PublicHealthActionBar from './PublicHealthActionBar.vue';
import PublicHealthHealthProfile from './PublicHealthHealthProfile.vue';
import PublicHealthDoctorNotes from './PublicHealthDoctorNotes.vue';
import { CAPABILITY_TITLES, characterCount, SCENE_TITLES } from '../lib/publicHealthContract';
import { buildPublicHealthHealthProfile } from '../lib/publicHealthHealthProfile';
import { assertPatientFacingContent } from '../lib/publicHealthPatientText';
import type { PublicHealthController } from '../model/usePublicHealthController';
import type { PublicHealthManualFacts } from '../types';
const props = defineProps<{ controller: PublicHealthController }>();
const emit = defineEmits<{ close: [] }>();
const c = props.controller;
const { request, state, result, sections, metrics, values, selected, selectedMealOptionId, mealOptionValues, missing, editable, busy, message, frozen, canGenerate, canWriteback, reconnectable, sending } = c;
const factsOpen = shallowRef(false), regenerateOpen = shallowRef(false), localError = shallowRef('');
const patient = computed(() => request.value ? {
  name: request.value.patient.name,
  sdSexText: ({ male: '男', female: '女', unknown: '性别待核对' })[request.value.patient.sex],
  ageText: `${request.value.patient.ageYears}岁`,
} : null);
const title = computed(() => request.value ? CAPABILITY_TITLES[request.value.capability] : '公卫助手');
const healthProfile = computed(() => request.value?.capability === 'health_prescription' ? buildPublicHealthHealthProfile(request.value) : null);
const statusLabel = computed(() => ({ idle: '等待调入', ready: '资料核对', generating: '生成中', reviewable: '待医生确认', 'generation-failed': '生成未完成', 'knowledge-missing': '知识未就绪', 'awaiting-writeback': '等待 PHIS 保存', saved: '保存成功', 'writeback-failed': '保存失败', conflict: '记录版本冲突', expired: '会话已失效' })[state.value]);
function saveFacts(input: PublicHealthManualFacts) {
  try { c.updateFacts(input); factsOpen.value = false; localError.value = ''; }
  catch (error) { localError.value = error instanceof Error ? error.message : '资料核对失败。'; }
}
function startGeneration() { if (result.value || frozen.value) regenerateOpen.value = true; else void c.generate(); }
function restoredNotice(value: string): string {
  if (characterCount(value) > 64000) return '正文超出 64000 字，请调整后确认。';
  try { assertPatientFacingContent(value); return ''; }
  catch { return '原正文包含内部说明或医生核实提醒，请调整患者正文后再确认。'; }
}
async function finish() {
  try { if (await c.close()) emit('close'); }
  catch { localError.value = '任务结束状态未确认，请稍后再试。'; }
}
</script>
<template>
  <article class="public-health-page" :aria-label="`${title} · ${statusLabel}`">
    <template v-if="request">
      <PatientHeader :patient="patient" pay-type=""><template #actions><span class="scene-tag">{{ SCENE_TITLES[request.scene] }}</span></template></PatientHeader>
      <div class="workspace">
        <PublicHealthFactsPanel :request="request" :disabled="busy || state === 'saved' || state === 'conflict' || state === 'expired'" :missing="missing" @edit="factsOpen = true; localError = ''" />
        <section class="result-card">
          <header class="result-heading"><div><h1>{{ title }}</h1><p>建议由医生核对确认后写入本次 PHIS 记录</p></div><span class="status" :class="state">{{ statusLabel }}</span></header>
          <div class="result-scroll">
            <p v-if="message" class="notice" :class="state" role="status">{{ message }}</p>
            <p v-if="localError && !factsOpen" class="notice error" role="alert">{{ localError }}</p>
            <PublicHealthHealthProfile v-if="healthProfile" :key="request.originRequestId" :profile="healthProfile" />
            <div v-if="!sections.length && !frozen" class="empty">
              <h2>{{ state === 'generating' ? '正在准备本次建议' : state === 'knowledge-missing' ? '所需知识内容尚未就绪' : missing.length ? '请先补齐必要资料' : '核对资料后开始生成' }}</h2>
              <p>{{ state === 'knowledge-missing' ? '请联系管理员补齐服务端知识配置。当前没有可供确认的医疗建议。' : missing.length ? missing.join('、') : '本页仅使用本次 PHIS 调入和医生明确补充的资料。' }}</p>
              <button v-if="missing.length && !busy" class="edit-facts" @click="factsOpen = true">补充资料</button>
            </div>
            <PublicHealthResultSections :sections="sections" :values="values" :selected="selected" :selected-meal-option-id="selectedMealOptionId" :meal-option-values="mealOptionValues" :editable="editable" :metrics="metrics" @edit="c.editSection" @meal-option="c.selectMealOption" @select="c.selectSection" @all="c.selectAll" />
            <template v-if="frozen && !result">
              <p class="mapping-note">已恢复上次确认正文及已选范围。保存失败时可调整正文后重新保存；修改章节范围需重新生成。</p>
              <section v-for="item in frozen.items" :key="item.targetFieldId" class="restored"><h2>{{ request.writebackTargets.find(target => target.targetFieldId === item.targetFieldId)?.label || '已提交正文' }}</h2><textarea v-if="state === 'writeback-failed'" :aria-label="`恢复正文：${request.writebackTargets.find(target => target.targetFieldId === item.targetFieldId)?.label || item.targetFieldId}`" :value="item.value" rows="5" @input="c.editRestoredTarget(item.targetFieldId, ($event.target as HTMLTextAreaElement).value)" /><pre v-else>{{ item.value }}</pre><p v-if="restoredNotice(item.value)" class="notice error">{{ restoredNotice(item.value) }}</p></section>
            </template>
            <PublicHealthDoctorNotes :warnings="result?.warnings ?? []" />
            <p v-if="result && request.writebackTargets.some(target => target.sourceSections.length > 1)" class="mapping-note">PHIS 使用合并指导字段，须完整选择该字段对应的全部章节才能回写。</p>
          </div>
        </section>
      </div>
      <PublicHealthActionBar :state="state" :can-generate="canGenerate" :can-writeback="canWriteback" :reconnectable="reconnectable" :selected-count="selected.length" :sending="sending" @generate="startGeneration" @stop="c.stopWaiting" @reconnect="c.generate(true)" @writeback="c.writeback" @close="finish" />
      <PublicHealthFactsDialog v-if="factsOpen" :request="request" @save="saveFacts" @close="factsOpen = false" />
      <p v-if="factsOpen && localError" class="dialog-error" role="alert">{{ localError }}</p>
      <div v-if="regenerateOpen" class="confirm-backdrop"><section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="确认重新生成"><h2>重新生成建议？</h2><p>重新生成将替换当前草稿，请先确认已完成的编辑无需保留。</p><div><button @click="regenerateOpen = false">保留草稿</button><button class="confirm-primary" @click="regenerateOpen = false; c.generate()">重新生成</button></div></section></div>
    </template>
    <div v-else class="empty"><h2>等待 PHIS 调入</h2><p>请从随访或老年人体检记录打开公卫助手。</p></div>
  </article>
</template>
<style scoped>
.public-health-page{display:flex;flex-direction:column;height:100%;min-height:0;background:#eef3f8;position:relative;color:#172033;font-size:13px}.scene-tag{color:#fff;background:#ffffff20;border:1px solid #ffffff40;border-radius:14px;padding:5px 10px;font-size:12px;white-space:nowrap}.workspace{display:grid;grid-template-columns:236px minmax(0,1fr);gap:16px;flex:1;min-height:0;padding:18px 20px 16px}.result-card{background:white;border-radius:8px;display:flex;flex-direction:column;overflow:hidden;min-height:0;box-shadow:0 12px 32px #0f172a0b}.result-heading{display:flex;align-items:flex-start;justify-content:space-between;padding:17px 20px 14px;border-bottom:1px solid #e7edf5;gap:12px}.result-heading h1{font-size:18px;margin:0;font-weight:650}.result-heading p{font-size:12px;color:#7a899e;margin:6px 0 0}.status{font-size:11px;border-radius:12px;color:#316cb5;background:#edf5ff;padding:4px 9px;white-space:nowrap}.result-scroll{flex:1;min-height:0;overflow:auto;padding:14px 18px 18px}.notice{border:1px solid #cfe1fc;background:#f2f7ff;color:#346498;border-radius:7px;padding:10px 12px;font-size:12px;line-height:1.7;margin:0 0 12px}.error,.conflict,.expired,.generation-failed,.writeback-failed{color:#a85248;background:#fff5f4;border-color:#f1d3cf}.warning,.knowledge-missing{background:#fff9ef;border-color:#f1dfbd;color:#9b6923}.saved{background:#f0faf5;border-color:#cce8d9;color:#2e7b53}.empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;flex:1;min-height:210px;padding:28px;color:#8291a6}.empty h2{font-size:17px;font-weight:600;color:#3b4e68;margin:0 0 12px}.empty p{line-height:1.8;max-width:430px}.edit-facts{color:#2469f2;background:#f2f7ff;border:1px solid #cee0fa;border-radius:6px;padding:8px 14px;margin-top:12px}.mapping-note{font-size:11px;color:#8291a6}.restored{border:1px solid #e1e9f3;border-radius:7px;padding:12px;margin-bottom:12px}.restored h2{font-size:13px}.restored textarea{box-sizing:border-box;width:100%;resize:vertical;min-height:120px;padding:10px;border:1px solid #c8d8ef;border-radius:5px;font:inherit;line-height:1.8;color:inherit;background:#fff}.restored pre{font:inherit;white-space:pre-wrap;line-height:1.8}.confirm-backdrop{position:absolute;inset:0;background:#172a4545;display:grid;place-items:center;z-index:30}.confirm-dialog{background:#fff;border-radius:12px;padding:24px;width:400px;box-shadow:0 20px 60px #11243d33}.confirm-dialog h2{margin:0 0 12px;font-size:17px}.confirm-dialog p{line-height:1.8;color:#6d8099}.confirm-dialog>div{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}.confirm-dialog button{padding:8px 14px;border:1px solid #d9e3ef;background:#fff;border-radius:6px;cursor:pointer}.confirm-dialog .confirm-primary{background:#2469f2;color:#fff;border-color:#2469f2}.dialog-error{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);background:#a85248;color:white;padding:10px 16px;border-radius:6px;z-index:60;max-width:80%}@media(max-width:850px){.workspace{grid-template-columns:200px minmax(0,1fr);gap:10px;padding:12px}.result-heading{padding:14px}.result-heading p{font-size:11px}}
</style>
