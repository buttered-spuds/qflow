import * as vscode from 'vscode';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { Manifest, ManifestEntry, RunReport } from './testExplorer';

// ─── Run history tree item ────────────────────────────────────────────────────

export class RunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: ManifestEntry,
    public readonly report?: RunReport,
  ) {
    const label = new Date(entry.timestamp).toLocaleString();
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'qflow.run';
    this.description = `${entry.passed}✓${entry.failed > 0 ? ` ${entry.failed}✗` : ''} / ${entry.total}`;
    this.tooltip = `Suite: ${entry.suite}\nRun ID: ${entry.id}`;

    this.iconPath =
      entry.failed > 0
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  }
}

class RunTestItem extends vscode.TreeItem {
  constructor(
    name: string,
    status: 'passed' | 'failed' | 'skipped' | 'flaky',
    duration: number,
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);

    this.description = `${duration}ms`;

    switch (status) {
      case 'passed':
        this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
        break;
      case 'failed':
        this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
        break;
      case 'skipped':
        this.iconPath = new vscode.ThemeIcon('debug-step-over', new vscode.ThemeColor('testing.iconSkipped'));
        break;
      case 'flaky':
        this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        break;
    }
  }
}

// ─── Run history tree provider ────────────────────────────────────────────────

type HistoryNode = RunTreeItem | RunTestItem;

export class QFlowRunsHistory implements vscode.TreeDataProvider<HistoryNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HistoryNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<HistoryNode | undefined | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: HistoryNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryNode): vscode.ProviderResult<HistoryNode[]> {
    if (!element) {
      return this.getRunItems();
    }

    if (element instanceof RunTreeItem && element.report) {
      return element.report.tests.map(
        (t) => new RunTestItem(t.name, t.status, t.duration),
      );
    }

    return [];
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getRunItems(): RunTreeItem[] {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) return [];

    const manifestPath = join(root, '.qflow', 'data', 'manifest.json');
    if (!existsSync(manifestPath)) return [];

    try {
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

      // Show most-recent runs first, cap at 50
      const entries = [...manifest.runs].reverse().slice(0, 50);

      return entries.map((entry) => {
        let report: RunReport | undefined;
        const reportPath = join(root, '.qflow', 'data', entry.file);
        if (existsSync(reportPath)) {
          try {
            report = JSON.parse(readFileSync(reportPath, 'utf-8')) as RunReport;
          } catch {
            report = undefined;
          }
        }
        return new RunTreeItem(entry, report);
      });
    } catch {
      return [];
    }
  }
}
