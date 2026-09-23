import { describe, expect, it, vi } from 'vitest';
import { createChronicRefillTimingTracker } from './chronicRefillTimingTracker';

function fixture() {
  let now = 0;
  const checkpoint = vi.fn();
  const report = vi.fn();
  const tracker = createChronicRefillTimingTracker({ now: () => now, checkpoint, report });
  return {
    tracker,
    checkpoint,
    report,
    at: (value: number) => {
      now = value;
    },
  };
}

describe('chronicRefillTimingTracker isolation and measurement', () => {
  it('includes confirmation work, deduplicates first packet, and measures overlapping spans independently', () => {
    const f = fixture();
    f.tracker.confirm();
    f.at(30);
    const session = f.tracker.start('refill-session-1');
    const endInventory = session.span('inventory_context_loading');
    f.at(80);
    session.mark('llm_first_chunk');
    const endMatch = session.span('initial_inventory_matching');
    f.at(120);
    session.mark('llm_first_chunk'); // duplicate mark should be ignored
    endMatch(5);
    f.at(200);
    endInventory(42);
    endInventory(); // repeated end should be idempotent
    session.measure('chunk_gap', 37.4, 8);
    session.finish('ready');

    const rows = f.report.mock.calls[0][2];
    expect(rows.find((row: { event: string }) => row.event === 'controller_received').fromConfirmMs).toBe(30);
    expect(rows.filter((row: { event: string }) => row.event === 'llm_first_chunk')).toHaveLength(1);
    expect(rows.find((row: { event: string }) => row.event === 'initial_inventory_matching').durationMs).toBe(40);
    expect(rows.find((row: { event: string }) => row.event === 'initial_inventory_matching').count).toBe(5);
    expect(rows.find((row: { event: string }) => row.event === 'inventory_context_loading').durationMs).toBe(170);
    expect(rows.find((row: { event: string }) => row.event === 'inventory_context_loading').count).toBe(42);
    expect(rows.find((row: { event: string }) => row.event === 'chunk_gap').durationMs).toBe(37);
    expect(rows.find((row: { event: string }) => row.event === 'chunk_gap').count).toBe(8);
  });

  it('ignores stale handles, wrong rounds, and repeated finish after a new session starts', () => {
    const f = fixture();
    const oldSession = f.tracker.start('old');
    const endOld = oldSession.span('late');
    f.at(100);
    const currentSession = f.tracker.start('new');
    const count = f.checkpoint.mock.calls.length;

    oldSession.mark('late');
    endOld();
    oldSession.finish('ready');

    expect(f.checkpoint).toHaveBeenCalledTimes(count);
    expect(f.tracker.get('old')).toBeUndefined();
    expect(f.tracker.get('new')).toBe(currentSession);

    currentSession.finish('ready');
    currentSession.finish('failed');
    expect(f.report.mock.calls.map((call) => call[1])).toEqual(['superseded', 'ready']);
  });

  it('bounds the log and isolates console failures from business execution', () => {
    const f = fixture();
    const session = f.tracker.start('round');
    for (let i = 0; i < 500; i++) session.span('section')();
    session.finish('ready');
    expect(f.report.mock.calls[0][2]).toHaveLength(160);

    f.checkpoint.mockImplementation(() => {
      throw new Error('console unavailable');
    });
    f.report.mockImplementation(() => {
      throw new Error('console unavailable');
    });
    expect(() => f.tracker.start('next').finish('failed')).not.toThrow();
  });
});
