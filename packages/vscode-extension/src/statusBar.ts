import * as vscode from 'vscode';
import type { RunStore } from './runStore';
import type { ManifestEntry } from './types';

export class QFlowStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor(private readonly store: RunStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'qflow.openDashboard';
    this.item.tooltip = 'qflow — click to open dashboard';
    this.item.text = '$(beaker) qflow';

    if (vscode.workspace.getConfiguration('qflow').get<boolean>('showStatusBar', true)) {
      this.item.show();
    }
  }

  refresh(): void {
    if (!vscode.workspace.getConfiguration('qflow').get<boolean>('showStatusBar', true)) {
      this.item.hide();
      return;
    }
    this.item.show();

    const manifest = this.store.loadManifest();
    const latest: ManifestEntry | undefined = manifest?.runs[manifest.runs.length - 1];
    if (!latest) {
      this.item.text = '$(beaker) qflow';
      return;
    }

    if (latest.failed > 0) {
      this.item.text = `$(error) qflow ${latest.passed}✓ ${latest.failed}✗`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else {
      this.item.text = `$(pass) qflow ${latest.passed}✓`;
      this.item.backgroundColor = undefined;
    }

    const ago = formatRelativeTime(new Date(latest.timestamp));
    this.item.tooltip =
      `qflow — last run ${ago}: ${latest.passed} passed, ${latest.failed} failed of ${latest.total}\n` +
      `Suite: ${latest.suite}\n` +
      'Click to open dashboard';
  }

  setRunning(label: string): void {
    this.item.text = `$(loading~spin) ${label}`;
    this.item.backgroundColor = undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}
