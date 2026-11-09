// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import source from './TreatmentRecommendationSection.vue?raw';
import cardSource from './TreatmentRecommendationCard.vue?raw';
import diagnosisCardSource from './DiagnosisRecommendationCard.vue?raw';
import TreatmentRecommendationSection from './TreatmentRecommendationSection.vue';
import type { TreatmentRecommendation } from '@/types/consultation';

let app: App | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  app?.unmount();
  app = undefined;
  host?.remove();
  host = undefined;
});

function medicine(patch: Partial<TreatmentRecommendation> = {}): TreatmentRecommendation {
  return {
    type: 'medicine',
    name: '苯磺酸氨氯地平片',
    reason: '高血压续方',
    dosage: '5',
    dosageUnit: 'mg',
    frequency: '每日一次',
    route: '口服',
    days: '28',
    totalQty: '28',
    totalUnit: '片',
    selected: false,
    ...patch,
  } as TreatmentRecommendation;
}

type SectionListeners = Record<string, ReturnType<typeof vi.fn>>;

function mountSection(items: TreatmentRecommendation[], overrides: Record<string, unknown> = {}) {
  const listeners: SectionListeners = {
    onToggle: vi.fn(),
    onToggleManualMatch: vi.fn(),
    onToggleEditor: vi.fn(),
  };
  host = document.createElement('div');
  document.body.append(host);
  const props = {
    section: { type: 'medicine', title: '推荐用药', items },
    requiresManualMatchBeforeSelect: () => false,
    getReasonKey: (item: TreatmentRecommendation) => item.name,
    getTreatmentSpec: () => '',
    getTreatmentMatchLabel: () => '',
    hasProbableMatch: () => false,
    getSuggestedMatchName: () => '',
    getTreatmentOriginalName: () => '',
    getEditorKey: (item: TreatmentRecommendation) => item.name,
    isPharmacyRequired: () => false,
    getPharmacyDisplay: () => '',
    hasRequiredPharmacy: () => true,
    isExecDeptRequired: () => false,
    getExecDeptDisplay: () => '',
    hasRequiredExecDept: () => true,
    getBodySiteDisplay: () => '',
    hasRequiredBodySite: () => true,
    frequencyOptions: [],
    routeOptions: [],
    shouldShowTreatmentEditor: () => false,
    isTreatmentEditorExpanded: () => false,
    isEditableFieldActive: () => false,
    getEditableFieldKey: (item: TreatmentRecommendation, field: string) => `${item.name}:${field}`,
    getMedicineFieldDisplay: () => '',
    getMedicineInlineSummary: () => '5mg 每日一次',
    isMedicineInventoryChecking: () => false,
    getMedicineInventoryWarning: () => '',
    isSecondarySelectorOpen: () => false,
    getPharmacySearchKeyword: () => '',
    getFilteredPharmacyOptions: () => [],
    getExecDeptSearchKeyword: () => '',
    getFilteredExecDeptOptions: () => [],
    getBodySiteSearchKeyword: () => '',
    getFilteredBodySiteOptions: () => [],
    getInsuranceSearchKeyword: () => '',
    getFilteredInsuranceOptions: () => [],
    isManualMatchOpen: () => false,
    getManualMatchKeyword: () => '',
    getManualMatchCandidates: () => [],
    ...overrides,
    ...listeners,
  };
  app = createApp(TreatmentRecommendationSection, props);
  app.mount(host);
  return { host, listeners };
}

async function tick() {
  await nextTick();
  await nextTick();
}

describe('TreatmentRecommendationSection medicine card behavior', () => {
  it('renders no drug instruction trigger or popover on a matched medicine card', async () => {
    const { host } = mountSection([medicine({
      matchedItem: { id: 'med-1', name: '苯磺酸氨氯地平片' },
      matchStatus: 'exact',
    })]);
    await tick();
    expect(host.textContent).not.toContain('说明书');
    expect(host.querySelector('.instruction-trigger')).toBeNull();
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('.treatment-select-button')).not.toBeNull();
  });

  it('keeps selection, editing and recent prescription history available for a matched medicine', async () => {
    const item = medicine({
      matchedItem: { id: 'med-1', name: '苯磺酸氨氯地平片' },
      matchStatus: 'exact',
      recentPrescriptionHistory: {
        lookbackDays: 90,
        matchedName: '苯磺酸氨氯地平片',
        matchedProductId: 'med-1',
        matchBasis: 'product-id',
        entries: [{ prescribedAt: Date.parse('2026-09-01T08:00:00+08:00'), name: '苯磺酸氨氯地平片', totalQty: '28', totalUnit: '片' }],
      },
    });
    const { host, listeners } = mountSection([item], {
      shouldShowTreatmentEditor: () => true,
      isTreatmentEditorExpanded: () => true,
    });
    await tick();
    host.querySelector<HTMLButtonElement>('.treatment-select-button')!.click();
    expect(listeners.onToggle).toHaveBeenCalledWith(item);
    expect(host.querySelector('.editor-shell')).not.toBeNull();
    expect(host.querySelector('.prescription-history-review')).not.toBeNull();
    expect(host.textContent).not.toContain('说明书');
    expect(host.querySelector('.instruction-trigger')).toBeNull();
  });

  it('keeps manual catalog matching available for an unmatched medicine without the instruction entry', async () => {
    const item = medicine({ matchedItem: undefined, matchStatus: 'unmatched' });
    const { host, listeners } = mountSection([item]);
    await tick();
    const matchButton = host.querySelector<HTMLButtonElement>('.manual-match-btn')!;
    expect(matchButton.textContent).toContain('匹配院内药品');
    matchButton.click();
    expect(listeners.onToggleManualMatch).toHaveBeenCalledWith(item, expect.anything());
    expect(host.querySelector('.instruction-trigger')).toBeNull();
    expect(host.textContent).not.toContain('说明书');
  });
});


describe('TreatmentRecommendationSection match adjustment', () => {
  it('allows matched auxiliary items to change while limiting medicines to initial catalog alignment', () => {
    expect(source).toContain("item.type !== 'medicine' || !item.matchedItem");
    expect(source).toContain("if (item.type === 'medicine') return '匹配院内药品'");
    expect(source).toContain('仅用于将 AI 药名对齐到院内库存');
    expect(source).toContain(':show-reject-button="item.type === \'medicine\' && item.sourceType !== \'explicit\'"');
    expect(source).toContain('@toggle-rejected="emit(\'toggleRejected\', item, $event)"');
  });

  it('shows recent prescription review only while it still matches the current medicine', () => {
    expect(source).toContain('shouldShowPrescriptionHistory(item)');
    expect(source).toContain('history.matchedProductId === currentProductId');
    expect(source).toContain('<MedicationPrescriptionHistoryReview');
  });

  it('shows the currently matched medicine manufacturer as secondary information', () => {
    expect(source).toContain(':manufacturer="getMedicineManufacturer(item)"');
    expect(cardSource).toContain('{{ manufacturer }}');
    expect(cardSource).not.toContain('厂家：{{ manufacturer }}');
    expect(cardSource).toContain('class="meta-token medicine-manufacturer"');
    expect(cardSource).not.toContain('class="medicine-manufacturer worklist-inline-text"');
    expect(cardSource).toMatch(
      /\.meta-token\.medicine-manufacturer\s*\{[^}]*max-width:\s*180px[^}]*color:\s*#64748b[^}]*text-overflow:\s*ellipsis/s,
    );
  });

  it('groups exam and lab items by clinical goal without changing order payload categories', () => {
    expect(source).toContain('buildAuxiliaryRecommendationGroups');
    expect(source).toContain('class="clinical-goal-group-header"');
    expect(source).toContain("'has-header': group.showHeader");
    expect(source).toContain("'grouped-recommendation-row': group.showHeader");
    expect(source).toContain("'grouped-recommendation-row-last': group.showHeader && index === group.items.length - 1");
    expect(source).toContain('<p v-if="group.purpose">{{ group.purpose }}</p>');
    expect(source).not.toContain('<span>临床问题</span>');
    expect(cardSource).toContain('<span class="auxiliary-purpose-text">{{ purposeDisplay }}</span>');
    expect(cardSource).not.toContain('>项目作用</span>');
    expect(cardSource).toContain('v-if="necessityLabel"');
    expect(cardSource).toContain('class="auxiliary-necessity-label"');
  });

  it('provides a larger selection target and lets card whitespace toggle the item', () => {
    expect(cardSource).toContain('@click="handleCardToggle"');
    expect(cardSource).toContain("target.closest([");
    expect(cardSource).toContain("emit('toggle')");
    expect(cardSource).toContain('width: 32px');
    expect(cardSource).toContain('height: 32px');
  });

  it('summarizes auxiliary recommendation priority before the grouped rows', () => {
    expect(source).toContain('coreRecommendationCount');
    expect(source).toContain('supplementaryRecommendationCount');
    expect(source).toContain('优先 {{ coreRecommendationCount }}');
    expect(source).toContain('可选 {{ supplementaryRecommendationCount }}');
    expect(source).toContain('已选 {{ resolvedSelectedCount }}');
  });

  it('places the shared problem directly after a flush group title without a repeated label', () => {
    expect(source).not.toContain('class="clinical-goal-group-icon"');
    expect(source).toContain('grid-template-areas: "title problem count"');
    expect(source).toContain('grid-area: problem');
    expect(source).toContain('font-size: var(--voice-font-main, 14px)');
    expect(source).toContain('"title count"');
    expect(source).toContain('"problem problem"');
    expect(source).toContain('{{ group.items.length }} 项');
  });

  it('keeps a missing execution department actionable without a filled warning badge', () => {
    expect(cardSource).toContain('.exec-dept-chip.missing:not(.pharmacy-chip)');
    expect(cardSource).toMatch(
      /\.exec-dept-chip\.missing:not\(\.pharmacy-chip\)\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s,
    );
    expect(cardSource).toContain("@click.stop=\"emit('open-exec-dept', $event)\"");
  });

  it('distinguishes an execution department being loaded from a confirmed missing value', () => {
    expect(source).toContain('!props.isExecDeptHydrating(item)');
    expect(source).toContain(':exec-dept-loading="isExecDeptHydrating(item)"');
    expect(cardSource).toContain("execDeptLoading ? '读取中' : execDeptDisplay || '待设置'");
    expect(cardSource).toContain(':aria-busy="execDeptLoading"');
    expect(cardSource).toMatch(
      /\.exec-dept-chip\.loading:not\(\.pharmacy-chip\)\s*\{[^}]*cursor:\s*progress/s,
    );
  });

  it('uses a quiet selected state and low-weight execution department text', () => {
    expect(cardSource).toMatch(
      /\.vcn-treatment-item\.worklist\.selected\s*\{[^}]*border-color:\s*#dbe3ee[^}]*box-shadow:\s*none/s,
    );
    expect(cardSource).toMatch(
      /\.treatment-select-button\.selected \.worklist-select-dot\s*\{[^}]*box-shadow:\s*none/s,
    );
    expect(cardSource).toMatch(
      /\.treatment-select-button\.selected \.worklist-select-dot\s*\{[^}]*background:\s*var\(--voice-accent\)[^}]*color:\s*#ffffff/s,
    );
    expect(cardSource).toMatch(
      /\.worklist-chip\s*\{[^}]*border-color:\s*transparent[^}]*background:\s*transparent/s,
    );
  });

  it('uses a soft group header and a narrow selected-row marker instead of boxed recommendation rows', () => {
    expect(source).toMatch(
      /\.clinical-goal-group\.has-header\s*\{[^}]*border:\s*0[^}]*background:\s*var\(--voice-surface\)/s,
    );
    expect(source).toMatch(
      /\.clinical-goal-group\.has-header \.clinical-goal-group-header\s*\{[^}]*background:\s*color-mix/s,
    );
    expect(source).toMatch(
      /\.clinical-goal-group\.has-header \.clinical-goal-group-items\s*\{[^}]*overflow:\s*visible/s,
    );
    expect(cardSource).toMatch(
      /\.vcn-treatment-item\.grouped-recommendation-row,[\s\S]*?\.selected\s*\{[^}]*border:\s*0[^}]*box-shadow:\s*none/s,
    );
    expect(cardSource).toMatch(
      /\.vcn-treatment-item\.grouped-recommendation-row\.selected\s*\{[^}]*border-left:\s*3px solid var\(--voice-accent\)[^}]*background:\s*color-mix/s,
    );
    expect(cardSource).not.toContain('.vcn-treatment-item.worklist.grouped-recommendation-row');
    expect(cardSource).toContain('border-top: 1px solid rgba(148, 163, 184, 0.2)');
    expect(cardSource).toMatch(
      /\.worklist-actions \.voice-feedback-trigger,[\s\S]*?\.worklist-actions \.action-arrow\s*\{[^}]*border-color:\s*transparent/s,
    );
  });

  it('keeps recommendation feedback wiring available while hiding result-page entry points by default', () => {
    expect(source).toContain('showFeedback: false');
    expect(source).toContain("toggleFeedback: [item: TreatmentRecommendation, event?: Event]");
    expect(diagnosisCardSource).toMatch(
      /showFeedback:\s*\{[^}]*type:\s*Boolean,[^}]*default:\s*false/s,
    );
    expect(diagnosisCardSource).toContain('v-if="showFeedback"');
  });
});
