// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  mergeClinicalRecordSuggestionIntoText,
  type ClinicalRecordFactRecord,
} from '@features/clinical-result';
import { useClinicalRecordFactConfirmation } from './useClinicalRecordFactConfirmation';

function createController(
  request: () => Promise<string>,
  historyOfPresentIllness = '患者胸闷1天。',
  isPhysicalExamModified = () => false,
) {
  const record: ClinicalRecordFactRecord = {
    chiefComplaint: '胸闷1天',
    historyOfPresentIllness,
    pastMedicalHistory: '',
    personalHistory: '',
    familyHistory: '',
    physicalExam: '',
  };
  const onRecordChanged = vi.fn();
  const controller = useClinicalRecordFactConfirmation({
    getRecord: () => ({ ...record }),
    isPhysicalExamModified,
    getDiagnoses: () => [{ name: '胸闷待查', code: '', rate: '70%', rationale: '' }],
    request: async () => request(),
    formatError: () => '分析失败',
    mergeSuggestionIntoRecord: (suggestion) => {
      const current = record[suggestion.field];
      const next = mergeClinicalRecordSuggestionIntoText(current, suggestion);
      record[suggestion.field] = next;
      return next !== current;
    },
    onRecordChanged,
  });
  return { controller, onRecordChanged, record };
}

describe('useClinicalRecordFactConfirmation', () => {
  it('merges AI candidates into the editable record without adding a confirmation gate', async () => {
    const { controller, onRecordChanged, record } = createController(async () => JSON.stringify({
      items: [{
        field: 'historyOfPresentIllness',
        question: '是否伴胸痛？',
        negativeRecordText: '否认胸痛',
        rationale: '排除急性冠脉事件',
        priority: 'critical',
      }],
    }));

    await controller.generateSuggestions();

    expect(controller.suggestions.value.filter((item) => item.field !== 'physicalExam')).toEqual([
      expect.objectContaining({ priority: 'critical', status: 'pending', negativeRecordText: '否认胸痛' }),
    ]);
    expect(record.historyOfPresentIllness).toBe('患者胸闷1天。否认胸痛。');
    expect(onRecordChanged).toHaveBeenCalledOnce();
    expect('ensureWritebackReady' in controller).toBe(false);
    expect('confirmNegative' in controller).toBe(false);
    expect('confirmPositive' in controller).toBe(false);
    expect('markNotApplicable' in controller).toBe(false);
  });

  it('drops legacy resolved cache entries and restores current AI source markers', async () => {
    const { controller, record } = createController(async () => JSON.stringify({
      items: [{
        field: 'physicalExam',
        question: '肺部是否有湿啰音？',
        negativeRecordText: '双肺未闻及湿啰音',
        rationale: '核对肺部体征',
        priority: 'general',
      }],
    }));
    controller.restoreSuggestions([{
      id: 'legacy-confirmed',
      field: 'historyOfPresentIllness',
      question: '是否伴胸痛？',
      negativeRecordText: '否认胸痛',
      rationale: '历史缓存',
      priority: 'critical',
      status: 'confirmed-negative',
      confirmedText: '否认胸痛',
    }]);
    expect(controller.suggestions.value).toEqual([]);
    await controller.generateSuggestions();
    expect(controller.suggestions.value).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'physicalExam', status: 'pending' }),
    ]));
    expect(record.physicalExam).toContain('双肺未闻及湿啰音。');
    expect(record.physicalExam).toContain('双肺呼吸音粗');
  });

  it('keeps general and critical priorities for visual distinction only', async () => {
    const { controller, record } = createController(async () => JSON.stringify({
      items: [{
        field: 'familyHistory',
        question: '直系亲属是否有高血压？',
        negativeRecordText: '否认高血压家族史',
        rationale: '完善危险因素',
        priority: 'general',
      }, {
        field: 'physicalExam',
        question: '是否存在肺部啰音？',
        negativeRecordText: '双肺未闻及啰音',
        rationale: '核查肺部体征',
        priority: 'critical',
      }],
    }));

    await controller.generateSuggestions();
    expect(controller.suggestions.value.map((item) => item.priority)).toEqual(expect.arrayContaining(['general', 'critical']));
    expect(record.familyHistory).toBe('否认高血压家族史。');
    expect(record.physicalExam).toContain('双肺未闻及啰音。');
    const dismissedId = controller.suggestions.value[0]?.id || '';
    controller.dismissSuggestion(dismissedId);
    expect(controller.suggestions.value.length).toBeGreaterThan(2);
    expect(controller.suggestions.value[0]?.status).toBe('dismissed');
    expect(controller.getFieldSuggestions('familyHistory')).toEqual([]);
    expect(controller.getFieldSuggestions('physicalExam')).toEqual(expect.arrayContaining([
      expect.objectContaining({ priority: 'critical', status: 'pending' }),
    ]));
    controller.restoreSuggestions(controller.suggestions.value);
    expect(controller.suggestions.value[0]?.status).toBe('dismissed');
  });

  it('preserves an examination edited while the candidate request is in flight', async () => {
    let finish!: (value: string) => void;
    const { controller, record } = createController(() => new Promise((resolve) => { finish = resolve; }));
    const running = controller.generateSuggestions();
    record.physicalExam = '右下肺湿啰音，医生补充查体。';
    finish('{"items":[{"field":"physicalExam","question":"肺部听诊？","negativeRecordText":"双肺未闻及啰音"}]}');
    await running;
    expect(record.physicalExam).toBe('右下肺湿啰音，医生补充查体。');
    expect(controller.getFieldSuggestions('physicalExam')).toEqual([]);
  });

  it('does not restore a dismissed examination item from a later stream partition', async () => {
    const { controller, record } = createController(async () => '{"items":[]}');
    await controller.generateSuggestions();
    const initial = controller.suggestions.value.map((item) => ({ ...item }));
    const lungs = initial.find((item) => item.negativeRecordText === '双肺呼吸音粗')!;
    record.physicalExam = record.physicalExam.replace('双肺呼吸音粗。', '');
    controller.dismissSuggestion(lungs.id);
    controller.restoreSuggestions(initial);
    expect(record.physicalExam).not.toContain('双肺呼吸音粗');
    expect(controller.suggestions.value.find((item) => item.id === lungs.id)?.status).toBe('dismissed');
  });

  it('does not reinsert an AI item deleted through free text editing and keeps remaining source markers', async () => {
    let modified = false;
    const { controller, record } = createController(async () => '{"items":[]}', '患者胸闷1天。', () => modified);
    await controller.generateSuggestions();
    const initial = controller.suggestions.value.map((item) => ({ ...item }));
    record.physicalExam = record.physicalExam.replace('双肺呼吸音粗。', '');
    modified = true;
    controller.restoreSuggestions(initial);
    expect(record.physicalExam).not.toContain('双肺呼吸音粗');
    expect(controller.getFieldSuggestions('physicalExam').some((item) => item.negativeRecordText === '心律齐')).toBe(true);
    const cached = controller.suggestions.value.map((item) => ({ ...item }));
    controller.reset(); controller.restoreSuggestions(cached);
    expect(record.physicalExam).not.toContain('双肺呼吸音粗');
    expect(controller.getFieldSuggestions('physicalExam').some((item) => item.negativeRecordText === '心律齐')).toBe(true);
  });

  it('drops a late result after switching the patient session', async () => {
    let finish!: (value: string) => void;
    const { controller, record } = createController(() => new Promise((resolve) => { finish = resolve; }));
    const running = controller.generateSuggestions();
    controller.reset();
    record.physicalExam = '新患者查体';
    finish('{"items":[]}'); await running;
    expect(record.physicalExam).toBe('新患者查体');
    expect(controller.suggestions.value).toEqual([]);
  });

  it('upgrades a legacy reading-layer cache once without duplicating the record', () => {
    const { controller, onRecordChanged, record } = createController(async () => '{"items":[]}');
    const cachedSuggestions = [{
      id: 'legacy-reading-layer',
      field: 'historyOfPresentIllness',
      question: '是否伴呼吸困难？',
      negativeRecordText: '否认呼吸困难',
      rationale: '核查高风险症状',
      priority: 'critical',
      status: 'pending',
    }];

    controller.restoreSuggestions(cachedSuggestions);
    controller.restoreSuggestions(cachedSuggestions);

    expect(record.historyOfPresentIllness).toBe('患者胸闷1天。否认呼吸困难。');
    expect(record.historyOfPresentIllness.match(/否认呼吸困难/gu)).toHaveLength(1);
    expect(onRecordChanged).toHaveBeenCalledOnce();
  });

  it('does not restore a cached source-oriented missing-information candidate', () => {
    const { controller, onRecordChanged, record } = createController(async () => '{"items":[]}');

    controller.restoreSuggestions([{
      id: 'legacy-process-wording',
      field: 'historyOfPresentIllness',
      question: '近期是否有新发不适或病情变化？',
      negativeRecordText: '对话中未提及新发不适症状或病情变化',
      rationale: '补充本次复诊情况',
      priority: 'critical',
      status: 'pending',
    }]);

    expect(controller.suggestions.value).toEqual([]);
    expect(record.historyOfPresentIllness).toBe('患者胸闷1天。');
    expect(onRecordChanged).not.toHaveBeenCalled();
  });
});
