import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { generateCommand } from './commands/generate.js';
import { dashboardCommand } from './commands/dashboard.js';
import { costsCommand } from './commands/costs.js';
import { flakinessCommand } from './commands/flakiness.js';
import { coverageCheckCommand } from './commands/coverage-check.js';
import { doctorCommand } from './commands/doctor.js';
import { healCommand } from './commands/heal.js';
import { watchCommand } from './commands/watch.js';
import { listCommand } from './commands/list.js';
import { recordCommand } from './commands/record.js';
import { replayCommand } from './commands/replay.js';
import { upgradeCommand } from './commands/upgrade.js';

const program = new Command();

program
  .name('qflow')
  .description('AI-orchestrated plug-and-play testing framework')
  .version('0.2.0');

program
  .command('init')
  .description('Interactive setup wizard — generates framework.config.ts and CI workflow')
  .action(() => initCommand());

program
  .command('run')
  .description('Run the test suite')
  .option('-s, --suite <suite>', 'Suite to run: regression | smoke | pr-smart', 'regression')
  .option('-l, --local', 'Skip all notifications and LLM calls (local/offline mode)', false)
  .option('-e, --env <name>', 'Apply an environment profile from framework.config.ts (environments.<name>)')
  .option('--file <path>', 'Run only the tests in a single file (relative path)')
  .action(runCommand);

program
  .command('generate')
  .description('Generate tests from a JIRA ticket or a free-text description')
  .option('-t, --ticket <key>', 'JIRA/ADO ticket key, e.g. PROJ-123')
  .option('-d, --description <text>', 'Free-text description (no ticket system required)')
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

program
  .command('doctor')
  .description('Diagnose your qflow setup — config, integrations, runner, secrets')
  .option('-q, --quick', 'Skip network checks (faster, local-only)', false)
  .action(doctorCommand);

program
  .command('heal')
  .description('Use the LLM to repair broken Playwright selectors from the latest run')
  .option('--apply', 'Write changes to disk (default: dry-run)', false)
  .option('--run-id <id>', 'Heal a specific run id (default: latest)')
  .action(healCommand);

program
  .command('watch')
  .description('Re-run the suite whenever source or test files change')
  .option('-s, --suite <suite>', 'Suite to run on each change', 'pr-smart')
  .option('-e, --env <name>', 'Environment profile to apply')
  .option('--paths <list>', 'Comma-separated dirs to watch', 'src,tests')
  .action(watchCommand);

program
  .command('list <target>')
  .description('List qflow assets — tests | suites | runs | tickets | page-objects | fixtures')
  .action(listCommand);

program
  .command('record [url]')
  .description('Launch Playwright codegen and save the recorded spec under tests/ui/')
  .option('-o, --output <path>', 'Output path for the generated spec')
  .action(recordCommand);

program
  .command('replay [runId]')
  .description('Re-run only the failed tests from a previous run (default: latest)')
  .action(replayCommand);

program
  .command('upgrade')
  .description('Bump @qflow/core and @qflow/cli in this project to their latest versions')
  .option('--dry-run', 'Print proposed bumps without modifying package.json', false)
  .action(upgradeCommand);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
