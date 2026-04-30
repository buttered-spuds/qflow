import type { LLMAdapter, ChatMessage, Tool, ToolCallResult, TokenUsage } from './base.js';

// ─── OpenAI REST API types (partial) ─────────────────────────────────────────

interface OAIMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    function: { name: string; arguments: string };
  }>;
}

interface OAIResponse {
  choices: Array<{ message: OAIMessage; finish_reason: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// GPT-4o pricing (per 1M tokens, USD) — updated April 2026
const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10, output: 30 },
  default: { input: 5, output: 15 },
};

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class OpenAIAdapter implements LLMAdapter {
  private lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

  constructor(
    private readonly apiKey: string,
    private readonly model: string = 'gpt-4o',
    private readonly baseUrl: string = 'https://api.openai.com/v1',
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const data = await this.#request<OAIResponse>('/chat/completions', {
      model: this.model,
      messages,
    });

    this.#recordUsage(data.usage);
    return data.choices[0]?.message?.content ?? '';
  }

  async toolCall(messages: ChatMessage[], tools: Tool[]): Promise<ToolCallResult> {
    const oaiTools = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const data = await this.#request<OAIResponse>('/chat/completions', {
      model: this.model,
      messages,
      tools: oaiTools,
      tool_choice: 'required',
    });

    this.#recordUsage(data.usage);

    const call = data.choices[0]?.message?.tool_calls?.[0];
    if (!call) throw new Error('OpenAI returned no tool call');

    return {
      toolName: call.function.name,
      arguments: JSON.parse(call.function.arguments) as Record<string, unknown>,
    };
  }

  getLastUsage(): TokenUsage {
    return this.lastUsage;
  }

  async #request<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`);
    }

    return res.json() as Promise<T>;
  }

  #recordUsage(usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }): void {
    if (!usage) return;
    const pricing = PRICING[this.model] ?? PRICING.default;
    const cost =
      (usage.prompt_tokens / 1_000_000) * pricing.input +
      (usage.completion_tokens / 1_000_000) * pricing.output;

    this.lastUsage = {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCostUsd: Math.round(cost * 100_000) / 100_000,
    };
  }
}
