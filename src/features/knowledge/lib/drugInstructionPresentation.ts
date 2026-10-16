import { formatPatientAgeText } from '@entities/patient';
import { isDrugUsageSection, type DrugInstructionSection } from './drugInstructionSections';

/** A reading-order rule only; never interpret a product's eligible age or dose. */
function isChildAge(ageText: string): boolean {
  const normalized = formatPatientAgeText(ageText);
  const match = normalized.match(/^(?:(\d+(?:\.\d+)?)(?:周岁|岁))?(?:(\d+(?:\.\d+)?)(?:个月|月龄|月))?(?:(\d+(?:\.\d+)?)(?:日龄|日|天))?$/u);
  if (!match || !match.slice(1).some(value => value !== undefined)) return false;
  // Use 365 days conservatively at the adult boundary; no rounding of years.
  const years = Number(match[1] ?? 0) + Number(match[2] ?? 0) / 12 + Number(match[3] ?? 0) / 365;
  return Number.isFinite(years) && years >= 0 && years < 18;
}

export function prioritizedDrugInstructionSections(
  sections: DrugInstructionSection[],
  patientAgeText: string,
): DrugInstructionSection[] {
  const children = isChildAge(patientAgeText)
    ? sections.filter(section => /^【\s*儿童\s*用药\s*】$/u.test(section.heading.trim()) && section.content.trim())
    : [];
  return [...children, ...sections.filter(isDrugUsageSection)];
}
