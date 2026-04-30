import chalk from 'chalk';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { RunReport } from '@qflow/core';
import { CostLedger } from '@qflow/core';

export async function costsCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow costs\n'));

  const cwd = process.cwd();

  // ── LLM cost ledger ─────────────────────────────────────────────────────────
  const dbPath = join(cwd, '.qflow', 'costs.jsonl');
  if (existsSync(dbPath)) {
    const ledger = new CostLedger(cwd);
    await ledger.open();

    const summary = ledger.summary();
    const recent = ledger.recent(10);
    ledger.close();

    if (summary.length > 0) {
      console.log(chalk.bold('  LLM token usage by model\n'));
      console.log(
        `  ${'Provider'.padEnd(14)} ${'Model'.padEnd(22)} ${'Calls'.padEnd(8)} ${'Tokens'.padEnd(12)} ${'Cost (USD)'}`,
      );
      console.log(`  ${'-'.repeat(70)}`);
      let totalCost = 0;
      for (const row of summary) {
        totalCost += row.totalCostUsd;
        console.log(
          `  ${row.provider.padEnd(14)} ${row.model.padEnd(22)} ${String(row.calls).padEnd(8)} ${String(row.totalTokens).padEnd(12)} $${row.totalCostUsd.toFixed(4)}`,
        );
      }
      console.log(`  ${'-'.repeat(70)}`);
      console.log(`  ${''.padEnd(14)} ${'Total'.padEnd(22)} ${''.padEnd(8)} ${''.padEnd(12)} ${chalk.bold('$' + totalCost.toFixed(4))}\n`);

      if (recent.length > 0) {
        console.log(chalk.bold('  Recent LLM calls\n'));
        for (const row of recent) {
          const ts = new Date(row.timestamp).toLocaleString();
          console.log(`  ${chalk.dim(ts)}  ${row.command.padEnd(14)} ${row.model}  ${row.totalTokens} tokens  $${row.estimatedCostUsd.toFixed(4)}`);
        }
        console.log('');
      }
    } else {
      console.log(chalk.dim('  No LLM usage recorded yet. Run: npx qflow generate --ticket PROJ-123\n'));
    }
  } else {
    console.log(chalk.dim('  No LLM cost data yet. Run: npx qflow generate --ticket PROJ-123\n'));
  }

  // ── Run summary ─────────────────────────────────────────────────────────────
  const dataDir = join(cwd, '.qflow', 'data');
  if (!existsSync(dataDir)) return;

  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json'));
  if (!files.length) return;

  const runs: RunReport[] = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(join(dataDir, f), 'utf-8')) as RunReport),
  );

  const totalRuns = runs.length;
  const totalPassed = runs.reduce((s, r) => s + r.passed, 0);
  const totalFailed = runs.reduce((s, r) => s + r.failed, 0);
  const totalTests = runs.reduce((s, r) => s + r.total, 0);

  console.log(chalk.bold('  Test run summary\n'));
  console.log(`  Runs recorded:  ${chalk.bold(totalRuns)}`);
  console.log(`  Total tests:    ${chalk.bold(totalTests)}`);
  console.log(`  Total passed:   ${chalk.green(totalPassed)}`);
  console.log(`  Total failed:   ${totalFailed > 0 ? chalk.red(totalFailed) : chalk.dim('0')}`);

  const recent = runs
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);

  console.log(chalk.bold('\n  Recent runs\n'));
  for (const run of recent) {
    const status = run.failed > 0 ? chalk.red('FAIL') : chalk.green('PASS');
    console.log(
      `  ${status}  ${chalk.dim(new Date(run.timestamp).toLocaleString())}  ${run.suite}  ${run.passed}/${run.total}`,
    );
  }
  console.log('');
}

