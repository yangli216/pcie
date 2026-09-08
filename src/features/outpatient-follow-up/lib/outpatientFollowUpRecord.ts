import { normalizePatientGenderCode } from '@/utils/patientContext';

const FEMALE_SPECIFIC_SECTION_LINE = /^\s*(?:月经史|婚育史)\s*[：:]/u;

/**
 * Removes gender-inapplicable HIS template lines from the report follow-up copy.
 * The source record remains untouched in PatientContext.
 */
export function normalizeOutpatientFollowUpRecordText(
  value: unknown,
  patientGender: unknown,
): string {
  if (typeof value !== 'string') return '';

  const recordText = value.trim();
  if (!recordText || normalizePatientGenderCode(patientGender) !== 'M') {
    return recordText;
  }

  return recordText
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .filter((line) => !FEMALE_SPECIFIC_SECTION_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
