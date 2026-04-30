/**
 * Azure OpenAI adapter.
 * Azure uses the same request/response shape as OpenAI but with a different
 * base URL and API key header. We reuse the OpenAIAdapter with a custom baseUrl.
 *
 * Azure endpoint format:
 *   https://{resource}.openai.azure.com/openai/deployments/{deployment}/
 *
 * Usage:
 *   llm:
 *     provider: 'azure'
 *     apiKey: process.env.QFLOW_LLM_API_KEY!
 *     model: 'gpt-4o'        ← your deployment name
 *     baseUrl: 'https://my-resource.openai.azure.com/openai/deployments/gpt-4o'
 */
import { OpenAIAdapter } from './openai.js';
import type { LLMConfig } from '../../types.js';

export class AzureOpenAIAdapter extends OpenAIAdapter {
  constructor(config: LLMConfig) {
    if (!config.baseUrl) {
      throw new Error(
        'llm.baseUrl is required for Azure OpenAI.\n' +
          'Set it to: https://{resource}.openai.azure.com/openai/deployments/{deployment}',
      );
    }
    // Azure appends ?api-version=... — we pass the versioned path as baseUrl
    // and override the auth header to use api-key instead of Bearer
    const azureBaseUrl = config.baseUrl.replace(/\/$/, '');
    super(config.apiKey, config.model, `${azureBaseUrl}?api-version=2024-02-01`);
  }
}
