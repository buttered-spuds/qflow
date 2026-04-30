import type { LLMAdapter, ChatMessage, Tool, ToolCallResult, TokenUsage } from './base.js';

// ─── Anthropic Messages API types (partial) ───────────────────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: string | AnthropicContent[] }>;
  tools?: AnthropicTool[];
  tool_choice?: { type: string };
  system?: string;
}

interface AnthropicContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicResponse {
  content: AnthropicContent[];
  usage?: { input_tokens: number; output_tokens: number };
  stop_reason?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: object;
}

// Claude pricing (per 1M tokens, USD) — April 2026
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-3-5': { input: 0.8, output: 4 },
  default: { input: 3, output: 15 },
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class AnthropicAdapter implements LLMAdapter {
  private lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };
  private static readonly API_VERSION = '2023-06-01';
  private static readonly MAX_TOKENS = 8192;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'claude-opus-4-5',
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const { system, userMessages } = splitSystemMessage(messages);

    const body: AnthropicRequest = {
      model: this.model,
      max_tokens: AnthropicAdapter.MAX_TOKENS,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (system) body.system = system;

    const data = await this.#request<AnthropicResponse>(body);
    this.#recordUsage(data.usage);

    const text = data.content.find((c) => c.type === 'text');
    return text?.text ?? '';
  }

  async toolCall(messages: ChatMessage[], tools: Tool[]): Promise<ToolCallResult> {
    const { system, userMessages } = splitSystemMessage(messages);

    const anthropicTools: AnthropicTool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const body: AnthropicRequest = {
      model: this.model,
      max_tokens: AnthropicAdapter.MAX_TOKENS,
      messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      tools: anthropicTools,
      tool_choice: { type: 'any' },
    };

    if (system) body.system = system;

    const data = await this.#request<AnthropicResponse>(body);
    this.#recordUsage(data.usage);

    const toolUse = data.content.find((c) => c.type === 'tool_use');
    if (!toolUse?.name || !toolUse.input) throw new Error('Anthropic returned no tool use');

    return { toolName: toolUse.name, arguments: toolUse.input };
  }

  getLastUsage(): TokenUsage {
    return this.lastUsage;
  }

  async #request<T>(body: AnthropicRequest): Promise<T> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': AnthropicAdapter.API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 300)}`);
    }

    return res.json() as Promise<T>;
  }

  #recordUsage(usage?: { input_tokens: number; output_tokens: number }): void {
    if (!usage) return;
    const pricing = PRICING[this.model] ?? PRICING.default;
    const total = usage.input_tokens + usage.output_tokens;
    const cost =
      (usage.input_tokens / 1_000_000) * pricing.input +
      (usage.output_tokens / 1_000_000) * pricing.output;

    this.lastUsage = {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: total,
      estimatedCostUsd: Math.round(cost * 100_000) / 100_000,
    };
  }
}

function splitSystemMessage(messages: ChatMessage[]): {
  system: string | undefined;
  userMessages: ChatMessage[];
} {
  const systemMsg = messages.find((m) => m.role === 'system');
  const userMessages = messages.filter((m) => m.role !== 'system');
  return { system: systemMsg?.content, userMessages };
}
