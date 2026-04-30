import chalk from 'chalk';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { loadConfig, SelfHealingAgent } from '@qflow/core';
import type { RunReport } from '@qflow/core';

interface HealOptions {
  apply?: boolean;
  runId?: string;
}

export async function healCommand(options: HealOptions): Promise<void> {
  const cwd = process.cwd();

  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  if (!config.llm) {
    console.error(chalk.red('\n  Error: llm config is required for `qflow heal`. Add it to framework.config.ts.\n'));
    process.exit(1);
  }

  const dataDir = join(cwd, '.qflow', 'data');
  if (!existsSync(dataDir)) {
    console.error(chalk.yellow('\n  No .qflow/data found. Run `qflow run` first.\n'));
    process.exit(1);
  }

  const report = await loadReport(dataDir, options.runId);
  if (!report) {
    console.error(chalk.yellow('\n  No matching run report found.\n'));
    process.exit(1);
  }

  const failed = (report.tests ?? []).filter((t) => t.status === 'failed');
  if (failed.length === 0) {
    console.log(chalk.green('\n  No failed tests in this run — nothing to heal.\n'));
    return;
  }

  console.log(chalk.bold.cyan(`\n  qflow heal`) + chalk.dim(` (${failed.length} failed test${failed.length === 1 ? '' : 's'})\n`));

  // Lazily build the LLM adapter via Orchestrator-style import to avoid leaking provider creds here
  const { createLLMAdapter } = await import('@qflow/core');
  const llm = createLLMAdapter(config.llm);
  const agent = new SelfHealingAgent(llm, options.apply === true && (config.selfHealing?.autoCommit ?? false));

  if (!options.apply) {
    console.log(chalk.dim('  (dry run — pass --apply to write changes)\n'));
  }

  const result = await agent.heal(failed, cwd);

  if (result.healed.length === 0) {
    console.log(chalk.yellow('  No healable selector errors found.\n'));
    return;
  }

  for (const h of result.healed) {
    console.log(`  ${chalk.bold(h.file)}`);
    console.log(`    test: ${chalk.dim(h.testName)}`);
    console.log(`    ${chalk.red('- ' + h.oldSelector)}`);
    console.log(`    ${chalk.green('+ ' + h.newSelector)}\n`);
  }

  if (options.apply) {
    console.log(chalk.green(`  ✓ Patched ${result.patchedFiles.length} file${result.patchedFiles.length === 1 ? '' : 's'}.\n`));
  } else {
    console.log(chalk.dim('  Dry run complete. Re-run with --apply to write changes.\n'));
  }
}

async function loadReport(dataDir: string, runId?: string): Promise<RunReport | null> {
  const files = (await readdir(dataDir)).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) return null;

  if (runId) {
    const match = files.find((f) => f.includes(runId));
    if (!match) return null;
    return JSON.parse(await readFile(join(dataDir, match), 'utf-8')) as RunReport;
  }

  const latest = files[files.length - 1];
  return JSON.parse(await readFile(join(dataDir, latest), 'utf-8')) as RunReport;
}
