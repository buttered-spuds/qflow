import { existsSync } from 'fs';
import { join } from 'path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import type { QFlowConfig } from './types.js';

// ─── Zod schema ───────────────────────────────────────────────────────────────

const RunnerConfigSchema = z.object({
  type: z.enum(['playwright', 'pytest', 'jest', 'custom']),
  configFile: z.string().optional(),
  command: z.string().optional(),
  outputDir: z.string().optional(),
});

const QFlowConfigSchema = z.object({
  runner: RunnerConfigSchema,
  jira: z
    .object({
      url: z.string().url(),
      token: z.string().min(1),
      project: z.string().min(1),
    })
    .optional(),
  azureDevOps: z
    .object({
      orgUrl: z.string().url(),
      token: z.string().min(1),
      project: z.string().min(1),
    })
    .optional(),
  llm: z
    .object({
      provider: z.enum(['openai', 'anthropic', 'azure', 'gemini', 'ollama', 'github-copilot', 'custom']),
      apiKey: z.string(),
      model: z.string().min(1),
      baseUrl: z.string().url().optional(),
    })
    .optional(),
  notifications: z
    .object({
      slack: z.object({ webhookUrl: z.string().url() }).optional(),
      teams: z.object({ webhookUrl: z.string().url() }).optional(),
      jira: z.object({ writeResults: z.boolean() }).optional(),
    })
    .optional(),
  dashboard: z
    .object({
      githubPages: z.boolean().optional(),
      branch: z.string().optional(),
      repoOwner: z.string().optional(),
      repoName: z.string().optional(),
    })
    .optional(),
  flakiness: z
    .object({
      quarantineThreshold: z.number().min(0).max(1).optional(),
      historyDepth: z.number().int().positive().optional(),
    })
    .optional(),
  smartSelection: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
  selfHealing: z
    .object({
      autoCommit: z.boolean().optional(),
    })
    .optional(),
});

// ─── Loader ───────────────────────────────────────────────────────────────────

export async function loadConfig(cwd: string = process.cwd()): Promise<QFlowConfig> {
  const candidates = [
    join(cwd, 'framework.config.ts'),
    join(cwd, 'framework.config.js'),
    join(cwd, 'framework.config.mjs'),
  ];

  const configPath = candidates.find((p) => existsSync(p));

  if (!configPath) {
    throw new Error(
      'No framework.config.ts found in the current directory.\n' +
        'Run: npx qflow init',
    );
  }

  const jiti = createJiti(import.meta.url);
  const mod = (await jiti.import(configPath, { default: true })) as unknown;
  const raw = mod && typeof mod === 'object' && 'default' in mod ? (mod as { default: unknown }).default : mod;

  const result = QFlowConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid framework.config.ts:\n${issues}`);
  }

  return result.data as QFlowConfig;
}
