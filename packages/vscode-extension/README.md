# qflow VS Code Extension

A VS Code extension for the [qflow](https://github.com/buttered-spuds/qflow) AI-orchestrated testing framework.

## Features

- **Test Explorer** — Browse your test suites and latest results in a dedicated panel in the Activity Bar.
- **Run History** — View all past runs with pass/fail status and individual test results.
- **Status Bar** — Always-visible last-run summary (e.g. `✓ 42 passed`) that links to the dashboard.
- **Dashboard Webview** — Open the qflow dashboard without leaving VS Code (`qflow: Open Dashboard`).
- **Run Tests** — Run any suite (regression, smoke, pr-smart) from the Command Palette or the Activity Bar icon.
- **Generate Tests** — Generate AI tests from a JIRA/ADO ticket key or a free-text description, straight from VS Code.
- **Self-Heal** — Repair broken Playwright selectors with a dry-run preview before applying changes.
- **Watch Mode** — Launch a persistent watch-mode terminal that re-runs tests on file changes.
- **Doctor** — One-click health check to diagnose config, integrations, and secrets.

## Requirements

- [qflow](https://github.com/buttered-spuds/qflow) must be set up in your workspace (`framework.config.ts` must exist or `.qflow/` directory present).
- Node.js 18+.
- VS Code 1.90.0+ (released June 2024 — minimum version required by this extension).

## Getting Started

`npx @qflow/cli init` automatically detects VS Code (via `TERM_PROGRAM`, `VSCODE_PID`, or similar markers) and prompts you to install the extension before finishing setup.

Otherwise, search for **qflow** in the VS Code Extensions marketplace and click **Install**.

## Commands

All commands are available via the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---|---|
| `qflow: Run Tests` | Run the default suite (configurable) |
| `qflow: Run Smoke Suite` | Run the smoke suite |
| `qflow: Run Tests (Local / Offline)` | Run without notifications or LLM calls |
| `qflow: Generate Tests from Ticket` | AI-generate tests from a JIRA/ADO ticket |
| `qflow: Generate Tests from Description` | AI-generate tests from a free-text description |
| `qflow: Open Dashboard` | Open the results dashboard in a webview panel |
| `qflow: Heal Broken Selectors` | Self-heal broken Playwright selectors (dry-run or apply) |
| `qflow: Run Doctor` | Diagnose your qflow setup |
| `qflow: Show LLM Costs` | Print LLM token usage and estimated costs |
| `qflow: Show Flakiness Report` | Print flakiness and quarantine status |
| `qflow: Replay Failed Tests` | Re-run only the failed tests from the latest run |
| `qflow: Start Watch Mode` | Open a terminal running `qflow watch` |
| `qflow: Refresh` | Refresh the Test Explorer and Run History views |

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `qflow.cliPath` | `""` | Path to the qflow CLI binary. Leave blank to auto-detect (uses local `node_modules/.bin/qflow` or `npx @qflow/cli`). |
| `qflow.defaultSuite` | `"regression"` | Default suite for `qflow: Run Tests`. |
| `qflow.autoRefresh` | `true` | Automatically refresh views after each run. |
| `qflow.showStatusBar` | `true` | Show the qflow status bar item. |

## Development

```bash
cd packages/vscode-extension
pnpm install
pnpm build
```

Press **F5** in VS Code to launch the Extension Development Host.
