<script setup lang="ts">
import type { TreatmentRecommendation } from '@/types/consultation';
import type { UsageOption } from '@/utils/medicalDictionaryHelpers';
import {
  getSuggestedMatchName,
  getTreatmentEditorKey,
  getTreatmentMatchLabel,
  getTreatmentOriginalName,
  getTreatmentSpec,
  hasProbableMatch,
  type MedicinePrimaryField,
} from '@features/clinical-result';
import {
  TreatmentRecommendationSection,
  type ManualMatchCandidate,
} from '@features/consultation-result';
import type { TreatmentPlanRecommendationSection } from '../model/useTreatmentPlanRecommendations';

type TreatmentPlanAttributeField = 'pharmacy' | 'execDept' | 'bodySite' | 'insurance';
type TreatmentPlanAttributeOption = { key: string; text: string; mcode?: string };

const props = defineProps<{
  section: TreatmentPlanRecommendationSection;
  selectedCount: number;
  totalCount: number;
  isPharmacyRequired: (item: TreatmentRecommendation) => boolean;
  getPharmacyDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredPharmacy: (item: TreatmentRecommendation) => boolean;
  isExecDeptRequired: (item: TreatmentRecommendation) => boolean;
  getExecDeptDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredExecDept: (item: TreatmentRecommendation) => boolean;
  getBodySiteDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredBodySite: (item: TreatmentRecommendation) => boolean;
  frequencyOptions: UsageOption[];
  routeOptions: UsageOption[];
  shouldShowTreatmentEditor: (item: TreatmentRecommendation) => boolean;
  isTreatmentEditorExpanded: (item: TreatmentRecommendation) => boolean;
  isEditableFieldActive: (item: TreatmentRecommendation, field: MedicinePrimaryField) => boolean;
  getEditableFieldKey: (item: TreatmentRecommendation, field: MedicinePrimaryField) => string;
  getMedicineFieldDisplay: (item: TreatmentRecommendation, field: MedicinePrimaryField) => string;
  getMedicineInlineSummary: (item: TreatmentRecommendation) => string;
  isMedicineInventoryChecking: (item: TreatmentRecommendation) => boolean;
  getMedicineInventoryWarning: (item: TreatmentRecommendation) => string;
  isSecondarySelectorOpen: (item: TreatmentRecommendation, field: TreatmentPlanAttributeField) => boolean;
  getPharmacySearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredPharmacyOptions: (item: TreatmentRecommendation) => TreatmentPlanAttributeOption[];
  getExecDeptSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredExecDeptOptions: (item: TreatmentRecommendation) => TreatmentPlanAttributeOption[];
  getBodySiteSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredBodySiteOptions: (item: TreatmentRecommendation) => TreatmentPlanAttributeOption[];
  getInsuranceSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredInsuranceOptions: (item: TreatmentRecommendation) => TreatmentPlanAttributeOption[];
  isManualMatchOpen: (item: TreatmentRecommendation) => boolean;
  getManualMatchKeyword: (item: TreatmentRecommendation) => string;
  getManualMatchCandidates: (item: TreatmentRecommendation) => ManualMatchCandidate[];
}>();

const emit = defineEmits<{
  toggle: [item: TreatmentRecommendation];
  confirmMatch: [item: TreatmentRecommendation];
  toggleTreatmentEditor: [item: TreatmentRecommendation, event?: Event];
  activateEditableField: [item: TreatmentRecommendation, field: MedicinePrimaryField, event?: Event];
  editableFieldBlur: [item: TreatmentRecommendation, field: MedicinePrimaryField, event: FocusEvent];
  registerEditableFieldElement: [key: string, element: unknown];
  totalQtyInput: [item: TreatmentRecommendation, event: Event];
  frequencyOpenChange: [item: TreatmentRecommendation, open: boolean];
  routeOpenChange: [item: TreatmentRecommendation, open: boolean];
  usageFieldChange: [item: TreatmentRecommendation, field: Extract<MedicinePrimaryField, 'frequency' | 'route'>, value: string, key: string];
  openPharmacy: [item: TreatmentRecommendation, event?: Event];
  openExecDept: [item: TreatmentRecommendation, event?: Event];
  openBodySite: [item: TreatmentRecommendation, event?: Event];
  openInsurance: [item: TreatmentRecommendation, event?: Event];
  closeSecondarySelector: [item: TreatmentRecommendation, field: TreatmentPlanAttributeField, event: FocusEvent];
  updatePharmacyKeyword: [item: TreatmentRecommendation, event: Event];
  selectPharmacy: [item: TreatmentRecommendation, option: TreatmentPlanAttributeOption];
  clearPharmacy: [item: TreatmentRecommendation];
  updateExecDeptKeyword: [item: TreatmentRecommendation, event: Event];
  selectExecDept: [item: TreatmentRecommendation, option: TreatmentPlanAttributeOption];
  clearExecDept: [item: TreatmentRecommendation];
  updateBodySiteKeyword: [item: TreatmentRecommendation, event: Event];
  selectBodySite: [item: TreatmentRecommendation, option: TreatmentPlanAttributeOption];
  clearBodySite: [item: TreatmentRecommendation];
  updateInsuranceKeyword: [item: TreatmentRecommendation, event: Event];
  selectInsurance: [item: TreatmentRecommendation, option: TreatmentPlanAttributeOption];
  clearInsurance: [item: TreatmentRecommendation];
  toggleManualMatch: [item: TreatmentRecommendation];
  updateManualMatchKeyword: [item: TreatmentRecommendation, value: string];
  selectManualMatchCandidate: [item: TreatmentRecommendation, candidate: ManualMatchCandidate];
  toggleRejected: [item: TreatmentRecommendation, event?: Event];
}>();

function requiresManualMatchBeforeSelect(item: TreatmentRecommendation): boolean {
  return !item.matchedItem;
}

function getTreatmentPlanReasonKey(item: TreatmentRecommendation): string {
  return `treatment-plan:${item.type}:${item.matchedItem?.id || item.name}`;
}

function getDisplayTreatmentMatchLabel(item: TreatmentRecommendation): string {
  return getTreatmentMatchLabel(item, 'detailed');
}
</script>

<template>
  <TreatmentRecommendationSection
    :section="section"
    :selected-count="selectedCount"
    :total-count="totalCount"
    layout-variant="worklist"
    :show-feedback="false"
    :show-body-site-chip="true"
    :show-exec-dept-chip-for-all-non-medicine="true"
    :requires-manual-match-before-select="requiresManualMatchBeforeSelect"
    active-reason-key="__treatment_plan_reason_inactive__"
    :get-reason-key="getTreatmentPlanReasonKey"
    :get-treatment-spec="getTreatmentSpec"
    :get-treatment-match-label="getDisplayTreatmentMatchLabel"
    :has-probable-match="hasProbableMatch"
    :get-suggested-match-name="getSuggestedMatchName"
    :get-treatment-original-name="getTreatmentOriginalName"
    :get-editor-key="getTreatmentEditorKey"
    :is-pharmacy-required="props.isPharmacyRequired"
    :get-pharmacy-display="props.getPharmacyDisplay"
    :has-required-pharmacy="props.hasRequiredPharmacy"
    :is-exec-dept-required="props.isExecDeptRequired"
    :get-exec-dept-display="props.getExecDeptDisplay"
    :has-required-exec-dept="props.hasRequiredExecDept"
    :get-body-site-display="props.getBodySiteDisplay"
    :has-required-body-site="props.hasRequiredBodySite"
    :frequency-options="frequencyOptions"
    :route-options="routeOptions"
    :should-show-treatment-editor="props.shouldShowTreatmentEditor"
    :is-treatment-editor-expanded="props.isTreatmentEditorExpanded"
    :is-editable-field-active="props.isEditableFieldActive"
    :get-editable-field-key="props.getEditableFieldKey"
    :get-medicine-field-display="props.getMedicineFieldDisplay"
    :get-medicine-inline-summary="props.getMedicineInlineSummary"
    :is-medicine-inventory-checking="props.isMedicineInventoryChecking"
    :get-medicine-inventory-warning="props.getMedicineInventoryWarning"
    :is-secondary-selector-open="props.isSecondarySelectorOpen"
    :get-pharmacy-search-keyword="props.getPharmacySearchKeyword"
    :get-filtered-pharmacy-options="props.getFilteredPharmacyOptions"
    :get-exec-dept-search-keyword="props.getExecDeptSearchKeyword"
    :get-filtered-exec-dept-options="props.getFilteredExecDeptOptions"
    :get-body-site-search-keyword="props.getBodySiteSearchKeyword"
    :get-filtered-body-site-options="props.getFilteredBodySiteOptions"
    :get-insurance-search-keyword="props.getInsuranceSearchKeyword"
    :get-filtered-insurance-options="props.getFilteredInsuranceOptions"
    :is-manual-match-open="props.isManualMatchOpen"
    :get-manual-match-keyword="props.getManualMatchKeyword"
    :get-manual-match-candidates="props.getManualMatchCandidates"
    @toggle="(item) => emit('toggle', item)"
    @confirm-match="(item) => emit('confirmMatch', item)"
    @toggle-treatment-editor="(item, event) => emit('toggleTreatmentEditor', item, event)"
    @activate-editable-field="(item, field, event) => emit('activateEditableField', item, field, event)"
    @editable-field-blur="(item, field, event) => emit('editableFieldBlur', item, field, event)"
    @register-editable-field-element="(key, element) => emit('registerEditableFieldElement', key, element)"
    @total-qty-input="(item, event) => emit('totalQtyInput', item, event)"
    @frequency-open-change="(item, open) => emit('frequencyOpenChange', item, open)"
    @route-open-change="(item, open) => emit('routeOpenChange', item, open)"
    @usage-field-change="(item, field, value, key) => emit('usageFieldChange', item, field, value, key)"
    @open-pharmacy="(item, event) => emit('openPharmacy', item, event)"
    @open-exec-dept="(item, event) => emit('openExecDept', item, event)"
    @open-body-site="(item, event) => emit('openBodySite', item, event)"
    @open-insurance="(item, event) => emit('openInsurance', item, event)"
    @close-secondary-selector="(item, field, event) => emit('closeSecondarySelector', item, field, event)"
    @update-pharmacy-keyword="(item, event) => emit('updatePharmacyKeyword', item, event)"
    @select-pharmacy="(item, option) => emit('selectPharmacy', item, option)"
    @clear-pharmacy="(item) => emit('clearPharmacy', item)"
    @update-exec-dept-keyword="(item, event) => emit('updateExecDeptKeyword', item, event)"
    @select-exec-dept="(item, option) => emit('selectExecDept', item, option)"
    @clear-exec-dept="(item) => emit('clearExecDept', item)"
    @update-body-site-keyword="(item, event) => emit('updateBodySiteKeyword', item, event)"
    @select-body-site="(item, option) => emit('selectBodySite', item, option)"
    @clear-body-site="(item) => emit('clearBodySite', item)"
    @update-insurance-keyword="(item, event) => emit('updateInsuranceKeyword', item, event)"
    @select-insurance="(item, option) => emit('selectInsurance', item, option)"
    @clear-insurance="(item) => emit('clearInsurance', item)"
    @toggle-manual-match="(item) => emit('toggleManualMatch', item)"
    @update-manual-match-keyword="(item, value) => emit('updateManualMatchKeyword', item, value)"
    @select-manual-match-candidate="(item, candidate) => emit('selectManualMatchCandidate', item, candidate)"
    @toggle-rejected="(item, event) => emit('toggleRejected', item, event)"
  />
</template>
