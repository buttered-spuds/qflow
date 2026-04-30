import { OpenAIAdapter } from './openai.js';
import type { LLMAdapter } from './base.js';

/**
 * Ollama adapter — wraps OpenAIAdapter since Ollama exposes an
 * OpenAI-compatible `/v1` endpoint when started with `OLLAMA_HOST`.
 *
 * Default base URL: http://localhost:11434/v1
 * No API key required (pass empty string).
 *
 * Usage:
 *   llm:
 *     provider: ollama
 *     apiKey: ''          # ignored by Ollama
 *     model: llama3.2
 *     baseUrl: http://localhost:11434/v1   # optional, this is the default
 */
export class OllamaAdapter extends OpenAIAdapter implements LLMAdapter {
  constructor(
    model = 'llama3.2',
    baseUrl = 'http://localhost:11434/v1',
  ) {
    // Ollama does not require an API key
    super('ollama', model, baseUrl);
  }
}
