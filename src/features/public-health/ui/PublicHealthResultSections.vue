<script setup lang="ts">
import { computed } from 'vue';
import PublicHealthMealOptions from './PublicHealthMealOptions.vue';
import { characterCount } from '../lib/publicHealthContract';
import { assertPatientFacingContent } from '../lib/publicHealthPatientText';
import type { PublicHealthMetrics, PublicHealthSection, PublicHealthSectionId } from '../types';
const props = defineProps<{
  sections: PublicHealthSection[]; values: Partial<Record<PublicHealthSectionId, string>>;
  selected: PublicHealthSectionId[]; editable: boolean; metrics?: PublicHealthMetrics | null;
  selectedMealOptionId?: string | null; mealOptionValues?: Record<string, string>;
}>();
const emit = defineEmits<{
  edit: [id: PublicHealthSectionId, value: string]; select: [id: PublicHealthSectionId, selected: boolean]; all: [selected: boolean];
  mealOption: [id: string];
}>();
const selectableSections = computed(() => props.sections.filter(section => (props.values[section.id] ?? section.content).trim()));
const allSelected = computed(() => selectableSections.value.length > 0 && selectableSections.value.every(section => props.selected.includes(section.id)));
const metricsSource = computed(() => /^(mock|runtime)\./.test(props.metrics?.formulaVersion ?? '') ? '工程计算' : '服务端计算');
function sectionNote(section: PublicHealthSection): string {
  const value = props.values[section.id] ?? section.content;
  if (!value.trim()) return props.editable ? '暂无患者处方内容，可由医生补充正文后选择回写' : '暂无患者处方内容';
  if (characterCount(value) > 16000) return '正文超出 16000 字，请调整后确认';
  try { assertPatientFacingContent(value); }
  catch { return '正文含内部说明或医生核实提醒，请移至医生提醒区后再确认'; }
  return props.editable ? '由医生核对并确认' : '仅供阅读，当前不可修改或回写';
}
</script>
<template>
  <div class="result-sections">
    <div v-if="metrics" class="metrics" :aria-label="`${metricsSource}的只读减重指标`">
      <div class="metric"><span>BMI · 只读</span><strong>{{ metrics.bmi }} <small>kg/m²</small></strong></div>
      <div class="metric"><span>基础代谢率 · 只读</span><strong>{{ metrics.bmrKcalPerDay }} <small>kcal/天</small></strong></div>
      <p class="formula">{{ metricsSource }} · {{ metrics.formulaVersion }} · 指标不单独回写</p>
    </div>
    <div v-if="sections.length" class="selection">
      <label><input type="checkbox" :checked="allSelected" :disabled="!editable || !selectableSections.length" @change="emit('all', ($event.target as HTMLInputElement).checked)">全选章节</label>
      <span>{{ editable ? `已选 ${selected.length} / ${sections.length} 项 · 正文可编辑` : '结果核验完成后可编辑确认' }}</span>
    </div>
    <section v-for="(section, index) in sections" :key="section.id" class="section-card" :class="{ unselected: editable && !selected.includes(section.id) }">
      <div class="section-heading">
        <label><input type="checkbox" :aria-label="`选择${section.title}`" :checked="selected.includes(section.id)" :disabled="!editable || !(values[section.id] ?? section.content).trim()" @change="emit('select', section.id, ($event.target as HTMLInputElement).checked)">{{ section.title }}</label>
        <span>0{{ index + 1 }}</span>
      </div>
      <PublicHealthMealOptions v-if="section.id === 'meal_plan' && section.options" :options="section.options" :selected-id="selectedMealOptionId" :drafts="mealOptionValues" :value="values[section.id] ?? section.content" :editable="editable" @edit="emit('edit', 'meal_plan', $event)" @select="emit('mealOption', $event)" />
      <textarea v-else :aria-label="`${section.title}正文`" :value="values[section.id] ?? section.content" :readonly="!editable" @input="emit('edit', section.id, ($event.target as HTMLTextAreaElement).value)" />
      <p class="section-note">{{ sectionNote(section) }}</p>
    </section>
  </div>
</template>
<style scoped>
.metrics{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:15px}.metric{background:#f6faff;border:1px solid #dce7f5;border-radius:7px;padding:12px 14px;display:grid;gap:6px}.metric span{font-size:12px;color:#647d9e}.metric strong{font-size:25px;color:#326da7}.metric small{font-size:11px;font-weight:400}.formula{grid-column:1/-1;margin:0;font-size:11px;color:#7b8da3}.selection{display:flex;justify-content:space-between;font-size:12px;color:#65758b;margin-bottom:11px}.selection label,.section-heading label{display:flex;align-items:center;gap:7px}.selection span{font-size:11px}.section-card{border:1px solid #e1e9f3;border-radius:7px;margin-bottom:12px;overflow:hidden;background:white}.unselected{opacity:.7}.section-heading{display:flex;justify-content:space-between;padding:10px 12px;background:#f8fbff;border-bottom:1px solid #edf1f6;font-size:13px;color:#344963}.section-heading>span{font-size:11px;color:#8c9ab0}.section-card textarea{display:block;box-sizing:border-box;width:100%;min-height:108px;max-height:300px;resize:vertical;border:0;background:transparent;padding:12px 14px;font:inherit;font-size:13px;line-height:1.8;color:#3c4e66;outline-offset:-3px}.section-note{margin:0;padding:0 13px 9px;font-size:10px;color:#8a98ac}input{accent-color:#2469f2}
</style>
