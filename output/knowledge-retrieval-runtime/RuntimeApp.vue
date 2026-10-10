<script setup lang="ts">
import { shallowRef } from 'vue';
import KnowledgeBasePanel from '@features/knowledge/ui/KnowledgeBasePanel.vue';
import { WINDOW_SIZES } from '../../src/constants/windowSizes';

const open = shallowRef(true);
const wide = shallowRef(false);
const dark = shallowRef(false);
function toggleTheme() {
  dark.value = !dark.value;
  document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
}
</script>

<template>
  <main class="runtime-page">
    <header class="runtime-toolbar">
      <div>
        <h1>全医慧助 · 知识库工作台</h1>
        <p>生产组件预览 · 合成资料 · 未连接真实知识服务</p>
      </div>
      <div class="runtime-controls">
        <button type="button" @click="wide = !wide">{{ wide ? '窄窗' : '宽窗' }}</button>
        <button type="button" @click="toggleTheme">{{ dark ? '浅色' : '深色' }}</button>
        <button type="button" @click="open = true">重新打开</button>
        <a href="http://127.0.0.1:8091/" target="_blank" rel="noopener noreferrer">WeKnora 管理端</a>
      </div>
    </header>
    <p class="runtime-guide">输入任意文字查看合成命中；输入“零命中”“失败”“内容变化”查看对应状态。</p>
    <section class="runtime-stage" :style="{ '--runtime-width': `${wide ? 720 : WINDOW_SIZES.WORK.width}px`, '--runtime-height': `${wide ? 600 : WINDOW_SIZES.WORK.height}px` }" aria-label="桌面知识库组件舞台">
      <KnowledgeBasePanel v-if="open" @close="open = false" />
      <div v-else class="runtime-closed">知识库已关闭<button type="button" @click="open = true">打开知识库</button></div>
    </section>
  </main>
</template>
