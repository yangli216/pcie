import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPatientContext } from '@/utils/patientContext';
import { chatStream } from '@/services/llm';
import { medicalDataService } from '@/services/medicalData';
import { loadAvailableMedicineInventoryContext, parseLLMJson } from '@features/clinical-result';
import { generateChronicRefillRecord } from './chronicRefillRecord';
import { assessChronicRefillCandidate, scopeChronicRefillCandidate } from '../lib/chronicRefillAssessment';
import { buildClinicalResultIntentRecordSnapshot } from '../../consultation-result/model/useClinicalResultIntentReset';
import { buildRecordConfirmedPayload } from '../../clinical-result/recordConfirmedPayload';
import type { ClinicalResultInput } from '../../clinical-result/clinicalResultContract';
import { DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE } from '../../clinical-result/historyRecordTemplates';

vi.mock('@/services/llm', () => ({
  chatStream: vi.fn(),
}));

vi.mock('@/services/medicalData', () => ({
  medicalDataService: {
    matchDiagnosis: vi.fn(() => null),
    matchMedicine: vi.fn(() => null),
  },
}));

vi.mock('@features/clinical-result', async () => {
  const actual = await vi.importActual<any>('@features/clinical-result');
  return {
    ...actual,
    loadAvailableMedicineInventoryContext: vi.fn(),
    parseLLMJson: vi.fn(),
  };
});

describe('generateChronicRefillRecord', () => {
  it.each(['女性', '男性'])('retains applicable existing histories in initial and final chronic records for %s', async (gender) => {
    const patient = buildPatientContext({ payload: {
      patientId: 'history-patient', visitId: 'history-visit', gender,
      menstrualHistory: '周期28天，经期5天。', maritalReproductiveHistory: '已婚已育；目前未孕。',
    } })!;
    const candidate = assessChronicRefillCandidate({ patientId: 'history-patient', visits: [
      { visitTime: Date.now() - 86400000, diagnoses: ['原发性高血压'], medications: [] },
    ] })!;
    const partials: ClinicalResultInput[] = [];
    const result = await generateChronicRefillRecord(patient, candidate, { onPartial: (record) => partials.push(record) });
    expect(partials.length).toBeGreaterThan(0);
    for (const record of [...partials, result]) {
      expect(record.outpatientRecord?.menstrualHistory || '').toBe(gender === '女性' ? '周期28天，经期5天。' : '');
      expect(record.outpatientRecord?.maritalReproductiveHistory || '').toBe(gender === '女性' ? '已婚已育；目前未孕。' : '');
    }
    expect(chatStream).toHaveBeenCalledTimes(1);
  });

  it('uses HIS positive history and does not carry it into a different patient', async () => {
    const candidate = assessChronicRefillCandidate({ patientId: 'patient-1', visits: [
      { visitTime: Date.now() - 86400000, diagnoses: ['原发性高血压'], medications: [] },
    ] })!;
    const patient = buildPatientContext({ payload: {
      patientId: 'patient-1', visitId: 'visit-1', pastMedicalHistory: '既往有糖尿病病史。',
    } })!;
    const result = await generateChronicRefillRecord(patient, candidate);
    expect(result.pastMedicalHistory).toContain('{有}糖尿病史');
    expect(result.diagnoses.map((diagnosis) => diagnosis.name)).toEqual(['原发性高血压']);

    const nextPatient = buildPatientContext({ payload: { patientId: 'patient-2', visitId: 'visit-2' } })!;
    const nextCandidate = assessChronicRefillCandidate({ patientId: 'patient-2', visits: [
      { visitTime: Date.now() - 86400000, diagnoses: ['原发性高血压'], medications: [] },
    ] })!;
    const nextResult = await generateChronicRefillRecord(nextPatient, nextCandidate);
    expect(nextResult.pastMedicalHistory).not.toContain('{有}糖尿病史');
  });

  it.each(['fallback', 'json', 'stream'] as const)(
    'keeps all known chronic history while only treating selected hypertension (%s)',
    async (mode) => {
      const patient = buildPatientContext({ payload: {
        patientId: 'patient-1', visitId: 'visit-current',
        pastMedicalHistory: DEFAULT_PAST_MEDICAL_HISTORY_TEMPLATE,
      } })!;
      const candidate = assessChronicRefillCandidate({
        patientId: 'patient-1',
        visits: [
          { visitTime: Date.now() - 86400000, diagnoses: ['原发性高血压'], medications: ['苯磺酸氨氯地平片'] },
          { visitTime: Date.now() - 172800000, diagnoses: ['2型糖尿病'], medications: ['盐酸二甲双胍片'] },
        ],
      })!;
      const scoped = scopeChronicRefillCandidate(candidate, ['高血压'])!;
      const misleadingDraft = { pastMedicalHistory: '有高血压病史；否认糖尿病史。' };
      if (mode === 'json') {
        vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => onChunk('{}'));
        vi.mocked(parseLLMJson).mockReturnValue(misleadingDraft);
      } else if (mode === 'stream') {
        vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
          onChunk(`${JSON.stringify({ event: 'record_core', data: misleadingDraft })}\n`);
          onChunk('{"event":"done","data":{}}\n');
        });
      }
      const partials: ClinicalResultInput[] = [];
      const result = await generateChronicRefillRecord(patient, scoped, {
        onPartial: (partial) => partials.push(partial),
      });
      expect(partials.length).toBeGreaterThan(0);
      for (const record of [...partials, result]) {
        const snapshot = buildClinicalResultIntentRecordSnapshot(record, true);
        expect(snapshot.pastMedicalHistory).toContain('{有}高血压病史');
        expect(snapshot.pastMedicalHistory).toContain('{有}糖尿病史');
        expect(snapshot.pastMedicalHistory).toContain('2型糖尿病');
        expect(snapshot.pastMedicalHistory).not.toMatch(/否认\}?糖尿病/u);
        expect(record.diagnoses.map((diagnosis) => diagnosis.name)).toEqual(['原发性高血压']);
        expect(record.chiefComplaint).not.toContain('糖尿病');
        expect(record.historyOfPresentIllness).not.toContain('糖尿病');
        expect(record.currentMedicationHistory).not.toContain('二甲双胍');
        expect(record.treatments.some((item) => item.name.includes('二甲双胍'))).toBe(false);
      }
      const snapshot = buildClinicalResultIntentRecordSnapshot(result, true);
      const payload = buildRecordConfirmedPayload({
        consultationId: 'consultation-history',
        ...snapshot,
        outpatientRecord: snapshot,
        diagList: [{ idDiag: 'D-HTN', naDiag: '原发性高血压', fgMain: '1' }],
        orderList: [],
      });
      expect(payload.pastMedicalHistory).toContain('有糖尿病史');
      expect(payload.pastMedicalHistory).not.toContain('否认糖尿病史');
      expect(payload.diagList).toEqual([expect.objectContaining({ naDiag: '原发性高血压' })]);
    },
  );

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(chatStream).mockRejectedValue(new Error('use fallback'));
    vi.mocked(medicalDataService.matchDiagnosis).mockReturnValue(null);
    vi.mocked(medicalDataService.matchMedicine).mockReturnValue(null);
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [{
        productId: 'med-1',
        productName: '苯磺酸氨氯地平片',
        spec: '5mg*28片/盒',
        unit: '盒',
        availableQuantity: 12,
        storeIds: ['1760'],
        storeNames: ['西药房'],
      }],
      promptContext: '',
      pharmacyCount: 1,
      staleStoreCount: 0,
    });
  });

  it('returns related examination candidates and extensions in the same chronic stream', async () => {
    const patient = buildPatientContext({ payload: { patientId: 'patient-1', visitId: 'visit-1' } })!;
    const candidate = assessChronicRefillCandidate({ patientId: 'patient-1', visits: [
      { visitTime: Date.now() - 86400000, diagnoses: ['2型糖尿病'], medications: [] },
    ] })!;
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      onChunk(JSON.stringify({ event: 'record_extra', data: { physicalExamSuggestions: [{
        field: 'physicalExam', question: '足部感觉是否正常？', negativeRecordText: '双足浅感觉正常',
        rationale: '糖尿病相关足部查体', priority: 'critical',
      }] } }) + '\n');
    });
    const partials: ClinicalResultInput[] = [];
    const timing = {
      mark: vi.fn(), span: vi.fn(() => vi.fn()), measure: vi.fn(), finish: vi.fn(),
    };
    const result = await generateChronicRefillRecord(patient, candidate, {
      onPartial: (value) => partials.push(value),
      timing,
    });
    expect(chatStream).toHaveBeenCalledTimes(1);
    expect(timing.mark).toHaveBeenCalledWith('inventory_prompt_full', 1);
    expect(result.factSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ negativeRecordText: '双足背动脉搏动可触及', status: 'pending' }),
      expect.objectContaining({ negativeRecordText: '双足浅感觉正常', priority: 'critical' }),
    ]));
    expect(result.factSuggestions?.some((item) => item.negativeRecordText.includes('扁桃体'))).toBe(false);
    expect(result.outpatientRecord?.physicalExam).toContain('体重:{体重}kg');
    expect(result.outpatientRecord?.physicalExam).not.toContain('浅感觉正常');
    expect(partials.some((item) => item.factSuggestions?.some((entry) => entry.negativeRecordText === '双足浅感觉正常'))).toBe(true);
    expect(result.recommendationPolicy?.autoFetchTreatments).toBe(false);
  });

  it('enforces record-extra output bounds after model generation', async () => {
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-1' },
    })!;
    const candidate = assessChronicRefillCandidate({ patientId: 'patient-1', visits: [
      { visitTime: Date.now() - 86400000, diagnoses: ['2型糖尿病'], medications: [] },
    ] })!;
    const suggestions = ['足部感觉', '足背动脉', '皮肤破损'].map((label) => ({
      field: 'physicalExam' as const,
      question: `${label}是否异常？`,
      negativeRecordText: `${label}未见明显异常`,
      rationale: '糖尿病相关专科查体',
      priority: 'general' as const,
    }));
    const longHealthEducation = `规律用药并记录家庭监测结果${'持续观察血压血糖变化并按期复诊'.repeat(20)}`;
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      onChunk(`${JSON.stringify({
        event: 'record_extra',
        data: { physicalExamSuggestions: suggestions, healthEducation: longHealthEducation },
      })}\n`);
    });

    const result = await generateChronicRefillRecord(patient, candidate);

    expect(Array.from(result.healthEducation)).toHaveLength(160);
    expect(result.factSuggestions?.some((item) => item.question.includes('足部感觉'))).toBe(true);
    expect(result.factSuggestions?.some((item) => item.question.includes('足背动脉'))).toBe(true);
    expect(result.factSuggestions?.some((item) => item.question.includes('皮肤破损'))).toBe(false);
  });

  it('creates a refill-specific record and suppresses generic treatment generation', async () => {
    const onProgress = vi.fn();
    const patient = buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-current',
        name: '张建国',
      },
    });

    const result = await generateChronicRefillRecord(patient!, {
      diagnosis: '高血压',
      diagnoses: ['高血压'],
      diagnosisGroups: ['高血压'],
      medications: ['苯磺酸氨氯地平片（5mg*28片）', '厄贝沙坦片 150mg'],
      chronicVisitCount: 1,
      chronicVisits: [{
        visitTime: Date.parse('2026-06-01T08:00:00+08:00'),
        diagnoses: ['高血压'],
        medications: ['苯磺酸氨氯地平片（5mg*28片）'],
      }],
      diagnosisEvidenceText: '近期历史就诊记录有“高血压”诊断',
      medicationEvidenceText: '历史用药记录：苯磺酸氨氯地平片、厄贝沙坦片',
      evidenceText: '高血压历史处方',
    }, { onProgress });

    expect(result.chiefComplaint).toBe('高血压复诊配药');
    expect(result.historyOfPresentIllness).not.toContain('未提供新发不适信息');
    expect(result.historyOfPresentIllness).toBe('患者既往确诊高血压。今复诊配药。');
    expect(result.historyOfPresentIllness).not.toMatch(/苯磺酸氨氯地平片|厄贝沙坦片|库存|可续方药品|可参考药品|推荐药品/u);
    expect(result.currentMedicationHistory).toBe('苯磺酸氨氯地平片、厄贝沙坦片');
    expect(result.treatments).toHaveLength(2);
    expect(result.treatments[0].name).toBe('苯磺酸氨氯地平片');
    expect(result.treatments[0]).toMatchObject({
      selected: false,
      dosage: '',
      days: '',
    });
    expect(result.treatments.every((item) => item.type === 'medicine')).toBe(true);
    expect(result.treatments[1]).toMatchObject({
      name: '厄贝沙坦片',
      selected: false,
      matchStatus: 'unmatched',
    });
    expect(result.recommendationPolicy).toEqual({
      autoFetchTreatments: false,
      allowTreatmentRefresh: false,
      allowedTreatmentTypes: ['medicine'],
    });
    expect(onProgress.mock.calls.map(([stage]) => stage)).toEqual([
      'generating-content',
      'finalizing-result',
    ]);
  });

  it('does not write unconfirmed review facts into the initial HPI', async () => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => onChunk('{}'));
    vi.mocked(parseLLMJson).mockReturnValue({
      chiefComplaint: '糖尿病定期复诊续方',
      historyOfPresentIllness: '患者女性，36岁，病情控制情况、服药依从性及血糖结果待医生核实。',
      healthEducation: '注意休息，1周内复诊，必要时上级医院进一步治疗。',
      recommendedMedicines: ['盐酸二甲双胍片'],
      reviewPlan: {
        summary: '请核查本次复诊信息',
        items: [
          {
            id: 'control',
            question: '近期血糖控制如何？',
            options: [
              { value: 'stable', label: '平稳', recordText: '近期血糖监测平稳' },
              { value: 'unknown', label: '待确认', recordText: '' },
            ],
            recommendedValue: 'unknown',
            priority: 'critical',
          },
          {
            id: 'symptoms',
            question: '有无低血糖不适？',
            options: [
              { value: 'none', label: '无', recordText: '近期无低血糖不适' },
              { value: 'unknown', label: '待确认', recordText: '' },
            ],
            recommendedValue: 'unknown',
            priority: 'critical',
          },
          {
            id: 'medication',
            question: '目前是否仍按原方案服药？',
            options: [
              { value: 'continued', label: '仍在服用', recordText: '仍按原方案服药' },
              { value: 'unknown', label: '待确认', recordText: '' },
            ],
            recommendedValue: 'unknown',
            priority: 'critical',
          },
        ],
      },
    });
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-current', name: '测试患者' },
    })!;
    const candidate = {
      diagnosis: '2型糖尿病',
      diagnoses: ['2型糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: ['盐酸二甲双胍片'],
      chronicVisitCount: 1,
      chronicVisits: [],
      diagnosisEvidenceText: '历史诊断为2型糖尿病',
      medicationEvidenceText: '历史用药为盐酸二甲双胍片',
      evidenceText: '近期慢病复诊记录',
    };

    const result = await generateChronicRefillRecord(patient, candidate);

    expect(result.chiefComplaint).toBe('2型糖尿病复诊配药');
    expect(result.historyOfPresentIllness).toBe('患者既往确诊2型糖尿病。今复诊配药。');
    expect(result.historyOfPresentIllness).not.toMatch(/女性|36岁|待医生核实/u);
    expect(result.historyOfPresentIllness).not.toMatch(/盐酸二甲双胍片|规律服药|血糖平稳|无低血糖/u);
    expect(result.currentMedicationHistory).toBe('盐酸二甲双胍片');
    expect(result.chronicRefillReview?.items).toHaveLength(3);
    expect(result.healthEducation).toBe(
      '按医嘱规律服药并记录家庭监测结果；出现症状变化或指标异常时及时复诊。',
    );
  });

  it('uses structured AI dosage, frequency and route for an inventory-matched refill medicine', async () => {
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [{
        productId: 'med-metformin',
        productName: '盐酸二甲双胍片',
        spec: '0.25g*60片/瓶',
        unit: '瓶',
        availableQuantity: 20,
        storeIds: ['1760'],
        storeNames: ['西药房'],
      }],
      promptContext: '- 盐酸二甲双胍片｜0.25g*60片/瓶',
      pharmacyCount: 1,
      staleStoreCount: 0,
    });
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => onChunk('{}'));
    vi.mocked(parseLLMJson).mockReturnValue({
      chiefComplaint: '糖尿病定期复诊续方',
      historyOfPresentIllness: '患者既往诊断糖尿病，长期口服盐酸二甲双胍片，本次复诊续方，病情控制及依从性待医生核实。',
      recommendedMedicines: [{
        ref: 'S1',
        dosage: 0.5,
        dosageUnit: 'g',
        frequency: '每日3次',
        frequencyKey: 'TID',
        route: '口服',
        routeKey: 'PO',
        days: 14,
        totalQty: 2,
        totalUnit: '瓶',
        reason: '结合慢病诊断和当前库存规格续方',
      }],
    });
    const patient = buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-current',
        name: '张建国',
        ageText: '60岁',
      },
    });

    const result = await generateChronicRefillRecord(patient!, {
      diagnosis: '糖尿病',
      diagnoses: ['糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: ['盐酸二甲双胍片（0.25g*60片/瓶）'],
      medicationOrders: [{
        orderId: 'history-order-metformin',
        productId: 'med-metformin',
        name: '盐酸二甲双胍片',
        days: '30',
        totalQty: '2',
        totalUnit: '瓶',
      }],
      chronicVisitCount: 1,
      chronicVisits: [{
        visitTime: Date.parse('2026-06-01T08:00:00+08:00'),
        diagnoses: ['糖尿病'],
        medications: ['盐酸二甲双胍片（0.25g*60片/瓶）'],
      }],
      diagnosisEvidenceText: '近期历史就诊记录有“糖尿病”诊断',
      medicationEvidenceText: '历史用药记录：盐酸二甲双胍片',
      evidenceText: '糖尿病历史处方',
    });

    expect(result.treatments[0]).toMatchObject({
      name: '盐酸二甲双胍片',
      selected: false,
      targetDose: '0.5',
      targetDoseUnit: 'g',
      dosage: '',
      dosageUnit: '',
      frequency: '每日3次',
      frequencyKey: 'TID',
      route: '口服',
      routeKey: 'PO',
      days: '30',
      totalQty: '2',
      totalUnit: '瓶',
    });
    expect(result.historyOfPresentIllness).toBe('患者既往确诊糖尿病。今复诊配药。');
    expect(result.historyOfPresentIllness).not.toMatch(/盐酸二甲双胍片|口服|每日3次|30天|共2瓶/u);
    expect(result.currentMedicationHistory).toBe('盐酸二甲双胍片');

    const messages = vi.mocked(chatStream).mock.calls[0][0];
    const prompt = messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('S1|盐酸二甲双胍片|0.25g*60片/瓶');
    expect(prompt).not.toContain('可用库存');
    expect(prompt).toContain('recommended_medicines只生成药品');
    expect(prompt).toContain('病历核心、通用核查骨架和基础查体已由程序确定性生成');
    expect(prompt).toContain('review_plan只补充确定性核查骨架');
    expect(prompt).toContain('不得输出dosage、dosageUnit、days、totalQty、totalUnit');
    expect(prompt).not.toContain('张建国');
    expect(vi.mocked(chatStream).mock.calls[0][5]).toMatchObject({
      configProfile: 'fast',
      temperature: 0,
    });
  });

  it('uses the preserved specific historical diagnosis for the initial catalog match', async () => {
    vi.mocked(medicalDataService.matchDiagnosis).mockImplementation((query) => (
      query === '2型糖尿病'
        ? {
          id: 'diag-e11',
          code: 'E11.900',
          name: '2型糖尿病',
        }
        : null
    ));
    const patient = buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-current',
        name: '测试患者',
      },
    });

    const result = await generateChronicRefillRecord(patient!, {
      diagnosis: '2型糖尿病',
      diagnoses: ['2型糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: ['盐酸二甲双胍片 0.5g'],
      chronicVisitCount: 1,
      chronicVisits: [{
        visitTime: Date.parse('2026-06-01T08:00:00+08:00'),
        diagnoses: ['2型糖尿病'],
        medications: ['盐酸二甲双胍片 0.5g'],
      }],
      diagnosisEvidenceText: '近期历史就诊记录有“2型糖尿病”诊断',
      medicationEvidenceText: '历史用药记录：盐酸二甲双胍片',
      evidenceText: '历史诊断：2型糖尿病',
    });

    expect(result.chiefComplaint).toContain('2型糖尿病');
    expect(result.diagnoses).toEqual([expect.objectContaining({
      name: '2型糖尿病',
      code: 'E11.900',
      matchedItem: {
        id: 'diag-e11',
        code: 'E11.900',
        name: '2型糖尿病',
      },
    })]);
    expect(medicalDataService.matchDiagnosis).toHaveBeenCalledWith('2型糖尿病');
    expect(medicalDataService.matchDiagnosis).not.toHaveBeenCalledWith('糖尿病');
  });

  it('publishes deterministic and streamed partial content before the final result', async () => {
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      onChunk('{"event":"record_core","data":{"chiefComplaint":"高血压复诊配药","historyOfPresentIllness":"患者既往确诊高血压，今复诊配药。"}}\n');
      onChunk('{"event":"medication_scope","data":{"assignments":[]}}\n');
      onChunk('{"event":"review_plan","data":{"summary":"请核查","items":[]}}\n');
      onChunk('{"event":"recommended_medicines","data":[{"name":"苯磺酸氨氯地平片"}]}\n');
      onChunk('{"event":"record_extra","data":{"healthEducation":"规律监测家庭血压。"}}\n{"event":"done","data":{}}');
    });
    const onPartial = vi.fn();
    const timing = {
      mark: vi.fn(),
      span: vi.fn(() => vi.fn()),
      measure: vi.fn(),
      finish: vi.fn(),
    };
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'visit-current', name: '测试患者' },
    })!;
    const generation = generateChronicRefillRecord(patient, {
      diagnosis: '高血压',
      diagnoses: ['高血压'],
      diagnosisGroups: ['高血压'],
      medications: ['苯磺酸氨氯地平片'],
      chronicVisitCount: 1,
      chronicVisits: [],
      diagnosisEvidenceText: '历史诊断为高血压',
      medicationEvidenceText: '历史用药为苯磺酸氨氯地平片',
      evidenceText: '近期慢病复诊记录',
    }, { onPartial, timing });

    expect(onPartial).toHaveBeenCalledWith(expect.objectContaining({
      chiefComplaint: '高血压复诊配药',
      treatments: [],
      generation: expect.objectContaining({ status: 'streaming', stage: 'preparing-context' }),
    }));
    const result = await generation;
    const streamedPartials = onPartial.mock.calls.map(([partial]) => partial);
    expect(streamedPartials.some((partial) => partial.generation?.readySections.includes('review_plan'))).toBe(true);
    expect(streamedPartials.some((partial) => partial.generation?.readySections.includes('recommended_medicines') && partial.treatments.length === 1)).toBe(true);
    expect(result.healthEducation).toBe('规律监测家庭血压。');
    expect(chatStream).toHaveBeenCalledOnce();
    expect(timing.mark).toHaveBeenCalledWith('inventory_prompt_scoped', 1);
    expect(timing.mark).toHaveBeenCalledWith('inventory_prompt_chars', expect.any(Number));
    expect(timing.mark).toHaveBeenCalledWith('history_evidence_chars', expect.any(Number));
    expect(timing.mark).toHaveBeenCalledWith('medication_scope_items', 0);
    expect(timing.mark).toHaveBeenCalledWith('medication_scope_groups', 0);
    expect(timing.mark).toHaveBeenCalledWith('llm_prompt_chars', expect.any(Number));
    expect(timing.mark).toHaveBeenCalledWith('section_record_core', expect.any(Number));
    expect(timing.mark).toHaveBeenCalledWith('section_record_extra', expect.any(Number));
    expect(timing.mark).toHaveBeenCalledWith('llm_stream_chunks', 5);
    expect(timing.mark).toHaveBeenCalledWith('llm_output_chars', expect.any(Number));
    expect(timing.measure).toHaveBeenCalledWith('llm_chunk_gap_max', expect.any(Number), 5);
    expect(JSON.stringify([timing.mark.mock.calls, timing.measure.mock.calls])).not.toContain('高血压复诊配药');
  });

  it('classifies ambiguous historical medicines inside the same stream and only keeps selected-disease medicines', async () => {
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [
        {
          productId: 'med-amlodipine',
          productName: '苯磺酸氨氯地平片',
          spec: '5mg*28片/盒',
          unit: '盒',
          availableQuantity: 12,
          storeIds: ['1760'],
          storeNames: ['西药房'],
        },
        {
          productId: 'med-metformin',
          productName: '盐酸二甲双胍片',
          spec: '0.5g*60片/瓶',
          unit: '瓶',
          availableQuantity: 20,
          storeIds: ['1760'],
          storeNames: ['西药房'],
        },
      ],
      promptContext: '不应传入全量目录',
      pharmacyCount: 1,
      staleStoreCount: 0,
    });
    const candidate = assessChronicRefillCandidate({
      patientId: 'patient-1',
      visits: [{
        visitId: 'mixed-visit',
        visitTime: Date.parse('2026-06-01T08:00:00+08:00'),
        diagnoses: ['原发性高血压', '2型糖尿病'],
        medicationOrders: [
          {
            orderId: 'rx-amlodipine',
            productId: 'med-amlodipine',
            name: '苯磺酸氨氯地平片',
            spec: '5mg*28片/盒',
            dose: '1',
            doseUnit: '片',
            frequency: '每日1次',
            frequencyKey: 'QD',
            route: '口服',
            routeKey: 'PO',
            days: '28',
            totalQty: '1',
            totalUnit: '盒',
          },
          {
            orderId: 'rx-metformin',
            productId: 'med-metformin',
            name: '盐酸二甲双胍片',
            spec: '0.5g*60片/瓶',
          },
        ],
      }],
    })!;
    const scoped = scopeChronicRefillCandidate(candidate, ['高血压'])!;
    const amlodipineItem = scoped.medicationAttributions?.find((item) => item.medication.name.includes('氨氯地平'))!;
    const metforminItem = scoped.medicationAttributions?.find((item) => item.medication.name.includes('二甲双胍'))!;
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      onChunk('{"event":"record_core","data":{"chiefComplaint":"原发性高血压复诊配药"}}\n');
      onChunk(`${JSON.stringify({
        event: 'medication_scope',
        data: { accepted: [['M1', 'C1', 'h'], ['M2', 'C2', 'h'], ['forged', 'C1', 'h']] },
      })}\n`);
      onChunk('{"event":"review_plan","data":{"summary":"请核查","items":[]}}\n');
      onChunk('{"event":"recommended_medicines","data":[{"name":"苯磺酸氨氯地平片"},{"name":"盐酸二甲双胍片"}]}\n');
      onChunk('{"event":"record_extra","data":{}}\n{"event":"done","data":{}}');
    });
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'current-visit', name: '测试患者' },
    })!;

    const result = await generateChronicRefillRecord(patient, scoped);

    expect(chatStream).toHaveBeenCalledOnce();
    expect(result.currentMedicationHistory).toBe('苯磺酸氨氯地平片');
    expect(result.treatments).toHaveLength(1);
    expect(result.treatments[0]).toMatchObject({
      name: '苯磺酸氨氯地平片',
      dosage: '1',
      dosageUnit: '片',
      selected: true,
    });
    expect(result.treatments.some((item) => item.name.includes('二甲双胍'))).toBe(false);
    const prompt = vi.mocked(chatStream).mock.calls[0][0].map((message) => message.content).join('\n');
    expect(prompt).toContain('"M1"');
    expect(prompt).toContain('"C1"');
    expect(prompt).not.toContain(amlodipineItem.id);
    expect(prompt).not.toContain(metforminItem.id);
    expect(prompt).not.toContain('不应传入全量目录');
  });

  it('keeps ambiguous historical medicines excluded when medication_scope is missing', async () => {
    const candidate = assessChronicRefillCandidate({
      patientId: 'patient-1',
      visits: [{
        visitId: 'mixed-visit',
        visitTime: Date.now() - 86_400_000,
        diagnoses: ['原发性高血压', '2型糖尿病'],
        medications: ['苯磺酸氨氯地平片', '盐酸二甲双胍片'],
      }],
    })!;
    const scoped = scopeChronicRefillCandidate(candidate, ['高血压'])!;
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => {
      onChunk('{"event":"record_core","data":{"chiefComplaint":"原发性高血压复诊配药"}}\n');
      onChunk('{"event":"recommended_medicines","data":["苯磺酸氨氯地平片"]}\n');
      onChunk('{"event":"done","data":{}}');
    });
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'current-visit' },
    })!;

    const result = await generateChronicRefillRecord(patient, scoped);

    expect(result.currentMedicationHistory).toBe('历史用药方案待医生核实');
    expect(result.treatments).toEqual([]);
  });

  it('keeps repeated 90-day history compact and excludes direct patient identity from the prompt', async () => {
    const visits = Array.from({ length: 21 }, (_, index) => ({
      visitTime: Date.parse('2026-09-18T08:00:00+08:00') - index * 86_400_000,
      diagnoses: ['2型糖尿病'],
      chiefComplaint: '',
      presentIllness: '',
      medicationOrders: [
        {
          name: '盐酸二甲双胍缓释片', dose: '1', doseUnit: 'g',
          frequency: '每日一次', route: '口服', days: '30',
        },
        {
          name: '阿卡波糖片', dose: '50', doseUnit: 'mg',
          frequency: '每日三次', route: '口服', days: '14',
        },
      ],
    }));
    const patient = buildPatientContext({
      payload: { patientId: 'patient-1', visitId: 'current-visit', name: '不应进入模型的姓名', gender: '女性', ageText: '37岁' },
    })!;

    await generateChronicRefillRecord(patient, {
      diagnosis: '2型糖尿病',
      diagnoses: ['2型糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: ['盐酸二甲双胍缓释片', '阿卡波糖片'],
      medicationOrders: visits[0].medicationOrders,
      chronicVisitCount: visits.length,
      chronicVisits: visits,
      diagnosisEvidenceText: '近期历史就诊记录有“2型糖尿病”诊断',
      medicationEvidenceText: '历史用药记录',
      evidenceText: '历史证据',
    });

    const prompt = vi.mocked(chatStream).mock.calls[0][0].map((message) => message.content).join('\n');
    expect(prompt.length).toBeLessThan(3_500);
    expect(prompt).toContain('盐酸二甲双胍缓释片|最近');
    expect(prompt).toContain('出现21次');
    expect(prompt).not.toMatch(/第21次|主诉：未记录|现病史：未记录/u);
    expect(prompt).not.toContain('不应进入模型的姓名');
  });

  it('recommends an inventory medicine through AI when no historical medication is available', async () => {
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [{
        productId: 'med-metformin',
        productName: '盐酸二甲双胍片',
        spec: '0.25g*60片/瓶',
        unit: '瓶',
        availableQuantity: 20,
        storeIds: ['1760'],
        storeNames: ['西药房'],
      }],
      promptContext: '- 盐酸二甲双胍片｜0.25g*60片/瓶',
      pharmacyCount: 1,
      staleStoreCount: 0,
    });
    vi.mocked(chatStream).mockImplementation(async (_messages, onChunk) => onChunk('{}'));
    vi.mocked(parseLLMJson).mockReturnValue({
      chiefComplaint: '2型糖尿病定期复诊续方',
      historyOfPresentIllness: '患者既往诊断2型糖尿病，本次复诊评估并续方。当前库存内可参考药品为盐酸二甲双胍片，建议使用该药继续治疗。',
      recommendedMedicines: [{
        name: '盐酸二甲双胍片',
        dosage: 0.5,
        dosageUnit: 'g',
        frequency: '每日3次',
        frequencyKey: 'TID',
        route: '口服',
        routeKey: 'PO',
        days: 30,
        totalQty: 3,
        totalUnit: '瓶',
        reason: '适用于2型糖尿病血糖管理，需结合肾功能和血糖情况确认',
      }],
    });
    const patient = buildPatientContext({
      payload: {
        patientId: 'patient-1',
        visitId: 'visit-current',
        name: '测试患者',
      },
    });

    const result = await generateChronicRefillRecord(patient!, {
      diagnosis: '2型糖尿病',
      diagnoses: ['2型糖尿病'],
      diagnosisGroups: ['糖尿病'],
      medications: [],
      chronicVisitCount: 1,
      chronicVisits: [{
        visitTime: Date.parse('2026-06-01T08:00:00+08:00'),
        diagnoses: ['2型糖尿病'],
      }],
      diagnosisEvidenceText: '近期历史就诊记录有“2型糖尿病”诊断',
      medicationEvidenceText: '未获取到可确认的历史用药记录',
      evidenceText: '近期历史就诊记录有“2型糖尿病”诊断；未获取到可确认的历史用药记录',
    });

    expect(result.currentMedicationHistory).toBe('历史用药方案待医生核实');
    expect(result.historyOfPresentIllness).toBe('患者既往确诊2型糖尿病。今复诊配药。');
    expect(result.historyOfPresentIllness).not.toMatch(/库存|可参考药品|建议使用/u);
    expect(result.treatments[0]).toMatchObject({
      name: '盐酸二甲双胍片',
      sourceType: 'inferred',
      selected: false,
      targetDose: '0.5',
      targetDoseUnit: 'g',
      dosage: '',
      totalQty: '',
      totalUnit: '',
    });
    expect(result.diagnoses[0]).toMatchObject({
      sourceType: 'explicit',
      confidence: 'high',
      evidenceText: '近期历史就诊记录有“2型糖尿病”诊断',
      rationale: '',
    });
    const prompt = vi.mocked(chatStream).mock.calls[0][0].map((message) => message.content).join('\n');
    expect(prompt).toContain('历史处方摘要：\n无可靠历史处方');
    expect(prompt).toContain('review_plan只补充确定性核查骨架');
    expect(prompt).not.toContain('medication_scope');
  });
});
