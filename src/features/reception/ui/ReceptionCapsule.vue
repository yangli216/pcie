<template>
  <div
    class="rc-root"
    :class="stateClass"
    data-tauri-drag-region
  >
    <!-- Close -->
    <button type="button" class="rc-close" aria-label="关闭接诊胶囊" @click="closeCapsule">
      <Icon icon="lucide:x" size="14" aria-hidden="true" />
    </button>

    <!-- Header row -->
    <div class="rc-header">
      <!-- Avatar -->
      <div class="rc-avatar">
        <img
          class="rc-avatar-img"
          :src="avatarSrc"
          @error="onAvatarError"
          alt=""
          draggable="false"
        />
      </div>

      <!-- Info -->
      <div class="rc-info">
        <div class="rc-name-row">
          <span class="rc-name">{{ patientName }}</span>
          <span class="rc-meta">{{ gender === 'F' ? '女' : '男' }}</span>
          <span v-if="ageText" class="rc-meta">{{ ageText }}</span>
        </div>
        <div class="rc-badge-row">
          <span v-if="analyzing" class="rc-badge rc-badge--blue">
            <span class="rc-dot"></span>
            正在评估...
          </span>
          <button
            v-else-if="risks.length > 0"
            type="button"
            class="rc-badge rc-badge--orange rc-badge--clickable"
            @click="toggle"
            :aria-expanded="expanded"
            :aria-label="`${expanded ? '收起' : '展开'}${risks.length}项健康风险详情`"
            aria-controls="reception-risk-list"
            :title="expanded ? '收起风险详情' : '展开风险详情'"
          >
            <Icon icon="lucide:alert-circle" size="14" />
            {{ risks.length }}项健康风险
            <Icon
              class="rc-badge-caret"
              :icon="expanded ? 'lucide:chevron-up' : 'lucide:chevron-down'"
              size="14"
            />
          </button>
          <span v-else class="rc-badge rc-badge--green">
            <Icon icon="lucide:circle-check" size="14" />
            暂无已识别风险
          </span>
          <button
            v-if="hasPatientPortraitDetail"
            type="button"
            class="rc-detail-link"
            aria-label="查看患者健康画像详情"
            @click.stop="openPatientMemory"
          >
            详情
            <Icon icon="lucide:chevron-right" size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Risk items -->
    <div v-if="expanded && risks.length > 0" id="reception-risk-list" class="rc-risks">
      <div v-for="(r, i) in risks" :key="i" class="rc-risk-row">
        <span
          class="rc-tag"
          :style="{
            color: tagColor(r.category),
            borderColor: tagColor(r.category),
            background: tagBg(r.category),
          }"
        >{{ tagLabel(r.category) }}</span>
        <span class="rc-risk-text">{{ r.content }}</span>
      </div>
    </div>

    <!-- 统一报告助手入口：历史报告解读可从当前报告升级为回诊方案 -->
    <button
      v-if="!analyzing && hasReportAssistant"
      class="rc-followup-action"
      type="button"
      :disabled="reportAssistantOpening"
      @click="confirmReportAssistant"
    >
      <span class="rc-followup-icon">
        <Icon :icon="reportAssistantOpening ? 'lucide:loader-2' : 'lucide:file-search'" size="15" />
      </span>
      <span class="rc-followup-copy">
        <strong>{{ reportAssistantOpening ? '正在进入报告助手' : reportAssistantTitle }}</strong>
        <span>{{ reportAssistantSubtitle }}</span>
      </span>
      <Icon v-if="!reportAssistantOpening" icon="lucide:chevron-right" size="15" />
    </button>

    <!-- 复诊配药机会确认 -->
    <button
      v-if="!analyzing && chronicRefillCandidate"
      class="rc-refill-action"
      type="button"
      :disabled="chronicRefillGenerating"
      :title="chronicRefillCandidate.evidenceText"
      @click="confirmChronicRefill"
    >
      <span class="rc-refill-icon">
        <Icon :icon="chronicRefillGenerating ? 'lucide:loader-2' : 'mdi:pill'" size="15" />
      </span>
      <span class="rc-refill-copy">
        <strong>{{ chronicRefillGenerating ? '正在生成配药病历' : '复诊配药' }}</strong>
        <span>{{ chronicRefillSubtitle }}</span>
      </span>
      <Icon v-if="!chronicRefillGenerating" icon="lucide:chevron-right" size="15" />
    </button>

    <ChronicRefillScopeSelector
      v-if="chronicScopeSelecting && chronicRefillCandidate"
      :candidate="chronicRefillCandidate"
      @close="closeChronicScope"
      @submit="submitChronicRefill"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import { trackClick } from '@services/operationTracker';
import { resolvePatientAvatar, PATIENT_AVATAR_FALLBACK } from '@/utils/patientAvatar';
import {
  chronicRefillTimingTracker,
  getChronicRefillCandidateKey,
  getChronicRefillConditionOptions,
  type ChronicRefillCandidate,
  type ChronicRefillSelection,
  type RiskItem,
} from '@features/reception-risk';
import ChronicRefillScopeSelector from './ChronicRefillScopeSelector.vue';
import type { HisOutpatientFollowUpContext, HisVisitRecord } from '@/services/his/types';
import type { PatientMemoryBrief } from '@entities/patient-memory';
import type { PatientMemorySyncStatus } from '@features/patient-memory';

const props = defineProps<{
  patientName: string;
  gender: 'M' | 'F';
  ageText: string;
  risks: RiskItem[];
  analyzing?: boolean;
  chronicRefillCandidate?: ChronicRefillCandidate | null;
  chronicRefillGenerating?: boolean;
  outpatientFollowUpContext?: HisOutpatientFollowUpContext | null;
  reportInterpretationVisits?: HisVisitRecord[];
  reportAssistantOpening?: boolean;
  patientMemoryStatus?: PatientMemorySyncStatus;
  patientMemoryBrief?: PatientMemoryBrief | null;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'toggle-expand', expanded: boolean): void;
  (e: 'confirm-chronic-refill', selection: ChronicRefillSelection): void;
  (e: 'chronic-scope-selecting', selecting: boolean): void;
  (e: 'confirm-report-assistant'): void;
  (e: 'open-patient-memory'): void;
}>();

const expanded = ref(false);
const chronicScopeSelecting = ref(false);
const chronicConditionOptions = computed(() => (
  props.chronicRefillCandidate
    ? getChronicRefillConditionOptions(props.chronicRefillCandidate)
    : []
));
const chronicRefillCandidateKey = computed(() => (
  props.chronicRefillCandidate
    ? getChronicRefillCandidateKey(props.chronicRefillCandidate)
    : ''
));

const historicalReportCount = computed(() => (props.reportInterpretationVisits || [])
  .reduce((total, visit) => total + (visit.reportedApplications?.length || 0), 0));
const followUpReportCount = computed(() => (
  (props.outpatientFollowUpContext?.labReports?.length || 0)
  + (props.outpatientFollowUpContext?.examReports?.length || 0)
));
const reportCount = computed(() => historicalReportCount.value + followUpReportCount.value);
const hasReportAssistant = computed(() => Boolean(
  props.outpatientFollowUpContext || historicalReportCount.value > 0,
));
const reportAssistantTitle = computed(() => (
  props.outpatientFollowUpContext ? '报告回诊' : '报告解读'
));
const reportAssistantSubtitle = computed(() => (
  props.outpatientFollowUpContext
    ? '本次报告已出 · 可生成后续方案'
    : `近14天 ${reportCount.value} 份已出报告`
));
const chronicRefillSubtitle = computed(() => {
  const diagnosisText = props.chronicRefillCandidate?.diagnoses.join('、') || '慢病复诊';
  return chronicConditionOptions.value.length > 1
    ? `${diagnosisText} · 选择本次续方范围`
    : `${diagnosisText} · 直接生成病历`;
});
const hasPatientPortraitDetail = computed(() => (
  props.patientMemoryStatus === 'ready' && Boolean(props.patientMemoryBrief)
));

const stateClass = computed(() => {
  if (props.analyzing) return 'rc-state-analyzing';
  if (props.risks.length > 0) return 'rc-state-risk';
  return 'rc-state-healthy';
});

// 头像加载策略：依据性别 + 年龄映射到 public/avatar/ 下的切图，
// 加载失败时回退默认头像。
const avatarSrc = ref<string>(
  resolvePatientAvatar({ gender: props.gender, ageText: props.ageText })
);
watch(
  () => [props.gender, props.ageText] as const,
  ([g, a]) => {
    avatarSrc.value = resolvePatientAvatar({ gender: g, ageText: a });
  }
);
function onAvatarError() {
  if (avatarSrc.value !== PATIENT_AVATAR_FALLBACK) {
    avatarSrc.value = PATIENT_AVATAR_FALLBACK;
  }
}

watch(() => props.risks, (r) => {
  const open = r.length > 0;
  expanded.value = open;
  emit('toggle-expand', open);
}, { immediate: true });

watch(
  chronicRefillCandidateKey,
  () => {
    if (chronicScopeSelecting.value) {
      emit('chronic-scope-selecting', false);
    }
    chronicScopeSelecting.value = false;
  },
  { immediate: true },
);

function toggle() {
  expanded.value = !expanded.value;
  trackClick('reception_toggle_risk_detail', { expanded: expanded.value, riskCount: props.risks.length });
  emit('toggle-expand', expanded.value);
}

function closeCapsule(): void {
  trackClick('reception_close');
  emit('close');
}

function confirmChronicRefill() {
  trackClick('reception_chronic_refill_confirm', {
    diagnosis: props.chronicRefillCandidate?.diagnosis,
    medicationCount: props.chronicRefillCandidate?.medications.length,
  });
  if (chronicConditionOptions.value.length > 1) {
    if (!chronicScopeSelecting.value) {
      chronicScopeSelecting.value = true;
      emit('chronic-scope-selecting', true);
    }
    return;
  }
  const condition = chronicConditionOptions.value[0];
  if (!condition) return;
  submitChronicRefill({
    conditionIds: [condition.id],
  });
}

function closeChronicScope(): void {
  chronicScopeSelecting.value = false;
  emit('chronic-scope-selecting', false);
}

function submitChronicRefill(selection: ChronicRefillSelection): void {
  chronicRefillTimingTracker.confirm();
  chronicScopeSelecting.value = false;
  emit('chronic-scope-selecting', false);
  emit('confirm-chronic-refill', selection);
}

function confirmReportAssistant() {
  trackClick('reception_report_assistant_confirm', {
    sourceVisitId: props.outpatientFollowUpContext?.source?.visitId,
    reportCount: reportCount.value,
  });
  emit('confirm-report-assistant');
}

function openPatientMemory() {
  trackClick('reception_patient_memory_open', {
    memoryVersion: props.patientMemoryBrief?.memoryVersion,
    factCount: props.patientMemoryBrief
      ? props.patientMemoryBrief.allergies.length
        + props.patientMemoryBrief.chronicConditions.length
        + props.patientMemoryBrief.recentDiagnoses.length
        + props.patientMemoryBrief.recentMedications.length
        + props.patientMemoryBrief.otherFacts.length
      : 0,
  });
  emit('open-patient-memory');
}

const CATEGORY_COLORS: Record<string, string> = {
  allergy: '#dc2626',
  chronic: '#ea580c',
  medication: '#d97706',
  population: '#2563eb',
  vital: '#7c3aed',
  other: '#64748b',
};
const CATEGORY_BG: Record<string, string> = {
  allergy: '#fee2e2',
  chronic: '#fff4e5',
  medication: '#fef3c7',
  population: '#dbeafe',
  vital: '#ede9fe',
  other: '#f1f5f9',
};
const CATEGORY_LABELS: Record<string, string> = {
  allergy: '过敏',
  chronic: '慢病',
  medication: '用药',
  population: '人群',
  vital: '体征',
  other: '其他',
};

function tagColor(cat: string) { return CATEGORY_COLORS[cat] || '#64748b'; }
function tagBg(cat: string) { return CATEGORY_BG[cat] || '#f1f5f9'; }
function tagLabel(cat: string) { return CATEGORY_LABELS[cat] || '其他'; }
</script>

<style scoped>
.rc-root {
  position: absolute;
  inset: 1px;
  border-radius: 15px;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  box-sizing: border-box;
  overflow: hidden;
  border: 1px solid transparent;
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.rc-state-healthy {
  background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 70%);
  border-color: #86efac;
  box-shadow: 0 4px 14px rgba(22, 163, 74, 0.08);
}

.rc-state-risk {
  background: linear-gradient(180deg, #fff7ed 0%, #ffffff 70%);
  border-color: #fdba74;
  box-shadow: 0 4px 14px rgba(234, 88, 12, 0.1);
}

.rc-state-analyzing {
  background: linear-gradient(180deg, #eff6ff 0%, #ffffff 70%);
  border-color: #93c5fd;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.08);
}

/* ---- close ---- */
.rc-close {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  padding: 0;
  border: 0;
  background: rgba(0,0,0,0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: #94a3b8;
  z-index: 2;
  -webkit-app-region: no-drag;
}
.rc-close:hover { background: rgba(0,0,0,0.12); color: #475569; }
.rc-close:focus-visible, .rc-badge--clickable:focus-visible {
  outline: 3px solid rgba(43, 127, 227, 0.38);
  outline-offset: 2px;
}

/* ---- header ---- */
.rc-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  /* 预留右侧空间避免与关闭按钮重叠 */
  padding-right: 24px;
}

.rc-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: #e8f1fb;
  box-shadow:
    0 0 0 2px #ffffff,
    0 1px 4px rgba(15, 23, 42, 0.08);
}

.rc-avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
}

.rc-info { flex: 1; min-width: 0; }

.rc-name-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.rc-name { font-size: 15px; font-weight: 700; color: #1e293b; }
.rc-meta { font-size: 13px; color: #94a3b8; }

/* ---- badge ---- */
.rc-badge-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.rc-badge {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  white-space: nowrap;
}
.rc-badge--green { background: #dcfce7; color: #16a34a; }
.rc-badge--orange { background: #fff4e5; color: #ea580c; }
.rc-badge--blue { background: #dbeafe; color: #3b82f6; gap: 6px; }
.rc-badge--clickable {
  border: 0;
  font: inherit;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s ease;
}
.rc-badge--clickable:hover { background: #ffe5cc; }
.rc-badge-caret {
  margin-left: 2px;
  opacity: 0.75;
}

.rc-detail-link {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: none;
  margin-left: auto;
  padding: 1px 0;
  border: 0;
  color: #0f766e;
  background: transparent;
  cursor: pointer;
  font-size: 11.5px;
  font-weight: 600;
  line-height: 18px;
  -webkit-app-region: no-drag;
}

.rc-detail-link:hover,
.rc-detail-link:focus-visible {
  color: #115e59;
  text-decoration: underline;
}

.rc-detail-link:focus-visible {
  outline: 2px solid rgba(13, 148, 136, 0.28);
  outline-offset: 2px;
  border-radius: 4px;
}

.rc-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #3b82f6;
  animation: rc-pulse 1s infinite alternate;
}

.rc-followup-action {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  margin-top: 9px;
  padding: 6px 9px;
  border: 1px solid #ddd6fe;
  border-radius: 8px;
  color: #5b21b6;
  background: #f5f3ff;
  text-align: left;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.rc-followup-action:hover:not(:disabled) {
  border-color: #c4b5fd;
  background: #ede9fe;
}

.rc-followup-action:disabled {
  cursor: wait;
  opacity: 0.72;
}

.rc-followup-icon {
  display: inline-flex;
  flex: none;
}

.rc-followup-action:disabled .rc-followup-icon {
  animation: rc-spin 0.9s linear infinite;
}

.rc-followup-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.rc-followup-copy strong {
  font-size: 12.5px;
  line-height: 1.3;
}

.rc-followup-copy span {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc-refill-action {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 42px;
  margin-top: 9px;
  padding: 6px 9px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  color: #1e40af;
  background: #eff6ff;
  text-align: left;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.rc-refill-action:hover:not(:disabled) {
  border-color: #93c5fd;
  background: #dbeafe;
}

.rc-refill-action:disabled {
  cursor: wait;
  opacity: 0.72;
}

.rc-refill-icon {
  display: inline-flex;
  flex: none;
}

.rc-refill-action:disabled .rc-refill-icon {
  animation: rc-spin 0.9s linear infinite;
}

.rc-refill-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
}

.rc-refill-copy strong {
  font-size: 12.5px;
  line-height: 1.3;
}

.rc-refill-copy span {
  overflow: hidden;
  color: #64748b;
  font-size: 11px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes rc-spin {
  to { transform: rotate(360deg); }
}
@keyframes rc-pulse { 0%{opacity:1} 100%{opacity:.3} }

/* ---- risk list ---- */
.rc-risks {
  margin-top: 12px;
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  padding-right: 4px;
  overflow-y: auto;
}

.rc-risk-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.rc-tag {
  flex-shrink: 0;
  padding: 2px 12px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 600;
  border: 1.5px solid;
  white-space: nowrap;
}

.rc-risk-text {
  flex: 1;
  font-size: 15px;
  line-height: 1.45;
  color: #1e293b;
}
</style>
