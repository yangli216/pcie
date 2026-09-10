<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import ReportConsistencyPanel from './ReportConsistencyPanel.vue';
import type {
  ReportInterpretationAbnormalItem,
  ReportInterpretationWindowPayload,
} from '@/types/reportInterpretation';
import {
  dedupeNarratives,
  resolveReportOverallStatus,
  selectHistoryText,
  selectKeyPoints,
  selectSupplementalSections,
  stripPatientBasics,
} from '../lib/reportInterpretationPresentation';

const props = withDefaults(defineProps<{
  payload: ReportInterpretationWindowPayload;
  compact?: boolean;
}>(), {
  compact: false,
});

const reportSubtitle = computed(() => {
  const title = props.payload.reportMeta?.reportTitle
    || props.payload.reportMeta?.reportItem
    || props.payload.reportKindLabel;
  return title === props.payload.reportKindLabel
    ? props.payload.reportKindLabel
    : `${title}（${props.payload.reportKindLabel}）`;
});

const patientDisplay = computed(() => {
  const patient = props.payload.patient;
  if (!patient) return props.payload.patientSummary || '未提供';
  return [patient.patientName || '未命名患者', patient.genderText, patient.ageText]
    .filter(Boolean)
    .join(' ');
});

const abnormalItemsForDisplay = computed<ReportInterpretationAbnormalItem[]>(() => {
  return props.payload.abnormalItems || [];
});
const historyTextForDisplay = computed(() => selectHistoryText(
  props.payload.reportMeta?.historyText,
  props.payload.patient,
));
const keyPointsForDisplay = computed(() => selectKeyPoints(props.payload.keyPoints));
const supplementalSections = computed(() => selectSupplementalSections(props.payload));
const recommendationsForDisplay = computed(() => dedupeNarratives(props.payload.recommendations));
const cautionsForDisplay = computed(() => dedupeNarratives(props.payload.cautions));
const overallStatus = computed(() => resolveReportOverallStatus(props.payload));
const summaryText = computed(() => (
  stripPatientBasics(props.payload.summary, props.payload.patient) || overallStatus.value.title
));
const conclusionText = computed(() => stripPatientBasics(
  props.payload.conclusion,
  props.payload.patient,
));

function displayText(value: string | null | undefined): string {
  return value || '--';
}

function urgencyLabel(value: string | undefined): string {
  if (value === 'high') return '重点';
  if (value === 'low') return '提示';
  return '关注';
}

function directionText(item: ReportInterpretationAbnormalItem): string {
  if (item.direction === 'up') return '↑';
  if (item.direction === 'down') return '↓';
  if (item.direction === 'positive') return '阳性';
  if (item.direction === 'abnormal') return '异常';
  return '无';
}
</script>

<template>
  <main class="report-paper" :class="{ 'report-paper--compact': compact }" aria-label="AI 报告解读结果">
    <section class="report-title-block">
      <h1>AI 报告解读</h1>
      <p>{{ reportSubtitle }}</p>
    </section>

    <section class="report-meta-block" aria-label="报告基础信息">
      <div class="meta-row">
        <div class="meta-field meta-field--patient">
          <span class="meta-label">患者</span>
          <strong>{{ patientDisplay }}</strong>
        </div>
        <div class="meta-field">
          <span class="meta-label">门诊编号</span>
          <strong>{{ displayText(payload.reportMeta?.outpatientNo) }}</strong>
        </div>
        <div class="meta-field">
          <span class="meta-label">样本编号</span>
          <strong>{{ displayText(payload.reportMeta?.sampleNo) }}</strong>
        </div>
      </div>
      <div class="meta-row">
        <div class="meta-field">
          <span class="meta-label">送检医生</span>
          <strong>{{ displayText(payload.reportMeta?.submitDoctor) }}</strong>
        </div>
        <div class="meta-field">
          <span class="meta-label">申请时间</span>
          <strong>{{ displayText(payload.reportMeta?.requestTime || payload.reportMeta?.reportDate) }}</strong>
        </div>
        <div class="meta-field">
          <span class="meta-label">{{ payload.taskId === 'inspectReport' ? '检验时间' : '检查时间' }}</span>
          <strong>{{ displayText(payload.reportMeta?.resultTime) }}</strong>
        </div>
      </div>
      <div v-if="historyTextForDisplay" class="history-line">
        <span class="meta-label">病历</span>
        <p>{{ historyTextForDisplay }}</p>
      </div>
    </section>

    <ReportConsistencyPanel v-if="payload.crossReportConsistency" :result="payload.crossReportConsistency" />

    <section
      class="summary-block"
      :class="`summary-block--${overallStatus.level}`"
      :aria-label="`总体结果：${overallStatus.label}`"
      :title="overallStatus.description"
    >
      <Icon class="summary-status-icon" :icon="overallStatus.icon" size="25" />
      <div class="summary-content">
        <span class="summary-status-label">{{ overallStatus.label }}</span>
        <h2>{{ summaryText }}</h2>
        <p v-if="conclusionText">{{ conclusionText }}</p>
      </div>
      <span class="summary-time">解读时间：{{ payload.generatedAt }}</span>
    </section>

    <section class="report-section">
      <h2>异常项目</h2>
      <div v-if="abnormalItemsForDisplay.length" class="abnormal-table" role="table" aria-label="异常项目">
        <div class="abnormal-row abnormal-row--head" role="row">
          <span>项目</span><span>结果</span><span>方向</span><span>参考范围 / 说明</span><span>临床意义</span>
        </div>
        <div
          v-for="item in abnormalItemsForDisplay"
          :key="`${item.name}-${item.result}`"
          class="abnormal-row"
          :class="`abnormal-row--${item.urgency || 'medium'}`"
          role="row"
        >
          <strong>{{ item.name }}</strong>
          <span class="abnormal-result">{{ item.result }}</span>
          <span class="direction-mark" :class="`direction-mark--${item.direction || 'neutral'}`">{{ directionText(item) }}</span>
          <span>{{ displayText(item.referenceRange) }}</span>
          <span>{{ displayText(item.meaning) }}</span>
        </div>
      </div>
      <p v-else class="empty-report-line">当前报告未识别到明确异常项目，请继续结合原始报告、症状和动态变化判断。</p>
    </section>

    <section v-if="keyPointsForDisplay.length || supplementalSections.length" class="report-section judgement-section">
      <h2>综合判断</h2>
      <article
        v-for="(item, index) in keyPointsForDisplay"
        :key="`${item.title}-${item.detail}`"
        class="judgement-item"
        :class="`judgement-item--${item.urgency || 'medium'}`"
      >
        <h3>{{ index + 1 }}. {{ item.title }}（{{ urgencyLabel(item.urgency) }}）：</h3>
        <p>{{ item.detail }}</p>
      </article>
      <div v-if="supplementalSections.length" class="analysis-list">
        <article v-for="item in supplementalSections" :key="`${item.title}-${item.content}`">
          <strong>{{ item.title }}</strong>
          <p>{{ item.content }}</p>
        </article>
      </div>
    </section>

    <section class="report-section advice-section">
      <div>
        <h2>建议下一步行动</h2>
        <ul><li v-for="item in recommendationsForDisplay" :key="item">{{ item }}</li></ul>
      </div>
      <div>
        <h2>注意事项</h2>
        <ul><li v-for="item in cautionsForDisplay" :key="item">{{ item }}</li></ul>
      </div>
    </section>

    <section class="raw-report-section">
      <details>
        <summary>原始报告原文</summary>
        <pre>{{ payload.sourceQuery }}</pre>
      </details>
    </section>
  </main>
</template>

<style scoped>
.report-paper {
  width: min(940px, 100%);
  min-height: calc(100vh - 92px);
  margin: 0 auto;
  padding: 20px 30px 26px;
  box-sizing: border-box;
  background: #fff;
  border: 1px solid rgba(118, 151, 206, 0.18);
  border-radius: 8px;
  box-shadow: 0 18px 40px rgba(52, 94, 156, 0.12);
  color: #111827;
}
.report-paper--compact { min-height: 100%; padding: 14px 28px 22px; border: 0; border-radius: 0; box-shadow: none; }
.report-title-block { padding-bottom: 14px; text-align: center; }
.report-title-block h1 { margin: 0; font-size: 25px; line-height: 1.2; }
.report-title-block p { margin: 6px 0 0; font-size: 15px; font-weight: 600; }
.report-paper--compact .report-title-block { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 6px 10px; padding-bottom: 10px; }
.report-paper--compact .report-title-block h1 { font-size: 22px; }
.report-paper--compact .report-title-block p { margin: 0; font-size: 14px; }
.report-meta-block { padding: 8px 0 10px; border-top: 1px solid #8795a8; border-bottom: 1px solid #8795a8; }
.meta-row { display: grid; grid-template-columns: 1.1fr 1fr 1fr; gap: 12px; }
.meta-row + .meta-row { margin-top: 7px; padding-top: 7px; border-top: 1px solid #e2e7ee; }
.meta-field { min-width: 0; display: flex; align-items: baseline; gap: 6px; font-size: 13px; line-height: 1.4; }
.meta-label { flex: none; font-weight: 700; }
.meta-field strong { min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
.meta-field--patient strong { font-weight: 700; }
.history-line { display: flex; gap: 8px; margin-top: 7px; padding-top: 7px; border-top: 1px solid #e2e7ee; }
.history-line p { flex: 1; margin: 0; font-size: 13px; line-height: 1.55; }
.summary-block { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: start; gap: 10px; margin-top: 10px; padding: 10px 12px; border: 1px solid; border-radius: 6px; }
.summary-block--normal { border-color: #b9dcc8; background: #f2f8f4; }
.summary-block--unknown { border-color: #d3dce7; background: #f6f8fb; }
.summary-block--attention { border-color: #ead39e; background: #fff8e8; }
.summary-block--high { border-color: #edc0bb; background: #fff1f0; }
.summary-status-icon { margin-top: 2px; }
.summary-block--normal .summary-status-icon, .summary-block--normal .summary-status-label { color: #23784b; }
.summary-block--unknown .summary-status-icon, .summary-block--unknown .summary-status-label { color: #52677f; }
.summary-block--attention .summary-status-icon, .summary-block--attention .summary-status-label { color: #9a5b00; }
.summary-block--high .summary-status-icon, .summary-block--high .summary-status-label { color: #b6382d; }
.summary-content { min-width: 0; }
.summary-status-label { display: block; margin-bottom: 3px; font-size: 12px; font-weight: 800; }
.summary-block h2 { margin: 0; font-size: 16px; line-height: 1.45; }
.summary-block p { margin: 4px 0 0; color: #344054; font-size: 13px; line-height: 1.55; }
.summary-block .summary-time { align-self: end; color: #6b7280; font-size: 11px; white-space: nowrap; }
.report-section { padding: 12px 0; border-bottom: 1px dashed #8795a8; }
.report-section h2 { margin: 0 0 9px; font-size: 16px; }
.abnormal-row { display: grid; grid-template-columns: minmax(110px,1fr) minmax(105px,.85fr) 52px minmax(110px,.85fr) minmax(160px,1.35fr); gap: 9px; min-height: 36px; padding: 5px 0; border-bottom: 1px solid #e6ebf2; font-size: 13px; line-height: 1.45; }
.abnormal-row--head { min-height: auto; color: #6b7280; font-size: 12px; font-weight: 700; }
.abnormal-row:last-child { border-bottom: 0; }
.abnormal-result, .direction-mark--up, .direction-mark--positive, .direction-mark--abnormal { color: #dc2626; font-weight: 700; }
.direction-mark { color: #2563eb; font-weight: 800; }
.abnormal-row--high { background: linear-gradient(90deg, rgba(254,226,226,.35), transparent 45%); }
.empty-report-line { margin: 0; color: #6b7280; font-size: 13px; line-height: 1.55; }
.judgement-section, .analysis-list { display: grid; gap: 9px; }
.judgement-item h3 { margin: 0 0 4px; color: #dc2626; font-size: 14px; line-height: 1.45; }
.judgement-item--low h3 { color: #2563eb; }
.judgement-item p, .analysis-list p { margin: 0; font-size: 14px; line-height: 1.6; }
.analysis-list { margin-top: 3px; padding-top: 9px; border-top: 1px solid #e6ebf2; }
.analysis-list strong { color: #1f4f88; font-size: 13px; }
.advice-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; border-bottom-style: solid; }
.advice-section ul { margin: 0; padding-left: 18px; }
.advice-section li { margin-bottom: 5px; font-size: 14px; line-height: 1.6; }
.raw-report-section { padding-top: 10px; }
.raw-report-section summary { color: #536273; font-size: 13px; font-weight: 700; cursor: pointer; }
.raw-report-section pre { max-height: 220px; margin: 8px 0 0; overflow: auto; padding: 10px; border: 1px solid #dbe3ee; background: #f8fafc; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.55; }
@media (max-width: 820px) {
  .report-paper { padding: 22px 18px 28px; }
  .meta-row, .advice-section { grid-template-columns: 1fr; gap: 10px; }
  .summary-block { grid-template-columns: 24px minmax(0, 1fr); }
  .summary-time { grid-column: 2; }
  .abnormal-row { grid-template-columns: 1fr; gap: 4px; padding: 12px 0; }
  .abnormal-row--head { display: none; }
}
@media print {
  .report-paper { width: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; border: 0 !important; box-shadow: none !important; }
  .report-title-block, .report-meta-block, .summary-block, .abnormal-row, .judgement-item, .analysis-list article, .advice-section li { break-inside: avoid; page-break-inside: avoid; }
  .raw-report-section pre { max-height: none !important; overflow: visible !important; }
}
</style>
