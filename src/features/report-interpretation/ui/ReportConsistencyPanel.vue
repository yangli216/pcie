<script setup lang="ts">
import type { ReportConsistencyResult } from '../lib/reportConsistency';
defineProps<{ result: ReportConsistencyResult }>();
</script>

<template>
  <section class="consistency-panel" :class="{ 'consistency-panel--conflict': result.status === 'conflicts' }" aria-label="同日跨报告一致性校验">
    <header aria-live="polite">
      <h2>同日跨报告一致性校验<span v-if="result.status === 'conflicts'"> · 请医生核查</span></h2>
      <p>{{ result.message }}</p>
    </header>
    <details v-if="result.reports.length" class="scope">
      <summary>{{ result.date }} · 已关联 {{ result.reports.length }} 份报告</summary>
      <ul><li v-for="report in result.reports" :key="report.id">{{ report.title }} · {{ report.time }}</li></ul>
    </details>
    <article v-for="(conflict, index) in result.conflicts" :key="index" class="conflict">
      <h3>{{ conflict.title }}</h3>
      <ul class="evidence">
        <li v-for="item in conflict.evidence" :key="item.id">
          <small>{{ item.reportTitle }} · {{ item.reportTime }}</small>
          <strong>{{ item.name }}：{{ item.result }} {{ item.unit }}</strong>
          <span v-if="item.referenceRange">参考范围：{{ item.referenceRange }}</span>
        </li>
      </ul>
      <p><b>生理关联：</b>{{ conflict.relationship }}</p>
      <p><b>冲突内容：</b>{{ conflict.explanation }}</p>
      <div><b>可能原因（待核查）</b><ul><li v-for="cause in conflict.possibleCauses" :key="cause">{{ cause }}</li></ul></div>
      <div><b>建议核查</b><ul><li v-for="suggestion in conflict.suggestions" :key="suggestion">{{ suggestion }}</li></ul></div>
    </article>
    <ul v-if="result.limitations.length" class="limitations"><li v-for="limitation in result.limitations" :key="limitation">{{ limitation }}</li></ul>
  </section>
</template>

<style scoped>
.consistency-panel { margin: 16px 0; padding: 14px 16px; border: 1px solid #d8e1ec; border-radius: 8px; color: #334155; background: #f8fafc; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.consistency-panel--conflict { border-color: #e6b67b; background: #fffaf2; }
h2 { margin: 0; font-size: 16px; } h2 span { color: #92400e; font-size: 13px; }
h3 { margin: 0 0 8px; font-size: 14px; color: #92400e; }
p { margin: 5px 0; } ul { margin: 5px 0; padding-left: 20px; }
.scope { margin-top: 6px; color: #526275; } summary { cursor: pointer; }
.conflict { margin-top: 14px; padding-top: 12px; border-top: 1px solid #ead9c0; }
.evidence { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; padding: 0; list-style: none; }
.evidence li { display: flex; flex-direction: column; padding: 8px 10px; border-left: 3px solid #d49b51; background: #fff; }
.evidence small, .evidence span { color: #64748b; font-size: 12px; }
.limitations { color: #64748b; margin-top: 10px; }
@media print { .consistency-panel { background: white; } .evidence li { break-inside: avoid; } .scope > ul { display: block; } }
</style>
