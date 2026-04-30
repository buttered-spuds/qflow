import { select, input, password, confirm, checkbox } from '@inquirer/prompts';
import chalk from 'chalk';
import { writeFile, mkdir, readFile, access } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';

export async function initCommand(): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow init\n'));
  console.log('This wizard will create framework.config.ts in the current directory.\n');

  const cwd = process.cwd();

  // ─── Sanity check: must be inside a project ────────────────────────────────

  let hasPackageJson = false;
  try { await access(join(cwd, 'package.json')); hasPackageJson = true; } catch {}
  if (!hasPackageJson) {
    console.log(chalk.yellow('  ⚠ No package.json found in this directory.'));
    const proceed = await confirm({
      message: 'qflow works best inside an existing project. Continue anyway?',
      default: false,
    });
    if (!proceed) {
      console.log(chalk.dim('\n  Aborted. Run `npm init -y` first, then re-run `qflow init`.\n'));
      return;
    }
  }

  // ─── What kinds of tests? ──────────────────────────────────────────────────

  let modes = await checkbox<string>({
    message: 'What kinds of tests will this framework manage? (space to toggle, enter to confirm)',
    choices: [
      { name: 'UI         — End-to-end browser tests (Playwright + POM)',                value: 'ui',        checked: true },
      { name: 'API        — HTTP/service tests against a running app (no browser)',      value: 'api',       checked: true },
      { name: 'Unit       — In-process tests with mocked deps; mirror source structure', value: 'unit' },
      { name: 'Component  — Isolated UI component tests',                                value: 'component' },
    ],
    validate: (vals) => vals.length > 0 || 'Pick at least one.',
  });

  let sourcePath = 'src';
  if (modes.includes('unit') || modes.includes('component')) {
    sourcePath = await input({
      message: 'Where is your source code? (relative path — tests mirror this structure)',
      default: await detectSourcePath(cwd),
    });
  }

  // ─── Runner ────────────────────────────────────────────────────────────────

  const detectedRunner = await detectRunner(cwd, modes);
  const runnerType = await select({
    message: 'Which test runner does this project use?',
    default: detectedRunner,
    choices: [
      { name: 'Playwright  (UI + API end-to-end)', value: 'playwright' },
      { name: 'Jest        (unit / integration)',  value: 'jest' },
      { name: 'Vitest      (unit / integration)',  value: 'vitest' },
      { name: 'pytest      (Python)',              value: 'pytest' },
      { name: 'Custom command',                    value: 'custom' },
    ],
  });

  let runnerConfigFile: string | undefined;
  let runnerCommand: string | undefined;

  if (runnerType === 'playwright') {
    // Auto-detect Playwright config; only ask if it's not where we expect.
    const detectedConfig = await detectPlaywrightConfig(cwd);
    if (detectedConfig) {
      runnerConfigFile = detectedConfig;
      console.log(chalk.dim(`  Using detected Playwright config: ${detectedConfig}`));
    } else {
      runnerConfigFile = await input({
        message: 'Playwright config file path:',
        default: 'playwright.config.ts',
      });
    }
  }

  if (runnerType === 'custom') {
    runnerCommand = await input({
      message: 'Shell command to run tests (e.g. npm test):',
    });
  }

  // ─── Ticket system ─────────────────────────────────────────────────────────

  console.log(chalk.dim('  ℹ A ticket system is required if you want to use `qflow generate --ticket` or coverage-check.'));
  const ticketSystem = await select({
    message: 'Ticket system:',
    choices: [
      { name: 'JIRA Cloud / Server', value: 'jira' },
      { name: 'Azure DevOps',        value: 'azure-devops' },
      { name: 'None  — I will use --description for ad-hoc generation', value: 'none' },
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

  console.log(chalk.dim('  ℹ An LLM is required for the AI features (generate, review, self-heal). Skip only if you want to use qflow purely as a runner/reporter.'));
  const configureLlm = await confirm({
    message: 'Configure an LLM provider?',
    default: true,
  });

  let llmProvider = '';
  let llmModel = '';

  if (configureLlm) {
    llmProvider = await select({
      message: 'LLM provider:',
      choices: [
        { name: 'GitHub Copilot  (uses GITHUB_TOKEN — free in GitHub Actions)', value: 'github-copilot' },
        { name: 'OpenAI', value: 'openai' },
        { name: 'Anthropic (Claude)', value: 'anthropic' },
        { name: 'Azure OpenAI', value: 'azure' },
        { name: 'Google Gemini', value: 'gemini' },
        { name: 'Ollama  (local / offline)', value: 'ollama' },
        { name: 'Custom / self-hosted', value: 'custom' },
      ],
    });

    const defaultModel: Record<string, string> = {
      'github-copilot': 'claude-sonnet-4.6',
      openai: 'gpt-4o',
      anthropic: 'claude-sonnet-4-5',
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
    message: 'Notification channels (you can add these later by editing framework.config.ts):',
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
  await writeFile(configPath, buildConfig({ modes, sourcePath, runnerType, runnerConfigFile, runnerCommand, jiraUrl, jiraProject, adoOrgUrl, adoProject, llmProvider, llmModel, notificationTargets, configureDashboard, dashboardBranch }), 'utf-8');
  console.log(chalk.green(`\n  ✓ Created framework.config.ts`));

  // ─── Create .qflow/ dir ────────────────────────────────────────────────────

  await mkdir(join(cwd, '.qflow', 'data'), { recursive: true });
  console.log(chalk.green('  ✓ Created .qflow/'));

  // ─── Update .gitignore ─────────────────────────────────────────────────────

  await appendGitignore(cwd);
  console.log(chalk.green('  ✓ Updated .gitignore'));

  // ─── Install @qflow/core in the target project ─────────────────────────────

  const devDeps = ['@qflow/core'];

  if (runnerType === 'playwright') devDeps.push('@playwright/test');
  if (runnerType === 'jest') devDeps.push('jest', '@types/jest', 'ts-jest');
  if (runnerType === 'vitest') devDeps.push('vitest');

  console.log(chalk.dim(`  Installing ${devDeps.join(', ')}...`));
  try {
    // detect package manager
    let pm = 'npm';
    try { await access(join(cwd, 'pnpm-lock.yaml')); pm = 'pnpm'; } catch {}
    try { await access(join(cwd, 'yarn.lock')); pm = 'yarn'; } catch {}
    const installCmd = pm === 'npm'
      ? `install --save-dev ${devDeps.join(' ')}`
      : pm === 'pnpm'
        ? `add -D ${devDeps.join(' ')}`
        : `add --dev ${devDeps.join(' ')}`;
    execSync(`${pm} ${installCmd}`, { cwd, stdio: 'inherit' });
    console.log(chalk.green(`  ✓ Installed ${devDeps.join(', ')}`));

    if (runnerType === 'playwright') {
      console.log(chalk.dim('  Installing Playwright browsers (this takes ~30s)...'));
      execSync('npx playwright install --with-deps chromium', { cwd, stdio: 'inherit' });
      console.log(chalk.green('  ✓ Playwright browsers ready'));
    }
  } catch {
    console.log(chalk.yellow(`  ⚠ Could not auto-install dependencies. Run manually:\n    npm install --save-dev ${devDeps.join(' ')}`));
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

  // ─── VS Code extension ─────────────────────────────────────────────────────

  await maybeInstallVSCodeExtension();

  // ─── Mini-doctor (quick local sanity check) ────────────────────────────────
  console.log(chalk.dim('  Running quick health check...\n'));
  try {
    const { doctorCommand } = await import('./doctor.js');
    await doctorCommand({ quick: true });
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Health check could not run: ${err instanceof Error ? err.message : String(err)}`));
  }
}

// ─── VS Code extension installer ─────────────────────────────────────────────

async function maybeInstallVSCodeExtension(): Promise<void> {
  // Detect VS Code terminal via common environment markers.
  const isVSCode =
    process.env.TERM_PROGRAM === 'vscode' ||
    Boolean(process.env.VSCODE_PID) ||
    Boolean(process.env.VSCODE_GIT_IPC_HANDLE) ||
    Boolean(process.env.VSCODE_INJECTION);

  if (!isVSCode) return;

  // Check whether the `code` CLI is available.
  let codeCliAvailable = false;
  try {
    execSync('code --version', { stdio: 'ignore' });
    codeCliAvailable = true;
  } catch {
    // `code` CLI is not on PATH
  }

  const EXTENSION_ID = 'qflow.qflow-vscode';

  if (codeCliAvailable) {
    // Check if already installed.
    let alreadyInstalled = false;
    try {
      const installed = execSync('code --list-extensions', { encoding: 'utf-8' });
      alreadyInstalled = installed.split('\n').some((line) => line.trim() === EXTENSION_ID);
    } catch {
      // ignore
    }

    if (alreadyInstalled) {
      console.log(chalk.dim('  VS Code extension already installed — skipping.'));
      return;
    }

    console.log(chalk.bold.cyan('\n  VS Code detected!\n'));
    const install = await confirm({
      message: 'Install the qflow VS Code extension? (adds a Test Explorer, status bar, and inline commands)',
      default: true,
    });

    if (install) {
      try {
        execSync(`code --install-extension ${EXTENSION_ID}`, { stdio: 'inherit' });
        console.log(chalk.green('  ✓ qflow VS Code extension installed'));
        console.log(chalk.dim('    Reload VS Code (Ctrl+Shift+P → "Reload Window") to activate it.\n'));
      } catch {
        console.log(chalk.yellow(`  ⚠ Could not auto-install the extension.`));
        console.log(chalk.dim(`    Install manually: open VS Code → Extensions → search "qflow"\n`));
      }
    } else {
      console.log(chalk.dim('  Skipped. You can install it later from the VS Code Marketplace: search "qflow".\n'));
    }
  } else {
    // `code` CLI not available — just tell the user about the extension.
    console.log(chalk.bold.cyan('\n  VS Code detected!\n'));
    console.log(
      chalk.dim(
        '  The qflow VS Code extension adds a Test Explorer, status bar, and inline run/generate commands.\n' +
        '  Install it from the VS Code Marketplace: open Extensions (Ctrl+Shift+X) and search "qflow".\n',
      ),
    );
  }
}

// ─── Config file template ─────────────────────────────────────────────────────

interface ConfigOptions {
  modes: string[];
  sourcePath: string;
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

  // testingContext
  const needsSource = opts.modes.includes('unit') || opts.modes.includes('component');
  lines.push(
    ``,
    `  testingContext: {`,
    `    modes: [${opts.modes.map((m) => `'${m}'`).join(', ')}],`,
    ...(needsSource ? [`    sourcePath: '${opts.sourcePath}',`] : []),
    `  },`,
  );

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

  const isPlaywright = runnerType === 'playwright';

  const browserCacheStep = isPlaywright
    ? `
      - name: Get Playwright version
        id: pw-version
        run: echo "version=$(node -e "console.log(require('@playwright/test/package.json').version)")" >> "$GITHUB_OUTPUT"

      - name: Cache Playwright browsers
        id: pw-cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: pw-\${{ runner.os }}-\${{ steps.pw-version.outputs.version }}

      - name: Install Playwright browsers
        if: steps.pw-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps`
    : '';

  const reportArtifactStep = isPlaywright
    ? `
      - name: Upload Playwright HTML report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 14`
    : '';

  const workflow = `name: qflow tests

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  pull-requests: write
  issues: write

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # qflow needs git history for PR-smart selection

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci
${browserCacheStep}
      - name: Run tests
        id: qflow
        run: npx @qflow/cli run --suite \${{ github.event_name == 'pull_request' && 'pr-smart' || 'regression' }}
        env:
          QFLOW_JIRA_TOKEN: \${{ secrets.QFLOW_JIRA_TOKEN }}
          QFLOW_JIRA_URL: \${{ secrets.QFLOW_JIRA_URL }}
          QFLOW_LLM_API_KEY: \${{ secrets.QFLOW_LLM_API_KEY }}
          # Notifications only fire when the secret is set; safe to leave blank locally
          QFLOW_SLACK_WEBHOOK: \${{ github.event_name != 'workflow_dispatch' && secrets.QFLOW_SLACK_WEBHOOK || '' }}
          QFLOW_TEAMS_WEBHOOK: \${{ github.event_name != 'workflow_dispatch' && secrets.QFLOW_TEAMS_WEBHOOK || '' }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}

      - name: Upload qflow run data
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: qflow-data
          path: .qflow/data/
          retention-days: 30
${reportArtifactStep}

      - name: Comment results on PR
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const path = require('path');
            const dir = '.qflow/data';
            if (!fs.existsSync(dir)) return;
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
            const latest = files[files.length - 1];
            if (!latest) return;
            const report = JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf-8'));
            const total = report.total ?? (report.passed + report.failed + report.skipped);
            const status = report.failed > 0 ? '❌ Failed' : '✅ Passed';
            const failingList = (report.tests ?? [])
              .filter(t => t.status === 'failed')
              .slice(0, 10)
              .map(t => \`- \\\`\${t.fullName ?? t.name}\\\`\`)
              .join('\\n') || '_(none)_';
            const body = [
              \`### qflow — \${status}\`,
              '',
              \`| Passed | Failed | Skipped | Total | Duration |\`,
              \`| ---: | ---: | ---: | ---: | ---: |\`,
              \`| \${report.passed} | \${report.failed} | \${report.skipped} | \${total} | \${Math.round((report.duration ?? 0) / 1000)}s |\`,
              '',
              '<details><summary>Failing tests</summary>',
              '',
              failingList,
              '',
              '</details>',
              '',
              \`_Run id: \\\`\${report.id}\\\`_\`,
            ].join('\\n');
            await github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body,
            });
`;

  await writeFile(join(cwd, '.github', 'workflows', 'qflow-test.yml'), workflow, 'utf-8');
}

// ─── Auto-detection helpers ──────────────────────────────────────────────────

async function detectSourcePath(cwd: string): Promise<string> {
  for (const candidate of ['src', 'lib', 'app', 'source']) {
    try { await access(join(cwd, candidate)); return candidate; } catch {}
  }
  return 'src';
}

async function detectPlaywrightConfig(cwd: string): Promise<string | undefined> {
  for (const f of ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs']) {
    try { await access(join(cwd, f)); return f; } catch {}
  }
  return undefined;
}

async function detectRunner(cwd: string, modes: string[]): Promise<string> {
  // Inspect package.json deps for a strong signal first.
  try {
    const pkgRaw = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (deps['@playwright/test']) return 'playwright';
    if (deps['vitest']) return 'vitest';
    if (deps['jest']) return 'jest';
  } catch {}

  // Fall back to mode-based guess.
  if (modes.includes('ui') || modes.includes('api')) return 'playwright';
  if (modes.includes('unit') || modes.includes('component')) return 'vitest';
  return 'playwright';
}
