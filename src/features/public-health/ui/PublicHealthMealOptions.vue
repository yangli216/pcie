<script setup lang="ts">
import { computed } from 'vue';
import type { PublicHealthMealOption } from '../types';

const props = defineProps<{
  options: PublicHealthMealOption[]; selectedId?: string | null;
  drafts?: Record<string, string>; value: string; editable: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; edit: [value: string] }>();
const recommended = computed(() => props.options[0]);
const current = computed(() => props.options.find(option => option.id === props.selectedId) ?? recommended.value);
const alternatives = computed(() => props.options.slice(1));
const isRecommended = computed(() => current.value.id === recommended.value.id);
function select(id: string) { if (props.editable) emit('select', id); }
</script>

<template>
  <div class="meal-options">
    <div class="current-heading" aria-live="polite">
      <div class="current-description">
        <span class="current-kind">{{ isRecommended ? '推荐食谱' : '当前采用' }}</span>
        <strong class="current-title">{{ current.title }}</strong>
        <span class="selected-tag">已选</span>
      </div>
      <button v-if="!isRecommended" class="restore-option" :disabled="!editable" @click="select(recommended.id)">恢复推荐食谱</button>
    </div>
    <textarea class="meal-content" aria-label="食谱推荐正文" :value="value" :readonly="!editable" @input="editable && emit('edit', ($event.target as HTMLTextAreaElement).value)" />
    <details class="alternatives">
      <summary class="alternatives-summary">备选食谱（{{ alternatives.length }}）<span class="expand-hint">展开查看并选择</span></summary>
      <div class="alternative-list">
        <article v-for="(option, index) in alternatives" :key="option.id" class="alternative-card" :class="{ adopted: option.id === current.id }">
          <label class="alternative-choice">
            <input type="radio" :name="`meal-option-${recommended.id}`" :aria-label="`采用备选食谱${index + 1}：${option.title}`" :checked="option.id === current.id" :disabled="!editable" @change="select(option.id)">
            <span class="alternative-label">备选 {{ index + 1 }}</span><strong class="alternative-title">{{ option.title }}</strong>
            <span class="choice-hint">{{ option.id === current.id ? '当前采用' : '选择此食谱' }}</span>
          </label>
          <pre class="alternative-preview">{{ drafts?.[option.id] ?? option.content }}</pre>
        </article>
      </div>
    </details>
  </div>
</template>

<style scoped>
.meal-options{background:#fff}.current-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 14px 10px}.current-description{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0}.current-kind{font-size:11px;color:#326da7}.current-title{font-size:13px;color:#344963;font-weight:600;overflow-wrap:anywhere}.selected-tag{font-size:10px;padding:2px 7px;border-radius:10px;color:#2469f2;background:#edf5ff}.restore-option{flex-shrink:0;border:1px solid #cee0fa;border-radius:5px;padding:5px 9px;background:#f6faff;color:#2469f2;font:inherit;font-size:11px;cursor:pointer}.restore-option:disabled{cursor:default;opacity:.5}.meal-content{display:block;box-sizing:border-box;width:100%;min-height:280px;max-height:460px;resize:vertical;border:0;padding:2px 14px 13px;background:#fff;color:#3c4e66;font:inherit;font-size:13px;line-height:1.8;outline-offset:-3px}.alternatives{margin:0 13px 12px;border:1px solid #e1e9f3;border-radius:6px;overflow:hidden}.alternatives-summary{padding:10px 12px;cursor:pointer;background:#f8fbff;color:#344963;font-size:12px}.expand-hint{margin-left:12px;font-size:10px;color:#7b8da3}.alternative-list{display:grid;gap:10px;padding:10px}.alternative-card{border:1px solid #e1e9f3;border-radius:6px;overflow:hidden}.alternative-card.adopted{border-color:#8bb6fa;background:#f6faff}.alternative-choice{display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;font-size:12px}.alternative-choice input{accent-color:#2469f2;flex-shrink:0}.alternative-label{font-size:10px;color:#7b8da3;white-space:nowrap}.alternative-title{font-size:12px;font-weight:600;color:#344963;overflow-wrap:anywhere}.choice-hint{margin-left:auto;white-space:nowrap;font-size:10px;color:#326da7}.alternative-preview{margin:0;padding:0 12px 12px;max-height:220px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:12px;line-height:1.8;color:#65758b}.alternatives-summary:focus-visible,.restore-option:focus-visible,.alternative-choice input:focus-visible{outline:2px solid #2469f2;outline-offset:2px}
</style>
