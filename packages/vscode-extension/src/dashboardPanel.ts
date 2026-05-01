import * as vscode from 'vscode';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

export class QFlowDashboardPanel {
  private static currentPanel: QFlowDashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly cwd: string;
  private focusRunId: string | undefined;

  static show(context: vscode.ExtensionContext, focusRunId?: string): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      vscode.window.showErrorMessage('qflow: No workspace folder is open.');
      return;
    }

    if (QFlowDashboardPanel.currentPanel) {
      QFlowDashboardPanel.currentPanel.panel.reveal();
      if (focusRunId) {
        QFlowDashboardPanel.currentPanel.setFocus(focusRunId);
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'qflowDashboard',
      'qflow Dashboard',
      vscode.ViewColumn.Beside,
      {
        enableScripts: false,
        localResourceRoots: [
          vscode.Uri.file(join(root, '.qflow', 'data')),
        ],
      },
    );

    QFlowDashboardPanel.currentPanel = new QFlowDashboardPanel(panel, root, focusRunId);
  }

  private constructor(panel: vscode.WebviewPanel, cwd: string, focusRunId?: string) {
    this.panel = panel;
    this.cwd = cwd;
    this.focusRunId = focusRunId;

    this.render();

    // Watch for data changes and re-render
    const watcher = vscode.workspace.createFileSystemWatcher('**/.qflow/data/**');
    const refresh = (): void => { this.render(); };
    watcher.onDidChange(refresh);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);

    this.panel.onDidDispose(() => {
      watcher.dispose();
      QFlowDashboardPanel.currentPanel = undefined;
    });
  }

  private render(): void {
    this.panel.webview.html = this.buildHtml();
  }

  /** Update the focused run id and re-render. */
  private setFocus(runId: string): void {
    this.focusRunId = runId;
    this.render();
  }

  // ─── HTML ─────────────────────────────────────────────────────────────────

  private buildHtml(): string {
    const manifestPath = join(this.cwd, '.qflow', 'data', 'manifest.json');

    if (!existsSync(manifestPath)) {
      return this.wrapHtml(`
        <div class="empty">
          <h2>No test data yet</h2>
          <p>Run <code>npx @qflow/cli run</code> to create your first test run.</p>
        </div>
      `);
    }

    let manifest: { runs: Array<{ id: string; timestamp: string; suite: string; passed: number; failed: number; total: number; file: string }>; quarantined?: string[] };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    } catch {
      return this.wrapHtml(`<div class="error">Failed to parse manifest.json</div>`);
    }

    const runs = [...manifest.runs].reverse().slice(0, 50);

    if (runs.length === 0) {
      return this.wrapHtml(`
        <div class="empty">
          <h2>No runs recorded yet</h2>
          <p>Run <code>npx @qflow/cli run</code> to get started.</p>
        </div>
      `);
    }

    const totalPassed = runs.reduce((s, r) => s + r.passed, 0);
    const totalFailed = runs.reduce((s, r) => s + r.failed, 0);
    const passRate = runs.length > 0
      ? Math.round((runs.filter((r) => r.failed === 0).length / runs.length) * 100)
      : 0;

    const summaryCards = `
      <div class="summary">
        <div class="stat-card">
          <div class="label">Runs</div>
          <div class="value">${runs.length}</div>
        </div>
        <div class="stat-card ${totalFailed > 0 ? 'fail' : 'pass'}">
          <div class="label">Pass Rate</div>
          <div class="value">${passRate}%</div>
        </div>
        <div class="stat-card pass">
          <div class="label">Passed</div>
          <div class="value">${totalPassed}</div>
        </div>
        <div class="stat-card ${totalFailed > 0 ? 'fail' : ''}">
          <div class="label">Failed</div>
          <div class="value">${totalFailed}</div>
        </div>
      </div>
    `;

    const runRows = runs.map((r) => {
      const date = new Date(r.timestamp).toLocaleString();
      const statusClass = r.failed > 0 ? 'fail' : 'pass';
      const statusIcon = r.failed > 0 ? '✗' : '✓';
      const highlightAttr = this.focusRunId && r.id === this.focusRunId
        ? `class="${statusClass} focused"`
        : `class="${statusClass}"`;
      return `
        <tr ${highlightAttr}>
          <td><span class="badge ${statusClass}">${statusIcon}</span></td>
          <td>${h(date)}</td>
          <td>${h(r.suite)}</td>
          <td>${r.passed}</td>
          <td>${r.failed}</td>
          <td>${r.total}</td>
        </tr>
      `;
    }).join('');

    const runsTable = `
      <div class="section">
        <h2>Recent Runs</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Date</th>
              <th>Suite</th>
              <th>Passed</th>
              <th>Failed</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${runRows}
          </tbody>
        </table>
      </div>
    `;

    const quarantined = manifest.quarantined ?? [];
    const quarantineSection = quarantined.length > 0 ? `
      <div class="section">
        <h2>Quarantined Tests (${quarantined.length})</h2>
        <ul class="quarantine-list">
          ${quarantined.map((q) => `<li>${h(q)}</li>`).join('')}
        </ul>
      </div>
    ` : '';

    return this.wrapHtml(summaryCards + runsTable + quarantineSection);
  }

  private wrapHtml(body: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>qflow Dashboard</title>
  <style>
    :root {
      --pass: #4caf50;
      --fail: #f44336;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --border: var(--vscode-panel-border);
      --card-bg: var(--vscode-sideBar-background);
      --header-bg: var(--vscode-titleBar-activeBackground);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: 13px; color: var(--fg); background: var(--bg); padding: 20px; }
    h1 { font-size: 18px; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
    h1 svg { width: 20px; height: 20px; flex-shrink: 0; }
    h2 { font-size: 14px; font-weight: 600; margin-bottom: 10px; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
    .stat-card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 6px; padding: 12px 20px; min-width: 90px; }
    .stat-card .label { font-size: 11px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .stat-card.pass .value { color: var(--pass); }
    .stat-card.fail .value { color: var(--fail); }
    .section { margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 6px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    th { font-size: 11px; text-transform: uppercase; opacity: 0.7; }
    tr.fail td { color: var(--fail); }
    tr.focused td { outline: 2px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .badge { display: inline-block; width: 18px; height: 18px; line-height: 18px; text-align: center; border-radius: 50%; font-size: 10px; font-weight: 700; }
    .badge.pass { background: var(--pass); color: #fff; }
    .badge.fail { background: var(--fail); color: #fff; }
    .empty, .error { text-align: center; padding: 40px; opacity: 0.7; }
    .empty h2, .error { font-size: 16px; margin-bottom: 8px; }
    code { background: var(--card-bg); padding: 2px 6px; border-radius: 3px; font-family: var(--vscode-editor-font-family); }
    .quarantine-list { padding-left: 20px; }
    .quarantine-list li { padding: 3px 0; opacity: 0.8; }
  </style>
</head>
<body>
  <h1>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 3h6M9 3v6l-4 9a1 1 0 0 0 .9 1.5h12.2a1 1 0 0 0 .9-1.5L15 9V3"/>
    </svg>
    qflow Dashboard
  </h1>
  ${body}
</body>
</html>`;
  }
}

/** Escape a string for safe inclusion in HTML content. */
function h(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
