import { execa } from 'execa';
import { randomUUID } from 'crypto';
import type { RunnerAdapter } from './base.js';
import type { RunnerConfig, RunOptions, RunReport } from '../../types.js';

/**
 * Runs an arbitrary shell command and captures exit code + output.
 * Produces a minimal RunReport: no individual test breakdown, just pass/fail.
 * For richer results, use a native runner adapter (playwright, pytest, jest).
 */
export class CustomRunner implements RunnerAdapter {
  constructor(
    private readonly command: string,
    private readonly config: RunnerConfig = { type: 'custom' },
  ) {}

  async run(options: RunOptions): Promise<RunReport> {
    const { suite, cwd, env } = options;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    const [cmd, ...args] = this.command.split(' ');
    const baseUrlEnv = this.config.baseUrl ? { BASE_URL: this.config.baseUrl } : {};

    const result = await execa(cmd, args, {
      cwd,
      env: { ...process.env, ...baseUrlEnv, ...this.config.env, ...env },
      reject: false,
    });

    const duration = Date.now() - startMs;
    const passed = result.exitCode === 0 ? 1 : 0;
    const failed = result.exitCode !== 0 ? 1 : 0;

    return {
      id: randomUUID(),
      timestamp: startedAt,
      suite,
      runner: 'custom',
      passed,
      failed,
      skipped: 0,
      total: 1,
      duration,
      tests: [
        {
          name: 'custom command',
          fullName: this.command,
          status: result.exitCode === 0 ? 'passed' : 'failed',
          duration,
          error: result.exitCode !== 0 ? result.stderr || result.stdout : undefined,
        },
      ],
      commit: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      triggeredBy: process.env.CI ? 'ci' : 'manual',
    };
  }
}
