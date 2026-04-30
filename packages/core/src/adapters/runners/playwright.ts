import { execa } from 'execa';
import { randomUUID } from 'crypto';
import type { RunnerAdapter } from './base.js';
import type { RunnerConfig, RunOptions, RunReport, TestCase } from '../../types.js';

// ─── Playwright JSON reporter types (partial) ─────────────────────────────────

interface PWSpec {
  title: string;
  ok: boolean;
  file?: string;
  tests: Array<{
    results: Array<{
      status: string;
      duration: number;
      error?: { message?: string };
    }>;
  }>;
}

interface PWSuite {
  title: string;
  file?: string;
  suites?: PWSuite[];
  specs?: PWSpec[];
}

interface PWReport {
  suites: PWSuite[];
  stats: {
    startTime: string;
    duration: number;
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectSpecs(suite: PWSuite, filePath: string = ''): TestCase[] {
  const file = suite.file ?? filePath;
  const tests: TestCase[] = [];

  for (const spec of suite.specs ?? []) {
    const result = spec.tests[0]?.results[0];
    const rawStatus = result?.status ?? 'skipped';
    const status =
      rawStatus === 'passed'
        ? 'passed'
        : rawStatus === 'skipped'
          ? 'skipped'
          : rawStatus === 'flaky'
            ? 'flaky'
            : 'failed';

    tests.push({
      name: spec.title,
      fullName: `${file} > ${spec.title}`,
      status,
      duration: result?.duration ?? 0,
      file,
      error: result?.error?.message,
    });
  }

  for (const child of suite.suites ?? []) {
    tests.push(...collectSpecs(child, file || suite.title));
  }

  return tests;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class PlaywrightRunner implements RunnerAdapter {
  constructor(private readonly config: RunnerConfig = { type: 'playwright' }) {}

  async run(options: RunOptions): Promise<RunReport> {
    const { suite, cwd, env } = options;

    const args = ['playwright', 'test', '--reporter=json'];

    if (this.config.configFile) {
      args.push('--config', this.config.configFile);
    }

    if (this.config.workers !== undefined) {
      args.push('--workers', String(this.config.workers));
    }

    if (this.config.retries !== undefined) {
      args.push('--retries', String(this.config.retries));
    }

    if (this.config.timeoutMs !== undefined) {
      args.push('--timeout', String(this.config.timeoutMs));
    }

    if (suite === 'smoke') {
      args.push('--grep', '@smoke');
    }

    if (options.tagPattern) {
      // Replace the default smoke filter when an explicit tag pattern is supplied.
      const idx = args.indexOf('--grep');
      if (idx >= 0) args.splice(idx, 2);
      args.push('--grep', options.tagPattern);
    }

    // pr-smart falls back to full run in Phase 1 (smart selection is Phase 4)

    const startedAt = Date.now();

    const baseUrlEnv = this.config.baseUrl
      ? { PLAYWRIGHT_BASE_URL: this.config.baseUrl, BASE_URL: this.config.baseUrl }
      : {};

    const result = await execa('npx', args, {
      cwd,
      env: { ...process.env, ...baseUrlEnv, ...this.config.env, ...env },
      reject: false,
      all: false,
    });

    const duration = Date.now() - startedAt;

    let report: PWReport;
    try {
      report = JSON.parse(result.stdout) as PWReport;
    } catch {
      throw new Error(
        `Playwright did not output valid JSON.\nstdout: ${result.stdout.slice(0, 500)}\nstderr: ${result.stderr.slice(0, 500)}`,
      );
    }

    const tests: TestCase[] = report.suites.flatMap((s) => collectSpecs(s));
    const passed = tests.filter((t) => t.status === 'passed').length;
    const failed = tests.filter((t) => t.status === 'failed').length;
    const skipped = tests.filter((t) => t.status === 'skipped' || t.status === 'flaky').length;

    return {
      id: randomUUID(),
      timestamp: report.stats.startTime ?? new Date().toISOString(),
      suite,
      runner: 'playwright',
      passed,
      failed,
      skipped,
      total: tests.length,
      duration: report.stats.duration ?? duration,
      tests,
      commit: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      triggeredBy: process.env.CI ? 'ci' : 'manual',
    };
  }
}
