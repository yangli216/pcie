/** Console-only observability. Never holds patient data or controls clinical state. */
export interface ChronicRefillTimingRow {
  event: string;
  fromConfirmMs: number;
  sincePreviousMs: number;
  durationMs?: number;
  count?: number;
}

export type ChronicRefillTimingOutcome = 'ready' | 'ready-with-errors' | 'failed' | 'superseded';

export interface ChronicRefillTimingSession {
  mark: (event: string, count?: number) => void;
  span: (event: string) => (count?: number) => void;
  measure: (event: string, durationMs: number, count?: number) => void;
  finish: (outcome: ChronicRefillTimingOutcome) => void;
}

export function createChronicRefillTimingTracker(options: {
  now: () => number;
  checkpoint: (sequence: number, row: ChronicRefillTimingRow) => void;
  report: (sequence: number, outcome: ChronicRefillTimingOutcome, rows: ChronicRefillTimingRow[]) => void;
}) {
  let sequence = 0;
  let pendingConfirmation: number | undefined;
  let active: { sessionId: string; session: ChronicRefillTimingSession } | undefined;
  const safely = (effect: () => void) => {
    try {
      effect();
    } catch {
      /* Observability must not break care. */
    }
  };

  function start(sessionId: string): ChronicRefillTimingSession {
    active?.session.finish('superseded');
    const started = pendingConfirmation ?? options.now();
    pendingConfirmation = undefined;
    const id = ++sequence;
    const rows: ChronicRefillTimingRow[] = [];
    const marked = new Set<string>();
    let previous = started;
    let closed = false;

    const append = (event: string, durationMs?: number, count?: number) => {
      if (closed || rows.length >= 160) return;
      const now = options.now();
      const row: ChronicRefillTimingRow = {
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

    const session: ChronicRefillTimingSession = {
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
      measure(event, durationMs, count) {
        if (closed || rows.length >= 160 || !Number.isFinite(durationMs)) return;
        append(event, Math.max(0, durationMs), count);
      },
      finish(outcome) {
        if (closed) return;
        append(`result_${outcome}`);
        closed = true;
        safely(() => options.report(id, outcome, rows.map((row) => ({ ...row }))));
      },
    };

    active = { sessionId, session };
    rows.push({ event: 'user_confirm_clicked', fromConfirmMs: 0, sincePreviousMs: 0 });
    safely(() => options.checkpoint(id, { ...rows[0] }));
    session.mark('controller_received');
    return session;
  }

  return {
    confirm() {
      pendingConfirmation = options.now();
    },
    start,
    get(sessionId?: string | null) {
      return sessionId && active?.sessionId === sessionId ? active.session : undefined;
    },
  };
}

function formatChronicRefillTimingReport(
  sequence: number,
  outcome: ChronicRefillTimingOutcome,
  rows: ChronicRefillTimingRow[],
): string {
  const at = (event: string) => rows.find((row) => row.event === event)?.fromConfirmMs;
  const ms = (value?: number) => (value === undefined ? '未记录' : `${value} ms`);
  const between = (from: string, to: string) => {
    const start = at(from);
    const end = at(to);
    return ms(start === undefined || end === undefined ? undefined : end - start);
  };
  const count = (event: string) => rows.find((row) => row.event === event)?.count;
  const amount = (value?: number, unit = '') => (
    value === undefined ? '未记录' : `${value}${unit}`
  );

  const outcomeLabel: Record<ChronicRefillTimingOutcome, string> = {
    ready: '全部就绪',
    'ready-with-errors': '处理结束（部分数据异常）',
    failed: '失败',
    superseded: '被新一轮替代',
  };

  const stages: Record<string, string> = {
    record_core: '核心病历',
    medication_scope: '多慢病药品归属',
    review_plan: '复诊核查项',
    recommended_medicines: '推荐用药',
    record_extra: '查体与健康指导',
    done: 'done事件',
  };

  const spans: Record<string, string> = {
    scope_candidate: '慢病范围裁定',
    begin_clinical_result: '打开结果页占位',
    inventory_context_loading: '院内库存检索',
    initial_inventory_matching: '初始库存匹配',
    prompt_context_build: '模型上下文构造',
    llm_request_build: '模型请求构造',
    llm_stream_total: '大模型流式全程',
    llm_chunk_gap_max: '流式 chunk 最大间隔',
    final_inventory_treatments: '最终药品定稿',
    intent_page_application: '页面应用（含异步等待）',
  };

  const lines = [
    `[ChronicRefillTiming] 截图汇总 #${sequence}｜${outcomeLabel[outcome]}｜单位 ms`,
    `确认→结束 ${ms(at(`result_${outcome}`))}｜病历DOM ${ms(at('record_core_dom_updated'))}｜核查DOM ${ms(at('review_plan_dom_updated'))}`,
    `请求→首包 ${between('llm_stream_started', 'llm_first_chunk')}｜确认→流结束 ${ms(at('llm_stream_completed'))}`,
    `流结束→本轮结束 ${between('llm_stream_completed', `result_${outcome}`)}`,
    '【模型输入规模】',
    `  库存上下文：${count('inventory_prompt_scoped') !== undefined ? '历史同品候选' : count('inventory_prompt_full') !== undefined ? '全量可用库存' : '未记录'} / ${
      amount(count('inventory_prompt_scoped') ?? count('inventory_prompt_full'), ' 项')
    } / ${amount(count('inventory_prompt_chars'), ' 字符')}`,
    `  历史依据：${amount(count('history_evidence_chars'), ' 字符')}｜待归类原始项：${amount(count('medication_scope_items'), ' 项')}｜合并后：${amount(count('medication_scope_groups'), ' 组')}`,
    `  模型消息：${amount(count('llm_prompt_chars'), ' 字符')}`,
    '【分区到达：距点击确认】',
    ...rows
      .filter((row) => row.event.startsWith('section_') && stages[row.event.slice(8)])
      .map((row) => `  ${stages[row.event.slice(8)]}：${ms(row.fromConfirmMs)}${
        row.count !== undefined ? ` / 数据 ${row.count} 字符` : ''
      }`),
    '【流式输出】',
    `  输出总量：${amount(count('llm_output_chars'), ' 字符')}｜chunk：${amount(count('llm_stream_chunks'), ' 次')}｜最大间隔：${ms(rows.find((row) => row.event === 'llm_chunk_gap_max')?.durationMs)}`,
    '【关键阶段：独立耗时 / 完成时距确认】',
    ...rows
      .filter((row) => spans[row.event])
      .map((row) => `  ${spans[row.event]}：${ms(row.durationMs)} / ${ms(row.fromConfirmMs)}${
        row.count !== undefined ? ` (数量: ${row.count})` : ''
      }`),
  ];

  lines.push('注：并行阶段有重叠，耗时不能相加；未记录不代表 0。DOM更新不等于实际绘制。');
  return lines.join('\n');
}

export const chronicRefillTimingTracker = createChronicRefillTimingTracker({
  now: () => performance.now(),
  checkpoint: (sequence, row) => console.info(
    `[ChronicRefillTiming] #${sequence} ${row.event} | 距确认 ${row.fromConfirmMs} ms | 间隔 ${row.sincePreviousMs} ms`
    + (row.durationMs === undefined ? '' : ` | 耗时 ${row.durationMs} ms`)
    + (row.count === undefined ? '' : ` | 数量 ${row.count}`),
  ),
  report: (sequence, outcome, rows) => console.info(formatChronicRefillTimingReport(sequence, outcome, rows)),
});
