import { describe, it, expect } from 'vitest';
import { computeFlakiness } from '../src/flakinessService';

// Mock RunStore — recentRuns() returns newest-first (matches real impl).
function mockStore(runsChronological: Array<{ tests: Array<{ name: string; fullName: string; status: 'passed' | 'failed' | 'skipped' | 'flaky'; duration: number; file?: string }> }>): any {
  const runs = [...runsChronological].reverse();
  return {
    recentRuns(_: number) {
      return runs.map((r, i) => ({ entry: { id: `r${i}`, timestamp: '', suite: 's', passed: 0, failed: 0, total: 0, file: '' }, report: { ...r, id: `r${i}`, timestamp: '', suite: 's', runner: 'p', passed: 0, failed: 0, skipped: 0, total: r.tests.length, duration: 0 } }));
    },
  };
}

describe('computeFlakiness', () => {
  it('returns 0% for tests that always pass', () => {
    const store = mockStore([
      { tests: [{ name: 'a', fullName: 'a', status: 'passed', duration: 1 }] },
      { tests: [{ name: 'a', fullName: 'a', status: 'passed', duration: 1 }] },
    ]);
    const stats = computeFlakiness(store, 10);
    expect(stats[0].flakinessPct).toBe(0);
  });

  it('returns >0% for tests that flip between pass and fail', () => {
    const store = mockStore([
      { tests: [{ name: 'a', fullName: 'a', status: 'passed', duration: 1 }] },
      { tests: [{ name: 'a', fullName: 'a', status: 'failed', duration: 1 }] },
      { tests: [{ name: 'a', fullName: 'a', status: 'passed', duration: 1 }] },
      { tests: [{ name: 'a', fullName: 'a', status: 'failed', duration: 1 }] },
    ]);
    const stats = computeFlakiness(store, 10);
    expect(stats[0].flakinessPct).toBe(50);
    expect(stats[0].lastStatus).toBe('failed');
  });

  it('sorts most-flaky first', () => {
    const store = mockStore([
      { tests: [
        { name: 'stable', fullName: 'stable', status: 'passed', duration: 1 },
        { name: 'flaky',  fullName: 'flaky',  status: 'passed', duration: 1 },
      ]},
      { tests: [
        { name: 'stable', fullName: 'stable', status: 'passed', duration: 1 },
        { name: 'flaky',  fullName: 'flaky',  status: 'failed', duration: 1 },
      ]},
    ]);
    const stats = computeFlakiness(store, 10);
    expect(stats[0].fullName).toBe('flaky');
    expect(stats[0].flakinessPct).toBeGreaterThan(0);
    expect(stats[1].flakinessPct).toBe(0);
  });
});
