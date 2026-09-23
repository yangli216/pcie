import type { ChatMessage } from '@/services/llm';
import type { VoiceRecommendationPlan } from '@/prompts';
import { buildVoiceRoutingDecisionSummary } from '../lib/voiceRecommendationPlan';

export async function createVoiceRoutingDiagnostics(messages: ChatMessage[]) {
  let fingerprint = '不可用';
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ messages, temperature: 0 }));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    fingerprint = Array.from(new Uint8Array(hash)).slice(0, 8).map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { /* Fingerprinting is optional and must never interrupt generation. */ }
  let lastSummary = '';
  return (raw: VoiceRecommendationPlan | undefined, final: VoiceRecommendationPlan,
    diagnoses: Parameters<typeof buildVoiceRoutingDecisionSummary>[2]) => {
    const summary = buildVoiceRoutingDecisionSummary(raw, final, diagnoses);
    if (summary === lastSummary) return;
    lastSummary = summary;
    try {
      console.info(`[VoiceDecision] 决策汇总 input=${fingerprint} temperature=0\n${summary}`);
    } catch { /* Console-only diagnostics. */ }
  };
}
