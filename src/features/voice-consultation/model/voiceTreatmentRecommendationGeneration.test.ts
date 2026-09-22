import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatFast } from '@/services/llm';
import { medicalDataService, type MedicalItem } from '@/services/medicalData';
import {
  loadAvailableMedicineInventoryContext,
  mapAuxiliaryCatalogRecommendations,
  alignMedicineRecommendationsToInventory,
  buildClinicalResultTreatmentRequestSpec,
} from '@features/clinical-result';
import {
  generateVoiceTreatmentRecommendations,
  type VoiceTreatmentGenerationInput,
  type VoiceTreatmentGenerationTaskResult,
} from './voiceTreatmentRecommendationGeneration';

vi.mock('@/services/llm', () => ({ chat: vi.fn(), chatFast: vi.fn() }));
vi.mock('@/prompts', () => ({
  PROMPTS: {
    consultation: {
      treatmentRecommendation: { system: '', buildUserPrompt: vi.fn(() => '') },
      auxiliaryCatalogRecommendation: { system: '', buildUserPrompt: vi.fn(() => '') },
      procedureRecommendation: { system: '', buildUserPrompt: vi.fn(() => '') },
    },
  },
}));
vi.mock('@/services/medicalData', () => ({
  medicalDataService: {
    fetchAvailableExamLabItems: vi.fn(async () => [{ id: 'lab-1', code: 'L1', name: '血常规', category: '检验' }]),
  },
}));
vi.mock('@/services/his', () => ({}));
vi.mock('@features/clinical-result', async () => ({
  ...await import('../../clinical-result/currentInformationMedication'),
  alignMedicineRecommendationsToInventory: vi.fn((items) => items),
  assessTreatmentCatalogMatch: vi.fn(() => ({ matchStatus: 'unmatched' })),
  buildClinicalResultTreatmentRecommendationsFromRaw: vi.fn(() => []),
  buildClinicalResultTreatmentRequestSpec: vi.fn(() => ({ messages: [], config: {} })),
  buildInstitutionAuxiliaryCatalogContext: (await import('../../clinical-result/institutionAuxiliaryCatalog')).buildInstitutionAuxiliaryCatalogContext,
  loadAvailableMedicineInventoryContext: vi.fn(),
  mapAuxiliaryCatalogRecommendations: vi.fn(() => [{
    type: 'lab_test', name: '血常规', reason: '评估感染', selected: false,
  }]),
  parseLLMJson: vi.fn((value) => JSON.parse(value)),
}));

describe('generateVoiceTreatmentRecommendations', () => {
  it.each(['supported', 'empty', 'urgent', 'malformed'])(
    'uses one medicine-only request and filters before matching (%s)',
    async (scenario) => {
      vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
        items: [], promptContext: '院内药品', pharmacyCount: 1, staleStoreCount: 0,
      });
      const supported = { name: '可推荐药', purpose: 'symptomatic', eligibility: 'supported', basis: '当前症状', reason: '对症处理', missingEvidence: [] };
      const deferred = { ...supported, name: '暂缓药', eligibility: 'requires_evidence', missingEvidence: ['检验结果'] };
      const phases: string[] = [];
      vi.mocked(chat).mockResolvedValue(JSON.stringify(scenario === 'malformed' ? [supported] : {
        summary: '评估结论', disposition: scenario === 'urgent' ? 'urgent_referral' : 'medication_options',
        medicines: scenario === 'empty' ? [] : [supported, deferred],
      }));
      const results = await generateVoiceTreatmentRecommendations({
        patientName: '患者', gender: '女', age: '40岁', diagnosisName: '咳嗽', diagnosisCode: 'R05',
        chiefComplaint: '咳嗽', clinicalContext: '过敏史和查体',
        // Deliberately include auxiliary types: the explicit action must isolate medicine.
        requestedTypes: ['medicine', 'lab_test', 'exam'],
        currentInformationMedication: { symptomaticOnly: true },
        explicitTreatments: [], pharmacies: [], consultationId: 'visit-1',
        normalize: (item) => item as never,
        onMedicationPhase: (phase) => { phases.push(phase); },
      });
      expect(chat).toHaveBeenCalledTimes(1);
      expect(chatFast).not.toHaveBeenCalled();
      expect(phases).toEqual(['preparing', 'assessing']);
      expect((await import('@/services/medicalData')).medicalDataService.fetchAvailableExamLabItems).not.toHaveBeenCalled();
      expect(buildClinicalResultTreatmentRequestSpec).toHaveBeenCalledWith(
        'medication', expect.objectContaining({ clinicalContext: '过敏史和查体' }),
        expect.objectContaining({ system: expect.stringContaining('只允许 purpose=symptomatic') }),
        expect.anything(), expect.objectContaining({ operationAction: 'assess_medication_with_current_information' }),
      );
      if (scenario === 'malformed') {
        expect(results[0].error).toBeDefined();
        expect(alignMedicineRecommendationsToInventory).not.toHaveBeenCalled();
      } else {
        expect(results[0].medicationAssessment?.summary).toBe('评估结论');
        const raw = vi.mocked(alignMedicineRecommendationsToInventory).mock.calls[0][0];
        expect(raw.map((item) => (item as { name: string }).name)).toEqual(scenario === 'supported' ? ['可推荐药'] : []);
      }
    },
  );

  it('does not load medicine inventory when the M1 plan only requests lab tests', async () => {
    vi.mocked(chatFast).mockResolvedValue('{"exams":[],"labTests":[{"catalogRef":"L001","reason":"评估感染"}]}');
    const taskResults: string[] = [];

    const results = await generateVoiceTreatmentRecommendations({
      patientName: '患者',
      gender: '男',
      age: '35岁',
      diagnosisName: '急性支气管炎',
      diagnosisCode: 'J20.900',
      chiefComplaint: '咳嗽2天',
      clinicalContext: '受凉后咳嗽',
      requestedTypes: ['lab_test'],
      explicitTreatments: [],
      pharmacies: [],
      consultationId: 'visit-1',
      normalize: (item) => item as never,
      onTaskResult: (result) => { taskResults.push(result.key); },
    });

    expect(loadAvailableMedicineInventoryContext).not.toHaveBeenCalled();
    expect((await import('@/services/medicalData')).medicalDataService.fetchAvailableExamLabItems).toHaveBeenCalledTimes(1);
    expect(chat).not.toHaveBeenCalled();
    expect(chatFast).toHaveBeenCalledTimes(1);
    expect(mapAuxiliaryCatalogRecommendations).toHaveBeenCalledTimes(1);
    expect(results[0].types).toEqual(['lab_test']);
    expect(taskResults).toEqual(['auxiliary']);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const labItem: MedicalItem = { id: 'lab-1', code: 'L1', name: '血常规', category: '检验' };
const examItem: MedicalItem = { id: 'exam-1', code: 'E1', name: '胸部CT', category: '检查' };
const inventory = { items: [], promptContext: '院内药品', pharmacyCount: 1, staleStoreCount: 0 };

function concurrentInput(
  onTaskResult: VoiceTreatmentGenerationInput['onTaskResult'],
): VoiceTreatmentGenerationInput {
  return {
    patientName: '患者', gender: '女', age: '40岁', diagnosisName: '咳嗽', diagnosisCode: 'R05',
    chiefComplaint: '咳嗽', clinicalContext: '过敏史和查体',
    requestedTypes: ['medicine', 'exam', 'lab_test'],
    explicitTreatments: [], pharmacies: [], consultationId: 'visit-1',
    normalize: (item) => item as never,
    onTaskResult,
  };
}

describe('voice treatment branch concurrency', () => {
  beforeEach(() => {
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue(inventory);
    vi.mocked(chat).mockResolvedValue('[]');
    vi.mocked(chatFast).mockResolvedValue('{"exams":[],"labTests":[]}');
  });

  it('delivers medicine while the auxiliary catalog is pending and waits for auxiliary application', async () => {
    const catalog = deferred<MedicalItem[]>();
    const application = deferred<void>();
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockReturnValueOnce(catalog.promise);
    const delivered: VoiceTreatmentGenerationTaskResult[] = [];
    const complete = vi.fn();
    const pending = generateVoiceTreatmentRecommendations(concurrentInput(async (result) => {
      delivered.push(result);
      if (result.key === 'auxiliary') await application.promise;
    })).then((results) => { complete(); return results; });

    try {
      await vi.waitFor(() => expect(delivered.map((result) => result.key)).toEqual(['medication']));
      expect(loadAvailableMedicineInventoryContext).toHaveBeenCalledTimes(1);
      expect(chat).toHaveBeenCalledTimes(1);
      expect(chatFast).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      catalog.resolve([examItem, labItem]);
      await vi.waitFor(() => expect(delivered).toHaveLength(2));
      expect(delivered[1].types).toEqual(['exam', 'lab_test']);
      expect(medicalDataService.fetchAvailableExamLabItems).toHaveBeenCalledTimes(1);
      expect(chatFast).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
    } finally {
      catalog.resolve([examItem, labItem]);
      application.resolve();
      await pending;
    }
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('delivers auxiliary results while medicine inventory is pending', async () => {
    const medicineInventory = deferred<typeof inventory>();
    vi.mocked(loadAvailableMedicineInventoryContext).mockReturnValueOnce(medicineInventory.promise);
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValueOnce([examItem, labItem]);
    const delivered: string[] = [];
    const complete = vi.fn();
    const pending = generateVoiceTreatmentRecommendations(concurrentInput((result) => {
      delivered.push(result.key);
    })).then(complete);
    try {
      await vi.waitFor(() => expect(delivered).toEqual(['auxiliary']));
      expect(chat).not.toHaveBeenCalled();
      expect(chatFast).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
    } finally {
      medicineInventory.resolve(inventory);
      await pending;
    }
    expect(delivered).toEqual(['auxiliary', 'medication']);
  });

  it.each(['empty', 'failed'] as const)('isolates %s auxiliary catalogs without suppressing medicine', async (scenario) => {
    const error = new Error('目录查询失败');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (scenario === 'failed') {
      vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockRejectedValueOnce(error);
    } else {
      vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValueOnce([]);
    }
    const onTaskResult = vi.fn();
    try {
      const results = await generateVoiceTreatmentRecommendations(concurrentInput(onTaskResult));
      expect(chat).toHaveBeenCalledTimes(1);
      expect(chatFast).not.toHaveBeenCalled();
      expect(onTaskResult).toHaveBeenCalledTimes(3);
      expect(results.find((result) => result.key === 'medication')?.error).toBeUndefined();
      const failures = results.filter((result) => result.key === 'auxiliary');
      expect(failures.map((result) => result.types)).toEqual([['exam'], ['lab_test']]);
      expect(failures.every((result) => result.error instanceof Error && result.items.length === 0)).toBe(true);
      if (scenario === 'failed') expect(failures.every((result) => result.error === error)).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('reports missing exam catalog separately and only recommends available lab tests', async () => {
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValueOnce([labItem]);
    const onTaskResult = vi.fn();
    const results = await generateVoiceTreatmentRecommendations(concurrentInput(onTaskResult));
    expect(onTaskResult).toHaveBeenCalledTimes(3);
    expect(results.filter((result) => result.key === 'auxiliary')).toEqual([
      expect.objectContaining({ types: ['exam'], items: [], error: expect.any(Error) }),
      expect.objectContaining({ types: ['lab_test'], items: expect.any(Array) }),
    ]);
    expect(buildClinicalResultTreatmentRequestSpec).toHaveBeenCalledWith(
      'exam', expect.objectContaining({ requestedTypes: ['lab_test'] }),
      expect.anything(), expect.anything(), expect.anything(),
    );
    expect(chatFast).toHaveBeenCalledTimes(1);
  });

  it('handles an early medicine rejection while the auxiliary catalog is still pending', async () => {
    const catalog = deferred<MedicalItem[]>();
    const error = new Error('药品模型失败');
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockReturnValueOnce(catalog.promise);
    vi.mocked(chat).mockRejectedValueOnce(error);
    const onTaskResult = vi.fn();
    const pending = generateVoiceTreatmentRecommendations(concurrentInput(onTaskResult));
    try {
      await vi.waitFor(() => expect(onTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'medication', types: ['medicine'], error }),
      ));
      expect(chatFast).not.toHaveBeenCalled();
    } finally {
      catalog.resolve([examItem, labItem]);
      await pending;
    }
    expect(chatFast).toHaveBeenCalledTimes(1);
    expect(onTaskResult).toHaveBeenCalledTimes(2);
  });
});
