<script setup lang="ts">
import { shallowRef } from 'vue';
import InstitutionKnowledgePanel from './InstitutionKnowledgePanel.vue';
import PmphaiKnowledgeEntry from './PmphaiKnowledgeEntry.vue';

const emit = defineEmits<{ close: [] }>();
const activeSource = shallowRef<'institution' | 'pmphai'>('institution');
</script>

<template>
  <section class="knowledge-workbench" aria-label="知识库">
    <header class="workbench-header">
      <h2>知识库</h2>
      <button type="button" class="close-button" aria-label="关闭知识库" @click="emit('close')">×</button>
    </header>
    <nav class="source-navigation" aria-label="知识来源">
      <button type="button" :aria-pressed="activeSource === 'institution'" @click="activeSource = 'institution'">机构资料</button>
      <button type="button" :aria-pressed="activeSource === 'pmphai'" @click="activeSource = 'pmphai'">人卫知识</button>
    </nav>
    <div class="workbench-content">
      <InstitutionKnowledgePanel v-if="activeSource === 'institution'" />
      <PmphaiKnowledgeEntry v-else />
    </div>
  </section>
</template>

<style scoped>
.knowledge-workbench { display: flex; flex-direction: column; min-height: 0; height: 100%; color: var(--color-text-primary, #1e293b); background: var(--color-background-white, #fff); }
.workbench-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--color-border-light, #dbe3eb); }
.workbench-header h2 { margin: 0; font-size: 17px; font-weight: 600; }
.close-button { border: 0; background: transparent; color: inherit; font-size: 25px; line-height: 1; cursor: pointer; padding: 4px 8px; }
.source-navigation { display: flex; gap: 8px; padding: 16px 20px 0; }
.source-navigation button { padding: 8px 14px; border: 1px solid var(--color-border-light, #dbe3eb); border-radius: 8px; background: transparent; color: var(--color-text-muted, #64748b); font: inherit; font-size: 13px; cursor: pointer; }
.source-navigation button[aria-pressed="true"] { color: var(--color-primary, #008577); border-color: currentColor; }
.source-navigation button:focus-visible, .close-button:focus-visible { outline: 2px solid var(--color-primary, #008577); outline-offset: 2px; }
.workbench-content { padding: 20px; overflow: auto; min-height: 0; flex: 1; }
</style>
