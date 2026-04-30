import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { existsSync } from 'fs';
import type { QFlowConfig } from '../types.js';
import type { JiraTicket } from './jira-agent.types.js';
import { JiraAgent } from './jira-agent.js';
import { AzureDevOpsAgent } from './azure-devops-agent.js';
import type { TicketAgent } from './ticket-agent.js';
import type { NotificationAdapter } from '../adapters/notifications/base.js';
import type { RunReport, TestCase } from '../types.js';

export interface CoverageDriftResult {
  /** JIRA Done stories that have zero corresponding test files. */
  uncovered: JiraTicket[];
  /** Total Done stories checked. */
  total: number;
}

/**
 * Checks whether every "Done" JIRA story has at least one test file that
 * references its ticket key.
 *
 * Detection strategy (no AI, pure static):
 *   1. Fetch all Done stories from JIRA via JiraAgent.getDoneStories().
 *   2. Scan all test files under `testDir` for occurrences of each ticket key
 *      (e.g. "PROJ-123" in a comment, describe block, or file name).
 *   3. Report any stories with zero matches as "uncovered".
 */
export class CoverageDriftAgent {
  private readonly ticketAgent: TicketAgent;

  constructor(
    private readonly config: QFlowConfig,
    private readonly adapters: NotificationAdapter[] = [],
  ) {
    if (config.jira) {
      this.ticketAgent = new JiraAgent(config.jira);
    } else if (config.azureDevOps) {
      this.ticketAgent = new AzureDevOpsAgent(config.azureDevOps);
    } else {
      throw new Error('A ticket system (jira or azureDevOps) is required for coverage drift detection.');
    }
  }

  async check(cwd: string, testDir = 'tests'): Promise<CoverageDriftResult> {
    const project = (this.config.jira ?? this.config.azureDevOps)!.project;

    // 1. Fetch Done stories
    const { issues } = await this.ticketAgent.getDoneStories(project);
    if (issues.length === 0) {
      return { uncovered: [], total: 0 };
    }

    // 2. Build a single string of all test file content for fast scanning
    const corpus = await this.#buildTestCorpus(cwd, testDir);

    // 3. Filter stories with no mention in any test file
    const uncovered = issues.filter((ticket) => !corpus.includes(ticket.key));

    if (uncovered.length > 0) {
      await this.#notify(uncovered, issues.length);
    }

    return { uncovered, total: issues.length };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async #buildTestCorpus(cwd: string, testDir: string): Promise<string> {
    const dir = join(cwd, testDir);
    if (!existsSync(dir)) return '';

    const files: string[] = [];
    await walk(dir, cwd, files);

    const contents = await Promise.all(
      files.map(async (f) => {
        try {
          return await readFile(join(cwd, f), 'utf-8');
        } catch {
          return '';
        }
      }),
    );

    // Also include file names — a file named "proj-123.spec.ts" counts
    return [...files, ...contents].join('\n');
  }

  async #notify(uncovered: JiraTicket[], total: number): Promise<void> {
    const lines = uncovered
      .slice(0, 20)
      .map((t) => `• ${t.key}: ${t.summary}`);

    const message = [
      `⚠️  qflow coverage drift: ${uncovered.length}/${total} Done stories have no tests`,
      ...lines,
      uncovered.length > 20 ? `  … and ${uncovered.length - 20} more` : '',
    ]
      .filter(Boolean)
      .join('\n');

    console.warn(`\n[qflow] ${message}\n`);

    await Promise.allSettled(
      this.adapters.map((a) => a.send(buildDriftReport(uncovered), undefined)),
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function walk(dir: string, root: string, results: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, root, results);
      } else {
        results.push(relative(root, full).replace(/\\/g, '/'));
      }
    }),
  );
}

function buildDriftReport(uncovered: JiraTicket[]): RunReport {
  const tests: TestCase[] = uncovered.map((t) => ({
    name: `${t.key}: ${t.summary}`,
    fullName: t.key,
    status: 'failed' as const,
    duration: 0,
    error: 'No test file references this ticket key.',
  }));

  return {
    id: `coverage-drift-${Date.now()}`,
    timestamp: new Date().toISOString(),
    suite: 'coverage-drift',
    runner: 'qflow',
    passed: 0,
    failed: uncovered.length,
    skipped: 0,
    total: uncovered.length,
    duration: 0,
    tests,
  };
}
