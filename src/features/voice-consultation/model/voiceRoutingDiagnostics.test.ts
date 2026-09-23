import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceRoutingDiagnostics } from './voiceRoutingDiagnostics';
import { normalizeRecommendationPlan } from '../lib/voiceRecommendationPlan';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('voice routing diagnostics', () => {
  it('fingerprints the full messages consistently, deduplicates per request and logs no text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const messages = [{ role: 'user' as const, content: '私密患者信息甲' }];
    const first = await createVoiceRoutingDiagnostics(messages);
    const same = await createVoiceRoutingDiagnostics(messages);
    const changed = await createVoiceRoutingDiagnostics([{ role: 'user', content: '私密患者信息乙' }]);
    const plan = normalizeRecommendationPlan({ mode: 'parallel', recommendNow: ['medicine'], confidence: 'low' });
    first(plan, plan, []);
    first(plan, plan, []);
    same(plan, plan, []);
    changed(plan, plan, []);
    expect(info).toHaveBeenCalledTimes(3);
    expect(info.mock.calls[0][0]).toEqual(info.mock.calls[1][0]);
    expect(info.mock.calls[0][0]).not.toEqual(info.mock.calls[2][0]);
    expect(JSON.stringify(info.mock.calls)).not.toContain('私密患者');
  });

  it('does not interrupt care when hashing or console output is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(console, 'info').mockImplementation(() => { throw new Error('console unavailable'); });
    const log = await createVoiceRoutingDiagnostics([]);
    expect(() => log(undefined, normalizeRecommendationPlan(undefined), [])).not.toThrow();
  });
});
