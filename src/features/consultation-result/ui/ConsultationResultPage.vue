<script setup lang="ts">
import type { VoiceOutpatientEmrStartContext } from '@features/outpatient-emr/types';
import VoiceConsultationNew from '@/components/VoiceConsultationNew.vue';
import type { AppPatient } from '@/types/appState';
import type { ClinicalResultChannel, ClinicalResultInput } from '@features/clinical-result';

const props = withDefaults(defineProps<{
  initialPatientData?: AppPatient;
  intentResult: ClinicalResultInput | null;
  intentSource?: 'llm' | 'cache' | null;
  channel?: ClinicalResultChannel;
  consultationRoundId?: string | null;
  processing?: boolean;
  showPatientHeader?: boolean;
  secondaryFooterActionText?: string;
  secondaryFooterActionDisabled?: boolean;
  voiceOutpatientEmrContext?: VoiceOutpatientEmrStartContext | null;
}>(), {
  intentSource: null,
  channel: 'voice',
  consultationRoundId: null,
  processing: false,
  showPatientHeader: true,
  secondaryFooterActionText: '',
  secondaryFooterActionDisabled: false,
  voiceOutpatientEmrContext: null,
});

const emit = defineEmits<{
  close: [];
  cancel: [];
  'secondary-footer-action': [];
}>();
</script>

<template>
  <VoiceConsultationNew
    :initial-patient-data="props.initialPatientData"
    :intent-result="props.intentResult"
    :intent-source="props.intentSource"
    :channel="props.channel"
    :consultation-round-id="props.consultationRoundId"
    :processing="props.processing"
    :show-patient-header="props.showPatientHeader"
    :secondary-footer-action-text="props.secondaryFooterActionText"
    :secondary-footer-action-disabled="props.secondaryFooterActionDisabled"
    :voice-outpatient-emr-context="props.voiceOutpatientEmrContext"
    @close="emit('close')"
    @cancel="emit('cancel')"
    @secondary-footer-action="emit('secondary-footer-action')"
  >
    <template #diagnosis-actions="slotProps">
      <slot name="diagnosis-actions" v-bind="slotProps" />
    </template>
  </VoiceConsultationNew>
</template>
