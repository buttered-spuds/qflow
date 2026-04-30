import chalk from 'chalk';
import { loadConfig, Orchestrator } from '@qflow/core';

export async function coverageCheckCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow coverage-check\n'));

  const cwd = process.cwd();
  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  if (!config.jira) {
    console.error(chalk.red('  Error: jira config is required for coverage drift detection.'));
    console.error(chalk.dim('  Add jira: { url, token, project } to framework.config.ts\n'));
    process.exit(1);
  }

  const orchestrator = new Orchestrator(config);

  console.log(chalk.dim(`  Fetching Done stories from JIRA project ${config.jira.project}…`));

  let result;
  try {
    result = await orchestrator.coverageCheck(cwd);
  } catch (err) {
    console.error(chalk.red(`\n  Failed: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  if (result.uncovered.length === 0) {
    console.log(chalk.green(`  All ${result.total} Done stories have test coverage.\n`));
    return;
  }

  console.log(
    chalk.yellow(
      `  ${result.uncovered.length}/${result.total} stories have no test coverage:\n`,
    ),
  );

  for (const ticket of result.uncovered) {
    console.log(`    ${chalk.yellow('⚠')} ${chalk.bold(ticket.key)}  ${ticket.summary}`);
  }

  console.log(
    chalk.dim(
      '\n  Tip: add the ticket key (e.g. PROJ-123) to a test describe/it block or file name.\n',
    ),
  );

  // Exit 1 so CI can catch drift
  process.exit(1);
}
