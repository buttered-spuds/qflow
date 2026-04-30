import chalk from 'chalk';
import { execSync } from 'child_process';
import { access, readFile } from 'fs/promises';
import { join } from 'path';
import { loadConfig, createLLMAdapter } from '@qflow/core';
import type { QFlowConfig } from '@qflow/core';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface Check {
  name: string;
  status: CheckStatus;
  message?: string;
  fix?: string;
}

export interface DoctorOptions {
  /** When true, only run cheap local checks (no network calls). */
  quick?: boolean;
}

/**
 * Diagnose qflow setup. Prints a green/yellow/red report.
 * Exit code: 0 if no failures (warnings ok), 1 if any check failed.
 */
export async function doctorCommand(options: DoctorOptions = {}): Promise<void> {
  console.log(chalk.bold.cyan('\n  qflow doctor\n'));

  const cwd = process.cwd();
  const checks: Check[] = [];

  // ─── Local environment checks ────────────────────────────────────────────

  checks.push(await checkPackageJson(cwd));
  checks.push(await checkConfigFile(cwd));

  let config: QFlowConfig | null = null;
  try {
    config = await loadConfig(cwd);
  } catch (err) {
    checks.push({
      name: 'framework.config.ts loads',
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
      fix: 'Re-run `qflow init` or fix the validation errors above.',
    });
    printAndExit(checks);
    return;
  }
  checks.push({ name: 'framework.config.ts loads', status: 'pass' });

  checks.push(await checkGit(cwd));
  checks.push(await checkGhCli());
  checks.push(await checkRunner(cwd, config));
  checks.push(await checkPlaywrightBrowsers(cwd, config));
  checks.push(await checkSourcePath(cwd, config));
  checks.push(await checkTestsExist(cwd, config));

  // ─── Network checks (skip in --quick mode) ───────────────────────────────

  if (options.quick) {
    checks.push({ name: 'Network checks', status: 'skip', message: '--quick mode, skipped' });
  } else {
    if (config.llm) checks.push(await checkLLM(config));
    if (config.jira) checks.push(await checkJira(config));
    if (config.azureDevOps) checks.push(await checkAzureDevOps(config));
    if (config.notifications?.slack) checks.push(checkSlackPresent(config));
    if (config.notifications?.teams) checks.push(checkTeamsPresent(config));
    checks.push(checkGithubToken(config));
  }

  printAndExit(checks);
}

// ─── Individual checks ──────────────────────────────────────────────────────

async function checkPackageJson(cwd: string): Promise<Check> {
  try {
    await access(join(cwd, 'package.json'));
    return { name: 'package.json present', status: 'pass' };
  } catch {
    return {
      name: 'package.json present',
      status: 'fail',
      message: 'No package.json in the current directory.',
      fix: 'Run `npm init -y` first.',
    };
  }
}

async function checkConfigFile(cwd: string): Promise<Check> {
  for (const f of ['framework.config.ts', 'framework.config.js', 'framework.config.mjs']) {
    try { await access(join(cwd, f)); return { name: 'framework.config.ts present', status: 'pass' }; } catch {}
  }
  return {
    name: 'framework.config.ts present',
    status: 'fail',
    message: 'No framework.config.ts found.',
    fix: 'Run `npx @qflow/cli init`.',
  };
}

async function checkGit(cwd: string): Promise<Check> {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, stdio: 'pipe' });
    return { name: 'git repository', status: 'pass' };
  } catch {
    return {
      name: 'git repository',
      status: 'warn',
      message: 'Not inside a git repo.',
      fix: '`git init` — required for `qflow generate` to open Draft PRs.',
    };
  }
}

async function checkGhCli(): Promise<Check> {
  try {
    execSync('gh --version', { stdio: 'pipe' });
    return { name: 'GitHub CLI (gh)', status: 'pass' };
  } catch {
    return {
      name: 'GitHub CLI (gh)',
      status: 'warn',
      message: '`gh` is not installed (will fall back to REST API + GITHUB_TOKEN).',
      fix: 'Install from https://cli.github.com or set GITHUB_TOKEN.',
    };
  }
}

async function checkRunner(cwd: string, config: QFlowConfig): Promise<Check> {
  const runner = config.runner.type;
  const pkgMap: Record<string, string | null> = {
    playwright: '@playwright/test',
    jest: 'jest',
    vitest: 'vitest',
    pytest: null, // python — can't check via package.json
    custom: null,
  };
  const pkg = pkgMap[runner];
  if (!pkg) return { name: `runner: ${runner}`, status: 'pass' };

  try {
    const pkgJson = JSON.parse(await readFile(join(cwd, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkgJson.dependencies ?? {}), ...(pkgJson.devDependencies ?? {}) };
    if (deps[pkg]) return { name: `runner: ${runner} installed`, status: 'pass' };
    return {
      name: `runner: ${runner} installed`,
      status: 'fail',
      message: `${pkg} is not in package.json.`,
      fix: `npm install --save-dev ${pkg}`,
    };
  } catch {
    return { name: `runner: ${runner} installed`, status: 'warn', message: 'Could not read package.json.' };
  }
}

async function checkPlaywrightBrowsers(cwd: string, config: QFlowConfig): Promise<Check> {
  if (config.runner.type !== 'playwright') {
    return { name: 'Playwright browsers', status: 'skip' };
  }
  try {
    execSync('npx playwright --version', { cwd, stdio: 'pipe' });
    // Browsers stored in ~/.cache/ms-playwright; absence is detected by Playwright at runtime.
    return { name: 'Playwright browsers', status: 'pass' };
  } catch {
    return {
      name: 'Playwright browsers',
      status: 'fail',
      message: 'Playwright is not installed.',
      fix: 'npm install --save-dev @playwright/test && npx playwright install --with-deps chromium',
    };
  }
}

async function checkSourcePath(_cwd: string, config: QFlowConfig): Promise<Check> {
  const ctx = config.testingContext;
  if (!ctx) return { name: 'testingContext configured', status: 'warn', message: 'Not set; generator will use defaults.' };
  const needsSource = ctx.modes.includes('unit') || ctx.modes.includes('component');
  if (!needsSource) return { name: 'testingContext.modes', status: 'pass', message: ctx.modes.join(', ') };
  if (!ctx.sourcePath) {
    return {
      name: 'testingContext.sourcePath',
      status: 'fail',
      message: "modes include 'unit' or 'component' but sourcePath is missing.",
      fix: 'Add `sourcePath: "src"` (or your source dir) to testingContext in framework.config.ts.',
    };
  }
  try {
    await access(join(_cwd, ctx.sourcePath));
    return { name: 'testingContext.sourcePath exists', status: 'pass', message: ctx.sourcePath };
  } catch {
    return {
      name: 'testingContext.sourcePath exists',
      status: 'fail',
      message: `Directory '${ctx.sourcePath}' does not exist.`,
      fix: 'Update sourcePath in framework.config.ts.',
    };
  }
}

async function checkTestsExist(cwd: string, _config: QFlowConfig): Promise<Check> {
  for (const dir of ['tests', 'test', '__tests__']) {
    try { await access(join(cwd, dir)); return { name: 'test files', status: 'pass', message: `found ${dir}/` }; } catch {}
  }
  return {
    name: 'test files',
    status: 'warn',
    message: 'No tests/, test/, or __tests__/ directory found.',
    fix: 'Generate your first test: `npx @qflow/cli generate --description "your feature"`',
  };
}

async function checkLLM(config: QFlowConfig): Promise<Check> {
  const llm = config.llm!;
  const name = `LLM: ${llm.provider} (${llm.model})`;
  // GitHub Copilot needs GITHUB_TOKEN
  if (llm.provider === 'github-copilot' && !llm.apiKey && !process.env.GITHUB_TOKEN) {
    return {
      name,
      status: 'fail',
      message: 'GitHub Copilot needs GITHUB_TOKEN.',
      fix: 'export GITHUB_TOKEN=$(gh auth token)',
    };
  }
  if (llm.provider !== 'github-copilot' && llm.provider !== 'ollama' && !llm.apiKey) {
    return {
      name,
      status: 'fail',
      message: 'API key is empty.',
      fix: 'Set QFLOW_LLM_API_KEY in your environment or .env file.',
    };
  }
  try {
    const adapter = createLLMAdapter(llm);
    // Tiny ping to confirm credentials work.
    await adapter.chat([
      { role: 'system', content: 'Reply with the single word: ok' },
      { role: 'user', content: 'ping' },
    ]);
    return { name, status: 'pass' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: 'fail',
      message: msg.slice(0, 200),
      fix: 'Verify your API key, model name, and (for Azure/Ollama/custom) baseUrl.',
    };
  }
}

async function checkJira(config: QFlowConfig): Promise<Check> {
  const jira = config.jira!;
  if (!jira.token) {
    return {
      name: 'JIRA',
      status: 'fail',
      message: 'QFLOW_JIRA_TOKEN is empty.',
      fix: 'Generate a JIRA API token and export QFLOW_JIRA_TOKEN.',
    };
  }
  try {
    const res = await fetch(`${jira.url}/rest/api/3/myself`, {
      headers: { Authorization: `Bearer ${jira.token}`, Accept: 'application/json' },
    });
    if (res.ok) return { name: `JIRA: ${jira.url}`, status: 'pass' };
    return {
      name: `JIRA: ${jira.url}`,
      status: 'fail',
      message: `${res.status} ${res.statusText}`,
      fix: 'Verify QFLOW_JIRA_URL and QFLOW_JIRA_TOKEN. Token may be expired.',
    };
  } catch (err) {
    return {
      name: `JIRA: ${jira.url}`,
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkAzureDevOps(config: QFlowConfig): Promise<Check> {
  const ado = config.azureDevOps!;
  if (!ado.token) {
    return { name: 'Azure DevOps', status: 'fail', message: 'QFLOW_ADO_TOKEN is empty.' };
  }
  try {
    const auth = Buffer.from(`:${ado.token}`).toString('base64');
    const res = await fetch(`${ado.orgUrl}/_apis/projects?api-version=7.0`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    if (res.ok) return { name: `Azure DevOps: ${ado.orgUrl}`, status: 'pass' };
    return {
      name: `Azure DevOps: ${ado.orgUrl}`,
      status: 'fail',
      message: `${res.status} ${res.statusText}`,
    };
  } catch (err) {
    return { name: `Azure DevOps: ${ado.orgUrl}`, status: 'fail', message: err instanceof Error ? err.message : String(err) };
  }
}

function checkSlackPresent(config: QFlowConfig): Check {
  const url = config.notifications?.slack?.webhookUrl;
  if (!url) return { name: 'Slack webhook', status: 'fail', message: 'QFLOW_SLACK_WEBHOOK is empty.' };
  if (!url.startsWith('https://hooks.slack.com/')) {
    return { name: 'Slack webhook', status: 'warn', message: 'Webhook URL does not look like a Slack URL.' };
  }
  return { name: 'Slack webhook', status: 'pass' };
}

function checkTeamsPresent(config: QFlowConfig): Check {
  const url = config.notifications?.teams?.webhookUrl;
  if (!url) return { name: 'Teams webhook', status: 'fail', message: 'QFLOW_TEAMS_WEBHOOK is empty.' };
  return { name: 'Teams webhook', status: 'pass' };
}

function checkGithubToken(config: QFlowConfig): Check {
  // Required for Draft PR creation when `gh` is unavailable, and for github-copilot LLM locally.
  const needed = config.llm?.provider === 'github-copilot' || !!config.dashboard?.githubPages;
  if (!needed) return { name: 'GITHUB_TOKEN', status: 'skip' };
  if (process.env.GITHUB_TOKEN) return { name: 'GITHUB_TOKEN', status: 'pass' };
  return {
    name: 'GITHUB_TOKEN',
    status: 'warn',
    message: 'Not set in environment.',
    fix: 'Add to ~/.zshrc: export GITHUB_TOKEN=$(gh auth token)',
  };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function printAndExit(checks: Check[]): void {
  for (const c of checks) {
    const icon =
      c.status === 'pass' ? chalk.green('✓') :
      c.status === 'warn' ? chalk.yellow('⚠') :
      c.status === 'fail' ? chalk.red('✗') :
      chalk.dim('·');
    const label = c.status === 'skip' ? chalk.dim(c.name) : c.name;
    const detail = c.message ? chalk.dim(` — ${c.message}`) : '';
    console.log(`  ${icon} ${label}${detail}`);
    if (c.fix && (c.status === 'fail' || c.status === 'warn')) {
      console.log(`      ${chalk.dim('fix:')} ${c.fix}`);
    }
  }

  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  const passes = checks.filter((c) => c.status === 'pass').length;

  console.log('');
  if (fails === 0 && warns === 0) {
    console.log(chalk.bold.green(`  All checks passed (${passes}).`));
  } else if (fails === 0) {
    console.log(chalk.bold.yellow(`  ${passes} passed, ${warns} warnings.`));
  } else {
    console.log(chalk.bold.red(`  ${passes} passed, ${warns} warnings, ${fails} failed.`));
  }
  console.log('');

  process.exitCode = fails > 0 ? 1 : 0;
}
