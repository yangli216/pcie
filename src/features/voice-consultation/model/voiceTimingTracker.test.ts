import { describe, expect, it, vi } from 'vitest';
import { createVoiceTimingTracker } from './voiceTimingTracker';

function fixture() {
  let now = 0;
  const checkpoint = vi.fn();
  const report = vi.fn();
  const tracker = createVoiceTimingTracker({ now: () => now, checkpoint, report });
  return { tracker, checkpoint, report, at: (value: number) => { now = value; } };
}

describe('voice timing isolation and measurement', () => {
  it('includes confirmation work, deduplicates first packet, and measures overlapping spans independently', () => {
    const f = fixture();
    f.tracker.confirm();
    f.at(25);
    const session = f.tracker.start('private-round');
    const endModel = session.span('model');
    f.at(50);
    session.mark('llm_first_chunk');
    const endCatalog = session.span('catalog');
    f.at(75);
    session.mark('llm_first_chunk');
    endCatalog(3);
    f.at(125);
    endModel();
    endModel();
    session.finish('ready');
    const rows = f.report.mock.calls[0][2];
    expect(rows.find((row: { event: string }) => row.event === 'controller_received').fromConfirmMs).toBe(25);
    expect(rows.filter((row: { event: string }) => row.event === 'llm_first_chunk')).toHaveLength(1);
    expect(rows.find((row: { event: string }) => row.event === 'catalog').durationMs).toBe(25);
    expect(rows.find((row: { event: string }) => row.event === 'model').durationMs).toBe(100);
    expect(JSON.stringify(f.report.mock.calls)).not.toContain('private-round');
  });

  it('ignores stale handles, wrong rounds, and repeated finish after a new session starts', () => {
    const f = fixture();
    const old = f.tracker.start('old');
    const endOld = old.span('late');
    f.at(100);
    const current = f.tracker.start('new');
    const count = f.checkpoint.mock.calls.length;
    old.mark('late');
    endOld();
    old.finish('ready');
    expect(f.checkpoint).toHaveBeenCalledTimes(count);
    expect(f.tracker.get('old')).toBeUndefined();
    expect(f.tracker.get('new')).toBe(current);
    current.finish('cached');
    current.finish('ready');
    expect(f.report.mock.calls.map(call => call[1])).toEqual(['superseded', 'cached']);
  });

  it('bounds the log and isolates console failures from business execution', () => {
    const f = fixture();
    const session = f.tracker.start('round');
    for (let i = 0; i < 500; i++) session.span('section')();
    session.finish('ready');
    expect(f.report.mock.calls[0][2]).toHaveLength(160);
    f.checkpoint.mockImplementation(() => { throw new Error('console unavailable'); });
    f.report.mockImplementation(() => { throw new Error('console unavailable'); });
    expect(() => f.tracker.start('next').finish('failed')).not.toThrow();
  });
});
