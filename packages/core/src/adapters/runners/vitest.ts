import { execa } from 'execa';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { RunnerAdapter } from './base.js';
import type { RunnerConfig, RunOptions, RunReport, TestCase, TestStatus } from '../../types.js';

// Vitest's --reporter=json output uses the same shape as Jest's --json output
// for the fields we care about (testResults[].testResults[]).

interface VitestTestResult {
  fullName: string;
  status: string;
  duration?: number | null;
  failureMessages?: string[];
  title?: string;
}

interface VitestSuiteResult {
  testFilePath: string;
  testResults: VitestTestResult[];
}

interface VitestReport {
  success: boolean;
  startTime: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: VitestSuiteResult[];
}

export class VitestRunner implements RunnerAdapter {
  constructor(private readonly config: RunnerConfig = { type: 'vitest' }) {}

  async run(options: RunOptions): Promise<RunReport> {
    const { suite, cwd, env } = options;
    const resultsPath = join(cwd, '.qflow', 'vitest-results.json');

    mkdirSync(join(cwd, '.qflow'), { recursive: true });

    const args = ['vitest', 'run', '--reporter=json', `--outputFile=${resultsPath}`];

    if (this.config.workers !== undefined) {
      args.push(`--maxWorkers=${this.config.workers}`);
    }

    if (this.config.timeoutMs !== undefined) {
      args.push(`--testTimeout=${this.config.timeoutMs}`);
    }

    if (suite === 'smoke') {
      args.push('--testNamePattern', 'smoke');
    }

    if (options.tagPattern) {
      const idx = args.indexOf('--testNamePattern');
      if (idx >= 0) args.splice(idx, 2);
      args.push('--testNamePattern', options.tagPattern);
    }

    if (options.file) {
      args.push(options.file);
    }

    const startedAt = new Date().toISOString();

    const baseUrlEnv = this.config.baseUrl ? { BASE_URL: this.config.baseUrl } : {};

    await execa('npx', args, {
      cwd,
      env: { ...process.env, ...baseUrlEnv, ...this.config.env, ...env },
      reject: false,
    });

    let report: VitestReport;
    try {
      report = JSON.parse(await readFile(resultsPath, 'utf-8')) as VitestReport;
    } catch {
      throw new Error('Vitest did not write a JSON report. Ensure vitest is installed and configured.');
    }

    const tests: TestCase[] = report.testResults.flatMap((s) =>
      s.testResults.map((t) => {
        const status: TestStatus =
          t.status === 'passed' ? 'passed' : t.status === 'pending' || t.status === 'skipped' ? 'skipped' : 'failed';

        return {
          name: t.title ?? t.fullName,
          fullName: t.fullName,
          status,
          duration: t.duration ?? 0,
          file: s.testFilePath,
          error: t.failureMessages?.join('\n') || undefined,
        };
      }),
    );

    const total = report.numPassedTests + report.numFailedTests + report.numPendingTests;

    return {
      id: randomUUID(),
      timestamp: startedAt,
      suite,
      runner: 'vitest',
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      skipped: report.numPendingTests,
      total,
      duration: Date.now() - report.startTime,
      tests,
      commit: process.env.GITHUB_SHA,
      branch: process.env.GITHUB_REF_NAME,
      triggeredBy: process.env.CI ? 'ci' : 'manual',
    };
  }
}
