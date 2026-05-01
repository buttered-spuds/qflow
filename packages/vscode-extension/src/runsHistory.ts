import * as vscode from 'vscode';
import type { RunStore } from './runStore';
import type { ManifestEntry, RunReport } from './types';

export class RunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly entry: ManifestEntry,
    public readonly report?: RunReport | null,
  ) {
    const label = new Date(entry.timestamp).toLocaleString();
    super(label, vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'qflow.run';
    this.id = entry.id;
    this.description = `${entry.passed}✓${entry.failed > 0 ? ` ${entry.failed}✗` : ''} / ${entry.total}`;
    this.tooltip = `Suite: ${entry.suite}\nRun ID: ${entry.id}`;

    this.iconPath =
      entry.failed > 0
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
  }
}

class RunTestItem extends vscode.TreeItem {
  constructor(name: string, status: 'passed' | 'failed' | 'skipped' | 'flaky', duration: number) {
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

type HistoryNode = RunTreeItem | RunTestItem;

export class QFlowRunsHistory implements vscode.TreeDataProvider<HistoryNode> {
  private readonly _onDidChange = new vscode.EventEmitter<HistoryNode | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<HistoryNode | undefined | void> = this._onDidChange.event;

  constructor(private readonly store: RunStore) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: HistoryNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HistoryNode): vscode.ProviderResult<HistoryNode[]> {
    if (!element) {
      return this.store
        .recentRuns(50)
        .map(({ entry, report }) => new RunTreeItem(entry, report));
    }
    if (element instanceof RunTreeItem && element.report) {
      return element.report.tests.map(
        (t) => new RunTestItem(t.name, t.status, t.duration),
      );
    }
    return [];
  }
}
