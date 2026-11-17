import type {
  InpatientEmrContext,
  InpatientEmrFieldRule,
  InpatientEmrTemplateField,
  InpatientEmrTemplateParseResult,
} from '../types';
import { sanitizeExternalHtml } from '@shared/lib/safeHtml';

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isCodeLikeDisplayValue(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  if (/^[0-9a-f]{16,}$/i.test(text)) return true;
  if (/^\d{2,}$/.test(text)) return true;
  if (/^[A-Za-z]{1,8}\d{2,}$/.test(text)) return true;
  if (/^[A-Za-z0-9_.-]+$/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) return true;
  return false;
}

function readableDisplayText(value: unknown): string {
  const text = normalizeText(value);
  return isCodeLikeDisplayValue(text) ? '' : text;
}

function firstReadableDisplayText(...values: unknown[]): string {
  for (const value of values) {
    const text = readableDisplayText(value);
    if (text) return text;
  }
  return '';
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hashText(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return `tpl_${Math.abs(hash).toString(36)}_${value.length}`;
}

function getTemplateArticle(node: Element): string {
  let cursor: Element | null = node;
  while (cursor) {
    const article = cursor.getAttribute('data-article');
    if (article) return article;
    cursor = cursor.parentElement;
  }
  return '';
}

interface InitialFieldSuggestion {
  aiSuitable: boolean | null;
  source: InpatientEmrFieldRule['source'];
  meaning: string;
  fixedValue?: string;
}

function diagnosticNarrativeKind(id: string, name: string): 'basis' | 'differential' | null {
  const text = `${id} ${name}`.toLowerCase();
  if (/鉴别诊断|differential[\s_-]*diagnos(?:is|es)/u.test(text)) return 'differential';
  if (/诊断(?:依据|根据)|diagnostic[\s_-]*(?:basis|rationale)|evidence[\s_-]*for[\s_-]*diagnosis/u.test(text)) return 'basis';
  return null;
}

/** A local suggestion only. Persisted administrator policy wins after resolve. */
function suggestInitialField(id: string, name: string): InitialFieldSuggestion {
  const labels = [name, id].map((label) => normalizeText(label)
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/(?:文本|字段|正文)$/u, '').replace(/[：:]$/u, ''));
  const matches = (pattern: RegExp) => labels.some((label) => pattern.test(label));
  const system = (meaning: string): InitialFieldSuggestion => ({ aiSuitable: false, source: 'his_or_system', meaning });
  const narrative = (meaning: string): InitialFieldSuggestion => ({ aiSuitable: true, source: 'ai', meaning });

  if (id === '病程记录操作名称文本') {
    return { aiSuitable: false, source: 'fixed', meaning: '病程记录类型名称，通常跟随模板文书类型', fixedValue: '日常病程记录' };
  }
  if (matches(/(?:医师|医生)签(?:名|字)$/u)) {
    return { aiSuitable: false, source: 'doctor_signature', meaning: '医师签名字段，应由医生确认或电子签名流程完成' };
  }
  if (matches(/^(?:页眉|页脚)/u)) return system('病历页眉或页脚信息，保留模板或 HIS 提供的原值');
  if (matches(/(?:编码|代码|标识|编号|序号|日期|时间|天数|姓名|性别|年龄|床号|住院号|科室|医师|医生|名称|标题|操作人员|(?:签署|录入|填报|填写|审核|记录|操作|书写|创建|修改)(?:人|者)|签名|签字|手签)$/u)) return system('系统身份、标识、编码、时间或署名字段，按 HIS/系统事实填充');
  if (matches(/(?:^|[_ -])(?:id|code|date|time|timestamp|name|title|signature|operator|author|at)$/iu)) return system('系统身份、编码、时间或署名属性，按 HIS/系统事实填充');
  if (matches(/^(?:患者|病人)?(?:姓名|性别|年龄|年龄文字|出生地|籍贯|职业|民族|婚姻|婚姻状况|住址|地址|身份证号?|证件号码|联系人|联系电话|手机号(?:码)?|电话(?:号码)?|住院号|床号|床位号|病区|科室|供史者|陈述者|可靠程度|病史可靠程度)$/u)) {
    return system('患者身份、住院登记或供史信息，来自 HIS 登记事实');
  }
  if (matches(/^(?:(?:查房|住院|上级|主治|主管|经治|记录|书写|审核)?(?:医师|医生)|操作人员|操作人|记录人|书写人|审核人)(?:姓名)?$/u)) {
    return system('书写或查房医生信息，来自当前登录医生或 HIS 登记事实');
  }
  if (matches(/^(?:医疗机构(?:名称)?|病历标题|病程记录操作名称|病程记录名称)$/u)) return system('模板或系统提供的机构及文书信息');
  if (matches(/^(?:(?:入院|出院|初步|主要|次要|门诊|术前|术后))?诊断(?:名称|列表|ICD(?:-?10)?)?$/iu)) return system('结构化诊断字段，来自 HIS 已有诊断');
  if (matches(/^(?:patient[_-]?id|id[_-]?pi|idadsn|admission[_-]?id|inpatient[_-]?no|hospital[_-]?no|gender|sex|age|doctor[_-]?name|department)$/iu)) {
    return system('系统身份或登记属性，来自 HIS/系统事实');
  }

  const diagnosticKind = diagnosticNarrativeKind(id, name);
  if (diagnosticKind === 'basis') return narrative('诊断依据正文，根据已提供的病史、症状、查体及检验检查资料说明诊断的支持证据，不编造缺失事实');
  if (diagnosticKind === 'differential') return narrative('鉴别诊断正文，根据已提供的临床资料说明需鉴别方向及支持或反对依据，区分已有事实与待确认信息，不把待排方向写成确诊');
  if (matches(/(?:主诉|现病史|既往史|临床表现|入院情况|入院原因|诊疗经过|治疗经过|出院情况|治疗结果|出院医嘱|病情分析|诊疗计划|处理意见|病程记录|病程正文|记录正文|查房记录|查房正文)/u)
    || matches(/^(?:progress[_ -]?note|course[_ -]?record|chief[_ -]?complaint|present[_ -]?illness|past[_ -]?history)$/iu)
    || matches(/查房(?:医师|医生)意见/u)) {
    return narrative('住院病历临床正文，仅依据已提供临床资料按字段含义组织，不跨字段混写');
  }
  return { aiSuitable: null, source: 'manual_or_his', meaning: '模板字段，需结合模板上下文和 HIS 字段映射确认含义' };
}

/** Whole-field entry hints are not generated clinical content. */
export function isInpatientEmrPlaceholderValue(value: string): boolean {
  const trimmed = value.trim();
  const wrapper = [['[', ']'], ['【', '】'], ['(', ')'], ['（', '）']]
    .find(([open, close]) => trimmed.startsWith(open) && trimmed.endsWith(close));
  const text = wrapper ? trimmed.slice(wrapper[0].length, -wrapper[1].length).trim() : trimmed;
  return /^(?:请输入|请填写|请录入)[^。！？；;!?\r\n]*[。.…]*$/u.test(text)
    || /^(?:待填写|待补充)[。.…]*$/u.test(text);
}

function buildFieldRule(field: Pick<InpatientEmrTemplateField, 'id' | 'name'>, suggestion: InitialFieldSuggestion): InpatientEmrFieldRule {
  if (suggestion.aiSuitable === true) {
    const isDischarge = /出院/u.test(`${field.id} ${field.name}`) || /^discharge[_ -]/iu.test(field.id);
    return {
      source: 'ai',
      dependencies: ['registration', 'registration.diagnoses', 'orders', 'temperatureChart'],
      promptIntent: isDischarge ? 'inpatientDischargeRecordSection' : 'inpatientRecordSection',
      constraints: [
        '仅依据已提供资料生成，不补充未出现的检查结果或症状',
        '围绕字段含义生成对应段落，不跨字段混写其他模板项',
        '合理引用住院登记、诊断、医嘱和体温单中的客观信息',
        '保留医生最终审核空间，避免给出绝对疗效判断',
      ],
    };
  }
  if (suggestion.source === 'fixed') {
    return { source: 'fixed', value: suggestion.fixedValue, constraints: ['跟随模板文书类型或医生选择项'] };
  }
  if (suggestion.source === 'doctor_signature') {
    return { source: 'doctor_signature', dependencies: ['currentDoctor', 'signatureWorkflow'], constraints: ['AI 不生成签名，由医生确认或电子签名系统写入'] };
  }
  if (suggestion.source === 'his_or_system') {
    return { source: 'his_or_system', dependencies: ['registration', 'currentDoctor', 'currentTime'], constraints: ['按 HIS/系统事实填充，不由 AI 自由改写'] };
  }
  return { source: 'manual_or_his', dependencies: ['registration'], constraints: ['未知字段先保守映射，必要时由医生确认'] };
}

export function isAdmissionTemplate(templateName: string): boolean {
  const name = (templateName || '').toLowerCase();
  return name.includes('入院') || name.includes('ry') || name.includes('首次');
}

export function parseInpatientEmrTemplate(htmlContent: string): InpatientEmrTemplateParseResult {
  const safeHtml = sanitizeExternalHtml(htmlContent);
  const cacheKey = hashText(safeHtml);
  const doc = new DOMParser().parseFromString(safeHtml, 'text/html');
  const seen = new Set<string>();
  const unknownFieldIds = new Set<string>();
  const fields = Array.from(doc.querySelectorAll('[data-id][data-type]'))
    .flatMap((node): InpatientEmrTemplateField[] => {
      const id = node.getAttribute('data-id') || '';
      if (!id || seen.has(id)) return [];
      seen.add(id);
      const name = node.getAttribute('data-name') || node.getAttribute('title') || id;
      const defaultValue = node.getAttribute('data-default') || normalizeText(node.textContent);
      const suggestion = suggestInitialField(id, name);
      if (suggestion.aiSuitable === null) unknownFieldIds.add(id);
      const base = {
        id,
        name,
        article: getTemplateArticle(node),
        type: node.getAttribute('data-type') || 'text',
        readonly: node.getAttribute('data-readonly') === 'true',
        key: node.getAttribute('data-key') === 'true',
        defaultValue,
        meaning: suggestion.meaning,
        aiSuitable: suggestion.aiSuitable === true,
      };
      return [{
        ...base,
        rule: buildFieldRule(base, suggestion),
      }];
    });

  return { cacheKey, cacheHit: false, fields, unknownFieldIds: fields.filter((field) => unknownFieldIds.has(field.id)).map((field) => field.id) };
}

export function formatInpatientEmrDateMinute(value: Date = new Date()): string {
  const pad = (num: number) => String(num).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function fillInpatientEmrTemplateHtml(htmlContent: string, values: Record<string, string>): string {
  const safeHtml = sanitizeExternalHtml(htmlContent);
  const doc = new DOMParser().parseFromString(safeHtml, 'text/html');
  Array.from(doc.querySelectorAll('[data-id][data-type]')).forEach((node) => {
    const id = node.getAttribute('data-id') || '';
    if (!Object.prototype.hasOwnProperty.call(values, id)) return;
    const valueNode = node.querySelector('.tag-value') || node;
    valueNode.textContent = values[id] || '';
  });
  return doc.body.innerHTML;
}

export function buildEditableInpatientEmrPreviewHtml(
  htmlContent: string,
  values: Record<string, string>,
  fields: InpatientEmrTemplateField[],
  editable: boolean = true,
): string {
  const safeHtml = sanitizeExternalHtml(htmlContent);
  const doc = new DOMParser().parseFromString(safeHtml, 'text/html');
  const aiFieldIds = new Set(fields.filter((field) => field.aiSuitable).map((field) => field.id));
  const fieldNameMap = new Map(fields.map((field) => [field.id, field.name || field.id]));

  Array.from(doc.querySelectorAll('[data-id][data-type]')).forEach((node) => {
    const id = node.getAttribute('data-id') || '';
    const valueNode = node.querySelector('.tag-value') || node;
    if (Object.prototype.hasOwnProperty.call(values, id)) {
      valueNode.textContent = values[id] || '';
    }

    valueNode.setAttribute('data-inpatient-emr-field-id', id);
    valueNode.setAttribute('data-inpatient-emr-field-name', fieldNameMap.get(id) || id);
    valueNode.classList.add('inpatient-emr-field');

    if (aiFieldIds.has(id)) {
      valueNode.setAttribute('contenteditable', editable ? 'true' : 'false');
      valueNode.setAttribute('role', 'textbox');
      valueNode.setAttribute('aria-label', `${fieldNameMap.get(id) || id} AI 生成内容`);
      valueNode.setAttribute('spellcheck', 'false');
      valueNode.classList.add('inpatient-emr-field--ai');
      if (!editable) {
        valueNode.classList.add('inpatient-emr-field--generating');
      }
    } else {
      valueNode.setAttribute('contenteditable', 'false');
      valueNode.classList.add('inpatient-emr-field--readonly');
    }
  });

  return doc.body.innerHTML;
}

export function buildDefaultFieldValues(
  fields: InpatientEmrTemplateField[],
  context: InpatientEmrContext,
): Record<string, string> {
  const registration = context.registration;
  const documentContext = context.documentContext;
  const raw = objectRecord(registration?.raw);
  const rawAdmission = objectRecord(raw.admission);
  const doctorName = firstReadableDisplayText(
    registration?.attendingDoctorName,
    rawAdmission.attendingDoctorName,
    rawAdmission.attendingDoctorText,
    rawAdmission.attendingDoctor,
    rawAdmission.chiefDoctorName,
    rawAdmission.chiefDoctorText,
    rawAdmission.chiefDoctor,
  );
  const departmentName = firstReadableDisplayText(
    registration?.deptName,
    rawAdmission.departmentName,
    rawAdmission.departmentText,
    rawAdmission.department,
    registration?.wardName,
    rawAdmission.wardName,
    rawAdmission.wardText,
    rawAdmission.ward,
  );
  const fieldIds = new Set(fields.map((field) => field.id));
  const values: Record<string, string> = {};
  const setIfPresent = (id: string, value: string): void => {
    if (fieldIds.has(id)) {
      values[id] = value;
    }
  };

  setIfPresent('页眉医疗机构名称', String(registration?.raw?.idOrgText || registration?.raw?.naOrg || '医疗机构'));
  setIfPresent('页眉姓名', registration?.name || '');
  setIfPresent('页眉科室名称', departmentName);
  setIfPresent('页眉床位号', registration?.bedNo || '');
  setIfPresent('页眉住院号', registration?.inpatientNo || registration?.admissionNo || '');
  setIfPresent('病程记录操作时间', documentContext.recordTime || formatInpatientEmrDateMinute());
  setIfPresent('病程记录操作人员', doctorName);
  setIfPresent('病程记录操作名称文本', documentContext.recordType || '日常病程记录');
  setIfPresent('医师签名', doctorName);

  fields.forEach((field) => {
    if (field.aiSuitable) {
      values[field.id] = '';
    } else if (values[field.id] == null) {
      values[field.id] = field.defaultValue || '';
    }
  });

  return values;
}
