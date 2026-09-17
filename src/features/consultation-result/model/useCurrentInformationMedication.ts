import { computed, ref, watch } from 'vue';
import type { ClinicalResultChannel, ClinicalResultRecommendationPlan } from '../../clinical-result/clinicalResultContract';
import type { CurrentInformationMedicationAssessment } from '../../clinical-result/currentInformationMedication';

export interface CurrentInformationMedicationRequest {
  symptomaticOnly: boolean;
  isCurrent: () => boolean;
  receive: (assessment: CurrentInformationMedicationAssessment) => void;
}

export interface CurrentInformationMedicationContext {
  channel: ClinicalResultChannel;
  scopeKey: string;
  hasSelectedDiagnosis: boolean;
  symptomaticOnly: boolean;
  plan?: ClinicalResultRecommendationPlan;
  hasMedicines: boolean;
  blocked: boolean;
  allowTreatmentRefresh: boolean;
}

export function useCurrentInformationMedication(options: {
  getContext: () => CurrentInformationMedicationContext;
  run: (request: CurrentInformationMedicationRequest) => Promise<boolean>;
  onRequest: () => void;
}) {
  const pending = ref(false);
  const error = ref('');
  const assessment = ref<CurrentInformationMedicationAssessment | null>(null);
  let sequence = 0;
  const context = computed(options.getContext);
  const eligible = computed(() => (
    (context.value.channel === 'voice' || context.value.channel === 'symptom')
    && context.value.hasSelectedDiagnosis
    && context.value.allowTreatmentRefresh
    && context.value.plan?.mode !== 'urgent_referral'
    && context.value.plan?.mode !== 'explicit_only'
  ));
  const visible = computed(() => eligible.value && (
    context.value.symptomaticOnly
    || context.value.plan?.defer.includes('medicine')
    || context.value.plan?.skip.includes('medicine')
    || !context.value.hasMedicines
    || Boolean(assessment.value) || Boolean(error.value) || pending.value
  ));
  const disabled = computed(() => context.value.blocked || pending.value || !eligible.value
    || assessment.value?.disposition === 'urgent_referral');
  const reason = computed(() => context.value.plan?.reason || '可基于当前病史、查体及已有结果评估用药。');

  watch(() => context.value.scopeKey, () => {
    sequence += 1;
    pending.value = false;
    error.value = '';
    assessment.value = null;
  }, { flush: 'sync' });

  async function request(): Promise<void> {
    if (!visible.value || disabled.value) return;
    const requestSequence = ++sequence;
    const scopeKey = context.value.scopeKey;
    const symptomaticOnly = context.value.symptomaticOnly;
    const isCurrent = () => requestSequence === sequence
      && scopeKey === context.value.scopeKey && eligible.value;
    pending.value = true;
    error.value = '';
    let nextAssessment: CurrentInformationMedicationAssessment | null = null;
    try {
      options.onRequest();
      const succeeded = await options.run({
        symptomaticOnly,
        isCurrent,
        receive: (result) => { if (isCurrent()) nextAssessment = result; },
      });
      if (!isCurrent()) return;
      if (!succeeded || !nextAssessment) throw new Error('Medication assessment unavailable');
      assessment.value = nextAssessment;
    } catch {
      if (isCurrent()) error.value = '用药评估暂未完成，原方案已保留，请稍后重试。';
    } finally {
      if (requestSequence === sequence) pending.value = false;
    }
  }

  return { visible, disabled, pending, reason, assessment, error, request };
}
