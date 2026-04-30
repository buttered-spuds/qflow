# @qflow/core

The core library for qflow. Contains all agents, runner adapters, notification adapters, and shared types.

---

## Architecture

```
src/
├── types.ts                    All shared TypeScript types
├── config.ts                   Config file loader (Zod-validated, ${VAR} interpolation)
├── agents/
│   ├── orchestrator.ts         Coordinates all other agents
│   ├── ticket-agent.ts         TicketAgent interface (JIRA + Azure DevOps)
│   ├── runner-agent.ts         Thin wrapper — calls the runner adapter
│   ├── reporter-agent.ts       Persists results, fires notifications, publishes to gh-pages
│   ├── jira-agent.ts           Reads/writes JIRA tickets
│   ├── azure-devops-agent.ts   Reads/writes Azure DevOps work items
│   ├── repo-context-agent.ts   Scans existing POMs, fixtures, examples — feeds Generator + Reviewer
│   ├── generator-agent.ts      LLM → test files (UI / API / unit / component), opens Draft PR
│   ├── reviewer-agent.ts       LLM quality scoring; docks score for duplicating existing helpers
│   ├── flakiness-agent.ts      Detects flaky tests, manages quarantine list
│   ├── coverage-drift-agent.ts Ticket system → test corpus coverage check
│   ├── smart-selector.ts       Git diff → minimal test subset selection
│   └── self-healing-agent.ts   Detects broken locators, proposes LLM replacements
├── adapters/
│   ├── runners/
│   │   ├── base.ts             RunnerAdapter interface
│   │   ├── playwright.ts       Playwright JSON reporter parser
│   │   ├── pytest.ts           pytest-json-report parser
│   │   ├── jest.ts             Jest --json parser
│   │   ├── vitest.ts           Vitest --reporter=json parser
│   │   ├── custom.ts           Arbitrary shell command wrapper
│   │   └── index.ts            createRunner() factory (forwards baseUrl/workers/retries/timeout/env)
│   ├── llm/
│   │   ├── base.ts             LLMAdapter interface + types
│   │   ├── openai.ts           OpenAI adapter
│   │   ├── anthropic.ts        Anthropic (Claude) adapter
│   │   ├── azure.ts            Azure OpenAI adapter
│   │   ├── gemini.ts           Google Gemini REST adapter
│   │   ├── ollama.ts           Ollama local adapter (extends OpenAI)
│   │   ├── github-copilot.ts   GitHub Copilot adapter (uses GITHUB_TOKEN)
│   │   └── index.ts            createLLMAdapter() factory
│   └── notifications/
│       ├── base.ts             NotificationAdapter interface
│       ├── slack.ts            Slack Block Kit webhook
│       ├── teams.ts            Microsoft Teams MessageCard webhook
│       ├── jira.ts             JIRA ADF comment via REST API
│       └── index.ts            Barrel export
└── utils/
    ├── gh-pages-publisher.ts   git worktree-based gh-pages commit + retry
    └── cost-ledger.ts          JSONL append-only LLM token usage ledger
```

---

## Key types

### `QFlowConfig`
The shape of `framework.config.ts`. Validated at load time via Zod. Any `${VAR}` references inside `runner.env` or `environments.*.env` are interpolated from `process.env` at load time and throw if unset.

```ts
interface QFlowConfig {
  runner: RunnerConfig;          // required
  testingContext?: TestingContext;
  jira?: JiraConfig;
  azureDevOps?: AzureDevOpsConfig;
  llm?: LLMConfig;
  notifications?: NotificationsConfig;
  dashboard?: DashboardConfig;
  flakiness?: FlakinessConfig;
  smartSelection?: SmartSelectionConfig;
  selfHealing?: SelfHealingConfig;
  environments?: Record<string, EnvironmentProfile>;  // applied via `qflow run --env <name>`
  tags?: TagsConfig;                                  // grep patterns for smoke / regression
}

interface TestingContext {
  modes: Array<'ui' | 'api' | 'unit' | 'component'>;  // multi-select
  sourcePath?: string;  // required when modes include 'unit' or 'component'
}

interface RunnerConfig {
  type: 'playwright' | 'pytest' | 'jest' | 'vitest' | 'custom';
  configFile?: string;
  command?: string;       // required for 'custom'
  outputDir?: string;
  baseUrl?: string;       // PLAYWRIGHT_BASE_URL / BASE_URL
  workers?: number;
  retries?: number;
  timeoutMs?: number;
  env?: Record<string, string>;  // ${VAR} interpolated at load
}
```

### `RunReport`
Produced by every runner after a test run. Passed to the Reporter Agent.

```ts
interface RunReport {
  id: string;
  timestamp: string;       // ISO 8601
  suite: string;
  runner: string;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;        // milliseconds
  tests: TestCase[];
  commit?: string;
  branch?: string;
  triggeredBy?: string;    // 'ci' | 'manual' | 'pr'
}
```

### `RunnerAdapter`
Interface all runner adapters implement. Add your own by implementing this.

```ts
interface RunnerAdapter {
  run(options: RunOptions): Promise<RunReport>;
}
```

### `NotificationAdapter`
Interface all notification adapters implement.

```ts
interface NotificationAdapter {
  send(report: RunReport, dashboardUrl?: string): Promise<void>;
}
```

---

## Agents

### Orchestrator
Entry point for all `qflow run` and `qflow generate` calls. Wires agents together. Resolves `tags.<suite>` to a runner-friendly grep pattern before invoking the Runner Agent.

### Repo Context Agent
Scans the consuming project for existing Page Object classes, fixtures / factories, example tests (per mode), pinned runner version, and `tsconfig.json` path aliases. Returns a structured `RepoContext` that the Generator and Reviewer embed in their LLM prompts so generated tests fit the project's existing conventions instead of duplicating them.

### Runner Agent
Calls the configured `RunnerAdapter`. Returns a `RunReport`. Forwards `runner.{baseUrl, workers, retries, timeoutMs, env}` and the resolved `tagPattern` from the Orchestrator. Does not handle environment setup — that is the responsibility of scripts in the consuming repo.

### Reporter Agent
1. Always writes the `RunReport` to `.qflow/data/run-{timestamp}.json`
2. If not `--local`: publishes to the gh-pages branch and fires all configured notification adapters in parallel
3. Channel failures are logged as warnings — they never fail the CI run

### gh-pages publisher (`utils/gh-pages-publisher.ts`)
- Uses `git worktree` to commit to `gh-pages` without switching the working branch
- Writes `data/run-{timestamp}.json` and updates `data/manifest.json`
- Retries up to 3 times with `git pull --rebase` on push conflicts (parallel CI runs)
- Auto-creates an orphan `gh-pages` branch if one doesn't exist yet

---

## Adding a custom runner adapter

```ts
import type { RunnerAdapter, RunOptions, RunReport } from '@qflow/core';
import { randomUUID } from 'crypto';

export class MyRunner implements RunnerAdapter {
  async run(options: RunOptions): Promise<RunReport> {
    // Call your test tool, parse output, return a RunReport
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      suite: options.suite,
      runner: 'my-runner',
      passed: 10,
      failed: 0,
      skipped: 0,
      total: 10,
      duration: 5000,
      tests: [],
    };
  }
}
```

Register it in your `framework.config.ts`:

```ts
// For custom runners, set type: 'custom' and provide the CLI command.
// For full control (custom parse logic), extend RunnerAgent directly.
runner: { type: 'custom', command: 'my-test-tool --reporter json' }
```

---

## Adding a custom notification adapter

```ts
import type { NotificationAdapter, RunReport } from '@qflow/core';

export class PagerDutyAdapter implements NotificationAdapter {
  async send(report: RunReport, dashboardUrl?: string): Promise<void> {
    if (report.failed > 0) {
      // fire PagerDuty alert
    }
  }
}
```

---

## Build

```bash
pnpm build      # compile to dist/
pnpm typecheck  # type-check without emitting
pnpm dev        # watch mode
```

## Tests

Run from the workspace root — vitest is configured at the root and picks up every `packages/*/test/**/*.test.ts` file:

```bash
pnpm test         # one-shot
pnpm test:watch   # interactive
```
