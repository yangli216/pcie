import type { MedicalItem } from '@/services/medicalData';
import { isRestrictedMedicalCatalogItem } from '@/services/medicalCatalogPolicy';
import type { HisVisitRecord } from '@/services/his/types';
import type { ChronicExaminationReminders, ClinicalResultTreatment } from '@features/clinical-result/clinicalResultContract';
import { buildMedicalItemMatchedItem } from '@features/clinical-result/medicalItemMatchedItem';

export interface ChronicExaminationRecommendation {
  name: string;
  description: string;
  subItems: string[];
}

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/gu, '').replace(/（/gu, '(').replace(/）/gu, ')').toLowerCase();
}

/** 名称精确证据只作参考；不据此判断周期、禁止复查或自动勾选。 */
export function buildChronicExaminationReminders(input: {
  recommendations: ChronicExaminationRecommendation[];
  catalog: MedicalItem[];
  visits: HisVisitRecord[];
  currentVisitId: string;
  sourceStatus: ChronicExaminationReminders['sourceStatus'];
  catalogStatus: ChronicExaminationReminders['catalogStatus'];
  historyStatus?: ChronicExaminationReminders['historyStatus'];
  now?: number;
}): { reminders: ChronicExaminationReminders; treatments: ClinicalResultTreatment[] } {
  const now = input.now ?? Date.now();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 90);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const history = input.visits.filter((visit) => visit.visitTime >= start.getTime()
    && visit.visitTime <= end.getTime() && (!input.currentVisitId || visit.visitId !== input.currentVisitId));
  const treatments: ClinicalResultTreatment[] = [];
  const matchedIds = new Set<string>();
  const recommendations = Array.from(new Map(input.recommendations.map((item) => [normalizedName(item.name), item])).values());
  const items: ChronicExaminationReminders['items'] = recommendations.map((recommendation) => {
    // A group is matched as a whole. Never turn its sub-items into several orders.
    const matches = input.catalogStatus === 'ready' ? input.catalog.filter((item) => (
      (item.category === '检查' || item.category === '检验') && !isRestrictedMedicalCatalogItem(item)
      && normalizedName(item.name) === normalizedName(recommendation.name)
    )) : [];
    const matched = matches.length === 1 ? matches[0] : undefined;
    const type = matched?.category === '检查' ? 'exam' : 'lab_test';
    const recentReports = history.flatMap((visit) => (visit.reportedApplications || [])
      .filter((application) => normalizedName(application.name) === normalizedName(recommendation.name)
        && (!matched || application.type === 'unknown' || application.type === (type === 'exam' ? 'exam' : 'lab')))
      .map((application) => ({ name: application.name, requestedAt: application.requestedAt, visitTime: visit.visitTime })))
      .sort((a, b) => b.visitTime - a.visitTime);
    if (matched && !matchedIds.has(matched.id)) {
      matchedIds.add(matched.id);
      const historyText = recentReports.length ? '近90天有同名已出报告记录，请核对是否需要复查。'
        : '近90天返回记录未找到同名已出报告，不代表患者未检查。';
      treatments.push({
        type: type === 'exam' ? 'examination' : 'labTest', name: matched.name,
        text: `健康处方推荐：${recommendation.name}`,
        reason: `健康处方推荐；${historyText}本次是否开立由医生核对。`,
        evidenceText: '来源：getUserInfo；核对范围：PHIS近90天返回的已出报告。',
        goal: '慢病复诊检查检验参考', goalGroup: '健康处方推荐',
        matchedItem: buildMedicalItemMatchedItem(matched), matchStatus: 'exact',
        selected: false, sourceType: 'uncertain',
      });
    }
    return { name: recommendation.name, matchStatus: matched ? 'matched' as const
      : matches.length > 1 ? 'ambiguous' as const : 'unmatched' as const, recentReports };
  });
  return {
    reminders: { sourceStatus: input.sourceStatus, catalogStatus: input.catalogStatus,
      historyStatus: input.historyStatus || 'unknown', regionalHistoryStatus: 'not_connected', items },
    treatments,
  };
}
