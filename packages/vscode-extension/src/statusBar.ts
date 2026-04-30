import * as vscode from 'vscode';
import { join } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { Manifest, ManifestEntry, RunReport } from './testExplorer';

export class QFlowStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'qflow.openDashboard';
    this.item.tooltip = 'qflow — click to open dashboard';
    this.item.text = '$(beaker) qflow';
    this.item.show();
  }

  /** Re-read the latest run and update the status bar label. */
  refresh(): void {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      this.item.text = '$(beaker) qflow';
      return;
    }

    const manifestPath = join(root, '.qflow', 'data', 'manifest.json');
    if (!existsSync(manifestPath)) {
      this.item.text = '$(beaker) qflow';
      return;
    }

    try {
      const manifest: Manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const latest: ManifestEntry | undefined = manifest.runs[manifest.runs.length - 1];
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
      this.item.tooltip = `qflow — last run ${ago}: ${latest.passed} passed, ${latest.failed} failed of ${latest.total}\nClick to open dashboard`;
    } catch {
      this.item.text = '$(beaker) qflow';
    }
  }

  /** Set status bar to "running" state. */
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
