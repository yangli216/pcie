import { describe, expect, it } from 'vitest';
import {
  dedupeNarratives,
  resolveReportOverallStatus,
  selectHistoryText,
  selectSupplementalSections,
  stripPatientBasics,
} from './reportInterpretationPresentation';

describe('report interpretation presentation', () => {
  it('removes repeated core findings and advice sections', () => {
    const sections = selectSupplementalSections({
      summary: 'CRP 5 mg/L，位于参考范围内。',
      conclusion: '当前 CRP 未见明显升高。',
      keyPoints: [{ title: 'CRP正常', detail: 'CRP 5 mg/L，位于参考范围内。' }],
      sections: [
        { title: '报告核心发现', content: 'CRP 5 mg/L，位于参考范围内。' },
        { title: '建议下一步', content: '如症状持续，建议复诊。' },
        { title: '结合患者背景', content: '老年患者仍需结合症状动态观察。' },
      ],
      recommendations: ['如症状持续，建议复诊。'],
      cautions: [],
    });

    expect(sections).toEqual([{
      title: '结合患者背景',
      content: '老年患者仍需结合症状动态观察。',
    }]);
  });

  it('hides demographic-only history and deduplicates action lists', () => {
    expect(selectHistoryText('范一峰；男性；65岁', {
      patientName: '范一峰',
      genderText: '男性',
      ageText: '65岁',
    })).toBe('');
    expect(dedupeNarratives(['建议复诊。', '建议复诊', '动态观察。'])).toEqual([
      '建议复诊。',
      '动态观察。',
    ]);
  });

  it('derives a deterministic overall status from structured abnormalities', () => {
    expect(resolveReportOverallStatus({
      abnormalItems: [],
      abnormalAssessmentComplete: true,
      keyPoints: [],
    }).level).toBe('normal');
    expect(resolveReportOverallStatus({ abnormalItems: [], keyPoints: [] }).level).toBe('unknown');
    expect(resolveReportOverallStatus({
      abnormalItems: [{ name: '白细胞', result: '12.8', urgency: 'medium' }],
      abnormalAssessmentComplete: true,
      keyPoints: [],
    }).level).toBe('attention');
    expect(resolveReportOverallStatus({
      abnormalItems: [],
      abnormalAssessmentComplete: true,
      keyPoints: [{ title: '危险信号', detail: '建议优先处理', urgency: 'high' }],
    }).level).toBe('normal');
    expect(resolveReportOverallStatus({
      abnormalItems: [{ name: '影像发现', result: '骨折', urgency: 'high' }],
      abnormalAssessmentComplete: true,
      keyPoints: [],
    }).level).toBe('high');
  });

  it('removes repeated patient basics from the summary prefix', () => {
    expect(stripPatientBasics('患者范一峰（65岁男性） C-反应蛋白为5 mg/L，未见异常升高。', {
      patientName: '范一峰',
      genderText: '男性',
      ageText: '65岁',
    })).toBe('C-反应蛋白为5 mg/L，未见异常升高。');
    expect(stripPatientBasics('C-反应蛋白为5 mg/L，未见异常升高。', {
      patientName: '范一峰',
    })).toBe('C-反应蛋白为5 mg/L，未见异常升高。');
  });
});


it('does not label uncompleted cross-report assessment as overall normal', () => {
  expect(resolveReportOverallStatus({ abnormalItems: [], abnormalAssessmentComplete: true, keyPoints: [],
    crossReportConsistency: { status: 'not_assessed', date: '2026-09-09', message: '未完成', limitations: [], conflicts: [],
      reports: [{ id: 'a', title: 'A', time: '' }, { id: 'b', title: 'B', time: '' }] },
  }).level).toBe('unknown');
});
