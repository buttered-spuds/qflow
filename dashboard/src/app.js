// qflow dashboard — vanilla JS SPA
// Reads from /api/manifest (local server) or /data/manifest.json (GitHub Pages)

const app = document.getElementById('app');
const navBtns = document.querySelectorAll('.nav-btn');
let currentPage = 'runs';
let runsCache = null;

// ─── Navigation ───────────────────────────────────────────────────────────────

navBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    navBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentPage = btn.dataset.page;
    render();
  });
});

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchRuns() {
  // Try local server first, then GitHub Pages static files
  try {
    const res = await fetch('/api/manifest');
    if (res.ok) {
      const data = await res.json();
      runsCache = data.runs ?? [];
      return;
    }
  } catch { /* local server not running */ }

  try {
    const manifest = await fetch('./data/manifest.json').then((r) => r.json());
    const runs = await Promise.all(
      (manifest.runs ?? []).map((entry) => fetch(`./data/${entry.file}`).then((r) => r.json())),
    );
    runsCache = runs;
  } catch {
    runsCache = [];
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  if (runsCache === null) {
    app.innerHTML = '<p class="loading">Loading…</p>';
    return;
  }

  switch (currentPage) {
    case 'runs': renderRuns(); break;
    case 'flakiness': renderPhaseNotice('Flakiness', 4); break;
    case 'coverage': renderPhaseNotice('Coverage Drift', 4); break;
    case 'costs': renderCosts(); break;
  }
}

// ─── Runs page ────────────────────────────────────────────────────────────────

function renderRuns() {
  if (!runsCache.length) {
    app.innerHTML = `
      <div class="empty">
        <p>No test runs recorded yet.</p>
        <code>npx qflow run</code>
      </div>`;
    return;
  }

  const totalPassed = runsCache.reduce((s, r) => s + r.passed, 0);
  const totalFailed = runsCache.reduce((s, r) => s + r.failed, 0);
  const avgDuration = Math.round(runsCache.reduce((s, r) => s + r.duration, 0) / runsCache.length);

  const summaryHtml = `
    <div class="summary">
      <div class="stat-card">
        <div class="label">Total Runs</div>
        <div class="value">${runsCache.length}</div>
      </div>
      <div class="stat-card">
        <div class="label">Tests Passed</div>
        <div class="value green">${totalPassed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Tests Failed</div>
        <div class="value ${totalFailed > 0 ? 'red' : ''}">${totalFailed}</div>
      </div>
      <div class="stat-card">
        <div class="label">Avg Duration</div>
        <div class="value">${formatDuration(avgDuration)}</div>
      </div>
    </div>`;

  const runsHtml = runsCache
    .slice()
    .reverse()
    .map((run) => renderRunCard(run))
    .join('');

  app.innerHTML = summaryHtml + runsHtml;
}

function renderRunCard(run) {
  const hasFailed = run.failed > 0;
  const badgeClass = hasFailed ? 'fail' : 'pass';
  const badgeText = hasFailed ? `✗ ${run.failed} failed` : `✓ All passed`;

  const testsHtml = run.tests
    .map(
      (t) => `
      <tr>
        <td>${escHtml(t.file ?? '')} ${t.file ? '›' : ''} ${escHtml(t.name)}</td>
        <td class="status-${t.status}">${t.status}</td>
        <td>${t.duration}ms</td>
      </tr>`,
    )
    .join('');

  return `
    <div class="run-card">
      <div class="run-header">
        <span class="run-title">${escHtml(run.suite)} — ${escHtml(run.runner)}</span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="run-meta">
        ${new Date(run.timestamp).toLocaleString()}
        · ${run.passed + run.failed + run.skipped} tests
        · ${formatDuration(run.duration)}
        ${run.branch ? `· <code>${escHtml(run.branch)}</code>` : ''}
        ${run.commit ? `· <code>${escHtml(run.commit.slice(0, 7))}</code>` : ''}
      </div>
      <details>
        <summary>Show ${run.tests.length} tests</summary>
        <table>
          <tr><th>Test</th><th>Status</th><th>Duration</th></tr>
          ${testsHtml}
        </table>
      </details>
    </div>`;
}

// ─── Costs page ───────────────────────────────────────────────────────────────

function renderCosts() {
  const totalRuns = runsCache.length;

  app.innerHTML = `
    <div class="summary">
      <div class="stat-card">
        <div class="label">Runs Recorded</div>
        <div class="value">${totalRuns}</div>
      </div>
    </div>
    <div class="phase-notice">
      <strong>LLM Cost Tracking — Phase 3</strong>
      Cost tracking will be active once AI agents (Generator, Reviewer, JIRA) are enabled in Phase 3.
      Each LLM call will be logged with token usage and estimated USD cost.
    </div>`;
}

// ─── Phase placeholder ────────────────────────────────────────────────────────

function renderPhaseNotice(feature, phase) {
  app.innerHTML = `
    <div class="phase-notice">
      <strong>${feature} — Phase ${phase}</strong>
      This feature will be available in Phase ${phase} of the qflow rollout.
    </div>`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await fetchRuns();
  render();
  // Refresh every 30s
  setInterval(async () => { await fetchRuns(); render(); }, 30_000);
})();
