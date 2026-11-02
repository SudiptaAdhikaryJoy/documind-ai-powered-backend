export type LlmRole = 'system' | 'user' | 'assistant';

export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  think?: boolean;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  options?: LlmCompletionOptions;
}

export interface LlmCompletionResponse {
  content: string;
  promptTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}
