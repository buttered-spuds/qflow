/**
 * LLM adapter interface — implemented in Phase 3.
 * Each provider (OpenAI, Anthropic, Azure, custom) will implement this.
 */
export interface LLMAdapter {
  chat(messages: ChatMessage[]): Promise<string>;
  toolCall(messages: ChatMessage[], tools: Tool[]): Promise<ToolCallResult>;
  /** Returns token usage for cost tracking. */
  getLastUsage(): TokenUsage;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallResult {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}
