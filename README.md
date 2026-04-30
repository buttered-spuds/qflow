# qflow

AI-orchestrated plug-and-play testing framework. Drop it into any project, connect your tools, and get UI + API testing with CI/CD integration, AI-generated tests, and results published to Slack, Teams, JIRA, and a GitHub Pages dashboard.

---

## How it works

```
JIRA ticket (acceptance criteria)
        │
        ▼
  Orchestrator Agent
    ├── JIRA Agent          reads/writes JIRA tickets
    ├── Generator Agent     LLM writes Playwright / API tests
    ├── Reviewer Agent      LLM scores test quality before they're committed
    ├── Runner Agent        thin wrapper around your test runner CLI
    └── Reporter Agent      posts results to Slack / Teams / JIRA + GitHub Pages
```

**Core principle:** Use scripts for deterministic work. Use AI only where reasoning is required.

---

## Quickstart

```bash
# Drop into an existing project
npx @qflow/cli init

# Run tests
npx @qflow/cli run

# Generate tests from a JIRA ticket
npx @qflow/cli generate --ticket PROJ-123

# View local dashboard
npx @qflow/cli dashboard
```

---

## Project structure

```
test-framework/
├── packages/
│   ├── core/        @qflow/core — agents, runner adapters, notification adapters
│   ├── cli/         @qflow/cli  — npx @qflow/cli binary
│   └── template/    Starter project for greenfield repos
├── dashboard/       Static SPA deployed to GitHub Pages
└── .github/
    └── workflows/
        ├── qflow-test.yml            CI test runner + gh-pages publisher
        └── qflow-coverage-check.yml  Weekly JIRA coverage drift check
```

---

## CLI commands

| Command | Description |
|---|---|
| `npx @qflow/cli init` | Interactive setup wizard — creates `framework.config.ts` and GitHub Actions workflow |
| `npx @qflow/cli run` | Run the test suite (default suite: `regression`) |
| `npx @qflow/cli run --suite smoke` | Run only `@smoke` tagged tests |
| `npx @qflow/cli run --suite pr-smart` | Smart test selection based on PR diff |
| `npx @qflow/cli run --local` | Run tests with no notifications or publishing |
| `npx @qflow/cli generate --ticket PROJ-123` | Generate tests from JIRA acceptance criteria |
| `npx @qflow/cli dashboard` | Local dashboard server at `localhost:3000` |
| `npx @qflow/cli costs` | LLM token usage and cost summary |
| `npx @qflow/cli flakiness` | Flakiness and quarantine status |
| `npx @qflow/cli coverage-check` | JIRA coverage drift report |

---

## Configuration

All configuration lives in a single `framework.config.ts` at the root of your project. Run `npx @qflow/cli init` to generate it interactively, or copy [`framework.config.example.ts`](./framework.config.example.ts).

### Required secrets

Add these as GitHub Actions secrets (Settings → Secrets and variables → Actions):

| Secret | Used for |
|---|---|
| `QFLOW_JIRA_TOKEN` | JIRA API token |
| `QFLOW_JIRA_URL` | JIRA base URL |
| `QFLOW_LLM_API_KEY` | LLM provider API key (not needed for `github-copilot` or `ollama`) |
| `QFLOW_SLACK_WEBHOOK` | Slack incoming webhook URL |
| `QFLOW_TEAMS_WEBHOOK` | Microsoft Teams incoming webhook URL |

> **GitHub Copilot users:** set `provider: 'github-copilot'` and `apiKey: process.env.GITHUB_TOKEN ?? ''` in `framework.config.ts`. `GITHUB_TOKEN` is injected automatically by GitHub Actions — no extra secret required.
>
> **Running locally?** Add this to your `~/.zshrc` (macOS/Linux) once — it pulls the token from your existing `gh` CLI login:
> ```bash
> export GITHUB_TOKEN=$(gh auth token)
> ```
> Then run `source ~/.zshrc`. After that, `GITHUB_TOKEN` is always set in every terminal session.

> **Install globally** to use `qflow` as a direct command: `npm install -g @qflow/cli`

For local runs, create a `.env` file (gitignored) with the same variable names.

---

## Supported integrations

| Category | Supported |
|---|---|
| Test runners | Playwright, pytest, Jest, custom command |
| LLM providers | OpenAI, Anthropic (Claude), Azure OpenAI, Google Gemini, Ollama (local), **GitHub Copilot** (uses `GITHUB_TOKEN`), custom |
| Notifications | Slack, Microsoft Teams, JIRA |
| CI/CD | GitHub Actions (first-class), any platform via `npx @qflow/cli run` |
| Dashboard | GitHub Pages (primary), local server (fallback) |

---

## Phases

| Phase | What's included | Status |
|---|---|---|
| **1** | CLI, runner adapters (Playwright/pytest/Jest/custom), local dashboard | ✅ Complete |
| **2** | Reporter Agent — Slack/Teams/JIRA notifications, GitHub Pages publishing | ✅ Complete |
| **3** | JIRA/Azure DevOps agents, all LLM providers, Generator Agent, Reviewer Agent, Draft PRs | ✅ Complete |
| **4** | Smart test selection, flakiness detection, coverage drift alerts | ✅ Complete |
| **5** | Self-healing Playwright selectors, LLM cost tracking, Gemini + Ollama adapters | ✅ Complete |

---

## Development

This is a [pnpm](https://pnpm.io) monorepo.

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type-check all packages
pnpm typecheck

# Build a specific package
pnpm --filter @qflow/core build
pnpm --filter @qflow/cli build
```

See the READMEs in each package for package-specific details:
- [packages/core/README.md](packages/core/README.md)
- [packages/cli/README.md](packages/cli/README.md)
- [packages/template/README.md](packages/template/README.md)
- [dashboard/README.md](dashboard/README.md)
