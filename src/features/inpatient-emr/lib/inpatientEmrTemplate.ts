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

function inferFieldMeaning(id: string, name: string, defaultValue?: string): string {
  const text = `${id} ${name} ${defaultValue || ''}`;
  if (text.includes('医疗机构')) return '病历页眉中的医疗机构名称，通常由机构配置或 HIS 上下文带入';
  if (text.includes('病历标题')) return '病历文书标题，通常跟随模板类型';
  if (text.includes('姓名') && !text.includes('医师')) return '患者姓名，来自住院登记信息';
  if (text.includes('科室')) return '患者当前住院科室或病区，来自住院登记信息';
  if (text.includes('床')) return '患者住院床号，来自住院登记信息';
  if (text.includes('住院号')) return '患者住院号，来自住院登记信息';
  if (text.includes('操作时间') || text.includes('业务时间')) return '本次病程记录的记录时间，默认使用当前业务时间';
  if (text.includes('操作人员') || text.includes('查房医师')) return '查房或书写医生姓名，来自登录医生或住院登记医生信息';
  if (text.includes('操作名称') || text.includes('病程记录名称')) return '病程记录类型名称，通常跟随模板文书类型';
  const narrativeKind = diagnosticNarrativeKind(id, name);
  if (narrativeKind === 'basis') return '诊断依据正文，根据已提供的病史、症状、查体及检验检查资料说明诊断的支持证据，不编造缺失事实';
  if (narrativeKind === 'differential') return '鉴别诊断正文，根据已提供的临床资料说明需鉴别方向及支持或反对依据，区分已有事实与待确认信息，不把待排方向写成确诊';
  if (id === '病程记录文本' || text.includes('记录文本')) return '病程记录正文，适合结合住院登记、诊断、医嘱和体温单生成';
  if (id.includes('查房') || text.includes('查房')) return '查房记录正文，适合结合住院登记、诊断、医嘱和体温单生成';
  if (text.includes('医师签名')) return '医师签名字段，应由医生确认或电子签名流程完成';
  return '模板字段，需结合模板上下文和 HIS 字段映射确认含义';
}

export interface InpatientEmrMatcherConfig {
  excludeKeywords: string[];
  aiSuitableKeywords: string[];
}

export const defaultMatcherConfig: InpatientEmrMatcherConfig = {
  excludeKeywords: [
    '页眉', '姓名', '科室', '床', '住院号', '日期', '时间', '天数',
    '签名', '操作人员', '操作名称', '诊断', 'idadsn', 'patientid', 'inpatientno',
    '出生地', '籍贯', '职业', '民族', '婚姻', '陈述', '供史', '可靠', '住址', '地址',
    '身份证', '联系人', '电话', '手机', '入院', '业务', '工作',
    'csd', 'jg', 'zy', 'mz', 'hy', 'csz', 'gsz', 'kg', 'zz', 'dz', 'sfz', 'lxr', 'dh', 'sj', 'ry', 'yw', 'gz'
  ],
  aiSuitableKeywords: [
    // 中文标准字段名称
    '病程记录文本', '记录正文', '入院情况', '诊疗经过', '出院情况',
    '治疗结果', '出院医嘱', '病情分析', '诊疗计划', '处理意见', '病程记录', '病程正文',
    '查房记录', '查房正文', '查房',
    '主诉', '现病史', '既往史',
    // 拼音缩写
    'bcjl', 'bczw', 'ryqk', 'zlgj', 'cyqk', 'zljg', 'cyyz', 'bqfx', 'zljh', 'clyj',
    'zs', 'xbs', 'jws', 'cf', 'cfjl',
    // 常见英文/混合命名前缀后缀
    'progress_note', 'course_record', 'chief_complaint', 'present_illness', 'past_history'
  ]
};

let currentMatcherConfig = { ...defaultMatcherConfig };
const documentTypeExcludeKeywords = new Set(['入院', 'ry']);

function diagnosticNarrativeKind(id: string, name: string): 'basis' | 'differential' | null {
  const text = `${id} ${name}`.toLowerCase();
  if (/鉴别诊断|differential[\s_-]*diagnos(?:is|es)/u.test(text)) return 'differential';
  if (/诊断(?:依据|根据)|diagnostic[\s_-]*(?:basis|rationale)|evidence[\s_-]*for[\s_-]*diagnosis/u.test(text)) return 'basis';
  return null;
}

export function getInpatientEmrMatcherConfig(): InpatientEmrMatcherConfig {
  return currentMatcherConfig;
}

export function setInpatientEmrMatcherConfig(config: Partial<InpatientEmrMatcherConfig>): void {
  currentMatcherConfig = {
    excludeKeywords: config.excludeKeywords ? [...config.excludeKeywords] : currentMatcherConfig.excludeKeywords,
    aiSuitableKeywords: config.aiSuitableKeywords ? [...config.aiSuitableKeywords] : currentMatcherConfig.aiSuitableKeywords,
  };
}

export function getPresetFieldStatus(id: string, name: string): 'exclude' | 'ai' | 'unknown' {
  const text = `${id} ${name}`.toLowerCase();
  const config = getInpatientEmrMatcherConfig();
  const narrativeKind = diagnosticNarrativeKind(id, name);

  if (config.excludeKeywords.some((keyword) => {
    const normalizedKeyword = keyword.toLowerCase();
    return !documentTypeExcludeKeywords.has(normalizedKeyword)
      && !(normalizedKeyword === '诊断' && narrativeKind)
      && text.includes(normalizedKeyword);
  })) {
    return 'exclude';
  }

  if (narrativeKind || config.aiSuitableKeywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return 'ai';
  }

  if (config.excludeKeywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
    return 'exclude';
  }

  return 'unknown';
}

export function isAiSuitableField(id: string, name: string): boolean {
  return getPresetFieldStatus(id, name) === 'ai';
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

function buildFieldRule(field: Pick<InpatientEmrTemplateField, 'id' | 'name'>): InpatientEmrFieldRule {
  const idLower = field.id.toLowerCase();
  const nameLower = (field.name || '').toLowerCase();
  const isAi = isAiSuitableField(field.id, field.name);
  if (isAi) {
    const isDischarge = idLower.includes('出院') || idLower.includes('cy') || nameLower.includes('出院') || nameLower.includes('cy');
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

  if (field.id.startsWith('页眉') || field.id === '病程记录操作时间' || field.id === '病程记录操作人员') {
    return {
      source: 'his_or_system',
      dependencies: ['registration', 'currentDoctor', 'currentTime'],
      constraints: ['按 HIS/系统事实填充，不由 AI 自由改写'],
    };
  }

  if (field.id === '病程记录操作名称文本') {
    return {
      source: 'fixed',
      value: '日常病程记录',
      constraints: ['跟随模板文书类型或医生选择项'],
    };
  }

  if (field.id === '医师签名') {
    return {
      source: 'doctor_signature',
      dependencies: ['currentDoctor', 'signatureWorkflow'],
      constraints: ['AI 不生成签名，由医生确认或电子签名系统写入'],
    };
  }

  return {
    source: 'manual_or_his',
    dependencies: ['registration'],
    constraints: ['未知字段先保守映射，必要时由医生确认'],
  };
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
  const fields = Array.from(doc.querySelectorAll('[data-id][data-type]'))
    .map((node): InpatientEmrTemplateField => {
      const id = node.getAttribute('data-id') || '';
      const name = node.getAttribute('data-name') || node.getAttribute('title') || id;
      const defaultValue = node.getAttribute('data-default') || normalizeText(node.textContent);
      const presetStatus = getPresetFieldStatus(id, name);
      const base = {
        id,
        name,
        article: getTemplateArticle(node),
        type: node.getAttribute('data-type') || 'text',
        readonly: node.getAttribute('data-readonly') === 'true',
        key: node.getAttribute('data-key') === 'true',
        defaultValue,
        meaning: inferFieldMeaning(id, name, defaultValue),
        aiSuitable: presetStatus === 'ai',
        presetStatus,
      };
      return {
        ...base,
        rule: buildFieldRule(base),
      };
    })
    .filter((field) => {
      if (!field.id || seen.has(field.id)) return false;
      seen.add(field.id);
      return true;
    });

  return { cacheKey, cacheHit: false, fields };
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
