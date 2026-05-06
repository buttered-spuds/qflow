import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync, readFileSync as readFileSyncNode } from 'fs';
import type { QFlowConfig, RunReport, TestCase } from '../types.js';
import type { NotificationAdapter } from '../adapters/notifications/base.js';

export interface FlakinessResult {
  newlyQuarantined: string[];
  alreadyQuarantined: string[];
  /** Full updated quarantine list. */
  quarantined: string[];
}

interface TestHistory {
  fullName: string;
  failures: number;
  runs: number;
  rate: number;
}

/**
 * Compares the latest RunReport against historical runs to detect flaky tests.
 *
 * A test is considered flaky when its failure rate across the last `historyDepth`
 * runs exceeds `quarantineThreshold` (default 0.2 = 20%).
 *
 * The quarantine list is stored in the manifest so the dashboard and CI runner
 * can mark quarantined tests as non-blocking.
 */
export class FlakinessAgent {
  private readonly threshold: number;
  private readonly historyDepth: number;

  constructor(
    private readonly config: QFlowConfig,
    private readonly adapters: NotificationAdapter[] = [],
  ) {
    this.threshold = config.flakiness?.quarantineThreshold ?? 0.2;
    this.historyDepth = config.flakiness?.historyDepth ?? 10;
  }

  /**
   * Analyse `cwd/.qflow/data/*.json` and return the updated quarantine state.
   * Fires notification adapters if new tests are quarantined.
   */
  async analyse(cwd: string): Promise<FlakinessResult> {
    const runs = await this.#loadRuns(cwd);
    if (runs.length === 0) {
      return { newlyQuarantined: [], alreadyQuarantined: [], quarantined: [] };
    }

    const existing = this.#loadQuarantineList(cwd);
    const history = this.#buildHistory(runs);
    const nowFlaky = history
      .filter((h) => h.rate >= this.threshold)
      .map((h) => h.fullName);

    const newlyQuarantined = nowFlaky.filter((n) => !existing.has(n));
    const alreadyQuarantined = nowFlaky.filter((n) => existing.has(n));

    const quarantined = Array.from(new Set([...existing, ...nowFlaky]));

    if (newlyQuarantined.length > 0) {
      await this.#notify(newlyQuarantined, history, cwd);
    }

    return { newlyQuarantined, alreadyQuarantined, quarantined };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  async #loadRuns(cwd: string): Promise<RunReport[]> {
    const dir = join(cwd, '.qflow', 'data');
    if (!existsSync(dir)) return [];

    const files = (await readdir(dir))
      .filter((f) => f.startsWith('run-') && f.endsWith('.json'))
      .sort() // chronological by filename timestamp
      .slice(-this.historyDepth);

    const runs: RunReport[] = [];
    for (const f of files) {
      try {
        const raw = await readFile(join(dir, f), 'utf-8');
        runs.push(JSON.parse(raw) as RunReport);
      } catch {
        // Skip corrupt files
      }
    }
    return runs;
  }

  #loadQuarantineList(cwd: string): Set<string> {
    const manifestPath = join(cwd, '.qflow', 'data', 'manifest.json');
    if (!existsSync(manifestPath)) return new Set();
    try {
      const raw = JSON.parse(readFileSyncNode(manifestPath, 'utf-8')) as {
        quarantined?: string[];
      };
      return new Set(raw.quarantined ?? []);
    } catch {
      return new Set();
    }
  }

  #buildHistory(runs: RunReport[]): TestHistory[] {
    // Aggregate per fullName
    const map = new Map<string, { failures: number; runs: number }>();

    for (const run of runs) {
      const seen = new Set<string>();
      for (const test of run.tests) {
        if (seen.has(test.fullName)) continue;
        seen.add(test.fullName);

        const entry = map.get(test.fullName) ?? { failures: 0, runs: 0 };
        entry.runs += 1;
        if (test.status === 'failed' || test.status === 'flaky') entry.failures += 1;
        map.set(test.fullName, entry);
      }
    }

    return Array.from(map.entries())
      .map(([fullName, { failures, runs }]) => ({
        fullName,
        failures,
        runs,
        rate: runs > 0 ? failures / runs : 0,
      }))
      .filter((h) => h.runs >= 2); // Need at least 2 data points
  }

  async #notify(
    newlyQuarantined: string[],
    history: TestHistory[],
    _cwd: string,
  ): Promise<void> {
    const historyMap = new Map(history.map((h) => [h.fullName, h]));

    const lines = newlyQuarantined.map((name) => {
      const h = historyMap.get(name);
      const pct = h ? `${Math.round(h.rate * 100)}%` : '?%';
      return `• ${name} (fail rate: ${pct})`;
    });

    const message = [
      `🔴 qflow quarantined ${newlyQuarantined.length} flaky test(s):`,
      ...lines,
      '',
      'These tests are now non-blocking in CI. Review and fix them.',
    ].join('\n');

    await Promise.allSettled(
      this.adapters.map((a) =>
        a.send(
          // Minimal RunReport-like shape for the notification channel
          buildFlakinessReport(newlyQuarantined, historyMap),
          undefined,
        ),
      ),
    );

    // Fallback: always log to console
    console.warn(`\n[qflow] ${message}\n`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildFlakinessReport(
  quarantined: string[],
  historyMap: Map<string, TestHistory>,
): RunReport {
  const tests: TestCase[] = quarantined.map((name) => ({
    name,
    fullName: name,
    status: 'flaky' as const,
    duration: 0,
    error: `Quarantined — fail rate: ${Math.round((historyMap.get(name)?.rate ?? 0) * 100)}%`,
  }));

  return {
    id: `flakiness-${Date.now()}`,
    timestamp: new Date().toISOString(),
    suite: 'flakiness-report',
    runner: 'qflow',
    passed: 0,
    failed: 0,
    skipped: 0,
    total: quarantined.length,
    duration: 0,
    tests,
  };
}
