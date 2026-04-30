import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { generateCommand } from './commands/generate.js';
import { dashboardCommand } from './commands/dashboard.js';
import { costsCommand } from './commands/costs.js';
import { flakinessCommand } from './commands/flakiness.js';
import { coverageCheckCommand } from './commands/coverage-check.js';

const program = new Command();

program
  .name('qflow')
  .description('AI-orchestrated plug-and-play testing framework')
  .version('0.1.0');

program
  .command('init')
  .description('Interactive setup wizard — generates framework.config.ts and CI workflow')
  .action(initCommand);

program
  .command('run')
  .description('Run the test suite')
  .option('-s, --suite <suite>', 'Suite to run: regression | smoke | pr-smart', 'regression')
  .option('-l, --local', 'Skip all notifications and LLM calls (local/offline mode)', false)
  .action(runCommand);

program
  .command('generate')
  .description('Generate tests from a JIRA ticket (Phase 3)')
  .requiredOption('-t, --ticket <key>', 'JIRA ticket key, e.g. PROJ-123')
  .action(generateCommand);

program
  .command('dashboard')
  .description('Start the local dashboard server (reads .qflow/data/)')
  .option('-p, --port <port>', 'Port to listen on', '3000')
  .action(dashboardCommand);

program
  .command('costs')
  .description('Print LLM token usage and cost summary (Phase 3)')
  .action(costsCommand);

program
  .command('flakiness')
  .description('Print current flakiness and quarantine status (Phase 4)')
  .action(flakinessCommand);

program
  .command('coverage-check')
  .description('Check JIRA Done stories for missing test coverage (Phase 4)')
  .action(coverageCheckCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
