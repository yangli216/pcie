<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue';
import { isZonedDate } from '../lib/publicHealthContract';
import { formatFactSource, formatMeasurementTime } from '../lib/publicHealthPresentation';
import type { PublicHealthManualFacts, PublicHealthObservation, PublicHealthRequest, WeightProfile } from '../types';

const props = defineProps<{ request: PublicHealthRequest }>();
const emit = defineEmits<{ save: [input: PublicHealthManualFacts]; close: [] }>();
const formElement = useTemplateRef<HTMLFormElement>('factsForm');
const error = shallowRef('');
const isWeightManagement = computed(() => props.request.capability === 'weight_management');
const sexLocked = computed(() => props.request.patient.sex !== 'unknown');
const regions: WeightProfile['region'][] = ['东北', '华北', '华东', '华中', '华南', '西南', '西北'];
const seasons: Array<{ value: WeightProfile['season']; label: string }> = [
  { value: 'spring', label: '春季' }, { value: 'summer', label: '夏季' },
  { value: 'autumn', label: '秋季' }, { value: 'winter', label: '冬季' },
];
const draft = reactive({
  historySummary: '', sex: 'unknown' as PublicHealthManualFacts['sex'],
  heightCm: '', weightKg: '', heightMeasuredAt: '', weightMeasuredAt: '',
  region: '' as WeightProfile['region'] | '', season: '' as WeightProfile['season'] | '',
  activityDescription: '', dietPreferences: '', limitations: '',
});

function measurement(code: 'height' | 'weight'): PublicHealthObservation | undefined {
  const profile = props.request.facts.weightProfile;
  const id = code === 'height' ? profile?.heightObservationId : profile?.weightObservationId;
  return props.request.facts.observations.find(item => item.id === id && item.code === code
    && item.unit === (code === 'height' ? 'cm' : 'kg')
    && item.value === (code === 'height' ? profile?.heightCm : profile?.weightKg));
}
const heightObservation = computed(() => measurement('height'));
const weightObservation = computed(() => measurement('weight'));

function localDateTime(value: string | undefined): string {
  if (!isZonedDate(value)) return '';
  const date = new Date(value);
  const pad = (part: number, length = 2) => String(part).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function measuredAt(value: string, original: PublicHealthObservation | undefined): string | undefined {
  if (!value.trim()) return undefined;
  if (original && value === localDateTime(original.observedAt)) return original.observedAt;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return undefined;
  const parsed = new Date(value);
  if (original && isZonedDate(original.observedAt) && parsed.getTime() === Date.parse(original.observedAt)) {
    return original.observedAt;
  }
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

watch(() => props.request, (request) => {
  const profile = request.facts.weightProfile;
  Object.assign(draft, {
    historySummary: request.facts.historySummary || '', sex: request.patient.sex,
    heightCm: Number.isFinite(profile?.heightCm) ? String(profile!.heightCm) : '',
    weightKg: Number.isFinite(profile?.weightKg) ? String(profile!.weightKg) : '',
    heightMeasuredAt: localDateTime(heightObservation.value?.observedAt),
    weightMeasuredAt: localDateTime(weightObservation.value?.observedAt),
    region: profile?.region || '', season: profile?.season || '',
    activityDescription: profile?.activityDescription || '',
    dietPreferences: profile?.dietPreferences || '', limitations: profile?.limitations || '',
  });
  error.value = '';
}, { immediate: true });

function save(): void {
  error.value = '';
  const input: PublicHealthManualFacts = {
    historySummary: draft.historySummary.trim(),
    sex: sexLocked.value ? props.request.patient.sex : draft.sex,
  };
  if (isWeightManagement.value) {
    const heightCm = Number(draft.heightCm), weightKg = Number(draft.weightKg);
    const heightMeasuredAt = measuredAt(draft.heightMeasuredAt, heightObservation.value);
    const weightMeasuredAt = measuredAt(draft.weightMeasuredAt, weightObservation.value);
    if (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 300
      || !Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 1000) {
      error.value = '请核对身高、体重及单位，输入有效的正数。'; return;
    }
    if (!heightMeasuredAt || !weightMeasuredAt) {
      error.value = '请分别填写真实的身高、体重测量时间。'; return;
    }
    if (input.sex === 'unknown' || !draft.region || !draft.season) {
      error.value = '请补充明确性别、地区与季节。'; return;
    }
    Object.assign(input, {
      heightCm, weightKg, heightMeasuredAt, weightMeasuredAt,
      region: draft.region, season: draft.season,
      activityDescription: draft.activityDescription.trim(),
      dietPreferences: draft.dietPreferences.trim(), limitations: draft.limitations.trim(),
    });
  }
  emit('save', input);
}

let previousFocus: HTMLElement | null = null;
function keepFocus(event: KeyboardEvent): void {
  const elements = Array.from(formElement.value?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
  ) || []);
  const first = elements[0], last = elements[elements.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && (document.activeElement === first || document.activeElement === formElement.value)) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}
onMounted(() => {
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  formElement.value?.focus();
});
onBeforeUnmount(() => { if (previousFocus?.isConnected) previousFocus.focus(); });
</script>

<template>
  <div class="facts-backdrop">
    <form ref="factsForm" class="facts-dialog" role="dialog" aria-modal="true" aria-labelledby="public-health-facts-title"
      tabindex="-1" @submit.prevent="save" @keydown.esc.stop.prevent="emit('close')" @keydown.tab="keepFocus">
      <header class="dialog-heading">
        <div><h2 id="public-health-facts-title" class="dialog-title">资料核对与补充</h2><p class="dialog-subtitle">{{ request.patient.name }} · 仅填写已核实的本次资料</p></div>
        <button class="close-button" type="button" aria-label="关闭资料核对" @click="emit('close')">×</button>
      </header>

      <div class="dialog-body">
        <p class="notice">保存补充资料后，需重新生成建议。此处不会直接修改 PHIS 记录。</p>
        <label class="field"><span class="field-label">性别</span>
          <select v-model="draft.sex" class="control" :disabled="sexLocked">
            <option value="unknown" :disabled="isWeightManagement">待核对</option><option value="male">男</option><option value="female">女</option>
          </select>
          <span class="field-help">{{ sexLocked ? '已明确的性别需在 PHIS 更正后重新调入。' : '请在核实后补充；智能减重需要明确性别。' }}</span>
        </label>

        <template v-if="isWeightManagement">
          <div class="measurement-card">
            <h3 class="section-title">测量资料</h3>
            <p class="field-help">时间按本机当地时间填写。缺少真实测量时间时请核实，不会自动补入当前时间。</p>
            <div class="field-grid">
              <label class="field"><span class="field-label">身高（cm）</span><input v-model="draft.heightCm" class="control" type="number" inputmode="decimal" min="0.01" max="300" step="any" required /></label>
              <label class="field"><span class="field-label">体重（kg）</span><input v-model="draft.weightKg" class="control" type="number" inputmode="decimal" min="0.01" max="1000" step="any" required /></label>
              <label class="field"><span class="field-label">身高测量时间</span><input v-model="draft.heightMeasuredAt" class="control" type="datetime-local" step="any" required />
                <span v-if="heightObservation" class="field-help">原始来源：{{ formatFactSource(heightObservation.source?.system) }} · {{ formatMeasurementTime(heightObservation.observedAt) }}</span>
              </label>
              <label class="field"><span class="field-label">体重测量时间</span><input v-model="draft.weightMeasuredAt" class="control" type="datetime-local" step="any" required />
                <span v-if="weightObservation" class="field-help">原始来源：{{ formatFactSource(weightObservation.source?.system) }} · {{ formatMeasurementTime(weightObservation.observedAt) }}</span>
              </label>
            </div>
          </div>
          <div class="field-grid">
            <label class="field"><span class="field-label">地区</span><select v-model="draft.region" class="control" required><option value="" disabled>请选择地区</option><option v-for="region in regions" :key="region" :value="region">{{ region }}</option></select></label>
            <label class="field"><span class="field-label">季节</span><select v-model="draft.season" class="control" required><option value="" disabled>请选择季节</option><option v-for="season in seasons" :key="season.value" :value="season.value">{{ season.label }}</option></select></label>
          </div>
          <label class="field"><span class="field-label">日常活动</span><textarea v-model="draft.activityDescription" class="control textarea" rows="2" placeholder="填写已核实的活动情况，未了解可留空" /></label>
          <label class="field"><span class="field-label">饮食偏好</span><textarea v-model="draft.dietPreferences" class="control textarea" rows="2" placeholder="填写已核实的饮食习惯与偏好，未了解可留空" /></label>
          <label class="field"><span class="field-label">活动限制</span><textarea v-model="draft.limitations" class="control textarea" rows="2" placeholder="填写已核实的活动限制，未了解可留空" /></label>
        </template>

        <label class="field"><span class="field-label">病史与补充摘要</span><textarea v-model="draft.historySummary" class="control textarea" rows="4" placeholder="填写需要补充或更正的事实摘要，未提供的信息请勿推断" /></label>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>

      <footer class="dialog-footer"><button class="button secondary" type="button" @click="emit('close')">取消</button><button class="button primary" type="submit">保存补充资料</button></footer>
    </form>
  </div>
</template>

<style scoped>
.facts-backdrop{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;padding:18px;box-sizing:border-box;background:#172a455c}
.facts-dialog{display:flex;flex-direction:column;box-sizing:border-box;width:660px;max-width:100%;max-height:100%;min-height:0;margin:0;overflow:hidden;background:#fff;border:1px solid #dce6f2;border-radius:12px;box-shadow:0 20px 60px #11243d33;color:#263b55;font-size:13px;outline:none}
.dialog-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex:none;padding:19px 22px 16px;border-bottom:1px solid #e4ebf4}.dialog-title{font-size:17px;font-weight:650;margin:0}.dialog-subtitle{font-size:12px;color:#8291a6;line-height:1.7;margin:6px 0 0;overflow-wrap:anywhere}.close-button{flex:none;width:30px;height:30px;background:#f3f6fa;border:0;border-radius:6px;color:#70849e;font-size:23px;line-height:1;cursor:pointer}
.dialog-body{min-height:0;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:16px 22px 20px;background:#f8fbff}.notice{padding:10px 12px;margin:0 0 17px;background:#edf5ff;border:1px solid #d6e6fb;border-radius:6px;color:#537aa5;font-size:12px;line-height:1.8}.field{display:flex;flex-direction:column;min-width:0;gap:7px;margin-bottom:15px}.field-label{font-size:12px;font-weight:600;color:#415977}.control{display:block;box-sizing:border-box;width:100%;min-width:0;min-height:36px;border:1px solid #d5dfec;border-radius:6px;background:#fff;padding:8px 10px;color:#263b55;font:inherit;font-size:12px;line-height:1.5}.control:disabled{background:#edf1f6;color:#74869e;cursor:not-allowed}.control:focus-visible,.button:focus-visible,.close-button:focus-visible{outline:2px solid #478df1;outline-offset:2px}.textarea{resize:vertical;min-height:66px;max-height:220px}.field-help{font-size:11px;line-height:1.75;color:#8493a8;overflow-wrap:anywhere}.field-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);column-gap:16px}.measurement-card{padding:15px 15px 0;margin-bottom:17px;border:1px solid #dfe8f3;background:#fff;border-radius:8px}.section-title{font-size:13px;margin:0 0 6px;color:#3c5575}.measurement-card>.field-help{margin:0 0 12px}.error{margin:3px 0 0;padding:10px 12px;font-size:12px;line-height:1.8;border-radius:6px;background:#fff2f0;border:1px solid #efd0ca;color:#a74d42}.dialog-footer{display:flex;justify-content:flex-end;gap:10px;flex:none;padding:14px 22px;border-top:1px solid #e4ebf4;background:#fff}.button{padding:9px 16px;border-radius:6px;border:1px solid #d5dfec;font:inherit;font-size:12px;cursor:pointer}.secondary{background:#fff;color:#5c7492}.primary{background:#2469f2;border-color:#2469f2;color:#fff}.primary:hover{background:#1d5edc}.secondary:hover{background:#f2f6fc}
@media(max-width:580px){.facts-backdrop{padding:10px}.dialog-heading{padding:14px 16px}.dialog-body{padding:14px 16px}.dialog-footer{padding:12px 16px}.field-grid{grid-template-columns:minmax(0,1fr)}.measurement-card{padding:12px 12px 0}}
@media(max-height:450px){.facts-backdrop{padding:8px}.dialog-heading{padding:10px 16px}.dialog-subtitle{margin-top:3px}.dialog-footer{padding:9px 16px}}
</style>
