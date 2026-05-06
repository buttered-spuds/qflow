import chalk from 'chalk';
import { loadConfig, Orchestrator } from '@qflow/core';
import type { RunReport } from '@qflow/core';

interface RunOptions {
  suite: string;
  local: boolean;
  env?: string;
  file?: string;
  grep?: string;
}

export async function runCommand(options: RunOptions): Promise<void> {
  const { suite, local, env: envName, file, grep } = options;
  const cwd = process.cwd();

  // Load and validate config
  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`\n  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  // Apply --env profile overrides on top of runner config
  if (envName) {
    const profile = config.environments?.[envName];
    if (!profile) {
      console.error(
        chalk.red(`\n  Error: --env "${envName}" is not defined in framework.config.ts under environments.\n`),
      );
      process.exit(1);
    }
    if (profile.baseUrl) config.runner.baseUrl = profile.baseUrl;
    if (profile.env) config.runner.env = { ...config.runner.env, ...profile.env };
  }

  console.log(
    chalk.bold.cyan(`\n  qflow run`) +
      chalk.dim(` --suite ${suite}${local ? ' --local' : ''}${envName ? ` --env ${envName}` : ''}\n`),
  );
  console.log(chalk.dim(`  Runner: ${config.runner.type}`));
  console.log(chalk.dim(`  Suite:  ${suite}\n`));

  const orchestrator = new Orchestrator(config);
  let report: RunReport;

  try {
    report = await orchestrator.run({ suite, local, cwd, file, grep });
  } catch (err) {
    console.error(chalk.red(`\n  Run failed: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  printReport(report, local);

  if (report.failed > 0) {
    process.exit(1);
  }
}

function printReport(report: RunReport, local: boolean): void {
  const duration = formatDuration(report.duration);

  console.log(chalk.bold('  Results\n'));

  for (const test of report.tests) {
    const icon =
      test.status === 'passed'
        ? chalk.green('  ✓')
        : test.status === 'skipped'
          ? chalk.yellow('  –')
          : chalk.red('  ✗');

    const name = test.file ? chalk.dim(`${test.file} › `) + test.name : test.name;
    const dur = chalk.dim(` (${test.duration}ms)`);
    console.log(`${icon} ${name}${dur}`);

    if (test.error) {
      const indented = test.error
        .split('\n')
        .slice(0, 5)
        .map((l) => chalk.red(`      ${l}`))
        .join('\n');
      console.log(indented);
    }
  }

  console.log('');

  const passLabel = chalk.green(`${report.passed} passed`);
  const failLabel = report.failed > 0 ? chalk.red(`, ${report.failed} failed`) : '';
  const skipLabel = report.skipped > 0 ? chalk.yellow(`, ${report.skipped} skipped`) : '';

  console.log(`  ${passLabel}${failLabel}${skipLabel} ${chalk.dim(`(${duration})`)}\n`);

  if (report.failed > 0) {
    console.log(chalk.red('  Some tests failed.\n'));
  } else {
    console.log(chalk.green('  All tests passed.\n'));
  }

  console.log(chalk.dim(`  Run ID: ${report.id}`));
  console.log(chalk.dim(`  Saved:  .qflow/data/`));
  if (!local) {
    console.log(chalk.dim(`  Dashboard: npx qflow dashboard\n`));
  } else {
    console.log('');
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}
