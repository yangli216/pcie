<script setup lang="ts">
import type { PublicHealthState } from '../types';
defineProps<{ state: PublicHealthState; canGenerate: boolean; canWriteback: boolean; reconnectable: boolean; selectedCount: number; sending: boolean }>();
const emit = defineEmits<{ generate: []; stop: []; reconnect: []; writeback: []; close: [] }>();
</script>
<template>
  <footer class="action-bar">
    <span class="summary">{{ state === 'awaiting-writeback' ? '等待 PHIS 保存回执 · 当前确认内容已锁定' : state === 'saved' ? 'PHIS 已确认保存' : state === 'conflict' ? '原草稿已保留 · 请从 PHIS 重新调入最新记录' : selectedCount ? `已选 ${selectedCount} 个章节 · 未选字段不改动` : '请先核对本次资料' }}</span>
    <div class="actions">
      <button v-if="state === 'generating'" class="secondary" @click="emit('stop')">停止等待</button>
      <button v-if="reconnectable && state === 'generation-failed'" class="secondary" @click="emit('reconnect')">重新连接</button>
      <button v-if="state === 'awaiting-writeback'" class="secondary" :disabled="sending" @click="emit('writeback')">{{ sending ? '正在发送' : '重传确认内容' }}</button>
      <button v-if="state === 'saved'" class="primary" @click="emit('close')">完成</button>
      <template v-else-if="state !== 'awaiting-writeback'">
        <button class="secondary" :disabled="!canGenerate" @click="emit('generate')">{{ state === 'ready' ? '生成建议' : '重新生成' }}</button>
        <button class="primary" :disabled="!canWriteback" @click="emit('writeback')">{{ state === 'writeback-failed' ? '重新确认并保存' : '确认回写 PHIS' }}</button>
      </template>
    </div>
  </footer>
</template>
<style scoped>
.action-bar{display:flex;flex-shrink:0;align-items:center;justify-content:space-between;gap:14px;min-height:64px;padding:12px 22px;box-sizing:border-box;background:#fff;border-top:1px solid #e5ecf5}.summary{font-size:12px;color:#65788f}.actions{display:flex;gap:9px;flex-shrink:0}.actions button{padding:8px 14px;min-height:34px;border-radius:6px;font-size:12px;cursor:pointer}.secondary{background:#fff;border:1px solid #d8e1ed;color:#536a86}.primary{background:#2469f2;border:1px solid #2469f2;color:white}.actions button:disabled{opacity:.45;cursor:not-allowed}
</style>
