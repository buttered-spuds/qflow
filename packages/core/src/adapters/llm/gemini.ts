import type { LLMAdapter, ChatMessage, Tool, ToolCallResult, TokenUsage } from './base.js';

// Gemini REST API shapes (subset)
interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: { temperature?: number; maxOutputTokens?: number };
  tools?: Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }>;
}

interface GeminiCandidate {
  content: { parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, unknown> } }> };
  finishReason: string;
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

// Pricing per 1M tokens (input/output averaged) — https://ai.google.dev/pricing
const PRICE_PER_1M: Record<string, number> = {
  'gemini-1.5-pro': 3.5,
  'gemini-1.5-flash': 0.35,
  'gemini-2.0-flash': 0.1,
};

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiAdapter implements LLMAdapter {
  private lastUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimatedCostUsd: 0 };

  constructor(
    private readonly apiKey: string,
    private readonly model = 'gemini-1.5-pro',
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const { system, contents } = convertMessages(messages);
    const body: GeminiRequest = { contents };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await this.#post('generateContent', body);
    this.#recordUsage(res);
    const text = res.candidates[0]?.content.parts[0]?.text ?? '';
    return text;
  }

  async toolCall(messages: ChatMessage[], tools: Tool[]): Promise<ToolCallResult> {
    const { system, contents } = convertMessages(messages);
    const body: GeminiRequest = {
      contents,
      tools: [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ],
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const res = await this.#post('generateContent', body);
    this.#recordUsage(res);

    for (const part of res.candidates[0]?.content.parts ?? []) {
      if (part.functionCall) {
        return { toolName: part.functionCall.name, arguments: part.functionCall.args };
      }
    }
    throw new Error('Gemini toolCall: no function call in response');
  }

  getLastUsage(): TokenUsage {
    return this.lastUsage;
  }

  async #post(method: string, body: GeminiRequest): Promise<GeminiResponse> {
    const url = `${BASE_URL}/models/${this.model}:${method}?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 300)}`);
    }

    return res.json() as Promise<GeminiResponse>;
  }

  #recordUsage(res: GeminiResponse): void {
    const u = res.usageMetadata ?? {};
    const prompt = u.promptTokenCount ?? 0;
    const completion = u.candidatesTokenCount ?? 0;
    const total = u.totalTokenCount ?? prompt + completion;
    const pricePerM = PRICE_PER_1M[this.model] ?? 3.5;
    const cost = (total / 1_000_000) * pricePerM;

    this.lastUsage = {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      estimatedCostUsd: cost,
    };
  }
}

function convertMessages(messages: ChatMessage[]): {
  system: string | null;
  contents: GeminiContent[];
} {
  let system: string | null = null;
  const contents: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      system = m.content;
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }

  return { system, contents };
}
