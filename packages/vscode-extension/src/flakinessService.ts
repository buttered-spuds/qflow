import type { RunStore } from './runStore';
import type { TestCase } from './types';

export interface FlakinessStat {
  fullName: string;
  file?: string;
  totalRuns: number;
  passes: number;
  failures: number;
  skips: number;
  /** Percentage 0-100. */
  flakinessPct: number;
  /** Most-recent status. */
  lastStatus?: TestCase['status'];
}

/**
 * Compute per-test flakiness across the most-recent N runs.
 *
 * Flakiness % = (failures / totalRuns) * 100  for tests that have BOTH passed
 * and failed in the window. Tests that always passed or always failed return
 * 0%.
 */
export function computeFlakiness(store: RunStore, windowSize: number): FlakinessStat[] {
  const recent = store.recentRuns(windowSize);
  if (recent.length === 0) return [];

  const stats = new Map<string, FlakinessStat>();

  // Iterate oldest -> newest so lastStatus reflects the most recent run.
  for (const { report } of [...recent].reverse()) {
    if (!report) continue;
    for (const t of report.tests) {
      const key = t.fullName || t.name;
      const existing = stats.get(key) ?? {
        fullName: key,
        file: t.file,
        totalRuns: 0,
        passes: 0,
        failures: 0,
        skips: 0,
        flakinessPct: 0,
      };
      existing.totalRuns++;
      if (t.status === 'passed') existing.passes++;
      else if (t.status === 'failed' || t.status === 'flaky') existing.failures++;
      else if (t.status === 'skipped') existing.skips++;
      existing.lastStatus = t.status;
      if (!existing.file && t.file) existing.file = t.file;
      stats.set(key, existing);
    }
  }

  for (const stat of stats.values()) {
    const hasBoth = stat.passes > 0 && stat.failures > 0;
    // Show intermittent flakiness as a percentage of failures.
    // Tests that consistently fail (no passes) also get their failure rate shown
    // so the view matches what the CLI quarantines.
    stat.flakinessPct = (hasBoth || stat.failures > 0)
      ? Math.round((stat.failures / stat.totalRuns) * 100)
      : 0;
  }

  return [...stats.values()].sort((a, b) => b.flakinessPct - a.flakinessPct);
}

/** Return flakiness stats keyed by `fullName` for fast O(1) lookup. */
export function flakinessIndex(stats: FlakinessStat[]): Map<string, FlakinessStat> {
  return new Map(stats.map((s) => [s.fullName, s]));
}
