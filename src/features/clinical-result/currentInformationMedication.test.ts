import { describe, expect, it, vi } from 'vitest';
import type { TreatmentRecommendation } from '@/types/consultation';
import { buildPatientContext } from '@/utils/patientContext';
import {
  CURRENT_INFORMATION_MEDICATION_INTENT_LIMIT,
  buildCurrentInformationMedicationIntentPrompt,
  buildCurrentInformationMedicationInventoryIntents,
  buildCurrentInformationMedicationPrompt,
  buildCurrentInformationMedicationHistory,
  buildCurrentInformationMedicationTimingLog,
  buildFinalCurrentInformationMedicationAssessment,
  mergeCurrentInformationMedicationStageAssessments,
  mergeCurrentInformationMedicines,
  prepareCurrentInformationMedicines,
  parseCurrentInformationMedicationResult,
} from './currentInformationMedication';

const candidate = {
  name: '测试药品', purpose: 'symptomatic', eligibility: 'supported',
  basis: '当前明确的症状', reason: '缓解症状', missingEvidence: [], targetDose: '5', targetDoseUnit: 'mg',
};
const response = (medicines: unknown[], disposition = 'medication_options') => ({
  summary: '依据当前信息评估', disposition, medicines,
});

describe('current information medication assessment', () => {
  it('builds numeric-only end-to-end timing details', () => {
    const log = buildCurrentInformationMedicationTimingLog({
      startedAt: 1_000,
      assessmentStartedAt: 1_120,
      finalizationStartedAt: 1_820,
      completedAt: 2_100,
      candidateCount: 3,
      readyCount: 2,
      deferredCount: 1,
    });
    expect(log).toEqual({
      durationMs: 1_100,
      details: {
        preparationMs: 120,
        aiAssessmentMs: 700,
        finalizationMs: 280,
        totalMs: 1_100,
        candidateCount: 3,
        readyCount: 2,
        deferredCount: 1,
      },
    });
    expect(Object.values(log.details).every((value) => typeof value === 'number')).toBe(true);
  });

  it('preserves current allergy facts alongside unknown HIS history and includes HIS current medicines', () => {
    expect(buildCurrentInformationMedicationHistory(buildPatientContext({
      payload: { patientId: 'patient-1', allergyHistory: '未记录', currentMedicationHistory: '氨氯地平' },
    }), { allergyHistory: '青霉素过敏' })).toEqual({
      allergyHistory: { patientRecord: '未记录', currentEncounter: '青霉素过敏' },
      currentMedicationHistory: { patientRecord: '氨氯地平', currentEncounter: '' },
    });
  });

  it('checks inventory for unselected candidates after finalization and skips incomplete medicines', async () => {
    const ready = { type: 'medicine', name: '药品A', selected: false } as TreatmentRecommendation;
    const incomplete = { type: 'medicine', name: '药品B', selected: false } as TreatmentRecommendation;
    const order: string[] = [];
    const onSummary = vi.fn();
    const checkInventory = vi.fn(async () => { order.push('inventory'); return true; });
    const prepared = await prepareCurrentInformationMedicines([ready, incomplete], {
      finalize: async () => { order.push('finalize'); return [
        { item: ready, ready: true },
        { item: incomplete, ready: false, issues: ['一次剂量不完整'] },
      ]; },
      checkInventory,
      isCurrent: () => true,
      onSummary,
    });
    expect(prepared).toMatchObject({
      readyItems: [ready],
      unavailable: [{ name: '药品B', reason: '一次剂量不完整' }],
      candidateCount: 2,
      finalizedCount: 1,
      inventoryReadyCount: 1,
    });
    expect(order).toEqual(['finalize', 'inventory']);
    expect(checkInventory).toHaveBeenCalledWith(ready);
    expect(checkInventory).toHaveBeenCalledTimes(1);
    expect(ready.selected).toBe(false);
    expect(onSummary).toHaveBeenCalledWith({
      candidateCount: 2,
      finalizedCount: 1,
      inventoryReadyCount: 1,
    });
  });

  it('rejects a late preparation result before inventory checks or committing medicines', async () => {
    const checkInventory = vi.fn(async () => true);
    const ready = { type: 'medicine', name: '药品A' } as TreatmentRecommendation;
    expect(await prepareCurrentInformationMedicines([ready], {
      finalize: async () => [{ item: ready, ready: true }],
      checkInventory, isCurrent: () => false,
    })).toBeNull();
    expect(checkInventory).not.toHaveBeenCalled();
  });

  it('keeps inventory failures out of selectable cards and records a deferred reason', async () => {
    const unavailable = { type: 'medicine', name: '药品A', selected: false } as TreatmentRecommendation;
    const prepared = await prepareCurrentInformationMedicines([unavailable], {
      finalize: async () => [{ item: unavailable, ready: true }],
      checkInventory: async () => false,
      isCurrent: () => true,
    });
    expect(prepared?.readyItems).toEqual([]);
    expect(prepared?.unavailable).toEqual([{
      name: '药品A', reason: '当前药房库存不足或暂无法完成库存核验',
    }]);
  });

  it('only exposes supported medicines and keeps missing evidence entries read-only', () => {
    const result = parseCurrentInformationMedicationResult(response([
      candidate,
      { ...candidate, name: '待查药品', eligibility: 'requires_evidence', missingEvidence: ['肾功能结果'] },
      { ...candidate, name: '矛盾评估药品', missingEvidence: ['体重'] },
    ]), false);
    expect(result.recommendations.map((item) => item.name)).toEqual(['测试药品']);
    expect(result.deferred).toEqual([
      { name: '待查药品', reason: '缓解症状；肾功能结果' },
      { name: '矛盾评估药品', reason: '缓解症状；体重' },
    ]);
  });

  it('rejects etiologic treatment for a symptom working diagnosis even if AI labels it supported', () => {
    const result = parseCurrentInformationMedicationResult(response([
      candidate, { ...candidate, name: '病因药品', purpose: 'etiologic' },
    ]), true);
    expect(result.recommendations).toHaveLength(1);
    expect(result.deferred[0].reason).toContain('尚不支持病因治疗');
  });

  it('returns no medicine for urgent disposition or a successful empty assessment', () => {
    expect(parseCurrentInformationMedicationResult(response([candidate], 'urgent_referral'), false).recommendations).toEqual([]);
    expect(parseCurrentInformationMedicationResult(response([]), false)).toMatchObject({
      summary: '依据当前信息评估', recommendations: [], deferred: [],
    });
  });

  it('builds the visible summary from finalized cards instead of trusting model drug prose', () => {
    const assessment = {
      summary: '可考虑药品甲和药品乙',
      disposition: 'medication_options' as const,
      deferred: [{ name: '待查药品', reason: '缺少肾功能' }],
    };
    const ready = { type: 'medicine', name: '可开立药品', selected: false } as TreatmentRecommendation;
    const finalized = buildFinalCurrentInformationMedicationAssessment(assessment, {
      readyItems: [ready],
      unavailable: [{ name: '库存药品', reason: '当前药房库存不足' }],
      candidateCount: 2,
      finalizedCount: 2,
      inventoryReadyCount: 1,
    });
    expect(finalized.summary).toContain('1 项可选药品');
    expect(finalized.summary).not.toContain('药品甲');
    expect(finalized.deferred).toHaveLength(2);

    const empty = buildFinalCurrentInformationMedicationAssessment(assessment, {
      readyItems: [], unavailable: [], candidateCount: 0, finalizedCount: 0, inventoryReadyCount: 0,
    });
    expect(empty.summary).toBe('当前信息下暂无可直接开立的药品，1 项候选已暂缓。');
    expect(empty.summary).not.toContain('药品甲');
  });

  it('accepts omitted empty evidence for a supported medicine and isolates malformed candidates', () => {
    const result = parseCurrentInformationMedicationResult(response([
      { ...candidate, missingEvidence: undefined },
      { ...candidate, name: '缺少依据药品', basis: '', missingEvidence: undefined },
      { ...candidate, name: '需补证据药品', eligibility: 'requires_evidence', missingEvidence: undefined },
      { ...candidate, name: '错误证据格式药品', missingEvidence: { item: '肾功能' } },
      { ...candidate, name: '未知资格药品', eligibility: 'unknown' },
      null,
    ]), false);

    expect(result.recommendations.map((item) => item.name)).toEqual(['测试药品']);
    expect(result.deferred).toEqual([
      { name: '缺少依据药品', reason: '缓解症状；缺少当前病例用药依据' },
      { name: '需补证据药品', reason: '缓解症状' },
      { name: '错误证据格式药品', reason: '缓解症状；缺失证据字段格式不完整' },
    ]);
  });

  it.each([
    [], {}, { summary: '', disposition: 'medication_options', medicines: [] },
    { summary: '评估', disposition: 'unknown', medicines: [] },
    { summary: '评估', disposition: 'medication_options', medicines: null },
  ])('fails closed when the root assessment is malformed %j', (raw) => {
    expect(() => parseCurrentInformationMedicationResult(raw, false)).toThrow();
  });

  it('does not trust model selection, matching IDs, manual flags or packaging totals', () => {
    const result = parseCurrentInformationMedicationResult(response([{
      ...candidate, selected: true, manualMatched: true, matchedItem: { id: 'AI-ID' }, totalQty: '100',
    }]), false);
    expect(result.recommendations[0]).not.toHaveProperty('selected');
    expect(result.recommendations[0]).not.toHaveProperty('manualMatched');
    expect(result.recommendations[0]).not.toHaveProperty('matchedItem');
    expect(result.recommendations[0]).not.toHaveProperty('totalQty');
    expect(result.recommendations[0].targetDose).toBe('5');
  });

  it('preserves existing examinations and edited medicines, appending only unique unselected medicines', () => {
    const exam = { type: 'exam', name: '检查A', selected: true } as TreatmentRecommendation;
    const edited = { type: 'medicine', name: '药品A', matchedItem: { id: 'a' }, frequency: '医生修改频次', selected: true } as TreatmentRecommendation;
    const added = { type: 'medicine', name: '药品B', matchedItem: { id: 'b' }, selected: true } as TreatmentRecommendation;
    const merged = mergeCurrentInformationMedicines([exam, edited], [
      { ...edited, name: '药品A别名', frequency: '模型频次' }, added, { ...added },
      { ...added, name: '药品A', matchedItem: { id: 'other' } },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged[0]).toBe(exam);
    expect(merged[1]).toBe(edited);
    expect(merged[2]).toEqual({ ...added, selected: false });
    expect(added.selected).toBe(true);
  });

  it('builds a compact intent prompt without inventory or the ordinary array protocol', () => {
    const prompt = buildCurrentInformationMedicationIntentPrompt(true);
    const user = prompt.buildUserPrompt({
      patientName: '患者', gender: '女', age: '8月', diagnosisName: '咳嗽', diagnosisCode: 'R05',
      chiefComplaint: '咳嗽', clinicalContext: '青霉素过敏；体重未知',
      availableMedicineInventory: '不应进入第一阶段的院内目录',
    });
    expect(user).toContain('青霉素过敏；体重未知');
    expect(user).not.toContain('不应进入第一阶段的院内目录');
    expect(prompt.system).toContain(`最多返回 ${CURRENT_INFORMATION_MEDICATION_INTENT_LIMIT} 个 medicines`);
    expect(prompt.system).toContain('不能套用成人剂量');
    expect(prompt.system).toContain('只允许 purpose=symptomatic');
    expect(prompt.system).toContain('不返回 JSON 数组');
    expect(prompt.system).not.toContain('推荐3-5个药品');
  });

  it('builds a final prescription prompt from supported intents and candidate inventory only', () => {
    const intent = parseCurrentInformationMedicationResult(response([{
      ...candidate,
      name: '对乙酰氨基酚',
      aliases: ['扑热息痛', ' 对乙酰氨基酚片 ', '别名3', '别名4'],
    }]), true);
    const prompt = buildCurrentInformationMedicationPrompt(intent, true);
    const user = prompt.buildUserPrompt({
      patientName: '患儿', gender: '女', age: '3岁', diagnosisName: '急性上呼吸道感染', diagnosisCode: 'J06.900',
      chiefComplaint: '发热', clinicalContext: '体重15kg',
      availableMedicineInventory: '【候选】\n- 对乙酰氨基酚混悬液｜100ml',
    });
    expect(user).toContain('对乙酰氨基酚混悬液｜100ml');
    expect(user).toContain('扑热息痛');
    expect(user).not.toContain('别名4');
    expect(prompt.system).toContain('不得添加候选外药品');
    expect(prompt.system).toContain('不返回 JSON 数组');
    expect(prompt.system).not.toContain('推荐3-5个药品');
  });

  it('caps intents, preserves controlled matching fields and merges stage assessments', () => {
    const medicines = Array.from({ length: 6 }, (_, index) => ({
      ...candidate,
      name: `药品${index + 1}`,
      aliases: ['别名1', '别名2', '别名3', '别名4'],
    }));
    const intent = parseCurrentInformationMedicationResult(response(medicines), false);
    expect(intent.recommendations).toHaveLength(CURRENT_INFORMATION_MEDICATION_INTENT_LIMIT);
    expect(intent.recommendations[0]).toMatchObject({
      aliases: ['别名1', '别名2', '别名3'],
      purpose: 'symptomatic',
      basis: '当前明确的症状',
    });
    expect(buildCurrentInformationMedicationInventoryIntents(intent)[0]).toEqual({
      preferredGenericNames: ['药品1'],
      aliases: ['别名1', '别名2', '别名3'],
    });

    const final = parseCurrentInformationMedicationResult(response([candidate]), false);
    const merged = mergeCurrentInformationMedicationStageAssessments(
      { ...intent, deferred: [{ name: '需核实药', reason: '缺少依据' }] },
      { ...final, deferred: [{ name: '剂量待定药', reason: '缺少体重' }] },
      ['无库存药'],
    );
    expect(merged.recommendations).toHaveLength(1);
    expect(merged.deferred).toEqual([
      { name: '需核实药', reason: '缺少依据' },
      { name: '剂量待定药', reason: '缺少体重' },
      { name: '无库存药', reason: '未精确命中院内有效库存候选，暂不提供可选药品' },
    ]);
  });

  it('keeps urgent intent results closed without prescription recommendations', () => {
    const urgent = parseCurrentInformationMedicationResult(response([candidate], 'urgent_referral'), false);
    const merged = mergeCurrentInformationMedicationStageAssessments(urgent, null, ['测试药品']);
    expect(merged).toEqual(urgent);
    expect(merged.recommendations).toEqual([]);
  });
});
