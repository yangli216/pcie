<script setup lang="ts">
import { onUnmounted } from 'vue';
import { usePmphaiKnowledgePage } from '../model/usePmphaiKnowledgePage';
const page = usePmphaiKnowledgePage();
const { configured, opening, error } = page;
onUnmounted(page.dispose);
</script>

<template>
  <section class="pmphai-entry" aria-label="人卫知识">
    <p class="description">通过人卫知识页面查阅专业资料。</p>
    <p v-if="!configured" class="description">当前机构未启用人卫知识服务，请联系管理员配置。</p>
    <button v-else type="button" class="open-button" :disabled="opening" @click="page.open">
      {{ opening ? '正在打开…' : '打开人卫知识' }}
    </button>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
  </section>
</template>

<style scoped>
.description { color: var(--color-text-muted, #64748b); font-size: 13px; line-height: 1.6; }
.open-button { padding: 10px 16px; border: 0; border-radius: 8px; background: var(--color-primary, #008577); color: white; cursor: pointer; font: inherit; }
.open-button:focus-visible { outline: 2px solid var(--color-primary, #008577); outline-offset: 2px; }
.error-message { color: var(--color-error, #b42318); font-size: 13px; }
</style>
