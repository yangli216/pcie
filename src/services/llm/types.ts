export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[];
  messageId?: string;
  sessionId?: string;
  tokenCount?: number;
  llmModel?: string;
  latencyMs?: number;
  createdAt?: number;
  isDefault?: boolean;
}

export const DEFAULT_LLM_CONFIG = {
  model: "gpt-4o-mini",
  fastModel: "gpt-4o-mini",
  audioModel: "whisper-1",
  enableThinking: false,
};

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
};

export interface LLMConfigOverride {
  configProfile?: 'default' | 'fast' | 'reviewer';
  enableWebSearch?: boolean;
  traceContext?: {
    consultationId?: string;
    scene?: string;
    sourceModule?: string;
    operationModule?: string;
    operationAction?: string;
    title?: string;
  };
}
