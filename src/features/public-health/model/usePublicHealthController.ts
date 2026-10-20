import { computed, onScopeDispose, shallowRef } from 'vue';
import { PublicHealthGenerationError } from '../api/publicHealthGeneration';
import { usePublicHealthMealSelection } from './usePublicHealthMealSelection';
import type { PublicHealthTaskSnapshot } from '../api/publicHealthBridge';
import {
  assertConfirmation, assertRequest, assertResult, buildConfirmation, characterCount, clone, matchesFeedback, missingFacts, SECTION_IDS,
  supplementFacts,
} from '../lib/publicHealthContract';
import type {
  PublicHealthConfirmed, PublicHealthFeedback, PublicHealthFeedbackEvent, PublicHealthLaunch,
  PublicHealthManualFacts, PublicHealthMetrics, PublicHealthRequest, PublicHealthResult,
  PublicHealthSection, PublicHealthSectionId, PublicHealthState, PublicHealthStreamEvent,
} from '../types';

export interface PublicHealthControllerDependencies {
  generate: (request: PublicHealthRequest, onEvent: (event: PublicHealthStreamEvent) => void, signal: AbortSignal) => Promise<PublicHealthResult>;
  prepare: (bridgeSessionId: string, request: PublicHealthRequest) => Promise<unknown>;
  confirm: (bridgeSessionId: string, payload: PublicHealthConfirmed) => Promise<unknown>;
  close: (originRequestId: string) => Promise<unknown>;
  uuid?: () => string;
  now?: () => string;
}

export function usePublicHealthController(deps: PublicHealthControllerDependencies) {
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const now = deps.now ?? (() => new Date().toISOString());
  const launch = shallowRef<PublicHealthLaunch | null>(null);
  const state = shallowRef<PublicHealthState>('idle');
  const result = shallowRef<PublicHealthResult | null>(null);
  const partialSections = shallowRef<PublicHealthSection[]>([]);
  const partialMetrics = shallowRef<PublicHealthMetrics | null>(null);
  const sectionValues = shallowRef<Partial<Record<PublicHealthSectionId, string>>>({});
  const selected = shallowRef<PublicHealthSectionId[]>([]);
  const frozen = shallowRef<PublicHealthConfirmed | null>(null);
  const feedback = shallowRef<PublicHealthFeedback | null>(null);
  const message = shallowRef('');
  const reconnectable = shallowRef(false);
  const sending = shallowRef(false);
  let run = 0, attempted = false;
  let abort: AbortController | null = null;
  let waitTimer: ReturnType<typeof setTimeout> | null = null;
  let generationTimer: ReturnType<typeof setTimeout> | null = null;

  const request = computed(() => launch.value?.request ?? null);
  const missing = computed(() => request.value ? missingFacts(request.value) : []);
  const editable = computed(() => state.value === 'reviewable' || state.value === 'writeback-failed');
  const busy = computed(() => state.value === 'generating' || state.value === 'awaiting-writeback');
  const sections = computed(() => result.value?.sections ?? partialSections.value);
  const metrics = computed(() => result.value?.metrics ?? partialMetrics.value);
  const mealSelection = usePublicHealthMealSelection(computed(() => result.value?.sections.find(section => section.id === 'meal_plan')?.options), editable);
  const values = computed(() => mealSelection.currentValue.value === undefined ? sectionValues.value
    : { ...sectionValues.value, meal_plan: mealSelection.currentValue.value });
  const canGenerate = computed(() => Boolean(request.value && !missing.value.length
    && !['generating', 'awaiting-writeback', 'saved', 'conflict', 'expired'].includes(state.value)));
  const selectedTargets = computed(() => request.value?.writebackTargets.filter(target => target.sourceSections.every(id => selected.value.includes(id))) ?? []);
  const canWriteback = computed(() => {
    if (!editable.value || !request.value) return false;
    if (result.value) {
      if (!selectedTargets.value.length) return false;
      return selectedTargets.value.every(target => target.sourceSections.every(id => {
        const value = values.value[id];
        return Boolean(value?.trim() && characterCount(value) <= 16000);
      }));
    }
    if (state.value !== 'writeback-failed' || !frozen.value) return false;
    try { assertConfirmation(frozen.value, request.value); return true; } catch { return false; }
  });

  function clearTimers() {
    if (waitTimer) clearTimeout(waitTimer);
    if (generationTimer) clearTimeout(generationTimer);
    waitTimer = null; generationTimer = null;
  }
  function invalidateRun() { run++; abort?.abort(); abort = null; clearTimers(); }
  function clearResult() {
    result.value = null; partialSections.value = []; partialMetrics.value = null;
    sectionValues.value = {}; mealSelection.reset(); selected.value = []; frozen.value = null; feedback.value = null;
    reconnectable.value = false; sending.value = false;
  }
  function receiveLaunch(incoming: PublicHealthLaunch) {
    assertRequest(incoming.request);
    if (launch.value?.bridgeSessionId === incoming.bridgeSessionId
      && launch.value.request.originRequestId === incoming.request.originRequestId) {
      const current = launch.value.request;
      if (['patientId', 'businessRecordId', 'recordVersion', 'capability', 'scene'].some(key => current[key as keyof PublicHealthRequest] !== incoming.request[key as keyof PublicHealthRequest])
        || JSON.stringify(current.writebackTargets) !== JSON.stringify(incoming.request.writebackTargets)) {
        throw new Error('同一公卫来源任务的业务上下文发生冲突。');
      }
      return;
    }
    invalidateRun(); clearResult(); attempted = false;
    launch.value = clone(incoming); state.value = 'ready'; message.value = '';
  }
  function restore(snapshot: PublicHealthTaskSnapshot | null) {
    if (!snapshot || snapshot.phase === 'closed') return;
    if (snapshot.pendingWriteback) assertConfirmation(snapshot.pendingWriteback, snapshot.request);
    receiveLaunch(snapshot);
    if (snapshot.pendingWriteback) {
      attempted = true;
      frozen.value = clone(snapshot.pendingWriteback);
      selected.value = [...new Set(snapshot.pendingWriteback.items.flatMap(item => item.sourceSections))];
      state.value = 'awaiting-writeback';
      message.value = '已恢复最近发送的确认内容，等待 PHIS 保存回执。';
      if (snapshot.lastFeedback) receiveFeedback({ bridgeSessionId: snapshot.bridgeSessionId, feedback: snapshot.lastFeedback });
    }
  }
  function updateFacts(input: PublicHealthManualFacts) {
    if (!launch.value || busy.value || ['saved', 'conflict', 'expired'].includes(state.value)) return;
    const next = supplementFacts(launch.value.request, input, uuid, now);
    invalidateRun(); clearResult(); attempted = false;
    launch.value = { ...launch.value, request: next }; state.value = 'ready';
    message.value = '资料已更新，请核对后重新生成。';
  }
  async function generate(reconnect = false) {
    if (!launch.value || (!reconnect && !canGenerate.value) || (reconnect && !reconnectable.value)) return;
    invalidateRun(); const token = run;
    if (!reconnect && attempted) launch.value = { ...launch.value, request: { ...launch.value.request, requestId: uuid() } };
    const task = clone(launch.value);
    clearResult(); state.value = 'generating'; message.value = '正在核验本次资料…'; attempted = true;
    const controller = new AbortController(); abort = controller;
    generationTimer = setTimeout(() => {
      if (token !== run || state.value !== 'generating') return;
      controller.abort();
    }, 180_000);
    try {
      await deps.prepare(task.bridgeSessionId, task.request);
      if (token !== run) return;
      const complete = await deps.generate(task.request, event => {
        if (token !== run) return;
        if (event.event === 'progress') message.value = event.data.message;
        if (event.event === 'section') {
          const section = clone(event.data.section);
          partialSections.value = [...partialSections.value.filter(item => item.id !== section.id), section]
            .sort((a, b) => SECTION_IDS[task.request.capability].indexOf(a.id) - SECTION_IDS[task.request.capability].indexOf(b.id));
        }
        if (event.event === 'metrics') partialMetrics.value = clone(event.data.metrics);
      }, controller.signal);
      if (token !== run) return;
      assertResult(complete, task.request);
      result.value = clone(complete);
      sectionValues.value = Object.fromEntries(complete.sections.map(section => [section.id, section.content]));
      mealSelection.initialize();
      selected.value = complete.sections.filter(section => section.content.trim()).map(section => section.id);
      state.value = 'reviewable'; message.value = '请核对并编辑建议，确认后回写 PHIS。';
    } catch (error) {
      if (token !== run) return;
      const code = (error as { code?: string })?.code ?? '';
      reconnectable.value = (error instanceof PublicHealthGenerationError && !error.terminal) || controller.signal.aborted;
      state.value = /KNOWLEDGE|ASSET|POLICY_NOT_READY/.test(code) ? 'knowledge-missing'
        : /SESSION|TASK_CONTEXT/.test(code) ? 'expired' : 'generation-failed';
      message.value = controller.signal.aborted ? '等待服务端超时，可重新连接当前生成；未将临时内容作为结果。'
        : error instanceof Error ? error.message : '公卫生成失败，请核对后重试。';
    } finally {
      if (token === run) { if (generationTimer) clearTimeout(generationTimer); generationTimer = null; abort = null; }
    }
  }
  function stopWaiting() {
    if (state.value !== 'generating') return;
    invalidateRun(); clearResult(); state.value = 'ready';
    message.value = '已停止本页等待。本次结果不再更新此页；不代表服务端已取消或停止计费。';
  }
  function editSection(id: PublicHealthSectionId, value: string) {
    if (!editable.value || !result.value || !request.value || !SECTION_IDS[request.value.capability].includes(id)) return;
    if (id !== 'meal_plan' || !mealSelection.edit(value)) sectionValues.value = { ...sectionValues.value, [id]: value };
    if (!value.trim()) selected.value = selected.value.filter(section => section !== id);
    frozen.value = null;
  }
  function selectMealOption(id: string) {
    if (mealSelection.select(id)) frozen.value = null;
  }
  function selectSection(id: PublicHealthSectionId, checked: boolean) {
    if (!editable.value || !result.value || !request.value || !SECTION_IDS[request.value.capability].includes(id)) return;
    selected.value = checked && values.value[id]?.trim() ? [...new Set([...selected.value, id])] : selected.value.filter(item => item !== id);
    frozen.value = null;
  }
  function selectAll(checked: boolean) {
    if (!editable.value || !result.value || !request.value) return;
    selected.value = checked ? SECTION_IDS[request.value.capability].filter(id => values.value[id]?.trim()) : []; frozen.value = null;
  }
  function editRestoredTarget(targetFieldId: string, value: string) {
    if (state.value !== 'writeback-failed' || result.value || !frozen.value) return;
    frozen.value = { ...frozen.value, items: frozen.value.items.map(item => item.targetFieldId === targetFieldId ? { ...item, value } : item) };
  }
  async function writeback() {
    if (!launch.value || sending.value) return;
    const retransmit = state.value === 'awaiting-writeback' && frozen.value;
    if (!retransmit && !canWriteback.value) return;
    try {
      if (retransmit) assertConfirmation(frozen.value!, launch.value.request);
      if (!retransmit) {
        frozen.value = result.value
          ? buildConfirmation(launch.value.request, result.value, values.value, selected.value, uuid(), now())
          : { ...clone(frozen.value!), writebackRequestId: uuid(), confirmedAt: now() };
        assertConfirmation(frozen.value, launch.value.request);
      }
    } catch (error) { message.value = error instanceof Error ? error.message : '无法确认回写内容。'; return; }
    const task = launch.value, payload = clone(frozen.value!), token = run;
    state.value = 'awaiting-writeback'; feedback.value = null; sending.value = true;
    message.value = '已确认发送，等待 PHIS 保存回执。';
    if (waitTimer) clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      if (token === run && state.value === 'awaiting-writeback') message.value = '尚未收到 PHIS 保存回执。可重传同一确认内容；请勿重复新建保存尝试。';
    }, 30_000);
    try { await deps.confirm(task.bridgeSessionId, payload); }
    catch (error) {
      if (token === run && state.value === 'awaiting-writeback') {
        const code = (error as { code?: string })?.code ?? String(error);
        if (/SESSION|TASK_CONTEXT|TASK_CLOSED|TASK_EXPIRED/.test(code)) state.value = 'expired';
        message.value = state.value === 'expired' ? '当前 PHIS 会话已失效，请重新调入。已保留本次正文。'
          : '发送结果尚未确认，已保留同一回写标识。可重传或等待 PHIS 回执。';
      }
    } finally { if (token === run) sending.value = false; }
  }
  function receiveFeedback(event: PublicHealthFeedbackEvent): boolean {
    if (state.value !== 'awaiting-writeback' || !launch.value || !frozen.value
      || event.bridgeSessionId !== launch.value.bridgeSessionId || !matchesFeedback(event.feedback, frozen.value)) return false;
    feedback.value = clone(event.feedback);
    if (waitTimer) clearTimeout(waitTimer); waitTimer = null;
    state.value = event.feedback.status === 'success' ? 'saved'
      : event.feedback.errorCode === 'RECORD_VERSION_CONFLICT' ? 'conflict' : 'writeback-failed';
    message.value = event.feedback.status === 'success' ? 'PHIS 已确认保存。'
      : event.feedback.errorCode === 'RECORD_VERSION_CONFLICT' ? 'PHIS 记录版本已变化。草稿已保留，请从 PHIS 重新打开最新记录。'
        : event.feedback.message || 'PHIS 保存失败，草稿已保留。';
    return true;
  }
  async function close() {
    if (!launch.value || state.value === 'awaiting-writeback') return false;
    const token = run, originRequestId = launch.value.request.originRequestId;
    await deps.close(originRequestId);
    if (token !== run || launch.value?.request.originRequestId !== originRequestId) return false;
    invalidateRun(); clearResult(); launch.value = null; state.value = 'idle'; return true;
  }
  onScopeDispose(invalidateRun);
  return { request, state: computed(() => state.value), result: computed(() => result.value), sections, metrics,
    values: computed(() => values.value), selected: computed(() => selected.value), missing, editable, busy,
    selectedMealOptionId: mealSelection.selectedId, mealOptionValues: mealSelection.drafts,
    message: computed(() => message.value), frozen: computed(() => frozen.value), feedback: computed(() => feedback.value),
    canGenerate, canWriteback, reconnectable: computed(() => reconnectable.value), sending: computed(() => sending.value),
    receiveLaunch, restore, updateFacts, generate, stopWaiting, editSection, selectMealOption, editRestoredTarget, selectSection, selectAll, writeback, receiveFeedback, close };
}
export type PublicHealthController = ReturnType<typeof usePublicHealthController>;
