import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chat, chatFast } from '@/services/llm';
import { medicalDataService, type MedicalItem } from '@/services/medicalData';
import type { TreatmentRecommendation } from '@/types/consultation';
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
vi.mock('@features/clinical-result', async () => {
  const currentInformation = await import('../../clinical-result/currentInformationMedication');
  return {
    ...currentInformation,
    alignMedicineRecommendationsToInventory: vi.fn((items) => items),
    assessTreatmentCatalogMatch: vi.fn(() => ({ matchStatus: 'unmatched' })),
    buildClinicalResultTreatmentRecommendationsFromRaw: vi.fn(({ rawRecommendations }) => rawRecommendations),
    buildClinicalResultTreatmentRequestSpec: vi.fn((kind, params, prompt) => ({
      kind,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.buildUserPrompt(params) },
      ],
      config: {},
    })),
    buildInstitutionAuxiliaryCatalogContext: (await import('../../clinical-result/institutionAuxiliaryCatalog')).buildInstitutionAuxiliaryCatalogContext,
    loadAvailableMedicineInventoryContext: vi.fn(),
    mapAuxiliaryCatalogRecommendations: vi.fn(() => [{
      type: 'lab_test', name: '血常规', reason: '评估感染', selected: false,
    }]),
    parseLLMJson: vi.fn((value) => JSON.parse(value)),
  };
});

const availableMedicine = {
  productId: 'medicine-1', productName: '可推荐药片', spec: '5mg*10片/盒',
  availableQuantity: 10, storeIds: ['store-1'], storeNames: ['西药房'],
};

function currentInformationInput(): VoiceTreatmentGenerationInput {
  return {
    patientName: '患者', gender: '女', age: '40岁', diagnosisName: '咳嗽', diagnosisCode: 'R05',
    chiefComplaint: '咳嗽', clinicalContext: '过敏史和查体',
    requestedTypes: ['medicine', 'lab_test', 'exam'],
    currentInformationMedication: { symptomaticOnly: true },
    explicitTreatments: [], pharmacies: [], consultationId: 'visit-1',
    normalize: (item) => item as TreatmentRecommendation,
  };
}

describe('generateVoiceTreatmentRecommendations', () => {
  const supported = {
    name: '可推荐药', aliases: ['可推荐药片'], purpose: 'symptomatic', eligibility: 'supported',
    basis: '当前症状', reason: '对症处理', missingEvidence: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [availableMedicine],
      promptContext: '【当前可用发药药房有效库存目录】\n- 可推荐药片｜5mg*10片/盒',
      pharmacyCount: 1, staleStoreCount: 0,
    });
  });

  it('uses one default-model request with the complete available inventory', async () => {
    const phases: string[] = [];
    vi.mocked(chat).mockResolvedValue(JSON.stringify({
      summary: '处方评估', disposition: 'medication_options',
      medicines: [{ ...supported, name: '可推荐药片', spec: '5mg', targetDose: '5', targetDoseUnit: 'mg' }],
    }));

    const results = await generateVoiceTreatmentRecommendations({
      ...currentInformationInput(),
      onMedicationPhase: (phase) => { phases.push(phase); },
    });

    expect(phases).toEqual(['preparing', 'assessing']);
    expect(chatFast).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith(
      expect.anything(), undefined, undefined, undefined, expect.objectContaining({ temperature: 0 }),
    );
    const userPrompt = vi.mocked(chat).mock.calls[0][0][1].content;
    expect(userPrompt).toContain('【当前可用发药药房有效库存目录】');
    expect(userPrompt).toContain('可推荐药片｜5mg*10片/盒');
    expect(alignMedicineRecommendationsToInventory).toHaveBeenCalledWith(expect.any(Array), [availableMedicine]);
    expect(results[0]).toMatchObject({ status: 'ready_with_items', medicationAssessment: { summary: '处方评估' } });
    expect(medicalDataService.fetchAvailableExamLabItems).not.toHaveBeenCalled();
  });

  it.each(['empty', 'urgent'] as const)('accepts an %s full-inventory assessment', async (scenario) => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify({
      summary: '评估结论',
      disposition: scenario === 'urgent' ? 'urgent_referral' : 'medication_options',
      medicines: [],
    }));
    const results = await generateVoiceTreatmentRecommendations(currentInformationInput());
    expect(chatFast).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({ status: 'ready_empty', items: [] });
  });

  it('retries once and closes when the full-inventory response is malformed', async () => {
    vi.mocked(chat).mockResolvedValue(JSON.stringify([supported]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const results = await generateVoiceTreatmentRecommendations(currentInformationInput());
      expect(chatFast).not.toHaveBeenCalled();
      expect(chat).toHaveBeenCalledTimes(2);
      expect(results[0]).toMatchObject({ status: 'model_invalid', items: [] });
      expect(alignMedicineRecommendationsToInventory).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('still sends the complete inventory when local intent-name matching would have found no candidate', async () => {
    const otherMedicine = { ...availableMedicine, productId: 'other', productName: '其他药片' };
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [otherMedicine],
      promptContext: '【当前可用发药药房有效库存目录】\n- 其他药片｜5mg*10片/盒',
      pharmacyCount: 1, staleStoreCount: 0,
    });
    vi.mocked(chat).mockResolvedValue(JSON.stringify({
      summary: '完整目录评估', disposition: 'medication_options', medicines: [],
    }));
    const results = await generateVoiceTreatmentRecommendations(currentInformationInput());
    expect(chatFast).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(chat).mock.calls[0][0][1].content).toContain('其他药片｜5mg*10片/盒');
    expect(alignMedicineRecommendationsToInventory).toHaveBeenCalledWith([], [otherMedicine]);
    expect(results[0]).toMatchObject({ status: 'ready_empty', items: [] });
  });

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
    expect(chatFast).toHaveBeenCalledWith(
      expect.anything(), undefined, undefined, undefined,
      expect.objectContaining({ temperature: 0 }),
    );
    expect(mapAuxiliaryCatalogRecommendations).toHaveBeenCalledTimes(1);
    expect(results[0].types).toEqual(['lab_test']);
    expect(taskResults).toEqual(['auxiliary']);
  });

  it('retries one ordinary medicine response when every candidate is invalid', async () => {
    vi.mocked(loadAvailableMedicineInventoryContext).mockResolvedValue({
      items: [], promptContext: '院内药品', pharmacyCount: 1, staleStoreCount: 0,
    });
    vi.mocked(chat).mockResolvedValue(JSON.stringify([{ reason: '缺少药品名称' }]));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const results = await generateVoiceTreatmentRecommendations({
        patientName: '患者', gender: '女', age: '40岁', diagnosisName: '急性支气管炎',
        diagnosisCode: 'J20.900', chiefComplaint: '咳嗽', clinicalContext: '过敏史和查体',
        requestedTypes: ['medicine'], explicitTreatments: [], pharmacies: [], consultationId: 'visit-1',
        normalize: (item) => item as never,
      });

      expect(chat).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        expect.objectContaining({ key: 'medication', status: 'model_invalid', items: [] }),
      ]);
      expect(alignMedicineRecommendationsToInventory).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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
      expect(failures.every((result) => result.status === 'catalog_unavailable')).toBe(true);
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

  it('starts the available auxiliary model before a missing-type result finishes applying', async () => {
    const missingTypeApplication = deferred<void>();
    const modelResponse = deferred<string>();
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValueOnce([labItem]);
    vi.mocked(chatFast).mockReturnValueOnce(modelResponse.promise);
    const complete = vi.fn();
    const pending = generateVoiceTreatmentRecommendations(concurrentInput((result) => {
      if (result.key === 'auxiliary' && result.error) return missingTypeApplication.promise;
    })).then(complete);

    try {
      await vi.waitFor(() => expect(chatFast).toHaveBeenCalledTimes(1));
      expect(complete).not.toHaveBeenCalled();
      modelResponse.resolve('{"exams":[],"labTests":[]}');
      await vi.waitFor(() => expect(mapAuxiliaryCatalogRecommendations).toHaveBeenCalledTimes(1));
      expect(complete).not.toHaveBeenCalled();
    } finally {
      modelResponse.resolve('{"exams":[],"labTests":[]}');
      missingTypeApplication.resolve();
      await pending;
    }
    expect(complete).toHaveBeenCalledTimes(1);
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

  it('retries one malformed auxiliary response and reports a stable result', async () => {
    vi.mocked(medicalDataService.fetchAvailableExamLabItems).mockResolvedValueOnce([labItem]);
    vi.mocked(chatFast)
      .mockResolvedValueOnce('{invalid')
      .mockResolvedValueOnce('{"exams":[],"labTests":[]}');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const results = await generateVoiceTreatmentRecommendations({
        ...concurrentInput(undefined),
        requestedTypes: ['lab_test'],
      });
      expect(chatFast).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        expect.objectContaining({ key: 'auxiliary', status: 'ready_with_items' }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
