import * as vscode from 'vscode';
import type { RunStore } from './runStore';
import { computeFlakiness, type FlakinessStat } from './flakinessService';

class FlakyTreeItem extends vscode.TreeItem {
  constructor(public readonly stat: FlakinessStat) {
    super(stat.fullName, vscode.TreeItemCollapsibleState.None);
    this.description = `${stat.flakinessPct}% (${stat.failures}/${stat.totalRuns})`;
    this.tooltip = `${stat.fullName}\n\nFailures: ${stat.failures}\nPasses: ${stat.passes}\nSkips: ${stat.skips}\nTotal runs: ${stat.totalRuns}`;
    this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    if (stat.file) {
      this.resourceUri = vscode.Uri.file(stat.file);
    }
  }
}

export class QFlowFlakinessView implements vscode.TreeDataProvider<FlakyTreeItem> {
  private readonly _onDidChange = new vscode.EventEmitter<FlakyTreeItem | undefined | void>();
  readonly onDidChangeTreeData: vscode.Event<FlakyTreeItem | undefined | void> = this._onDidChange.event;

  constructor(private readonly store: RunStore) {}

  refresh(): void {
    this._onDidChange.fire();
  }

  getTreeItem(element: FlakyTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): FlakyTreeItem[] {
    const window = vscode.workspace
      .getConfiguration('qflow')
      .get<number>('flakinessWindow', 20);
    return computeFlakiness(this.store, window)
      .filter((s) => s.flakinessPct > 0)
      .map((s) => new FlakyTreeItem(s));
  }
}
