<script setup lang="ts">
import { ref } from 'vue';
import InpatientEmrPage from '../../../src/features/inpatient-emr/ui/InpatientEmrPage.vue';
import { previewRequest } from './fixtures';

const request = ref(previewRequest);
</script>

<template>
  <div class="runtime-shell">
    <div class="synthetic-notice">合成数据预览</div>
    <InpatientEmrPage :request="request" :active="true" />
  </div>
</template>

<style>
html, body, #app { margin: 0; width: 100%; height: 100%; overflow: hidden; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
* { box-sizing: border-box; }
button, textarea, input { font: inherit; }
.runtime-shell { display: flex; flex-direction: column; width: 100%; height: 100%; min-height: 0; }
.runtime-shell > .inpatient-emr-page { flex: 1; height: auto; min-height: 0; }
.synthetic-notice { flex: 0 0 24px; padding: 3px 14px; color: #9a3412; background: #fff7ed; border-bottom: 1px solid #fed7aa; font-size: 12px; line-height: 18px; text-align: center; }
</style>
