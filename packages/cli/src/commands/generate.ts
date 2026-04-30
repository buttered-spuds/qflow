import chalk from 'chalk';
import { loadConfig, Orchestrator } from '@qflow/core';
import type { JiraTicket } from '@qflow/core';

interface GenerateOptions {
  ticket?: string;
  description?: string;
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const cwd = process.cwd();

  if (!options.ticket && !options.description) {
    console.error(chalk.red('  Error: provide --ticket <key> or --description <text>\n'));
    process.exit(1);
  }

  const label = options.ticket ?? 'manual';
  console.log(chalk.bold.cyan(`\n  qflow generate ${options.ticket ? `--ticket ${label}` : `--description "${options.description}"`}\n`));

  let config;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  if (!config.llm) {
    console.error(chalk.red('  Error: llm config is missing from framework.config.ts.'));
    console.error(chalk.dim('  Add an llm: { provider, apiKey, model } block and re-run.\n'));
    process.exit(1);
  }

  const orchestrator = new Orchestrator(config);

  let result;
  try {
    if (options.description) {
      // No ticket system — build a synthetic ticket from the description
      const syntheticTicket: JiraTicket = {
        key: 'LOCAL-1',
        summary: options.description!,
        description: options.description!,
        acceptanceCriteria: options.description!,
        labels: [],
        status: 'In Progress',
        issueType: 'Story',
      };
      console.log(chalk.dim('  Step 1/4  Building tests from description…'));
      result = await orchestrator.generateFromTicket(syntheticTicket, { cwd });
    } else {
      if (!config.jira && !config.azureDevOps) {
        console.error(chalk.red('  Error: no ticket system configured in framework.config.ts.'));
        console.error(chalk.dim('  Add jira or azureDevOps config, or use --description instead.\n'));
        process.exit(1);
      }
      console.log(chalk.dim(`  Step 1/4  Fetching ${options.ticket} from ticket system…`));
      result = await orchestrator.generate({ ticketKey: options.ticket!, cwd });
    }
  } catch (err) {
    console.error(chalk.red(`\n  Failed: ${err instanceof Error ? err.message : String(err)}\n`));
    process.exit(1);
  }

  console.log(chalk.dim('  Step 2/4  ') + chalk.green('Tests generated'));
  console.log(chalk.dim('  Step 3/4  ') + chalk.green(`Reviewer score: ${result.reviewScore}/10`));
  console.log(chalk.dim('  Step 4/4  ') + chalk.green('Draft PR opened'));

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
