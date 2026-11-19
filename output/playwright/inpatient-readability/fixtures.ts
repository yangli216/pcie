import type { InpatientEmrGenerationRequest, InpatientEmrTemplateField } from '../../../src/features/inpatient-emr/types';

export const previewValues: Record<string, string> = {
  姓名: '合成患者',
  住院号: 'SYN-20261117',
  病程记录文本: '今日查房，患者诉咳嗽较前减轻，仍有少量白痰，活动后稍感乏力。夜间休息尚可，饮食一般，二便无明显异常。\n患者补充：昨日下午活动后出现短暂气促，休息后缓解，今晨未再发作。本段仅用于展示长病程的段落、行距与编辑效果。',
  体格检查: '体温 36.8℃，脉搏 78 次/分，呼吸 18 次/分，血压 128/76 mmHg。神志清，双肺呼吸音稍粗，未闻及明显湿啰音。心率齐，腹软，无压痛，下肢无明显水肿。',
  辅助检查: '合成检验：白细胞计数 7.2×10⁹/L，中性粒细胞比例 65%，C 反应蛋白 8 mg/L。与前次合成结果比较，炎症相关指标下降。胸部影像结果尚未返回，不作结果推断。',
  病情分析: '本次合成资料提示呼吸道症状较前缓解，生命体征平稳。仍需结合后续检查及活动耐量变化综合评估，关注气促是否再次出现；未取得的检查结果保留待核对状态。',
  诊疗计划: '',
};

export const previewFields: InpatientEmrTemplateField[] = Object.keys(previewValues).map((id) => {
  const aiSuitable = !['姓名', '住院号'].includes(id);
  return {
    id, name: id === '病程记录文本' ? '病程记录' : id, article: '日常病程记录', type: 'text', readonly: !aiSuitable,
    key: false, meaning: `${id}正文`, aiSuitable, presetStatus: aiSuitable ? 'ai' : 'exclude',
    rule: { source: aiSuitable ? 'ai' : 'his_or_system', promptIntent: 'inpatientRecordSection', constraints: ['仅使用已提供的合成资料'] },
  };
});

export const previewRequest: InpatientEmrGenerationRequest = {
  admissionId: 'SYN-ADMISSION-001', templateId: 'SYN-DAILY-NOTE', templateName: '日常病程记录',
  requestId: 'SYN-REQUEST-001', recordTime: '2026-11-17 09:30', doctorSupplement: '今日合成查房：咳嗽较前减轻，关注活动后气促。',
  patient: { patientId: 'SYN-PATIENT-001', name: '合成患者', gender: '男', ageText: '58岁' },
  hisContext: { patient: { patientId: 'SYN-PATIENT-001', name: '合成患者', ageText: '58岁' } },
  htmlContent: '<article style="font-family: sans-serif; line-height: 1.8;">'
    + '<h2 style="text-align:center">日常病程记录</h2>'
    + previewFields.map((field) => `<p><strong>${field.name}：</strong><span data-id="${field.id}" data-name="${field.name}" data-type="text"><span class="tag-value">${previewValues[field.id] || '请输入'}</span></span></p>`).join('')
    + '</article>',
};
