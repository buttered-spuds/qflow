import { OpenAIAdapter } from './openai.js';
import type { LLMAdapter } from './base.js';

/**
 * GitHub Copilot adapter.
 *
 * Uses the GitHub Copilot OpenAI-compatible endpoint:
 *   https://api.githubcopilot.com/chat/completions
 *
 * Authentication: a GitHub token with Copilot access.
 * In GitHub Actions this is always available as GITHUB_TOKEN — no separate
 * API key needs to be configured.
 *
 * Available models (as of 2026):
 *   gpt-4o, gpt-4o-mini, claude-3.5-sonnet, o1-mini, o3-mini
 *
 * Usage in framework.config.ts:
 *   llm: {
 *     provider: 'github-copilot',
 *     apiKey: process.env.GITHUB_TOKEN ?? '',
 *     model: 'gpt-4o',
 *   }
 *
 * In GitHub Actions the GITHUB_TOKEN secret is injected automatically —
 * no Secrets configuration required.
 */
export class GitHubCopilotAdapter extends OpenAIAdapter implements LLMAdapter {
  constructor(
    apiKey: string = process.env.GITHUB_TOKEN ?? '',
    model = 'gpt-4o',
  ) {
    if (!apiKey) {
      throw new Error(
        'GitHub Copilot adapter requires a GitHub token.\n' +
          'Set GITHUB_TOKEN in your environment, or pass apiKey explicitly.\n' +
          'In GitHub Actions, GITHUB_TOKEN is available automatically.',
      );
    }
    super(apiKey, model, 'https://api.githubcopilot.com');
  }
}
