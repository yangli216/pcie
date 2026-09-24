import { describe, expect, it } from 'vitest';
import appSource from '@/App.vue?raw';
import resultImplementationSource from '@/components/VoiceConsultationNew.vue?raw';
import symptomResultEntrySource from '@features/symptom-consultation/ui/SymptomResultEntry.vue?raw';
import consultationResultPageSource from './ui/ConsultationResultPage.vue?raw';
import clinicalResultEditorStyleSource from './ui/ClinicalResultEditor.css?raw';
import clinicalResultSupplementDialogSource from './ui/ClinicalResultSupplementDialog.vue?raw';
import clinicalResultColumnNavigatorSource from './ui/ClinicalResultColumnNavigator.vue?raw';
import clinicalDecisionDisclaimerSource from './ui/ClinicalDecisionDisclaimer.vue?raw';
import clinicalRecordAnnotatedTextSource from './ui/ClinicalRecordAnnotatedText.vue?raw';
import writebackScopeSelectorSource from './ui/ClinicalResultWritebackScopeSelector.vue?raw';
import diagnosisRecommendationCardSource from './ui/DiagnosisRecommendationCard.vue?raw';
import diagnosisDifferentialListSource from './ui/DiagnosisDifferentialList.vue?raw';
import treatmentGenerationPlaceholderSource from './ui/TreatmentGenerationPlaceholder.vue?raw';
import voiceRecordFieldEditorSource from '@features/voice-consultation/ui/VoiceRecordFieldEditor.vue?raw';
import outpatientFollowUpPageSource from '@features/outpatient-follow-up/ui/OutpatientFollowUpPage.vue?raw';

const INTERNAL_IMPLEMENTATION_NAME = 'VoiceConsultationNew';

describe('clinical result architecture boundary', () => {
  it('keeps App on the consultation-result public entry', () => {
    expect(appSource).toContain('ConsultationResultPage');
    expect(appSource).not.toContain(INTERNAL_IMPLEMENTATION_NAME);
  });

  it('keeps symptom consultation on the consultation-result public entry', () => {
    expect(symptomResultEntrySource).toContain('ConsultationResultPage');
    expect(symptomResultEntrySource).not.toContain(INTERNAL_IMPLEMENTATION_NAME);
  });

  it('preloads visible non-medicine item details instead of waiting for selection', () => {
    expect(resultImplementationSource).toMatch(
      /watch\(\s*treatments,[\s\S]*?hydrateMatchedMedicalItemDetails\([\s\S]*?item\.type !== 'medicine'/,
    );
    expect(resultImplementationSource).toContain(':is-exec-dept-hydrating="isMedicalItemDetailHydrating"');
  });

  it('keeps chronic refill finalization visible and skips post-result record mutation', () => {
    expect(resultImplementationSource).toContain(':generation="displayedGeneration"');
    expect(resultImplementationSource).toContain('beginFinalResultApplication(result.generation)');
    expect(resultImplementationSource).toContain('finishFinalResultApplication()');
    expect(resultImplementationSource).toContain('useClinicalRecordFactSuggestionScheduler');
    expect(resultImplementationSource).toContain('isAllowed: () => allowsPostResultFactSuggestions.value');
    expect(resultImplementationSource).toContain('isBlocked: () => isResultUnavailable.value');
    expect(resultImplementationSource).not.toContain('factSuggestionTimer');
    expect(resultImplementationSource).toContain('applicationSequence !== intentResultApplicationSequence');
    expect(resultImplementationSource).toContain(
      "props.channel === 'chronic-refill' ? aiDiagnoses.value.length : 3",
    );
    expect(resultImplementationSource).toContain(
      "resultChannel.value === 'chronic-refill'",
    );
  });

  it('starts missing voice treatments in the background without holding core record finalization', () => {
    expect(resultImplementationSource).toContain('allowsTreatmentAutoFetchInBackground');
    expect(resultImplementationSource).toContain('useClinicalResultProgressiveIntentApplication');
    expect(resultImplementationSource).toMatch(
      /void maybeAutoFetchMissingTreatment\('intent-result-applied'\);[\s\S]*?finishFinalResultApplication\(\)/,
    );
  });

  it('orders ordinary voice presentation without leaking its recovery policy to other channels', () => {
    expect(resultImplementationSource).toContain('useClinicalResultGenerationSequence');
    expect(resultImplementationSource).toContain('canStartAutoTreatment');
    expect(resultImplementationSource).toContain('shouldRecoverMissingDiagnosis');
    expect(resultImplementationSource).toContain('TreatmentGenerationPlaceholder');
    expect(treatmentGenerationPlaceholderSource).toContain('role="status"');
    expect(treatmentGenerationPlaceholderSource).toContain('aria-live="polite"');
    expect(treatmentGenerationPlaceholderSource).toContain('AI 正在生成建议');
    expect(treatmentGenerationPlaceholderSource).not.toContain('匹配院内');
    expect(resultImplementationSource).toContain(':show-treatment-progress="resultChannel !== \'voice\'"');
    expect(resultImplementationSource).toContain("resultChannel.value === 'voice'");
    expect(resultImplementationSource).toContain("resultChannel.value === 'symptom'");
    expect(resultImplementationSource).not.toContain(
      'formalDiagnoses.value.length === 0 && canRefreshDiagnosis.value',
    );
    expect(resultImplementationSource).toContain("resultChannel.value === 'chronic-refill'");
  });

  it('keeps report follow-up on its independent treatment-plan page', () => {
    expect(outpatientFollowUpPageSource).toContain("import { TreatmentPlanPage } from '@features/treatment-plan'");
    expect(outpatientFollowUpPageSource).toContain('<TreatmentPlanPage');
    expect(outpatientFollowUpPageSource).not.toContain('ConsultationResultPage');
    expect(outpatientFollowUpPageSource).not.toContain('useClinicalResultGenerationSequence');
  });

  it('confines the root implementation dependency to the public result page facade', () => {
    expect(consultationResultPageSource).toContain(INTERNAL_IMPLEMENTATION_NAME);
  });

  it('keeps supplement regeneration in the shared result implementation', () => {
    expect(resultImplementationSource).toContain('ClinicalResultSupplementDialog');
    expect(resultImplementationSource).toContain('handleSupplementRegenerate');
    expect(resultImplementationSource).toContain("'补充说明'");
    expect(clinicalResultEditorStyleSource).not.toMatch(
      /\.vcn-left-panel\s*>\s*\.section-heading\s*\{[^}]*display:\s*none/s,
    );
    expect(clinicalResultEditorStyleSource).not.toContain('.vcn-left-panel .section-title::before');
    expect(clinicalResultSupplementDialogSource).toContain('正在采集声音');
    expect(clinicalResultSupplementDialogSource).toContain('waveformLevels');
  });

  it('shows independent female history fields only within the eligible age range below personal history', () => {
    expect(resultImplementationSource).toContain('v-if="hasFemaleHistoryFields"');
    expect(resultImplementationSource).toContain('isFemaleHistoryEligible');
    expect(resultImplementationSource).toContain('v-model="menstrualHistory"');
    expect(resultImplementationSource).toContain('title="月经史"');
    expect(resultImplementationSource.indexOf('v-model="personalHistory"')).toBeLessThan(
      resultImplementationSource.indexOf('v-model="menstrualHistory"'),
    );
    expect(resultImplementationSource.indexOf('v-model="menstrualHistory"')).toBeLessThan(
      resultImplementationSource.indexOf('v-model="familyHistory"'),
    );
  });

  it('keeps the record and decision columns independently readable on desktop', () => {
    expect(resultImplementationSource).toContain('ClinicalResultColumnNavigator');
    expect(resultImplementationSource).toContain('ref="clinicalResultRightColumnRef"');
    expect(resultImplementationSource).toContain('aria-label="病历详情，可独立滚动"');
    expect(resultImplementationSource).toContain('aria-label="诊断与治疗建议，可独立滚动"');
    expect(resultImplementationSource).toContain('data-clinical-section="diagnosis"');
    expect(resultImplementationSource).toContain(':data-clinical-section="section.type"');
    expect(clinicalResultColumnNavigatorSource).toContain('data-clinical-result-navigator');
    expect(clinicalResultColumnNavigatorSource).toContain("aria-current=\"item.key === activeKey ? 'location' : undefined\"");
    expect(resultImplementationSource).not.toContain('主：{{ selectedDiagnosis.name }}');
  });

  it('keeps the clinical decision disclaimer next to the shared writeback action', () => {
    expect(resultImplementationSource).toContain('ClinicalDecisionDisclaimer');
    expect(resultImplementationSource).toMatch(
      /<div class="voice-footer">\s*<ClinicalDecisionDisclaimer \/>/s,
    );
    expect(clinicalDecisionDisclaimerSource).toContain('AI 内容仅供辅助参考');
    expect(clinicalDecisionDisclaimerSource).toContain('确认后回写');
    expect(clinicalDecisionDisclaimerSource).toContain('color: var(--voice-warning, #c97a11)');
  });

  it('renders AI source marks from persisted field text without a separate reading layer', () => {
    expect(voiceRecordFieldEditorSource).toContain('ClinicalRecordAnnotatedText');
    expect(voiceRecordFieldEditorSource).not.toContain('record-field-fact-highlights');
    expect(clinicalRecordAnnotatedTextSource).toContain('pendingSuggestions');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('AI补充·待核查');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('模板预制');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('clinical-record-template-badge');
    expect(clinicalRecordAnnotatedTextSource).toMatch(
      /class="clinical-record-annotation-sign"[^>]*>AI<\/span>/,
    );
    expect(clinicalRecordAnnotatedTextSource).not.toContain("? '!' : 'AI'");
    expect(clinicalRecordAnnotatedTextSource).toContain('未记录（点击补充）');
    expect(clinicalRecordAnnotatedTextSource).toContain('text-align: left');
    expect(clinicalRecordAnnotatedTextSource).not.toContain("emit('update:modelValue', suggestion.negativeRecordText)");
    expect(clinicalRecordAnnotatedTextSource).not.toContain('confirm-negative');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('confirm-positive');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('not-applicable');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('clinical-record-safety-note');
    expect(clinicalRecordAnnotatedTextSource).toContain('@click.stop="toggleSuggestion(segment.suggestion.id, segment.text, $event)"');
    expect(clinicalRecordAnnotatedTextSource).toContain('AI 核查');
    expect(clinicalRecordAnnotatedTextSource).toContain('<strong>核查</strong>');
    expect(clinicalRecordAnnotatedTextSource).toContain('<strong>依据</strong>');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('建议病历表述');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('不影响回写');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('不要求逐项确认');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('复制建议表述');
    expect(clinicalRecordAnnotatedTextSource).toContain('调整 AI 病历表述');
    expect(clinicalRecordAnnotatedTextSource).toContain('>移除</button>');
    expect(clinicalRecordAnnotatedTextSource).toContain('>调整</button>');
    expect(clinicalRecordAnnotatedTextSource).toContain('>应用</button>');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('includeSuggestionInRecord');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('>纳入病历</button>');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('当前仅为阅读提示，不会回写');
    expect(clinicalRecordAnnotatedTextSource).not.toContain('const appended =');
    expect(clinicalRecordAnnotatedTextSource).toContain('已在病历正文中，将随当前所选病历字段回写');
    expect(clinicalRecordAnnotatedTextSource).toContain("emit('dismiss-suggestion', segment.suggestion.id)");
    expect(clinicalRecordAnnotatedTextSource).toContain('@mouseup="handleTextSelection"');
    expect(clinicalRecordAnnotatedTextSource).toContain('clinical-record-selection-copy');
    expect(clinicalRecordAnnotatedTextSource).toContain('copySelectedText');
    expect(clinicalRecordAnnotatedTextSource).toContain('@click="copySuggestionText(segment)"');
    expect(clinicalRecordAnnotatedTextSource).toMatch(
      /async function copySuggestionText[\s\S]*await copyText\(segment\.text\)[\s\S]*closeAnnotationPopover\(\)/,
    );
    expect(clinicalRecordAnnotatedTextSource).not.toContain("emit('update:modelValue', segment.suggestion.negativeRecordText)");
    expect(voiceRecordFieldEditorSource).not.toContain('confirm-negative-fact');
    expect(voiceRecordFieldEditorSource).not.toContain('confirm-positive-fact');
    expect(voiceRecordFieldEditorSource).not.toContain('not-applicable-fact');
    expect(voiceRecordFieldEditorSource).toContain("@dismiss-suggestion=\"emit('dismiss-fact-suggestion', $event)\"");
    expect(resultImplementationSource).toContain(':fact-suggestions="getRecordFieldFactSuggestions');
    expect(resultImplementationSource).toContain('@dismiss-fact-suggestion="dismissFactSuggestion"');
    expect(resultImplementationSource).toContain('hasPendingFactSuggestions');
    expect(resultImplementationSource).toContain('clinical-record-ai-notice');
    expect(resultImplementationSource).toContain('AI 标记为补充内容，红色为重点');
    expect(resultImplementationSource).toContain('会随所选字段回写');
    expect(resultImplementationSource).toContain('可点击调整或移除');
    expect(resultImplementationSource).toContain('mergeSuggestionIntoRecord: mergeFactSuggestionIntoRecord');
    expect(resultImplementationSource.indexOf('if (snapshot.writebackScope)')).toBeLessThan(
      resultImplementationSource.indexOf('if (Array.isArray(snapshot.factSuggestions))'),
    );
    expect(resultImplementationSource).not.toContain('ClinicalRecordFactPanel');
    expect(resultImplementationSource).not.toContain('ensureFactWritebackReady');
    expect(resultImplementationSource).not.toContain('formalDiagnoses.value.length > 0 && factSuggestions.value.length === 0');
  });

  it('keeps record details free of field-level feedback overlays', () => {
    expect(voiceRecordFieldEditorSource).not.toContain('VoiceRecordFeedbackPopover');
    expect(voiceRecordFieldEditorSource).not.toContain('voice-feedback-trigger');
    expect(voiceRecordFieldEditorSource).not.toContain('padding-right: 135px');
    expect(resultImplementationSource).not.toContain('@submit-feedback="handleRecordFieldFeedbackSubmit"');
    expect(resultImplementationSource).not.toContain(':feedback-key="getRecordFieldFeedbackKey');
  });

  it('keeps partial writeback selection in a dedicated anchored scope component', () => {
    expect(resultImplementationSource).toContain('ClinicalResultWritebackScopeSelector');
    expect(resultImplementationSource).toContain('useClinicalResultWritebackScope');
    expect(resultImplementationSource).toContain('writebackScope: selectedScope');
    expect(resultImplementationSource).toMatch(/class="footer-submit-btn"[\s\S]*>\s*一键回写\s*<\/button>/);
    expect(resultImplementationSource).not.toContain('回写已选内容');
    expect(writebackScopeSelectorSource).toContain('选择回写内容');
    expect(writebackScopeSelectorSource).toContain('门诊病历');
    expect(writebackScopeSelectorSource).toContain('检查、检验与处置');
    expect(writebackScopeSelectorSource).toContain("recordGroupIndeterminate ? 'mixed'");
    expect(writebackScopeSelectorSource).toContain('未选内容保持 HIS 原值');
    expect(writebackScopeSelectorSource).not.toContain('confirm-overlay');
  });

  it('finishes the result directly after writeback success without opening feedback', () => {
    expect(resultImplementationSource).toContain('completeVoiceConsultationFlow();');
    expect(resultImplementationSource).not.toContain('showSessionFeedbackDialog');
    expect(resultImplementationSource).not.toContain('VoiceSessionFeedbackBar');
    expect(resultImplementationSource).not.toContain('本次结果已回写成功');
    expect(resultImplementationSource).not.toContain('暂不反馈');
  });

  it('shows highlighted differential points in a dismissible anchored layer', () => {
    expect(resultImplementationSource).toContain(':differential-preview="getDiagnosisChecklistPreview(diag)"');
    expect(resultImplementationSource).toContain(':differential-open="isDiagnosisChecklistOpen(diag)"');
    expect(resultImplementationSource).toContain('@close-differential="handleCloseDiagnosisDifferential(diag, $event)"');
    expect(diagnosisRecommendationCardSource).toContain('diagnosis-differential-anchor');
    expect(diagnosisRecommendationCardSource).toContain('diagnosis-differential-panel');
    expect(diagnosisRecommendationCardSource).toContain('主诊断核查要点');
    expect(diagnosisRecommendationCardSource).toContain('diagnosis-differential-keyword');
    expect(diagnosisRecommendationCardSource).toContain('close-differential');
    expect(diagnosisRecommendationCardSource).toContain('关闭主诊断核查要点');
    expect(diagnosisRecommendationCardSource).toContain('width: min(520px, 70vw)');
    expect(diagnosisRecommendationCardSource).toMatch(/diagnosis-differential-points li[\s\S]*font-size: 13px/);
    expect(diagnosisRecommendationCardSource).toContain('diagnosis-differential-confirm');
    expect(diagnosisRecommendationCardSource).toContain('已确认并关闭主诊断核查要点');
    expect(diagnosisRecommendationCardSource).not.toContain('已完整展示');
    expect(diagnosisRecommendationCardSource).not.toContain('内容较多时可在框内滚动');
    expect(diagnosisRecommendationCardSource).not.toContain('diagnosis-differential-panel-hint');
    expect(diagnosisRecommendationCardSource).toMatch(
      /\.diagnosis-differential-keyword\s*\{[^}]*background:\s*transparent[^}]*font-weight:\s*700/s,
    );
    expect(diagnosisRecommendationCardSource).not.toMatch(
      /\.diagnosis-differential-keyword\s*\{[^}]*background:\s*rgba/s,
    );
    expect(diagnosisRecommendationCardSource).toContain('overflow-y: auto');
    expect(diagnosisRecommendationCardSource).not.toContain('.slice(0, 3)');
    expect(diagnosisRecommendationCardSource).not.toContain('-webkit-line-clamp');
    expect(diagnosisRecommendationCardSource).not.toContain('diagnosis-differential-preview-summary');
    expect(diagnosisRecommendationCardSource).not.toContain('diagnosis-differential-hover');
    expect(resultImplementationSource).not.toContain('checklist-overlay');
    expect(resultImplementationSource).not.toContain('鉴别排查确认');
  });

  it('keeps differential directions in a two-step doctor promotion flow', () => {
    expect(resultImplementationSource).toContain('useDifferentialDiagnosisDirection');
    expect(resultImplementationSource).toContain(':included-keys="includedDifferentialDiagnosisKeys"');
    expect(resultImplementationSource).toContain('@include="includeDifferentialDirection"');
    expect(resultImplementationSource).toContain('@supplement="supplementDifferentialDirection"');
    expect(resultImplementationSource).toContain('@promote="promoteDifferentialToFormal"');
    expect(resultImplementationSource).toContain('primaryDiagnosis || formalDiagnosis');
    expect(resultImplementationSource).toContain('previousTreatmentRefetchSuppression');
    expect(resultImplementationSource).toContain('selectedDiagnosisIdentities');
    expect(resultImplementationSource).not.toContain('setPrimaryDiagnosisSelection(formalDiagnosis)');
    expect(resultImplementationSource).toContain('class="diagnosis-empty-state"');
    expect(resultImplementationSource).toContain('当前信息不足，暂未形成正式诊断');
    expect(resultImplementationSource).toContain('可从下方纳入诊疗方向并补充依据');
    expect(diagnosisDifferentialListSource).toContain('纳入诊疗方向');
    expect(diagnosisDifferentialListSource).toContain('支持依据');
    expect(diagnosisDifferentialListSource).toContain('需核查');
    expect(diagnosisDifferentialListSource).not.toContain('<span class="summary-label">下一步</span>');
    expect(diagnosisDifferentialListSource).toContain('查看依据');
    expect(diagnosisDifferentialListSource).toContain(':aria-expanded="isSupportExpanded(diagnosis)"');
    expect(diagnosisDifferentialListSource).toContain('class="differential-summary-row"');
    expect(diagnosisDifferentialListSource).toContain('class="differential-name" :title="diagnosis.name"');
    expect(diagnosisDifferentialListSource).toMatch(
      /article\.is-included \.differential-summary-row\s*\{[^}]*grid-template-columns:\s*minmax\(190px, 1fr\) auto/s,
    );
    expect(diagnosisDifferentialListSource).toMatch(
      /\.differential-name\s*\{[^}]*white-space:\s*normal/s,
    );
    expect(diagnosisDifferentialListSource).toContain('v-if="isSupportExpanded(diagnosis)" class="differential-detail-panel"');
    expect(diagnosisDifferentialListSource).toContain('补充依据');
    expect(diagnosisDifferentialListSource).toContain('转为正式诊断');
    expect(diagnosisDifferentialListSource).toContain('转入前需匹配标准诊断库');
    expect(clinicalResultSupplementDialogSource).toContain('supplement-guidance');
  });
});
