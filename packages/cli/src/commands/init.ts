import { select, input, password, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import { writeFile, mkdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

const PHASE_NOTE = '(can be added later)';

export async function initCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow init\n'));
  console.log('This wizard will create framework.config.ts in the current directory.\n');

  const cwd = process.cwd();

  // ─── Runner ────────────────────────────────────────────────────────────────

  const runnerType = await select({
    message: 'Which test runner does this project use?',
    choices: [
      { name: 'Playwright (UI + API)', value: 'playwright' },
      { name: 'pytest', value: 'pytest' },
      { name: 'Jest', value: 'jest' },
      { name: 'Custom command', value: 'custom' },
    ],
  });

  let runnerConfigFile: string | undefined;
  let runnerCommand: string | undefined;

  if (runnerType === 'playwright') {
    runnerConfigFile = await input({
      message: 'Playwright config file path:',
      default: 'playwright.config.ts',
    });
  }

  if (runnerType === 'custom') {
    runnerCommand = await input({
      message: 'Shell command to run tests (e.g. npm test):',
    });
  }

  // ─── Ticket system ─────────────────────────────────────────────────────────

  const ticketSystem = await select({
    message: `Ticket system: ${PHASE_NOTE}`,
    choices: [
      { name: 'JIRA Cloud / Server', value: 'jira' },
      { name: 'Azure DevOps', value: 'azure-devops' },
      { name: 'None', value: 'none' },
    ],
  });

  let jiraUrl = '';
  let jiraProject = '';
  let adoOrgUrl = '';
  let adoProject = '';
  const configureJira = ticketSystem === 'jira';
  const configureAdo = ticketSystem === 'azure-devops';

  if (configureJira) {
    jiraUrl = await input({ message: 'JIRA base URL (e.g. https://your-org.atlassian.net):' });
    jiraProject = await input({ message: 'JIRA project key (e.g. PROJ):' });
  }

  if (configureAdo) {
    adoOrgUrl = await input({ message: 'Azure DevOps org URL (e.g. https://dev.azure.com/my-org):' });
    adoProject = await input({ message: 'Azure DevOps project name:' });
  }

  // ─── LLM ───────────────────────────────────────────────────────────────────

  const configureLlm = await confirm({
    message: `Configure LLM provider for AI features? ${PHASE_NOTE}`,
    default: false,
  });

  let llmProvider = '';
  let llmModel = '';

  if (configureLlm) {
    llmProvider = await select({
      message: 'LLM provider:',
      choices: [
        { name: 'GitHub Copilot  (uses GITHUB_TOKEN — no extra API key needed)', value: 'github-copilot' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'Azure OpenAI', value: 'azure' },
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'Ollama  (local / offline)', value: 'ollama' },
        { name: 'Custom / self-hosted', value: 'custom' },
      ],
    });

    const defaultModel: Record<string, string> = {
      'github-copilot': 'gpt-4o',
      openai: 'gpt-4o',
      anthropic: 'claude-opus-4-5',
      azure: 'gpt-4o',
      gemini: 'gemini-1.5-pro',
      ollama: 'llama3.2',
      custom: 'llama-3',
    };

    llmModel = await input({
      message: 'Model name:',
      default: defaultModel[llmProvider] ?? '',
    });
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  const notificationTargets = await checkbox({
    message: `Notification channels: ${PHASE_NOTE}`,
    choices: [
      { name: 'Slack', value: 'slack' },
      { name: 'Microsoft Teams', value: 'teams' },
      { name: 'JIRA (write results back to tickets)', value: 'jira' },
    ],
  });

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  const configureDashboard = await confirm({
    message: 'Enable GitHub Pages dashboard? (publishes test results to gh-pages branch)',
    default: true,
  });

  let dashboardBranch = 'gh-pages';
  if (configureDashboard) {
    dashboardBranch = await input({
      message: 'Branch name for GitHub Pages:',
      default: 'gh-pages',
    });
  }

  // ─── CI ────────────────────────────────────────────────────────────────────

  const generateWorkflow = await confirm({
    message: 'Generate a GitHub Actions workflow file?',
    default: true,
  });

  // ─── Write framework.config.ts ─────────────────────────────────────────────

  const configPath = join(cwd, 'framework.config.ts');
  await writeFile(configPath, buildConfig({ runnerType, runnerConfigFile, runnerCommand, jiraUrl, jiraProject, adoOrgUrl, adoProject, llmProvider, llmModel, notificationTargets, configureDashboard, dashboardBranch }), 'utf-8');
  console.log(chalk.green(`\n  ✓ Created framework.config.ts`));

  // ─── Create .qflow/ dir ────────────────────────────────────────────────────

  await mkdir(join(cwd, '.qflow', 'data'), { recursive: true });
  console.log(chalk.green('  ✓ Created .qflow/'));

  // ─── Update .gitignore ─────────────────────────────────────────────────────

  await appendGitignore(cwd);
  console.log(chalk.green('  ✓ Updated .gitignore'));

  // ─── Install @qflow/core in the target project ─────────────────────────────

  console.log(chalk.dim('  Installing @qflow/core...'));
  try {
    // detect package manager
    let pm = 'npm';
    try { await access(join(cwd, 'pnpm-lock.yaml')); pm = 'pnpm'; } catch {}
    try { await access(join(cwd, 'yarn.lock')); pm = 'yarn'; } catch {}
    const installArgs = pm === 'npm'
      ? 'install --save-dev @qflow/core'
      : pm === 'pnpm'
        ? 'add -D @qflow/core'
        : 'add --dev @qflow/core';
    execSync(`${pm} ${installArgs}`, { cwd, stdio: 'inherit' });
    console.log(chalk.green('  ✓ Installed @qflow/core'));
  } catch {
    console.log(chalk.yellow('  ⚠ Could not auto-install @qflow/core. Run: npm install --save-dev @qflow/core'));
  }

  // ─── GitHub Actions workflow ───────────────────────────────────────────────

  if (generateWorkflow) {
    await writeWorkflow(cwd, runnerType as string);
    console.log(chalk.green('  ✓ Created .github/workflows/qflow-test.yml'));
  }

  console.log(chalk.bold('\n  Setup complete!\n'));
  console.log('  Secrets to add to your CI environment (or .env for local runs):');

  if (configureJira) {
    console.log(chalk.dim('    QFLOW_JIRA_URL, QFLOW_JIRA_TOKEN'));
  }
  if (configureAdo) {
    console.log(chalk.dim('    QFLOW_ADO_ORG_URL, QFLOW_ADO_TOKEN'));
  }
  if (configureLlm && llmProvider !== 'github-copilot' && llmProvider !== 'ollama') {
    console.log(chalk.dim('    QFLOW_LLM_API_KEY'));
  }
  if (configureLlm && llmProvider === 'github-copilot') {
    console.log(chalk.dim('    GITHUB_TOKEN is injected automatically in GitHub Actions — no secret needed'));
  }
  if (notificationTargets.includes('slack')) {
    console.log(chalk.dim('    QFLOW_SLACK_WEBHOOK'));
  }
  if (notificationTargets.includes('teams')) {
    console.log(chalk.dim('    QFLOW_TEAMS_WEBHOOK'));
  }

  console.log('\n  Run tests:\n    npx @qflow/cli run\n');
}

// ─── Config file template ─────────────────────────────────────────────────────

interface ConfigOptions {
  runnerType: string;
  runnerConfigFile?: string;
  runnerCommand?: string;
  jiraUrl: string;
  jiraProject: string;
  adoOrgUrl: string;
  adoProject: string;
  llmProvider: string;
  llmModel: string;
  llmBaseUrl?: string;
  notificationTargets: string[];
  configureDashboard: boolean;
  dashboardBranch: string;
}

function buildConfig(opts: ConfigOptions): string {
  const lines: string[] = [
    `import type { QFlowConfig } from '@qflow/core';`,
    ``,
    `const config: QFlowConfig = {`,
    `  runner: {`,
    `    type: '${opts.runnerType}',`,
  ];

  if (opts.runnerConfigFile) {
    lines.push(`    configFile: '${opts.runnerConfigFile}',`);
  }
  if (opts.runnerCommand) {
    lines.push(`    command: '${opts.runnerCommand}',`);
  }

  lines.push(`  },`);

  if (opts.jiraUrl) {
    lines.push(
      ``,
      `  jira: {`,
      `    url: process.env.QFLOW_JIRA_URL!,`,
      `    token: process.env.QFLOW_JIRA_TOKEN!,`,
      `    project: '${opts.jiraProject}',`,
      `  },`,
    );
  }

  if (opts.adoOrgUrl) {
    lines.push(
      ``,
      `  azureDevOps: {`,
      `    orgUrl: process.env.QFLOW_ADO_ORG_URL!,`,
      `    token:  process.env.QFLOW_ADO_TOKEN!,`,
      `    project: '${opts.adoProject}',`,
      `  },`,
    );
  }

  if (opts.llmProvider) {
    const apiKeyLine =
      opts.llmProvider === 'github-copilot'
        ? `    apiKey: process.env.GITHUB_TOKEN ?? '',`
        : opts.llmProvider === 'ollama'
          ? `    apiKey: '',  // Ollama does not require an API key`
          : `    apiKey: process.env.QFLOW_LLM_API_KEY!,`;

    lines.push(
      ``,
      `  llm: {`,
      `    provider: '${opts.llmProvider}',`,
      apiKeyLine,
      `    model: '${opts.llmModel}',`,
      ...(opts.llmProvider === 'ollama' && !opts.llmBaseUrl
        ? [`    baseUrl: 'http://localhost:11434/v1',`]
        : []),
      `  },`,
    );
  }

  if (opts.notificationTargets.length > 0) {
    lines.push(``, `  notifications: {`);
    if (opts.notificationTargets.includes('slack')) {
      lines.push(`    slack: { webhookUrl: process.env.QFLOW_SLACK_WEBHOOK! },`);
    }
    if (opts.notificationTargets.includes('teams')) {
      lines.push(`    teams: { webhookUrl: process.env.QFLOW_TEAMS_WEBHOOK! },`);
    }
    if (opts.notificationTargets.includes('jira')) {
      lines.push(`    jira: { writeResults: true },`);
    }
    lines.push(`  },`);
  }

  if (opts.configureDashboard) {
    lines.push(
      ``,
      `  dashboard: {`,
      `    githubPages: true,`,
      `    branch: '${opts.dashboardBranch}',`,
      `  },`,
    );
  }

  lines.push(
    ``,
    `  flakiness: {`,
    `    quarantineThreshold: 0.2,`,
    `    historyDepth: 10,`,
    `  },`,
    ``,
    `  smartSelection: {`,
    `    enabled: true,`,
    `  },`,
    `};`,
    ``,
    `export default config;`,
    ``,
  );

  return lines.join('\n');
}

// ─── .gitignore helper ────────────────────────────────────────────────────────

async function appendGitignore(cwd: string): Promise<void> {
  const gitignorePath = join(cwd, '.gitignore');
  let existing = '';

  try {
    await access(gitignorePath);
    existing = await readFile(gitignorePath, 'utf-8');
  } catch {
    // file doesn't exist yet — create it
  }

  const entries = ['.qflow/', '*.env', '*.env.*', '!*.env.example'];
  const toAdd = entries.filter((e) => !existing.includes(e));

  if (toAdd.length > 0) {
    const addition = '\n# qflow\n' + toAdd.join('\n') + '\n';
    await writeFile(gitignorePath, existing + addition, 'utf-8');
  }
}

// ─── GitHub Actions workflow ──────────────────────────────────────────────────

async function writeWorkflow(cwd: string, runnerType: string): Promise<void> {
  await mkdir(join(cwd, '.github', 'workflows'), { recursive: true });

  const browserStep =
    runnerType === 'playwright'
      ? `
      - name: Install Playwright browsers
        run: npx playwright install --with-deps`
      : '';

  const workflow = `name: qflow tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci
${browserStep}
      - name: Run tests
        run: npx @qflow/cli run --suite \${{ github.event_name == 'pull_request' && 'pr-smart' || 'regression' }}
        env:
          QFLOW_JIRA_TOKEN: \${{ secrets.QFLOW_JIRA_TOKEN }}
          QFLOW_JIRA_URL: \${{ secrets.QFLOW_JIRA_URL }}
          QFLOW_LLM_API_KEY: \${{ secrets.QFLOW_LLM_API_KEY }}
          QFLOW_SLACK_WEBHOOK: \${{ secrets.QFLOW_SLACK_WEBHOOK }}
          QFLOW_TEAMS_WEBHOOK: \${{ secrets.QFLOW_TEAMS_WEBHOOK }}
`;

  await writeFile(join(cwd, '.github', 'workflows', 'qflow-test.yml'), workflow, 'utf-8');
}
