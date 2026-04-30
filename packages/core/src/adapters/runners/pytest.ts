import { execa } from 'execa';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { RunnerAdapter } from './base.js';
import type { RunnerConfig, RunOptions, RunReport, TestCase, TestStatus } from '../../types.js';

// ─── pytest-json-report types (partial) ──────────────────────────────────────

interface PytestTest {
  nodeid: string;
  outcome: string;
  duration: number;
  call?: { longrepr?: string };
}

interface PytestReport {
  created: number;
  duration: number;
  exitcode: number;
  summary: { passed?: number; failed?: number; skipped?: number; total: number };
  tests: PytestTest[];
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class PytestRunner implements RunnerAdapter {
  constructor(private readonly config: RunnerConfig = { type: 'pytest' }) {}

  async run(options: RunOptions): Promise<RunReport> {
    const { suite, cwd, env } = options;
    const resultsPath = join(cwd, '.qflow', 'pytest-results.json');

    mkdirSync(join(cwd, '.qflow'), { recursive: true });

    const args = [
      '--tb=short',
      '--json-report',
      `--json-report-file=${resultsPath}`,
    ];

    if (this.config.workers !== undefined) {
      // requires pytest-xdist
      args.push('-n', String(this.config.workers));
    }

    if (this.config.timeoutMs !== undefined) {
      // requires pytest-timeout; pytest expects seconds
      args.push(`--timeout=${Math.ceil(this.config.timeoutMs / 1000)}`);
    }

    if (suite === 'smoke') {
      args.push('-m', 'smoke');
    }

    if (options.tagPattern) {
      const idx = args.indexOf('-m');
      if (idx >= 0) args.splice(idx, 2);
      args.push('-m', options.tagPattern);
    }

    const startedAt = new Date().toISOString();

    const baseUrlEnv = this.config.baseUrl ? { BASE_URL: this.config.baseUrl } : {};

    await execa('pytest', args, {
      cwd,
      env: { ...process.env, ...baseUrlEnv, ...this.config.env, ...env },
      reject: false,
    });

    let report: PytestReport;
    try {
      report = JSON.parse(await readFile(resultsPath, 'utf-8')) as PytestReport;
    } catch {
      throw new Error(
        'pytest did not write a JSON report. Ensure pytest-json-report is installed:\n  pip install pytest-json-report',
      );
    }

    const tests: TestCase[] = (report.tests ?? []).map((t) => {
      const status: TestStatus =
        t.outcome === 'passed'
          ? 'passed'
          : t.outcome === 'skipped'
            ? 'skipped'
            : 'failed';

      const parts = t.nodeid.split('::');
      const file = parts[0];
      const name = parts.slice(1).join(' > ');

      return {
        name,
        fullName: t.nodeid,
        status,
        duration: Math.round(t.duration * 1000),
        file,
        error: t.call?.longrepr ?? undefined,
      };
    });

    const passed = report.summary.passed ?? 0;
    const failed = report.summary.failed ?? 0;
    const skipped = report.summary.skipped ?? 0;

    return {
      id: randomUUID(),
      timestamp: startedAt,
      suite,
      runner: 'pytest',
      passed,
      failed,
      skipped,
      total: report.summary.total,
      duration: Math.round(report.duration * 1000),
      tests,
      commit: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      triggeredBy: process.env.CI ? 'ci' : 'manual',
    };
  }
}
