import { computed, shallowRef, toRaw, watch, type Ref } from 'vue';
import type { AppPatient } from '@/types/appState';
import { getPatientContextVisitId } from '@/utils/patientContext';
import { normalizeOutpatientEmrTemplateSource, type OutpatientEmrTemplateSource } from '../api/outpatientEmrTemplateDecodeService';
import type { VoiceOutpatientEmrStartContext } from '../types';

// Key by the workflow's start context so reopening the result page reuses its template.
// The cache has no patient lookup key and never contains clinical field results.
const preparedBySession = new WeakMap<VoiceOutpatientEmrStartContext, {
  input: OutpatientEmrTemplateSource;
  task: Promise<OutpatientEmrTemplateSource>;
}>();

/** Share the decode of the bound template between first-pass recognition and the result page. */
export async function loadVoiceOutpatientEmrTemplateSource(
  session: VoiceOutpatientEmrStartContext,
  normalize: (source: OutpatientEmrTemplateSource) => Promise<OutpatientEmrTemplateSource> = normalizeOutpatientEmrTemplateSource,
): Promise<OutpatientEmrTemplateSource> {
  const key = toRaw(session);
  const { templateHtml, templateDefinition } = key.template;
  let entry = preparedBySession.get(key);
  if (!entry || entry.input.templateHtml !== templateHtml || entry.input.templateDefinition !== templateDefinition) {
    const input = { templateHtml, templateDefinition };
    entry = { input, task: normalize(input) };
    preparedBySession.set(key, entry);
  }
  try {
    return await entry.task;
  } catch (error) {
    if (preparedBySession.get(key) === entry) preparedBySession.delete(key);
    throw error;
  }
}

export function useVoiceOutpatientEmrTemplateSource(
  context: Ref<VoiceOutpatientEmrStartContext | null>,
  patient: Ref<AppPatient | null | undefined>,
  normalize: (source: OutpatientEmrTemplateSource) => Promise<OutpatientEmrTemplateSource>
    = normalizeOutpatientEmrTemplateSource,
) {
  const prepared = shallowRef<OutpatientEmrTemplateSource | null>(null);
  const error = shallowRef<Error | null>(null);
  const attempt = shallowRef(0);
  const matchingContext = computed(() => {
    const session = context.value;
    return session && getPatientContextVisitId(patient.value) === session.visitId ? session : null;
  });

  watch(
    () => [
      matchingContext.value,
      matchingContext.value?.template.templateHtml,
      matchingContext.value?.template.templateDefinition,
      attempt.value,
    ] as const,
    async ([session, templateHtml, templateDefinition], _, onCleanup) => {
      let active = true;
      onCleanup(() => { active = false; });
      prepared.value = null;
      error.value = null;
      if (!session || templateHtml === undefined || templateDefinition === undefined) return;

      try {
        const result = await loadVoiceOutpatientEmrTemplateSource(session, normalize);
        if (active) prepared.value = result;
      } catch (cause) {
        if (active) error.value = cause instanceof Error ? cause : new Error(String(cause));
      }
    }, { immediate: true, flush: 'sync' });

  return {
    matchingContext,
    prepared,
    error,
    retry: () => { attempt.value += 1; },
  };
}
