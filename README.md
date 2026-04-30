# qflow

[![CI](https://github.com/buttered-spuds/qflow/actions/workflows/ci.yml/badge.svg)](https://github.com/buttered-spuds/qflow/actions/workflows/ci.yml)
[![npm @qflow/cli](https://img.shields.io/npm/v/@qflow/cli?label=%40qflow%2Fcli)](https://www.npmjs.com/package/@qflow/cli)
[![npm @qflow/core](https://img.shields.io/npm/v/@qflow/core?label=%40qflow%2Fcore)](https://www.npmjs.com/package/@qflow/core)

AI-orchestrated plug-and-play testing framework. Drop it into any project, connect your tools, and get UI / API / unit / component testing with CI/CD integration, AI-generated tests, and results published to Slack, Teams, JIRA, and a GitHub Pages dashboard.

---

## How it works

```
JIRA / ADO ticket (acceptance criteria)
        │
        ▼
  Orchestrator Agent
    ├── Ticket Agent        reads/writes JIRA or Azure DevOps
    ├── Repo Context Agent  scans existing POMs, fixtures, examples — feeds the LLM
    ├── Generator Agent     LLM writes UI / API / unit / component tests
    ├── Reviewer Agent      LLM scores quality + penalises duplicating existing helpers
    ├── Runner Agent        thin wrapper around Playwright / pytest / Jest / vitest
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

> Run `npx @qflow/cli --help` to list every command, or `npx @qflow/cli <command> --help` for the flags of a specific command.

| Command | Description |
|---|---|
| `npx @qflow/cli init` | Interactive setup wizard — auto-detects runner, generates `framework.config.ts` + GitHub Actions workflow, then runs a quick `doctor` |
| `npx @qflow/cli doctor` | Diagnose your setup — config, integrations, runner, secrets (`--quick` skips network checks) |
| `npx @qflow/cli run` | Run the test suite (default suite: `regression`) |
| `npx @qflow/cli run --suite smoke` | Run only smoke tests (uses `tags.smoke` if set, else `@smoke`) |
| `npx @qflow/cli run --suite pr-smart` | Smart test selection based on PR diff |
| `npx @qflow/cli run --env staging` | Apply an `environments.staging` profile (overrides `baseUrl` + env) |
| `npx @qflow/cli run --local` | Run with no notifications or publishing |
| `npx @qflow/cli generate --ticket PROJ-123` | Generate tests from a ticket — Generator + Reviewer loop, opens a Draft PR |
| `npx @qflow/cli watch` | Re-run on file change (debounced) |
| `npx @qflow/cli heal [--apply]` | LLM repairs broken Playwright selectors from the latest run (dry-run by default) |
| `npx @qflow/cli replay [runId]` | Re-run only the failed tests from a previous run |
| `npx @qflow/cli record <url>` | Wraps `playwright codegen` and saves the spec under `tests/ui/` |
| `npx @qflow/cli list <target>` | `tests` \| `suites` \| `runs` \| `page-objects` \| `fixtures` |
| `npx @qflow/cli upgrade` | Bumps `@qflow/core` and `@qflow/cli` to the latest versions |
| `npx @qflow/cli dashboard` | Local dashboard server at `localhost:3000` |
| `npx @qflow/cli costs` | LLM token usage and cost summary |
| `npx @qflow/cli flakiness` | Flakiness and quarantine status |
| `npx @qflow/cli coverage-check` | JIRA / ADO coverage drift report |

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
| Test runners | Playwright, pytest, Jest, **vitest**, custom command |
| Test modes | `ui`, `api`, `unit`, `component` (multi-select via `testingContext.modes`) |
| LLM providers | OpenAI, Anthropic (Claude), Azure OpenAI, Google Gemini, Ollama (local), **GitHub Copilot** (uses `GITHUB_TOKEN`), custom |
| Notifications | Slack, Microsoft Teams, JIRA |
| Ticket systems | JIRA Cloud / Server, Azure DevOps |
| CI/CD | GitHub Actions (first-class — auto-generates workflow with PR comments + artifacts), any platform via `npx @qflow/cli run` |
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
| **v0.2** | RepoContextAgent, `doctor`, multi-mode `testingContext`, vitest runner, env profiles + tags + `${VAR}` interpolation, CI PR comments, `heal` / `watch` / `list` / `record` / `replay` / `upgrade`, self-tests on every push | ✅ Complete |

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

# Run the self-tests (vitest)
pnpm test
pnpm test:watch

# Build a specific package
pnpm --filter @qflow/core build
pnpm --filter @qflow/cli build
```

### CI

Every push and pull request runs [.github/workflows/ci.yml](.github/workflows/ci.yml):

- Type-check, build, and run the vitest suite
- Matrixed across Node 20 and Node 22
- Cancels in-progress runs on the same ref to save minutes

The other workflow in `.github/workflows/` (`qflow-test.yml`) is the **example** workflow that `qflow init` generates for consumer projects — it is not used to build qflow itself.

See the READMEs in each package for package-specific details:
- [packages/core/README.md](packages/core/README.md)
- [packages/cli/README.md](packages/cli/README.md)
- [packages/template/README.md](packages/template/README.md)
- [dashboard/README.md](dashboard/README.md)
