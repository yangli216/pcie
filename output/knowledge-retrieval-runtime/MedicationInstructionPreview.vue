<script setup lang="ts">
import { ref } from 'vue';
import TreatmentRecommendationCard from '../../src/features/consultation-result/ui/TreatmentRecommendationCard.vue';
import DrugInstructionPopover from '../../src/features/knowledge/ui/DrugInstructionPopover.vue';
const selected = ref(true);
const layout = ref<'worklist' | 'default'>('worklist');
const cards = [
  { id: 'synthetic-A', name: '合成药品甲（工程预览）' },
  { id: 'synthetic-B', name: '合成药品乙（工程预览）' },
  { id: '', name: '未匹配商品（工程预览）' },
];
</script>

<template>
  <section class="preview-cards">
    <header><h2>治疗方案 · 合成药品</h2><p>仅供工程预览，不构成医学建议。</p>
      <button type="button" @click="layout = layout === 'worklist' ? 'default' : 'worklist'">切换卡片布局</button>
    </header>
    <TreatmentRecommendationCard v-for="card in cards" :key="card.id" :rec="{ type: 'medicine', name: card.name, reason: '' }"
      :selected="selected" :layout-variant="layout" spec="合成规格" manufacturer="合成厂家"
      :show-feedback="false"
      inline-summary="合成用药行 · 剂量与频次仅供布局检查" @toggle="selected = !selected">
      <template #summary-action>
        <DrugInstructionPopover :product-id="card.id" :product-name="card.name" drug-spec="合成规格" producer="合成厂家" />
      </template>
    </TreatmentRecommendationCard>
  </section>
</template>

<style scoped>
.preview-cards { padding: 16px; height: 100%; box-sizing: border-box; overflow: auto; display: flex; flex-direction: column; gap: 12px;
  --voice-accent: var(--color-primary, #187a91); --voice-surface: var(--color-background-white, #fff); --voice-font-main: 14px; --voice-font-min: 12px; --voice-text: var(--color-text-primary, #1e293b); --voice-text-muted: var(--color-text-muted, #64748b); }
h2 { font-size: 15px; margin: 0 0 6px; } p { font-size: 12px; color: var(--color-text-muted); }
button { border: 1px solid var(--color-border-light); border-radius: 4px; background: var(--color-background-white); color: inherit; padding: 4px 8px; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
</style>
