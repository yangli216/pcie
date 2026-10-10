<script setup lang="ts">
import { shallowRef } from 'vue';
import type { KnowledgeCollection } from '../api/knowledgeRetrieval';

defineProps<{
  collections: readonly KnowledgeCollection[];
  collectionId: string;
  disabled: boolean;
  searching: boolean;
}>();
const emit = defineEmits<{ select: [id: string]; search: [query: string] }>();
const query = shallowRef('');
</script>

<template>
  <form class="knowledge-search-form" @submit.prevent="emit('search', query)">
    <label class="field-label" for="institution-knowledge-collection">知识集合</label>
    <select id="institution-knowledge-collection" class="search-field" :value="collectionId"
      @change="emit('select', ($event.target as HTMLSelectElement).value)">
      <option v-for="item in collections" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <label class="field-label" for="institution-knowledge-query">检索内容</label>
    <div class="query-row">
      <input id="institution-knowledge-query" v-model="query" class="search-field query-field"
        type="search" maxlength="2000" placeholder="输入问题或关键词" autocomplete="off" />
      <button class="search-button" type="submit" :disabled="disabled || !query.trim()">
        {{ searching ? '检索中…' : '检索' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.knowledge-search-form { display: grid; gap: 8px; }
.field-label { font-size: 13px; color: var(--color-text-muted, #64748b); }
.search-field { min-width: 0; padding: 10px 12px; border: 1px solid var(--color-border-light, #dbe3eb); border-radius: 8px; background: var(--color-background-white, #fff); color: var(--color-text-primary, #1e293b); font: inherit; }
.search-field:focus-visible, .search-button:focus-visible { outline: 2px solid var(--color-primary, #008577); outline-offset: 2px; }
.query-row { display: flex; gap: 10px; }
.query-field { flex: 1; }
.search-button { padding: 10px 20px; border: 0; border-radius: 8px; background: var(--color-primary, #008577); color: white; cursor: pointer; font: inherit; }
.search-button:disabled { opacity: .55; cursor: default; }
</style>
