export const PREFIX = 'pcie-gbase-client';
export const ORG = `${PREFIX}-20261022`;
export const DEPT = `${PREFIX}-dept`;

export function createFixtures() {
  const patient = {
    idPi: `${PREFIX}-patient-001`, idVis: `${PREFIX}-visit-001`,
    naPi: '合成患者·林测试', sdSexText: '女性', ageText: '42岁', department: '全科医学科',
    chiefComplaint: '咳嗽、咽痛3天',
    historyOfPresentIllness: '3天前受凉后出现咳嗽、少量白痰和咽痛，无发热、胸痛、呼吸困难。尚未服药。',
    pastMedicalHistory: '既往体健，无高血压、糖尿病、手术史。',
    allergyHistory: '否认药物及食物过敏史。',
    vitals: '体温36.8℃，血压118/76mmHg，心率78次/分，呼吸18次/分，血氧饱和度98%。',
    diagnosis: '急性上呼吸道感染',
  };
  const fields = [
    ['chiefComplaint', '主诉', patient.chiefComplaint],
    ['historyOfPresentIllness', '现病史', patient.historyOfPresentIllness],
    ['pastMedicalHistory', '既往史', patient.pastMedicalHistory],
    ['physicalExamination', '体格检查', patient.vitals],
  ];
  const templateHtml = fields.map(([id, name]) => `<section data-id="article-${id}" data-article="${name}" data-name="${name}"><h3>${name}</h3><div data-id="${id}" data-type="text" data-name="${name}" data-readonly="false"></div></section>`).join('\n');
  const templateDefinition = JSON.stringify(fields.map(([id, name]) => ({
    ID: `article-${id}`, NAME: name, ARTICLE: name,
    eles: [{ ID: id, NAME: name, TYPE: 'text', READONLY: false, VALUE: '', TEXT: '' }],
  })));
  return {
    patient, prefix: PREFIX, orgCode: ORG,
    chronicPatient: {
      idPi: `${PREFIX}-chronic-patient`, idVis: `${PREFIX}-chronic-visit`, naPi: '合成患者·周续方',
      sdSexText: '男性', ageText: '65岁', department: '全科医学科', chiefComplaint: '高血压复诊配药',
      historyOfPresentIllness: '高血压病史3年，规律服用氨氯地平片5mg每日一次，近期家庭血压约125–135/75–85mmHg，无头痛、胸痛、气促或下肢水肿。拟复诊续药。',
      pastMedicalHistory: '高血压病史3年，无其他已知慢性病。', allergyHistory: '否认药物过敏史。',
      vitals: '体温36.5℃，血压128/78mmHg，心率72次/分，呼吸18次/分。', diagnosis: '高血压',
    },
    doctor: { personCd: `${PREFIX}-doctor`, personName: '合成工程医生', orgCode: ORG, orgId: ORG, orgName: 'PCIE GBase 客户端合成联调', deptId: DEPT, deptName: '全科医学科', userRoleDeptIds: [DEPT], userRoleDepts: [{ deptId: DEPT }] },
    outpatient: {
      visitId: patient.idVis, templateId: `${PREFIX}-outpatient-template`, templateName: '合成门诊病历',
      templateHtml, templateDefinition, targetFieldIds: fields.map(([id]) => id),
      recordContext: { recordText: fields.map(([, name, value]) => `${name}：${value}`).join('\n'), structuredFacts: { synthetic: true } },
      patient: { idPi: patient.idPi, name: patient.naPi, sdSexText: patient.sdSexText, ageText: patient.ageText },
    },
    inpatient: {
      admissionId: `${PREFIX}-admission-001`, templateId: `${PREFIX}-inpatient-template`, templateName: '合成日常病程记录',
      htmlContent: '<h2>日常病程记录（合成）</h2><p data-id="condition" data-type="text" data-name="病情变化"><span class="tag-value"></span></p><p data-id="plan" data-type="text" data-name="诊疗计划"><span class="tag-value"></span></p>',
      recordTime: '2026-10-22 09:00', doctorSupplement: '合成资料：患者咳嗽较昨日减轻，无发热，无呼吸困难。继续观察病情。',
      patient: { idPi: patient.idPi, naPi: patient.naPi, sdSexText: patient.sdSexText, ageText: patient.ageText },
      hisContext: {
        documentContext: { templateName: '日常病程记录', recordTime: '2026-10-22 09:00', synthetic: true },
        patient: { idPi: patient.idPi, name: patient.naPi, gender: '女', age: '42岁' },
        admission: { idAdsn: `${PREFIX}-admission-001`, admissionDate: '2026-10-21', chiefComplaint: '咳嗽、咽痛3天' },
        diagnoses: [{ code: 'J06.900', name: '急性上呼吸道感染', isMain: true }],
        vitals: { summary: patient.vitals }, orders: { active: [], summary: '未提供住院医嘱。' },
        labs: { items: [] }, exams: [], previousRecords: { items: [] },
        dataQuality: { synthetic: true, warnings: ['工程合成资料，不用于真实医疗决策。'] },
      },
    },
    reports: {
      inspectReport: '合成患者，女性42岁，咳嗽3天。血常规：白细胞6.2×10^9/L（参考3.5–9.5），中性粒细胞55%（40–75），淋巴细胞35%（20–50），血红蛋白128g/L（115–150），CRP 3mg/L（0–8）。请解读并提醒应就医的情况。',
      checkReport: '合成患者，女性42岁，咳嗽3天。胸部X线：双肺纹理清晰，未见明显实变影，心影大小正常，双侧肋膈角锐利。请解释结果与局限。',
    },
  };
}

const identityKeys = new Set(['idPi', 'idVis', 'patientId', 'visitId', 'currentVisitId', 'admissionId', 'idAdsn']);
export function assertSynthetic(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (identityKeys.has(key) && entry != null && entry !== '' && (typeof entry !== 'string' || !entry.startsWith(PREFIX))) {
      throw new Error('仅允许 pcie-gbase-client 合成身份');
    }
    assertSynthetic(entry);
  }
}

const diagnoses = [
  ['J06.900', '急性上呼吸道感染'], ['J20.900', '急性支气管炎'], ['J02.900', '急性咽炎'],
  ['J18.900', '肺炎'], ['I10.x00', '高血压'], ['E11.900', '2型糖尿病'],
].map(([cdIcd, naIcd], i) => ({ idDie: `${PREFIX}-dx-${i}`, cdIcd, naIcd, fgActive: '1', py: '', instr: naIcd }));
const medicines = [
  ['对乙酰氨基酚片', '0.5g', '片'], ['氨氯地平片', '5mg', '片'], ['氢溴酸右美沙芬片', '15mg', '片'],
].map(([name, spec, unit], i) => ({
  idMedPro: `${PREFIX}-med-${i}`, idMed: `${PREFIX}-drug-${i}`, naMedPro: name, naMed: name,
  sdMed: '1', specSale: spec, unitSale: unit, fgActive: '1', orgActive: '1', medActive: '1',
  idSto: `${PREFIX}-store`, idDeptExec: DEPT, fgCheckOrd: '1', fgSkintest: '0',
}));
const exams = [['blood', '血常规', '检验', '41'], ['crp', 'C反应蛋白', '检验', '41'], ['xray', '胸部X线摄影', '检查', '31']]
  .map(([id, name, category, sdSrv]) => ({ id: `${PREFIX}-${id}`, code: `${PREFIX}-${id}`, name, category,
    idSrv: `${PREFIX}-${id}`, naSrv: name, sdSrv, idDeptExec: DEPT, fgCheckOrd: '1',
    idPart: category === '检查' ? `${PREFIX}-chest-part` : undefined,
    jsonField: category === '检验' ? JSON.stringify({ sdSpecimen: `${PREFIX}-blood-sample`, naSpecimen: '合成血液标本' }) : undefined,
    mutualRecognitionCode: `SYNTHETIC-${id}`, priceSale: 1, restricted: false }));
const items = list => ({ items: structuredClone(list), total: list.length, start: 0, limit: 1000 });

export function hisResponse(path, body) {
  assertSynthetic(body);
  const method = path.split('/').at(-1);
  const serialized = JSON.stringify(body);
  const chronic = serialized.includes(`${PREFIX}-chronic`);
  const patient = chronic ? createFixtures().chronicPatient : createFixtures().patient;
  const medicine = medicines.find(item => serialized.includes(item.idMedPro)) || medicines[0];
  let result;
  if (method === 'queryDiagnosisCatalog') result = items(diagnoses);
  else if (method === 'queryAvailableExamLabItems') result = items(exams);
  else if (method === 'queryMedicineList') result = items(medicines);
  else if (method === 'queryOrgSto' || method === 'queryDispensingSto') result = items([{ idSto: `${PREFIX}-store`, naSto: '合成西药房', idDept: DEPT, sdDisp: '1', sdUse: '1', fgActive: '1' }]);
  else if (method === 'frequency') result = items([{ key: 'qd', text: '每日一次' }, { key: 'tid', text: '每日三次' }, { key: 'prn', text: '必要时' }]);
  else if (method === 'deptListByTec') result = items([{ key: DEPT, text: '合成执行科室', idDept: DEPT, naDept: '合成执行科室' }]);
  else if (['queryHisAllergy', 'getLookMedList'].includes(method)) result = items([]);
  else if (method === 'queryVisitHistory') result = items(chronic ? [{ idPi: patient.idPi, idVis: `${PREFIX}-chronic-history-001`, visitTime: Date.now() - 7 * 86400000, naDept: '合成慢病门诊' }] : []);
  else if (['searchByIdPi', 'searchByIdPiMB'].includes(method)) result = { ...patient, synthetic: true };
  else if (method === 'loadClinicMedicalRecord') {
    result = { soapData: { chiefComplaint: patient.chiefComplaint, presentIllness: patient.historyOfPresentIllness,
      vitlSigns: { idVis: patient.idVis, bph: chronic ? 128 : 118, bpl: chronic ? 78 : 76, temp: chronic ? 36.5 : 36.8, pulseRate: chronic ? 72 : 78, breathRate: 18 } },
      diagList: [], orderList: [], presList: [], applyList: [], synthetic: true };
    if (chronic) result.diagList = [{ naDiag: '高血压', cdIcd10: 'I10.x00', fgMain: '1' }];
    if (chronic && serialized.includes('history-001')) result.presList = [{ idPres: `${PREFIX}-chronic-pres`, presSubList: [{
      idPresSub: `${PREFIX}-chronic-pres-item`, idMedPro: `${PREFIX}-med-1`, naMedPro: '氨氯地平片', specSale: '5mg',
      doseOnce: 5, unitDose: 'mg', idFreq: 'qd', idFreqText: '每日一次', idUsge: 'po', idUsgeText: '口服',
      takeDays: 30, amount: 30, unitSale: '片', idSto: `${PREFIX}-store`,
    }] }];
  }
  else if (method === 'buildContext') result = createFixtures().inpatient.hisContext;
  else if (method === 'loadMedicinePro') result = { ...medicine, priceSale: 1, amount: 1000, naFac: '合成厂家',
    dftDoseOnce: medicine.idMedPro.endsWith('-1') ? '5' : '1', unitDose: medicine.idMedPro.endsWith('-1') ? 'mg' : '片',
    unitPre: '片', unitSaleFactor: 1, proUnitFactor: 1, dftUsage: 'po', dftFreq: 'qd', idOrg: ORG, idFac: `${PREFIX}-factory` };
  else if (method === 'queryInvSubList') {
    const requested = medicines.filter(item => serialized.includes(item.idMedPro));
    result = items((requested.length ? requested : medicines).map(item => ({ ...item,
      idStoInv: `${item.idMedPro}-inventory`, amount: 1000, amountCur: 1000, priceSale: 1,
      cdBatch: 'SYNTHETIC', dtEffect: '2028-01-01', amtFrz: 0, unitPre: '片',
      unitSaleFactor: 1, proUnitFactor: 1, idOrg: ORG, idFac: `${PREFIX}-factory`, naFac: '合成厂家',
    })));
  }
  else if (method === 'checkInvEnough') result = { code: 200, msg: '合成库存充足' };
  else if (method === 'loadHiBdCliDetail') {
    const item = exams.find(item => JSON.stringify(body).includes(item.id));
    if (!item) throw new Error('未找到合成诊疗项目');
    result = { ...item, idCli: item.id, naCli: item.name, priceSale: 1, fgActive: '1' };
  }
  else if (method === 'queryExaPartAndWayList') result = items([{ idPart: `${PREFIX}-chest-part`, sdPartAndWay: 'SYNTHETIC', partAndWay: '合成胸部正位', sdPacstype: 'DR', count: 1 }]);
  else throw new Error(`未实现的模拟 HIS 接口：${method}`);
  return { code: 200, success: true, body: result };
}
