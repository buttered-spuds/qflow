import chalk from 'chalk';
import { loadConfig, FlakinessAgent } from '@qflow/core';

export async function flakinessCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow flakiness\n'));

  const cwd = process.cwd();
  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  const agent = new FlakinessAgent(config);
  const result = await agent.analyse(cwd);

  if (result.quarantined.length === 0) {
    console.log(chalk.green('  No flaky tests detected.\n'));
    return;
  }

  if (result.newlyQuarantined.length > 0) {
    console.log(chalk.red(`  ${result.newlyQuarantined.length} newly quarantined:\n`));
    for (const name of result.newlyQuarantined) {
      console.log(`    ${chalk.red('✗')} ${name}`);
    }
    console.log('');
  }

  if (result.alreadyQuarantined.length > 0) {
    console.log(chalk.yellow(`  ${result.alreadyQuarantined.length} still quarantined:\n`));
    for (const name of result.alreadyQuarantined) {
      console.log(`    ${chalk.yellow('⚠')} ${name}`);
    }
    console.log('');
  }

  console.log(
    chalk.dim(
      `  Threshold: ${(config.flakiness?.quarantineThreshold ?? 0.2) * 100}%  |  History depth: ${config.flakiness?.historyDepth ?? 10} runs\n`,
    ),
  );
}
