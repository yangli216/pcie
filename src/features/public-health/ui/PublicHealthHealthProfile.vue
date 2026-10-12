<script setup lang="ts">
import { computed, shallowRef, useId } from 'vue';
import { HEALTH_LIFESTYLE_LABELS, HEALTH_RISK_CODES, healthObservationLabel, type PublicHealthHealthProfile } from '../lib/publicHealthHealthProfile';
import { formatFactSource, formatMeasurementTime } from '../lib/publicHealthPresentation';

const props = defineProps<{ profile: PublicHealthHealthProfile }>();
const expanded = shallowRef(false);
const detailsId = useId();
const observations = computed(() => props.profile.latestObservations.filter(item => !(HEALTH_RISK_CODES as readonly string[]).includes(item.code)));
const lifestyle = computed(() => Object.entries(HEALTH_LIFESTYLE_LABELS).flatMap(([key, label]) => {
  const value = props.profile.lifestyle[key as keyof typeof HEALTH_LIFESTYLE_LABELS];
  return value?.trim() ? [{ key, label, value }] : [];
}));
const sex = computed(() => ({ male: '男', female: '女', unknown: '性别待核对' })[props.profile.patient.sex]);
const toggleDetails = () => { expanded.value = !expanded.value; };
</script>

<template>
  <section class="health-profile" aria-label="本次健康画像">
    <header class="profile-heading"><h2 class="profile-title">健康画像</h2><span class="readonly-label">本次资料 · 只读</span></header>
    <p class="profile-patient">{{ profile.patient.ageYears }}岁 · {{ sex }}<span class="snapshot">资料快照：<time :datetime="profile.snapshotAt">{{ formatMeasurementTime(profile.snapshotAt) }}</time></span></p>
    <dl class="profile-summary">
      <div class="summary-row"><dt class="summary-label">健康状况</dt><dd class="summary-value"><template v-if="profile.conditions.length"><span v-for="(condition, index) in profile.conditions" :key="`${condition.code}:${index}`" class="fact-chip">{{ condition.name }}（{{ condition.status }}）</span></template><span v-else class="missing-fact">未提供健康状况资料</span></dd></div>
      <div class="summary-row"><dt class="summary-label">用药类别</dt><dd class="summary-value"><template v-if="profile.medicationClasses.length"><span v-for="(medication, index) in profile.medicationClasses" :key="`${medication.code}:${index}`" class="fact-chip">{{ medication.name }}</span></template><span v-else class="missing-fact">用药类别待补充</span></dd></div>
      <div class="summary-row"><dt class="summary-label">已有风险分层</dt><dd class="summary-value"><template v-if="profile.knownRiskAssessments.length"><span v-for="item in profile.knownRiskAssessments" :key="item.id" class="fact-chip risk-chip">{{ healthObservationLabel(item.code) }}：{{ item.value }}<span class="risk-time">{{ formatMeasurementTime(item.observedAt) }}</span></span></template><span v-else class="missing-fact">未提供可采用的风险分层资料</span></dd></div>
      <div v-if="profile.nextFollowUpDate" class="summary-row"><dt class="summary-label">下次随访</dt><dd class="summary-value"><time :datetime="profile.nextFollowUpDate">{{ profile.nextFollowUpDate }}</time></dd></div>
    </dl>
    <p v-if="profile.excludedObservationIds.length" class="profile-notice" role="status">{{ profile.excludedObservationIds.length }} 条观察晚于本次资料快照，未采用。</p>
    <p v-for="conflict in profile.conflicts" :key="conflict.code" class="profile-notice" role="status">{{ healthObservationLabel(conflict.code) }}在同一最新时点存在不同结果，待核对，未采用为当前值。</p>
    <button class="profile-details-toggle" type="button" :aria-label="expanded ? '收起资料与来源' : '展开资料与来源'" :aria-expanded="expanded" :aria-controls="detailsId" @click="toggleDetails" @keydown.enter.prevent="toggleDetails" @keydown.space.prevent="toggleDetails">{{ expanded ? '收起资料与来源' : '展开资料与来源' }}<span aria-hidden="true">{{ expanded ? '⌃' : '⌄' }}</span></button>
    <div v-if="expanded" :id="detailsId" class="profile-details">
      <section aria-label="画像采用的最新观察"><h3 class="details-title">最新测量与检查</h3><ul v-if="observations.length" class="detail-list"><li v-for="item in observations" :key="item.id" class="detail-item"><span>{{ healthObservationLabel(item.code) }}：{{ item.value }}{{ item.unit ? ` ${item.unit}` : '' }}</span><span class="detail-meta"><time :datetime="item.observedAt">{{ formatMeasurementTime(item.observedAt) }}</time> · {{ formatFactSource(item.source.system) }} · 记录：{{ item.source.recordId }}</span></li></ul><p v-else class="missing-fact">未提供可采用的测量与检查资料</p></section>
      <section><h3 class="details-title">生活方式</h3><ul v-if="lifestyle.length" class="detail-list"><li v-for="item in lifestyle" :key="item.key" class="detail-item">{{ item.label }}：{{ item.value }}</li></ul><p v-else class="missing-fact">生活方式资料待补充</p></section>
      <section><h3 class="details-title">病史与补充摘要</h3><p class="history-text" :class="{ 'missing-fact': !profile.historySummary }">{{ profile.historySummary || '病史摘要待补充' }}</p></section>
      <section aria-label="调入观察的来源记录"><h3 class="details-title">来源记录</h3><ul v-if="profile.sources.length" class="detail-list"><li v-for="source in profile.sources" :key="JSON.stringify([source.system, source.recordId])" class="detail-item">{{ formatFactSource(source.system) }} · 记录：{{ source.recordId }}<span class="detail-meta">{{ source.observationIds.length }} 条观察（按发起方提供的来源展示）</span></li></ul><p v-else class="missing-fact">未提供观察来源记录</p></section>
    </div>
  </section>
</template>

<style scoped>
.health-profile{border:1px solid #dbe7f6;background:#f7faff;border-radius:8px;padding:14px 16px;margin-bottom:14px;line-height:1.7;color:#334761}.profile-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.profile-title{margin:0;font-size:15px;font-weight:600;color:#203a5b}.readonly-label{font-size:11px;color:#778ba7}.profile-patient{display:flex;flex-wrap:wrap;gap:6px 16px;margin:8px 0;font-size:12px}.snapshot{color:#778ba7;font-size:11px}.profile-summary{margin:0}.summary-row{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;margin-top:6px;font-size:12px}.summary-label{color:#71839b}.summary-value{margin:0;overflow-wrap:anywhere}.fact-chip{display:inline-block;margin:0 7px 4px 0}.risk-chip{color:#7f641d}.risk-time{display:block;font-size:10px;color:#8797aa}.missing-fact{color:#8495ab;font-size:12px;margin:4px 0}.profile-notice{font-size:11px;color:#906628;background:#fff8ec;border-radius:5px;padding:6px 9px;margin:8px 0 0}.profile-details-toggle{display:flex;justify-content:space-between;align-items:center;width:100%;color:#3571b6;background:transparent;border:0;border-top:1px solid #e1eaf5;padding:9px 0 0;margin-top:8px;font:inherit;font-size:12px;cursor:pointer}.profile-details-toggle:focus-visible{outline:2px solid #2473f4;outline-offset:4px;border-radius:3px}.profile-details{border-top:1px solid #e1eaf5;margin-top:9px;padding-top:3px}.details-title{font-size:12px;margin:10px 0 5px;font-weight:600}.detail-list{list-style:none;margin:0;padding:0}.detail-item{font-size:12px;margin:5px 0;overflow-wrap:anywhere}.detail-meta{display:block;font-size:10px;color:#8192a9}.history-text{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
</style>
