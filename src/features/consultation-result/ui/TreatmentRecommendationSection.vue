<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import Icon from '@shared/ui/Icon.vue';
import type { TreatmentRecommendation } from '@/types/consultation';
import type { UsageOption } from '@/utils/medicalDictionaryHelpers';
import type { VoiceRecommendationFeedbackDraft } from '@/types/voiceFeedback';
import type { FactCheckIssue } from '@services/factChecker';
import {
  getTreatmentNumericFieldConstraintText,
  getTreatmentNumericFieldIssue,
  getMedicineManufacturer,
  getTreatmentRemarkLength,
  isTreatmentNumericInputAllowed,
  isTreatmentRemarkOverLimit,
  TREATMENT_REMARK_MAX_LENGTH,
  type TreatmentNumericField,
} from '@features/clinical-result';
import type { SecondarySelectorField } from '../model/useSecondarySelector';
import { buildAuxiliaryRecommendationGroups } from '../model/auxiliaryRecommendationPresentation';
import ManualMatchPicker, { type ManualMatchCandidate } from './ManualMatchPicker.vue';
import MedicationPrescriptionHistoryReview from './MedicationPrescriptionHistoryReview.vue';
import TreatmentItemEditor from './TreatmentItemEditor.vue';
import TreatmentRecommendationCard from './TreatmentRecommendationCard.vue';

type MedicinePrimaryField = 'dosage' | 'frequency' | 'route' | 'total';

interface TreatmentRecommendationSectionData {
  key?: string;
  type?: TreatmentRecommendation['type'];
  itemType?: TreatmentRecommendation['type'];
  title: string;
  items: TreatmentRecommendation[];
  loading?: boolean;
  error?: string;
}

type TreatmentRecommendationSectionLayout = 'default' | 'worklist';
type TreatmentRecommendationAttributeOption = Pick<UsageOption, 'key' | 'text'> & Partial<Pick<UsageOption, 'mcode'>>;

const props = withDefaults(defineProps<{
  section: TreatmentRecommendationSectionData;
  selectedCount?: number;
  totalCount?: number;
  layoutVariant?: TreatmentRecommendationSectionLayout;
  showHeader?: boolean;
  showStats?: boolean;
  showFeedback?: boolean;
  showBodySiteChip?: boolean;
  showExecDeptChipForAllNonMedicine?: boolean;
  emptyText?: string;
  loadingText?: string;
  requiresManualMatchBeforeSelect: (item: TreatmentRecommendation) => boolean;
  getIssue?: (item: TreatmentRecommendation) => FactCheckIssue | undefined;
  getReasonKey: (item: TreatmentRecommendation) => string;
  activeReasonKey?: string;
  getTreatmentSpec: (item: TreatmentRecommendation) => string;
  getTreatmentMatchLabel: (item: TreatmentRecommendation) => string;
  hasProbableMatch: (item: TreatmentRecommendation) => boolean;
  getSuggestedMatchName: (item: TreatmentRecommendation) => string;
  getTreatmentOriginalName: (item: TreatmentRecommendation) => string;
  getEditorKey: (item: TreatmentRecommendation) => string;
  isPharmacyRequired: (item: TreatmentRecommendation) => boolean;
  getPharmacyDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredPharmacy: (item: TreatmentRecommendation) => boolean;
  isExecDeptRequired: (item: TreatmentRecommendation) => boolean;
  getExecDeptDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredExecDept: (item: TreatmentRecommendation) => boolean;
  isExecDeptHydrating?: (item: TreatmentRecommendation) => boolean;
  getBodySiteDisplay: (item: TreatmentRecommendation) => string;
  hasRequiredBodySite: (item: TreatmentRecommendation) => boolean;
  frequencyOptions: UsageOption[];
  routeOptions: UsageOption[];
  shouldShowTreatmentEditor: (item: TreatmentRecommendation) => boolean;
  shouldShowEditorToggle?: (item: TreatmentRecommendation) => boolean;
  isTreatmentEditorExpanded: (item: TreatmentRecommendation) => boolean;
  isEditableFieldActive: (item: TreatmentRecommendation, field: MedicinePrimaryField) => boolean;
  getEditableFieldKey: (item: TreatmentRecommendation, field: MedicinePrimaryField) => string;
  getMedicineFieldDisplay: (item: TreatmentRecommendation, field: MedicinePrimaryField) => string;
  getMedicineInlineSummary: (item: TreatmentRecommendation) => string;
  isMedicineInventoryChecking: (item: TreatmentRecommendation) => boolean;
  getMedicineInventoryWarning: (item: TreatmentRecommendation) => string;
  isSecondarySelectorOpen: (item: TreatmentRecommendation, field: SecondarySelectorField) => boolean;
  getPharmacySearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredPharmacyOptions: (item: TreatmentRecommendation) => TreatmentRecommendationAttributeOption[];
  getExecDeptSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredExecDeptOptions: (item: TreatmentRecommendation) => TreatmentRecommendationAttributeOption[];
  getBodySiteSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredBodySiteOptions: (item: TreatmentRecommendation) => TreatmentRecommendationAttributeOption[];
  getInsuranceSearchKeyword: (item: TreatmentRecommendation) => string;
  getFilteredInsuranceOptions: (item: TreatmentRecommendation) => TreatmentRecommendationAttributeOption[];
  isManualMatchOpen: (item: TreatmentRecommendation) => boolean;
  getManualMatchKeyword: (item: TreatmentRecommendation) => string;
  getManualMatchCandidates: (item: TreatmentRecommendation) => ManualMatchCandidate[];
  isFeedbackOpen?: (item: TreatmentRecommendation) => boolean;
  getFeedbackDraft?: (item: TreatmentRecommendation) => VoiceRecommendationFeedbackDraft;
  isFeedbackSubmitting?: (item: TreatmentRecommendation) => boolean;
  getFeedbackSubmittedLabel?: (item: TreatmentRecommendation) => string;
}>(), {
  layoutVariant: 'default',
  showHeader: true,
  showStats: true,
  showFeedback: false,
  showBodySiteChip: false,
  showExecDeptChipForAllNonMedicine: false,
  emptyText: '当前暂无推荐项目',
  loadingText: '',
  activeReasonKey: '',
  getIssue: undefined,
  shouldShowEditorToggle: undefined,
  isExecDeptHydrating: () => false,
  isFeedbackOpen: undefined,
  getFeedbackDraft: undefined,
  isFeedbackSubmitting: undefined,
  getFeedbackSubmittedLabel: undefined,
});

const emit = defineEmits<{
  toggle: [item: TreatmentRecommendation];
  toggleReason: [item: TreatmentRecommendation, event?: Event];
  confirmMatch: [item: TreatmentRecommendation, event?: Event];
  toggleFeedback: [item: TreatmentRecommendation, event?: Event];
  updateFeedbackDraft: [item: TreatmentRecommendation, draft: VoiceRecommendationFeedbackDraft];
  submitFeedback: [item: TreatmentRecommendation, draft: VoiceRecommendationFeedbackDraft];
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
  closeSecondarySelector: [item: TreatmentRecommendation, field: SecondarySelectorField, event: FocusEvent];
  updatePharmacyKeyword: [item: TreatmentRecommendation, event: Event];
  selectPharmacy: [item: TreatmentRecommendation, option: TreatmentRecommendationAttributeOption];
  clearPharmacy: [item: TreatmentRecommendation];
  updateExecDeptKeyword: [item: TreatmentRecommendation, event: Event];
  selectExecDept: [item: TreatmentRecommendation, option: TreatmentRecommendationAttributeOption];
  clearExecDept: [item: TreatmentRecommendation];
  updateBodySiteKeyword: [item: TreatmentRecommendation, event: Event];
  selectBodySite: [item: TreatmentRecommendation, option: TreatmentRecommendationAttributeOption];
  clearBodySite: [item: TreatmentRecommendation];
  updateInsuranceKeyword: [item: TreatmentRecommendation, event: Event];
  selectInsurance: [item: TreatmentRecommendation, option: TreatmentRecommendationAttributeOption];
  clearInsurance: [item: TreatmentRecommendation];
  toggleManualMatch: [item: TreatmentRecommendation, event?: Event];
  updateManualMatchKeyword: [item: TreatmentRecommendation, value: string];
  selectManualMatchCandidate: [item: TreatmentRecommendation, candidate: ManualMatchCandidate];
  toggleRejected: [item: TreatmentRecommendation, event?: Event];
}>();

const resolvedSelectedCount = computed(() => (
  typeof props.selectedCount === 'number'
    ? props.selectedCount
    : props.section.items.filter((item) => item.selected).length
));
const resolvedTotalCount = computed(() => (
  typeof props.totalCount === 'number'
    ? props.totalCount
    : props.section.items.length
));
const isAuxiliarySection = computed(() => (
  props.section.type === 'exam'
  || props.section.type === 'lab_test'
  || props.section.itemType === 'exam'
  || props.section.itemType === 'lab_test'
));
const coreRecommendationCount = computed(() => (
  props.section.items.filter((item) => item.necessity === 'core').length
));
const supplementaryRecommendationCount = computed(() => (
  props.section.items.filter((item) => item.necessity === 'supplementary').length
));
const resolvedLoadingText = computed(() => props.loadingText || `正在生成${props.section.title}...`);
const recommendationGroups = computed(() => buildAuxiliaryRecommendationGroups(
  props.section.type || props.section.itemType || props.section.items[0]?.type,
  props.section.items,
));
const remarkInputBlockedByKey = ref<Record<string, boolean>>({});
const remarkMetaIdPrefix = useId();
const numericInputBlockedByKey = ref<Record<string, TreatmentNumericField | undefined>>({});
const numericMetaIdPrefix = useId();

function getItemKey(item: TreatmentRecommendation, index: number): string {
  return `${item.type}:${item.matchedItem?.id || item.name}:${index}`;
}

function getMatchTone(item: TreatmentRecommendation): 'default' | 'warning' | 'success' {
  if (item.matchStatus === 'probable' || item.matchStatus === 'unmatched' || !item.matchedItem) {
    return 'warning';
  }
  if (item.matchStatus === 'manual' || item.matchStatus === 'confirmed' || item.matchStatus === 'exact') {
    return 'success';
  }
  return 'default';
}

function getDisplayMatchLabel(item: TreatmentRecommendation): string {
  return item.matchedItem || item.matchStatus === 'probable'
    ? props.getTreatmentMatchLabel(item) || '未匹配标准库'
    : '未匹配标准库';
}

function shouldShowManualMatchButton(item: TreatmentRecommendation): boolean {
  return !item.rejected && (item.type !== 'medicine' || !item.matchedItem);
}

function getManualMatchTitle(item: TreatmentRecommendation, sectionTitle: string): string {
  if (item.type === 'medicine') return '匹配院内药品';
  return `从标准库选择${sectionTitle.replace(/^推荐/, '').replace('项目', '')}`;
}

function getManualMatchButtonText(item: TreatmentRecommendation): string {
  if (props.isManualMatchOpen(item)) return '收起';
  if (item.type === 'medicine') return '匹配院内药品';
  return item.manualMatched ? '已更换' : '更换';
}

function getManualMatchActionTitle(item: TreatmentRecommendation): string {
  if (props.isManualMatchOpen(item)) return '收起目录选择';
  if (item.type === 'medicine') return '将 AI 药名对齐到当前院内库存药品';
  return item.manualMatched ? '重新选择标准目录项目' : '选择标准目录项目';
}

function getManualMatchDescription(item: TreatmentRecommendation): string {
  if (item.type === 'medicine') {
    return '仅用于将 AI 药名对齐到院内库存；匹配后将重新校验规格、处方字段、药房和库存';
  }
  return item.matchedItem
    ? '当前已匹配，可重新选择；更换后将重新校验执行科室和检查部位'
    : '匹配成功后才可纳入本次回写';
}

function getUsageToken(item: TreatmentRecommendation): string {
  if (item.type === 'medicine') return '';
  return item.usage || '';
}

function getInlineSummary(item: TreatmentRecommendation): string {
  return item.type === 'medicine' && !props.isTreatmentEditorExpanded(item)
    ? props.getMedicineInlineSummary(item)
    : '';
}

function normalizeMedicineIdentity(value: string): string {
  return value
    .replace(/[（(][^）)]*[）)]/gu, '')
    .replace(/\d+(?:\.\d+)?\s*(?:μg|ug|mg|g|ml|片|粒|支|盒|瓶|袋)/giu, '')
    .replace(/[\s,，、;；:：\-_/]/gu, '')
    .toLowerCase();
}

function shouldShowPrescriptionHistory(item: TreatmentRecommendation): boolean {
  const history = item.recentPrescriptionHistory;
  if (!history || item.type !== 'medicine') return false;
  const currentProductId = String(item.matchedItem?.id || '').trim();
  if (history.matchedProductId && currentProductId) {
    return history.matchedProductId === currentProductId;
  }
  return normalizeMedicineIdentity(history.matchedName) === normalizeMedicineIdentity(item.name);
}

function shouldShowEditorToggle(item: TreatmentRecommendation): boolean {
  if (props.shouldShowEditorToggle) {
    return props.shouldShowEditorToggle(item);
  }
  return true;
}

function shouldShowExecDeptField(item: TreatmentRecommendation): boolean {
  return item.type !== 'medicine';
}

function handleNonMedicineTotalQtyInput(item: TreatmentRecommendation, event: Event): void {
  if (!handleNumericInput(item, 'totalQty', event, (value) => {
    item.totalQty = value;
  })) {
    return;
  }
  item.totalManualEdited = true;
  if (!item.totalUnit) {
    item.totalUnit = '次';
  }
  if (isProcedureTotalQtyMissing(item)) {
    item.selected = false;
  }
}

function handleMedicineDaysInput(item: TreatmentRecommendation, event: Event): void {
  if (!handleNumericInput(item, 'days', event, (value) => {
    item.days = value;
  })) {
    return;
  }
  if (isMedicineDaysMissing(item)) {
    item.selected = false;
  }
}

function sanitizeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function getRemarkInputKey(item: TreatmentRecommendation): string {
  return props.getEditorKey(item) || `${item.type}:${item.matchedItem?.id || item.name}`;
}

function getRemarkMetaId(item: TreatmentRecommendation): string {
  return `${remarkMetaIdPrefix}-remark-${sanitizeDomId(getRemarkInputKey(item))}`;
}

function getNumericInputKey(item: TreatmentRecommendation): string {
  return props.getEditorKey(item) || `${item.type}:${item.matchedItem?.id || item.name}`;
}

function getNumericMetaId(item: TreatmentRecommendation, field: TreatmentNumericField): string {
  return `${numericMetaIdPrefix}-${field}-${sanitizeDomId(getNumericInputKey(item))}`;
}

function getNumericValue(item: TreatmentRecommendation, field: TreatmentNumericField): string {
  if (field === 'dosage') {
    return item.dosage || '';
  }
  if (field === 'days') {
    return item.days || '';
  }
  return item.totalQty || '';
}

function isNumericFieldInvalid(item: TreatmentRecommendation, field: TreatmentNumericField): boolean {
  return Boolean(getTreatmentNumericFieldIssue(field, getNumericValue(item, field)));
}

function getNumericFieldMessage(item: TreatmentRecommendation, field: TreatmentNumericField): string {
  const issue = getTreatmentNumericFieldIssue(field, getNumericValue(item, field));
  if (issue) {
    return issue;
  }
  if (numericInputBlockedByKey.value[getNumericInputKey(item)] === field) {
    return `仅允许${getTreatmentNumericFieldConstraintText(field)}`;
  }
  return '';
}

function setNumericInputBlocked(item: TreatmentRecommendation, field: TreatmentNumericField | null): void {
  const key = getNumericInputKey(item);
  if (field) {
    numericInputBlockedByKey.value = {
      ...numericInputBlockedByKey.value,
      [key]: field,
    };
    return;
  }
  if (!numericInputBlockedByKey.value[key]) {
    return;
  }
  const next = { ...numericInputBlockedByKey.value };
  delete next[key];
  numericInputBlockedByKey.value = next;
}

function isRemarkInputBlocked(item: TreatmentRecommendation): boolean {
  return Boolean(remarkInputBlockedByKey.value[getRemarkInputKey(item)]);
}

function setRemarkInputBlocked(item: TreatmentRecommendation, blocked: boolean): void {
  const key = getRemarkInputKey(item);
  if (blocked) {
    remarkInputBlockedByKey.value = {
      ...remarkInputBlockedByKey.value,
      [key]: true,
    };
    return;
  }
  if (!remarkInputBlockedByKey.value[key]) {
    return;
  }
  const next = { ...remarkInputBlockedByKey.value };
  delete next[key];
  remarkInputBlockedByKey.value = next;
}

function getRemarkLength(item: TreatmentRecommendation): number {
  return getTreatmentRemarkLength(item.remark || '');
}

function isRemarkOverLimit(item: TreatmentRecommendation): boolean {
  return getRemarkLength(item) > TREATMENT_REMARK_MAX_LENGTH;
}

function isRemarkAtLimit(item: TreatmentRecommendation): boolean {
  return getRemarkLength(item) === TREATMENT_REMARK_MAX_LENGTH;
}

function getRemarkLimitMessage(item: TreatmentRecommendation): string {
  const length = getRemarkLength(item);
  if (length > TREATMENT_REMARK_MAX_LENGTH) {
    return `已超出 ${length - TREATMENT_REMARK_MAX_LENGTH} 字，请删减后再提交`;
  }
  if (isRemarkInputBlocked(item)) {
    return `最多 ${TREATMENT_REMARK_MAX_LENGTH} 字，已阻止超长输入`;
  }
  if (length === TREATMENT_REMARK_MAX_LENGTH) {
    return '已达上限';
  }
  return '';
}

function getProjectedInputValue(input: HTMLInputElement, insertedText: string): string {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  return `${input.value.slice(0, start)}${insertedText}${input.value.slice(end)}`;
}

function shouldBlockNumericValue(field: TreatmentNumericField, input: HTMLInputElement, insertedText: string): boolean {
  const projected = getProjectedInputValue(input, insertedText);
  return !isTreatmentNumericInputAllowed(field, projected);
}

function blockNumericInput(item: TreatmentRecommendation, field: TreatmentNumericField, event: Event): void {
  event.preventDefault();
  setNumericInputBlocked(item, field);
}

function handleNumericBeforeInput(item: TreatmentRecommendation, field: TreatmentNumericField, event: Event): void {
  const inputEvent = event as InputEvent;
  if (inputEvent.isComposing || inputEvent.inputType.startsWith('delete')) {
    return;
  }
  const input = event.target as HTMLInputElement | null;
  const insertedText = inputEvent.data || '';
  if (!input || !insertedText) {
    return;
  }
  if (shouldBlockNumericValue(field, input, insertedText)) {
    blockNumericInput(item, field, event);
  }
}

function handleNumericPaste(item: TreatmentRecommendation, field: TreatmentNumericField, event: ClipboardEvent): void {
  const input = event.target as HTMLInputElement | null;
  const pastedText = event.clipboardData?.getData('text') || '';
  if (!input || !pastedText) {
    return;
  }
  if (shouldBlockNumericValue(field, input, pastedText)) {
    blockNumericInput(item, field, event);
  }
}

function handleNumericInput(
  item: TreatmentRecommendation,
  field: TreatmentNumericField,
  event: Event,
  assign: (value: string) => void,
): boolean {
  const input = event.target as HTMLInputElement | null;
  if (!input) {
    return false;
  }
  const nextValue = input.value;
  if (!isTreatmentNumericInputAllowed(field, nextValue)) {
    input.value = getNumericValue(item, field);
    setNumericInputBlocked(item, field);
    return false;
  }
  assign(nextValue);
  if (!getTreatmentNumericFieldIssue(field, nextValue)) {
    setNumericInputBlocked(item, null);
  }
  return true;
}

function shouldBlockRemarkValue(input: HTMLInputElement, insertedText: string): boolean {
  const projected = getProjectedInputValue(input, insertedText);
  const currentLength = getTreatmentRemarkLength(input.value);
  const projectedLength = getTreatmentRemarkLength(projected);
  return projectedLength > TREATMENT_REMARK_MAX_LENGTH && projectedLength > currentLength;
}

function blockRemarkInput(item: TreatmentRecommendation, event: Event): void {
  event.preventDefault();
  setRemarkInputBlocked(item, true);
}

function handleRemarkBeforeInput(item: TreatmentRecommendation, event: Event): void {
  const inputEvent = event as InputEvent;
  if (inputEvent.isComposing || inputEvent.inputType.startsWith('delete')) {
    return;
  }
  const input = event.target as HTMLInputElement | null;
  const insertedText = inputEvent.data || '';
  if (!input || !insertedText) {
    return;
  }
  if (shouldBlockRemarkValue(input, insertedText)) {
    blockRemarkInput(item, event);
  }
}

function handleRemarkPaste(item: TreatmentRecommendation, event: ClipboardEvent): void {
  const input = event.target as HTMLInputElement | null;
  const pastedText = event.clipboardData?.getData('text') || '';
  if (!input || !pastedText) {
    return;
  }
  if (shouldBlockRemarkValue(input, pastedText)) {
    blockRemarkInput(item, event);
  }
}

function handleRemarkInput(item: TreatmentRecommendation, event: Event): void {
  const input = event.target as HTMLInputElement | null;
  if (!input) {
    return;
  }

  const nextValue = input.value;
  const currentValue = item.remark || '';
  const nextLength = getTreatmentRemarkLength(nextValue);
  const currentLength = getTreatmentRemarkLength(currentValue);

  if (nextLength > TREATMENT_REMARK_MAX_LENGTH && nextLength > currentLength) {
    input.value = currentValue;
    setRemarkInputBlocked(item, true);
    return;
  }

  item.remark = nextValue;
  if (!isTreatmentRemarkOverLimit(nextValue)) {
    setRemarkInputBlocked(item, false);
  }
}

function shouldShowExecDeptChip(item: TreatmentRecommendation): boolean {
  return props.showExecDeptChipForAllNonMedicine
    ? shouldShowExecDeptField(item)
    : props.isExecDeptRequired(item);
}

function isExecDeptChipMissing(item: TreatmentRecommendation): boolean {
  return props.isExecDeptRequired(item)
    && !props.isExecDeptHydrating(item)
    && !props.hasRequiredExecDept(item);
}

function isExecDeptInputMissing(item: TreatmentRecommendation): boolean {
  return shouldShowExecDeptField(item) && isExecDeptChipMissing(item);
}

function hasPositiveNumber(value: unknown): boolean {
  const parsed = Number(typeof value === 'string' ? value.trim() : String(value ?? '').trim());
  return Number.isFinite(parsed) && parsed > 0;
}

function isInsuranceRequired(_item: TreatmentRecommendation): boolean {
  return true;
}

function hasRequiredInsurance(item: TreatmentRecommendation): boolean {
  return !isInsuranceRequired(item) || Boolean((item.insuranceType || '').trim());
}

function isInsuranceInputMissing(item: TreatmentRecommendation): boolean {
  return isInsuranceRequired(item) && !hasRequiredInsurance(item);
}

function isMedicineDaysMissing(item: TreatmentRecommendation): boolean {
  return item.type === 'medicine' && !hasPositiveNumber(item.days);
}

function isBodySiteInputMissing(item: TreatmentRecommendation): boolean {
  return item.type === 'exam' && !props.hasRequiredBodySite(item);
}

function isProcedureTotalQtyMissing(item: TreatmentRecommendation): boolean {
  return item.type === 'procedure' && !hasPositiveNumber(item.totalQty);
}

function getExecDeptChipTitle(item: TreatmentRecommendation): string {
  if (props.isExecDeptHydrating(item)) {
    return '正在读取执行科室';
  }
  if (props.hasRequiredExecDept(item) && props.getExecDeptDisplay(item)) {
    return '点击调整执行科室';
  }
  if (props.isExecDeptRequired(item)) {
    return '执行科室为空，点击设置后才能选中';
  }
  return '点击设置执行科室';
}

function getAttributeOptions(item: TreatmentRecommendation, field: SecondarySelectorField): TreatmentRecommendationAttributeOption[] {
  switch (field) {
    case 'pharmacy':
      return props.getFilteredPharmacyOptions(item);
    case 'execDept':
      return props.getFilteredExecDeptOptions(item);
    case 'bodySite':
      return props.getFilteredBodySiteOptions(item);
    case 'insurance':
      return props.getFilteredInsuranceOptions(item);
  }
}

function getAttributeKeyword(item: TreatmentRecommendation, field: SecondarySelectorField): string {
  switch (field) {
    case 'pharmacy':
      return props.getPharmacySearchKeyword(item);
    case 'execDept':
      return props.getExecDeptSearchKeyword(item);
    case 'bodySite':
      return props.getBodySiteSearchKeyword(item);
    case 'insurance':
      return props.getInsuranceSearchKeyword(item);
  }
}

function getAttributePlaceholder(field: SecondarySelectorField): string {
  switch (field) {
    case 'pharmacy':
      return '输入名称筛选药房';
    case 'execDept':
      return '输入名称筛选科室';
    case 'bodySite':
      return '输入名称筛选部位';
    case 'insurance':
      return '输入名称筛选医保类型';
  }
}

function getAttributeEmptyText(field: SecondarySelectorField): string {
  switch (field) {
    case 'pharmacy':
      return '未找到匹配药房';
    case 'execDept':
      return '未找到匹配科室';
    case 'bodySite':
      return '暂无可选部位';
    case 'insurance':
      return '未找到匹配医保类型';
  }
}

function hasAttributeValue(item: TreatmentRecommendation, field: SecondarySelectorField): boolean {
  switch (field) {
    case 'pharmacy':
      return Boolean(item.pharmacy);
    case 'execDept':
      return Boolean(item.execDept);
    case 'bodySite':
      return Boolean(item.bodySite);
    case 'insurance':
      return Boolean(item.insuranceType);
  }
}

function isPharmacyOptionSelected(
  item: TreatmentRecommendation,
  option: TreatmentRecommendationAttributeOption,
): boolean {
  return (item.pharmacy || '').trim() === option.text.trim();
}

function getAttributeClearLabel(field: SecondarySelectorField): string {
  switch (field) {
    case 'pharmacy':
      return '清空药房';
    case 'execDept':
      return '清空执行科室';
    case 'bodySite':
      return '清空检查部位';
    case 'insurance':
      return '清空医保限用';
  }
}

function updateAttributeKeyword(item: TreatmentRecommendation, field: SecondarySelectorField, event: Event): void {
  switch (field) {
    case 'pharmacy':
      emit('updatePharmacyKeyword', item, event);
      return;
    case 'execDept':
      emit('updateExecDeptKeyword', item, event);
      return;
    case 'bodySite':
      emit('updateBodySiteKeyword', item, event);
      return;
    case 'insurance':
      emit('updateInsuranceKeyword', item, event);
      return;
  }
}

function selectAttributeOption(item: TreatmentRecommendation, field: SecondarySelectorField, option: TreatmentRecommendationAttributeOption): void {
  switch (field) {
    case 'pharmacy':
      emit('selectPharmacy', item, option);
      return;
    case 'execDept':
      emit('selectExecDept', item, option);
      return;
    case 'bodySite':
      emit('selectBodySite', item, option);
      return;
    case 'insurance':
      emit('selectInsurance', item, option);
      return;
  }
}

function clearAttribute(item: TreatmentRecommendation, field: SecondarySelectorField): void {
  switch (field) {
    case 'pharmacy':
      emit('clearPharmacy', item);
      return;
    case 'execDept':
      emit('clearExecDept', item);
      return;
    case 'bodySite':
      emit('clearBodySite', item);
      return;
    case 'insurance':
      emit('clearInsurance', item);
      return;
  }
}

function openAttribute(item: TreatmentRecommendation, field: SecondarySelectorField, event?: Event): void {
  switch (field) {
    case 'pharmacy':
      emit('openPharmacy', item, event);
      return;
    case 'execDept':
      emit('openExecDept', item, event);
      return;
    case 'bodySite':
      emit('openBodySite', item, event);
      return;
    case 'insurance':
      emit('openInsurance', item, event);
      return;
  }
}

function getAttributeAriaLabel(field: SecondarySelectorField): string {
  switch (field) {
    case 'pharmacy':
      return '药房候选项';
    case 'execDept':
      return '执行科室候选项';
    case 'bodySite':
      return '检查部位候选项';
    case 'insurance':
      return '医保限用候选项';
  }
}

function getInputDataAttrs(item: TreatmentRecommendation, field: SecondarySelectorField): Record<string, string> {
  if (field === 'pharmacy') return { 'data-pharmacy-input': props.getEditorKey(item) };
  if (field === 'execDept') return { 'data-exec-dept-input': props.getEditorKey(item) };
  if (field === 'bodySite') return { 'data-body-site-input': props.getEditorKey(item) };
  return {};
}

function isFeedbackOpen(item: TreatmentRecommendation): boolean {
  return props.isFeedbackOpen?.(item) || false;
}

function getFeedbackDraft(item: TreatmentRecommendation): VoiceRecommendationFeedbackDraft {
  return props.getFeedbackDraft?.(item) || {
    action: '',
    issueTags: [],
    comment: '',
    correctedValue: '',
  };
}

function isFeedbackSubmitting(item: TreatmentRecommendation): boolean {
  return props.isFeedbackSubmitting?.(item) || false;
}

function getFeedbackSubmittedLabel(item: TreatmentRecommendation): string {
  return props.getFeedbackSubmittedLabel?.(item) || '';
}
</script>

<template>
  <section class="treatment-recommendation-section" :class="layoutVariant">
    <header v-if="showHeader" class="treatment-recommendation-section-header">
      <div class="treatment-recommendation-section-title">
        <h3>{{ section.title }}</h3>
      </div>
      <div v-if="showStats" class="treatment-recommendation-section-stats">
        <span>推荐 {{ resolvedTotalCount }}</span>
        <span v-if="isAuxiliarySection && coreRecommendationCount > 0" class="is-core">优先 {{ coreRecommendationCount }}</span>
        <span v-if="isAuxiliarySection && supplementaryRecommendationCount > 0">可选 {{ supplementaryRecommendationCount }}</span>
        <span class="is-selected">已选 {{ resolvedSelectedCount }}</span>
      </div>
    </header>

    <div v-if="section.loading" class="treatment-recommendation-section-state">
      <Icon icon="lucide:loader-2" :size="18" class="spin" aria-hidden="true" />
      <span>{{ resolvedLoadingText }}</span>
    </div>

    <div v-else-if="section.error" class="treatment-recommendation-section-state is-error">
      <Icon icon="lucide:circle-alert" :size="18" aria-hidden="true" />
      <span>{{ section.error }}</span>
    </div>

    <div v-else-if="section.items.length === 0" class="treatment-recommendation-section-state">
      <span>{{ emptyText }}</span>
    </div>

    <div v-else class="treatment-recommendation-list">
      <section
        v-for="group in recommendationGroups"
        :key="group.key"
        class="clinical-goal-group"
        :class="{ 'has-header': group.showHeader, 'is-multi-item': group.showHeader && group.items.length > 1 }"
      >
        <header v-if="group.showHeader" class="clinical-goal-group-header">
          <div class="clinical-goal-group-title-row">
            <h4>{{ group.title }}</h4>
          </div>
          <p v-if="group.purpose">{{ group.purpose }}</p>
          <span class="clinical-goal-group-count">{{ group.items.length }} 项</span>
        </header>
        <div class="clinical-goal-group-items">
          <TreatmentRecommendationCard
            v-for="(item, index) in group.items"
            :key="`${group.key}:${getItemKey(item, index)}`"
            :rec="item"
            :selected="!!item.selected"
            :locked="requiresManualMatchBeforeSelect(item)"
            :matching="isManualMatchOpen(item)"
            :issue="getIssue?.(item)"
            :spec="getTreatmentSpec(item)"
            :manufacturer="getMedicineManufacturer(item)"
            :reason-open="activeReasonKey === getReasonKey(item)"
            :match-label="getDisplayMatchLabel(item)"
            :match-tone="getMatchTone(item)"
            :show-exec-dept-chip="shouldShowExecDeptChip(item)"
            :exec-dept-display="getExecDeptDisplay(item)"
            :exec-dept-missing="isExecDeptChipMissing(item)"
            :exec-dept-loading="isExecDeptHydrating(item)"
            :exec-dept-title="getExecDeptChipTitle(item)"
            :show-pharmacy-chip="isPharmacyRequired(item)"
            :pharmacy-display="getPharmacyDisplay(item)"
            :pharmacy-missing="!hasRequiredPharmacy(item)"
            :pharmacy-title="hasRequiredPharmacy(item) ? '点击调整发药药房' : '发药药房未设置或不在当前药品可用药房列表，点击选择'"
            :usage-token="getUsageToken(item)"
            :probable-match-name="hasProbableMatch(item) ? getSuggestedMatchName(item) : ''"
            :original-name="getTreatmentOriginalName(item)"
            :inline-summary="getInlineSummary(item)"
            :feedback-visible="isFeedbackOpen(item)"
            :feedback-draft="getFeedbackDraft(item)"
            :feedback-submitting="isFeedbackSubmitting(item)"
            :feedback-submitted-label="getFeedbackSubmittedLabel(item)"
            :show-feedback="showFeedback"
            :show-manual-match-button="shouldShowManualMatchButton(item)"
            :manual-match-title="getManualMatchActionTitle(item)"
            :manual-match-button-text="getManualMatchButtonText(item)"
            :show-reject-button="item.type === 'medicine' && item.sourceType !== 'explicit'"
            :rejected="!!item.rejected"
            :show-editor-toggle="!item.rejected && shouldShowEditorToggle(item)"
            :editor-expanded="isTreatmentEditorExpanded(item)"
            :layout-variant="layoutVariant"
            :class="{
              'grouped-recommendation-row': group.showHeader,
              'grouped-recommendation-row-last': group.showHeader && index === group.items.length - 1,
            }"
            @toggle="emit('toggle', item)"
            @toggle-reason="emit('toggleReason', item, $event)"
            @open-pharmacy="emit('openPharmacy', item, $event)"
            @open-exec-dept="emit('openExecDept', item, $event)"
            @confirm-probable-match="emit('confirmMatch', item, $event)"
            @toggle-feedback="emit('toggleFeedback', item, $event)"
            @update:feedback-draft="emit('updateFeedbackDraft', item, $event)"
            @submit-feedback="emit('submitFeedback', item, $event)"
            @toggle-manual-match="emit('toggleManualMatch', item, $event)"
            @toggle-rejected="emit('toggleRejected', item, $event)"
            @toggle-editor="emit('toggleTreatmentEditor', item, $event)"
          >
        <template #actions>
          <button
            v-if="showBodySiteChip && item.type === 'exam'"
            class="body-site-chip"
            :class="{ missing: !hasRequiredBodySite(item) }"
            type="button"
            :title="hasRequiredBodySite(item) ? '点击调整检查部位' : '检查部位为空，点击设置后才能选中'"
            @click.stop="emit('openBodySite', item, $event)"
          >
            <span v-if="!hasRequiredBodySite(item)" class="body-site-chip-label">检查部位</span>
            <span class="body-site-chip-value">{{ getBodySiteDisplay(item) || '待设置' }}</span>
          </button>
        </template>

        <template #pharmacy-popover>
          <div
            v-if="item.type === 'medicine' && isSecondarySelectorOpen(item, 'pharmacy')"
            class="route-option-list pharmacy-chip-option-list"
            role="listbox"
            :aria-label="getAttributeAriaLabel('pharmacy')"
          >
            <button
              v-for="option in getAttributeOptions(item, 'pharmacy').slice(0, 8)"
              :key="option.key"
              class="route-option-item pharmacy-chip-option"
              :class="{ selected: isPharmacyOptionSelected(item, option) }"
              type="button"
              role="option"
              :aria-selected="isPharmacyOptionSelected(item, option)"
              @mousedown.prevent.stop="selectAttributeOption(item, 'pharmacy', option)"
            >
              <span class="route-option-text">{{ option.text }}</span>
              <Icon v-if="isPharmacyOptionSelected(item, option)" icon="lucide:check" :size="14" aria-hidden="true" />
            </button>
            <div v-if="getAttributeOptions(item, 'pharmacy').length === 0" class="route-option-empty">
              {{ getAttributeEmptyText('pharmacy') }}
            </div>
          </div>
        </template>

        <template #manual-match>
          <ManualMatchPicker
            v-if="!item.rejected && isManualMatchOpen(item)"
            :title="getManualMatchTitle(item, section.title)"
            :description="getManualMatchDescription(item)"
            :keyword="getManualMatchKeyword(item)"
            :candidates="getManualMatchCandidates(item)"
            @update:keyword="emit('updateManualMatchKeyword', item, $event)"
            @select="emit('selectManualMatchCandidate', item, $event)"
          />
        </template>

        <template #body>
          <MedicationPrescriptionHistoryReview
            v-if="shouldShowPrescriptionHistory(item) && item.recentPrescriptionHistory"
            :history="item.recentPrescriptionHistory"
            :current-total-qty="item.totalQty"
            :current-total-unit="item.totalUnit"
          />
        </template>

        <template #editor>
          <div v-if="!item.rejected && shouldShowTreatmentEditor(item)" class="editor-shell" @click.stop>
            <template v-if="item.type === 'medicine'">
              <TreatmentItemEditor
                :rec="item"
                mode="inline"
                :frequency-options="frequencyOptions"
                :route-options="routeOptions"
                :is-field-active="(field) => isEditableFieldActive(item, field)"
                :activate-field="(field, event) => emit('activateEditableField', item, field, event)"
                :on-field-blur="(field, event) => emit('editableFieldBlur', item, field, event)"
                :register-field-element="(field, element) => emit('registerEditableFieldElement', getEditableFieldKey(item, field), element)"
                :on-total-qty-input="(event) => emit('totalQtyInput', item, event)"
                :on-field-open-change="(field, open) => field === 'frequency' ? emit('frequencyOpenChange', item, open) : emit('routeOpenChange', item, open)"
                :on-usage-field-change="(field, value, key) => emit('usageFieldChange', item, field, value, key)"
                :get-display-value="(field) => getMedicineFieldDisplay(item, field)"
              />

              <div v-if="isMedicineInventoryChecking(item)" class="medicine-inventory-note checking">
                正在校验库存...
              </div>
              <div v-else-if="getMedicineInventoryWarning(item)" class="medicine-inventory-note warning">
                {{ getMedicineInventoryWarning(item) }}
              </div>

              <div v-if="isTreatmentEditorExpanded(item)" class="secondary-field-grid">
                <div class="secondary-field required numeric-secondary-field" :class="{ missing: isMedicineDaysMissing(item) || isNumericFieldInvalid(item, 'days') }">
                  <label>天数</label>
                  <div class="numeric-field">
                    <input
                      :data-treatment-days-input="getEditorKey(item)"
                      :value="item.days || ''"
                      type="text"
                      inputmode="numeric"
                      placeholder="天"
                      class="edit-input mini"
                      :aria-invalid="isMedicineDaysMissing(item) || isNumericFieldInvalid(item, 'days') ? 'true' : undefined"
                      :aria-describedby="getNumericMetaId(item, 'days')"
                      @beforeinput="handleNumericBeforeInput(item, 'days', $event)"
                      @paste="handleNumericPaste(item, 'days', $event)"
                      @input="handleMedicineDaysInput(item, $event)"
                    />
                    <div
                      v-if="getNumericFieldMessage(item, 'days')"
                      :id="getNumericMetaId(item, 'days')"
                      class="numeric-field-message"
                      :class="{ 'is-error': isNumericFieldInvalid(item, 'days') }"
                    >
                      {{ getNumericFieldMessage(item, 'days') }}
                    </div>
                  </div>
                </div>
                <div class="secondary-field required" :class="{ missing: isInsuranceInputMissing(item) }">
                  <label>医保限用</label>
                  <div class="field-editor route-field-editor" :class="{ missing: isInsuranceInputMissing(item) }" @focusout="emit('closeSecondarySelector', item, 'insurance', $event)">
                    <input
                      :data-treatment-insurance-input="getEditorKey(item)"
                      :value="getAttributeKeyword(item, 'insurance')"
                      type="text"
                      :placeholder="getAttributePlaceholder('insurance')"
                      class="edit-input"
                      :aria-invalid="isInsuranceInputMissing(item) ? 'true' : undefined"
                      @focus="openAttribute(item, 'insurance', $event)"
                      @input="updateAttributeKeyword(item, 'insurance', $event)"
                    />
                    <button
                      v-if="hasAttributeValue(item, 'insurance')"
                      class="field-clear-button"
                      type="button"
                      :aria-label="getAttributeClearLabel('insurance')"
                      :title="getAttributeClearLabel('insurance')"
                      @mousedown.prevent.stop="clearAttribute(item, 'insurance')"
                    >
                      <Icon icon="lucide:x" :size="14" aria-hidden="true" />
                    </button>
                    <div v-if="isSecondarySelectorOpen(item, 'insurance')" class="route-option-list" role="listbox" :aria-label="getAttributeAriaLabel('insurance')">
                      <button
                        v-for="option in getAttributeOptions(item, 'insurance').slice(0, 8)"
                        :key="option.key"
                        class="route-option-item"
                        type="button"
                        @mousedown.prevent.stop="selectAttributeOption(item, 'insurance', option)"
                      >
                        <span class="route-option-text">{{ option.text }}</span>
                      </button>
                      <div v-if="getAttributeOptions(item, 'insurance').length === 0" class="route-option-empty">{{ getAttributeEmptyText('insurance') }}</div>
                    </div>
                  </div>
                </div>
                <div class="secondary-field">
                  <label>规定病</label>
                  <input v-model="item.regulatedDisease" type="text" placeholder="规定病" class="edit-input" />
                </div>
                <div class="secondary-field remark-secondary-field" :class="{ 'is-over-limit': isRemarkOverLimit(item) }">
                  <label>备注</label>
                  <div class="remark-field">
                    <input
                      :value="item.remark || ''"
                      type="text"
                      placeholder="备注"
                      class="edit-input"
                      :aria-invalid="isRemarkOverLimit(item) ? 'true' : undefined"
                      :aria-describedby="getRemarkMetaId(item)"
                      @beforeinput="handleRemarkBeforeInput(item, $event)"
                      @paste="handleRemarkPaste(item, $event)"
                      @input="handleRemarkInput(item, $event)"
                    />
                    <div
                      :id="getRemarkMetaId(item)"
                      class="remark-field-meta"
                      :class="{
                        'is-warning': isRemarkAtLimit(item) || isRemarkInputBlocked(item),
                        'is-error': isRemarkOverLimit(item),
                      }"
                    >
                      <span>{{ getRemarkLength(item) }}/{{ TREATMENT_REMARK_MAX_LENGTH }}</span>
                      <span v-if="getRemarkLimitMessage(item)" class="remark-field-message">{{ getRemarkLimitMessage(item) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <div v-if="isTreatmentEditorExpanded(item)" class="secondary-field-grid">
                <div v-if="shouldShowExecDeptField(item)" class="secondary-field" :class="{ required: isExecDeptRequired(item), missing: isExecDeptInputMissing(item) }">
                  <label>执行科室</label>
                  <div
                    class="field-editor route-field-editor"
                    :class="{ missing: isExecDeptInputMissing(item) }"
                    @focusout="emit('closeSecondarySelector', item, 'execDept', $event)"
                  >
                    <input
                      v-bind="getInputDataAttrs(item, 'execDept')"
                      :value="getAttributeKeyword(item, 'execDept')"
                      type="text"
                      :placeholder="getAttributePlaceholder('execDept')"
                      class="edit-input"
                      :aria-invalid="isExecDeptInputMissing(item) ? 'true' : undefined"
                      @focus="openAttribute(item, 'execDept', $event)"
                      @input="updateAttributeKeyword(item, 'execDept', $event)"
                    />
                    <button
                      v-if="hasAttributeValue(item, 'execDept')"
                      class="field-clear-button"
                      type="button"
                      :aria-label="getAttributeClearLabel('execDept')"
                      :title="getAttributeClearLabel('execDept')"
                      @mousedown.prevent.stop="clearAttribute(item, 'execDept')"
                    >
                      <Icon icon="lucide:x" :size="14" aria-hidden="true" />
                    </button>
                    <div v-if="isSecondarySelectorOpen(item, 'execDept')" class="route-option-list" role="listbox" :aria-label="getAttributeAriaLabel('execDept')">
                      <button
                        v-for="option in getAttributeOptions(item, 'execDept').slice(0, 8)"
                        :key="option.key"
                        class="route-option-item"
                        type="button"
                        @mousedown.prevent.stop="selectAttributeOption(item, 'execDept', option)"
                      >
                        <span class="route-option-text">{{ option.text }}</span>
                        <span v-if="option.key !== option.text" class="route-option-meta">{{ option.key }}</span>
                      </button>
                      <div v-if="getAttributeOptions(item, 'execDept').length === 0" class="route-option-empty">{{ getAttributeEmptyText('execDept') }}</div>
                    </div>
                  </div>
                </div>
                <div v-if="item.type === 'exam'" class="secondary-field required" :class="{ missing: isBodySiteInputMissing(item) }">
                  <label>检查部位</label>
                  <div class="field-editor route-field-editor" :class="{ missing: isBodySiteInputMissing(item) }" @focusout="emit('closeSecondarySelector', item, 'bodySite', $event)">
                    <input
                      v-bind="getInputDataAttrs(item, 'bodySite')"
                      :value="getAttributeKeyword(item, 'bodySite')"
                      type="text"
                      :placeholder="getAttributePlaceholder('bodySite')"
                      class="edit-input"
                      :aria-invalid="isBodySiteInputMissing(item) ? 'true' : undefined"
                      @focus="openAttribute(item, 'bodySite', $event)"
                      @input="updateAttributeKeyword(item, 'bodySite', $event)"
                    />
                    <button
                      v-if="hasAttributeValue(item, 'bodySite')"
                      class="field-clear-button"
                      type="button"
                      :aria-label="getAttributeClearLabel('bodySite')"
                      :title="getAttributeClearLabel('bodySite')"
                      @mousedown.prevent.stop="clearAttribute(item, 'bodySite')"
                    >
                      <Icon icon="lucide:x" :size="14" aria-hidden="true" />
                    </button>
                    <div v-if="isSecondarySelectorOpen(item, 'bodySite')" class="route-option-list" role="listbox" :aria-label="getAttributeAriaLabel('bodySite')">
                      <button
                        v-for="option in getAttributeOptions(item, 'bodySite').slice(0, 8)"
                        :key="option.key"
                        class="route-option-item"
                        type="button"
                        @mousedown.prevent.stop="selectAttributeOption(item, 'bodySite', option)"
                      >
                        <span class="route-option-text">{{ option.text }}</span>
                        <span v-if="option.mcode" class="route-option-meta">{{ option.mcode }}</span>
                      </button>
                      <div v-if="getAttributeOptions(item, 'bodySite').length === 0" class="route-option-empty">{{ getAttributeEmptyText('bodySite') }}</div>
                    </div>
                  </div>
                </div>
                <div v-if="item.type === 'procedure'" class="secondary-field required numeric-secondary-field" :class="{ missing: isProcedureTotalQtyMissing(item) || isNumericFieldInvalid(item, 'totalQty') }">
                  <label>总量</label>
                  <div class="edit-field-row">
                    <div class="numeric-field">
                      <input
                        :value="item.totalQty || ''"
                        type="text"
                        inputmode="decimal"
                        placeholder="数量"
                        class="edit-input mini"
                        :aria-invalid="isProcedureTotalQtyMissing(item) || isNumericFieldInvalid(item, 'totalQty') ? 'true' : undefined"
                        :aria-describedby="getNumericMetaId(item, 'totalQty')"
                        @beforeinput="handleNumericBeforeInput(item, 'totalQty', $event)"
                        @paste="handleNumericPaste(item, 'totalQty', $event)"
                        @input="handleNonMedicineTotalQtyInput(item, $event)"
                      />
                      <div
                        v-if="getNumericFieldMessage(item, 'totalQty')"
                        :id="getNumericMetaId(item, 'totalQty')"
                        class="numeric-field-message"
                        :class="{ 'is-error': isNumericFieldInvalid(item, 'totalQty') }"
                      >
                        {{ getNumericFieldMessage(item, 'totalQty') }}
                      </div>
                    </div>
                    <span class="edit-unit static-unit" :class="{ placeholder: !item.totalUnit }">{{ item.totalUnit || '次' }}</span>
                  </div>
                </div>
                <div class="secondary-field required" :class="{ missing: isInsuranceInputMissing(item) }">
                  <label>医保限用</label>
                  <div class="field-editor route-field-editor" :class="{ missing: isInsuranceInputMissing(item) }" @focusout="emit('closeSecondarySelector', item, 'insurance', $event)">
                    <input
                      :value="getAttributeKeyword(item, 'insurance')"
                      type="text"
                      :placeholder="getAttributePlaceholder('insurance')"
                      class="edit-input"
                      :aria-invalid="isInsuranceInputMissing(item) ? 'true' : undefined"
                      @focus="openAttribute(item, 'insurance', $event)"
                      @input="updateAttributeKeyword(item, 'insurance', $event)"
                    />
                    <button
                      v-if="hasAttributeValue(item, 'insurance')"
                      class="field-clear-button"
                      type="button"
                      :aria-label="getAttributeClearLabel('insurance')"
                      :title="getAttributeClearLabel('insurance')"
                      @mousedown.prevent.stop="clearAttribute(item, 'insurance')"
                    >
                      <Icon icon="lucide:x" :size="14" aria-hidden="true" />
                    </button>
                    <div v-if="isSecondarySelectorOpen(item, 'insurance')" class="route-option-list" role="listbox" :aria-label="getAttributeAriaLabel('insurance')">
                      <button
                        v-for="option in getAttributeOptions(item, 'insurance').slice(0, 8)"
                        :key="option.key"
                        class="route-option-item"
                        type="button"
                        @mousedown.prevent.stop="selectAttributeOption(item, 'insurance', option)"
                      >
                        <span class="route-option-text">{{ option.text }}</span>
                      </button>
                      <div v-if="getAttributeOptions(item, 'insurance').length === 0" class="route-option-empty">{{ getAttributeEmptyText('insurance') }}</div>
                    </div>
                  </div>
                </div>
                <div class="secondary-field">
                  <label>规定病</label>
                  <input v-model="item.regulatedDisease" type="text" placeholder="规定病" class="edit-input" />
                </div>
                <div class="secondary-field secondary-field-wide remark-secondary-field" :class="{ 'is-over-limit': isRemarkOverLimit(item) }">
                  <label>备注</label>
                  <div class="remark-field">
                    <input
                      :value="item.remark || ''"
                      type="text"
                      placeholder="可选"
                      class="edit-input"
                      :aria-invalid="isRemarkOverLimit(item) ? 'true' : undefined"
                      :aria-describedby="getRemarkMetaId(item)"
                      @beforeinput="handleRemarkBeforeInput(item, $event)"
                      @paste="handleRemarkPaste(item, $event)"
                      @input="handleRemarkInput(item, $event)"
                    />
                    <div
                      :id="getRemarkMetaId(item)"
                      class="remark-field-meta"
                      :class="{
                        'is-warning': isRemarkAtLimit(item) || isRemarkInputBlocked(item),
                        'is-error': isRemarkOverLimit(item),
                      }"
                    >
                      <span>{{ getRemarkLength(item) }}/{{ TREATMENT_REMARK_MAX_LENGTH }}</span>
                      <span v-if="getRemarkLimitMessage(item)" class="remark-field-message">{{ getRemarkLimitMessage(item) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <div v-if="!item.selected" class="editor-selection-actions">
              <button class="complete-and-select-button" type="button" @click.stop="emit('toggle', item)">
                完成并选中
              </button>
            </div>
          </div>
        </template>
          </TreatmentRecommendationCard>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.treatment-recommendation-section {
  --voice-border: var(--color-border-light, #dbe4ef);
  --voice-border-strong: var(--color-border-medium, #cbd7e6);
  --voice-surface: var(--color-background-white, #ffffff);
  --voice-surface-soft: var(--color-background-light, #f7f9fc);
  --voice-surface-hover: var(--color-background-hover, #f3f7fc);
  --voice-surface-glass: var(--surface-glass-strong, rgba(255, 255, 255, 0.96));
  --voice-accent: var(--color-cta, #2b7fe3);
  --voice-accent-soft: var(--color-cta-100, rgba(43, 127, 227, 0.12));
  --voice-accent-softer: var(--color-cta-50, rgba(43, 127, 227, 0.06));
  --voice-accent-strong: var(--color-cta-dark, #1f6fd0);
  --voice-warning: var(--color-warning-text, #c97a11);
  --voice-text: var(--color-text-strong, #0f172a);
  --voice-text-muted: var(--color-text-muted, #475569);
  --voice-font-min: 13px;
  --voice-font-main: 14px;
  --voice-font-strong: 14px;
  overflow: visible;
}

.treatment-recommendation-section + .treatment-recommendation-section {
  margin-top: 14px;
}

.treatment-recommendation-section.worklist {
  --voice-accent: var(--color-info, #2563eb);
  --voice-accent-soft: rgba(37, 99, 235, 0.14);
  --voice-accent-soft: color-mix(in srgb, var(--color-info, #2563eb) 14%, transparent);
  --voice-accent-softer: rgba(37, 99, 235, 0.06);
  --voice-accent-softer: color-mix(in srgb, var(--color-info, #2563eb) 6%, transparent);
  --voice-accent-strong: #1d4ed8;
}

.treatment-recommendation-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.treatment-recommendation-section-title {
  min-width: 0;
}

.treatment-recommendation-section-title h3 {
  margin: 0;
  color: var(--voice-text);
  font-size: var(--voice-font-strong);
  font-weight: 700;
  line-height: 1.4;
}

.treatment-recommendation-section-stats {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  font-size: var(--voice-font-min);
  color: var(--voice-text-muted);
}

.treatment-recommendation-section-stats > span {
  white-space: nowrap;
}

.treatment-recommendation-section-stats > span + span::before {
  content: "·";
  margin-right: 7px;
  color: var(--voice-border-strong);
}

.treatment-recommendation-section-stats .is-core {
  color: var(--voice-accent-strong);
  font-weight: 700;
}

.treatment-recommendation-section-stats .is-selected {
  color: var(--voice-text);
  font-weight: 650;
}

.treatment-recommendation-section-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 76px;
  padding: 18px;
  color: #64748b;
  font-size: 14px;
}

.treatment-recommendation-section-state.is-error {
  color: #b45309;
  background: #fff7ed;
}

.treatment-recommendation-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.clinical-goal-group,
.clinical-goal-group-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.clinical-goal-group + .clinical-goal-group {
  margin-top: 8px;
}

.clinical-goal-group-header {
  padding: 9px 12px;
  border-left: 3px solid var(--voice-accent);
  border-radius: 0 8px 8px 0;
  background: var(--voice-accent-softer);
}

.clinical-goal-group-title-row {
  grid-area: title;
  min-width: 0;
}

.clinical-goal-group-title-row h4 {
  margin: 0;
  color: var(--voice-text);
  font-size: 14.5px;
  font-weight: 650;
  line-height: 1.5;
  white-space: nowrap;
}

.clinical-goal-group-count {
  grid-area: count;
  flex: 0 0 auto;
  color: var(--voice-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.clinical-goal-group-header p {
  min-width: 0;
  margin: 0;
  color: #475569;
  font-size: var(--voice-font-main, 14px);
  line-height: 1.5;
}

.clinical-goal-group.has-header {
  gap: 0;
  overflow: visible;
  border: 0;
  border-radius: 10px;
  background: var(--voice-surface);
}

.clinical-goal-group.has-header .clinical-goal-group-header {
  display: grid;
  grid-template-areas: "title problem count";
  grid-template-columns: max-content minmax(0, 1fr) auto;
  align-items: center;
  gap: 4px 10px;
  padding: 9px 12px;
  border-left: 0;
  border-radius: 9px 9px 0 0;
  background: #e8f5f7;
  background: color-mix(in srgb, var(--voice-surface) 80%, #dff3f6);
}

.clinical-goal-group.has-header .clinical-goal-group-header p {
  grid-area: problem;
}

.clinical-goal-group.has-header .clinical-goal-group-items {
  gap: 0;
  overflow: visible;
  border-radius: 0 0 9px 9px;
}

.grouped-recommendation-row {
  margin: 0;
  border-radius: 0;
  box-shadow: none;
}

.grouped-recommendation-row-last {
  border-radius: 0 0 10px 10px;
}

.editor-shell {
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--voice-border);
}

.medicine-inventory-note {
  margin-top: 8px;
  padding: 7px 10px;
  border-radius: 10px;
  font-size: var(--voice-font-min);
  line-height: 1.5;
}

.medicine-inventory-note.checking {
  color: var(--voice-accent);
  background: var(--voice-accent-softer);
}

.medicine-inventory-note.warning {
  color: var(--voice-warning);
  background: rgba(201, 122, 17, 0.1);
}

.secondary-field-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.treatment-recommendation-section.worklist .secondary-field-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.secondary-field {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 5px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.remark-secondary-field {
  align-items: flex-start;
}

.numeric-secondary-field {
  align-items: flex-start;
}

.secondary-field label {
  flex-shrink: 0;
  color: #334155;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.secondary-field.required label::after {
  content: "*";
  margin-left: 2px;
  color: #dc2626;
}

.secondary-field-wide {
  grid-column: 1 / -1;
}

.remark-field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.numeric-field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.numeric-field-message {
  color: var(--voice-warning);
  font-size: 12px;
  line-height: 1.35;
}

.numeric-field-message.is-error {
  color: #dc2626;
  font-weight: 600;
}

.remark-field-meta {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-height: 17px;
  color: var(--voice-text-muted);
  font-size: 12px;
  line-height: 1.35;
}

.remark-field-meta.is-warning {
  color: var(--voice-warning);
}

.remark-field-meta.is-error {
  color: #dc2626;
  font-weight: 600;
}

.remark-field-message {
  text-align: right;
}

.field-editor {
  flex: 1;
  min-width: 0;
}

.edit-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.edit-unit {
  flex-shrink: 0;
  color: var(--voice-text);
  font-size: var(--voice-font-min);
  white-space: nowrap;
}

.edit-unit.placeholder {
  color: var(--voice-text-muted);
}

.route-field-editor {
  position: relative;
}

.secondary-field > .route-field-editor {
  flex: 0 0 auto;
  align-self: stretch;
}

.route-field-editor .edit-input {
  padding-right: 34px;
}

.edit-input {
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: 1px solid var(--voice-border);
  border-radius: 10px;
  color: var(--voice-text);
  font-size: var(--voice-font-main);
  background: var(--voice-surface);
  outline: none;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.015) inset;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
}

.edit-input.mini {
  max-width: none;
}

.editor-selection-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.complete-and-select-button {
  min-height: 34px;
  padding: 0 16px;
  border: 1px solid var(--voice-accent);
  border-radius: 10px;
  background: var(--voice-accent);
  color: #fff;
  font-size: var(--voice-font-main);
  font-weight: 700;
  cursor: pointer;
}

.complete-and-select-button:hover {
  border-color: var(--voice-accent-strong);
  background: var(--voice-accent-strong);
}

.edit-input:focus {
  border-color: var(--voice-accent);
  box-shadow: 0 0 0 3px var(--voice-accent-soft);
  background: rgba(255, 255, 255, 0.98);
}

.field-editor.missing .edit-input {
  border-color: rgba(220, 38, 38, 0.72);
  background: rgba(254, 242, 242, 0.94);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18);
}

.secondary-field.missing .edit-input {
  border-color: rgba(220, 38, 38, 0.72);
  background: rgba(254, 242, 242, 0.94);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18);
}

.numeric-field .edit-input[aria-invalid="true"] {
  border-color: rgba(220, 38, 38, 0.72);
  background: rgba(254, 242, 242, 0.94);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18);
}

.remark-secondary-field.is-over-limit .edit-input {
  border-color: rgba(220, 38, 38, 0.72);
  background: rgba(254, 242, 242, 0.94);
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.18);
}

.field-editor.missing .edit-input:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.26);
}

.secondary-field.missing .edit-input:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.26);
}

.numeric-field .edit-input[aria-invalid="true"]:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.26);
}

.remark-secondary-field.is-over-limit .edit-input:focus {
  border-color: #dc2626;
  box-shadow: 0 0 0 3px rgba(248, 113, 113, 0.26);
}

.field-clear-button {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 8px;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
  margin: auto 0;
  transform: none;
  transition: color 0.16s ease, background-color 0.16s ease;
}

.field-clear-button:hover {
  color: #475569;
  background: rgba(148, 163, 184, 0.16);
}

.field-clear-button:focus-visible {
  outline: 2px solid var(--voice-accent);
  outline-offset: 2px;
}

.route-option-list {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: auto;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: max(100%, 200px);
  width: max-content;
  max-width: min(360px, 48vw);
  max-height: 230px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--voice-border);
  border-radius: 12px;
  background: var(--voice-surface-glass);
  box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
}

.pharmacy-chip-option-list {
  top: calc(100% + 6px);
  left: auto;
  right: 0;
  min-width: 150px;
  max-width: 240px;
  z-index: 60;
}

.pharmacy-chip-option.selected {
  color: var(--voice-accent-strong);
  background: var(--voice-accent-softer);
  font-weight: 700;
}

.route-option-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  color: var(--voice-text);
  font-size: 13px;
  text-align: left;
  background: transparent;
  cursor: pointer;
}

.route-option-item:hover {
  background: var(--voice-surface-hover);
}

.route-option-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--voice-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.route-option-meta {
  flex-shrink: 0;
  color: var(--voice-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.route-option-empty {
  padding: 6px 10px;
  color: var(--voice-text-muted);
  font-size: var(--voice-font-min);
}

.body-site-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 150px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(37, 99, 235, 0.18);
  border-radius: 999px;
  background: rgba(248, 250, 252, 0.96);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.body-site-chip:hover {
  border-color: #2469f2;
  background: rgba(37, 99, 235, 0.1);
}

.body-site-chip.missing {
  border-color: rgba(201, 122, 17, 0.28);
  background: rgba(201, 122, 17, 0.1);
  color: var(--voice-warning);
}

.body-site-chip-label {
  flex-shrink: 0;
}

.body-site-chip-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.spin {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

@media (max-width: 1280px) {
  .secondary-field-grid,
  .treatment-recommendation-section.worklist .secondary-field-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 720px) {
  .treatment-recommendation-section-header {
    flex-direction: column;
    align-items: stretch;
  }

  .secondary-field-grid,
  .treatment-recommendation-section.worklist .secondary-field-grid {
    grid-template-columns: 1fr;
  }

  .clinical-goal-group.has-header .clinical-goal-group-header {
    grid-template-areas:
      "title count"
      "problem problem";
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 3px 8px;
  }
}
</style>
