# qflow dashboard

Static single-page application that displays test run history, flakiness, coverage drift, and cost data. Deployed to GitHub Pages automatically after every CI run.

---

## How it works

The dashboard has no server and no database of its own. It reads JSON files that the Reporter Agent commits to the `gh-pages` branch:

```
gh-pages branch
└── data/
    ├── manifest.json              Index of all runs (id, timestamp, suite, pass/fail counts)
    ├── run-2026-04-29T10-00.json  Full run detail (individual test results)
    ├── run-2026-04-29T11-00.json
    └── ...
```

On load, the SPA fetches `data/manifest.json` and lazy-loads individual run files as needed. It refreshes every 30 seconds.

---

## Pages

| Page | Content |
|---|---|
| **Runs** | History of every test run — suite, runner, pass/fail count, duration, branch, commit. Expandable per-test results table. |
| **Flakiness** | Tests with intermittent failures and their quarantine status. _(Phase 4)_ |
| **Coverage Drift** | JIRA "Done" stories without matching test files. _(Phase 4)_ |
| **Costs** | LLM token usage per agent, per run, monthly total. _(Phase 3)_ |

---

## Running locally

```bash
# Start the local dashboard server (reads .qflow/data/)
npx qflow dashboard

# Optional: specify a port
npx qflow dashboard --port 4000
```

The local server also exposes `/api/manifest` which returns all locally saved run data. The SPA tries this endpoint first; if it fails (no local server), it falls back to fetching static files from the GitHub Pages URL.

---

## GitHub Pages setup

1. In your repo: Settings → Pages → Source → `gh-pages` branch → `/ (root)`
2. Set `dashboard.githubPages: true` in `framework.config.ts`
3. The Reporter Agent will auto-create the `gh-pages` branch on the first run

> **Note:** GitHub Pages requires a public repo, or a GitHub Pro/Team plan for private repos.

---

## Data format

### `manifest.json`

```json
{
  "runs": [
    {
      "id": "uuid",
      "timestamp": "2026-04-29T10:00:00.000Z",
      "suite": "regression",
      "passed": 42,
      "failed": 0,
      "total": 42,
      "file": "data/run-2026-04-29T10-00-00-000Z.json"
    }
  ],
  "quarantined": [],
  "lastUpdated": "2026-04-29T10:00:01.000Z"
}
```

### `run-{timestamp}.json`
A full `RunReport` object — see [@qflow/core types](../packages/core/README.md#key-types).

---

## Files

```
dashboard/
├── index.html     Page shell + navigation
└── src/
    ├── app.js     SPA logic — fetch, render, navigation, refresh
    └── styles.css Dark theme CSS (GitHub-inspired)
```
