import type { AppPatient } from '@/types/appState';
import {
  getPatientContextAgeText,
  getPatientContextGenderText,
  getPatientContextName,
  getPatientContextVisitId,
} from '@/utils/patientContext';

/** Display values for the read-only HIS page header, scoped to this visit. */
export function getOutpatientEmrHeaderValues(
  patient: AppPatient | null | undefined,
  visitId: string | undefined,
  displayOrgName?: string,
): Readonly<Record<string, string>> {
  if (!patient || !visitId || getPatientContextVisitId(patient) !== visitId) return {};

  function visitText(...keys: string[]): string {
    for (const key of keys) {
      for (const value of [patient?.[key], patient?.raw?.[key]]) {
        if (typeof value === 'string' && value.trim()) return value.trim();
      }
    }
    return '';
  }

  const name = getPatientContextName(patient);
  const gender = getPatientContextGenderText(patient);
  return {
    页眉姓名: name === '未知患者' ? '' : name,
    页眉性别: gender === '男性' ? '男' : gender === '女性' ? '女' : gender,
    页眉年龄: getPatientContextAgeText(patient),
    页眉就诊科室: visitText('department', 'deptName', 'idDeptText'),
    页眉医疗机构: visitText('orgName', 'idOrgText', 'naOrg') || displayOrgName || '',
    页眉病历号: visitText('clinicNo', 'cdClinic'),
  };
}

// Keep the source nodes so removing a local value restores the exact HIS placeholder.
const originalContents = new WeakMap<HTMLElement, DocumentFragment>();

export function applyOutpatientEmrHeaderValues(
  root: HTMLElement,
  values: Readonly<Record<string, string>>,
): void {
  const headers = root.querySelectorAll<HTMLElement>(
    '[data-article="页眉"] [data-readonly="true"][data-id]',
  );
  for (const field of headers) {
    const slot = field.querySelector<HTMLElement>('.tag-value');
    if (!slot) continue;
    const fieldId = field.getAttribute('data-id') || '';
    const value = Object.prototype.hasOwnProperty.call(values, fieldId) ? values[fieldId] : '';
    const original = originalContents.get(slot);
    if (!value) {
      if (original) {
        slot.replaceChildren(original);
        originalContents.delete(slot);
      }
      continue;
    }
    if (!original) {
      const source = slot.cloneNode(true) as HTMLElement;
      source.querySelectorAll('.placeholder').forEach((placeholder) => placeholder.remove());
      if (source.textContent?.trim()) continue;
      const fragment = document.createDocumentFragment();
      fragment.append(...Array.from(slot.childNodes));
      originalContents.set(slot, fragment);
    }
    if (slot.textContent !== value) slot.textContent = value;
  }
}
