# @qflow/cli

The `qflow` CLI binary. All commands a user interacts with live here.

---

## Commands

### `qflow init`
Interactive setup wizard. Prompts for:
- Test runner (Playwright / pytest / Jest / custom)
- JIRA connection (optional)
- LLM provider (optional, for Phase 3 AI features)
- Notification channels (Slack / Teams / JIRA)
- GitHub Pages dashboard
- CI platform (generates `.github/workflows/qflow-test.yml` for GitHub Actions)

Outputs:
- `framework.config.ts` in the current directory
- `.qflow/` directory (gitignored)
- `.github/workflows/qflow-test.yml` (if GitHub Actions selected)
- Updates `.gitignore`

---

### `qflow run [options]`

```
Options:
  -s, --suite <suite>   regression (default) | smoke | pr-smart
  -l, --local           Skip all notifications, LLM calls, and gh-pages publishing
```

Behaviour:
1. Loads and validates `framework.config.ts`
2. Calls the Orchestrator, which runs the configured test suite
3. Reporter Agent persists results, fires notifications, publishes to gh-pages
4. Exits with code `1` if any tests fail (safe for CI)

`--local` mode is fast and offline — no tokens spent, no webhooks fired. Useful for developer feedback loops.

---

### `qflow generate --ticket <key>` _(Phase 3)_
Generates Playwright/API tests from a JIRA ticket's acceptance criteria and opens a Draft PR.

---

### `qflow dashboard [--port <port>]`
Starts a local HTTP server (default port `3000`) that serves the dashboard SPA reading from `.qflow/data/`. Useful when the GitHub Pages site is not set up or when working offline.

---

### `qflow costs` _(Phase 3)_
Prints LLM token usage and estimated cost per agent, per run, and monthly total.

---

### `qflow flakiness` _(Phase 4)_
Prints current flakiness stats and quarantine status for all tracked tests.

---

### `qflow coverage-check` _(Phase 4)_
Checks JIRA "Done" user stories against test files. Reports stories that shipped without tests.

---

## Commands directory structure

```
src/
├── index.ts               Commander program — registers all commands
└── commands/
    ├── init.ts            Interactive wizard + file generation
    ├── run.ts             Orchestrator invocation + result printer
    ├── generate.ts        Phase 3 stub
    ├── dashboard.ts       Local dashboard server + /api/manifest endpoint
    ├── costs.ts           Phase 3 stub (shows run summary until LLM agents active)
    ├── flakiness.ts       Phase 4 stub
    └── coverage-check.ts  Phase 4 stub
```

---

## Build

```bash
pnpm build    # compile to dist/ (shebang auto-prepended)
pnpm dev      # run directly via tsx (no compile step)
```
