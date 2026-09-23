/** Console-only observability. Never holds patient data or controls clinical state. */
export interface VoiceTimingRow {
  event: string;
  fromConfirmMs: number;
  sincePreviousMs: number;
  durationMs?: number;
  count?: number;
}

export type VoiceTimingOutcome = 'ready' | 'ready-with-errors' | 'failed' | 'cached' | 'superseded';
export interface VoiceTimingSession {
  mark: (event: string, count?: number) => void;
  span: (event: string) => (count?: number) => void;
  finish: (outcome: VoiceTimingOutcome) => void;
}

export function createVoiceTimingTracker(options: {
  now: () => number;
  checkpoint: (sequence: number, row: VoiceTimingRow) => void;
  report: (sequence: number, outcome: VoiceTimingOutcome, rows: VoiceTimingRow[]) => void;
}) {
  let sequence = 0;
  let pendingConfirmation: number | undefined;
  let active: { round: string; session: VoiceTimingSession } | undefined;
  const safely = (effect: () => void) => { try { effect(); } catch { /* Observability must not break care. */ } };

  function start(round: string): VoiceTimingSession {
    active?.session.finish('superseded');
    const started = pendingConfirmation ?? options.now();
    pendingConfirmation = undefined;
    const id = ++sequence;
    const rows: VoiceTimingRow[] = [];
    const marked = new Set<string>();
    let previous = started;
    let closed = false;
    const append = (event: string, durationMs?: number, count?: number) => {
      if (closed || rows.length >= 160) return;
      const now = options.now();
      const row: VoiceTimingRow = {
        event,
        fromConfirmMs: Math.round(now - started),
        sincePreviousMs: Math.round(now - previous),
        ...(durationMs === undefined ? {} : { durationMs: Math.round(durationMs) }),
        ...(typeof count === 'number' && Number.isFinite(count) ? { count } : {}),
      };
      previous = now;
      rows.push(row);
      safely(() => options.checkpoint(id, { ...row }));
    };
    const session: VoiceTimingSession = {
      mark(event, count) {
        if (closed || rows.length >= 160 || marked.has(event)) return;
        marked.add(event);
        append(event, undefined, count);
      },
      span(event) {
        const begin = options.now();
        let ended = false;
        return (count) => {
          if (ended) return;
          ended = true;
          append(event, options.now() - begin, count);
        };
      },
      finish(outcome) {
        if (closed) return;
        append(`result_${outcome}`);
        closed = true;
        safely(() => options.report(id, outcome, rows.map(row => ({ ...row }))));
      },
    };
    active = { round, session };
    // Preserve the actual click time, including audio merging and controller entry.
    rows.push({ event: 'user_confirm_clicked', fromConfirmMs: 0, sincePreviousMs: 0 });
    safely(() => options.checkpoint(id, { ...rows[0] }));
    session.mark('controller_received');
    return session;
  }

  return {
    confirm() { pendingConfirmation = options.now(); },
    start,
    get(round?: string | null) { return round && active?.round === round ? active.session : undefined; },
  };
}

function formatTimingReport(sequence: number, outcome: VoiceTimingOutcome, rows: VoiceTimingRow[]): string {
  const at = (event: string) => rows.find(row => row.event === event)?.fromConfirmMs;
  const ms = (value?: number) => value === undefined ? '未记录' : `${value} ms`;
  const between = (from: string, to: string) => {
    const start = at(from);
    const end = at(to);
    return ms(start === undefined || end === undefined ? undefined : end - start);
  };
  const count = (event: string) => rows.find(row => row.event === event)?.count;
  const amount = (value?: number, unit = '') => value === undefined ? '未记录' : `${value}${unit}`;
  const outcomeLabel: Record<VoiceTimingOutcome, string> = {
    ready: '全部就绪', 'ready-with-errors': '处理结束（部分治疗失败）',
    failed: '失败', cached: '命中缓存', superseded: '被新一轮替代',
  };
  const stages: Record<string, string> = {
    record_core: '核心病历', history_context: '病史', record_suggestions: 'AI书写候选',
    diagnoses: '诊断', recommendation_plan: '诊疗路由', explicit_orders: '明确医嘱',
    record_extra: '补充病历', done: 'done事件',
  };
  const spans: Record<string, string> = {
    treatment_catalog_preparation: '治疗前目录准备', auxiliary_catalog: '检查检验目录',
    auxiliary_catalog_context: '检查检验目录上下文', auxiliary_request_build: '检查检验请求构造',
    auxiliary_immediate_results: '检查检验缺失分支应用',
    medicine_inventory: '药品库存准备', medicine_model: '药品模型', auxiliary_model: '检查检验模型',
    explicit_catalog_resolution: '明确医嘱目录映射', treatment_apply_medication: '药品应用/定稿',
    treatment_apply_auxiliary: '检查检验应用', treatment_total: '治疗全程',
    parse_or_repair: '解析/协议修复',
  };
  const lines = [
    `[VoiceTiming] 截图汇总 #${sequence}｜${outcomeLabel[outcome]}｜单位 ms`,
    `确认→结束 ${ms(at(`result_${outcome}`))}｜病历DOM ${ms(at('record_core_dom_updated'))}｜诊断DOM ${ms(at('diagnoses_dom_updated'))}`,
    `请求→首包 ${between('llm_stream_started', 'llm_first_chunk')}｜确认→流结束 ${ms(at('llm_stream_completed'))}`,
    `病历→诊断 ${between('record_core_dom_updated', 'diagnoses_dom_updated')}｜流结束→本轮结束 ${between('llm_stream_completed', `result_${outcome}`)}`,
    `检查检验模型发起 ${ms(at('auxiliary_model_started'))}`,
    `模型输入 ${amount(count('llm_prompt_chars'), ' 字符')}｜输出 ${amount(count('llm_output_chars'), ' 字符')}｜chunk ${amount(count('llm_stream_chunks'), ' 次')}｜最大间隔 ${amount(count('llm_chunk_gap_max_ms'), ' ms')}`,
    '【分区到达：距点击确认】',
    ...rows.filter(row => row.event.startsWith('section_') && stages[row.event.slice(8)])
      .map(row => `  ${stages[row.event.slice(8)]}：${ms(row.fromConfirmMs)}${row.count === undefined ? '' : ` / 数据 ${row.count} 字符`}`),
    '【关键阶段：独立耗时 / 完成时距确认】',
    ...rows.filter(row => spans[row.event]).map(row =>
      `  ${spans[row.event]}：${ms(row.durationMs)} / ${ms(row.fromConfirmMs)}`),
  ];
  for (const [prefix, label] of [
    ['normalize_', '归一化计算'], ['build_intent_', '结果构建/诊断匹配'],
    ['intent_page_application', '页面应用（含异步等待）'],
  ]) {
    const durations = rows.filter(row => row.event.startsWith(prefix) && row.durationMs !== undefined)
      .map(row => row.durationMs!);
    lines.push(`${label}：${durations.length
      ? `累计 ${ms(durations.reduce((sum, value) => sum + value, 0))}，单次最大 ${ms(Math.max(...durations))}`
      : '未记录'}`);
  }
  lines.push('注：并行阶段有重叠，耗时不能相加；未记录不代表 0。DOM更新不等于实际绘制。');
  return lines.join('\n');
}

export const voiceTimingTracker = createVoiceTimingTracker({
  now: () => performance.now(),
  checkpoint: (sequence, row) => console.info(
    `[VoiceTiming] #${sequence} ${row.event} | 距确认 ${row.fromConfirmMs} ms | 间隔 ${row.sincePreviousMs} ms`
    + (row.durationMs === undefined ? '' : ` | 耗时 ${row.durationMs} ms`)
    + (row.count === undefined ? '' : ` | 数量 ${row.count}`),
  ),
  report: (sequence, outcome, rows) => console.info(formatTimingReport(sequence, outcome, rows)),
});
