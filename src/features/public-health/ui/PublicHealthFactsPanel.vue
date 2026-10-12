<script setup lang="ts">
import { computed } from 'vue';
import { SCENE_TITLES } from '../lib/publicHealthContract';
import {
  formatFactSource, formatMeasurementTime, presentPublicHealthLifestyle, presentPublicHealthMeasurements,
} from '../lib/publicHealthPresentation';
import type { PublicHealthRequest } from '../types';

const props = defineProps<{
  request: PublicHealthRequest;
  disabled: boolean;
  missing: string[];
}>();
const emit = defineEmits<{ edit: [] }>();

const seasons = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' } as const;
const lifestyleItems = computed(() => presentPublicHealthLifestyle(props.request));
const weightContext = computed(() => {
  const profile = props.request.facts.weightProfile;
  if (props.request.capability !== 'weight_management' || !profile) return [];
  return [
    { label: '地区', value: profile.region },
    { label: '季节', value: seasons[profile.season] },
    { label: '活动限制', value: profile.limitations },
  ].filter(item => item.value?.trim());
});
const measurements = computed(() => presentPublicHealthMeasurements(props.request));

function edit(): void {
  if (!props.disabled) emit('edit');
}
</script>

<template>
  <aside class="facts-panel" aria-label="本次公卫资料">
    <header class="panel-heading">
      <span class="eyebrow">本次资料</span>
      <h2 class="panel-title">{{ SCENE_TITLES[request.scene] }}</h2>
      <p class="version">记录版本 <span>{{ request.recordVersion }}</span></p>
    </header>

    <div class="facts-scroll" tabindex="0" aria-label="公卫事实详情">
      <div v-if="missing.length" class="missing-notice" role="status">
        <strong>待补充资料</strong>
        <ul class="missing-list"><li v-for="item in missing" :key="item">{{ item }}</li></ul>
      </div>

      <section class="fact-group">
        <h3 class="group-title">测量与检查 <span class="count">{{ measurements.observations.length }} 条</span></h3>
        <ul v-if="measurements.observations.length" class="observation-list" aria-label="本次测量与检查">
          <li v-for="item in measurements.observations" :key="item.id" class="observation" :class="{ adopted: item.isAdopted }">
            <div class="observation-value"><span>{{ item.label }}<small v-if="item.isAdopted" class="adopted-label">本次采用</small></span><strong>{{ item.value }} {{ item.unit || '' }}</strong></div>
            <time class="source-line" :datetime="item.observedAt">{{ formatMeasurementTime(item.observedAt) }}</time>
            <span class="source-line">来源：{{ formatFactSource(item.source?.system) }}</span>
          </li>
        </ul>
        <p v-else class="empty-text">未提供测量或检查记录</p>
        <details v-if="measurements.historical.length" class="measurement-history">
          <summary>原始与历史测量 <span class="count">{{ measurements.historical.length }} 条</span></summary>
          <ul class="observation-list" aria-label="原始与历史测量">
            <li v-for="item in measurements.historical" :key="item.id" class="observation">
              <div class="observation-value"><span>{{ item.label }}</span><strong>{{ item.value }} {{ item.unit || '' }}</strong></div>
              <time class="source-line" :datetime="item.observedAt">{{ formatMeasurementTime(item.observedAt) }}</time>
              <span class="source-line">来源：{{ formatFactSource(item.source?.system) }}</span>
            </li>
          </ul>
        </details>
      </section>

      <section class="fact-group">
        <h3 class="group-title">疾病与健康状况</h3>
        <ul v-if="request.facts.conditions.length" class="detail-list">
          <li v-for="(item, index) in request.facts.conditions" :key="`${item.code}-${index}`" class="detail-row">
            <span>{{ item.name }}</span><span class="detail-note">{{ item.status }}</span>
          </li>
        </ul>
        <p v-else class="empty-text">未提供</p>
      </section>

      <section class="fact-group">
        <h3 class="group-title">用药类别</h3>
        <ul v-if="request.facts.medicationClasses.length" class="tag-list">
          <li v-for="(item, index) in request.facts.medicationClasses" :key="`${item.code}-${index}`" class="fact-tag">{{ item.name }}</li>
        </ul>
        <p v-else class="empty-text">未提供用药类别</p>
      </section>

      <section class="fact-group">
        <h3 class="group-title">生活方式</h3>
        <dl v-if="lifestyleItems.length" class="fact-details">
          <div v-for="item in lifestyleItems" :key="item.key" class="fact-detail"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
        </dl>
        <p v-else class="empty-text">未提供</p>
      </section>

      <section v-if="weightContext.length" class="fact-group">
        <h3 class="group-title">本次减重资料</h3>
        <dl class="fact-details">
          <div v-for="item in weightContext" :key="item.label" class="fact-detail"><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div>
        </dl>
      </section>

      <section class="fact-group">
        <h3 class="group-title">病史与补充摘要</h3>
        <p class="summary" :class="{ 'empty-text': !request.facts.historySummary?.trim() }">{{ request.facts.historySummary?.trim() || '未提供' }}</p>
      </section>
      <p v-if="request.facts.nextFollowUpDate" class="follow-up">下次随访：{{ request.facts.nextFollowUpDate }}</p>
    </div>

    <footer class="panel-footer">
      <button class="edit-button" type="button" :disabled="disabled" @click="edit">资料核对与补充</button>
    </footer>
  </aside>
</template>

<style scoped>
.facts-panel{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:#f8fbff;border:1px solid #dce6f2;border-radius:8px;color:#263b55}
.panel-heading{padding:17px 16px 14px;border-bottom:1px solid #e2eaf4;background:#fff}
.eyebrow{font-size:11px;letter-spacing:.06em;color:#8091a7}.panel-title{font-size:15px;margin:7px 0 9px;font-weight:650}
.version{margin:0;font-size:11px;color:#7b8da4;overflow-wrap:anywhere}.version span{color:#425a77}
.facts-scroll{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 15px 14px;scrollbar-width:thin}
.fact-group{padding:15px 0;border-bottom:1px solid #e3ebf5}.group-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;margin:0 0 10px;font-weight:600}
.count{font-size:10px;font-weight:400;color:#8192a8;white-space:nowrap}.observation-list,.detail-list,.tag-list{list-style:none;padding:0;margin:0}
.observation{padding:9px 10px;background:#fff;border:1px solid #e4ebf5;border-radius:6px;margin-top:7px;overflow-wrap:anywhere}.observation-value{display:flex;justify-content:space-between;gap:10px;font-size:12px;line-height:1.6}.observation-value strong{font-weight:600;text-align:right}.source-line{display:block;font-size:10px;line-height:1.6;color:#8291a5;margin-top:3px}
.observation.adopted{border-color:#bcd4f5;background:#f0f6ff}.adopted-label{display:block;font-size:10px;color:#2864bd;font-weight:400}.measurement-history{margin-top:12px}.measurement-history summary{font-size:11px;line-height:1.8;color:#637d9c;cursor:pointer}.measurement-history summary .count{margin-left:6px}.measurement-history summary:focus-visible{outline:2px solid #3b82f6;outline-offset:3px}
.detail-row{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 8px;font-size:12px;line-height:1.7;padding:3px 0;overflow-wrap:anywhere}.detail-note{font-size:11px;color:#788ca5}.tag-list{display:flex;flex-wrap:wrap;gap:6px}.fact-tag{font-size:11px;line-height:1.6;padding:3px 7px;border-radius:5px;background:#eaf2fd;color:#4c6b94;overflow-wrap:anywhere}
.fact-details{margin:0}.fact-detail{display:grid;grid-template-columns:60px minmax(0,1fr);gap:8px;font-size:11px;line-height:1.8;margin-top:5px}.fact-detail dt{color:#8493a8}.fact-detail dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.summary{margin:0;font-size:12px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere}.empty-text{font-size:11px;line-height:1.7;color:#8b9aaf;margin:0}.follow-up{font-size:11px;line-height:1.8;color:#637d9c;overflow-wrap:anywhere}
.missing-notice{margin-top:14px;padding:10px;border:1px solid #f0ddba;background:#fff9ed;border-radius:6px;color:#946623;font-size:11px;line-height:1.8}.missing-list{margin:4px 0 0;padding-left:16px}.panel-footer{padding:12px 14px;border-top:1px solid #e2eaf4;background:#fff}.edit-button{width:100%;padding:9px 8px;border:1px solid #cedef4;border-radius:6px;background:#eef5ff;color:#2864bd;font:inherit;font-size:12px;cursor:pointer}.edit-button:hover:not(:disabled){background:#e4efff}.edit-button:disabled{opacity:.5;cursor:not-allowed}.edit-button:focus-visible,.facts-scroll:focus-visible{outline:2px solid #3b82f6;outline-offset:-2px}
</style>
