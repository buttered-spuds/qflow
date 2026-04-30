import chalk from 'chalk';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { loadConfig } from '@qflow/core';
import type { RunReport } from '@qflow/core';

/**
 * Replays the failed tests from a previous run, by name, against the current code.
 * Only Playwright/Jest/Vitest support test-name filtering; for pytest we re-run by node id.
 */
export async function replayCommand(runId: string | undefined): Promise<void> {
  const cwd = process.cwd();

  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  const dir = join(cwd, '.qflow', 'data');
  if (!existsSync(dir)) {
    console.error(chalk.yellow('\n  No .qflow/data found. Run `qflow run` first.\n'));
    process.exit(1);
  }

  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    console.error(chalk.yellow('\n  No run reports found.\n'));
    process.exit(1);
  }

  const file = runId ? files.find((f) => f.includes(runId)) : files[files.length - 1];
  if (!file) {
    console.error(chalk.red(`\n  Run id "${runId}" not found.\n`));
    process.exit(1);
  }

  const report = JSON.parse(await readFile(join(dir, file), 'utf-8')) as RunReport;
  const failed = (report.tests ?? []).filter((t) => t.status === 'failed');

  if (failed.length === 0) {
    console.log(chalk.green('\n  No failed tests in this run — nothing to replay.\n'));
    return;
  }

  console.log(chalk.bold.cyan(`\n  qflow replay`) + chalk.dim(`  ${failed.length} failed test${failed.length === 1 ? '' : 's'} from run ${report.id.slice(0, 8)}\n`));

  const runner = config.runner.type;
  const args = buildArgs(runner, failed);
  if (!args) {
    console.error(chalk.red(`\n  Replay is not yet supported for runner type "${runner}".\n`));
    process.exit(1);
  }

  console.log(chalk.dim(`  $ ${args.join(' ')}\n`));
  const child = spawn(args[0], args.slice(1), { cwd, stdio: 'inherit' });
  await new Promise<void>((resolve) => child.on('exit', (code) => {
    process.exitCode = code ?? 0;
    resolve();
  }));
}

function buildArgs(runner: string, failed: Array<{ name: string; fullName: string; file?: string }>): string[] | null {
  const names = failed.map((t) => escapeRegex(t.name)).join('|');

  switch (runner) {
    case 'playwright':
      return ['npx', 'playwright', 'test', '--grep', names];
    case 'jest':
      return ['npx', 'jest', '--testNamePattern', names];
    case 'vitest':
      return ['npx', 'vitest', 'run', '--testNamePattern', names];
    case 'pytest': {
      const ids = failed.map((t) => t.fullName).filter(Boolean);
      return ['pytest', ...ids];
    }
    default:
      return null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
