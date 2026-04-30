import type { LLMConfig } from '../../types.js';
import type { LLMAdapter } from './base.js';
import { OpenAIAdapter } from './openai.js';
import { AnthropicAdapter } from './anthropic.js';
import { AzureOpenAIAdapter } from './azure.js';
import { GeminiAdapter } from './gemini.js';
import { OllamaAdapter } from './ollama.js';
import { GitHubCopilotAdapter } from './github-copilot.js';

export { OpenAIAdapter } from './openai.js';
export { AnthropicAdapter } from './anthropic.js';
export { AzureOpenAIAdapter } from './azure.js';
export { GeminiAdapter } from './gemini.js';
export { OllamaAdapter } from './ollama.js';
export { GitHubCopilotAdapter } from './github-copilot.js';
export type { LLMAdapter, ChatMessage, Tool, ToolCallResult, TokenUsage } from './base.js';

export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  switch (config.provider) {
    case 'openai':
      return new OpenAIAdapter(config.apiKey, config.model);
    case 'anthropic':
      return new AnthropicAdapter(config.apiKey, config.model);
    case 'azure':
      return new AzureOpenAIAdapter(config);
    case 'gemini':
      return new GeminiAdapter(config.apiKey, config.model);
    case 'ollama':
      return new OllamaAdapter(config.model, config.baseUrl);
    case 'github-copilot':
      return new GitHubCopilotAdapter(config.apiKey, config.model);
    case 'custom':
      if (!config.baseUrl) {
        throw new Error('llm.baseUrl is required for custom LLM providers.');
      }
      return new OpenAIAdapter(config.apiKey, config.model, config.baseUrl);
  }
}
