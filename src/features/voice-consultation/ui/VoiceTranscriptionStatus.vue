<script setup lang="ts">
defineProps<{ message: string; canRetry: boolean; kind: 'error' | 'info' }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <div class="transcription-status" :role="kind === 'error' ? 'alert' : 'status'">
    <p>{{ message }}</p>
    <button v-if="canRetry" type="button" @click="$emit('retry')">重试整段转写</button>
  </div>
</template>

<style scoped>
.transcription-status {
  padding: 4px 16px 12px;
  color: var(--color-text-primary, #334155);
  font-size: 12px;
  line-height: 1.5;
}
.transcription-status p { margin: 0 0 8px; }
.transcription-status button {
  border: 1px solid var(--color-primary, #0891b2);
  border-radius: 6px;
  background: transparent;
  color: var(--color-primary, #0891b2);
  font: inherit;
  padding: 5px 10px;
  cursor: pointer;
}
.transcription-status button:focus-visible {
  outline: 2px solid var(--color-primary, #0891b2);
  outline-offset: 2px;
}
</style>
