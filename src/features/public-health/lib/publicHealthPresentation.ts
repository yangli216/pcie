import { isZonedDate } from './publicHealthContract';
import type { PublicHealthObservation, PublicHealthRequest } from '../types';

export interface PresentedObservation extends PublicHealthObservation {
  label: string;
  isAdopted: boolean;
}

const observationLabels: Record<string, string> = { height: '身高', weight: '体重' };
const lifestyleLabels = {
  smoking: '吸烟', alcohol: '饮酒', exercise: '运动', diet: '饮食',
  exerciseAbility: '运动能力', occupation: '职业',
} as const;

export function presentPublicHealthMeasurements(request: PublicHealthRequest): {
  observations: PresentedObservation[];
  historical: PresentedObservation[];
} {
  const profile = request.capability === 'weight_management' ? request.facts.weightProfile : undefined;
  const adopted = profile ? ([
    [profile.heightObservationId, 'height', 'cm', profile.heightCm],
    [profile.weightObservationId, 'weight', 'kg', profile.weightKg],
  ] as const).flatMap(([id, code, unit, value]) => {
    const item = request.facts.observations.find(item => item.id === id && item.code === code
      && item.unit === unit && item.value === value);
    return item ? [item] : [];
  }) : [];
  const adoptedIds = new Set(adopted.map(item => item.id));
  const adoptedCodes = new Set(adopted.map(item => item.code));
  const observations: PresentedObservation[] = [], historical: PresentedObservation[] = [];
  for (const item of request.facts.observations) {
    const presented = { ...item, label: observationLabels[item.code] || item.code, isAdopted: adoptedIds.has(item.id) };
    if (!presented.isAdopted && adoptedCodes.has(item.code)) historical.push(presented);
    else observations.push(presented);
  }
  return {
    observations: [...observations.filter(item => item.isAdopted), ...observations.filter(item => !item.isAdopted)],
    historical,
  };
}

export function presentPublicHealthLifestyle(request: PublicHealthRequest) {
  const lifestyle = { ...request.facts.lifestyle };
  const profile = request.capability === 'weight_management' ? request.facts.weightProfile : undefined;
  if (profile) {
    lifestyle.exercise = profile.activityDescription;
    lifestyle.diet = profile.dietPreferences;
  }
  return Object.entries(lifestyleLabels).flatMap(([key, label]) => {
    const value = lifestyle[key as keyof typeof lifestyleLabels];
    return value?.trim() ? [{ key, label, value }] : [];
  });
}

const measurementTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function formatMeasurementTime(value: string): string {
  if (!isZonedDate(value)) return '测量时间待核对';
  const parts = Object.fromEntries(measurementTimeFormatter.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（北京时间）`;
}

export function formatFactSource(system: string | undefined): string {
  return system === 'PCIE_MANUAL' ? '人工补充' : system || '未提供';
}
