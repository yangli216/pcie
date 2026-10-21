<script setup lang="ts">
import type { ChronicExaminationReminders } from '@features/clinical-result/clinicalResultContract';
defineProps<{ reminders: ChronicExaminationReminders }>();
</script>

<template>
  <aside class="chronic-exam-reminders" aria-label="慢病检查检验提醒">
    <h4>检查检验提醒</h4>
    <p>历史范围：PHIS 近90天成功返回的已出报告。健康大脑全区查询未接入。</p>
    <p class="scope-note">未查到不代表未检查；推荐周期未提供，请核对本次需要。项目在下方卡片勾选后随病历一起回写。</p>
    <p v-if="reminders.sourceStatus === 'missing_identity'" role="status">缺少患者身份证或本次就诊标识，暂无法获取健康处方推荐。</p>
    <p v-else-if="reminders.sourceStatus === 'unavailable'" role="status">健康处方推荐暂不可用，本次未取得推荐清单。</p>
    <p v-else-if="!reminders.items.length" role="status">健康处方服务本次未返回推荐项目。</p>
    <p v-if="reminders.catalogStatus === 'unavailable'" role="status">本次可开立目录读取失败，暂不能将推荐项目加入医嘱。</p>
    <p v-if="reminders.historyStatus !== 'complete'" role="status">PHIS 历史查询{{ reminders.historyStatus === 'failed' ? '失败' : reminders.historyStatus === 'partial' ? '不完整' : '覆盖完整性未确认' }}，近期检查情况需进一步核实。</p>
    <ul v-if="reminders.items.length">
      <li v-for="item in reminders.items" :key="item.name">
        <strong>{{ item.name }}</strong>
        <span v-if="item.matchStatus !== 'matched'"> · {{ item.matchStatus === 'ambiguous' ? '院内同名项目不唯一' : '未匹配到本次可开立项目' }}，请在 PHIS 核对</span>
        <span v-else> · 可在下方选择</span>
        <details v-if="item.recentReports.length">
          <summary>近90天有 {{ item.recentReports.length }} 条同名已出报告记录</summary>
          <div v-for="(record, index) in item.recentReports" :key="index">
            {{ record.name }} · {{ record.requestedAt ? `申请时间：${record.requestedAt}` : '申请时间未提供' }}
          </div>
        </details>
        <span v-else class="history-note"> · 返回记录未找到同名已出报告</span>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.chronic-exam-reminders { margin: 8px 0 12px; padding: 10px 12px; background: var(--bg-secondary, #f6f8fa); border-radius: 8px; font-size: 12px; line-height: 1.65; overflow-wrap: anywhere; }
h4 { margin: 0 0 4px; font-size: 13px; }
p { margin: 3px 0; }
.scope-note, .history-note { color: var(--text-secondary, #64748b); }
ul { margin: 6px 0 0; padding-left: 18px; }
li { margin: 5px 0; }
summary { cursor: pointer; }
summary:focus-visible { outline: 2px solid var(--primary-color, #2563eb); outline-offset: 2px; }
</style>
