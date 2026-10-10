<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useInstitutionKnowledgeController } from '../model/useInstitutionKnowledgeController';
import KnowledgeSearchForm from './KnowledgeSearchForm.vue';
import KnowledgeEvidenceList from './KnowledgeEvidenceList.vue';

const controller = useInstitutionKnowledgeController();
const { collections, collectionId, enabled, loading, searching, error, response, canSearch } = controller;
onMounted(controller.loadCollections);
onUnmounted(controller.dispose);
</script>

<template>
  <section class="institution-knowledge" aria-label="机构资料检索" :aria-busy="loading || searching">
    <div class="collection-heading">
      <p class="description">检索当前机构已发布的资料，查看命中原文及来源。</p>
      <button class="refresh-button" type="button" :disabled="loading" @click="controller.loadCollections">刷新集合</button>
    </div>
    <p v-if="loading" class="state-message" role="status">正在加载知识集合…</p>
    <p v-else-if="!error && !enabled" class="state-message">当前机构未启用资料检索，请联系管理员配置。</p>
    <p v-else-if="!error && collections.length === 0" class="state-message">当前机构尚无已发布的知识资料。</p>
    <KnowledgeSearchForm v-if="collections.length > 0" :collections="collections" :collection-id="collectionId"
      :disabled="!canSearch" :searching="searching" @select="controller.selectCollection" @search="controller.search" />
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="searching" class="state-message" role="status">正在检索资料…</p>
    <KnowledgeEvidenceList v-if="response" :response="response" />
  </section>
</template>

<style scoped>
.institution-knowledge { display: grid; gap: 16px; }
.collection-heading { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
.description, .state-message { margin: 0; color: var(--color-text-muted, #64748b); font-size: 13px; line-height: 1.6; }
.refresh-button { flex-shrink: 0; padding: 6px 10px; border: 1px solid var(--color-border-light, #dbe3eb); border-radius: 6px; background: transparent; color: var(--color-text-primary, #1e293b); cursor: pointer; }
.refresh-button:focus-visible { outline: 2px solid var(--color-primary, #008577); outline-offset: 2px; }
.error-message { margin: 0; font-size: 13px; color: var(--color-error, #b42318); line-height: 1.6; }
</style>
