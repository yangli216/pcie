import { describe, expect, it, vi } from 'vitest';
import { getHisAdapter } from '@/services/his';
import type { HisOutpatientFollowUpContext } from '@/services/his/types';
import {
  buildOutpatientFollowUpEvidence,
  buildOutpatientFollowUpTreatmentEvidence,
  fetchOutpatientFollowUpContext,
  isOutpatientFollowUpActionable,
} from './outpatientFollowUpContext';

vi.mock('@/services/his', () => ({
  getHisAdapter: vi.fn(),
}));

describe('buildOutpatientFollowUpEvidence', () => {
  it('includes the medical record and complete lab and exam result details', () => {
    const context: HisOutpatientFollowUpContext = {
      followUpEligible: true,
      source: {
        visitId: 'visit-history-1',
        visitTime: '2026-06-20 09:30:00',
        documentTitle: '门急诊病历',
      },
      medicalRecordText: '患者因咳嗽、咳痰就诊，完善血常规及胸部CT。',
      labReports: [{
        reportTime: '2026-06-21 10:00:00',
        reportName: '血常规',
        items: [
          {
            itemName: '白细胞计数',
            result: '12.8',
            unit: '10^9/L',
            referenceRange: '3.5-9.5',
            abnormalFlag: 'H',
          },
          {
            itemName: '血红蛋白',
            result: '135',
            unit: 'g/L',
            referenceRange: '115-150',
          },
        ],
      }],
      examReports: [{
        reportTime: '2026-06-21 11:00:00',
        examName: '胸部CT',
        finding: '右下肺见斑片状高密度影',
        conclusion: '右下肺感染性病变',
      }],
      ineligibleReason: null,
    };

    const evidence = buildOutpatientFollowUpEvidence(context);

    expect(evidence).toContain('患者因咳嗽、咳痰就诊');
    expect(evidence).toContain('白细胞计数：12.8 10^9/L（参考范围3.5-9.5，异常标记H）');
    expect(evidence).toContain('血红蛋白：135 g/L（参考范围115-150）');
    expect(evidence).toContain('所见：右下肺见斑片状高密度影');
    expect(evidence).toContain('结论：右下肺感染性病变');
  });

  it('returns no evidence when the context is not eligible', () => {
    expect(buildOutpatientFollowUpEvidence({
      followUpEligible: false,
      source: {},
      medicalRecordText: '',
      labReports: [],
      examReports: [],
      ineligibleReason: 'noEligibleSourceVisit',
    })).toBe('');
  });

  it('does not treat diagnosis alone as report follow-up evidence', () => {
    expect(buildOutpatientFollowUpEvidence({
      followUpEligible: true,
      currentDiagnosis: '高血压',
      medicalRecordText: '',
      labReports: [],
      examReports: [],
      ineligibleReason: null,
    })).toBe('');
  });

  it('uses confirmed interpretation conclusions instead of serializing every report item for treatment', () => {
    const context: HisOutpatientFollowUpContext = {
      followUpEligible: true,
      medicalRecordText: '本次门诊病历。'.repeat(600),
      labReports: [{ items: [{ itemName: '白细胞', result: '12.8' }] }],
      assessment: {
        actionability: 'needs_treatment',
        summary: '结合肺部感染表现，需抗感染治疗。',
        problems: [{ title: '肺部感染性病变', evidence: '胸部CT提示右下肺感染', urgency: 'medium' }],
        medicationIntents: [{ indication: '社区获得性肺炎抗感染', preferredGenericNames: ['阿莫西林'], route: '口服' }],
      },
    };

    const evidence = buildOutpatientFollowUpTreatmentEvidence(context);

    expect(evidence).toContain('需药物治疗');
    expect(evidence).toContain('阿莫西林');
    expect(evidence).not.toContain('白细胞：12.8');
    expect(evidence.length).toBeLessThan(4_000);
    expect(isOutpatientFollowUpActionable(context)).toBe(true);
    expect(isOutpatientFollowUpActionable({ ...context, assessment: { ...context.assessment!, actionability: 'observe' } })).toBe(false);
  });
});

describe('fetchOutpatientFollowUpContext', () => {
  it('combines current visit record text with report results without requiring a diagnosis', async () => {
    const reportResults = {
      followUpEligible: true,
      labReports: [],
      examReports: [{ examName: '胸部CT', conclusion: '未见明显异常。' }],
      ineligibleReason: null,
    };
    const adapter = {
      fetchOutpatientFollowUpReportResults: vi.fn(async () => reportResults),
    };
    vi.mocked(getHisAdapter).mockReturnValue(adapter as any);

    await expect(fetchOutpatientFollowUpContext({
      patientId: 'patient-1',
      visitId: 'visit-1',
      name: '张建国',
      currentOutpatientRecordText: '本次门诊病历。',
      currentOutpatientRecordTitle: '门急诊病历',
      currentOutpatientRecordTime: '2026-06-26 14:30:00',
    } as any)).resolves.toMatchObject({
      followUpEligible: true,
      source: {
        visitId: 'visit-1',
        visitTime: '2026-06-26 14:30:00',
        documentTitle: '门急诊病历',
      },
      medicalRecordText: '本次门诊病历。',
      examReports: reportResults.examReports,
    });

    expect(adapter.fetchOutpatientFollowUpReportResults).toHaveBeenCalledWith({
      patientId: 'patient-1',
      currentVisitId: 'visit-1',
    });
  });

  it('removes female-specific template lines from a male patient context without mutating the source record', async () => {
    const reportResults = {
      followUpEligible: true,
      labReports: [],
      examReports: [{ examName: '胸部CT', conclusion: '未见明显异常。' }],
      ineligibleReason: null,
    };
    const adapter = {
      fetchOutpatientFollowUpReportResults: vi.fn(async () => reportResults),
    };
    vi.mocked(getHisAdapter).mockReturnValue(adapter as any);
    const sourceRecord = [
      '个人史：否认吸烟史。',
      '月经史：{}',
      '婚育史：{}，{}怀孕，{}',
      '家族史：否认家族遗传病史。',
    ].join('\n');
    const patient = {
      patientId: 'patient-1',
      visitId: 'visit-1',
      gender: 'M',
      currentOutpatientRecordText: sourceRecord,
    } as any;

    const context = await fetchOutpatientFollowUpContext(patient);

    expect(context?.medicalRecordText).toBe('个人史：否认吸烟史。\n家族史：否认家族遗传病史。');
    expect(patient.currentOutpatientRecordText).toBe(sourceRecord);
  });

  it('requests report results even when current visit record text is missing', async () => {
    const reportResults = {
      followUpEligible: true,
      labReports: [],
      examReports: [{ examName: '胸部CT', conclusion: '未见明显异常。' }],
      ineligibleReason: null,
    };
    const adapter = {
      fetchOutpatientFollowUpReportResults: vi.fn(async () => reportResults),
    };
    vi.mocked(getHisAdapter).mockReturnValue(adapter as any);

    await expect(fetchOutpatientFollowUpContext({
      patientId: 'patient-1',
      visitId: 'visit-1',
    } as any)).resolves.toMatchObject({
      followUpEligible: true,
      medicalRecordText: '',
      examReports: reportResults.examReports,
    });

    expect(adapter.fetchOutpatientFollowUpReportResults).toHaveBeenCalledWith({
      patientId: 'patient-1',
      currentVisitId: 'visit-1',
    });
  });
});
