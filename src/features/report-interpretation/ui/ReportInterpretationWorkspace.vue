<script setup lang="ts">
import { computed, onMounted, toRef } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type { AppPatient } from '@/types/appState';
import type { HisOutpatientFollowUpContext, HisVisitRecord } from '@/services/his/types';
import type { ReportFollowUpAssessment } from '@/types/reportInterpretation';
import {
  buildReportInterpretationPayload,
  resolveReportInterpretationRequest,
} from '@/services/reportInterpretation';
import {
  buildStructuredLabAbnormalItems,
  fetchReportedReportHistory,
} from '../api/reportedReportHistory';
import { useReportInterpretationWorkspace } from '../model/useReportInterpretationWorkspace';
import type { ReportHistoryFilter } from '../types';
import ReportInterpretationContent from './ReportInterpretationContent.vue';
import ReportSourcePreview from './ReportSourcePreview.vue';

const props = defineProps<{
  patient: AppPatient | null;
  visits: HisVisitRecord[];
  followUpContext?: HisOutpatientFollowUpContext | null;
}>();

const emit = defineEmits<{
  (event: 'open-follow-up', assessment?: ReportFollowUpAssessment): void;
}>();

const controller = useReportInterpretationWorkspace({
  patient: toRef(props, 'patient'),
  visits: toRef(props, 'visits'),
  followUpContext: computed(() => props.followUpContext || null),
  loadHistory: fetchReportedReportHistory,
  buildInterpretation: async (report, patient, consistencyContext) => {
    const request = resolveReportInterpretationRequest({
      taskId: report.taskId,
      query: report.sourceQuery,
      requestId: report.id,
      abnormalItems: report.taskId === 'inspectReport'
        ? buildStructuredLabAbnormalItems(report.labItems)
        : undefined,
    }, patient);
    return buildReportInterpretationPayload({ ...request, consistencyContext });
  },
});

const groups = computed(() => {
  const result: Array<{
    key: string;
    visitTime: number;
    deptName?: string;
    diagnoses: string[];
    reports: typeof controller.filteredReports.value;
  }> = [];
  for (const report of controller.filteredReports.value) {
    const key = report.visitId;
    let group = result.find((item) => item.key === key);
    if (!group) {
      group = {
        key,
        visitTime: report.visitTime,
        deptName: report.deptName,
        diagnoses: report.diagnosisNames,
        reports: [],
      };
      result.push(group);
    }
    group.reports.push(report);
  }
  return result;
});

const reportedApplicationCount = computed(() => controller.reports.value.reduce((count, report) => (
  count + (report.taskId === 'inspectReport' ? report.applications?.length || 0 : 0)
), 0));

const filterOptions: Array<{ value: ReportHistoryFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'lab', label: '检验' },
  { value: 'exam', label: '检查' },
];

function formatDate(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(new Date(value));
}

function formatTime(value: string | undefined, fallback: number): string {
  const parsed = value ? Date.parse(value) : fallback;
  if (!Number.isFinite(parsed)) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(parsed));
}

function printReport(): void {
  window.print();
}

function triggerInterpretation(): void {
  void controller.runInterpretation({
    force: Boolean(controller.interpretation.value),
  });
}

onMounted(() => {
  void controller.load();
});
</script>

<template>
  <section class="report-workspace">
    <aside class="report-timeline" aria-label="近14天报告列表">
      <div class="timeline-header">
        <div>
          <h2>近14天报告</h2>
          <p>
            {{ controller.reports.value.length }} 份报告单
            <template v-if="reportedApplicationCount > controller.reports.value.length">
              · 覆盖 {{ reportedApplicationCount }} 个已出结果申请
            </template>
          </p>
        </div>
      </div>

      <div class="filter-control" aria-label="报告类型筛选">
        <button
          v-for="option in filterOptions"
          :key="option.value"
          type="button"
          :class="{ active: controller.filter.value === option.value }"
          @click="controller.setFilter(option.value)"
        >{{ option.label }}</button>
      </div>

      <div v-if="controller.loadingHistory.value && !controller.reports.value.length" class="timeline-state">
        <Icon class="spinning" icon="lucide:loader-circle" size="20" />
        正在加载报告结果
      </div>
      <div v-else-if="controller.historyError.value" class="timeline-state timeline-state--error">
        <Icon icon="lucide:triangle-alert" size="20" />
        {{ controller.historyError.value }}
      </div>
      <div v-else-if="!groups.length" class="timeline-state">
        <Icon icon="lucide:file-search" size="20" />
        当前筛选下没有报告
      </div>

      <div v-else class="timeline-list">
        <section v-for="group in groups" :key="group.key" class="visit-group">
          <div class="visit-marker" aria-hidden="true"></div>
          <div class="visit-heading">
            <div class="visit-heading-main">
              <strong>{{ formatDate(group.visitTime) }}</strong>
              <span>{{ group.deptName || '科室待确认' }}</span>
            </div>
            <span>{{ group.diagnoses.join('、') || '诊断待确认' }}</span>
          </div>
          <button
            v-for="report in group.reports"
            :key="report.id"
            class="report-row"
            :class="{ selected: controller.selectedId.value === report.id }"
            type="button"
            @click="controller.selectReport(report)"
          >
            <Icon :icon="report.taskId === 'inspectReport' ? 'lucide:test-tubes' : 'lucide:scan-line'" size="17" />
            <span class="report-row-copy">
              <strong>{{ report.title }}</strong>
              <small>{{ formatTime(report.reportTime, report.visitTime) }} · {{ report.taskId === 'inspectReport' ? '检验' : '检查' }}</small>
            </span>
            <Icon v-if="!report.available" icon="lucide:circle-alert" size="15" title="报告正文暂不可用" />
          </button>
        </section>
      </div>
    </aside>

    <main class="interpretation-pane">
      <header class="interpretation-toolbar">
        <div class="toolbar-main">
          <div class="selected-report-title">
            <span>{{ controller.selectedReport.value?.taskId === 'checkReport' ? '检查报告' : '检验报告' }}</span>
            <strong>{{ controller.selectedReport.value?.title || '请选择报告' }}</strong>
          </div>
          <div v-if="controller.selectedReport.value" class="report-view-tabs" role="tablist" aria-label="报告内容视图">
            <button
              type="button"
              role="tab"
              :aria-selected="controller.activeView.value === 'source'"
              :class="{ active: controller.activeView.value === 'source' }"
              @click="controller.showSource"
            >原始报告</button>
            <button
              type="button"
              role="tab"
              :aria-selected="controller.activeView.value === 'interpretation'"
              :class="{ active: controller.activeView.value === 'interpretation' }"
              :disabled="!controller.interpretation.value"
              @click="controller.showInterpretation"
            >
              AI 解读
              <span v-if="controller.interpreting.value" class="tab-status-dot" aria-label="生成中"></span>
            </button>
          </div>
        </div>
        <div class="interpretation-actions">
          <button
            v-if="controller.selectedReport.value"
            class="ai-action-button"
            :class="{ 'ai-action-button--secondary': controller.interpretation.value }"
            type="button"
            :disabled="!controller.canInterpret.value || controller.interpreting.value"
            @click="triggerInterpretation"
          >
            <Icon
              :class="{ spinning: controller.interpreting.value }"
              :icon="controller.interpreting.value
                ? 'lucide:loader-circle'
                : controller.interpretation.value
                  ? 'lucide:refresh-cw'
                  : 'lucide:sparkles'"
              size="17"
            />
            {{ controller.interpreting.value
              ? 'AI 解读中'
              : controller.interpretation.value
                ? '重新解读'
                : '开始 AI 解读' }}
          </button>
          <button
            v-if="controller.canOpenFollowUp.value"
            class="follow-up-button"
            type="button"
            @click="emit('open-follow-up', controller.interpretation.value?.followUpAssessment)"
          >
            <Icon icon="lucide:clipboard-plus" size="17" />
            生成后续诊疗方案
          </button>
          <button class="icon-button" type="button" title="打印/导出" :disabled="!controller.selectedReport.value" @click="printReport">
            <Icon icon="lucide:download" size="17" />
          </button>
        </div>
      </header>

      <div class="interpretation-scroll">
        <ReportInterpretationContent
          v-if="controller.activeView.value === 'interpretation' && controller.interpretation.value"
          :payload="controller.interpretation.value"
          compact
        />
        <div v-else-if="controller.selectedReport.value" class="source-stage">
          <div v-if="controller.interpreting.value" class="interpretation-progress" role="status">
            <Icon class="spinning" icon="lucide:loader-circle" size="18" />
            <div>
              <strong>AI 正在解读</strong>
              <span>你可以继续核对原始报告，完成后将自动切换到 AI 解读。</span>
            </div>
          </div>
          <div v-else-if="controller.interpretationError.value" class="interpretation-progress interpretation-progress--error">
            <Icon icon="lucide:file-warning" size="18" />
            <div>
              <strong>AI 解读暂时不可用</strong>
              <span>{{ controller.interpretationError.value }}</span>
            </div>
            <button type="button" @click="triggerInterpretation">重新解读</button>
          </div>
          <div v-else-if="!controller.canInterpret.value" class="interpretation-progress interpretation-progress--muted">
            <Icon icon="lucide:file-warning" size="18" />
            <div>
              <strong>报告正文暂不可用</strong>
              <span>当前仅有报告申请摘要，暂时无法发起 AI 解读。</span>
            </div>
          </div>
          <p v-if="controller.consistencyContext.value" class="consistency-scope" role="status">
            {{ controller.consistencyContext.value.unavailableReason || `AI 解读将同时校验 ${controller.consistencyContext.value.date} 的 ${controller.consistencyContext.value.reports.length} 份报告。` }}
          </p>
          <ReportSourcePreview :report="controller.selectedReport.value" />
        </div>
        <div v-else class="content-state">
          <Icon icon="lucide:panel-left" size="30" />
          <h3>选择左侧报告</h3>
          <p>报告解读将在这里显示。</p>
        </div>
      </div>
    </main>
  </section>
</template>

<style scoped>
.consistency-scope { color: #526275; font-size: 13px; line-height: 1.6; }
.report-workspace { height: 100%; min-height: 0; display: grid; grid-template-columns: 320px minmax(0, 1fr); overflow: hidden; background: #eef3f8; color: #1f2937; }
.report-timeline { min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #d8e1ec; background: #f8fafc; }
.timeline-header, .interpretation-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.timeline-header { padding: 14px 18px 10px; }
.timeline-header h2 { margin: 0; font-size: 17px; }
.timeline-header p { margin: 4px 0 0; color: #64748b; font-size: 12px; }
.icon-button { width: 32px; height: 32px; flex: none; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; background: transparent; color: #3869b0; cursor: pointer; }
.icon-button:hover:not(:disabled) { background: #edf5ff; }
.icon-button:disabled { color: #a8b2c1; cursor: default; }
.filter-control { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0 18px 10px; padding: 3px; border: 1px solid #dce4ee; border-radius: 7px; background: #eef2f7; }
.filter-control button { min-height: 29px; border: 0; border-radius: 5px; background: transparent; color: #64748b; cursor: pointer; font-size: 12px; }
.filter-control button.active { background: #fff; color: #1769d2; font-weight: 700; box-shadow: 0 1px 3px rgba(15,23,42,.09); }
.timeline-list { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 12px 18px 24px; }
.visit-group { position: relative; padding: 0 0 14px 18px; border-left: 1px solid #cbd7e6; }
.visit-marker { position: absolute; top: 4px; left: -5px; width: 9px; height: 9px; border-radius: 50%; border: 2px solid #fff; background: #3b82f6; box-shadow: 0 0 0 1px #8fb8ee; }
.visit-heading { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }
.visit-heading-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.visit-heading-main span { flex: none; max-width: 116px; }
.visit-heading strong { font-size: 13px; }
.visit-heading span { overflow: hidden; color: #718096; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.report-row { width: 100%; min-height: 48px; display: flex; align-items: center; gap: 8px; margin-top: 5px; padding: 6px 8px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: #526275; text-align: left; cursor: pointer; }
.report-row:hover { background: #edf4fc; }
.report-row.selected { border-color: #9dc4f5; background: #e8f2ff; color: #1769d2; }
.report-row-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.report-row-copy strong { overflow: hidden; color: #25354a; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.report-row-copy small { color: #7b8797; font-size: 11px; }
.timeline-state, .content-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #748197; text-align: center; }
.timeline-state { flex: 1; padding: 28px; font-size: 13px; }
.timeline-state--error, .content-state--error { color: #b45309; }
.interpretation-pane { min-width: 0; min-height: 0; display: grid; grid-template-rows: 58px minmax(0, 1fr); background: #fff; }
.interpretation-toolbar { padding: 0 18px; border-bottom: 1px solid #dce4ee; background: #fff; }
.toolbar-main { min-width: 0; display: flex; align-items: center; gap: 18px; }
.selected-report-title { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.selected-report-title span { flex: none; color: #6b7b8d; font-size: 12px; }
.selected-report-title strong { overflow: hidden; font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.report-view-tabs { align-self: center; display: grid; grid-template-columns: repeat(2, minmax(78px, auto)); gap: 2px; height: 36px; padding: 3px; box-sizing: border-box; border-radius: 9px; }
.report-view-tabs button { position: relative; min-width: 78px; padding: 0 12px; border: 0; border-radius: 6px; background: transparent; color: #5f6f82; font-size: 13px; font-weight: 600; line-height: 28px; white-space: nowrap; cursor: pointer; transition: color .16s ease, background-color .16s ease, box-shadow .16s ease; }
.report-view-tabs button:hover:not(:disabled):not(.active) { color: #245f9f; background: #eaf1f9; }
.report-view-tabs button.active { background: #fff; color: #1769d2; font-weight: 700; box-shadow: 0 1px 3px rgba(31, 78, 134, .16); }
.report-view-tabs button:disabled { color: #9aa7b7; opacity: .72; cursor: default; }
.report-view-tabs button:focus-visible { outline: 2px solid #7eb3f2; outline-offset: 1px; }
.tab-status-dot { position: absolute; top: 6px; right: 6px; width: 5px; height: 5px; border-radius: 50%; background: #3b82f6; box-shadow: 0 0 0 3px #eaf3ff; }
.interpretation-actions { display: flex; align-items: center; gap: 8px; }
.ai-action-button, .follow-up-button, .content-state button { min-height: 36px; display: inline-flex; align-items: center; gap: 7px; padding: 0 13px; border: 1px solid #9dc4f5; border-radius: 8px; background: #edf5ff; color: #1769d2; font-size: 13px; font-weight: 700; line-height: 1; white-space: nowrap; cursor: pointer; }
.ai-action-button { min-width: 116px; justify-content: center; border-color: #1769d2; background: #1769d2; color: #fff; box-shadow: 0 2px 5px rgba(23, 105, 210, .22); transition: background-color .16s ease, border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
.ai-action-button:hover:not(:disabled) { border-color: #115bb8; background: #115fbe; box-shadow: 0 3px 8px rgba(23, 105, 210, .28); }
.ai-action-button:active:not(:disabled) { transform: translateY(1px); box-shadow: 0 1px 3px rgba(23, 105, 210, .2); }
.ai-action-button--secondary { border-color: #9bc0ed; background: #edf5ff; color: #155aa8; box-shadow: none; }
.ai-action-button--secondary:hover:not(:disabled) { border-color: #76abe7; background: #e2efff; color: #104f96; box-shadow: none; }
.ai-action-button:disabled { border-color: #d8e1ec; background: #eef2f7; color: #8795a7; box-shadow: none; cursor: default; }
.interpretation-scroll { position: relative; min-height: 0; overflow-y: auto; background: #fff; }
.source-stage { width: min(940px, 100%); min-height: 100%; margin: 0 auto; padding: 14px 28px 22px; box-sizing: border-box; }
.interpretation-progress { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 8px 11px; border: 1px solid #cfe1f7; border-radius: 7px; background: #f3f8ff; color: #1769d2; }
.interpretation-progress div { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.interpretation-progress strong { font-size: 13px; }
.interpretation-progress span { color: #60758f; font-size: 12px; line-height: 1.5; }
.interpretation-progress button { min-height: 30px; margin-left: auto; padding: 0 10px; border: 1px solid #d8b4a0; border-radius: 6px; background: #fff; color: #b45309; cursor: pointer; }
.interpretation-progress--error { border-color: #f1d2bd; background: #fff8f2; color: #b45309; }
.interpretation-progress--muted { border-color: #dce4ee; background: #f8fafc; color: #64748b; }
.content-state { height: 100%; padding: 32px; }
.content-state h3 { margin: 0; color: #334155; font-size: 16px; }
.content-state p { max-width: 420px; margin: 0; font-size: 13px; line-height: 1.7; }
.spinning { animation: spin .9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1080px) {
  .report-view-tabs { grid-template-columns: repeat(2, minmax(70px, auto)); }
  .report-view-tabs button { min-width: 70px; padding: 0 9px; }
  .follow-up-button { padding: 0 9px; }
}
@media (max-width: 900px) {
  .report-workspace { grid-template-columns: 280px minmax(0,1fr); }
  .selected-report-title span { display: none; }
  .follow-up-button { display: none; }
}
@media (max-width: 820px) { .source-stage { padding: 20px 18px 28px; } }
@media print {
  .report-workspace { display: block; height: auto; background: #fff; }
  .report-timeline, .interpretation-toolbar { display: none; }
  .interpretation-pane, .interpretation-scroll { display: block; height: auto; overflow: visible; }
}
</style>
