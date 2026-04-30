import chalk from 'chalk';
import { loadConfig, Orchestrator } from '@qflow/core';

interface GenerateOptions {
  ticket: string;
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const cwd = process.cwd();
  console.log(chalk.bold.cyan(`\n  qflow generate --ticket ${options.ticket}\n`));

  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  if (!config.jira) {
    console.error(chalk.red('  Error: jira config is missing from framework.config.ts.'));
    console.error(chalk.dim('  Add a jira: { url, token, project } block and re-run.\n'));
    process.exit(1);
  }

  if (!config.llm) {
    console.error(chalk.red('  Error: llm config is missing from framework.config.ts.'));
    console.error(chalk.dim('  Add an llm: { provider, apiKey, model } block and re-run.\n'));
    process.exit(1);
  }

  const orchestrator = new Orchestrator(config);

  console.log(chalk.dim(`  Step 1/4  Fetching ${options.ticket} from JIRA…`));

  let result;
  try {
    result = await orchestrator.generate({
      ticketKey: options.ticket,
      cwd,
    });
  } catch (err) {
    console.error(chalk.red(`\n  Failed: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  console.log(chalk.dim(`  Step 2/4  `) + chalk.green(`Tests generated`));
  console.log(chalk.dim(`  Step 3/4  `) + chalk.green(`Reviewer score: ${result.reviewScore}/10`));
  console.log(chalk.dim(`  Step 4/4  `) + chalk.green(`Draft PR opened`));

  console.log(`\n  ${chalk.bold('Draft PR:')} ${chalk.cyan(result.prUrl)}`);
  console.log(`\n  ${chalk.bold('Files written:')}`);
  for (const file of result.filesWritten) {
    console.log(`    ${chalk.dim('+')} ${file}`);
  }

  if (result.reviewFeedback) {
    console.log(`\n  ${chalk.bold('Reviewer feedback:')}`);
    console.log(`  ${chalk.dim(result.reviewFeedback)}`);
  }

  console.log(`\n  JIRA ticket ${options.ticket} updated with PR link.\n`);
}
