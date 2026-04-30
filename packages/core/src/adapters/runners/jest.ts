import { execa } from 'execa';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import type { RunnerAdapter } from './base.js';
import type { RunOptions, RunReport, TestCase, TestStatus } from '../../types.js';

// ─── Jest --json output types (partial) ──────────────────────────────────────

interface JestTestResult {
  fullName: string;
  status: string;
  duration?: number | null;
  failureMessages?: string[];
  ancestorTitles?: string[];
  title?: string;
}

interface JestSuiteResult {
  testFilePath: string;
  testResults: JestTestResult[];
}

interface JestReport {
  success: boolean;
  startTime: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: JestSuiteResult[];
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class JestRunner implements RunnerAdapter {
  async run(options: RunOptions): Promise<RunReport> {
    const { suite, cwd, env } = options;
    const resultsPath = join(cwd, '.qflow', 'jest-results.json');

    mkdirSync(join(cwd, '.qflow'), { recursive: true });

    const args = ['jest', '--json', `--outputFile=${resultsPath}`];

    if (suite === 'smoke') {
      args.push('--testPathPattern=smoke');
    }

    const startedAt = new Date().toISOString();

    await execa('npx', args, {
      cwd,
      env: { ...process.env, ...env },
      reject: false,
    });

    let report: JestReport;
    try {
      report = JSON.parse(await readFile(resultsPath, 'utf-8')) as JestReport;
    } catch {
      throw new Error('Jest did not write a JSON report. Ensure jest is installed and configured.');
    }

    const tests: TestCase[] = report.testResults.flatMap((suite) =>
      suite.testResults.map((t) => {
        const status: TestStatus =
          t.status === 'passed' ? 'passed' : t.status === 'pending' ? 'skipped' : 'failed';

        return {
          name: t.title ?? t.fullName,
          fullName: t.fullName,
          status,
          duration: t.duration ?? 0,
          file: suite.testFilePath,
          error: t.failureMessages?.join('\n') || undefined,
        };
      }),
    );

    const total = report.numPassedTests + report.numFailedTests + report.numPendingTests;

    return {
      id: randomUUID(),
      timestamp: startedAt,
      suite,
      runner: 'jest',
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
