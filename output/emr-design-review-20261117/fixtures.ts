import { ref } from 'vue';
export const state = ref('ready');
export const content = {
  主诉: '咳嗽、咳痰 3 天。',
  现病史: '患者 3 天前出现咳嗽、咳痰，以白色黏痰为主。无胸痛、咯血。今日查房咳嗽较前减轻，精神及饮食尚可。以上均为界面验证使用的合成资料。',
  既往史: '既往健康，无明确药物过敏史。合成病历，仅供界面验证。',
  体格检查: '神志清楚，双肺呼吸音稍粗，心律齐。生命体征为合成资料，不代表真实测量。',
  病情分析: '结合现有合成资料整理病情变化，待医生核对后完善。',
  诊疗计划: '继续观察病情变化，结合检查结果调整诊疗方案。合成示例。',
};
export const html = `<article style="max-width:820px;margin:0 auto;padding:22px 28px;font-size:14px;line-height:1.9;color:#172033;background:#fff"><h2 style="text-align:center;font-size:20px;margin:0 0 18px">合成医疗机构</h2><h3 style="text-align:center;font-size:17px;margin:0 0 22px">病历记录</h3><div style="display:flex;justify-content:space-between;border-bottom:1px solid #e2e8f0;padding-bottom:12px;margin-bottom:22px"><span>姓名：合成患者</span><span>性别：男</span><span>年龄：46 岁</span><span>记录日期：2026-11-17</span></div>${Object.keys(content).map(id => `<section data-id="article-${id}" data-article="${id}" data-name="${id}" style="margin:0 0 18px"><strong>${id}：</strong><span data-id="${id}" data-name="${id}" data-type="text" data-readonly="false"><span class="tag-value"></span></span></section>`).join('')}<div style="border-top:1px solid #e2e8f0;padding-top:14px;text-align:right;color:#64748b">合成资料 · 仅用于界面审查</div></article>`;
export const inpatientRequest = { admissionId: 'SYN-ADMISSION-001', requestId: 'SYN-REQUEST-001', templateId: 'SYN-TEMPLATE-001', templateName: '日常病程记录', doctorSupplement: '今日合成查房资料', recordTime: '2026-11-17 09:30', patient: { patientId: 'SYN-PATIENT-001', name: '合成患者', sdSexText: '男', ageText: '46岁' }, htmlContent: html };
export const outpatientRequest = { visitId: 'SYN-VISIT-001', requestId: 'SYN-REQUEST-002', templateId: 'SYN-TEMPLATE-002', templateName: '内科门诊病历', templateHtml: html, templateDefinition: '[]', targetFieldIds: Object.keys(content), recordContext: {}, patient: { name: '合成患者', sdSexText: '男', ageText: '46岁' } };
