<script setup lang="ts">
import type { DeepReadonly } from 'vue';
import type { KnowledgeSearchResponse } from '../api/knowledgeRetrieval';
defineProps<{ response: DeepReadonly<KnowledgeSearchResponse> }>();
</script>

<template>
  <section class="knowledge-evidence" aria-label="知识检索结果" aria-live="polite">
    <p class="result-summary">{{ response.results.length }} 条原文 · 知识版本 {{ response.collection.releaseVersion }}</p>
    <p v-if="response.results.length === 0" class="empty-message">未找到匹配资料，请调整关键词。</p>
    <article v-for="item in response.results" :key="item.chunkId" class="evidence-item">
      <h3 class="evidence-title">{{ item.title }}</h3>
      <p class="evidence-source">来源：{{ item.sourceId }} · 文档版本 {{ item.sourceVersion }}</p>
      <div class="evidence-content">{{ item.content }}</div>
      <details class="evidence-details">
        <summary>来源详情</summary>
        <dl class="evidence-fields">
          <dt>片段</dt><dd>{{ item.chunkId }}</dd>
          <dt>内容校验</dt><dd>{{ item.contentSha256 }}</dd>
          <dt>检索版本</dt><dd>{{ response.collection.retrievalVersion }}</dd>
        </dl>
      </details>
    </article>
  </section>
</template>

<style scoped>
.result-summary, .evidence-source, .empty-message { color: var(--color-text-muted, #64748b); font-size: 13px; }
.evidence-item { padding: 16px 0; border-top: 1px solid var(--color-border-light, #dbe3eb); }
.evidence-title { margin: 0; font-size: 15px; color: var(--color-text-primary, #1e293b); }
.evidence-source { margin: 6px 0 12px; overflow-wrap: anywhere; }
.evidence-content { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.7; color: var(--color-text-primary, #1e293b); }
.evidence-details { margin-top: 12px; font-size: 12px; color: var(--color-text-muted, #64748b); }
.evidence-details summary { cursor: pointer; }
.evidence-fields { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 6px; }
.evidence-fields dd { margin: 0; overflow-wrap: anywhere; }
</style>
